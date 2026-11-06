# CodeVault — continuation handoff

Last verified: 2026-11-06 (Asia/Kolkata)

## Canonical project state

- Repository: https://github.com/somildholakia/CodeVault
- Product website: https://codevault-site.vercel.app
- Active branch: `feat/global-issue-tracker`
- Pull request: https://github.com/somildholakia/CodeVault/pull/1
- PR base: `main`
- PR status: open, not merged
- Latest application-code checkpoint: `a4465a9c35759f4685b0b9b06c80aa6e45b1474b` (adapter-backed file commits, checked-out worktree refresh and Git clean-filter support). Latest verified branch HEAD before this handoff update: `3ab82e2c86c05eef9baabccd83c64f1b08ba5e8e` (includes four new regression tests). Re-fetch the branch head before editing.
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


## Latest completed change — file commits through the Git storage adapter

Application-code checkpoint: `a4465a9c35759f4685b0b9b06c80aa6e45b1474b`; verified branch HEAD before this documentation update: `3ab82e2c86c05eef9baabccd83c64f1b08ba5e8e`.

- Replaced the file-commit path that checked out a branch, wrote into the shared worktree, staged a file and ran `git commit`.
- New file commits write a blob with `git hash-object -w --path=<repo-relative-path>`, applying the repository's configured clean filters without changing the shared index or worktree.
- A temporary `GIT_INDEX_FILE` is initialized from the pinned branch head, updated with the new blob and written as a tree. `git commit-tree` creates a single-parent commit from that exact head.
- The service verifies the parent, then publishes the new branch head through `gitStorageAdapter.compareAndSwapRef`, using the expected old SHA, adapter generation, random operation ID and current MongoDB lease fencing token. Ref/generation conflicts become a safe `BRANCH_MOVED` response.
- The route accepts an optional full `expectedHead`; callers that submit the editor's original head receive a conflict instead of silently committing against a changed branch.
- The service refuses edits to symlink paths, paths through symlink parents, submodules and non-regular target modes. Existing executable-file mode is preserved.
- When the target is already checked out, the service rejects a dirty worktree before publication and refreshes that clean checkout after the CAS. This keeps existing native-Git revert and conflict-resolution paths consistent. Non-active branches are updated without switching the shared checkout.
- Added regression coverage for temporary-index isolation, stale editor-head rejection, executable mode, symlink target/parent rejection, active worktree refresh and `.gitattributes` text normalization.
- No remote storage service was provisioned, no deployment or production setting was changed, and the production Git-write gate remains disabled.

## Latest verified CI

Latest GitHub Actions run against feature-branch HEAD `3ab82e2c86c05eef9baabccd83c64f1b08ba5e8e` (application-code checkpoint `a4465a9c35759f4685b0b9b06c80aa6e45b1474b)):

- CodeVault CI run 42216703723: https://github.com/somildholakia/CodeVault/actions/runs/42216703723 — passed.
- Backend Git engine: 124 passed, 0 failed.
- Product website: 7 passed, 0 failed.
- Frontend production build: passed.
- Backend JavaScript syntax validation: passed.
- Vercel – codevault and Vercel – codevault-site status contexts: both success for this checkpoint.

The CI run includes the file-commit adapter migration and its new regression coverage. Earlier CI failures were used to correct worktree synchronization and a test assertion; this final run is fully green.

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
- Updated README and architecture documentation. No remote provider was built, no production writes were enabled, and no Render/Vercel deployment or paid service was changed.

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

Continue the adapter migration with **single-parent commit reverts**. Keep the current ref pinned, compute the inverse tree in an isolated sandbox/index, create the revert commit object, and publish it with expected-head / generation compare-and-swap. Preserve the existing behavior for root commits, merge commits, unrelated commits, stale heads and conflict responses. Add tests for interruption before object write, after object persistence, after journal preparation and after ref publication, including idempotent retry/recovery. Then migrate merge and annotated-tag writes to the same adapter boundary. Add adapter sidecar-state cleanup to repository deletion and keep expanding the shared contract tests.

Do not enable production Git writes while this is only a local adapter. Shared durable storage or a dedicated Git storage service, distributed fencing verified against that actual provider, full Git + MongoDB backup retention/restore drills, and independent security review remain rollout gates. Keep provider selection, paid infrastructure and deployment behind explicit approval.


Continue migrating existing Git mutation paths to the adapter while preserving current API behavior. Start with file commits using a Git-object pipeline (`hash-object`, `mktree`, `commit-tree`) followed by expected-head CAS, and add crash-injection tests around object persistence, journal preparation and ref publication. Then migrate merge/revert/tag paths carefully. Add sidecar state cleanup to repository deletion and expand adapter contract tests. Do not expose the adapter as a public API or enable production writes yet. Keep remote service/provider selection and deployment behind explicit approval.

## Working rules for the next chat

1. Start by reading this file, the current `README.md` and `docs/git-storage-provider-contract.md`.
2. Re-fetch the current branch ref, PR #1 metadata and latest Actions runs before editing.
3. Inspect the actual current route, model, lease service, Git service, restore script and tests; do not rely solely on this summary.
4. Make focused changes, add regression tests, run the full test/build/syntax checks and wait for GitHub Actions.
5. Push commits to `feat/global-issue-tracker`, update PR #1 with new work and verification, and update this handoff at every checkpoint.
6. Report the exact new commit SHA, CI results and PR status.
7. Never merge PR #1 or change `main` without explicit permission. Never claim production readiness only because CI passes.
