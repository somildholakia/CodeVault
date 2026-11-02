import PullRequest from "../models/PullRequest.js";
import {AppError} from "../utils/errors.js";

export function assertPullRequestOpen(pullRequest, action = "changed") {
  if (pullRequest?.status === "merging") {
    throw new AppError(409, "PULL_REQUEST_BUSY", "A merge is already in progress for this pull request.");
  }
  if (pullRequest?.status !== "open") {
    throw new AppError(409, "PULL_REQUEST_CLOSED", "Only open pull requests can be " + action + ".");
  }
}

export async function claimPullRequestMerge(id, model = PullRequest, now = new Date()) {
  const claimed = await model.findOneAndUpdate(
    {_id: id, status: "open"},
    {$set: {status: "merging", mergeStartedAt: now}},
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
    {$set: {status: "merged", ...fields}, $unset: {mergeStartedAt: ""}},
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
    {$set: {status: "open"}, $unset: {mergeStartedAt: ""}}
  );
}
