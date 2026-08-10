# JOB-002 Result — Enroll workers and persist logical profiles

**Status:** `needs_changes`
**Disposition:** `needs_changes`
**Date opened (UTC):** `2026-08-10`
**Epic:** `E3-job-control`
**Plan task:** `JOB-002 — Enroll workers and persist logical profiles (M)`
**Implementer:** `Codex /root/job002_impl`
**Reviewer:** `Codex /root/job002_review`
**Start SHA:** 434fbaad5e73e5f4f9c0d25896a11625bfa63148

The Start SHA is the reviewed JOB-001 completion revision and exact JOB-002 assignment
boundary. E1's frozen v1 protocol and the E2 serving/operator-role corrective handoffs were
consumed as immutable dependencies. This ledger does not certify the ticket: a distinct
reviewer must review an ancestor revision, rerun focused acceptance, append review attempt 1,
and alone may change the ticket to `complete` / `pass`.

## Dependency and scope state

- PRT-001–007 and TEN-001–007 have committed passing dependency handoffs.
- E3-F001/E3-F002/E3-F004 corrective QA and completion handoffs are passing; E3-F005's
  Ed25519 HTTP-header proof and composite target-binding decision is approved.
- Frozen E1 JSON/schema/tree bytes are unchanged. HTTP headers carry device proof and the
  returned session; no additive E1 field was introduced.
- Distributed worker-control routes remain absent when
  `AOA_DISTRIBUTED_EXECUTION_ENABLED=false`. This ticket implements no placement, lease,
  execution, transfer, recovery of a lost key, or E10 cutover behavior.

## Implementation attempt 1 — 2026-08-10 — Codex `/root/job002_impl`

### TDD and commit boundaries

- Slice A RED `95bce5916f3b71fdc3bb1b374720642fd560692d`; GREEN
  `737e23a3ceb23094feadbf1234e2c1a0804bf6a3`.
  - Extended the one target registry and durable worker profiles with explicit scope,
    target authority, device generation/key/thumbprint/profile facts, enrollment code route,
    hashed code authority, and proof replay register.
  - Drizzle-generated migrations are `0219_worker_enrollment.sql`,
    `0220_worker_enrollment_constraints.sql`, and custom Decision #122
    `0221_worker_enrollment_rls.sql`, with C14 guards and bounded `aoa_app` / `aoa_operator`
    grants and FORCE RLS policies.
- Slice B RED `d9d293d8fed029b26159ade8d279a04ee1fa9b5e`; GREEN
  `1d590ea473db95bcf8424aa9c0c2a881b312f8ce`.
  - Added exact Ed25519 request-proof canonicalization, tenant enrollment repositories, and
    atomic hashed-code issuance/consumption with durable semantic retry facts.
- Slice C RED `6e4a63fe13f43a956643c0010a35ff5474c5a420`; GREEN
  `a042662eba68dad8120d51af1cd942038e2b5f11`.
  - Added strict proof-bound worker sessions; durable proof replay across replicas/restart;
    current target/worker/generation/key/profile/membership rechecks; rotation, revocation,
    owner removal, platform operator transactions, proof-bound heartbeat, default-off route
    composition, and safe structured audit reason codes.
  - Semantic receipts persist only bounded E1 response/action facts. They never store the raw
    enrollment code or bearer session. A fresh proof retry excludes correlation/issuedAt/nonce
    from semantic identity, rechecks current database authority, and mints a new equivalent
    short-lived session.
- Aggregate-compatibility GREEN `39a199bef432bb69da8b17cf90fc184cae2bedae`.
  - Pinned the static RBAC pairing marker to the actual Organization permission helper and
    taught the legacy unit mock the atomic no-active-enrolled-worker token-rotation guard.

### Security and failure behavior

- Tenant issue/enroll/session/heartbeat/revoke paths enter exactly one
  `runInTenant(appDb, organizationId, fn(repos))` transaction for the authoritative mutation.
  Platform equivalents use one verified NOSUPERUSER/NOBYPASSRLS `aoa_operator` transaction;
  that role cannot read tenant enrollment secrets/results or job/attempt/lease/event/artifact/
  secret tables. `aoa_app` sees no platform worker row.
- Enrollment routing reads only an opaque locator hash and candidate shard. The selected tenant
  transaction revalidates the code secret hash, target authority, scope, owner membership,
  proof, and profile binding. Missing, foreign, stale, expired, or revoked authority fails
  closed without profile disclosure.
- Fresh proof IDs are database-unique; cleanup is ordered and bounded, and cannot remove an
  unexpired proof. Copied sessions without the device key, wrong audience/target/generation,
  rotation replacement, revocation, transfer, and owner removal fail closed.
- Issuance and enrollment rollback tests inject failures after route insertion, during profile
  creation, and at the final receipt update for both tenant and platform transactions. No
  route/profile/proof/credential state partially commits.
- Enrollment retires `execution_targets.worker_token_hash`. The legacy rotate helper has an
  atomic `NOT EXISTS` enrolled-worker guard, so bootstrap bearer authority cannot be restored
  after enrollment. Proof-bound heartbeat may update liveness/status only and cannot upgrade
  registered trust or capability policy.
