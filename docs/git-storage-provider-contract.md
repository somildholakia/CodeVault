# Git storage provider contract

Status: design specification; no provider is selected or enabled by this document.

## Decision summary

CodeVault must stop treating a web-process filesystem as the permanent home of Git repositories before enabling production writes or adding API instances.

**Preferred next implementation:** a dedicated Git storage service that owns bare repositories on one durable storage domain. The CodeVault API remains the authentication and product-metadata boundary; the storage service becomes the only process allowed to mutate Git refs and objects.

A shared filesystem can be a valid adapter only when its provider explicitly guarantees cross-host atomic file creation/rename and lock semantics compatible with Git's ref transactions. A generic object bucket mounted with a FUSE layer is not accepted as a shared Git filesystem without those guarantees.

Object storage is appropriate for immutable backup bundles and possibly immutable Git object payloads, but it is not by itself a safe replacement for Git's mutable ref database. Updating a branch requires compare-and-swap semantics and atomic visibility across the ref and its reachable objects.

## Required invariants

1. **Single authority for writes.** Every mutation for a repository is serialized by the storage authority, not merely by a lease held by an API worker.
2. **Atomic ref compare-and-swap.** A ref update supplies the expected old object ID. It succeeds only if the current ref still equals that value; otherwise it returns a conflict and leaves the ref unchanged.
3. **Objects before refs.** All objects reachable from a proposed new ref must be durable and readable before the ref becomes visible.
4. **Monotonic fencing.** Every write session has a monotonically increasing fence/version. The storage authority rejects stale fences even if a caller's MongoDB lease appears valid.
5. **Idempotent retries.** Every mutating request carries an operation ID. Repeating the same operation ID and payload returns the original result; reusing it with a different payload is rejected.
6. **Crash consistency.** A crash before ref publication leaves unreachable objects only; a crash after publication leaves a complete reachable history. Recovery must never guess whether a ref update happened.
7. **Authorization separation.** The API checks the user and repository role, then exchanges a short-lived, repository-scoped service credential. The storage service never accepts a browser-supplied repository path or arbitrary filesystem path.
8. **No silent data loss.** Repository deletion, import, restore and ref mutation are auditable and require explicit expected-state checks.
9. **Read-after-write.** A successful ref update is immediately visible to subsequent reads routed to the same storage authority.
10. **Backups are independently restorable.** A backup records repository identity, creation time, default branch, advertised refs, object format and a checksum manifest; restoration verifies all of them before publishing a repository.

## Provider options

| Option | Strengths | Risks / conditions | Decision |
|---|---|---|---|
| Shared durable filesystem | Minimal change to native Git service; Git already provides ref transaction primitives | Must prove cross-host locking, atomic rename, fsync/durability, mount failure and recovery semantics; one shared volume may constrain scaling | Accept only after provider-specific integration tests |
| Dedicated Git storage service | Centralizes authorization handoff, locking, CAS, quotas, backup and recovery; API workers can be stateless | New service to operate; service availability and protocol become critical | Preferred target |
| Raw object storage as Git filesystem | Cheap durable blobs and easy replication | Generic object stores do not provide Git-compatible filesystem locks or atomic multi-object ref transactions; FUSE does not create those guarantees | Reject as direct filesystem adapter |
| Immutable bundle/object backup store | Portable, verifiable snapshots and off-host recovery | Snapshot cadence, retention, encryption, restore drills and metadata backup remain necessary | Recommended complementary capability |

## Provider-neutral adapter boundary

The API-facing adapter should expose product-level operations rather than paths or shell access:

- `initializeRepository({ repositoryId, defaultBranch, operationId })`
- `readRef({ repositoryId, ref })`
- `listRefs({ repositoryId, namespace })`
- `readTree({ repositoryId, ref, path })`
- `readCommit({ repositoryId, objectId })`
- `createCommit({ repositoryId, branch, expectedHead, tree, message, author, operationId })`
- `createBranch({ repositoryId, name, expectedSource, operationId })`
- `deleteRef({ repositoryId, ref, expectedObjectId, operationId })`
- `mergeRefs({ repositoryId, source, target, expectedSource, expectedTarget, operationId })`
- `exportBundle({ repositoryId, refs, operationId })`
- `importBundle({ repositoryId, bundleStream, expectedManifest, operationId })`
- `verifyRepository({ repositoryId })`
- `deleteRepository({ repositoryId, expectedGeneration, operationId })`

The adapter must not expose an unrestricted `exec(command)`, arbitrary path, or raw credential to route handlers. Native Git may remain an implementation detail inside the dedicated service.

Every mutation response should include `operationId`, `repositoryGeneration`, resulting ref/object IDs where relevant, and a stable result code. Conflicts should include the actual current ref SHA but no private repository data beyond what the caller is authorized to read.

## Proposed remote protocol

All endpoints are service-to-service and require TLS plus a short-lived signed credential containing:

- audience = storage service;
- repository ID;
- allowed operation set;
- CodeVault request/actor ID;
- expiry and unique token ID;
- current fencing token / repository generation.

