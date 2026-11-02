import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPullRequestOpen,
  claimPullRequestMerge,
  completePullRequestMerge,
  releasePullRequestMerge
} from "../src/services/pullRequestLifecycle.js";

function fakePullRequests(initial = {}) {
  const records = new Map(Object.entries(initial));
  return {
    records,
    async findOneAndUpdate(filter, update) {
      const current = records.get(String(filter._id));
      if (!current || current.status !== filter.status) return null;
      const next = {...current, ...update.$set};
      for (const key of Object.keys(update.$unset || {})) delete next[key];
      records.set(String(filter._id), next);
      return {...next};
    },
    async updateOne(filter, update) {
      const current = records.get(String(filter._id));
      if (!current || current.status !== filter.status) return {matchedCount: 0};
      const next = {...current, ...update.$set};
      for (const key of Object.keys(update.$unset || {})) delete next[key];
      records.set(String(filter._id), next);
      return {matchedCount: 1};
    }
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

test("claims an open pull request exactly once", async () => {
  const model = fakePullRequests({pr1: {status: "open"}});
  const now = new Date("2026-11-02T00:00:00.000Z");
  const outcomes = await Promise.allSettled([
    claimPullRequestMerge("pr1", model, now),
    claimPullRequestMerge("pr1", model, now)
  ]);
  assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(item => item.status === "rejected" && item.reason.code === "PULL_REQUEST_BUSY").length, 1);
  assert.equal(model.records.get("pr1").status, "merging");
  assert.equal(model.records.get("pr1").mergeStartedAt, now);
});

test("completes only a claimed merge and records its result atomically", async () => {
  const model = fakePullRequests({pr1: {status: "merging", mergeStartedAt: new Date()}});
  await completePullRequestMerge("pr1", {
    mergedBy: "user1",
    mergedAt: new Date("2026-11-02T01:00:00.000Z"),
    mergeCommit: "a".repeat(40)
  }, model);
  assert.equal(model.records.get("pr1").status, "merged");
  assert.equal(model.records.get("pr1").mergeCommit, "a".repeat(40));
  assert.equal("mergeStartedAt" in model.records.get("pr1"), false);
  await assert.rejects(
    () => completePullRequestMerge("pr1", {mergeCommit: "b".repeat(40)}, model),
    error => error.code === "PULL_REQUEST_STATE_CHANGED"
  );
});

test("releases a failed merge claim without changing completed pull requests", async () => {
  const model = fakePullRequests({
    active: {status: "merging", mergeStartedAt: new Date()},
    done: {status: "merged", mergeCommit: "a".repeat(40)}
  });
  await releasePullRequestMerge("active", model);
  await releasePullRequestMerge("done", model);
  assert.equal(model.records.get("active").status, "open");
  assert.equal("mergeStartedAt" in model.records.get("active"), false);
  assert.equal(model.records.get("done").status, "merged");
  assert.equal(model.records.get("done").mergeCommit, "a".repeat(40));
});
