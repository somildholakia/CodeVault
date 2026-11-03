# CodeVault

A version-control and collaboration workspace for student development teams. CodeVault combines a React interface, an Express REST API, MongoDB application metadata and real Git repositories.

## Stack

- React 18, Vite, React Router, Tailwind CSS v4 and Lucide.
- Node.js 20+, Express, Zod validation, bcrypt password hashing and signed HTTP-only session cookies.
- MongoDB + Mongoose for accounts, repository metadata, collaborators, issues, pull requests, reviews, activity and cross-worker repository leases with monotonic fencing tokens.
- Git CLI invoked through Node's execFile argument arrays for native commits, refs, file trees, diffs and merges.
- Vercel frontend and Render API. Git data requires a durable backend disk.

## Implemented workflows

- Registration, login, logout and profile updates.
- Repository creation with a real initial Git commit, README, .gitignore and MIT license option.
- Owner/collaborator-authorized portable Git bundle downloads, verified before streaming, covering committed branches and tags with a SHA-256 checksum.
- Owner-confirmed repository deletion serialized against Git writes, with dependent issues, pull requests, branch rules, collaborators, activity and number counters purged.
- Public/private repository metadata and server-side owner/collaborator permission checks.
- File browsing, in-browser text editing, commit creation, history and commit diffs.
- Branch creation, merge preview, conflict detection and guarded native Git merge.
- Repository-wide literal code search across committed text on any branch, with bounded results and permission checks.
- Repository-scoped issues with status, priority, comments and collaborator assignment.
- Atomic repository-scoped numbering for issues and pull requests, plus a database uniqueness rule preventing duplicate open pull requests for the same branch pair.
- Workspace-wide issue inbox with safe text search, status/priority filters, personal scopes and pagination.
- Release publishing with annotated Git tags, version notes and tag history.
- Interactive commit DAG across branches, with parent/child navigation, read-only historical snapshots and commit-to-commit diffs.
- Safe commit revert that appends an inverse commit without rewriting branch history.
- Create branches from any selected commit; delete only merged branches while protecting the default branch.
- Per-file history (including rename following) and line-level Git blame for any selected ref.
- Inline pull-request review threads anchored to changed lines, with resolve/reopen controls.
- Three-way merge conflict editor with base/target/source panes, manual resolution, stale-head checks and isolated merge commits.
- Branch protection rules with wildcard patterns, pull-request requirements, approval thresholds, stale-approval dismissal, resolved-thread gates and protected deletion.
- Repository contribution heatmaps, author rankings and changed-file activity computed from actual Git history.
- Workspace overview commit activity is aggregated using one bounded parallel Git date scan per tracked repository, without truncating each repository to its latest 100 commits.
- npm dependency inventory and lockfile-based OSV vulnerability scans, with explicit lockfile-required status when exact versions are unavailable.
- Collaborator roles: owner, maintainer, developer and viewer.
- Persisted pull requests with source/target refs, review decisions, an independent-approval merge gate, merge commit reference and activity records.
- Atomic pull-request merge claiming: review submissions, inline comments, thread resolution and closure use conditional writes and cannot race a merge already in progress. The branch-pair uniqueness constraint covers both open and merging states, and a Git-completed merge is never reopened if database finalization fails.
- Crash-safe pull-request merge recovery: claims pin the reviewed source SHA, target SHA and initiating user; a maintainer can reconcile an old claim after a five-minute grace period. Recovery reads Git refs/ancestry under the repository lock, finalizes only a proven merge, reopens only when the target is unchanged, and preserves ambiguous states without replaying a merge.
- Cross-worker repository coordination: MongoDB lease documents, monotonic fencing tokens, automatic heartbeats and lease ownership checks before/after native Git commands.
- Activity history, Git-derived analytics and a short Git Learning Mode.
- Responsive, warm-paper workspace UI and Vercel same-origin API proxy.

## Project structure

- `website/` — standalone product, documentation and source-download site (static HTML/CSS/JS; separately deployable).
- `client/` — React/Vite browser app.
- `server/src/models/` — Mongoose account, repository, issue, collaborator, activity, pull-request and repository-lock schemas.
- `server/src/routes/` — authenticated REST endpoints.
- `server/src/services/git.js` — filesystem-backed native Git operations.
- `server/src/services/sequences.js` — atomic issue and pull-request numbering.
- `server/src/services/repositoryCleanup.js` — repository-scoped dependent-record cleanup.
- `server/src/services/repositoryLock.js` — MongoDB lease, heartbeat, fencing and ownership validation.
- `server/src/services/git.js` — verified Git bundle snapshots for portable repository backup and restore.
- `server/test/` — temporary Git repository, cross-worker lease contention/recovery/fencing, review-policy, cookie-policy, request-origin, concurrent sequence-allocation, reviewed-source merge, pull-request lifecycle, repository-cleanup and full-history activity tests.
- `docs/` — architecture, API, diagrams and final-year project report draft.

