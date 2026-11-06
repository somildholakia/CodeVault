# CodeVault REST API

Base path: `/api`. Successful API endpoints return JSON except the repository backup download, which returns a binary Git bundle. Errors use `{ "error": { "code": "...", "message": "..." } }`. Authentication is an HTTP-only JWT cookie. Mutating browser requests must originate from `CLIENT_ORIGIN`.

## Authentication

| Method | Endpoint | Access |
|---|---|---|
| POST | `/auth/register` | Public, rate limited |
| POST | `/auth/login` | Public, rate limited |
| POST | `/auth/logout` | Public/idempotent |
| GET | `/auth/me` | Signed in |
| PATCH | `/auth/profile` | Own profile |

Registration body: `{ username, displayName, email, password }`. Passwords are bcrypt hashed; minimum length is 10 characters.

## Repositories and Git

| Method | Endpoint | Access |
|---|---|---|
| GET | `/repositories` | Signed in |
| POST | `/repositories` | Signed in; requires durable Git storage in production |
| GET | `/repositories/:id` | Owner/collaborator or public repository |
| GET | `/repositories/:id/backup` | Repository reader; streams a verified Git bundle containing committed branches and tags; limited to 3 downloads per 15 minutes per IP |
| GET | `/repositories/:id/files?ref=main` | Repository reader |
| GET | `/repositories/:id/search?q=term&ref=main&limit=100` | Repository reader; tracked text files only |
| GET | `/repositories/:id/insights?ref=all&days=90` | Repository reader; real Git contribution and file activity |
| GET | `/repositories/:id/dependencies?ref=main` | Repository reader; npm lockfile inventory and OSV vulnerability scan |
| GET | `/repositories/:id/releases` | Repository reader; includes published releases and Git tags |
| POST | `/repositories/:id/releases` | Owner/maintainer; requires durable Git storage in production |
| GET | `/repositories/:id/files/content?ref=main&path=README.md` | Repository reader |
| GET | `/repositories/:id/files/history?ref=main&path=README.md&limit=50` | Repository reader; follows file renames |
| GET | `/repositories/:id/files/blame?ref=main&path=README.md` | Repository reader; line-level commit attribution |
| GET | `/repositories/:id/commits?ref=main&limit=50` | Repository reader |
| GET | `/repositories/:id/graph?ref=all&limit=100` | Repository reader; returns commit DAG, parents, branches and tags |
| GET | `/repositories/:id/compare?base=SHA&target=SHA` | Repository reader; compares two Git commits |
| GET | `/repositories/:id/commits/:sha/diff` | Repository reader |
| GET | `/repositories/:id/branches` | Repository reader |
| GET | `/repositories/:id/branch-protection?branch=main` | Repository reader |
| PUT | `/repositories/:id/branch-protection` | Owner/maintainer; create or update a pattern rule |
| DELETE | `/repositories/:id/branch-protection` | Owner/maintainer; exact pattern in request body |
| POST | `/repositories/:id/branches` | Owner/maintainer/developer |
| DELETE | `/repositories/:id/branches` | Owner/maintainer/developer; protects default and unmerged branches |
| POST | `/repositories/:id/commits` | Owner/maintainer/developer |
| POST | `/repositories/:id/revert` | Owner/maintainer/developer; requires durable Git storage |
| POST | `/repositories/:id/merge-preview` | Repository reader; returns base/ours/theirs for text conflicts |
| POST | `/repositories/:id/merge` | Owner/maintainer; conflict-free merges |
| POST | `/repositories/:id/merge-resolve` | Owner/maintainer; applies pinned text conflict resolutions |
| POST | `/repositories/:id/collaborators` | Owner/maintainer |
| GET | `/repositories/:id/collaborators` | Repository reader |
| DELETE | `/repositories/:id` | Owner only; exact-name confirmation |

