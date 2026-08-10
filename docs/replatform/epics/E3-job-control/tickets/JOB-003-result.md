# JOB-003 Result - Lease jobs with ACK deadlines

**Status:** `needs_changes`
**Disposition:** `needs_changes`
**Date opened (UTC):** `2026-08-10`
**Epic:** `E3-job-control`
**Plan task:** `JOB-003 - Lease jobs with ACK deadlines (L; three bounded internal slices)`
**Implementer:** `Codex /root/job003_impl`
**Reviewer:** `Codex /root/job003_final_review`
**Start SHA:** 4276331160afb77d47ffa488543b968da949c02f
**Implementation candidate:** 808a17b5cfa545eff77da13aeb9735aa7ebb0a99
**Reviewed revision:** a48faac86cf3a875e5a16c487d91e88d9f78d6fd

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

## Implementation fix round 1 - 2026-08-10 - Codex `/root/job003_impl`

This fix round implements the independently accepted Decision #124 successor and resolves
review attempt 1's I-01 through I-04 plus the required receipt RLS probe. It remains an
implementer handoff: only a fresh reviewer may append review attempt 2 and change this ticket
to `complete` / `pass`.

### TDD and commit boundaries

- Consolidated amendment/review RED `6b722932e25a5e275dd3fa93d6c7b347b4e0bf7d`;
  first production GREEN `ef972af6fde478f9e39fd36c36c23591a72c3eac`.
  - Added the app-outer/operator-shared Decision #124 advisory handoff and the matching
    target-to-worker/exclusive-writer authority; real lock-order, cutoff, connection-loss,
    rollback, liveness, static writer-inventory, and no-grant-widening proofs.
  - Added workload-class plus explicit provider-total capacity accounting with bounded
    keyset scanning past incompatible/zero/full candidates; exact current receipt expiry
    handling independent of bounded housekeeping; idempotent populated-E2 migration 0227
    backfill; and non-vacuous cross-Organization receipt RLS probes.
- Scheduler/legacy-heartbeat RED `8ce0547b68953fd1d4d8a0aa9d7180fb51b9a54e`;
  production GREEN `a61f028bd1fab392a08be879c7275a80a95e08cb`.
  - Composed one flag-on-only scheduler/outbox runtime from `index` through `createApp` and
    worker-control leasing. Identifier-only hints are exact
    `{organizationId,targetId,attemptId}`; admitted Organization shards rotate fairly at
    most 32 per 750-ms tick; publish rejection remains retryable; poll rechecks exact hinted
    attempts under tenant locks and always falls back to ordered database pull.
  - Restricted legacy bearer heartbeat to non-null-Organization targets, so platform
    physical authority remains proof-bound and cannot race a retired legacy token through
    enrollment/cutoff. Frozen E1 and role grants remain unchanged.
- Database-clock precision RED `617661bc294bb7030a6bd7f41ab85927edfe07e5`;
  production GREEN `d7f726ca65430551420a6ed6db764138d06c0d1a`.
  - A deterministic PostgreSQL `+500 microseconds` case proved that rebinding a DB timestamp
    through JavaScript milliseconds could hide a newly ready outbox row. Both job and outbox
    readiness now use one stable, index-friendly `statement_timestamp()` cutoff. The caller
    time still supplies durable claim/update timestamps and the stale-claim threshold; a
    true future-row negative remains excluded.
- Aggregate legacy-test fixture correction `808a17b5cfa545eff77da13aeb9735aa7ebb0a99`.
  - The full lane exposed an old audit test that mocked only the retired target-ID resolver.
    Its missing new authority export caused a test-only 500 before validation. The fixture
    now returns the exact target-plus-Organization authority; production is unchanged and
    the audit/service lanes pass 8/8 and 7/7.

### Authority and scope result

