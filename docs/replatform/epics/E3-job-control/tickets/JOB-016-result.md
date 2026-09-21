# JOB-016 — Price accepted usage at ingest, on the E3-D-ACC seam — result

**Status:** `gate_review` — only a DISTINCT reviewer sets `complete`.
**Reviewed revision (code):** `3da94a421d192f1af26cf56f4b608aff266dc683` (branch `claude/m1-job-016`, PR #547). This is the last code commit, rebased onto the program tip; the pre-rebase equivalent was `a3d1db48395f8b4bf8954df0736c5223e13a2a5a`.
**Date (UTC):** `2026-09-21`
**Decision:** `E3-D-ACC` in [`../decisions.md`](../decisions.md), accepted with three amendments (planning session, founder delegation F2).
**E3-F037:** **NOT closed.** Its owner is re-pointed to **`DEP-016`** (planning-session ruling, F2). Closing it needs this ticket's seam and pricing, `WRK-018`'s producer, `WRK-018`'s keyed E2B acceptance for the real claude parser, and `DEP-016`'s end-to-end cost assertion. `E3-15-budget` in `scripts/gate-clause-wiring.json` stays `unwired`; its reason now carries a dated note that says so.

## Outcome

- **The seam.** `acceptEvent` (`packages/db/src/repositories/tenant/job-control.ts`) takes an optional `acceptedEventProjectors` list on `AcceptEventBatchInput`. `runAcceptedEventProjectors` runs it for each new-tail event, **before** that event's attempt projection, under the fence `acceptEvent` already holds:
  - it checks for an existing receipt first (`replayed`);
  - each projector runs in its own savepoint, and the `applied` receipt is written in that same savepoint;
  - on a throw, only the savepoint rolls back and a `pending` receipt is written (target = the attempt, `aggregateKind = 'job_attempts'`), itself in its own savepoint;
  - an event after a terminal in the same batch gets a `pending` receipt directly (`after_terminal`).
  With no projectors, the loop does nothing new.
- **Core (a).** `priceAcceptedUsageCore` (`server/src/services/job-budget-cost-bridge.ts`) is the transaction-taking core. `priceAcceptedUsage` keeps its public shape as a thin wrapper, and its fast path reports a `pending` receipt as `pending`.
- **Registration, always on (Amendment 1).** `createJobEventIngestService` (`server/src/services/job-events.ts`) always registers `createAcceptedUsagePricingProjector` (`server/src/services/job-accepted-usage-pricing.ts`). There is no switch.
- **Hard stop (Amendment 2).** On a breach, the core cancels the breaching job **and** the queued, lease-less distributed jobs of each breached company/agent scope. `evaluateCostEvent` gains an additive `breachedScopes`.
- **Re-drive (Amendment 3).** `redrivePendingAuthoritativeCost` plus `createAuthoritativeCostRedriveSweep`, run by the JOB-006 sweeper (`sweepPendingProjections`, composed in `server/src/index.ts`). It is bounded by `AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS = 3` and then raises ONE hub item per stuck receipt.
- **Terminal without usage.** Detected in-transaction by `detectTerminalWithoutUsage`, which is savepoint-isolated and swallows its own errors. It is emitted after commit as a classified warn line plus a count.

## Acceptance → test (`server/src/__tests__/job-accepted-event-seam.integration.test.ts`)

| # | Acceptance | Test |
|---|---|---|
| 1 | one run → exactly one `cost_events` row, cost > 0, one receipt | `[acc 1 + d]` (seam) and `[acc 1 / acc 8 target]` (REAL poll → ack → ingest) |
| 2 | a replay → `replayed`, no second row | `[acc 2 + d]`, `[d] … RECEIPT table` |
| 3 | after a hard stop, the next dispatch is refused; a job queued BEFORE the breach is not leased and is in the legacy-equivalent state (`cancelled`) | `[acc 3 + Amendment 2]` (real placed job, real poll returns no offer; submit refused) + `[acc 3 positive control]` (no breach → offered) |
| 4 | terminal without `usage` → classified signal | `[acc 4]` (real ingest; log + count) |
| 5 | projector failure → append committed, receipt `pending`, detector surfaces it | `[acc 5]`, `[c]` (a projector's own write rolls back) |
| 6 | same-transaction cases | `[acc 1 + d]` (usage→terminal), `[d] cancel-then-terminal`, `[b1 step 2]` (after terminal) |
| 6a | a pending receipt blocks the drain; re-driven → the SAME drain proceeds | `[acc 6a]` (real `assertRollbackSafe`; also asserts the wrapper reports `pending`) |
| 7 | two Organizations side by side; hard stop in A refuses only A | `[acc 7 / F10]`; `[F10]` (core refuses a foreign Company; B cannot borrow A's agent as a rate source) |
| 8 | positive control: registration removed → acceptance 1 reds | mutation M1 below |
| A3 | persistent failure stops at the bound, exactly ONE Inbox item, durable across restart | `[Amendment 3]` (real hub path, real `notifications` row) |

Sweeper wiring: `server/src/__tests__/job-control-sweeper-pending-projections.test.ts` (4 tests). These cover the per-Organization call, the best-effort behaviour, the disabled path, and the composition-root wiring.

## TDD deviation (for the distinct reviewer to judge)

**The code was written before the tests. There is no test-first RED record.** The M1 build rules require RED before GREEN; this ticket does not meet that rule.

The substitute evidence is **11 single-behaviour mutations** (table below). Each removes ONE behaviour, and each turns a named test red. Each mutation was then reverted with `git checkout`. Runs were local, embedded PG, `AOA_RUN_WIN_INTEGRATION=1`, via a scratchpad script (`j016-mutate.py`). The whole table was re-run after the last code change (`3da94a421`), with the same result.

There is also a structural base-revision fact: at the base, `acceptEvent` has no projector input, `job-accepted-usage-pricing.ts` does not exist, and nothing on the accepted-usage path calls the pricing authority. That is not a recorded RED run.

## Mutation table

| Mutation | Removes | Red tests (of 15) |
|---|---|---|
| M1 | the ingest's pricing registration (**acceptance 8**) | `[acc 1 / acc 8 target]` |
| M2 | the per-projector savepoint | 11, incl. `[acc 5]`, `[c]`, `[acc 1 + d]` |
| M3 | the Amendment 2 scope cancel | `[acc 3 + Amendment 2]`, `[acc 7 / F10]` |
| M4 | the wrapper's receipt-status check | `[acc 6a]` |
| M5 | the terminal-without-usage detection | `[acc 4]` |
| M6 | the durable stop (`isNotified`) | `[Amendment 3]` |
| M7 | the Company-belongs-to-Organization check | `[F10]` |
| M8 | the `after_terminal` pending path | `[b1 step 2]` |
| M9 | the `agents.company_id` filter in the rate lookup | `[F10]` |
| M10 | the retry bound (unbounded attempts) | `[Amendment 3]` |
| M11 | the Inbox notify call | `[Amendment 3]` |
| M12 | the deferred emit (emit inside the transaction) | both `[Codex P2]` tests |
| M13 | the ingest's after-commit emit | `[Codex P2] … REAL ingest` |

**GREEN (local, at the reviewed revision):**
- The new suite passed **15/15**, and the sweeper-hook suite passed **4/4**.
- 20 related files passed **225/225**: JOB-012 parity 13, job-events, drain (both), fence-surface contract, sweeper projection, DE-18 wiring, legacy-grants contract, budget, tenant-context, costs, job-control-metrics, **job-leasing-contract** (unchanged: no poll-chain edit).
- A further 12 files passed **114/114**: DE-03/DE-04 audit, fencing, reconciliation, service projection/liveness/rollout, worker-revocation, CLI-006 signal, and others.
- `tsc --noEmit` and the builds are green for `@armyofagents/db` and `@armyofagents/server`.
- The full policy guard set is green, including `check-register-citation-integrity`. The line citations my insertions moved in `docs/architecture/distributed-execution-threat-controls.json` were re-pointed through the exact `git diff -U0` line map, not by a nearest-anchor guess.

**CI (Linux, formal authority):** see the "CI evidence" section below, which is filled from the PR's `verify` shard for this file.

## Post-review fix — Codex P2 on `f8c68df` (budget signal deferred to after commit)

**The finding.** Codex found that `evaluateCostEvent` emits the in-process `budget.exhausted` signal synchronously. That signal's listener (`heartbeat.cancelBudgetScopeWork`, subscribed in `server/src/index.ts`) cancels live heartbeat work on the global handle. Inside the seam, the emit happened within a savepoint that could still roll back, so live work could be cancelled for a charge that never committed.

**Verified at source; fixed.**
- `evaluateCostEvent` takes an additive `deferExhaustedEmit` collector. Legacy callers pass nothing and are unchanged.
- The core never emits. It returns `exhaustedScopes`.
- The emit then happens only **after commit**, in three places:
  - the JOB-012 wrapper emits after its `runInTenant`;
  - the re-drive does the same;
  - the ingest emits per event, only for events whose seam outcome is `applied`.
- Two tests cover it, and each is red under its own mutation:
  - a savepoint rolled back after the core ran emits nothing (M12);
  - a committed breach through the real ingest emits exactly once, and the listener already sees the committed row (M12, M13).

The suite is now **17** tests, and the mutation table has **13** rows: rows M12 and M13 are new. The full table was re-run on the fixed code. Every row reds a named test; M1 additionally reds the new ingest emit test.

## Accepted deviations (planning session, F2)

1. **Pricing is registered on every ingest.** This is broader than the rule "always on for an `active`/`canary` Organization". Reading the rollout dial would leave in-flight spend unpriced after an Organization is dialled back mid-run.
2. **No lease-time budget check.** Adding one would be a second repository selection inside the frozen JOB-003 poll chain, which `job-leasing-contract.test.ts` forbids. The measure instead:
   - the charge cancels the queued, lease-less jobs of the breached scope;
   - an attempt caught mid-offer is refused at ACK (`activateLeaseAck` requires the attempt to still be `offered`).

   **The narrow race, named:** a poll that holds the queued attempt's lock at the instant of the cancel offers it first. The cancel then waits, marks the attempt `cancelled`, and the worker's ACK is refused, so no such attempt reaches `leased`.
3. **The accepted-usage counts are a separate telemetry module.** They are not on `JobControlMetrics`, because that interface is JOB-003's frozen closed contract. The module is `createPinoAcceptedUsageTelemetry` in `job-accepted-usage-pricing.ts`, event `job_control.accepted_usage`.

## Other differences from the task section, measured at source

- **Receipts move out of the cores and into the seam.** `recordGovernedProjection` re-guards the fence and throws after a same-batch terminal (decision (a)).
- **The `pending` receipt points at the attempt.** `target_aggregate_id` is `NOT NULL` (decision (c)).

## Files

- **Created:**
  - `server/src/services/job-accepted-usage-pricing.ts`
  - `server/src/__tests__/job-accepted-event-seam.integration.test.ts`
  - `server/src/__tests__/job-control-sweeper-pending-projections.test.ts`
- **Modified:**
  - `packages/db/src/repositories/tenant/job-control.ts`
  - `packages/db/src/index.ts`
  - `server/src/services/job-budget-cost-bridge.ts`
  - `server/src/services/job-events.ts`
  - `server/src/services/budgets.ts` (additive `breachedScopes`)
  - `server/src/services/job-authoritative-rate.ts`
  - `server/src/services/job-control-sweeper.ts`
  - `server/src/index.ts`
  - `server/src/db/tenant-context.ts` (`tenantRepositoriesForSavepoint`)
  - `server/src/__tests__/job-fence-surface.contract.test.ts` (new methods classified)
  - `docs/architecture/distributed-execution-threat-controls.json` (citation re-points)
  - `scripts/gate-clause-wiring.json` (dated note on `E3-15-budget`)

## CI evidence

Pre-rebase run `35586672944` on head `a3d1db48395f8b4bf8954df0736c5223e13a2a5a` (the same code as `3da94a421`, before the rebase onto the program tip) — `ci-required` **success**. Linux `verify (3)` executed `job-accepted-event-seam.integration.test.ts` **(15 tests)** and `job-control-sweeper-pending-projections.test.ts` **(4 tests)**; `verify (2)` executed `job-budget-cost-parity.integration.test.ts` **(13 tests)**. All four `verify` shards, `policy`, `migrations`, `e2e`, `e2e-pgvector`, `distributed-contract`, `browser`, `lint` passed. Codex (`chatgpt-codex-connector`) reviewed `a3d1db4839`: no major issues.

The run on the final head (after the rebase plus the E3-F037 re-point and this record) is cited in PR #547; this record is not rewritten for it.

## CI evidence — final head (addendum, 2026-09-21)

- **Reviewed revision: `9f26bb9cb988197afa0b356474685228397c7f03`.** This is the last commit carrying code and register changes. It is the **parent** of the commit that adds this addendum, and that child changes only this file. Both commits are on `claude/m1-job-016` and become ancestors of the program tip when PR #547 is merged with `--merge`.
- **Run `35591911282` on `9f26bb9cb988197afa0b356474685228397c7f03`:** `ci-required` **success**, and every job passed.
  - `verify (3)` executed `job-accepted-event-seam.integration.test.ts` **(17 tests)** and `job-control-sweeper-pending-projections.test.ts` **(4 tests)**.
  - `verify (2)` executed `job-budget-cost-parity.integration.test.ts` **(13 tests)**.
- **Codex** (`chatgpt-codex-connector`) reviewed `9f26bb9cb9`: no major issues.
- **Superseded as evidence:** the pre-rebase run `35586672944` on `a3d1db48395f8b4bf8954df0736c5223e13a2a5a`, cited in "CI evidence" above. That revision is not an ancestor of the program tip after the rebase, and its suite predates the Codex P2 fix (15 tests, not 17). The section above is kept as written.

## CI evidence — final head, second round (addendum, 2026-09-21)

**This supersedes the previous addendum.** That addendum names `9f26bb9cb`, and a later rebase onto the program tip rewrote that commit, so it is no longer on this branch. It also predates two Codex fixes.

- **Codex fixes in this round (on `782824f`), both verified at source:**
  - **P1:** a job with an OFFERED, un-ACKed lease was excluded from the hard-stop scope cancel. It is now cancelled, and its ACK is refused.
  - **P2:** `budget.incident_created` was published inside the savepoint. It is now deferred to after commit, like `budget.exhausted`.
  - New or extended tests: `[Codex P1]`, and the rolled-back-savepoint test now also asserts no incident live event. Mutations **M14** and **M15** turn them red.
  - The full mutation table (**15 rows**) was re-run on this code, and every row turns a named test red. The seam suite is now **18** tests.
  - The E3-D-ACC decision records both corrections.
- **Reviewed revision: `9e80493e59fcd949cdaa9a09b206c4cb9c85f58d`.** This is the last commit carrying code and register changes. It is the **parent** of the commit that adds this addendum, and that child changes only this file. Both will be ancestors of the program tip after a `--merge` merge of PR #547.
- **Run `35596364653` on `9e80493e59fcd949cdaa9a09b206c4cb9c85f58d`:** `ci-required` **success**.
  - `verify (3)` executed `job-accepted-event-seam.integration.test.ts` **(18 tests)** and `job-control-sweeper-pending-projections.test.ts` **(4 tests)**.
  - `verify (2)` executed `job-budget-cost-parity.integration.test.ts` **(13 tests)**.
- **Codex** reviewed `9e80493e59`: no major issues. Both review threads are resolved.
- **Superseded as evidence:** run `35591911282` on `9f26bb9cb` (previous addendum) and run `35586672944` on `a3d1db483` (the original section). Both sections are kept as written.