Remote automated backup retention, a provider-backed Git storage service and external notifications remain future work. The current manual Git bundle download is portable, but it does not create an off-site backup automatically. Exact-version npm vulnerability checks require a committed supported lockfile; multi-instance distributed Git locking still requires additional production hardening.

## Product website

The standalone CodeVault product website lives in `website/`. The public site is live at https://codevault-site.vercel.app. It includes direct source ZIP/tar.gz links for this feature branch and a link to GitHub Releases. These archives are source code, not desktop installers. It explains the product workflows, links to the public source ZIP/tarball and documents the current setup path. It is intentionally a separate static site and can be deployed as its own Vercel project with root directory `website` and output directory `public`. No desktop installer is currently published.

## Local setup

Requirements: Node.js 20.11+, npm, Git 2.30+ and MongoDB.

1. Copy `.env.example` to `.env`.
2. Set `MONGODB_URI` and a random `JWT_SECRET` of at least 32 characters.
3. Run `npm install` from the repository root.
4. Run `npm run dev`.
5. Open `http://localhost:5173`. API health: `http://localhost:4000/api/health`.

Do not commit secrets. No demo users, fake commits or fabricated metrics are seeded.

## Deployment

Vercel root directory: `client`. Build: `npm run build`. Output: `dist`. The Vercel rewrite proxies `/api/*` to Render, keeping browser requests same-origin.
Render builds with `npm install --workspace=server` and starts with `npm run start --workspace=server`.

Configure `MONGODB_URI`, `JWT_SECRET` and the exact browser frontend origin in `CLIENT_ORIGIN` on Render. For a Vercel frontend and Render API on different sites, set `COOKIE_SAME_SITE=none`; production automatically marks the session cookie Secure and HttpOnly. Keep the CORS origin list exact (comma-separated for multiple trusted origins), never use a wildcard with credentialed cookies. Cookie-authenticated state-changing requests must include an allowed Origin; originless API clients should use bearer authentication.

Set `REPO_STORAGE_PATH` to an attached durable volume and set `REPO_STORAGE_DURABLE=true` only after verifying that volume. Repository writes deliberately remain blocked in production until durable Git storage is enabled. Repository locks use MongoDB leases by default (`REPO_LOCK_LEASE_MS=120000`, `REPO_LOCK_HEARTBEAT_MS=25000`, `REPO_LOCK_WAIT_MS=15000`); keep the lease longer than the maximum single Git command and the heartbeat well below the lease.

The checked-in Render blueprint currently uses the Free plan and sets `REPO_STORAGE_DURABLE=false`, so production Git writes are intentionally disabled. Render Free services use ephemeral filesystems and do not support persistent disks. A Render persistent disk requires a paid service and restricts that service to one instance; horizontal scaling therefore needs an external shared filesystem or a dedicated Git storage service. Do not enable the durable-storage flag on the current Free blueprint.

## Verification and limitations

Git engine tests use temporary repositories and exercise real Git initialization, branch creation, file commits, diffs, clean merges, conflict previews, invalid path/ref rejection and Git bundle backup/clone-restore integrity, including branch/tag preservation and backup size limits. Pull-request review-policy tests check independent approvals and change-request blocking. Authentication cookie and request-origin policy tests cover production cross-site cookie attributes and cookie-authenticated mutation origins. GitHub Actions runs the frontend production build, backend syntax validation, backend tests and product website tests.

The Git service uses one shared worktree per repository and MongoDB-backed leases with monotonically increasing fencing tokens. A lease is reclaimed only after expiry; heartbeats renew it, and each native Git command checks the current owner/fence before and after execution. This coordinates API workers only when they use the same MongoDB database and the same shared repository volume. Separate per-instance disks are not coordinated by MongoDB and must not be used for multi-instance Git writes. Before scale-out, verify shared-volume semantics and crash recovery, then complete backup/restore drills, quota enforcement and an independent security review.

### Dependency security scanning

CodeVault can scan exact resolved versions from npm lockfiles and exact pinned Python requirements (`package==version`) against OSV. Unpinned ranges, environment-marker requirements, editable installs and VCS references are not treated as exact resolved versions. A missing lockfile or unsupported manifest is reported explicitly rather than described as vulnerability-free.


## Continuing development

For the current branch checkpoint, latest verified CI, next recommended task and continuation instructions, see [PROJECT_HANDOFF.md](./PROJECT_HANDOFF.md). Update this handoff at every meaningful checkpoint so work can resume in another chat.