- H-01: every job/outbox/attempt/lease/receipt path remains inside the authenticated logical
  Organization's `runInTenant` transaction. `aoa_operator` sees no tenant job identifiers or
  payload. The platform physical session remains control-only; logical Organization sessions
  supply tenant authority. Receipt cross-Organization read/insert/update probes fail closed.
- H-02: platform target/worker authority is linearized by the Decision #124 row/advisory
  handoff, all inventoried writers use the exclusive side, and stale/retired bearer or proof
  authority cannot mutate status, touch liveness, offer, ACK, or persist a receipt. ACK keeps
  fresh DB time, exact fence/tuple predicates, and all-or-nothing rollback.
- H-03: the partial live-lease uniqueness constraint remains database defense in depth;
  class-aware reservation plus the provider total prevents cross-class over-counting and
  over-commit. Three fresh 100-claimer race runs each returned exactly one offer.
- Scope still stops at ACK receipt. No renewal, event ingestion, reaping, retry lifecycle,
  provider contact, quota authority, completion, cutover, RLS/grant widening, locator, or E1
  protocol change was added. Distributed execution remains default-off.

### Operator-directed Windows-local evidence

All real-PostgreSQL commands ran from `C:\e3` with `AOA_RUN_WIN_INTEGRATION=1`.
Linux CI remains the formal DEC-03 authority.

| Command / lane | Result |
|---|---|
| Consolidated focused specialist matrix | PASS - 5 files, 48/48 |
| Accepted JOB-003 DB matrix | PASS - 6 files, 25/25, including populated 0226-to-0227 upgrade/replay, both lock interleavings, connection-loss release, receipt RLS, and C14 |
| Accepted JOB-003 server matrix | PASS - 9 files, 89/89 |
| H-03 full leasing lane, three consecutive fresh runs | PASS - 14/14 on each run |
| JOB-001/JOB-002/JOB-009/server predecessor bundle | PASS - 8 files, 100/100 |
| Tenant composite/enrollment/receipt DB predecessor bundle | PASS - 3 files, 21/21; historical 19 grew by the two required receipt RLS cases |
| Tenant adversarial property suite | PASS - 11/11 over 4,460 operations |
| Legacy heartbeat audit/service focused correction | PASS - 8/8 and 7/7; two legacy real-DB files remain unconditionally Windows-skipped by their existing declarations |
| Frozen E1 checker and Start-to-candidate protocol diff | PASS - checker source `b7a842870ce7509d8baa75409e0ab19da375c88a`; zero changed `packages/worker-protocol` file |
| `pnpm install --frozen-lockfile` | PASS |
| DB/server affected typecheck, `pnpm -r typecheck`, and `pnpm build` | PASS |
| `$env:AOA_RUN_WIN_INTEGRATION='1'; pnpm test:run` at `d7f726ca65430551420a6ed6db764138d06c0d1a`, then corrected candidate `808a17b5cfa545eff77da13aeb9735aa7ebb0a99` | **FAIL (honestly labeled Windows-local aggregate)** - first run exited 1 after 258s with 13 visible failure blocks and exposed the stale legacy-heartbeat test mock. After its test-only correction, the second exact run exited 1 after 262s with 22 visible failure blocks from the variable Windows embedded-PostgreSQL contention/setup cascade plus unrelated baseline tests; the heartbeat audit failure did not recur. No visible failure came from a JOB-003 DB, leasing, authority, receipt, startup, tenant-adversarial, migration, frozen-protocol, typecheck, or build lane. |

The aggregate failure is neither hidden nor waived, and this record is not a ticket pass.
The fresh reviewer must review exact candidate `808a17b5cfa545eff77da13aeb9735aa7ebb0a99`
plus its evidence descendants, rerun the focused acceptance, verify every Decision #124
writer and failure interleaving, and alone decide the disposition.

## Independent review attempt 2 - 2026-08-10 - Codex `/root/job003_final_review`

