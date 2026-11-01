# CodeVault REST API

Base path: `/api`. All successful endpoints return JSON. Errors use `{ "error": { "code": "...", "message": "..." } }`. Authentication is an HTTP-only JWT cookie. Mutating browser requests must originate from `CLIENT_ORIGIN`.

## Authentication

| Method | Endpoint | Access |
|---|---|---|
| POST | `/auth/register` | Public, rate limited |
| POST | `/auth/login` | Public, rate limited |
| POST | `/auth/logout` | Public/idempotent |
| GET | `/auth/me` | Signed in |
| PATCH | `/auth/profile` | Own profile |

Registration body: `{ username, displayName, email, password }`. Passwords are bcrypt hashed; minimum length is 10 characters.

## Repositories and Git

| Method | Endpoint | Access |
|---|---|---|
| GET | `/repositories` | Signed in |
| POST | `/repositories` | Signed in; requires durable Git storage in production |
| GET | `/repositories/:id` | Owner/collaborator or public repository |
| GET | `/repositories/:id/files?ref=main` | Repository reader |
| GET | `/repositories/:id/search?q=term&ref=main&limit=100` | Repository reader; tracked text files only |
| GET | `/repositories/:id/releases` | Repository reader; includes published releases and Git tags |
| POST | `/repositories/:id/releases` | Owner/maintainer; requires durable Git storage in production |
| GET | `/repositories/:id/files/content?ref=main&path=README.md` | Repository reader |
| GET | `/repositories/:id/commits?ref=main&limit=50` | Repository reader |
| GET | `/repositories/:id/graph?ref=all&limit=100` | Repository reader; returns commit DAG, parents, branches and tags |
| GET | `/repositories/:id/compare?base=SHA&target=SHA` | Repository reader; compares two Git commits |
| GET | `/repositories/:id/commits/:sha/diff` | Repository reader |
| GET | `/repositories/:id/branches` | Repository reader |
| POST | `/repositories/:id/branches` | Owner/maintainer/developer |
| POST | `/repositories/:id/commits` | Owner/maintainer/developer |
| POST | `/repositories/:id/merge-preview` | Repository reader |
| POST | `/repositories/:id/merge` | Owner/maintainer |
| POST | `/repositories/:id/collaborators` | Owner/maintainer |
| GET | `/repositories/:id/collaborators` | Repository reader |
| DELETE | `/repositories/:id` | Owner only; exact-name confirmation |

File-commit body: `{ branch, path, content, message }`. Branch-create body: `{ name, base? }`. The graph endpoint accepts `ref=all` or a branch name and `limit=1–200`. Commit comparison accepts two existing commit SHAs or refs in `base` and `target`. Merge body: `{ source, target, expectedHead? }`. Code search uses a fixed-string query (`q`, 1–100 characters), an optional Git ref and a result limit of 1–200; binary files and uncommitted working files are excluded. Release publishing body: `{ name, tagName, notes, targetBranch }`; publishing creates an annotated Git tag and persists release metadata.

## Issues

| Method | Endpoint | Access |
|---|---|---|
| GET | `/issues?status=open&priority=high&scope=assigned&search=term&page=1&limit=20` | Signed in; owned and accepted-collaborator repositories only |
| GET | `/repositories/:id/issues?status=open` | Repository reader |
| POST | `/repositories/:id/issues` | Owner/maintainer/developer |
| GET | `/issues/:issueId` | Repository reader |
| PATCH | `/issues/:issueId` | Owner/maintainer/developer |
| POST | `/issues/:issueId/comments` | Repository reader |

Issue status is `open` or `closed`; priority is low, medium, high or critical.

## Pull requests and reviews

| Method | Endpoint | Access |
|---|---|---|
| GET | `/pull-requests` | Signed in; lists pull requests in accessible repositories |
| POST | `/pull-requests` | Owner/maintainer/developer |
| GET | `/pull-requests/:id` | Repository reader |
| POST | `/pull-requests/:id/reviews` | Repository reader other than the PR author |
| POST | `/pull-requests/:id/close` | PR author, owner or maintainer |
| POST | `/pull-requests/:id/merge` | Owner/maintainer, with independent approval and no outstanding change request |

Create body: `{ repositoryId, title, description, sourceBranch, targetBranch }`. Review body: `{ decision, body }`, where decision is `approved`, `changes_requested` or `commented`. A PR cannot merge until at least one non-author collaborator approves it; any outstanding `changes_requested` review blocks merge. Merge also runs native Git conflict detection.

## Analytics and activity

| Method | Endpoint | Access |
|---|---|---|
| GET | `/analytics/overview` | Signed in |
| GET | `/activity` | Signed in |
| GET | `/health` | Public |

Common status codes: 200 success, 201 created, 204 deleted/logged out, 400 invalid input, 401 missing/invalid session, 403 insufficient permission, 404 missing or hidden resource, 409 duplicate/conflicting state, 413 payload too large, 429 rate limit, 503 missing database or durable-storage configuration.

This document describes the routes in source. A successful HTTP response from production must be checked after MongoDB and persistent Git storage are configured.
