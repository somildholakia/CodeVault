import test from "node:test";
import assert from "node:assert/strict";
import {purgeRepositoryRecords} from "../src/services/repositoryCleanup.js";

test("purges all repository-owned records and only that repository's counters", async () => {
  const repositoryId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const calls = [];
  const names = ["Collaborator","Issue","Release","PullRequest","BranchProtection","Activity","SequenceCounter"];
  const models = Object.fromEntries(names.map(name => [name, {
    async deleteMany(filter) {
      calls.push({model:name,filter});
      return {acknowledged:true,deletedCount:1};
    }
  }]));

  await purgeRepositoryRecords(repositoryId,models);
  assert.equal(calls.length,names.length);
  for (const name of names.filter(value => value !== "SequenceCounter")) {
    assert.ok(calls.some(call => call.model === name && call.filter.repository === repositoryId));
  }
  const counterCall = calls.find(call => call.model === "SequenceCounter");
  assert.deepEqual(counterCall.filter,{
    _id: {$in:[
      "issue:aaaaaaaaaaaaaaaaaaaaaaaa",
      "pull_request:aaaaaaaaaaaaaaaaaaaaaaaa"
    ]}
  });
});

test("waits for every dependent collection cleanup before completing", async () => {
  const repositoryId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const completed = [];
  let releaseSlow;
  const slow = new Promise(resolve => {releaseSlow = resolve;});
  const names = ["Collaborator","Issue","Release","PullRequest","BranchProtection","Activity","SequenceCounter"];
  const models = Object.fromEntries(names.map(name => [name, {
    async deleteMany() {
      if (name === "PullRequest") await slow;
      completed.push(name);
      return {acknowledged:true};
    }
  }]));

  let finished = false;
  const pending = purgeRepositoryRecords(repositoryId,models).then(() => {finished = true;});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(finished,false);
  releaseSlow();
  await pending;
  assert.equal(finished,true);
  assert.equal(completed.length,names.length);
});