- **Reviewed revision:** `a48faac86cf3a875e5a16c487d91e88d9f78d6fd`
- **Assignment base:** `4276331160afb77d47ffa488543b968da949c02f`
- **Code candidate ancestor:** `808a17b5cfa545eff77da13aeb9735aa7ebb0a99`
- **Prior review ancestor:** `55ed851c2cb72fb381fc6530642bcfcdcd947798`
- **Reviewer decision:** `changes_requested`
- **Disposition:** `needs_changes`
- **Specification verdict:** fail.
- **H-01 tenant-isolation verdict:** pass. Every tenant job operation remains in the exact
  authenticated logical Organization transaction; platform physical authority remains
  control-only and receipt RLS rejects cross-Organization access.
- **H-02 lease-authority verdict:** runtime handoff and cutoff paths pass, but certification
  fails because the required static exclusive-writer inventory does not detect bypasses.
- **H-03 single-executor verdict:** uniqueness, class/provider reservation, and three fresh
  100-way offer races pass; restart/lost-hint database-pull liveness can permanently starve
  eligible work beyond the fixed scan window.
- **Migration/compatibility verdict:** pass, including populated 0226-to-0227 upgrade/replay,
  C14 guards/backfill, receipt expiry, and database-native microsecond eligibility.

The reviewer is distinct from implementer `/root/job003_impl` and changed no production or
test code. The exact reviewed revision was a clean HEAD before evidence edits; the assignment
base, implementation candidate, and prior review revision are all ancestors. The full
Start-to-reviewed and candidate-to-reviewed diffs were inspected, the latter contains only
JOB-003 evidence, and frozen E1 has no changed file. One temporary real-PostgreSQL starvation
probe was applied, run once, and removed; a read-only built-runtime scheduler probe changed no
file. The worktree returned clean before this review evidence was written.

There are **zero Critical findings and four Important/specification findings**:

- **Important I-05 - scheduler hint memory is not bounded across execution targets.**
  `job-ready-scheduler.ts` stores Organization to target to attempt sets, but applies
  `maxHintsPerShard` independently to each target set. Target-map cardinality and aggregate
  Organization hints have no cap or sweep, and only a poll of that exact target removes its
  entry. A read-only runtime probe configured one Organization shard and one hint per shard,
  then published 1,000 distinct valid target/attempt pairs: all 1,000 were accepted and
  `size()` reported 1,000 hints. Because the outbox row is marked delivered after acceptance,
  offline, revoked, and historical target IDs can retain process memory indefinitely. Bound
  aggregate hints and target cardinality per Organization or globally, define deterministic
  eviction/cleanup, and add multi-target churn plus delivered-row tests.
- **Important I-06 - database pull can permanently starve compatible work beyond 256 rows.**
  Each poll resets its lexical cursor, examines at most 256 rows, and returns `no_work`.
  Placement and static readiness are SQL-filtered, but dynamic worker workload slots,
  capabilities, resource fit, and class/provider capacity are rejected only after selection.
  A temporary real-PostgreSQL probe queued 256 older batch attempts, polled with
  `batchSlots=0` and `browserSessionSlots=1`, then queued a compatible browser attempt at
  position 257; the poll deterministically returned `no_work`. After scheduler-memory loss or
  restart, every later request rescans the same 256 while its already delivered hint cannot be
  replayed. Add durable or fair cursor progress, capability/capacity-aware bounded selection,
  or another restart-safe mechanism and cover greater-than-window/restart/churn cases.
- **Important I-07 - the outbox tick does unbounded Organization work and has no 750-ms DB
  budget.** Runtime startup materializes every admitted Organization on every tick before the
  worker deduplicates/sorts the full array and slices 32. The worker has neither an elapsed
  deadline nor a database statement budget; 750 ms is only the interval cadence. Organization
  enumeration is therefore O(all Organizations), and slow sequential tenant work can exceed
  the promised 750-ms DB budget without resumable cutoff. Move keyset/limit selection into the
  database-facing traversal, enforce an actual monotonic/statement deadline, persist or retain
  cursor progress, and test more than 32 Organizations plus a slow tenant.
