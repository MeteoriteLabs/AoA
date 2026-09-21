# E10 Desktop / migration / realtime — decisions

Epic-local decisions. Product-wide decisions are promoted to `docs/architecture/decisions.md` and
linked here.

**Created 2026-09-21 by `MIG-009` (M1a).** The E10 implementation plan (§0, and §8.1 twice) records
that this epic had no `decisions.md` while `artifact-policy.md`'s epic-folder contract requires one,
and §8.1 owes two decisions to it. Both are below. They are **decided under founder delegation F2**
(`scope-triage.md`, "M1 rulings": the founder delegates every M1 decision to the planning session,
which records each with its reason); the trigger grain they build on is founder ruling **F6**.

No entry here changes a wire contract, a schema, a migration, `packages/worker-protocol`, or the
drain service (`server/src/services/job-distributed-drain.ts` and its store are unmodified).

## E10-D001 — The drain trigger fails on a thrown cancel by reading a per-attempt ledger at the adapter seam; there is no convergence recheck

- **Date (UTC):** `2026-09-21`
- **Status:** `locked` — decided under founder delegation **F2**, for `MIG-009` (M1a).
- **Context.** `drainAll` (`createDistributedExecutionDrain`, `job-distributed-drain.ts`) wraps each
  per-attempt `requestCancellation` in a bare `catch { }` that records neither a skipped
  Organization nor a failed attempt, and still pushes that Organization as `skipped: false`. A
  trigger whose exit code read only `skippedOrganizations` would therefore exit 0 while work is
  still active — the rollback rehearsal would pass on a dead lever. E10 plan §8.1 offers two
  remedies and requires this file to say which:
  1. **Widen the result contract** so failed cancellations are reported and the trigger fails on
     them.
  2. **A terminal-state recheck with a bounded convergence wait**, which must distinguish
     `cancel_requested` at the deadline (a convergence timeout) from a cancel that never happened.
- **Decision.** Option 1, **realized at the drain's existing dependency seam rather than in the
  service.** The trigger's `requestCancellation` adapter (`createAuditedDrainCancellation`,
  `server/src/services/distributed-execution-drain-trigger.ts`) observes every cancel **before**
  `drainAll` swallows it, records `{organizationId, companyId, jobId, error}` in a per-run ledger,
  and re-throws, so `drainAll` still does not count the attempt as drained. The trigger's report is
  `DistributedExecutionDrainResult` **plus** that ledger (`failedCancellations`, and `failedJobIds`
  on each Organization's line), and `drainExitCode` returns non-zero if **either**
  `skippedOrganizations` or the ledger is non-empty. There is **no** post-sweep re-read of attempt
  state.
- **Reasons.**
  - **The service may not be edited.** §8.1 makes an edit to `job-distributed-drain.ts` a STOP.
    Widening `DistributedExecutionDrainResult` itself would be that edit. The adapter seam
    delivers the same information — every thrown cancel, attributed to its Organization and job —
    without it, and it is where the trigger's other obligations (the audit write, the tenant
    binding, the `commandId`) must live anyway.
  - **Option 2 answers a different question.** A recheck measures *convergence* (did the worker
    act on the request), not *whether the request was made*. `requestCancellation` returns `queued`
    and leaves a leased attempt `cancel_requested`, which `listActiveAttempts` still returns, so a
    recheck is only honest with a bounded wait whose length is set by worker liveness. That would
    make the rollback's exit code depend on the fleet's health at the moment of the rollback, and
    the rehearsal would acquire a timing parameter it does not need. The ledger reports the thing
    the dead lever hid — a cancel that did not commit — directly and synchronously.
  - **Convergence is not abandoned; it is someone else's.** A `cancel_requested` attempt is
    finished by the worker (on its next renew or control ACK) or by the reaper when its lease
    expires (`reapExpiredLeases`). That machinery already exists and is not the trigger's to
    re-implement.
- **Consequences.**
  - A clean drain whose leased attempts are still `cancel_requested` exits **0**. This is pinned by
    the plan's second RED test (`SILENT-CANCEL (ii)` in `drain-distributed-execution-cli.test.ts`,
    and the leased-attempt arm of `job-distributed-drain.integration.test.ts`), which is the
    positive control that fails a naive recheck.
  - A thrown cancel exits **1**, attributed to its Organization. Pinned by `SILENT-CANCEL (i)`,
    which was RED against a trigger that read only `skippedOrganizations`.
  - The trigger does **not** report convergence. If a later milestone needs "and every attempt is
    terminal", that is a separate, bounded, explicitly-timed check and needs its own decision.

