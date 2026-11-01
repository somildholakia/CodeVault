# CodeVault

A version-control and collaboration workspace for student development teams. CodeVault combines a React interface, an Express REST API, MongoDB application metadata and real Git repositories.

## Stack

- React 18, Vite, React Router, Tailwind CSS v4 and Lucide.
- Node.js 20+, Express, Zod validation, bcrypt password hashing and signed HTTP-only session cookies.
- MongoDB + Mongoose for accounts, repository metadata, collaborators, issues, pull requests, reviews and activity.
- Git CLI invoked through Node's `execFile` argument arrays for native commits, refs, file trees, diffs and merges.
- Vercel frontend and Render API. Git data requires a durable backend disk.

## Implemented workflows

- Registration, login, logout and profile updates.
- Repository creation with a real initial Git commit, README, .gitignore and MIT license option.
- Public/private repository metadata and server-side owner/collaborator permission checks.
- File browsing, in-browser text editing, commit creation, history and commit diffs.
- Branch creation, merge preview, conflict detection and guarded native Git merge.
- Repository-wide literal code search across committed text on any branch, with bounded results and permission checks.
- Repository-scoped issues with status, priority, comments and collaborator assignment.
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
- npm dependency inventory and lockfile-based OSV vulnerability scans, with explicit lockfile-required status when exact versions are unavailable.
- Collaborator roles: owner, maintainer, developer and viewer.
- Persisted pull requests with source/target refs, review decisions, an independent-approval merge gate, merge commit reference and activity records.
- Activity history, Git-derived analytics and a short Git Learning Mode.
- Responsive, warm-paper workspace UI and Vercel same-origin API proxy.

## Project structure

- `client/` — React/Vite browser app.
- `server/src/models/` — Mongoose account, repository, issue, collaborator, activity and pull-request schemas.
- `server/src/routes/` — authenticated REST endpoints.
- `server/src/services/git.js` — filesystem-backed native Git operations.
- `server/test/` — real temporary Git repository and pull-request review-policy tests.
- `docs/` — architecture, API, diagrams and final-year project report draft.

Source archives and external notifications remain future work. Exact-version npm vulnerability checks require a committed supported lockfile; multi-instance distributed Git locking still requires additional production hardening.

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

Configure `MONGODB_URI`, `JWT_SECRET` and `CLIENT_ORIGIN` in Render. Set `REPO_STORAGE_PATH` to an attached durable volume and set `REPO_STORAGE_DURABLE=true` only after verifying that volume. Repository writes deliberately remain blocked in production until durable Git storage is enabled.

## Verification and limitations

Git engine tests use temporary repositories and exercise real Git initialization, branch creation, file commits, diffs, clean merges, conflict previews and invalid path/ref rejection. Pull-request review-policy tests check independent approvals and change-request blocking. GitHub Actions runs the frontend production build and backend unit tests.

The current Git service uses a shared worktree and an in-process repository lock. Multi-instance production operation needs isolated worktrees or a distributed lock. Backups, restore drills, rate/abuse limits and a security review are required before storing sensitive source code.


### Dependency security scanning

CodeVault can scan exact resolved versions from npm lockfiles and exact pinned Python requirements (`package==version`) against OSV. Unpinned ranges, environment-marker requirements, editable installs and VCS references are not treated as exact resolved versions. A missing lockfile or unsupported manifest is reported explicitly rather than described as vulnerability-free.
