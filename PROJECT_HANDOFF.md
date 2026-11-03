# CodeVault — continuation handoff

Last verified: 2026-11-03 (Asia/Kolkata)

## Canonical project state

- Repository: https://github.com/somildholakia/CodeVault
- Product website: https://codevault-site.vercel.app
- Active branch: `feat/global-issue-tracker`
- Pull request: https://github.com/somildholakia/CodeVault/pull/1
- PR base: `main`
- PR status: open, not merged
- Latest application-code checkpoint: `a5710c1ac8511eb9a02483ce641fb0a88103755f` (provider-facing local Git adapter and contract tests). Latest docs checkpoint before this handoff update: `66d4c8386a85c7af993980e795072bed47ac90a0`. Re-fetch the branch head before editing.
- Keep all further implementation on `feat/global-issue-tracker`. Do not merge PR #1 or push changes to `main` unless Somil explicitly asks.

## Latest completed change — portable Git backup and local restore

Checkpoint `8279b56` — verified bundle downloads plus a safe one-command local restore utility.

- Added authenticated `GET /api/repositories/:id/backup`, authorized through the existing repository-reader permission check.
- Snapshot generation is serialized with the repository MongoDB lease and uses `git bundle create --all`, so every committed branch and tag is included.
- Every generated bundle is checked with `git bundle verify` before delivery.
- The server calculates SHA-256 and returns `X-Content-SHA256`; `X-Git-Ref-Count` reports the advertised ref count.
- The response is `application/x-git-bundle`, private/no-store and streamed from a temporary file. Temporary files are removed after successful transfer, client disconnect or stream failure.
- Backup size is limited by `MAX_REPOSITORY_BACKUP_SIZE_MB` (default 500 MiB; accepted configuration range 1–2048 MiB). Oversized bundles return `BACKUP_TOO_LARGE` / HTTP 413 and the temporary file is removed.
- The endpoint is rate-limited to 3 downloads per IP per 15 minutes.
- Added a repository-page **Download Git backup** action.
- Added `scripts/restore-git-bundle.js` and root command `npm run restore:bundle -- --bundle <file.bundle> --target <new-bare-repo> [--default-branch main]`.
- The restore tool checks the bundle file/size and advertised refs, verifies the bundle, imports objects, recreates branch/tag refs, sets the requested default branch and runs Git connectivity validation. It refuses an existing target and removes an incomplete target if restore fails.
- The tool's restore result contains Git history, branches and tags only. CodeVault users, collaborators, issues, pull requests and activity are separate MongoDB data and are not included in a Git bundle.
- Updated `README.md`, `docs/api.md` and `docs/architecture.md` with download and restore guidance.

This is a manual portable recovery path only. It does not schedule backups or store them off-site automatically; the downloaded bundle must be stored securely outside the Render service.

## Latest verified CI

Both workflows passed against the implementation-equivalent checkpoint `c77086deaa14dc6da98ca41be575ef0e6dea3a4c`:

- Push CI #271: https://github.com/somildholakia/CodeVault/actions/runs/41574039634 — passed.
- PR CI #272: https://github.com/somildholakia/CodeVault/actions/runs/41574046199 — passed.
- Backend tests: 109 passed, 0 failed.
- Product website tests: 7 passed, 0 failed.
- Frontend production build: passed.
- Backend JavaScript syntax validation: passed.
- Git bundle restore-integrity, restore CLI and existing-target protection tests: passed.

These results cover the latest application-code checkpoint `8279b56e53878d2f031c45b91462e97bb4e5e7a4`; documentation-only commits after that checkpoint do not change application behavior. Re-fetch Actions before treating later branch-head runs as current.

## Latest completed change — local Git storage adapter increment

Application-code checkpoint: `a5710c1ac8511eb9a02483ce641fb0a88103755f`.

- Added `server/src/services/gitStorageAdapter.js`, a local filesystem implementation of the provider-facing Git storage boundary.
- Uses native `git update-ref --stdin` transactions with expected-old-object checks for atomic ref create/update/delete.
- Adds a monotonic observed repository generation backed by a SHA-256 digest of the sorted ref map. The next adapter generation read detects legacy direct-Git ref changes and advances the observed generation, so stale expected generations are rejected.
- Uses operation IDs bound to request payload hashes. Replaying the same operation returns the committed result; reusing an ID with a different payload is rejected.
- Stores durable operation journal/state in `.codevault-state/<repositoryId>` next to, but outside, `.git`; internal state is not exported in repository bundles.
- On recovery, prepared operations are reconciled against the before/after ref values: all-after is finalized, all-before is marked aborted, and mixed state fails closed for operator reconciliation.
- Bundle import verifies the bundle, imports objects first, validates object targets and then atomically publishes refs. Export produces a verified bundle with size/hash/ref metadata. Repository verification runs `git fsck --full --connectivity-only`.
- Adapter subprocesses re-check the active MongoDB repository lease before and after execution. The adapter does not replace MongoDB coordination or make separate local disks safe for multi-instance deployment.
- Integrated the adapter into `git.js` for repository path resolution, atomic branch creation/deletion and portable backup export. Import and verification adapter methods are exposed at the service layer; most commit/merge/revert/tag operations remain on the existing direct Git paths and are not yet fully migrated.
- Added `server/test/gitStorageAdapter.test.js`: CAS, operation-ID idempotency, stale generation/fence rejection, independent adapter concurrency, interrupted-operation recovery, bundle import/export, ref-drift detection, service delegation, lease-loss guard and expected-SHA deletion tests.
- Updated README and architecture docs. No remote provider was built, no production writes were enabled, and no Render/Vercel deployment or paid service was changed.

