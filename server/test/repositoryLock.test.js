import test from "node:test";
import assert from "node:assert/strict";
import {
  createRepositoryLockManager,
  assertRepositoryLease
} from "../src/services/repositoryLock.js";

const repositoryId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function sharedLockModel() {
  const records = new Map();
  const clone = value => value ? {...value, leaseUntil:value.leaseUntil ? new Date(value.leaseUntil) : value.leaseUntil} : null;
  return {
    records,
    async findOneAndUpdate(filter, update) {
      const current = records.get(String(filter._id));
      const instant = filter.$or.find(item => item.leaseUntil?.$lte).leaseUntil.$lte;
      const expired = !current || !current.leaseUntil || current.leaseUntil.getTime() <= instant.getTime();
      if (!expired) {
        const error = new Error("duplicate repository lock");
        error.code = 11000;
        throw error;
      }
      const next = {
        ...(current || {}),
        ...update.$set,
        fence: Number(current?.fence || 0) + Number(update.$inc?.fence || 0)
      };
      records.set(String(filter._id), next);
      return clone(next);
    },
    async exists(filter) {
      const current = records.get(String(filter._id));
      if (!current) return null;
      const active = current.ownerToken === filter.ownerToken &&
        current.fence === filter.fence &&
        current.leaseUntil?.getTime() > filter.leaseUntil.$gt.getTime();
      return active ? {_id:filter._id} : null;
    },
    async updateOne(filter, update) {
      const current = records.get(String(filter._id));
      if (!current || current.ownerToken !== filter.ownerToken || current.fence !== filter.fence) return {matchedCount:0};
      if (filter.leaseUntil?.$gt && current.leaseUntil?.getTime() <= filter.leaseUntil.$gt.getTime()) return {matchedCount:0};
      const next = {...current, ...update.$set};
      for (const key of Object.keys(update.$unset || {})) delete next[key];
      records.set(String(filter._id), next);
      return {matchedCount:1};
    }
  };
}

function manager(model, overrides = {}) {
  return createRepositoryLockManager({
    model,
    leaseMs: 1000,
    heartbeatMs: 200,
    waitMs: 1500,
    retryMs: 5,
    ...overrides
  });
}

test("independent workers serialize repository writes and receive increasing fences", async () => {
  const model = sharedLockModel();
  const workerA = manager(model);
  const workerB = manager(model);
  const events = [];
  let releaseFirst;
  let startedFirst;
  const firstGate = new Promise(resolve => {releaseFirst = resolve;});
  const firstStarted = new Promise(resolve => {startedFirst = resolve;});

  const first = workerA(repositoryId, async lease => {
    events.push("worker-a-start");
    startedFirst();
    await firstGate;
    await lease.assertOwned();
    events.push("worker-a-end");
    return lease.fence;
  });
  await firstStarted;
  const second = workerB(repositoryId, async lease => {
    events.push("worker-b-start");
    await lease.assertOwned();
    events.push("worker-b-end");
    return lease.fence;
  });
  await pause(25);
  assert.deepEqual(events, ["worker-a-start"]);
  releaseFirst();
  const [fenceA, fenceB] = await Promise.all([first, second]);
  assert.deepEqual(events, ["worker-a-start","worker-a-end","worker-b-start","worker-b-end"]);
  assert.equal(fenceA, 1);
  assert.equal(fenceB, 2);
  assert.equal(model.records.get(repositoryId).fence, 2);
});

test("expired lease recovery fences out a stale worker", async () => {
  const model = sharedLockModel();
  let instant = new Date("2026-11-03T00:00:00.000Z");
  const now = () => new Date(instant);
  const workerA = manager(model, {now,leaseMs:1000,heartbeatMs:500});
  const workerB = manager(model, {now,leaseMs:1000,heartbeatMs:500});
  let started;
  let releaseFirst;
  const didStart = new Promise(resolve => {started = resolve;});
  const hold = new Promise(resolve => {releaseFirst = resolve;});

  const stale = workerA(repositoryId, async lease => {
    started();
    await hold;
    await lease.assertOwned();
  });
  await didStart;
  instant = new Date(instant.getTime() + 2000);
  const currentFence = await workerB(repositoryId, async lease => {
    await lease.assertOwned();
    return lease.fence;
  });
  assert.equal(currentFence, 2);
  releaseFirst();
  await assert.rejects(() => stale, error => error.code === "REPOSITORY_LOCK_LOST");
  assert.equal(model.records.get(repositoryId).fence, 2);
});

test("heartbeats keep a long-running owner alive beyond one lease interval", async () => {
  const model = sharedLockModel();
  const workerA = manager(model, {leaseMs:180,heartbeatMs:30,waitMs:1500});
  const workerB = manager(model, {leaseMs:180,heartbeatMs:30,waitMs:1500});
  let firstStarted;
  let releaseFirst;
  const started = new Promise(resolve => {firstStarted = resolve;});
  const hold = new Promise(resolve => {releaseFirst = resolve;});
  const events = [];

  const first = workerA(repositoryId, async lease => {
    events.push("first-start");
    firstStarted();
    await hold;
    await lease.assertOwned();
    events.push("first-end");
  });
  await started;
  await pause(260);
  const second = workerB(repositoryId, async () => {
    events.push("second-start");
  });
  await pause(25);
  assert.deepEqual(events, ["first-start"]);
  releaseFirst();
  await Promise.all([first,second]);
  assert.deepEqual(events, ["first-start","first-end","second-start"]);
});

test("lock acquisition fails closed when MongoDB coordination is unavailable", async () => {
  const brokenModel = {
    async findOneAndUpdate() { throw new Error("MongoDB unavailable"); }
  };
  const worker = manager(brokenModel,{waitMs:0});
  await assert.rejects(
    () => worker(repositoryId, async () => "must not run"),
    error => error.code === "REPOSITORY_LOCK_UNAVAILABLE" && error.statusCode === 503
  );
});

test("a nested operation on the same repository reuses its existing fence", async () => {
  const model = sharedLockModel();
  const worker = manager(model);
  const result = await worker(repositoryId, async outer => {
    const nested = await worker(repositoryId, async inner => {
      await assertRepositoryLease(repositoryId);
      return inner.fence;
    });
    return {outer:outer.fence,nested};
  });
  assert.deepEqual(result,{outer:1,nested:1});
  assert.equal(model.records.get(repositoryId).fence,1);
});
