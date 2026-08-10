# JOB-003 Result - Lease jobs with ACK deadlines

**Status:** `implementation_complete_review_pending`
**Disposition:** `review_pending`
**Date opened (UTC):** `2026-08-10`
**Epic:** `E3-job-control`
**Plan task:** `JOB-003 - Lease jobs with ACK deadlines (L; three bounded internal slices)`
**Implementer:** `Codex /root/job003_impl`
**Reviewer:** `pending distinct Codex /root/job003_review`
**Start SHA:** 4276331160afb77d47ffa488543b968da949c02f
**Implementation candidate:** 73f9d15537995b15cf2173ae0368ad6b28e6af13

The Start SHA is the committed passing JOB-009 completion revision and the exact JOB-003
assignment boundary. JOB-001, JOB-002, JOB-009, the frozen E1 v1 protocol, and the E2 tenant
kernel are immutable inputs. This is an implementer handoff only: a fresh distinct reviewer
must inspect an exact 40-hex ancestor revision, rerun the focused acceptance, append review
attempt 1, and alone may change this ticket to `complete` / `pass`.

## Dependency and scope state

- This pre-E6-D1 ticket consumes committed passing JOB-001 submission, JOB-002 worker
  enrollment/proof, and JOB-009 placement authority.
- Every job, attempt, lease, proof, and receipt mutation runs in one
  `runInTenant(appDb, organizationId, fn(repos))` transaction. Worker offers and ACKs recheck
  the exact Organization/Company/job/attempt/worker/target/generation/profile/provider/fence
  authority under row locks and fresh database time.
- The implementation stops at ACK receipt: an attempt moves `pending -> offered -> leased`,
  while the job remains queued. It adds no renewal, event ingestion, reaping, retry,
  cancellation, provider contact, quota engine, completion, or cutover behavior.
- Distributed execution remains default-off. The existing legacy path stays authoritative.
  The frozen E1 package has no changed file from Start SHA.

## Implementation attempt 1 - 2026-08-10 - Codex `/root/job003_impl`

### TDD and commit boundaries

- Slice A RED `7d82db4b6c49bf8bb0d14d25fd681702c96ee35f`; GREEN
  `00e34b513b7cd25cdaf6205b98ea929fd4bc56f9`.
  - Added rich lease authority/lifecycle columns and `worker_operation_receipts` through
    Drizzle schema, generated migration `0227`, C14 guards, and Decision #122 custom RLS/
    grant migration `0228`. Receipt scope, semantic digest, expiry, tenant FKs, lifecycle
    checks, FORCE RLS, no operator authority, journal replay, and migration idempotency are
    covered by real PostgreSQL tests.
- Slice B RED `dbbb81acb77a2c7a4363da5b08fab99adefc3334`; GREEN
  `a19e9089a27e2d34d8d15ddcdb7a2a8c19d6753f`.
  - Added proof-authenticated worker poll, the bounded ready scheduler/outbox consumer, and
    atomic offer creation. Candidate selection uses `FOR UPDATE SKIP LOCKED`; worker, target,
    membership, job, and attempt authority are rechecked under locks. One of 100 concurrent
    claimers receives the only opaque offer and every loser receives minimal `no_work`.
- Slice C RED `6ec4628dfaf58fdfcfcc2da0a22ca2ee300fa61a`; GREEN
  `417b005c3692f6017dd2aec48da625449fe0850d`.
  - Added proof-authenticated ACK with a bounded semantic receipt. Fresh-proof restart replay
    of the same idempotency key and semantic digest converges; proof replay, digest drift,
    stale/expired/replaced authority, tuple drift, and forced statement failure close without
    partial mutation. Lease activation, attempt transition, receipt, and proof consume commit
    together or roll back together.
- Aggregate fixture correction `a1ade69e727d51ed4b8b28db1f3f4ab8adfeb8c5`
  aligns E2 adversarial active-lease seeds with the new explicit activation invariant.
- Startup-authority RED `a20758916ba18ddd9475e17ca6df9ccd595c6386`; GREEN
  `0c52ecbf1044cc1eadccfbaeb4de0fd2d8798428`.
  - The exact root lane exposed that migration `0228` granted receipt DML but the fail-closed
    runtime allowlist still expected no receipt access. A versioned JOB-003 grant delta now
    matches the real grant without mutating the immutable E2 grant set; all 14 startup
    authority and drift-denial cases pass.
