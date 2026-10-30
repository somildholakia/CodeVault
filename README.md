# CodeVault

A version-control and collaboration workspace for student development teams. CodeVault combines a React interface, Express REST API, MongoDB application metadata and real Git repositories.

## Stack

- React 18, Vite, React Router, Tailwind CSS v4 and Lucide.
- Node.js 20+, Express, Zod validation, bcrypt password hashing and signed HTTP-only JWT session cookies.
- MongoDB + Mongoose for user accounts, repository metadata, collaborators, issues and activity.
- Git CLI invoked with Node's execFile argument arrays for native commits, refs, file trees, diffs and merges.
- Vercel frontend and Render API. Git data requires durable storage.

## Implemented core workflows

Registration, login, logout and profile updates; repository creation with a real initial Git commit; repository visibility and owner/collaborator checks; file browsing, commit history and diffs; branch creation and merge previews; collaborator roles; issue creation, updates and comments; activity history and Git-derived analytics; responsive workspace UI and Git Learning Mode.

Pull-request review records, releases/tags, source archives, notification delivery, full-text search and a browser conflict editor remain future work.

## Local setup

Requirements: Node.js 20.11+, npm, Git 2.30+ and MongoDB.
1. Copy .env.example to .env.
2. Set MONGODB_URI and a random JWT_SECRET of at least 32 characters.
3. Run npm install from the repository root.
4. Run npm run dev.
5. Open http://localhost:5173. API health: http://localhost:4000/api/health.

Do not commit secrets. No sample users, commits or metrics are seeded.

## Deployment

Vercel root directory: client. Build: npm run build. Output: dist.
The Vercel rewrite proxies /api/* to Render, keeping browser API requests same-origin.
Render builds with npm install --workspace=server and starts with npm run start --workspace=server.

Configure MONGODB_URI, JWT_SECRET and CLIENT_ORIGIN in Render. Set REPO_STORAGE_PATH to an attached durable volume and set REPO_STORAGE_DURABLE=true only after verifying that volume. Repository writes remain blocked in production until durable Git storage is enabled. The existing free Render service does not prove that a persistent disk is attached.

## Verification and limitations

Git engine tests use temporary repositories and exercise real Git initialization, branch creation, file commits, diffs, merges and invalid path/ref rejection. GitHub Actions runs the frontend build and backend tests. Only report passing tests after a workflow has completed successfully.

This is a student-project foundation, not a production-hosted Git service. The filesystem engine currently uses a shared worktree and an in-process lock; multi-instance operation needs isolated worktrees or a distributed lock. Add backup/restore drills and security review before hosting private source code.