- **Important I-08 - the mandatory platform-authority writer inventory is non-enforcing.**
  `job-leasing-contract.test.ts` only checks that each of four broad source files contains the
  guard helper symbol somewhere. It neither binds every status/generation/device/profile
  mutation site to target-to-worker locking and the exclusive advisory nor discovers mutation
  sites in unlisted files. Generic enrollment mutation methods remain available, and a new
  unguarded mutation beside any existing helper occurrence leaves the test green. Replace this
  with an exact AST/allowlist or narrow guarded mutation surface that fails on every new bypass,
  preserving only the specifically approved last-seen exemption, and add a negative bypass
  fixture.

The current app-outer/operator-shared handoff, operator-loss rollback, guard-first and
cutoff-first interleavings, platform logical liveness, legacy platform-token exclusion,
logical-profile class/provider capacity, exact receipt expiry, cross-Organization receipt
denial, stable `statement_timestamp()` readiness, migration 0227 compatibility, default-off
composition, shutdown, role/grant boundary, and single-engine constraint all passed review.
Decision #124 intentionally assigns aggregate cross-profile physical-device capacity to
WRK-003; JOB-003 correctly enforces the registered clamp per logical Organization profile.

Fresh Windows-local evidence against exact reviewed revision
`a48faac86cf3a875e5a16c487d91e88d9f78d6fd`:

| Command / lane | Result |
|---|---|
| Accepted JOB-003 DB matrix | PASS - 6 files, 25/25, 18.045s |
| Accepted JOB-003 server matrix | PASS - 9 files, 89/89, 75.981s |
| Specialist matrix | PASS - 5 files, 48/48, 11.047s |
| H-03 leasing file, three consecutive fresh processes | PASS - 14/14 each, 32.095s total |
| JOB-001/JOB-002/JOB-009 server predecessor bundle | PASS - 8 files, **101/101**, 20.568s; the reviewed revision contains one more test than the stale 100-test expectation |
| Tenant DB predecessor bundle | PASS - 3 files, 21/21, 10.421s |
| Tenant adversarial property suite | PASS - 11/11 over 4,460 operations, 10.917s |
| Frozen E1 checker at `b7a842870ce7509d8baa75409e0ab19da375c88a` | PASS - 1.795s; Start-to-reviewed protocol diff empty |
| `pnpm install --frozen-lockfile` | PASS - 3.210s; no tracked change |
| DB/server affected typecheck | PASS - 6.245s / 18.502s |
| DB/server affected build | PASS - 7.044s / 20.883s |
| `pnpm -r typecheck` | PASS - 72.434s |
| `pnpm build` | PASS - 53.307s |
| `$env:AOA_RUN_WIN_INTEGRATION='1'; pnpm test:run` | **FAIL (honestly labeled Windows-local aggregate)** - run exactly once, exit 1 after 295.5s with 13 visible failure blocks. Visible output included the D18 embedded-PostgreSQL setup cascade and an unrelated UI `ProjectDetailDiscussions` failure. Output truncation prevents claiming that list is exhaustive. |

The aggregate failure is not represented as a waiver or full-suite pass; Linux CI remains the
formal DEC-03 authority. No focused acceptance lane failed. Stable findings `E3-F021` through
`E3-F024` record the four blockers; prior findings `E3-F018` through `E3-F020` are resolved and
`E3-F017` is only partially resolved because its bounded scheduler/no-head-of-line acceptance
remains open. JOB-003 is not complete. A fresh implementer round must add genuine RED coverage
and correct I-05 through I-08 without changing frozen E1, widening roles/grants, adding a
second engine, or expanding lifecycle scope. This ticket review is not the separate E3
integration gate, does not mark the epic complete, authorizes no push, and leaves JOB-010
paused.

## Fix round 2 STOP - cursor order amendment required