## E10-D002 — Each attempt's cancel and its actor-attributed `job.drain.requested` row commit in ONE tenant transaction; the actor is the declared CLI operator

- **Date (UTC):** `2026-09-21`
- **Status:** `locked` — decided under founder delegation **F2**, for `MIG-009` (M1a); the per-attempt
  grain is founder ruling **F6**.
- **Context.** `job-distributed-drain.ts` imports no audit module, and the E9-F010 job-control audit
  helper (`recordJobDrainActivity`, `JOB_DRAIN_ACTION = "job.drain.requested"`,
  `server/src/services/job-control-audit.ts`) is composed only by the HTTP drain route's
  `requestDrain`. A CLI calling the service directly would cancel every active attempt in the
  fleet with **no** durable record of who did it. §8.1 offers two remedies: route the drain through
  the already-audited control surface, or compose an `activity_log` write for the invocation using
  `JOB_DRAIN_ACTION` and a CLI-operator actor. It also requires the write to be **atomic with the
  mutation it records**. Ruling F6 fixes the grain: `drainAll` cancels attempt by attempt across
  Organizations, so one fleet-wide atomic write is impossible and the audit is atomic with **each
  attempt's** cancel.
- **Decision.**
  1. **Compose the write; do not route through the HTTP surface.** For every attempt, the adapter
     opens ONE `runInTenant` transaction bound to **that attempt's own Organization**, reads the
     database clock, calls `repos.jobControl.requestCancellation` with the derived `commandId`, and
     — for every outcome except `not_found` and `job_terminal`, which mutate nothing — calls
     `recordJobDrainActivity(tx, …)` in the same transaction. A commit yields both the cancel and
     its row; any throw (including a failed audit insert) rolls back both and lands the attempt in
     the E10-D001 ledger.
  2. **The action is `JOB_DRAIN_ACTION` (`job.drain.requested`)**, as §8.1 directs, written through
     the existing helper so the row's shape (`entity_type = job`, `details = {organizationId, jobId,
     outcome, commandId, reason}`) matches the HTTP route's. `outcome` carries the cancellation
     status (`queued`, `already_requested`, `cancelled`), which is what distinguishes these rows
     from a route drain's; `reason` is the fixed `distributed_execution_rollback`.
  3. **The actor is `actorType: "system"`, `actorId: "operator-cli:<operator>"`**, where
     `<operator>` is the required `--operator` argument (1–128 characters of `[A-Za-z0-9._@:+-]`).
     A run without it is refused with exit 2 before any pool opens.
  4. **No live-event publish.** A CLI process has no subscribers; the durable row is the record.
- **Reasons.**
  - **Routing through the HTTP surface does not fit.** The route drives `requestDrain`, a different
    control (a graceful drain *command* that never finalizes an unleased job) keyed per job behind
    `assertOrgAdmin`; the rollback drain is `requestCancellation` across every admitted
    Organization. Driving the fleet through an HTTP board session would add an authentication
    surface to a break-glass path and still not give per-attempt atomicity with the drain's own
    cancel.
  - **Atomic, not best-effort.** A best-effort audit that is skipped on failure is permanently lost,
    and this programme has that failure class on record. The transaction is the replay guard, as it
    is for `requestDrain` (E9-F010).
  - **`system`, not `user`.** The CLI cannot authenticate a board user: the declared operator is a
    **label**. Recording it as a `user` actor would claim an identity the code never verified. The
    real authority to run the command is possession of the owner, `aoa_app` and `aoa_operator`
    database credentials, and the row says honestly who *claimed* to run it and through which
    entrypoint. A verified operator identity belongs with the kill-switch UI (REL-005).
  - **Tenant binding per attempt (ruling F10).** The Organization is taken from the attempt the
    drain is cancelling — never from process state or a first-seen Organization — so each tenant's
    attempts are cancelled, and audited, under that tenant's own RLS binding.
- **Consequences.**
  - Every drained attempt has exactly one `job.drain.requested` row per trigger run that touched it
    (a re-run over a still-`cancel_requested` attempt writes a second row with outcome
    `already_requested` and queues no second command).
  - An attempt whose audit insert fails is **not** cancelled by that run, and the run exits 1.
  - The actor is attributable but not authenticated. That is stated in the runbook
    (`docs/deploy/environment-variables.md`, "Step 3").
