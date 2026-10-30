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
- Repository-scoped issues with status, priority, comments and assignment-ready schema.
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

Releases/tags, source archives, notifications, full-text code search, inline review comments and an in-browser conflict editor remain future work.

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
