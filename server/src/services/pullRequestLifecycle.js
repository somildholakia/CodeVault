import PullRequest from "../models/PullRequest.js";
import {AppError} from "../utils/errors.js";

export const MERGE_RECOVERY_GRACE_MS = 5 * 60 * 1000;
const COMMIT_SHA = /^[a-f0-9]{40}$/i;

export function assertPullRequestOpen(pullRequest, action = "changed") {
  if (pullRequest?.status === "merging") {
    throw new AppError(409, "PULL_REQUEST_BUSY", "A merge is already in progress for this pull request.");
  }
  if (pullRequest?.status !== "open") {
    throw new AppError(409, "PULL_REQUEST_CLOSED", "Only open pull requests can be " + action + ".");
  }
}

export async function claimPullRequestMerge(id, pins, model = PullRequest, now = new Date()) {
  if (!pins || !COMMIT_SHA.test(pins.sourceSha || "") || !COMMIT_SHA.test(pins.targetSha || "")) {
    throw new AppError(400, "MERGE_SNAPSHOT_REQUIRED", "Both source and target commit SHAs are required to claim a pull-request merge.");
  }
  const claimed = await model.findOneAndUpdate(
    {_id: id, status: "open"},
    {$set: {
      status: "merging",
      mergeStartedAt: now,
      mergeSourceSha: pins.sourceSha,
      mergeTargetSha: pins.targetSha,
      mergeClaimedBy: pins.claimedBy || null
    }},
    {new: true}
  );
  if (!claimed) {
    throw new AppError(409, "PULL_REQUEST_BUSY", "This pull request is no longer open or another merge has already claimed it.");
  }
  return claimed;
}

export async function completePullRequestMerge(id, fields, model = PullRequest) {
  const completed = await model.findOneAndUpdate(
    {_id: id, status: "merging"},
    {
      $set: {status: "merged", ...fields},
      $unset: {
        mergeStartedAt: "",
        mergeSourceSha: "",
        mergeTargetSha: "",
        mergeClaimedBy: ""
      }
    },
    {new: true}
  );
  if (!completed) {
    throw new AppError(409, "PULL_REQUEST_STATE_CHANGED", "The pull-request merge state changed before completion.");
  }
  return completed;
}

export async function releasePullRequestMerge(id, model = PullRequest) {
  return model.updateOne(
    {_id: id, status: "merging"},
    {
      $set: {status: "open"},
      $unset: {
        mergeStartedAt: "",
        mergeSourceSha: "",
        mergeTargetSha: "",
        mergeClaimedBy: ""
      }
    }
  );
}

export async function reconcilePullRequestMerge(
  id,
  inspectGit,
  model = PullRequest,
  now = new Date(),
  staleAfterMs = MERGE_RECOVERY_GRACE_MS
) {
  if (typeof inspectGit !== "function") {
    throw new AppError(500, "MERGE_INSPECTOR_REQUIRED", "A Git ancestry inspector is required for merge recovery.");
  }

  const current = await model.findOne({_id: id, status: "merging"});
  if (!current) {
    throw new AppError(409, "PULL_REQUEST_STATE_CHANGED", "This pull request no longer has an active merge claim.");
  }

  const startedAt = current.mergeStartedAt ? new Date(current.mergeStartedAt) : null;
  if (!startedAt || Number.isNaN(startedAt.getTime())) {
    throw new AppError(409, "PULL_REQUEST_MERGE_AMBIGUOUS", "The merge claim has no trustworthy start time; its state was preserved for manual recovery.");
  }
  if (now.getTime() - startedAt.getTime() < staleAfterMs) {
    throw new AppError(409, "PULL_REQUEST_MERGE_NOT_STALE", "The merge claim is still within its recovery grace period.");
  }

  const sourceSha = current.mergeSourceSha;
  const targetSha = current.mergeTargetSha;
  if (!COMMIT_SHA.test(sourceSha || "") || !COMMIT_SHA.test(targetSha || "")) {
    throw new AppError(409, "PULL_REQUEST_MERGE_AMBIGUOUS", "The merge claim is missing its pinned source or target SHA; its state was preserved for manual recovery.");
  }

  let inspection;
  try {
    inspection = await inspectGit({
      sourceBranch: current.sourceBranch,
      targetBranch: current.targetBranch,
      sourceSha,
      targetSha
    });
  } catch (error) {
    throw new AppError(409, "PULL_REQUEST_MERGE_AMBIGUOUS", "Git state could not be verified. The pull request remains in merging state.", {
      cause: String(error?.message || error).slice(0, 500)
    });
  }

  const filter = {
    _id: id,
    status: "merging",
    mergeStartedAt: current.mergeStartedAt,
    mergeSourceSha: sourceSha,
    mergeTargetSha: targetSha,
    mergeClaimedBy: current.mergeClaimedBy || null
  };

  if (inspection?.state === "completed" && COMMIT_SHA.test(inspection.mergeCommit || "")) {
    const completed = await model.findOneAndUpdate(
      filter,
      {
        $set: {
          status: "merged",
          mergeCommit: inspection.mergeCommit,
          mergedBy: current.mergeClaimedBy || null,
          mergedAt: now
        },
        $unset: {
          mergeStartedAt: "",
          mergeSourceSha: "",
          mergeTargetSha: "",
          mergeClaimedBy: ""
        }
      },
      {new: true}
    );
    if (!completed) {
      throw new AppError(409, "PULL_REQUEST_STATE_CHANGED", "The pull-request merge claim changed during recovery.");
    }
    return {
      state: "merged",
      mergeCommit: inspection.mergeCommit,
      mergedBy: current.mergeClaimedBy || null,
      pullRequest: completed
    };
  }

  if (inspection?.state === "not_completed") {
    const reopened = await model.findOneAndUpdate(
      filter,
      {
        $set: {status: "open"},
        $unset: {
          mergeStartedAt: "",
          mergeSourceSha: "",
          mergeTargetSha: "",
          mergeClaimedBy: ""
        }
      },
      {new: true}
    );
    if (!reopened) {
      throw new AppError(409, "PULL_REQUEST_STATE_CHANGED", "The pull-request merge claim changed during recovery.");
    }
    return {state: "reopened", pullRequest: reopened};
  }

  throw new AppError(
    409,
    "PULL_REQUEST_MERGE_AMBIGUOUS",
    "Git refs do not prove whether the merge completed. The pull request remains in merging state.",
    {reason: String(inspection?.reason || "Git ancestry is inconclusive.").slice(0, 500)}
  );
}