Dependency scanning reads committed `package-lock.json` or `npm-shrinkwrap.json` files and queries exact resolved npm package versions against OSV.dev. When no supported lockfile exists, it returns a manifest inventory with `status=lockfile_required` and does not claim that dependencies are clean. The current scanner supports npm lockfile versions with resolved package entries and caps each scan at 500 package versions. Contribution insights accept `ref=all` or an existing branch and `days=7–365`; they return daily non-merge commit counts, contributor rankings and changed-file line totals from native Git history. Branch protection rules accept `{ pattern, requirePullRequest, requiredApprovals, requireResolvedConversations, dismissStaleApprovals, preventDeletion }`; branch patterns support `*` and `?`, with the most specific matching rule selected. Defaults are pull-request required, one approval, resolved conversations required, stale approvals dismissed and branch deletion prevented. Direct commits, reverts and branch merges are blocked on protected branches requiring pull requests. PR reviews are recorded against the exact source SHA; stale approvals do not count when configured. Protected PR merges can require multiple independent approvals and all inline conversations to be resolved. File-commit body: `{ branch, path, content, message }`. Branch-create body: `{ name, base? }`; `base` accepts a branch, tag or full commit SHA. Safe branch deletion body: `{ name, expectedHead }`; CodeVault checks the expected branch head, switches the repository worktree to the protected default branch, and uses non-forced Git branch deletion so unmerged work is preserved. Per-file history and blame use the selected ref and repository-relative path. The graph endpoint accepts `ref=all` or a branch name and `limit=1–200`. Commit comparison accepts two existing commit SHAs or refs in `base` and `target`. Merge body: `{ source, target, expectedHead?, expectedSourceSha?, operationId? }`. Clients performing retries should reuse the same operation ID and both pinned SHAs. Merge preview returns a pinned `sourceSha`, `targetHead` and per-file `base`, `ours`, `theirs` and conflict-marker text for supported text conflicts. Conflict resolution body: `{ source, target, expectedHead, expectedSourceSha, resolutions: [{ path, content, delete? }], operationId? }`; it runs the merge in an isolated shared-object clone, checks that both branch heads and the conflict set are unchanged, verifies all conflicts are resolved, creates a real two-parent merge commit and atomically advances the target ref. Binary, symlink, submodule and oversized conflicts are not editable in the text UI. Safe revert body: `{ branch, commitSha, expectedHead, operationId? }`; `operationId` is an optional 8–128 character idempotency key that clients should retain and reuse after a timeout. CodeVault prepares the inverse in an isolated shared-object sandbox, imports and verifies the commit object, then publishes through journaled adapter compare-and-swap with expected-head, generation and lease-fence checks. The commit carries a payload-bound operation trailer so retries after object persistence or a lost response reuse the same commit; the adapter reconciles a prepared journal if a process stops immediately after ref publication. The API continues to reject stale branch heads, unrelated commits, root commits and merge commits without explicit mainline support, and it retains the dirty-worktree guard. It does not rewrite history. Code search uses a fixed-string query (`q`, 1–100 characters), an optional Git ref and a result limit of 1–200; binary files and uncommitted working files are excluded. Release publishing body: `{ name, tagName, notes, targetBranch }`; publishing creates an annotated Git tag and persists release metadata.

Repository backups are created from `git bundle create --all` while holding the repository lease, verified before delivery, size-limited by `MAX_REPOSITORY_BACKUP_SIZE_MB` (default 500 MiB), and streamed as `application/x-git-bundle`. The response includes `X-Content-SHA256` and `X-Git-Ref-Count`; the temporary snapshot is removed after the download finishes or fails. The bundle contains committed refs only, not uncommitted working-tree changes. Downloaded bundles can be restored locally with `npm run restore:bundle -- --bundle /path/to/repository.bundle --target /path/to/restored.git --default-branch main`, followed by `git clone /path/to/restored.git working-copy`. The target must not already exist. The CLI verifies the bundle, imports its objects, reconstructs each advertised branch/tag ref, sets the default branch and checks object connectivity. Restore includes Git history only, not CodeVault's MongoDB metadata. This manual download is a portable recovery artifact, not automated off-site backup retention.
## Issues

| Method | Endpoint | Access |
|---|---|---|
| GET | `/issues?status=open&priority=high&scope=assigned&search=term&page=1&limit=20` | Signed in; owned and accepted-collaborator repositories only |
| GET | `/repositories/:id/issues?status=open` | Repository reader |
| POST | `/repositories/:id/issues` | Owner/maintainer/developer |
| GET | `/issues/:issueId` | Repository reader |
| PATCH | `/issues/:issueId` | Owner/maintainer/developer |
| POST | `/issues/:issueId/comments` | Repository reader |

Issue status is `open` or `closed`; priority is low, medium, high or critical. The global list and issue-detail responses also include `canWrite` for the current user; viewer-only collaborators and public readers receive `false`. Clients should use this hint to hide mutation controls, while the API remains authoritative. Issue comments are available to repository readers.

