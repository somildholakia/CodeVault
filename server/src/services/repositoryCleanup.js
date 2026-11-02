import Collaborator from "../models/Collaborator.js";
import Issue from "../models/Issue.js";
import Release from "../models/Release.js";
import PullRequest from "../models/PullRequest.js";
import BranchProtection from "../models/BranchProtection.js";
import Activity from "../models/Activity.js";
import SequenceCounter from "../models/SequenceCounter.js";

const defaultModels = {
  Collaborator,
  Issue,
  Release,
  PullRequest,
  BranchProtection,
  Activity,
  SequenceCounter
};

export async function purgeRepositoryRecords(repositoryId, models = defaultModels) {
  const id = String(repositoryId || "");
  const counters = ["issue:" + id, "pull_request:" + id];

  await Promise.all([
    models.Collaborator.deleteMany({repository: repositoryId}),
    models.Issue.deleteMany({repository: repositoryId}),
    models.Release.deleteMany({repository: repositoryId}),
    models.PullRequest.deleteMany({repository: repositoryId}),
    models.BranchProtection.deleteMany({repository: repositoryId}),
    models.Activity.deleteMany({repository: repositoryId}),
    models.SequenceCounter.deleteMany({_id: {$in: counters}})
  ]);
}
