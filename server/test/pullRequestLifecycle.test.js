import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPullRequestOpen,
  claimPullRequestMerge,
  completePullRequestMerge,
  releasePullRequestMerge,
  reconcilePullRequestMerge,
  MERGE_RECOVERY_GRACE_MS
} from "../src/services/pullRequestLifecycle.js";

function sameValue(actual, expected) {
  if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
  return actual === expected;
}

function fakePullRequests(initial = {}) {
  const records = new Map(Object.entries(initial).map(([id, value]) => [id, {_id:id, ...value}]));
  const matches = (current, filter) => current && Object.entries(filter).every(([key, value]) => sameValue(current[key], value));
  const apply = (current, update) => {
    const next = {...current, ...update.$set};
    for (const key of Object.keys(update.$unset || {})) delete next[key];
    return next;
  };
  return {
    records,
    async findOne(filter) {
      const current = records.get(String(filter._id));
      return matches(current, filter) ? {...current} : null;
    },
    async findOneAndUpdate(filter, update) {
      const current = records.get(String(filter._id));
      if (!matches(current, filter)) return null;
      const next = apply(current, update);
      records.set(String(filter._id), next);
      return {...next};
    },
    async updateOne(filter, update) {
      const current = records.get(String(filter._id));
      if (!matches(current, filter)) return {matchedCount: 0};
      records.set(String(filter._id), apply(current, update));
      return {matchedCount: 1};
    }
  };
}

const sourceSha = "a".repeat(40);
const targetSha = "b".repeat(40);
const mergedSha = "c".repeat(40);

function staleClaim(extra = {}) {
  const now = new Date("2026-11-03T02:00:00.000Z");
  return {
    status: "merging",
    sourceBranch: "feature/recovery",
    targetBranch: "main",
    mergeStartedAt: new Date(now.getTime() - MERGE_RECOVERY_GRACE_MS - 1000),
    mergeSourceSha: sourceSha,
    mergeTargetSha: targetSha,
    mergeClaimedBy: "user1",
    ...extra
  };
}

test("allows only open pull requests to accept review and comment changes", () => {
  assert.doesNotThrow(() => assertPullRequestOpen({status: "open"}, "reviewed"));
  assert.throws(
    () => assertPullRequestOpen({status: "merging"}, "reviewed"),
    error => error.code === "PULL_REQUEST_BUSY"
  );
  assert.throws(
    () => assertPullRequestOpen({status: "merged"}, "reviewed"),
    error => error.code === "PULL_REQUEST_CLOSED"
  );
});

test("claims an open pull request exactly once and persists the immutable merge snapshot", async () => {
  const model = fakePullRequests({pr1: {status: "open"}});
  const now = new Date("2026-11-02T00:00:00.000Z");
  const pins = {sourceSha,targetSha,claimedBy:"user1"};
  const outcomes = await Promise.allSettled([
    claimPullRequestMerge("pr1", pins, model, now),
    claimPullRequestMerge("pr1", pins, model, now)
  ]);
  assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(item => item.status === "rejected" && item.reason.code === "PULL_REQUEST_BUSY").length, 1);
  const claim = model.records.get("pr1");
  assert.equal(claim.status, "merging");
  assert.equal(claim.mergeStartedAt, now);
  assert.equal(claim.mergeSourceSha, sourceSha);
  assert.equal(claim.mergeTargetSha, targetSha);
  assert.equal(claim.mergeClaimedBy, "user1");
});

test("completes only a claimed merge and clears its recovery snapshot atomically", async () => {
  const model = fakePullRequests({pr1: staleClaim()});
  await completePullRequestMerge("pr1", {
    mergedBy: "user1",
    mergedAt: new Date("2026-11-02T01:00:00.000Z"),
    mergeCommit: mergedSha
  }, model);
  const completed = model.records.get("pr1");
  assert.equal(completed.status, "merged");
  assert.equal(completed.mergeCommit, mergedSha);
  assert.equal("mergeStartedAt" in completed, false);
  assert.equal("mergeSourceSha" in completed, false);
  assert.equal("mergeTargetSha" in completed, false);
  assert.equal("mergeClaimedBy" in completed, false);
  await assert.rejects(
    () => completePullRequestMerge("pr1", {mergeCommit: "d".repeat(40)}, model),
    error => error.code === "PULL_REQUEST_STATE_CHANGED"
  );
});

