import test from "node:test";
import assert from "node:assert/strict";
import {buildIssueListFilter, canWriteIssueRole, normalizeIssueListScope} from "../src/services/issueList.js";

test("limits global issue results to the supplied accessible repositories", () => {
  const ids = ["repo-a", "repo-b"];
  const filter = buildIssueListFilter({repositoryIds: ids, status: "open"});
  assert.deepEqual(filter.repository.$in, ids);
  assert.equal(filter.status, "open");
});

test("combines status, priority and personal issue scopes", () => {
  const filter = buildIssueListFilter({
    repositoryIds: ["repo-a"],
    status: "closed",
    priority: "critical",
    scope: "assigned",
    userId: "user-1"
  });
  assert.equal(filter.status, "closed");
  assert.equal(filter.priority, "critical");
  assert.equal(filter.assignee, "user-1");
});

test("supports unassigned and created-by-me scopes", () => {
  assert.equal(buildIssueListFilter({repositoryIds: [], scope: "unassigned"}).assignee, null);
  assert.equal(buildIssueListFilter({repositoryIds: [], scope: "created", userId: "user-2"}).author, "user-2");
});

test("escapes search operators and searches title, description and labels", () => {
  const filter = buildIssueListFilter({repositoryIds: [], search: "login.*"});
  assert.equal(filter.$or.length, 3);
  assert.equal(filter.$or[0].title.test("Fix login.* bug"), true);
  assert.equal(filter.$or[0].title.test("Fix loginXYZ bug"), false);
});

test("normalizes unsupported scopes to all", () => {
  assert.equal(normalizeIssueListScope("assigned"), "assigned");
  assert.equal(normalizeIssueListScope("owner"), "all");
});

test("write controls are available only to owners and writable collaborators", () => {
  assert.equal(canWriteIssueRole("owner"), true);
  assert.equal(canWriteIssueRole("maintainer"), true);
  assert.equal(canWriteIssueRole("developer"), true);
  assert.equal(canWriteIssueRole("viewer"), false);
  assert.equal(canWriteIssueRole("public-viewer"), false);
  assert.equal(canWriteIssueRole(undefined), false);
});