Fix-round-2 RED `c5be2a6853a93c1ad73910f1bdcd05c8299f93b6` reproduced the four review-attempt-2
gaps without production, schema, migration, or ledger changes. During GREEN preflight, the
implementer found that the proposed two-field `(created_at, id)` worker cursor cannot preserve
the locked job claim order `(available_at ASC, priority DESC, created_at ASC, id ASC)`.
Implementation stopped before generating `0229`; no cursor schema or leasing code remains in
the worktree. A first amendment then specified a nullable all-or-none four-field cursor with
no FK/existence oracle. That historical amendment was never implementation authority.

## Independent cursor-amendment rejection and static-certificate successor

A distinct reviewer read exact plan revision
`0f1953d4f645d7530a9580289b03365911d02a0b` and returned `REJECT / P1 STOP`. The four-field
cyclic cursor could bypass a newly inserted, capacity-reenabled, or formerly locked older row
while later work stayed nonempty; hint-first selection independently violated the locked
oldest-eligible rule; JavaScript `Date` lost database microseconds; `jobs_claim_idx` had
priority ASC rather than the required DESC; scheduler bounds were not numeric; and the
750-ms text incorrectly claimed cumulative database time. No cursor production/schema/
migration work was created.

The successor amendment removes the cursor. Dynamic provider/resource/class capacity is
hoisted before selection. One database-native, statement-time, mixed-direction ordered query
always begins at the global head and anti-joins only exact static-negative certificates in a
new tenant FORCE-RLS table. Certificates are one row per logical worker/attempt, bind versioned
worker/target/placement authority, and never represent dynamic capacity, locks, races,
timeouts, parsing, envelope, or authority failures. Ready state is one coalesced Organization/
target signal with no attempt IDs; it may shorten `no_work` retry latency but cannot change
candidate order. The runtime contract is a 750-ms launch-admission window, not a cumulative
or hard-wall deadline. Generated `0229` owns only the required logical-worker parent UNIQUE;
after it applies, generated `0230` owns the certificate table, child FKs, and corrected indexes,
while custom `0231` owns exact app-only RLS grants.

JOB-003 remains `needs_changes`. GREEN remains unauthorized until a distinct reviewer accepts
the exact committed successor, the test-only RED is corrected to that reviewed shape, and the
controller reruns the corrected RED.

## Static-certificate successor review attempt 1 - needs changes

Two distinct read-only reviewers checked exact successor revision
`7cf1d763222b8f453b2aa1eeb19332f73a942722`; neither changed the worktree. Both rejected it.
The shared P1 was that a candidate-specific application hash could not be validated by the
required pre-fetch SQL anti-join. Other P1s were cross-profile `target-wide` capacity wording
contrary to Decision #124, the missing exact `aoa_app` grant-allowlist seam, and missing H-01
foreign-versus-absent FK evidence. P2s required executable million-row ceilings/shapes, an
executable parent-UNIQUE-before-child-FK migration sequence, and one unambiguous blocked
execution status.

The corrected successor separates the two domains. The application computes one exact poll-
invariant hash after locking current logical-worker, target, and any platform physical-worker
authority, then binds that hash into the SQL statement. Every candidate-specific workload,
placement tuple, and JOB-009 digest is compared by an ordinary correlated certificate column;
SQL never canonicalizes JSON. Capacity counts are current Organization + logical worker +
target only, with a two-tenant shared-platform proof; WRK-003 owns cross-profile totals. The
file/test inventory now includes the schema export, exact grant allowlist and startup audit,
raw app-role foreign/missing equality for both composite FKs, numeric DEC-03 load ceilings and
four distributions, and an explicit generated-migration dependency. JOB-003 stays `needs_changes` and
GREEN remains unauthorized pending fresh exact whole-plan and schema/security acceptance.

## Static-certificate successor review attempt 2 - needs changes

