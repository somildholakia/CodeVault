import {AppError} from "./errors.js";

export function isDurableRepositoryStorageConfigured(env = process.env) {
  return env.NODE_ENV !== "production" || env.REPO_STORAGE_DURABLE === "true";
}

export function requireDurableRepositoryStorage(env = process.env) {
  if (!isDurableRepositoryStorageConfigured(env)) {
    throw new AppError(
      503,
      "PERSISTENT_STORAGE_NOT_CONFIGURED",
      "Repository writes are disabled until durable Git storage is configured."
    );
  }
}
