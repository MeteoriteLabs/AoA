# E3 Durable job control — decisions

Epic-local decisions. Product-wide decisions are promoted to
`docs/architecture/decisions.md` and linked here.

**Created 2026-09-21 as a shell (M1 Step 0, S0-3).** The M1 execution plan
(`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §4) records decisions into this file, and its
adversarial review found that the file did not exist.

---

## E3-D-ACC — the in-transaction accepted-event seam

**Status:** `accepted` — approved 2026-09-21 by the planning session under founder delegation F2,
**with three changes**. They are recorded in "Approval and amendments" at the end of this decision,
and each supersedes the text it names; that text is kept, not rewritten. *History: recorded as
`proposed` in commit `a377abfcc`; superseded text: "This is `JOB-016`'s first commit. It **binds
nothing until a distinct reviewer approves it**, and no build starts before then."* Parts (a) and (b), and the points listed
under (d), were **decided under founder delegation F2**. The planning session decided part (c) at
S0-8; it is restated here, not re-decided. The question is in `implementation-plan.md` §4b,
`JOB-016`. Everything was measured at program tip `ba534b16b`. Code is cited by file and symbol;
line numbers are hints only.

### The facts the decision rests on (verified at source)

- `acceptEvent` (`packages/db/src/repositories/tenant/job-control.ts`, `createJobControlRepository`
  → `acceptEvent`, ~:4164) calls `guardActiveFence` **once**, at the top. That call locks
  `leases` and `job_attempts` `FOR UPDATE`. Every check that can reject the batch then runs
  **before any write**: (1) the digest check, (2) the gap check, (3) the replay-region id/digest
  check, and the reused-event-id check on the new tail. Next, `acceptEvent` inserts the new tail.
  Finally it loops over the **new tail only**. For each event it applies `attempt_started` or
  `attempt_terminal` (`applyProjectionForFence`), then the SVC-003 `serviceProjection`
  (`applyServiceProjectionForFence`). Replay-region events never enter the loop.
- The frozen batch schema (`workerEventBatchV1Schema`, `packages/worker-protocol/src/events.ts`)
  requires contiguous sequences and unique ids. It does **not** forbid events after a `terminal`
  event in the same batch.
- `recordGovernedProjection` and `markGovernedProjectionApplied` each call `guardActiveFence` again.
  Once the loop has applied `attempt_terminal`, both throw `attempt_terminal`.
- `priceAcceptedUsage` (`server/src/services/job-budget-cost-bridge.ts`, `jobBudgetCostBridge`)
  opens `runInTenant(appDb, …)` and calls `lockActiveFence`. That is a second transaction waiting
  on a lock the ingest transaction already holds, so registering the bridge as it stands deadlocks.
- `usagePayloadV1Schema` carries **units only**: `inputTokens`, `outputTokens`,
  `cachedInputTokens` and `runtimeMillis`. It has no model and no price. The server resolves the
  model in `resolveAuthoritativeRate` (`job-authoritative-rate.ts`) from the job's
  `SubmitJobSource`, which the server stored at submit in `jobs.source_intent`
  (`job-submission.ts`, `submitJobWithinTenant`). `resolveAuthoritativeRate` throws
  `JobBudgetCostRateError` for an unknown model.
- `job_projection_receipts.target_aggregate_id` is `NOT NULL`
  (`packages/db/src/schema/job_projection_receipts.ts`). When there is no aggregate row to link, the
  `task_terminal` kind already records `targetAggregateId = attemptId` with
  `aggregateKind = 'job_attempts'` (see the `GovernedProjectionKind` doc in `job-control.ts`).
- On postgres-js, calling `.transaction()` on a transaction handle opens a SAVEPOINT, and that
  savepoint can roll back on its own (`server/src/db/tenant-context.ts`, `runInTenant` doc,
  JOB-010). The tenant GUC is transaction-local, so a savepoint inherits the Organization context.
- `requestCancellation` takes locks in the global order lease → attempt → job (see its header
  comment). That is the order the ingest guard already holds, so calling it inside the ingest
  transaction adds no lock inversion.

### (a) Transaction-taking cores — DECIDED

Each bridge gains a **core** with the contract below. The seam calls the core.

- The core takes the caller's handle, `{ tx, repos, organizationId }`. It **never** opens a
  transaction. It **never** calls `lockActiveFence` or `guardActiveFence`, either directly or
  through `recordGovernedProjection` or `markGovernedProjectionApplied`. It **never** reads or
  writes a projection receipt, and it **never** reads a feature flag. It writes the aggregate and
  returns `{ targetAggregateId }` plus its bridge-specific outcome.
- For JOB-016 the core is `priceAcceptedUsageCore` in `job-budget-cost-bridge.ts`.
  - Input: `{ source, organizationId, companyId, jobId, acceptedEventId, units, projectId, occurredAt }`.
  - Steps: `resolveAuthoritativeRate` → `chargeOnce` → `budgetService(tx).evaluateCostEvent` →
    `repos.jobControl.requestCancellation` when `hardStopBreached`.
  - Returns `{ costEventId, costCents, incidentCreated, cancelled }`.
  - It takes no `BridgeActor`, because `companyId` is the only actor fact it uses.
- The existing `priceAcceptedUsage` becomes a thin wrapper, and its **public shape does not
  change**. The wrapper runs `assertEnabled` → `resolveAdmissibleOrganization` → `runInTenant` →
  `lockActiveFence` → receipt fast-path → core → `recordGovernedProjection(applied)`. The lock and
  receipt steps are legitimate there because the wrapper is its own transaction. The JOB-012 parity
  suite (`job-budget-cost-parity.integration.test.ts`) must pass unchanged.
- `JOB-017` gives `jobAuditBridge` and `jobOutputBridge` cores under the same contract.

**Why the core does not write the receipt.** Writing a receipt through `recordGovernedProjection`
re-guards the fence. After a terminal event in the same batch, that re-guard throws, and it is also
the re-lock that (a) forbids. Moving receipt writes into the seam (b) has a second benefit: every
registrant gets the same idempotency and failure receipt without having to implement them.

### (b) Where the seam lives — DECIDED: (b1), as a batch-level projector list

**Chosen: (b1).** `AcceptEventBatchInput` gains an optional field,
`acceptedEventProjectors?: readonly AcceptedEventProjector[]`. The server decides the list, and the
repository applies it inside the existing per-event loop. This is the same inversion as
`serviceProjection`: the server decides, and `packages/db` applies without importing server code.
The field is a **batch-level list of registrations** rather than a per-event field, because a
registration belongs to the ingest, not to any one event. The contract, in `packages/db`:

```ts
interface AcceptedEventProjector {
  projectionKind: "authoritative_cost" | "activity_audit" | "output_projection";
  aggregateKind: string;
  /** null = this projector does not apply to this event. */
  sourceIdentity(event: AcceptEventInput, fence: ActiveFenceRequest): string | null;
  /** Runs inside a SAVEPOINT; `tx` is the savepoint handle. */
  apply(ctx: { tx: Db; event: AcceptEventInput; fence: ActiveFenceRequest }):
    Promise<{ targetAggregateId: string }>;
}
```

The repository handles each event in the **new tail** in sequence order. It does the following
**before** that event's `attempt_started` or `attempt_terminal` projection, for each projector
whose `sourceIdentity` is non-null:

1. **Receipt already exists.** If a receipt exists for
   `(organization, company, projectionKind, sourceIdentity)`, the outcome is `replayed` and nothing
   runs.
2. **Event follows a terminal in this batch.** If this batch has **already** applied
   `attempt_terminal`, write the `pending` receipt described in (c) and do not run `apply`. The
   outcome is `pending`.
3. **Otherwise.** Open a savepoint, run `apply`, and insert the `applied` receipt in the same
   savepoint, using the `targetAggregateId` that `apply` returned. The outcome is `applied`. If
   anything throws, roll back the savepoint and write the `pending` receipt described in (c). The
   outcome is `pending`.

`acceptEvent` returns the per-event projector outcomes alongside `serviceProjections`. Each outcome
is `applied`, `replayed` or `pending`, and a `pending` outcome carries the error class. The ingest
logs these outcomes and records metrics for them. The ACK is never derived from them. When no
projectors are passed, the loop does nothing new and the ingest is byte-identical to today.

**Why (b1) and not (b2), measured against the code:**

| | (b1) projector list in `acceptEvent` | (b2) split into two `acceptEvent` calls |
|---|---|---|
| All-or-nothing batch ACK | **Kept.** Every rejecting check still runs before any write, as today. | **Broken** unless rebuilt. A `hash_mismatch` or reused id in the terminal half is found only by call 2, after call 1 has already written the prefix, so the ACK would report a rejection with an advanced `acceptedThroughSeq`. Keeping today's ACK would need either a second copy of the repository's integrity checks in the server, or a savepoint around call 1, the projectors and call 2. |
| "A replay re-runs nothing" (d) | **Holds by construction.** The loop sees only the new tail, and the receipts are a second line of defence. | The server must read `acceptedThroughSeq` first and re-derive the new tail, which is a second copy of the repository's replay logic. |
| Failure savepoint and receipt | **In one place** (the repository), so `JOB-017` and `CLI-014` cannot register without it. | At each call site in the server, so every registrant must repeat it. |
| An event after `terminal` in the same batch | Handled explicitly (step 2). | Call 2 carries the terminal plus any later events. Their projectors have no live fence to run under, and nothing handles that. |
| Cost | `packages/db` gains a function-typed input plus the savepoint and receipt logic. | `packages/db` is untouched, but the server must merge `serviceProjections`, the ACK and two fence guards. |

The one thing (b2) buys is leaving `packages/db` unchanged. That does not justify a changed ACK
contract or two copies of the append-integrity rules.

**Residual risk accepted with (b1).** A projector's `apply` receives only the savepoint handle, but
TypeScript cannot stop a registrant from closing over the outer `tx`. The rule is that a registrant
builds its repositories from `ctx.tx` only (`tenantRepositories(ctx.tx)`). The JOB-016 test injects
an `apply` that writes through `ctx.tx` and then throws. It asserts that the append committed and
that the write rolled back.

### (c) Failure semantics — DECIDED at S0-8 (restated, not re-decided)

When a projector fails, only its own savepoint rolls back. The projector's receipt is then written
**in the outer ingest transaction** with `status = 'pending'` and `applied_at` NULL. There is **no
`failed` status** and no schema change. The reasons were verified at S0-8 and re-verified now:

- `job_projection_receipts_status_check` admits only `pending` and `applied`.
- `jobBudgetCostBridge.assertRollbackSafe` counts only `pending` `authoritative_cost` receipts. A
  `pending` unpriced charge therefore **blocks** the `MIG-009` drain (`job-distributed-drain.ts`),
  while a `failed` one would slip past it.

This decision adds the following details:

- **The pending receipt's target.** There is no aggregate row to point at, so the receipt records
  `targetAggregateId = attemptId` and `aggregateKind = 'job_attempts'`, following the
  `task_terminal` precedent. `sourceDigest` is the event's recomputed digest, which is already
  64-hex.
- **The pending-receipt write has its own savepoint.** If that write also fails, only it rolls back.
  The outcome is reported as `unrecorded`, with a warn log carrying the attempt's ids, and the append
  still commits. The append is never the thing that fails.
- **The wrapper's fast-path must check status.** Today `priceAcceptedUsage`'s fast-path returns any
  existing receipt as `replayed` with `costEventId = targetAggregateId`. For a `pending` receipt,
  that would report the attempt id as a cost row. The wrapper will return `pending` for a pending
  receipt instead.
- **The detector.** A per-Organization read (`runInTenant`) runs on the `JOB-006` sweeper's
  Organization rotation (`server/src/services/job-control-sweeper.ts`). It selects `pending`
  receipts older than a stated threshold (default 15 minutes, configurable), grouped by Company and
  `projectionKind`, with the job and attempt ids. It emits one warn log per stale receipt; the ids
  ride the logger spine and never become a metric label. It also emits a count-only metric by
  `projectionKind` (`job-control-metrics.ts`).
- **Consequence.** A `pending` receipt that never resolves holds that Organization's drain until an
  operator re-drives or resolves it, which is why the detector is required. The re-drive path itself
  is the open question at the end of this decision.

### (d) Same-transaction cases, and the two points the task asks this decision to record

**Same-transaction cases.** In a single batch, usage-then-terminal and cancel-then-terminal both run
their projectors in step 3, before the loop reaches `attempt_terminal`. They run under the one guard
that `acceptEvent` already took, so nothing re-guards and nothing throws `attempt_terminal`. A
replayed batch never enters the loop. If one ever did, the identity `cost:{company}:{eventId}` is the
receipt-table guard.

**Terminal-without-usage signal (acceptance 4).** The check fires when an ingest accepts a **new**
terminal event (the existing `resolveAttemptTerminalSignal` condition) and pricing is registered for
the Organization. In the same transaction, the ingest checks whether `job_events` holds any `usage`
event for that attempt. If there is none, it emits two things **after commit**:

- a structured warn log with the closed classification `terminal_without_usage`, carrying
  `organizationId`, `companyId`, `jobId`, `attemptId`, `terminalStatus` and `sourceKind`;
- a count-only metric increment with outcome `terminal_without_usage`.

The signal is **not** a `pending` receipt. A terminal with no usage often owes no charge: the
attempt may have been cancelled before it started, it may have expired, or the workload may not use
a model. A pending receipt would wedge the drain on every such attempt.

**Next-dispatch refusal (acceptance 3).** The refusal rides the existing submit-time admission.
`submitJobWithinTenant` (`job-submission.ts`) calls `admitAttemptCapacity`
(`server/src/services/org-concurrency.ts`) with `defaultCapacityBudgetBridge`. Its
`preflightOneShotCliSpend` sums the Company's `cost_events` for the month against the Company's
hard-stop policy, and on a breach the submit fails with 429 `"Organization budget hard-stop
reached"`. The refusal takes effect as soon as the seam writes a priced row, so JOB-016 changes no
admission code. It has two stated limits:

1. It is **Company-scoped**. Agent and department hard-stops are not refused at submit. At that seam
   `budgetAwareCapacityBridge` also degrades to the Company gate, and it has no production caller.
2. An attempt that was **already admitted and queued** before the breach is not re-checked at lease.
   Only the breaching job gets `requestCancellation`.

### Build-shaping points fixed by this decision

- **Charge time is server time.** The core's `occurredAt` is the server's acceptance time, never
  the worker's `event.occurredAt`. The budget window is keyed on `occurredAt`, so a worker-supplied
  time could back-date a charge out of the current month's hard-stop.
- **Tenant scoping of the charge (F10).** `cost_events` has no RLS (E2-D03), so the seam must do the
  scoping itself:
  - `companyId` and `organizationId` come from the lease the guard locked, never from the worker.
  - The core asserts `companies.organization_id = organizationId` before writing.
  - `source` is parsed from `jobs.source_intent` with `submitJobSourceSchema`; a parse failure
    produces `pending`.
  - `resolveAuthoritativeRate`'s `task_run` agent lookup gains the filter
    `agents.company_id = companyId`.
  - For `task_run`, `projectId` is `issues.project_id`, read with `company_id = companyId`. For
    every other source it is `null`.
- **The switch.** It has two dimensions, and both default to off:
  - a deployment flag, `AOA_DISTRIBUTED_USAGE_PRICING_ENABLED`, in
    `server/src/config/distributed-execution.ts`, which requires
    `AOA_DISTRIBUTED_EXECUTION_ENABLED`;
  - a per-Organization key, `usagePricing: true`, on the Organization's entry in
    `AOA_DISTRIBUTED_EXECUTION_ROLLOUT` (`distributed-execution-rollout-source.ts`). An absent key
    means off, so every existing config is unchanged.

  The ingest passes the pricing projector only when both are on for the batch's Organization.
- **Composition.** `createJobEventIngestService` takes a projector resolver. The resolver is built
  in `server/src/index.ts`, inside the `config.distributedExecutionEnabled` block, and passed
  through `workerControlRoutes`.

### Open question for the reviewer (not decided here; it goes beyond the ticket's brief)

**How is a `pending` `authoritative_cost` receipt re-driven?** Acceptance 6a's positive control
"re-drives the receipt to `applied`", and (c) says an operator re-drives it. But **no re-drive path
exists today**: `markGovernedProjectionApplied` has no production caller, and every existing receipt
mutator is fence-gated. A fence-gated mutator cannot work once the attempt is terminal, so any
re-drive is a new **unfenced** write into governed state.

- **Recommendation.** `JOB-016` builds one narrow tenant-repository method. It locks the `pending`
  receipt row `FOR UPDATE`, so the receipt lock stands in for the dead fence. It re-reads the units
  from the `job_events` row that the identity names, runs `priceAcceptedUsageCore`, and flips the
  receipt to `applied` with the `cost_events` id. It can be called from a script or a test and has
  **no HTTP route**, because an operator route belongs to the `JOB-008` surface.
- **Alternative.** 6a's positive control flips the row directly in the test, and the re-drive is
  left to a follow-up. That leaves the drain wedge with no production way out.

### Approval and amendments (2026-09-21, planning session, founder delegation F2)

Accepted as proposed: (a) the transaction-taking cores, with receipts in the seam; (b1) the projector
list with one savepoint per projector, the replay check before running, `applied` in the same
savepoint and `pending` on a throw; `pending` directly for an event after a terminal; server time as
the charge time; tenant scoping from the locked lease with the Company checked against the
Organization; `pending` receipts pointing at the attempt; the wrapper's fast-path checking receipt
status; and the terminal-without-usage signal as a log line plus a count-only metric, not a receipt.
Three changes:

**Amendment 1 — no pricing switch.** *Supersedes "The switch" under "Build-shaping points".* There is
no `AOA_DISTRIBUTED_USAGE_PRICING_ENABLED` flag and no per-Organization `usagePricing` key. Reason (the
planning session's): a switch that allows distributed spend with pricing off recreates `E3-F037`
through configuration; the rollback lever is the rollout dial itself. The planning session's rule is
"pricing is always on for an Organization whose rollout mode is `active` or `canary`".

*How the build implements it (the author's reading, ★ **ACCEPTED 2026-09-21 — see the dated note
below; this parenthesis originally read "flagged for review"**):* the pricing projector is
registered by `createJobEventIngestService` itself, on **every** ingest, without consulting the
rollout dial. The ingest exists only when distributed execution is composed, and a `usage` event can
only be accepted under a live lease, so every accepted `usage` event is distributed spend. Reading
the dial as well would leave an in-flight attempt unpriced after its Organization is dialled back to
`shadow` mid-run — the same gap by another route. This is strictly stronger than the rule and
satisfies its test (a `canary` Organization is always priced).

★ **Corrected 2026-09-23 (record custodian): the "flagged for review" label was stale — the reading
was ACCEPTED on 2026-09-21 and the acceptance was only ever recorded in the ticket's result record.**
`JOB-016-result.md` § *Accepted deviations (planning session, F2)* item 1 reads: *"**Pricing is
registered on every ingest.** This is broader than the rule 'always on for an `active`/`canary`
Organization'. Reading the rollout dial would leave in-flight spend unpriced after an Organization is
dialled back mid-run."* The distinct reviewer then recorded the same gap and concurred: *"`decisions.md`
E3-D-ACC Amendment 1 still labels the build's reading 'the author's reading, flagged for review'. The
planning session's acceptance is recorded only in this result record. … registering on every ingest is
strictly stronger than 'on for `active`/`canary`' … I accept it."* Verified at source at HEAD:
`createJobEventIngestService` (`server/src/services/job-events.ts`) builds its
`acceptedEventProjectors` list with `createAcceptedUsagePricingProjector`
(`server/src/services/job-accepted-usage-pricing.ts`) unconditionally — no flag, no dial read.
**Nothing about Amendment 1's rule changes**; this note moves the acceptance into the decision record
where it belongs, and the original parenthesis is quoted above rather than erased.

**Amendment 2 — after a hard-stop breach, nothing more in that scope is leased.** *Supersedes stated
limit (2) under "Next-dispatch refusal".* Measured at source, the legacy path on a hard stop does:

| Scope | Legacy behaviour | Where |
|---|---|---|
| agent | incident; an `approvals` row; **agent `status = 'paused'`**; `emitBudgetExhausted` → cancels that agent's `queued`/`running` heartbeat runs | `createIncidentIfNeeded` and `evaluateCostEvent` (`budgets.ts`); `heartbeat.cancelBudgetScopeWork` via `onBudgetExhausted` (`index.ts`) |
| agent (legacy field) | `agents.budget_monthly_cents` reached → agent paused | `costService.createEvent` (`costs.ts`) |
| company | incident; `emitBudgetExhausted` → cancels **every** `queued`/`running` heartbeat run in the Company | same |
| department | incident only; no pause, no emit ("`BudgetEnforcementScope` has no department variant") | `evaluateCostEvent` |

The distributed charge already runs `evaluateCostEvent` and the existing cost writers, so the
incident, approval, agent pause and `emitBudgetExhausted` already fire on the distributed path. What
legacy's cancel does **not** reach is a queued distributed job: `cancelBudgetScopeWork` enumerates
`heartbeat_runs` only. So, in the same savepoint as the charge, the pricing core cancels the
**queued** distributed jobs of each breached scope, through the existing `requestCancellation`
(which finalises a lease-less job and its attempt to `cancelled` and releases the capacity slot —
the legacy-equivalent state, since legacy cancels the queued run): **company** → every `queued` job
of the Company; **agent** → every `queued` `task_run` job whose `source_intent.assigneeAgentId` is
that agent; **department** → none, matching legacy. `evaluateCostEvent` gains an additive
`breachedScopes` return so the core knows which. A cancelled job is not a lease candidate, so it is
never leased. Jobs are cancelled in job-id order, so two concurrent breaching ingests in one Company
lock the same rows in the same order; queued jobs hold no lease, so no lease is locked out of order.

**No lease-time check is added.** Two reasons: the scope cancel leaves no queued job in the scope to
lease, and a lease-time check is a second repository selection inside the frozen JOB-003 poll chain,
which the JOB-003 contract (`job-leasing-contract.test.ts`) forbids — the JOB-007 note at the offer
point in `job-leasing.ts` deferred live capacity for the same reason. **Residual race, stated:** a
poll that has the queued attempt locked at the instant of the cancel offers it first; the cancel then
waits on that lock and marks the attempt cancelled, so the worker's ACK finds the attempt no longer
`offered` and is refused (`activateLeaseAck`). No such attempt reaches `leased`. A job submitted
concurrently with the breach, before the priced row commits, is admitted by the Company preflight
and cancelled on its own first charge — the same window legacy has. Running jobs in the scope are
not cancelled from the ingest transaction (locking another job's live lease there risks a
lease-order cycle with that job's own ingest); a running `task_run` is reached by legacy's
`cancelBudgetScopeWork` through its heartbeat run, and every running job is cancelled by its own
next charge.

**Amendment 3 — the re-drive path is built.** *Resolves the open question above, with the
recommendation.* One narrow tenant-repository method locks the `pending` receipt row `FOR UPDATE`,
the units are re-read from the stored `job_events` row the identity names, `priceAcceptedUsageCore`
runs, and the receipt flips to `applied` with the `cost_events` id. No HTTP route. The `JOB-006`
job-control sweeper invokes it for stale `pending` `authoritative_cost` receipts on its
per-Organization rotation, with a bounded number of attempts (`AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS`).
After the bound, it raises **one** Inbox item per stuck receipt through the existing hub path
(`hubItemsService.emit`, idempotent on `sourceType`+`sourceId` = the receipt id) and stops retrying
that receipt. The attempt counter is process-local; the stop is durable (the sweeper skips a receipt
whose hub item exists), so a restart cannot raise a second item or resume retries.

### As-built notes (JOB-016 build commit)

Where the build differs in detail from the text above, the code is the truth and this records it:

- **The count-only telemetry is not on `JobControlMetrics`.** That interface is JOB-003's frozen,
  closed plan contract (`job-control-metrics.test.ts` pins its exact member set). The accepted-usage
  counts use their own closed, id-free emitter, `createPinoAcceptedUsageTelemetry` in
  `server/src/services/job-accepted-usage-pricing.ts`, event `job_control.accepted_usage`.
- **The Amendment 2 scope cancel excludes a queued job that already has a live lease.** The ACK
  leaves `jobs.status = 'queued'` until `attempt_started`, so "queued" alone would include jobs a
  worker holds; `listQueuedJobIdsForBudgetScope` filters them out, which is what keeps the cancel
  from locking another attempt's lease inside an ingest transaction.
- **Constants:** `AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS = 3`,
  `STALE_PENDING_RECEIPT_THRESHOLD_MS = 15 minutes`.

- **E3-F037 owner re-pointed to `DEP-016` (2026-09-21, planning session, F2).** `JOB-016` ships the
  seam and pricing; the finding closes at `DEP-016`'s end-to-end cost assertion, which also needs
  `WRK-018`'s producer and its keyed E2B parser acceptance (`scripts/finding-ownership.json`).
- **Budget-exhausted signal deferred to after commit (post-review, Codex P2).** The in-process
  `budget.exhausted` listener cancels live heartbeat work, so the core never emits it; callers emit
  the returned `exhaustedScopes` only after their transaction commits (the ingest: only for events
  whose seam outcome is `applied`). `evaluateCostEvent`'s `deferExhaustedEmit` is additive.
- **Amendment 2 corrected — an OFFERED lease is cancelled too (post-review, Codex P1).** The
  scope cancel above said "queued, lease-less" jobs, and the as-built note excluded any job with a
  live lease. That let a worker holding an un-ACKed offer ACK after the breach, because
  `jobs.status` stays `queued` until the ACK. `listQueuedJobIdsForBudgetScope` now excludes only
  an ACTIVE lease. An offered lease has no ingest holding it, since the fence guard admits only an
  active lease, so locking it cannot cycle against an ingest. `requestCancellation` marks the
  attempt `cancel_requested`, and `activateLeaseAck` then refuses the ACK. A job with an ACTIVE
  lease is still left to its own next charge. The earlier wording is kept above as the record.
- **Incident live events deferred too (post-review, Codex P2).** `createIncidentIfNeeded`
  published `budget.incident_created` inside the savepoint. Callers on the seam now pass a
  `deferLiveEvents` collector. The core returns the events with `exhaustedScopes`, and
  `flushDeferredBudgetSignals` performs both only after commit.
- **The re-drive is generalized to every seam receipt kind (JOB-017, 2026-09-21, planning-session
  ruling under founder delegation F2).** *Amends (c) and Amendment 3, which named only
  `authoritative_cost`; that text is kept above.* The ruling: a `pending` `activity_audit` receipt
  with no re-drive means the event is accepted and durable but its audit row is permanently lost,
  which is the programme's lost-audit class. A `pending` `output_projection` receipt means the output
  silently never appears. Surfacing either through the detector is not enough. As built:
  - **One dispatcher, not a fork.** `redrivePendingProjection`
    (`server/src/services/job-accepted-usage-pricing.ts`) is keyed by receipt kind over
    `REDRIVABLE_PROJECTION_KINDS` = `authoritative_cost`, `activity_audit`, `output_projection`.
    The JOB-016 name `redrivePendingAuthoritativeCost` is kept, as the same function, because the
    composition root and the Amendment 3 tests call it.
  - **Each kind uses the seam's own mapping.** The re-drive locks the `pending` receipt row
    `FOR UPDATE` and re-reads the stored `job_events` row that the identity names. It then runs the
    same function the seam registration runs: `priceAcceptedUsageCore`, `applyAcceptedEventAudit` or
    `applyAcceptedOutputEvent`. Finally `resolvePendingProjectionReceipt` flips the receipt to
    `applied`. A re-driven row is therefore the row the seam would have written.
    `readAcceptedEvent` additively returns the stored sequence, attempt number and lease id, and the
    lease's worker from `leases`, so the audit re-drive never takes identity from the worker's
    payload.
  - **Same bound, same single Inbox item.** The JOB-006 sweep re-drives every re-drivable kind with
    the same bound, `AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS`. It then raises the same single,
    durable Inbox item through the same hub path. Only the copy is per kind: `budget_alert` for a
    charge, `run_failed` for an audit or an output.
  - **After commit only.** Owed live events (`budget.exhausted`, `budget.incident_created`,
    `activity.logged`) are performed only after the re-drive's transaction commits. A failed
    re-drive rolls back and owes nothing.
  - **Unchanged.** The MIG-009 drain still reads only `authoritative_cost` receipts, so a
    `pending` audit or output receipt does not hold the drain.


---

## E3-D-AUDIT-SET — the accepted mutations the seam audits (JOB-017)

**Status:** `accepted` — decided by `JOB-017` under founder delegation F2, as the task section
requires ("for a **named set** of accepted mutations recorded in `decisions.md`"). Measured at
program tip `fc2eb7dde`. Code is cited by file and symbol.

**The named set.** `createAcceptedActivityAuditProjector`
(`server/src/services/job-accepted-activity-audit.ts`, `ACCEPTED_ACTIVITY_AUDIT_ACTIONS`) audits
exactly two accepted event types. Each is a state mutation that the ingest itself performs inside
`acceptEvent` (`applyProjectionForFence`):

| Accepted event | The mutation it drives | Activity action |
|---|---|---|
| `attempt_started` | attempt `leased` → `running`, job `queued` → `running` | `job.attempt_started` |
| `terminal` | attempt driven to its terminal status | `job.attempt_terminal` (details carry `terminalStatus`) |

Each row carries `entityType = 'job'` and `entityId = jobId`, which is the `job.*` family that
`job-control-audit.ts` already uses for `job.submitted` and `job.drain.requested`. It also carries
`actorType = 'system'` and `actorId = 'worker:<workerId>'`, because a worker is neither a user nor an
agent, and `runId` is null. The details carry the Organization, job, attempt, lease, worker, event id
and sequence. The Organization and Company come from the fence the ingest guard locked, never from
the worker. `recordAcceptedActivityCore` refuses a Company that its Organization does not own
(`activity_log` has no RLS, E2-D03).

**What is outside the set, and why.**
- **Observations** are not accepted product mutations (JOB-013's rule): `log`, `progress`,
  `network_denied`, `browser_observation`, `browser_approval_requested`,
  `runtime_decision_requested` and the `service_*` events.
- **`usage`** already has a durable record on this seam: the `cost_events` row plus its
  `authoritative_cost` receipt, which the pricing registration (JOB-016) writes atomically. Legacy
  parity writes no activity row for a heartbeat charge; only the agent's own `POST /costs` writes
  `cost.reported`. An audit row whose content depended on a sibling projector's outcome would couple
  two savepoints, so a `pending` charge would leave the audit either false or owed.
- **`artifact_prepared`** already has a durable record on this seam: its `task_outputs` row and
  `output_projection` receipt (`E3-D-OUTPUT-MAP`).

The set is closed. Adding an entry is a new decision here, not an edit to the map alone.

**Stated residual.** `attempt_started` is conditional: it moves only a `leased` attempt. A second
`attempt_started` event with a new event id, on an attempt that is already running, is still a newly
accepted event, so it is audited even though it changed nothing. The worker protocol emits
`attempt_started` once per attempt, so no such event is expected.

**Re-drive (added 2026-09-21).** A `pending` `activity_audit` receipt is re-driven by the
generalized re-drive recorded in `E3-D-ACC`'s as-built notes, through this same mapping.

**Publication.** The live `activity.logged` event is published by the ingest only **after** its
transaction commits, and only for an `applied` outcome (`createJobEventIngestService`,
`owedActivityPublishes`). This follows the same after-commit pattern as JOB-016's Codex P2 fixes.

## E3-D-OUTPUT-MAP — what an accepted output event projects to (JOB-017)

**Status:** `accepted`, decided by `JOB-017` under founder delegation F2.

- **The event.** `artifact_prepared` is the only output event in the frozen protocol
  (`WORKER_EVENT_TYPES`). Its payload is `{ artifactId, kind }`, and `artifactId` is the identifier
  the worker committed through `commitArtifactVersion` (`artifact-commit.ts` passes
  `identifier: manifest.artifactId`).
- **When it is registered.** The output projection is registered only for a `task_run` job, because
  every other source has no task, and the JOB-014 contract is "no fabricated task IDs".
  `resolveAcceptedOutputProjector` (`server/src/services/job-accepted-output-projection.ts`) reads
  `jobs.source_intent` inside the ingest transaction, under the fence it holds, and only when the
  batch contains an `artifact_prepared` event. Because the read runs in its own savepoint, a failed
  read cannot abort the append. Instead, it registers a projector that records every output event of
  the batch as owed.
- **Provenance is fail-closed.** The event projects only if its `artifactId` names a **committed**
  `job_artifacts` row of the same Organization, job and attempt number. Otherwise the savepoint
  throws `ACCEPTED_OUTPUT_ARTIFACT_NOT_COMMITTED` and the seam writes a surfaced `pending` receipt.
  A worker that announces an artifact it never committed therefore projects nothing.
- **What it writes.** It writes one `task_outputs` row through `projectAcceptedOutputCore`, on the
  job's own task, with these fields:
  - `type = 'artifact'`;
  - `provider = 'aoa_distributed_job'`, a namespace that only this projector writes;
  - `externalId` = the committed row's **server-minted** id, so no worker-chosen string can upsert
    onto a platform or legacy row (the `E7-F020` residual);
  - `isPrimary = false` (forced by the core) and `reviewState = 'none'`;
  - `createdByAgentId` = the job's recorded assignee;
  - `artifactId = null`.
- **Re-drive (added 2026-09-21).** A `pending` `output_projection` receipt is re-driven by the
  generalized re-drive recorded in `E3-D-ACC`'s as-built notes, through this same mapping. For
  example, an event announced before its commit is visible projects once the commit lands.
- **Boundary with `CLI-014`.** Promoting a `job_artifacts` row into a product `artifacts` row, and
  folding `detectedFiles` into the run summary, belong to `CLI-014`. `CLI-014` reuses
  `projectAcceptedOutputCore`, and it replaces this minimal mapping at the same registration, under
  the same receipt identity `output:{company}:{eventId}`. It must not add a second output registration
  for the same event, because the seam's receipt identity admits only one.

## E3-D-TERMINAL-WINNER — `projectTerminalWinner` is retired (JOB-017)

**Status:** `accepted`, **decided under founder delegation F2** by `JOB-017`.

**Measured at `fc2eb7dde`: who writes each half today.**

| Half | The writer on the distributed worker path | Where |
|---|---|---|
| Attempt (and job) terminal state | the ingest: `acceptEvent` applies `attempt_terminal` through `applyProjectionForFence`, in the same transaction as the append | `packages/db/src/repositories/tenant/job-control.ts`, `acceptEvent` |
| Heartbeat run terminal + run summary (heartbeat canary) | the after-commit `onAttemptTerminal` hook → `createCanaryRunProjector`: `setRunStatus`, then step (4) `postRunSummary`, which `heartbeat.ts` binds to `postRunSummaryComment` | `server/src/services/canary-run-projector.ts`; the `postRunSummary:` binding in `server/src/services/heartbeat.ts` |
| Crew run terminal + run summary | `crew-terminal-projection.ts` → `releaseIssueLockAndLoopback` → `postCrewRunSuccess` / `postCrewRunFailure` (`crew-run-outcome.ts`, which calls `postRunSummaryComment`); the projector's own summary step is a deliberate no-op | `server/src/services/internal-agent/aoa-agents/crew-terminal-projection.ts` |

`completeAttempt` has **no** production caller: its only non-test caller is `projectTerminalWinner`,
and `projectTerminalWinner` has none either. This confirms the S0-3 note that the canary projector
does not call `completeAttempt`. The attempt is already terminal from ingest when the hook fires.

**Decision: retire.** The task offered to retire it or to rework it with a reason. It is retired
because both of its halves already have a single writer. Wiring it would create a second writer of
the run summary, racing the canary and crew projections, and it would call `completeAttempt` on an
attempt the ingest has already terminalized (it throws `attempt_terminal`). It is **retired in
place**, not deleted. The method stays because it is the subject of the DE-04 dormant-arm test, and
the threat-control register cites its `drainFenceGuardDenial` site. Deleting it would rewrite a
Critical crossing's evidence, which is outside this ticket. The retirement is made mechanical in two
ways:
- the interface carries `@deprecated` with this decision's id;
- a zero-production-caller guard (`job-output-parity.integration.test.ts`, "projectTerminalWinner
  is retired") fails if any non-test file outside `job-output-bridge.ts` references it. It has a
  positive control that the same scanner does find the method in tests.

No duplicate summary writer is created: the JOB-017 registrations write no `issue_comments` row and
no `task_terminal` receipt. The real-ingest test asserts both.


## E3-D-GEN-INVALIDATION — a target-generation advance INVALIDATES the attempts placed under the old one; the candidate predicate keeps its equality

**Status:** `accepted`, **decided under founder delegation F2**, 2026-09-24, on `E3-F041` as filed by
`DEP-021` (E6 `tickets/DEP-021-result.md` §5b).

**The question.** `E3-F041` measures that the lease-candidate predicate pins
`placement_target_generation` by EQUALITY against the polling worker's current target generation
(`packages/db/src/repositories/tenant/job-control.ts`, at each of its four candidate/claim sites),
that `advanceTargetGeneration` bumps `execution_targets.device_generation` on re-enrolment of an
already-bound worker while the target stays ACTIVE
(`server/src/services/worker-enrollment.ts`), and that the only convergence path
(`server/src/services/execution-target-revocation-fanout.ts`) is driven solely off
`execution_target_revocations` rows, which only `revokeExecutionTarget` inserts. So a device rotation
strands every already-placed `pending` attempt permanently and silently. Two fixes were offered: relax
the predicate to a FLOOR, or INVALIDATE the affected attempts on any generation advance.

**Decision: explicit invalidation, enqueued from `advanceTargetGeneration`. The floor is REFUSED.**

**Why the floor is refused.** It would let an attempt placed under an OLDER device generation lease
onto a ROTATED device — plausibly the precise property the equality pin exists to enforce. That trades
a CORRECTNESS guarantee (work runs on the device it was placed for) for an AVAILABILITY one, and the
defect is availability-only. Fixing a silent stall by weakening the guarantee that work runs where it
was placed is the wrong direction, and a weakened guarantee is very hard to restore later.

**Why invalidation is right.** It reuses machinery that already exists and already does the harder
half: the revocation fanout terminalises stranded lease-less attempts AND releases the held
Organization capacity slot with the same helper its lease pass uses. It keeps the generation pin
intact. And the codebase argues for it against itself — the fanout's own Phase-1b comment records that
a generation-pinned successor *"can never lease"*, that `guardActiveFence`'s `target_revoked`
*"never fires"*, that `countHeldAttemptsForOrg` *"pins an org slot forever"*, and that *"nothing else
reaps a lease-less nonterminal attempt."* Revocation was given a fanout for exactly this reason;
re-enrolment advances the same column on a live target and was given none. **That is an omission, not
a design**, and the fix is to make re-enrolment converge the way revocation already does.

### Two binding conditions on this ruling

1. **CONDITIONAL ON LIVE CONFIRMATION. No fix may be built against an unobserved defect.** `E3-F041`
   is a SOURCE-level measurement — the predicate, the bump site, and the absence of any convergence
   trigger — and has not been reproduced. Before the fix is implemented the defect must be observed:
   **re-enrol an already-bound worker while one of its jobs sits `pending` and placed, then assert the
   attempt is never offered, never terminalises, and that nothing is logged.** That reproduction is
   recorded in `E3-F041` before the owning ticket starts. A plausible chain is not a licence to change
   placement authority.
2. **THE CAPACITY LEAK IS PART OF THE FIX, NOT A FOLLOW-UP.** Whatever invalidates the attempt MUST
   also release the pinned Organization capacity slot. An invalidation that cures the stall and leaves
   `countHeldAttemptsForOrg` pinning a slot has fixed half the defect, and the owning ticket may not
   close on that half. The revocation fanout's existing release helper is the precedent and the
   expected mechanism.

**Severity is unchanged at HIGH** and the calibration in `E3-F041` stands: an ordinary supported
trigger, a permanent and silent effect, plus a capacity leak — but availability-only and
operator-initiated rather than tenant- or attacker-reachable, which is why it is not CRITICAL.

**Not relitigated by this decision:** the equality pin itself stays. Nothing here authorises relaxing
`placement_target_generation`, `placement_profile_hash` or `placement_provider_constraint_hash` at any
candidate site.
