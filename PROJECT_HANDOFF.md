# CodeVault — continuation handoff

Last verified: 2026-11-03 (Asia/Kolkata)

## Canonical project state

- Repository: https://github.com/somildholakia/CodeVault
- Product website: https://codevault-site.vercel.app
- Active branch: `feat/global-issue-tracker`
- Pull request: https://github.com/somildholakia/CodeVault/pull/1
- PR base: `main`
- PR status: open, not merged
- Last verified branch head before this handoff commit: `68a6a3bb3a0e4ceaf1849e175ba580a8291a8966`
- Keep all further implementation on `feat/global-issue-tracker`. Do not merge PR #1 or push changes to `main` unless Somil explicitly asks.

## Latest completed change

Commit `68a6a3b` — dedicated sign-in and registration rate limits.

- Login: 10 attempts per 15 minutes per IP.
- Registration: 5 attempts per 15 minutes per IP.
- Separate counters and consistent `AUTH_RATE_LIMITED` JSON errors.
- HTTP integration tests cover the limit boundaries.
- Files changed: `server/src/app.js`, `server/test/appSecurity.test.js`, `README.md`.

## Latest verified CI

Both latest-head runs completed successfully on commit `68a6a3bb3a0e4ceaf1849e175ba580a8291a8966`:

- Push CI #153: https://github.com/somildholakia/CodeVault/actions/runs/41389446006
- Pull-request CI #154: https://github.com/somildholakia/CodeVault/actions/runs/41389450280
- Backend tests: 89 passed, 0 failed.
- Product website tests: 7 passed, 0 failed.
- Frontend production build: passed.
- Backend syntax validation: passed.

Re-check the branch head and latest workflow runs before making changes; the branch may have moved since this document was written.

## Implemented feature areas

- React/Vite client, Express API, MongoDB metadata and filesystem-backed native Git.
- Authentication, session cookies, exact-origin enforcement and bearer-token API support.
- Repository creation, access roles, collaborators, safe deletion and dependent-record cleanup.
- Repository browser/editor, commits, branches, tags, history, diffs, blame and historical snapshots.
- Visual commit DAG, safe revert, branch protection and three-way conflict resolution.
- Workspace-wide issue inbox, issue discussions, atomic issue numbering.
- Pull requests, inline review threads, independent approval gates, stale-approval handling, atomic merge claiming and immutable reviewed-source SHA validation.
- Atomic PR numbering and unique active branch-pair constraint.
- Releases, persisted activity, contribution heatmaps, contributor analytics and changed-file analytics.
- npm lockfile and exact-pinned Python dependency scanning against OSV.
- Separate static product/marketing website and source archive links.

For the full feature inventory and local/deployment setup, see `README.md`.

## Next recommended engineering task

Harden pull-request merge crash recovery.

Current lifecycle helpers are in `server/src/services/pullRequestLifecycle.js`:
- `assertPullRequestOpen`
- `claimPullRequestMerge`
- `completePullRequestMerge`
- `releasePullRequestMerge`

The merge route claims a PR as `merging` before running Git and releases it on handled errors. A process crash after the claim can leave the PR in `merging` indefinitely.

Implement safe stale-merge reconciliation. Do not blindly reopen stale merges and do not automatically perform a merge during recovery. Persist the reviewed source SHA and target SHA with the claim; under the repository Git lock, inspect Git ancestry/ref state. If the target contains the pinned source commit, finalize the PR as merged. If the merge demonstrably did not occur, safely return it to open. If Git state is ambiguous or refs are unavailable, preserve the merging state and report a clear recoverable error. Add lifecycle unit tests and real temporary-Git integration tests for completed-before-crash, not-completed, already-ancestor/no-op, and ambiguous-ref cases.

## Working rules for the next chat

1. Start by reading this file and the current `README.md`.
2. Re-fetch the current branch ref, PR #1 metadata and latest Actions runs before editing.
3. Inspect the actual current route, model, lifecycle service, Git service, lock helper and tests; do not rely solely on this summary.
4. Make focused changes, add regression tests, run the full test/build/syntax checks, and wait for GitHub Actions.
5. Push commits to `feat/global-issue-tracker`, update PR #1 description with the new work and verification, and update this handoff document at each checkpoint.
6. Report the exact new commit SHA, CI run URLs/results, and PR status.
7. Never claim deployment or production readiness merely because CI passes. The app still requires durable Git storage, multi-instance locking strategy, backup/restore drills and independent security review before production use.
