# E3 Durable job control — decisions

Epic-local decisions. Product-wide decisions are promoted to
`docs/architecture/decisions.md` and linked here.

**Created 2026-09-21 as a shell (M1 Step 0, S0-3).** The M1 execution plan
(`docs/replatform/qa/2026-09-21-m1-execution-plan.md` §4) records decisions into this file, and its
adversarial review found that the file did not exist.

---

## E3-D-ACC — the in-transaction accepted-event seam

**Status:** `proposed`. This is `JOB-016`'s first commit. It **binds nothing until a distinct
reviewer approves it**, and no build starts before then. Parts (a) and (b), and the points listed
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
