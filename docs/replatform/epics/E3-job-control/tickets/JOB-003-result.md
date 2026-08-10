# JOB-003 Result - Lease jobs with ACK deadlines

**Status:** `needs_changes`
**Disposition:** `needs_changes`
**Date opened (UTC):** `2026-08-10`
**Epic:** `E3-job-control`
**Plan task:** `JOB-003 - Lease jobs with ACK deadlines (L; three bounded internal slices)`
**Implementer:** `Codex /root/job003_impl`
**Reviewer:** `Codex /root/job003_review`
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

### Review attempt 1 - 2026-08-10 - Codex `/root/job003_review`

- **Reviewed revision:** `55ed851c2cb72fb381fc6530642bcfcdcd947798`
- **Assignment base:** `4276331160afb77d47ffa488543b968da949c02f`
- **Code candidate ancestor:** `73f9d15537995b15cf2173ae0368ad6b28e6af13`
- **Reviewer decision:** `changes_requested`
- **Disposition:** `needs_changes`
- **Specification verdict:** fail.
- **H-01 tenant-isolation verdict:** structural controls pass; certification blocked by the
  absent platform-tenant traversal and missing non-vacuous receipt cross-tenant probe.
- **H-02 lease-authority verdict:** exact ACK/fence/deadline mutation paths pass focused
  acceptance; bounded semantic-receipt expiry is incorrect.
- **H-03 single-executor verdict:** the database uniqueness and three 100-way race reruns pass;
  valid mixed-workload capacity remains incorrect.
- **Migration/compatibility verdict:** fail.

The reviewer is distinct from implementer `/root/job003_impl` and changed no production code.
The review reread the canonical ticket and approved plan, brief/report/result/findings, frozen
PRT state machines/envelopes/errors, JOB-001/JOB-002/JOB-009, Decisions #117/#121/#123,
TEN/RLS/grants, and the full assignment-base diff. The reviewed revision and code candidate
are ancestors of HEAD; frozen E1 has no changed file. Four temporary adversarial test probes
were run against ephemeral embedded PostgreSQL and completely removed before this evidence.

There are **zero Critical findings and four Important findings**:

- **Important I-01 - the approved platform poll/outbox runtime is test-only.** The proof
  middleware rejects every absent-Organization or `platform` principal, the route gives the
  leasing service only `appDb`, and neither the ready scheduler nor outbox worker has a
  production caller. Platform workers therefore cannot poll, durable ready rows are never
  drained, and the first-32 Organization slice has no round-robin cursor. This contradicts
  the approved 32-shard/750-ms operator-principal traversal and E3-F002. Compose a flag-on-only
  operator poll/outbox runtime with physical-principal snapshot/recheck, fair bounded shard
  traversal, and job access exclusively through the selected `runInTenant` transaction.
- **Important I-02 - capacity accounting hides valid mixed-workload work.** Poll counts every
  live worker/target lease, compares that total to the current candidate workload's slots,
  and `break`s. A temporary real-PostgreSQL probe with batch=1 and browser=1 offered the batch
  job, then returned `no_work` for an eligible browser job. A zero-slot/incompatible oldest
  row can likewise hide later compatible jobs. Count/reserve capacity by applicable workload
  and continue the bounded scan; add mixed-class and concurrent cross-class matrices.
- **Important I-03 - an expired ACK receipt beyond bounded cleanup replays stale success.**
  ACK deletes only 100 expired receipts, then looks up the exact receipt without an expiry
  predicate. A real-PostgreSQL probe placed the exact expired receipt behind 101 older rows;
  a fresh-proof semantic retry returned the expired `acknowledged` result. Independently
  reject/delete the exact expired collision using fresh database time and cover positions
  1/100/101/301/final, restart, proof variants, digest drift, and concurrent replicas.
- **Important I-04 - migration 0227 rejects an E2-valid active legacy lease.** It adds nullable
  `activated_at`, performs no idempotent compatibility backfill, then requires every active
  row to have a value. Replaying exact 0227 over a pre-0227 active row failed with PostgreSQL
  23514 at `leases_activation_check`. Add C14-permitted idempotent compatibility or a narrowly
  proven legacy branch, and test an exact 0226-to-0227 upgrade with active/offered/terminal
  legacy and rich rows plus direct replay.

Fresh Windows-local evidence against the exact reviewed revision:

| Command / lane | Result |
|---|---|
| JOB-003 DB schema, receipt, and migration focused lane | PASS - 3 files, 15/15 |
| Poll/offer/ACK integration plus contract, three fresh consecutive runs | PASS - each 12/12, including 100-claim and 100-ACK races |
| JOB-001/JOB-002/JOB-009/tenant/startup/grant regression bundle | PASS - all 7 requested files |
| Tenant composite and worker-enrollment schema | PASS - 2 files, 15/15 |
| Frozen E1 checker at `b7a842870ce7509d8baa75409e0ab19da375c88a` | PASS |
| `pnpm install --frozen-lockfile` | PASS |
| DB/server and recursive typecheck; DB/server and root build | PASS |
| `$env:AOA_RUN_WIN_INTEGRATION='1'; pnpm test:run` | **FAIL (honestly labeled Windows-local aggregate)** - exit 1 after 270.6s with 12 failing tests; visible output included the D18 embedded-PostgreSQL setup cascade and known Windows/frozen failures. No separately rerun focused JOB-003 lane failed. |

The Windows-local result is not represented as a waiver or full-suite pass; Linux CI remains
formal DEC-03 authority. Offer and ACK forced-statement probes rolled back every side effect,
the job stayed queued after ACK, default-off behavior remained closed, and no renewal/event/
reaping/quota/provider/completion/cutover scope or fence/proof leakage was found. Add a real
cross-tenant receipt RLS read/write probe before certification even though policy shape and
grants are structurally correct.

Stable finding `E3-F017` records the four blockers. JOB-003 is not complete. A fresh
implementer fix round must add genuine RED coverage, correct I-01 through I-04 without changing
frozen E1 or widening scope, and return a new 40-hex ancestor revision for another distinct
review attempt. This ticket review is not the separate E3 integration gate and authorizes no
push.