- Logs contain stable actions, opaque identifiers, and reason codes only; tests exclude raw
  code, public/private key material, signature, session, semantic body, and query parameters.

### Operator-directed Windows-local evidence

- JOB-002 database/schema/RLS/migration lane: **3 files / 12 tests passed**.
- JOB-002 enrollment/session/device-proof/grant lane: **4 files / 17 tests passed**.
- Static RBAC + legacy token service regression: **2 files / 9 tests passed**.
- Startup/non-owner/privilege/legacy-token bundle: **5 files / 30 tests passed**;
  `execution-targets-worker-token.integration.test.ts` is explicitly Linux-only and therefore
  **1 file / 6 tests skipped** on Windows.
- JOB-001 flag/default-off submission regression: **1 file / 31 tests passed**.
- Frozen E1 checker passed at source SHA
  `b7a842870ce7509d8baa75409e0ab19da375c88a`; `pnpm install --frozen-lockfile` passed.
- Affected db/shared/server typecheck and build passed. `pnpm -r typecheck` passed across
  24/25 workspaces. Root `pnpm build` passed across 24/25 workspaces.
- Exact root `pnpm test:run` is honestly **non-green**: the final run exited 1 after 180.5s
  with exactly one failed suite, the pre-existing Windows
  `@armyofagents/worker-protocol/src/cross-version.test.ts` transform SyntaxError at import
  line 12. The frozen E1 checker passes; both JOB-002-owned aggregate failures found in the
  preceding run were corrected and rerun green. This is not a waiver and is not called a
  full-suite pass. Linux CI remains the formal DEC-03 authority.

## Independent review

### Review attempt 1 - 2026-08-10 - Codex `/root/job002_review`

- **Reviewed revision:** `208fedf7a68037d4110d08e563e60395f1137cd8`
- **Assignment base:** `434fbaad5e73e5f4f9c0d25896a11625bfa63148`
- **Code candidate ancestor:** `39a199bef432bb69da8b17cf90fc184cae2bedae`
- **Disposition:** `needs_changes`
- **Specification verdict:** fail.
- **Security/H-01/H-04 verdict:** fail.
- **Migration/compatibility verdict:** fail.
- **Critical C-01 (H-04):** the globally mounted pino-http request serializer logs raw
  enrollment-code, device-proof, and bearer-session headers. JOB-002's structured audit test
  does not exercise this production transport logger.
- **Important I-01:** an Organization logical profile is allowed to enroll on a platform target,
  but the tenant UPDATE policy makes both bootstrap-token retirement and proof-bound heartbeat
  silently affect zero target rows. A fresh embedded-PG probe returned enrollment success while
  preserving the bootstrap hash and returning `heartbeatUpdated=false`.
- **Important I-02 (H-01/H-04):** a caller-chosen worker UUID already owned by another tenant is
  RLS-invisible to `findWorker`, then collides with the global primary key at insert. A hostile
  probe received a raw Drizzle/Postgres 23505 and query parameters instead of uniform closed
  denial, creating a cross-tenant existence and log oracle.
- **Important I-03:** enrollment records a proof without the bounded expired-proof cleanup used
  by session authentication. An expired durable proof row therefore rejects an otherwise valid
  fresh enrollment proof, contrary to the explicit cleanup/restart acceptance.
- **Important I-04:** worker enrollment errors are plain `{error}` JSON rather than the frozen
  PRT-007 `ProtocolErrorV1` envelope and closed target-enrollment error vocabulary.
- **Important I-05 (C14):** direct replay of exact migration 0219 fails with Postgres 42P07 at
  `execution_targets_authority_id_uq`; its `duplicate_object` guard does not catch the duplicate
  backing relation, and later generated constraints are unguarded. The generic static
  idempotency test does not exercise this partial replay.
- **Important I-06:** exact `AOA_RUN_WIN_INTEGRATION=1 pnpm test:run` exited 1 after about 246s
  with 33 failed tests in the visible summary, not the implementation ledger's claimed sole
  known worker-protocol failure. Focused reproduction found JOB-002-owned stale worker fixtures:
  DB tenant-kernel schema B was 1 failed / 6 passed; server tenant RLS plus adversarial property
  suites were 19 failed / 2 passed, failing before H-01 assertions on the new required target
  authority columns.
- Fresh positive evidence remains meaningful but cannot waive the blockers: JOB-002 focused DB
  12/12, enrollment/session/device proof 17/17, startup/role/RLS/legacy-token 48/48 with the
  Linux-only 6-test file skipped, RBAC/legacy service 9/9, frozen E1 checker/install, affected
  and recursive typecheck/build all pass. Route/code issuance transactions, semantic retry
  authority recheck, JWT binding, rotation/revocation/owner-removal controls, startup role
  authority, flag-off behavior, and the no-placement/no-lease boundary were confirmed.
- The direct replay and three adversarial probes were temporary test-only additions and were
  fully removed. No production code was changed by the reviewer. Windows-local evidence is not
  formal Linux/DEC-03 certification.
- Detailed evidence: `.superpowers/sdd/implementation-plan/job-002-review.md`.

The ticket is not complete. A fresh implementer fix round must add genuine RED coverage and
correct all Critical/Important findings without changing frozen E1, then return a new 40-hex
ancestor revision for another distinct review attempt.
