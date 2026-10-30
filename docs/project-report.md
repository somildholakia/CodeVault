# CodeVault — Final-year B.Sc. Computer Science project report (draft)

## Abstract

CodeVault is a web-based version-control and collaboration platform for student development teams. It combines native Git repositories with application-level collaboration features, including accounts, repository permissions, issues, pull requests, independent reviews and activity history. The user interface is built with React and Vite, the API uses Node.js and Express, MongoDB stores application metadata, and Git stores actual source history. The project aims to reduce context switching while making commits, branches, diffs and review decisions easier to learn and demonstrate.

## Problem statement

Student teams often keep source code, tasks and review decisions in disconnected places. New developers may struggle to understand branch history, merge conflicts and collaborative review. A compact workspace that joins Git-native history with project metadata can provide a more coherent educational development workflow.

## Objectives

1. Use real Git repositories rather than simulated commit records.
2. Build a modular React, Express and MongoDB application.
3. Enforce repository and role permissions on the API.
4. Provide file browsing, text commits, commit history, diffs, branch creation and merge previews.
5. Add project issues, collaborator roles and review-gated pull requests.
6. Derive dashboard metrics from real Git history and application records.
7. Provide architecture, API, test and deployment documentation suitable for an undergraduate viva.

## Scope

Implemented scope includes authentication, repository metadata, Git file and history operations, branch creation/merge, issues, collaborator roles, pull requests/reviews, activity and analytics. Future extensions include release/tag management, source archives, notifications, full-text code search, inline diff review comments, and a browser-based conflict editor.

## Proposed system

The client is a React single-page application. Express validates requests, verifies signed HTTP-only sessions and authorizes repository operations. MongoDB stores account, membership, issue, pull-request and activity records. The Git service creates a repository directory per repository identifier and delegates object/history operations to native Git. Vercel hosts the static client, while Render hosts the Node API. Git data is stored on a persistent backend volume.

## Functional requirements

- Account registration, sign-in and sign-out.
- Create public/private repositories with an initial README commit.
- Enforce owner, maintainer, developer and viewer roles.
- Browse committed files; edit text files and create commits.
- Inspect commit history and diffs.
- Create branches, preview merges and reject conflict cases.
- Create issues, update status, assign members and discuss work.
- Add existing CodeVault users as repository collaborators.
- Open pull requests between branches, review another member's PR, require independent approval, and merge when clean.
- View activity and analytics derived from actual data.

## Non-functional requirements

Security, validation, readable error states, responsive layout, keyboard focus indicators, secure cookie handling, rate limits on authentication, path traversal protection, bounded text-file size, durable storage, data backup and test evidence.

## Data design

User, Repository, Collaborator, Issue, PullRequest and Activity are Mongoose models. A pull request stores repository, number, title, author, source/target branches, status, review decisions, merge commit and timestamps. Git objects are maintained by Git and not duplicated in MongoDB.

## Architecture and diagrams

See [architecture.md](architecture.md) and [diagrams.md](diagrams.md) for component, data-flow, sequence, ER and permission-flow diagrams. See [api.md](api.md) for endpoint contracts and role requirements.

## Testing strategy

The Git engine tests create isolated temporary directories and exercise repository initialization, initial commit, branch creation, text-file commits, content reads, diffs, clean merges, conflict previews and path/ref validation. Pull-request review policy tests verify that author self-approval does not count, an independent approval is required and a requested-changes review blocks merging.

The GitHub Actions workflow runs frontend production build and backend unit tests for pushes and pull requests to main. Record exact workflow links, timestamps and outcomes only after each run completes. Integration tests with a live MongoDB database, full browser acceptance tests and backup/restore rehearsals are still required.

## Installation manual

1. Install Node.js 20.11+, npm and Git.
2. Create a MongoDB database.
3. Copy `.env.example` to `.env` and configure `MONGODB_URI` and a random 32+ character `JWT_SECRET`.
4. Run `npm install` at the repository root.
5. Run `npm run dev`.
6. Open `http://localhost:5173`; API health is `http://localhost:4000/api/health`.

## Deployment and limitations

Vercel hosts the client; Render hosts the API. Set the backend environment variables and attach durable storage for Git repositories before enabling repository writes. A free Render service without a persistent disk is not suitable for lasting Git data. The current shared Git worktree and process-local lock are single-instance design choices; multi-instance use needs isolated worktrees or a distributed lock. Database connectivity, persistent storage, full browser acceptance and backup/restore must be verified before the application can be called production-ready.

## Conclusion

CodeVault demonstrates the separation between Git-native version history and application-level collaboration data. It provides practical exercises for repository operations and a review workflow with an auditable approval gate. Final evaluation should be based on a live demonstration, verified tests and captured deployment evidence rather than unverified feature claims.

## References

- Git documentation: https://git-scm.com/docs
- Node.js: https://nodejs.org/docs
- Express: https://expressjs.com/
- MongoDB Manual: https://www.mongodb.com/docs/manual/
- Mongoose: https://mongoosejs.com/docs/
- React: https://react.dev/
- Vite: https://vite.dev/guide/
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
