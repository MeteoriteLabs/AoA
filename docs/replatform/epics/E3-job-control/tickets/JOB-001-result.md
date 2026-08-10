# JOB-001 Result — Submit immutable jobs transactionally

**Status:** `implementation_complete_review_needs_changes`
**Disposition:** `needs_changes`
**Date opened (UTC):** `2026-08-09`
**Epic:** `E3-job-control`
**Plan task:** `JOB-001 — Submit immutable jobs transactionally (M)`
**Implementer:** `Codex /root/job001_impl`
**Reviewer:** `Codex /root/job001_review`
**Start SHA:** 8e2faa590d4e97a2cbd250c55f4a2ed81a352a33

The Start SHA remains the fetched `origin/docs/replatform-program` tip and exact pre-E3
implementation revision. Corrective E1/E2 prerequisite gates were already committed and
passing before this attempt; they were consumed as immutable dependencies.

## Dependency and assignment state

- PRT-003, TEN-003, and TEN-006 have committed passing dependency handoffs.
- E3-F001 and E3-F004 have superseding passing corrective handoffs and are immutable inputs.
- JOB-001 implementation is ready for the required distinct review; it is not complete/pass.
- On assignment, a fresh implementer appends the implementation attempt. A distinct reviewer
  reviews a 40-hex revision that is an ancestor of HEAD, reruns the focused acceptance, and
  alone may change `Status` to `complete` in a separate documentation commit.

## Implementation attempts

### Attempt 1 - 2026-08-10 - Codex `/root/job001_impl`

- Implemented flag-gated, non-owner `aoa_app` submission through exactly one
  `runInTenant(appDb, organizationId, fn)` transaction.
- Added immutable job facts, company-bound attempts, identifier-only ready outbox rows,
  exact principal/source idempotency, and migrations 0216-0218 with C14 guards and
  Decision #122 grants/FORCE RLS.
- Added shared source-command DTOs, strict validation, route/service/repository boundaries,
  transactional principal/source admission, uniform denial, payload-free logging, and no
  placement/lease/worker/cutover behavior.
- Focused acceptance: DB 10/10, required server 34/34, HTTP logging policy 8/8.
- Frozen protocol checker, frozen lock install, affected packages, recursive typecheck, and
  root build passed. Exact `pnpm test:run` was inconclusive on Windows because Vitest worker
  IPC closed before results; the bounded one-worker diagnostic emitted no failures before
  manual termination at approximately 8m27s.
- Implementation revision is the scoped JOB-001 commit containing this ledger update; the
  distinct reviewer must record its 40-hex SHA and independently rerun acceptance.

## Independent review

### Review attempt 1 - 2026-08-10 - Codex `/root/job001_review`

- **Reviewed revision:** `75ae7d5ec46f3fae01afa5b6349f3f5d5f4772c4`
- **Disposition:** `needs_changes`
- **Specification verdict:** fail.
- **Code/security quality verdict:** fail.
- Confirmed that the non-owner `aoa_app` submission path is one `runInTenant` transaction,
  atomic across immutable job + initial attempt + attempt-aware identifier-only outbox; exact
  scoped idempotency, digest conflict, 32-way convergence, hostile tenant denial, flag-off
  isolation, frozen E1 boundary, paired manifest/lock, focused schema/migration/startup/legacy
  grants, affected builds, and typechecks pass.
- **Important I-01:** the route accepts five non-task source identities from an unrelated
  authenticated principal without source-specific proof. An ordinary user is explicitly
  accepted for all six sources, including system-only `service_reconcile` and restricted
  `one_shot`, so persisted requester/executor/source authority facts are not server-authenticated.
- **Important I-02 (H-01):** forced transaction failures emit raw Drizzle query messages and
  parameters through generic error logging, exposing `source_intent` and arbitrary job input
  despite the request-body omission policy.
- **Important I-03:** adding JOB-001 tables to shared live grant constants changes the
  authoritative builders for immutable migrations 0213/0214. Their byte-alignment tests fail,
  and rebuilt 0214 would reference `job_outbox` before 0216 creates it.
- **Important I-04:** exact `AOA_RUN_WIN_INTEGRATION=1 pnpm test:run` completed with 43 failed
  tests (not a timeout and not `ERR_IPC_CHANNEL_CLOSED`). Focused reproduction found 22 server
  tenant/RLS failures and 5 DB failures caused by unsynchronized `job_attempts.company_id`
  fixtures and the changed shared repository surface.
- Windows-local evidence is not formal Linux/DEC-03 certification; nevertheless these are
  deterministic completed failures and block review. No production code was changed.
- Detailed evidence: `.superpowers/sdd/implementation-plan/job-001-review.md`.
