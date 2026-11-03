# CodeVault — continuation handoff

Last verified: 2026-11-03 (Asia/Kolkata)

## Canonical project state

- Repository: https://github.com/somildholakia/CodeVault
- Product website: https://codevault-site.vercel.app
- Active branch: `feat/global-issue-tracker`
- Pull request: https://github.com/somildholakia/CodeVault/pull/1
- PR base: `main`
- PR status: open, not merged
- Latest code checkpoint: `6eef5e95bf68afc24f7ae8e73da2ddc671c49612`
- Keep all further implementation on `feat/global-issue-tracker`. Do not merge PR #1 or push changes to `main` unless Somil explicitly asks.

## Latest completed change

Checkpoint `6eef5e9` — MongoDB-backed repository leases, storage-topology documentation and production Git-write gating.

- Replaced the process-local-only repository mutex with an atomic MongoDB lease per repository id.
- Each lease acquisition increments a persistent fencing counter. Release expires the lease but retains the counter, so a future owner receives a higher fence.
- Lease heartbeats renew ownership; lost/unavailable coordination fails closed with `REPOSITORY_LOCK_LOST`, `REPOSITORY_LOCK_UNAVAILABLE` or `REPOSITORY_LOCK_BUSY`.
- Native Git commands verify the current lock owner/fence before and after execution. Repository initialization and rollback, file writes and repository deletion also assert ownership around filesystem mutations.
- Added independent-worker tests for serialization, monotonic fencing, expired-lease recovery, stale-owner rejection, heartbeats, fail-closed database errors and nested same-repository operations.
- Centralized the production durable-storage gate in `server/src/utils/repositoryStorage.js`.
- PR merge now checks the same gate as the repository Git-write routes; production PR merges are blocked until durable Git storage is explicitly enabled.
- API health uses the same storage-readiness check.
- Added tests confirming production Git writes are denied unless `REPO_STORAGE_DURABLE=true` is explicit.
- Added `REPO_LOCK_LEASE_MS`, `REPO_LOCK_HEARTBEAT_MS` and `REPO_LOCK_WAIT_MS` configuration examples.
- Updated `README.md` and `docs/architecture.md` with MongoDB lease behavior and the Render storage limitations.

## Latest verified CI

Both workflows passed against code head `6eef5e95bf68afc24f7ae8e73da2ddc671c49612`:

- Push CI #195: https://github.com/somildholakia/CodeVault/actions/runs/41571012293
- PR CI #196: https://github.com/somildholakia/CodeVault/actions/runs/41571016418
- Backend tests: 106 passed, 0 failed.
- Product website tests: 7 passed, 0 failed.
- Frontend production build: passed.
- Backend JavaScript syntax validation: passed.

Both workflow jobs completed successfully.

## Actual Render topology checked

The connected Render account was inspected on 2026-11-03:

- Service: `codevault-api`
- Plan: Free
- Instances: 1
- Configured branch: `main`
- Region: Singapore
- URL: https://codevault-api-9k1a.onrender.com

The checked-in `render.yaml` also declares the Free plan and `REPO_STORAGE_DURABLE=false`. Render Free does not provide persistent disks; its filesystem is ephemeral. Render's persistent disks require a paid service and pin that service to one instance. Consequently:

- Keep production Git writes disabled on the current Render Free service.
- The MongoDB lease coordinates workers only when they access the same repository volume; it does not replicate Git data between separate disks.
- Do not claim that the current Render deployment is durable or horizontally scalable.
- Enabling multi-instance Git writes requires an externally shared durable filesystem with compatible Git locking semantics, or a dedicated Git storage service.

## Implemented feature areas

- React/Vite client, Express API, MongoDB metadata and filesystem-backed native Git.
- Authentication, session cookies, exact-origin enforcement and bearer-token API support.
- Repository creation, roles, collaborators, safe deletion and dependent-record cleanup.
- Repository browser/editor, commits, branches, tags, history, diffs, blame and historical snapshots.
- Visual commit DAG, safe revert, branch protection and three-way conflict resolution.
- Workspace-wide issue inbox, discussions and atomic issue numbering.
- Pull requests, inline review threads, independent approval gates and immutable reviewed-source SHA validation.
- Pull-request merge crash recovery with conservative stale-claim reconciliation.
- MongoDB cross-worker repository leases, heartbeats and fencing tokens.
- Production Git-write gate shared by repository and pull-request merge routes.
- Releases, persisted activity, contribution heatmaps and repository analytics.
- npm lockfile and exact-pinned Python dependency scanning against OSV.
- Separate static product website and source archive links.

For full feature inventory, setup and deployment details, see `README.md`.

## Next recommended engineering task

Design a durable Git storage topology that works independently of Render's single-instance disk limitation. Evaluate a dedicated Git storage service or an object-backed/remote bare-repository design with safe ref updates, then add worker-kill, restore and integrity tests. Do not enable multi-instance Git writes on separate local disks and do not enable paid infrastructure without Somil's approval.

## Working rules for the next chat

1. Start by reading this file and the current `README.md`.
2. Re-fetch the current branch ref, PR #1 metadata and latest Actions runs before editing.
3. Inspect the actual current route, model, lease service, Git service and tests; do not rely solely on this summary.
4. Make focused changes, add regression tests, run the full test/build/syntax checks and wait for GitHub Actions.
5. Push commits to `feat/global-issue-tracker`, update PR #1 with new work and verification, and update this handoff at every checkpoint.
6. Report the exact new commit SHA, CI results and PR status.
7. Never merge PR #1 or change `main` without explicit permission. Never claim production readiness only because CI passes.
