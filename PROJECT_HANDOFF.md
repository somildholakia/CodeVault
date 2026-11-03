# CodeVault — continuation handoff

Last verified: 2026-11-03 (Asia/Kolkata)

## Canonical project state

- Repository: https://github.com/somildholakia/CodeVault
- Product website: https://codevault-site.vercel.app
- Active branch: `feat/global-issue-tracker`
- Pull request: https://github.com/somildholakia/CodeVault/pull/1
- PR base: `main`
- PR status: open, not merged
- Recovery implementation and documentation checkpoint before this handoff update: `e8e6d21b92645d51e07a31715172c64b1fc8ada4`
- Keep all further implementation on `feat/global-issue-tracker`. Do not merge PR #1 or push changes to `main` unless Somil explicitly asks.

## Latest completed change

Checkpoint e8e6d21 — conservative pull-request merge crash recovery.

- Merge claims now persist the reviewed source SHA, target SHA, start time and initiating user.
- Claims are created while holding the repository Git lock, before mutable review/comment writes are blocked.
- Git recovery inspects both branch refs and pinned commit ancestry. It never executes a merge.
- If the target contains the pinned source commit, recovery finalizes the PR as merged and records the first-parent merge commit (or the pinned target for an already-ancestor no-op).
- If the target is still exactly at the pinned target SHA and both refs/commits are available, recovery safely returns the PR to open.
- Diverged targets, missing refs, missing commit objects and other inconclusive states remain in merging; the endpoint reports a recoverable ambiguity instead of guessing.
- Recovery is available to owners/maintainers through POST /api/pull-requests/:id/reconcile-merge after a five-minute grace period.
- Once a native Git merge has been attempted, ordinary error handling no longer releases the claim blindly.
- Added lifecycle tests and temporary-Git integration tests for completed-before-crash, not-completed, already-ancestor/no-op, target divergence and unavailable source refs.
- Updated README.md and docs/api.md with the recovery behavior and endpoint.

## Latest verified CI

The preceding handoff checkpoint, commit a8de145ad04cd2ce604074bbe053238335299f35, passed CodeVault CI run #156:
- Run: https://github.com/somildholakia/CodeVault/actions/runs/41568046788
- Frontend production build, backend syntax validation, Git/backend test suite and product website tests all passed.

The merge-recovery implementation was pushed in the subsequent checkpoint ending at e8e6d21b92645d51e07a31715172c64b1fc8ada4. Its Actions run must be checked before treating this new behavior as CI-verified. Do not use the prior #156 result as proof for the new code.

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

Replace the process-local repository lock with a durable, cross-process coordination strategy before enabling multi-instance API deployment. The design should use leases/fencing or isolated Git worktrees, prove stale-lock recovery and prevent concurrent writes across processes. Keep durable storage, backup/restore drills and independent security review as explicit production gates.

## Working rules for the next chat

1. Start by reading this file and the current `README.md`.
2. Re-fetch the current branch ref, PR #1 metadata and latest Actions runs before editing.
3. Inspect the actual current route, model, lifecycle service, Git service, lock helper and tests; do not rely solely on this summary.
4. Make focused changes, add regression tests, run the full test/build/syntax checks, and wait for GitHub Actions.
5. Push commits to `feat/global-issue-tracker`, update PR #1 description with the new work and verification, and update this handoff document at each checkpoint.
6. Report the exact new commit SHA, CI run URLs/results, and PR status.
7. Never claim deployment or production readiness merely because CI passes. The app still requires durable Git storage, multi-instance locking strategy, backup/restore drills and independent security review before production use.
