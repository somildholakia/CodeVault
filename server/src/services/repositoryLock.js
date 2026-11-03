import {randomUUID} from "node:crypto";
import {AsyncLocalStorage} from "node:async_hooks";
import RepositoryLock from "../models/RepositoryLock.js";
import {AppError} from "../utils/errors.js";

const lockContext = new AsyncLocalStorage();

function envNumber(name, fallback, minimum, maximum) {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

const DEFAULT_LEASE_MS = envNumber("REPO_LOCK_LEASE_MS", 120000, 30000, 600000);
const DEFAULT_HEARTBEAT_MS = Math.min(
  envNumber("REPO_LOCK_HEARTBEAT_MS", 25000, 1000, 300000),
  Math.floor(DEFAULT_LEASE_MS / 3)
);
const DEFAULT_WAIT_MS = envNumber("REPO_LOCK_WAIT_MS", 15000, 0, 120000);
const DEFAULT_RETRY_MS = 100;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function lostError(cause) {
  return new AppError(
    409,
    "REPOSITORY_LOCK_LOST",
    "Repository ownership could not be renewed or verified. The Git operation was stopped; refresh and retry.",
    cause ? {cause: String(cause.message || cause).slice(0, 300)} : undefined
  );
}

function isMatched(result) {
  return Number(result?.matchedCount ?? result?.n ?? 0) === 1;
}

export function createRepositoryLockManager(options = {}) {
  const model = options.model || RepositoryLock;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const now = options.now || (() => new Date());
  const sleep = options.sleep || pause;
  const tokenFactory = options.tokenFactory || randomUUID;

  if (!Number.isInteger(leaseMs) || leaseMs < 30 || !Number.isInteger(heartbeatMs) ||
      heartbeatMs < 1 || heartbeatMs >= leaseMs || !Number.isInteger(waitMs) || waitMs < 0 ||
      !Number.isInteger(retryMs) || retryMs < 1) {
    throw new TypeError("Repository lock lease, heartbeat, wait and retry settings are invalid.");
  }

  async function executeWithLease(repositoryId, callback) {
    const ownerToken = tokenFactory();
    const deadline = now().getTime() + waitMs;
    let claim = null;

    while (!claim) {
      const instant = now();
      try {
        claim = await model.findOneAndUpdate(
          {
            _id: repositoryId,
            $or: [
              {leaseUntil: {$exists: false}},
              {leaseUntil: {$lte: instant}}
            ]
          },
          {
            $set: {
              ownerToken,
              leaseUntil: new Date(instant.getTime() + leaseMs),
              acquiredAt: instant,
              heartbeatAt: instant,
              releasedAt: null
            },
            $inc: {fence: 1}
          },
          {upsert: true, new: true, setDefaultsOnInsert: true}
        );
        if (claim && String(claim.ownerToken) === ownerToken) break;
        claim = null;
      } catch (error) {
        // A competing worker owns the unique repository row.
        if (error?.code !== 11000) {
          throw new AppError(
            503,
            "REPOSITORY_LOCK_UNAVAILABLE",
            "MongoDB repository coordination is unavailable. Git writes are temporarily blocked.",
            {cause: String(error?.message || error).slice(0, 300)}
          );
        }
      }

      if (now().getTime() >= deadline) {
        throw new AppError(
          409,
          "REPOSITORY_LOCK_BUSY",
          "Another worker is modifying this repository. Wait briefly, refresh and retry."
        );
      }
      await sleep(Math.max(1, Math.min(retryMs, deadline - now().getTime())));
    }

    const fence = Number(claim.fence);
    if (!Number.isSafeInteger(fence) || fence < 1) {
      throw new AppError(503, "REPOSITORY_LOCK_INVALID", "MongoDB returned an invalid repository fencing token.");
    }

    const state = {
      repositoryId,
      ownerToken,
      fence,
      leaseUntil: new Date(claim.leaseUntil),
      lost: null,
      async assertOwned() {
        if (state.lost) throw state.lost;
        const instant = now();
        if (instant.getTime() >= state.leaseUntil.getTime()) {
          state.lost = lostError("The repository lease expired before renewal.");
          throw state.lost;
        }
        try {
          const active = await model.exists({
            _id: repositoryId,
            ownerToken,
            fence,
            leaseUntil: {$gt: instant}
          });
          if (!active) {
            state.lost = lostError("The repository lease belongs to a different fencing token.");
            throw state.lost;
          }
        } catch (error) {
          if (error?.code === "REPOSITORY_LOCK_LOST") throw error;
          state.lost = lostError(error);
          throw state.lost;
        }
        return {repositoryId, ownerToken, fence};
      }
    };

    const leaseContext = {
      repositoryId,
      ownerToken,
      fence,
      get leaseUntil() { return state.leaseUntil; },
      assertOwned: () => state.assertOwned()
    };

    async function renew() {
      if (state.lost) throw state.lost;
      const instant = now();
      if (instant.getTime() >= state.leaseUntil.getTime()) {
        state.lost = lostError("The repository lease expired before renewal.");
        throw state.lost;
      }
      try {
        const result = await model.updateOne(
          {_id: repositoryId, ownerToken, fence, leaseUntil: {$gt: instant}},
          {$set: {
            leaseUntil: new Date(instant.getTime() + leaseMs),
            heartbeatAt: instant
          }}
        );
        if (!isMatched(result)) {
          state.lost = lostError("The lease was reclaimed by another worker.");
          throw state.lost;
        }
        state.leaseUntil = new Date(instant.getTime() + leaseMs);
      } catch (error) {
        if (error?.code === "REPOSITORY_LOCK_LOST") throw error;
        state.lost = lostError(error);
        throw state.lost;
      }
    }

    let heartbeatPromise = null;
    const heartbeatTimer = setInterval(() => {
      if (heartbeatPromise || state.lost) return;
      heartbeatPromise = renew().catch(() => {}).finally(() => {
        heartbeatPromise = null;
      });
    }, heartbeatMs);
    heartbeatTimer.unref?.();

    try {
      return await lockContext.run(state, async () => {
        await state.assertOwned();
        const result = await callback(leaseContext);
        await state.assertOwned();
        return result;
      });
    } catch (error) {
      if (state.lost) throw state.lost;
      throw error;
    } finally {
      clearInterval(heartbeatTimer);
      if (heartbeatPromise) await heartbeatPromise;
      try {
        // Release by owner + fence; retain the row and its monotonic counter.
        await model.updateOne(
          {_id: repositoryId, ownerToken, fence},
          {
            $set: {leaseUntil: new Date(0), releasedAt: now()},
            $unset: {ownerToken: "", heartbeatAt: ""}
          }
        );
      } catch {
        // A failed release is safe: the lease expires and another worker can recover it.
      }
    }
  }

  return async function withRepositoryLock(id, callback) {
    const repositoryId = String(id || "");
    if (!/^[a-f0-9]{24}$/i.test(repositoryId)) {
      throw new AppError(400, "INVALID_REPOSITORY_ID", "Invalid repository identifier.");
    }
    if (typeof callback !== "function") throw new TypeError("A repository lock callback is required.");

    const parent = lockContext.getStore();
    if (parent?.repositoryId === repositoryId) {
      await parent.assertOwned();
      return callback({
        repositoryId,
        ownerToken: parent.ownerToken,
        fence: parent.fence,
        assertOwned: () => parent.assertOwned()
      });
    }
    return executeWithLease(repositoryId, callback);
  };
}

export async function assertRepositoryLease(repositoryId) {
  const context = lockContext.getStore();
  if (!context) return null;
  if (repositoryId && String(repositoryId) !== context.repositoryId) {
    throw new AppError(
      409,
      "REPOSITORY_LOCK_CONTEXT_MISMATCH",
      "A Git command attempted to access a repository outside its active lock."
    );
  }
  return context.assertOwned();
}