Suggested protocol:

| Operation | Request preconditions | Success | Conflict / failure |
|---|---|---|---|
| `POST /v1/repos` | Repository ID unused; operation ID unique | Initialized bare repo and generation 1 | 409 if already initialized |
| `GET /v1/repos/:id/refs` | Read permission credential | Ref names and object IDs | 404 for unavailable repo |
| `POST /v1/repos/:id/refs:compare-and-swap` | Ref name, expected old SHA (or explicit absent), new SHA, operation ID, fence | Atomic ref update and incremented generation | 409 if expected SHA/fence stale |
| `POST /v1/repos/:id/bundles` | Authorized ref scope and operation ID | Streamed immutable bundle + SHA-256 manifest | 413 quota; 409 generation changed |
| `POST /v1/repos/:id/imports` | Verified manifest, expected generation, operation ID | Imported objects and atomically published refs | 409 stale generation or duplicate operation |
| `POST /v1/repos/:id/verify` | Read permission | Connectivity and ref-integrity report | 422 integrity failure |
| `DELETE /v1/repos/:id` | Owner-authorized operation, expected generation, operation ID | Tombstoned/deleted repository | 409 if generation changed |

The final URL and wire format may change during implementation. The invariants above are normative.

## Write transaction and crash recovery

For a commit, merge, branch creation or import:

1. API authenticates the user, checks CodeVault role and branch-protection policy, and pins the expected current refs.
2. API creates an operation record with a unique operation ID and sends a short-lived service credential scoped to this repository and operation.
3. Storage authority validates the credential, fence and expected generation; it serializes the operation for this repository.
4. Git objects are written and verified. No ref is visible yet.
5. Storage authority atomically updates each affected ref only if its expected old SHA still matches. Multi-ref operations use Git's ref transaction facility or a journaled equivalent.
6. Storage authority persists the operation result and new repository generation before acknowledging success.
7. API updates MongoDB metadata/activity using the returned operation ID and result. If the API crashes between steps 6 and 7, a retry queries the operation ID and completes metadata finalization without replaying the Git mutation.

Recovery rules:

- Unknown outcome: query operation ID; never blindly repeat a merge or ref update.
- Objects present, refs unchanged: safe unreachable objects may be garbage-collected later.
- Ref changed and operation record committed: return the stored success result.
- Ref changed but operation record is missing/inconsistent: mark repository as needing operator reconciliation; do not automatically roll back or overwrite the ref.
- Backup restore: restore into a new repository generation, verify bundle checksum, object connectivity and ref manifest, then publish the repository as ready.

## Authentication and trust boundary

- Keep browser JWT/session credentials out of the storage service.
- Use a service-to-service identity with short TTL, audience restriction, repository ID and operation scopes.
- Bind the signed request to a body hash and operation ID to prevent credential replay with altered content.
- Enforce repository quotas and request size limits at both API and storage layers.
- Do not log bundle contents, credentials, private file contents or raw authorization headers.
- Treat storage service responses as untrusted until schema-validated by the API.
- Keep MongoDB as the source of user, role, issue, pull-request and activity metadata; Git storage is the source of Git objects and refs.

## Failure and integrity test matrix

Before enabling writes against a provider, automate these tests against the real provider/service, not only an in-memory fake:

- Two API workers concurrently update the same branch with the same expected SHA: exactly one succeeds; the other receives 409.
- A stale worker resumes after its fence expires: every write is rejected by storage authority.
- Kill the storage process before object write, after object write, during ref transaction and immediately after ref commit.
- Kill the API after storage commit but before MongoDB metadata finalization; retry by operation ID must not create a second commit.
- Drop network responses after successful ref publication; retry returns the original result.
- Simulate disk full, read-only remount, unavailable metadata DB, unavailable storage DB and partial bundle upload.
- Verify no ref points to a missing object after every crash point.
- Export, corrupt one byte, and confirm checksum/verification rejects the bundle.
- Restore branches, annotated/lightweight tags and default branch into an empty target; compare all ref SHAs and run `git fsck --connectivity-only`.
- Refuse overwrite of an existing repository and refuse stale-generation deletion.
- Test repository authorization across owner, maintainer, developer, viewer and cross-repository token substitution.
- Exercise retention, quota exhaustion, garbage collection and restore of both Git bundles and MongoDB metadata backups.

## Rollout gates

1. Keep current production writes disabled.
2. Implement the adapter interface behind the existing Git service with a local filesystem adapter first; preserve current route contracts.
3. Add contract tests shared by local and remote adapters.
4. Build the dedicated storage service and run the crash/concurrency suite against a real persistent test volume.
5. Add encrypted off-host bundle retention and MongoDB metadata backup/restore; perform a timed restore drill.
6. Run a shadow read comparison against current Git data, then a controlled migration with verified checksums and ref manifests.
7. Enable writes only after explicit operator approval and a documented rollback plan.

No provider, paid plan, storage bucket, secret, deployment or production configuration is selected or changed by this specification.
