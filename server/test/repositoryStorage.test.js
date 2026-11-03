import test from "node:test";
import assert from "node:assert/strict";
import {
  isDurableRepositoryStorageConfigured,
  requireDurableRepositoryStorage
} from "../src/utils/repositoryStorage.js";

test("allows repository writes in development without a production disk flag", () => {
  const env = {NODE_ENV:"development",REPO_STORAGE_DURABLE:"false"};
  assert.equal(isDurableRepositoryStorageConfigured(env),true);
  assert.equal(requireDurableRepositoryStorage(env),undefined);
});

test("blocks production Git writes when durable storage is not explicitly enabled", () => {
  for (const durable of [undefined,"false","TRUE","1",""]) {
    const env = {NODE_ENV:"production",REPO_STORAGE_DURABLE:durable};
    assert.equal(isDurableRepositoryStorageConfigured(env),false);
    assert.throws(
      () => requireDurableRepositoryStorage(env),
      error => error.code === "PERSISTENT_STORAGE_NOT_CONFIGURED" && error.statusCode === 503
    );
  }
});

test("allows production Git writes only after explicit durable-storage confirmation", () => {
  const env = {NODE_ENV:"production",REPO_STORAGE_DURABLE:"true"};
  assert.equal(isDurableRepositoryStorageConfigured(env),true);
  assert.equal(requireDurableRepositoryStorage(env),undefined);
});
