import test from "node:test";
import assert from "node:assert/strict";
import {nextSequence} from "../src/services/sequences.js";
import Issue from "../src/models/Issue.js";
import PullRequest from "../src/models/PullRequest.js";

function createCounterModel({duplicateFirstUpsert = false, failUpsert = false} = {}) {
  const values = new Map();
  let shouldDuplicate = duplicateFirstUpsert;
  return {
    values,
    async updateOne(filter, update) {
      if (failUpsert) throw new Error("database unavailable");
      if (shouldDuplicate) {
        shouldDuplicate = false;
        const error = new Error("duplicate key");
        error.code = 11000;
        // Simulate the competing request having won the first insert.
        values.set(filter._id, update.$max.value);
        throw error;
      }
      const current = values.get(filter._id);
      values.set(filter._id, current === undefined
        ? update.$max.value
        : Math.max(current, update.$max.value));
      return {acknowledged: true};
    },
    async findOneAndUpdate(filter, update) {
      const next = (values.get(filter._id) ?? 0) + update.$inc.value;
      values.set(filter._id, next);
      return {_id: filter._id, value: next};
    }
  };
}

test("allocates the next value after existing legacy issue numbers", async () => {
  const model = createCounterModel();
  assert.equal(await nextSequence("issue:aaaaaaaaaaaaaaaaaaaaaaaa", 41, model), 42);
  assert.equal(await nextSequence("issue:aaaaaaaaaaaaaaaaaaaaaaaa", 42, model), 43);
});

test("allocates pull-request numbers in a separate repository-scoped sequence", async () => {
  const model = createCounterModel();
  const key = "pull_request:bbbbbbbbbbbbbbbbbbbbbbbb";
  assert.equal(await nextSequence(key, 0, model), 1);
  assert.equal(await nextSequence(key, 1, model), 2);
  assert.equal(model.values.get("issue:bbbbbbbbbbbbbbbbbbbbbbbb"), undefined);
});

test("continues safely when another request wins the initial counter upsert", async () => {
  const model = createCounterModel({duplicateFirstUpsert: true});
  assert.equal(await nextSequence("issue:cccccccccccccccccccccccc", 8, model), 9);
});

test("keeps counters monotonic when persisted records are ahead of the counter", async () => {
  const model = createCounterModel();
  model.values.set("issue:dddddddddddddddddddddddd", 4);
  assert.equal(await nextSequence("issue:dddddddddddddddddddddddd", 12, model), 13);
});

test("does not hide database failures during counter initialization", async () => {
  const model = createCounterModel({failUpsert: true});
  await assert.rejects(
    () => nextSequence("issue:eeeeeeeeeeeeeeeeeeeeeeee", 0, model),
    /database unavailable/
  );
});

test("rejects malformed scopes and unsafe legacy sequence values", async () => {
  const model = createCounterModel();
  await assert.rejects(() => nextSequence("issue:not-a-repository", 0, model), error => error.code === "INVALID_SEQUENCE_KEY");
  await assert.rejects(() => nextSequence("issue:ffffffffffffffffffffffff", -1, model), error => error.code === "INVALID_SEQUENCE_BASE");
});

test("issue numbers remain unique within each repository", () => {
  const index = Issue.schema.indexes().find(([keys]) => keys.repository === 1 && keys.number === 1);
  assert.equal(index?.[1]?.unique, true);
});

test("only one open pull request can exist for a repository and branch pair", () => {
  const index = PullRequest.schema.indexes().find(([keys]) =>
    keys.repository === 1 && keys.sourceBranch === 1 && keys.targetBranch === 1
  );
  assert.equal(index?.[1]?.unique, true);
  assert.deepEqual(index?.[1]?.partialFilterExpression, {status: {$in: ["open", "merging"]}});
});

test("pull-request numbers remain unique within each repository", () => {
  const index = PullRequest.schema.indexes().find(([keys]) => keys.repository === 1 && keys.number === 1);
  assert.equal(index?.[1]?.unique, true);
});

test("allocates distinct sequence numbers under concurrent requests", async () => {
  const model = createCounterModel();
  const key = "pull_request:999999999999999999999999";
  const allocations = await Promise.all(Array.from({length: 50}, () => nextSequence(key, 0, model)));
  assert.equal(new Set(allocations).size, 50);
  assert.deepEqual(allocations.slice().sort((a, b) => a - b), Array.from({length: 50}, (_, index) => index + 1));
});