- Aggregate lifecycle fixture correction `ee8a1005fa2a0d97f2dfcb68dbce1aa6b88f83a8`
  adds `activated_at` to the direct-SQL active-lease integrity seeds; the file passes 9/9.
- Pre-review hygiene correction `73f9d15537995b15cf2173ae0368ad6b28e6af13`
  removes one extra EOF blank line from the receipt schema; DB typecheck/build are unchanged.

## Authority, compatibility, and failure behavior

- H-01: Organization and Company scope are carried on lease/receipt rows and enforced by
  composite FKs plus FORCE RLS. Routes authenticate a worker proof, then enter exactly one
  tenant transaction; foreign and missing authority are indistinguishable and errors/logs do
  not disclose payloads, fences, proof material, or foreign identifiers.
- H-02: every ACK update predicates the exact current fence and the complete placed target,
  generation, profile, provider, attempt, worker, and tenant tuple. The deadline and expiry
  are compared with `clock_timestamp()` in the conditional write. Replaced, stale, expired,
  revoked, suspended, or otherwise drifted authority cannot activate the lease or persist a
  receipt.
- H-03: offer creation locks the placed attempt and relies on the existing partial unique
  live-lease index as database defense in depth. The 100-claimer race and three consecutive
  full JOB-003 race runs each produced exactly one authoritative offer.
- Poll and ACK consume frozen E1 envelopes and the existing JOB-009 placement facts. No E1
  wire file changed and no second registry, scheduler engine, assignment engine, or provider
  interface was introduced.
- Crash-safe ready hints carry identifiers only. Each scheduler/outbox claim is bounded and
  tenant-scoped; failures leave durable work retryable without granting an execution lease.

## Operator-directed Windows-local evidence

All embedded-PostgreSQL commands ran from `C:\e3` with
`AOA_RUN_WIN_INTEGRATION=1`. Linux CI remains the formal DEC-03 authority.

| Command / lane | Result |
|---|---|
| JOB-003 schema, receipt RLS/replay, and migration idempotency | PASS - 3 files, 15/15 |
| JOB-003 leasing integration, run three consecutive times | PASS - each run 8/8; includes 100-claimer single-offer race, ACK authority/replay/rollback cases |
| JOB-003 frozen HTTP and exact-grant contracts | PASS - 2 files, 8/8 |
| `distributed-execution-db-startup.integration.test.ts` | PASS - 14/14 after the versioned receipt-grant correction |
| `tenant-composite-integrity.integration.test.ts` | PASS - 9/9 after active-lease fixture alignment |
| JOB-001/JOB-002/JOB-009/tenant prerequisite bundle | PASS - 9 files, 94/94 |
| tenant adversarial property suite | PASS - 11/11, 4,460 operations |
| `pnpm check:frozen-worker-protocol-v1 -- --source-sha b7a842870ce7509d8baa75409e0ab19da375c88a` | PASS |
| `pnpm install --frozen-lockfile` | PASS |
| DB/server affected typecheck and build; `pnpm -r typecheck`; `pnpm build` | PASS |
| `$env:AOA_RUN_WIN_INTEGRATION='1'; pnpm test:run` at `0c52ecbf1044cc1eadccfbaeb4de0fd2d8798428` | **FAIL (honestly labeled Windows-local aggregate)** - exit 1 after 277.4s, 2 failed suites and 11 failed tests. One JOB-003 lifecycle-fixture failure was corrected by `ee8a1005fa2a0d97f2dfcb68dbce1aa6b88f83a8` and then passed 9/9 in isolation. Other visible failures were the known frozen-E1 Windows transform error, D18 embedded-PG setup/teardown cascade, and unrelated adapter load timeouts. No JOB-003 leasing, receipt, startup-authority, tenant-adversarial, or migration test failed. |

The aggregate failure is not represented as a waiver or as a full-suite pass. The distinct
reviewer must reproduce the focused evidence on the exact reviewed revision and make the
ticket disposition.

## Independent review

Pending fresh distinct reviewer `/root/job003_review`. No reviewer attempt has been recorded
and the implementer has not certified this ticket.