Fresh whole-plan and schema/security reviewers checked exact revision
`b42992bfa9793f5031b80c726cb340f27d01b428`. The prior SQL anti-join, logical-profile scope,
grant/startup, FK oracle, migration contingency, numeric load gate, and execution-status
findings were closed. Review still rejected the revision because it bound the stored
enrollment hash but not the separately parsed matcher `profile_snapshot`, proved only one
direction of neutral-adapter equivalence, left the million-row prefix/cleanup ordering
non-adversarial, and retained two hand-edit sentences inconsistent with the proposed cross-
migration reorder.

The next correction adds `logicalWorkerStaticMatcherProfileHash`, computed from the parsed
stored hello with only capacity replaced by the reviewed neutral value and canonicalized with
`canonicalizeJsonV1`; a fixed authorization-hash/snapshot-mutation matrix must invalidate old
certificates. Static rejection now requires bidirectional equivalence to the frozen matcher
after all dynamic gates. The load gate pins 999,744 oldest current certificates before 256
uncertified candidates, a fully certified no-work query, and sparse plus indexed-tail cleanup
with row/buffer evidence and explicit ceilings. The next revision made the proposed reorder
explicit. JOB-003 remains `needs_changes`; implementation is still paused pending another exact
dual re-review.

## Static-certificate successor review attempt 3 - needs changes

Schema/security review accepted exact revision
`1d716e7fe0d2800a0b8819584d1d35b24ce30d68`, but the independent whole-plan reviewer found
one P1 and two P2 defects. The P1 was governance/executability: the plan relied on an epic-local
cross-migration statement reorder that was not authorized by Decision #19/AGENTS. The P2s were
an overbroad snapshot-mutation assertion that included dynamic capacity and absolute p95 gates
on variable `ubuntu-latest` without a pinned benchmark environment.

The correction uses only the repository's authorized migration workflow. Generated `0229`
adds the logical-worker parent UNIQUE and must apply first. Generated `0230`, created against
that new snapshot, adds the certificate table/child FKs and corrected indexes. Custom `0231`
contains only Decision #122 RLS/GRANT/POLICY DDL. There is no cross-migration reorder or hand-
authored schema DDL. Snapshot coverage now mutates every non-capacity static matcher field and
separately proves capacity-only changes leave the static matcher hash unchanged and remain
dynamic. Million-row correctness, row/buffer/index, memory, and bounded-scan checks remain
blocking; variable-runner latency is observed only. A reproducible pinned `E3-PERF-01` handoff
is required before the E3 exit gate or any production-capacity/SLO claim. JOB-003 remains
`needs_changes`; RED correction and GREEN remain unauthorized pending fresh exact dual review.

## Static-certificate successor review attempt 4 - needs changes

Two independent read-only reviewers checked exact revision
`9bbd2002033b4f254f11f726af0c0c1493e88435`. Schema/security review returned `ACCEPT` with
zero P0/P1/P2 and confirmed the split generated migrations, composite FKs, FORCE RLS/app-only
grants, startup allowlist, static matcher hash, capacity separation, correlated SQL validity,
and structural load checks. Whole-plan review closed all of those findings but rejected one
P2: `E3-PERF-01` was mandatory without an executable owner/evidence/trigger contract, and its
wording allowed thresholds to be chosen after measurement.

The correction assigns the independent Integration Gate Owner to execute the campaign and a
distinct Security Gate Owner to prospectively approve its manifest and verify its result. A
committed pre-sample manifest freezes the exact implementation revision, immutable environment,
dataset, raw-evidence retention, and INITIAL numeric thresholds. The new
`scripts/run-e3-perf-01.mjs` trigger validates that manifest/environment, runs the million-row
load suite, and writes content-addressed raw evidence. Immutable performance QA and handoff
attempts record every Git/image/config/archive digest; any mismatch or threshold miss fails,
and any prospective threshold change requires a higher reviewed manifest and complete new
campaign while preserving the failed attempt. The overall Integration Gate Owner must pin and
consume both passing performance artifacts before epic completion. JOB-003 remains
`needs_changes`; implementation is still paused for fresh exact dual re-review.