test("releases a failed pre-Git merge claim and clears its snapshot", async () => {
  const model = fakePullRequests({
    active: staleClaim(),
    done: {status: "merged", mergeCommit: mergedSha}
  });
  await releasePullRequestMerge("active", model);
  await releasePullRequestMerge("done", model);
  const released = model.records.get("active");
  assert.equal(released.status, "open");
  assert.equal("mergeStartedAt" in released, false);
  assert.equal("mergeSourceSha" in released, false);
  assert.equal("mergeTargetSha" in released, false);
  assert.equal("mergeClaimedBy" in released, false);
  assert.equal(model.records.get("done").status, "merged");
});

test("finalizes a Git-completed merge after a process crash", async () => {
  const model = fakePullRequests({pr1: staleClaim()});
  const now = new Date("2026-11-03T03:00:00.000Z");
  const result = await reconcilePullRequestMerge(
    "pr1",
    async pins => {
      assert.deepEqual(pins, {
        sourceBranch: "feature/recovery",
        targetBranch: "main",
        sourceSha,
        targetSha
      });
      return {state: "completed",mergeCommit:mergedSha};
    },
    model,
    now
  );
  const completed = model.records.get("pr1");
  assert.equal(result.state, "merged");
  assert.equal(result.mergeCommit, mergedSha);
  assert.equal(completed.status, "merged");
  assert.equal(completed.mergeCommit, mergedSha);
  assert.equal(completed.mergedBy, "user1");
  assert.equal(completed.mergedAt, now);
  assert.equal("mergeSourceSha" in completed, false);
});

test("reopens only when Git proves the merge did not occur", async () => {
  const model = fakePullRequests({pr1: staleClaim()});
  const result = await reconcilePullRequestMerge(
    "pr1",
    async () => ({state: "not_completed"}),
    model,
    new Date("2026-11-03T03:00:00.000Z")
  );
  assert.equal(result.state, "reopened");
  const reopened = model.records.get("pr1");
  assert.equal(reopened.status, "open");
  assert.equal("mergeStartedAt" in reopened, false);
  assert.equal("mergeSourceSha" in reopened, false);
  assert.equal("mergeTargetSha" in reopened, false);
});

test("preserves a merge claim when Git refs are ambiguous", async () => {
  const model = fakePullRequests({pr1: staleClaim()});
  await assert.rejects(
    () => reconcilePullRequestMerge(
      "pr1",
      async () => ({state: "ambiguous",reason: "target ref diverged"}),
      model,
      new Date("2026-11-03T03:00:00.000Z")
    ),
    error => error.code === "PULL_REQUEST_MERGE_AMBIGUOUS"
  );
  assert.equal(model.records.get("pr1").status, "merging");
  assert.equal(model.records.get("pr1").mergeSourceSha, sourceSha);
  assert.equal(model.records.get("pr1").mergeTargetSha, targetSha);
});

test("does not reconcile a merge claim before its grace period expires", async () => {
  const now = new Date("2026-11-03T03:00:00.000Z");
  const model = fakePullRequests({
    pr1: staleClaim({mergeStartedAt: new Date(now.getTime() - MERGE_RECOVERY_GRACE_MS + 1000)})
  });
  await assert.rejects(
    () => reconcilePullRequestMerge("pr1", async () => ({state: "not_completed"}), model, now),
    error => error.code === "PULL_REQUEST_MERGE_NOT_STALE"
  );
  assert.equal(model.records.get("pr1").status, "merging");
});