## Latest verified CI

Both GitHub Actions workflows passed against implementation-equivalent commit `ae4619274b0689fbec17b9cd64e33f90979420fb` (which includes application-code checkpoint `a5710c1`):

- Push CI #319: https://github.com/somildholakia/CodeVault/actions/runs/41577215316 — passed.
- PR CI #320: https://github.com/somildholakia/CodeVault/actions/runs/41577220736 — passed.
- Backend tests: 120 passed, 0 failed.
- Product website tests: 7 passed, 0 failed.
- Frontend production build and backend JavaScript syntax validation: passed.
- These are GitHub Actions results. Separate Vercel status contexts still report `build-rate-limit`; treat those as external deployment-check failures, not passing builds.

## Production storage topology — do not change without explicit approval

The connected Render account was inspected on 2026-11-03:

- Service: `codevault-api`
- Plan: Free
- Instances: 1
- Configured branch: `main`
- Region: Singapore
- URL: https://codevault-api-9k1a.onrender.com

The checked-in `render.yaml` declares the Free plan and `REPO_STORAGE_DURABLE=false`. Render Free does not provide persistent disks; its filesystem is ephemeral. Render's persistent disks require a paid service and pin that service to one instance. Consequently:

- Keep production Git writes disabled on the current Render Free service.
- Do not enable `REPO_STORAGE_DURABLE=true` on the current service.
- MongoDB leases coordinate writers only when they access the same repository volume; they do not replicate Git objects between separate disks.
- Do not claim that the current Render deployment is durable or horizontally scalable.
- Multi-instance Git writes require an externally shared durable filesystem with compatible Git locking semantics, or a dedicated Git storage service.
- No paid infrastructure was provisioned and no production service was redeployed for this checkpoint.

## Implemented feature areas

- React/Vite client, Express API, MongoDB metadata and filesystem-backed native Git.
- Authentication, session cookies, exact-origin enforcement and bearer-token API support.
- Repository creation, roles, collaborators, safe deletion and dependent-record cleanup.
- Repository browser/editor, commits, branches, tags, history, diffs, blame and historical snapshots.
- Visual commit DAG, safe revert, branch protection and three-way conflict resolution.
- Workspace-wide issue inbox, discussions and atomic issue numbering.
- Pull requests, inline review threads, independent approval gates, immutable reviewed-source SHA validation and conservative interrupted-merge reconciliation.
- MongoDB cross-worker repository leases, heartbeats and fencing tokens.
- Production Git-write gate shared by repository mutations and pull-request merges.
- Portable Git bundle downloads, checksum metadata, download size/rate controls and a local restore CLI.
- Releases, persisted activity, contribution heatmaps and repository analytics.
- npm lockfile and exact-pinned Python dependency scanning against OSV.
- Separate static product website and source archive links.

For full feature inventory and local setup details, see `README.md`.

## Latest checkpoint — provider-neutral Git storage contract (design only)

- Added `docs/git-storage-provider-contract.md` with provider comparison, required invariants, adapter boundary, proposed remote API, service-to-service auth model, ref compare-and-swap, idempotent operations, crash recovery, test matrix and rollout gates.
- Decision recorded: prefer a dedicated Git storage service as the long-term target. A shared filesystem is acceptable only after provider-specific atomicity/locking tests. Generic object storage or a FUSE mount is not a safe Git filesystem by assumption; object storage is suitable for immutable bundles/backups.
- Updated `README.md` and `docs/architecture.md` to link and summarize the contract.
- This checkpoint is documentation/design only: no application code, provider, bucket, paid plan, secret, production config or deployment was changed.
- Existing PR CI #274 passed on the preceding restore-utility checkpoint (109 backend tests, 7 website tests, frontend build and syntax checks). Current Vercel status contexts on that checkpoint report `build-rate-limit` failures; those are external deployment checks, not GitHub Actions CI failures. Re-check current checks before the next implementation.

## Next recommended engineering task

Continue migrating existing Git mutation paths to the adapter while preserving current API behavior. Start with file commits using a Git-object pipeline (`hash-object`, `mktree`, `commit-tree`) followed by expected-head CAS, and add crash-injection tests around object persistence, journal preparation and ref publication. Then migrate merge/revert/tag paths carefully. Add sidecar state cleanup to repository deletion and expand adapter contract tests. Do not expose the adapter as a public API or enable production writes yet. Keep remote service/provider selection and deployment behind explicit approval.

## Working rules for the next chat

1. Start by reading this file, the current `README.md` and `docs/git-storage-provider-contract.md`.
2. Re-fetch the current branch ref, PR #1 metadata and latest Actions runs before editing.
3. Inspect the actual current route, model, lease service, Git service, restore script and tests; do not rely solely on this summary.
4. Make focused changes, add regression tests, run the full test/build/syntax checks and wait for GitHub Actions.
5. Push commits to `feat/global-issue-tracker`, update PR #1 with new work and verification, and update this handoff at every checkpoint.
6. Report the exact new commit SHA, CI results and PR status.
7. Never merge PR #1 or change `main` without explicit permission. Never claim production readiness only because CI passes.
