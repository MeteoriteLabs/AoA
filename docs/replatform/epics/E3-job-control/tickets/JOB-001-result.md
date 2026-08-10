# JOB-001 Result — Submit immutable jobs transactionally

**Status:** `implementation_complete_review_pending`
**Disposition:** `review_pending`
**Date opened (UTC):** `2026-08-09`
**Epic:** `E3-job-control`
**Plan task:** `JOB-001 — Submit immutable jobs transactionally (M)`
**Implementer:** `Codex /root/job001_impl`
**Reviewer:** `not_assigned_distinct_required`
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

Pending. A distinct reviewer alone may append review attempt 1 and change this ticket to
complete/pass.