## Pull requests and reviews

| Method | Endpoint | Access |
|---|---|---|
| GET | `/pull-requests` | Signed in; lists pull requests in accessible repositories |
| POST | `/pull-requests` | Owner/maintainer/developer |
| GET | `/pull-requests/:id` | Repository reader |
| GET | `/pull-requests/:id/diff` | Repository reader; current source-to-target diff |
| POST | `/pull-requests/:id/comments` | Accepted repository member; added lines only |
| PATCH | `/pull-requests/:id/comments/:commentId` | Comment author, owner or maintainer; resolve/reopen |
| POST | `/pull-requests/:id/reviews` | Repository reader other than the PR author |
| POST | `/pull-requests/:id/close` | PR author, owner or maintainer |
| POST | `/pull-requests/:id/merge` | Owner/maintainer, with independent approval and no outstanding change request |
| POST | `/pull-requests/:id/reconcile-merge` | Owner/maintainer; recover a stale merge claim after its five-minute grace period |

Create body: `{ repositoryId, title, description, sourceBranch, targetBranch }`. Review body: `{ decision, body }`, where decision is `approved`, `changes_requested` or `commented`. Inline comment body: `{ path, line, side: "RIGHT", commitSha, body }`; comments must point to an added line in the current diff. Thread resolution body: `{ resolved: true|false }`. A PR cannot merge until at least one non-author collaborator approves it; any outstanding `changes_requested` review blocks merge. Merge also runs native Git conflict detection. Merge claims persist the reviewed source and target SHAs. The reconciliation endpoint does not run Git merge: it only inspects branch refs and ancestry under the repository lock. It finalizes a claim when the pinned source is proven to be in the target history, reopens only when the target is still exactly at its pinned SHA, and otherwise returns `409 PULL_REQUEST_MERGE_AMBIGUOUS` while preserving the `merging` state. Claims younger than five minutes return `409 PULL_REQUEST_MERGE_NOT_STALE`.

## Analytics and activity

| Method | Endpoint | Access |
|---|---|---|
| GET | `/analytics/overview` | Signed in |
| GET | `/activity` | Signed in |
| GET | `/health` | Public |

Common status codes: 200 success, 201 created, 204 deleted/logged out, 400 invalid input, 401 missing/invalid session, 403 insufficient permission, 404 missing or hidden resource, 409 duplicate/conflicting state or repository lock contention/loss, 413 payload too large, 429 rate limit, 503 missing database, unavailable lock coordination or durable-storage configuration. `REPOSITORY_LOCK_BUSY` asks the caller to retry; `REPOSITORY_LOCK_LOST` stops the in-flight request after ownership/fencing validation fails.

This document describes the routes in source. A successful HTTP response from production must be checked after MongoDB and persistent Git storage are configured.


### Dependency security scanning

The scanner supports npm lockfiles and exact pinned Python `requirements*.txt` entries (`package==version`). It sends resolved versions to OSV using npm or PyPI ecosystem identifiers. Unpinned ranges, editable installs and VCS URLs are excluded from exact-version vulnerability checks.


## Storage-adapter merge publication

All merge mutation routes (ordinary branch merge, conflict resolution and pull-request merge) use isolated shared-object-clone preparation. Both source and target branch SHAs are pinned; no shared worktree/index writes occur during preparation. The generated merge commit is checked for its exact two-parent order (target first, source second), tree and operation identity. Its commit object and reachable objects are imported and verified before publication.

Only adapter compare-and-swap publishes the target branch. The adapter's atomic ref transaction verifies the pinned source branch and compares the expected target SHA, while enforcing repository generation, MongoDB lease fencing, stable operation IDs and payload-bound idempotency. Adapter journals recover all-before and all-after states; mixed/ambiguous states block writes for operator reconciliation. Reusing an operation ID with a different payload is rejected, and successful retries return the existing merge commit.

Pull-request authorization, current reviewed-source approval checks, stale-review behavior, resolved-conversation requirements and branch-protection policy remain enforced. A merge claim persists an operation ID with the reviewed source and target SHAs; the same ID and immutable pins are passed to the Git merge operation. Interrupted PR recovery reconciles the adapter journal before checking pinned commit ancestry, finalizing only a proven merge and leaving mixed or ambiguous states in the merging state for operator reconciliation. Retrying a completed operation returns its original merge commit. Production Git writes remain behind the existing configuration gate.
