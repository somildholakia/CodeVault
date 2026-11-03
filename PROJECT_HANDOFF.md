# CodeVault — continuation handoff

Last verified: 2026-11-03 (Asia/Kolkata)

## Canonical project state

- Repository: https://github.com/somildholakia/CodeVault
- Product website: https://codevault-site.vercel.app
- Active branch: `feat/global-issue-tracker`
- Pull request: https://github.com/somildholakia/CodeVault/pull/1
- PR base: `main`
- PR status: open, not merged
- Latest branch head: `18fdbf418b5bffa55c605b8a3926d2a3b927b0bc`
- Keep all further implementation on `feat/global-issue-tracker`. Do not merge PR #1 or push changes to `main` unless Somil explicitly asks.

## Latest completed change — portable Git bundle backups

Checkpoint `18fdbf4` — authenticated, verified repository backup downloads.

- Added `GET /api/repositories/:id/backup`, available to repository readers through the normal server-side permission check.
- Snapshot generation is serialized with the repository MongoDB lease and uses `git bundle create --all`, so every committed branch and tag is included.
- Every generated bundle is verified with `git bundle verify` before the server streams it.
- The server calculates SHA-256 and returns it in `X-Content-SHA256`; `X-Git-Ref-Count` reports the number of advertised refs.
- The response is `application/x-git-bundle`, private/no-store and streamed from a temporary file. Temporary files are removed after successful transfer, client disconnect or stream failure.
- Backup size is limited by `MAX_REPOSITORY_BACKUP_SIZE_MB` (default 500 MiB; accepted configuration range 1–2048 MiB). Oversized bundles return `BACKUP_TOO_LARGE` / HTTP 413 and the temporary file is removed.
- The endpoint is rate-limited to 3 downloads per IP per 15 minutes.
- Added a repository-page **Download Git backup** action.
- Added tests for bundle checksum/ref metadata, restoring all refs into a fresh bare Git repository with `git bundle unbundle` plus explicit `git update-ref`, creating a working clone and rejecting oversized bundles.
- Documented restore steps in `README.md`, `docs/api.md` and `docs/architecture.md`.

This is a manual portable backup/download path only. It is not scheduled or off-site retention; someone must download and securely store the bundle outside the Render service.

## Latest verified CI

Both workflows passed against branch head `18fdbf418b5bffa55c605b8a3926d2a3b927b0bc`:

- Push CI #250: https://github.com/somildholakia/CodeVault/actions/runs/41573027517
- PR CI #251: https://github.com/somildholakia/CodeVault/actions/runs/41573032098
- Backend tests: 108 passed, 0 failed.
- Product website tests: 7 passed, 0 failed.
- Frontend production build: passed.
- Backend JavaScript syntax validation: passed.
- Git bundle restore-integrity and backup size-limit tests: passed.

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
- Portable verified Git bundle downloads with checksum metadata and size/rate limits.
- Releases, persisted activity, contribution heatmaps and repository analytics.
- npm lockfile and exact-pinned Python dependency scanning against OSV.
- Separate static product website and source archive links.

For full feature inventory and local setup details, see `README.md`.

## Next recommended engineering task

Design a provider-neutral Git storage adapter or dedicated Git storage service that can replace Render's instance-local disk without weakening Git ref-update atomicity. Evaluate shared-volume semantics versus a remote bare-repository service/object storage; define repository identity, authorization handoff, ref compare-and-swap, bundle import/export and failure recovery contracts before implementing a provider. Add crash-injection, backup/restore and concurrent-ref-update integration tests. Do not enable multi-instance writes on separate local disks, add paid infrastructure or deploy a new service without Somil's explicit approval.

## Working rules for the next chat

1. Start by reading this file and the current `README.md`.
2. Re-fetch the current branch ref, PR #1 metadata and latest Actions runs before editing.
3. Inspect the actual current route, model, lease service, Git service and tests; do not rely solely on this summary.
4. Make focused changes, add regression tests, run the full test/build/syntax checks and wait for GitHub Actions.
5. Push commits to `feat/global-issue-tracker`, update PR #1 with new work and verification, and update this handoff at every checkpoint.
6. Report the exact new commit SHA, CI results and PR status.
7. Never merge PR #1 or change `main` without explicit permission. Never claim production readiness only because CI passes.
