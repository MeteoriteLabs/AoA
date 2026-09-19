# SVC-005b — the `drain` control-command producer (E9-F008, drain third)

**Epic:** E9 — Service agents. **Status:** design (no `-result.md`; this ticket ships with its slice).
**Closes:** the `drain` third of **E9-F008** (three frozen control-command kinds with zero producers).
**Does NOT close E9-F008** — `graceful_stop` and `checkpoint` remain zero-producer (see Out of scope).

## Why

E9-F008 measured that of the six frozen `CONTROL_COMMAND_KINDS`, three (`graceful_stop`, `drain`,
`checkpoint`) had **zero producers** — the wire, DB CHECK, and worker consumer all exist, but nothing
server-side emits them. For `drain` the consumer is fully wired in production: `applyOneControlCommand`
routes `commandKind === "drain"` to `handlers.drain(reason)` and `composeDispatchRuntime` wires that to
`pollLoop.stopLeasing()` (finish the in-flight attempt, stop taking new leases). The one gap was the
producer. Meanwhile the operator drain route (`POST .../jobs/:jobId/drain`) called
`requestCancellation({ graceful: true })`, emitting kind `cancel` — which *cancels* the in-flight
attempt, contradicting the route's name and the consumer that already existed.

## What ships (this slice)

1. **`requestDrain`** repo method (`packages/db/src/repositories/tenant/job-control.ts`), a sibling of
   `requestCancellation`: it queues ONE frozen `drain` control command on the job's live fence and drives
   **no** job/attempt status transition. Reuses `requestCancellation`'s exact lease→attempt→job `FOR
   UPDATE` lock order (so a concurrent reap/terminal-flush never deadlocks), monotonic per-lease
   `command_seq`, and `(org, lease, command_id)` idempotency.
2. **`requestDrain`** service wrapper (`server/src/services/job-reconciliation.ts`) — mints `commandId` +
   the DB clock `now`, exactly like the `requestCancellation` wrapper.
3. **`drainJob`** rewire (`server/src/services/job-operations.ts`) — the operator drain route now emits
   kind `drain` (a real graceful drain) instead of `cancel`.
4. **Docstring correction** (`JobControlCommandKind`, same file as (1)) — landed WITH the producer, so
   the E9-F008 §3 "record disagrees with the code" gap is not re-hidden.

## Invariants (pinned by the SVC-005b tests)

- (a) **No state transition.** A drain on a live lease leaves `jobs`/`job_attempts` status UNCHANGED
  (drain = "finish in-flight", not cancel).
- (b) **No finalize.** A drain on a job with no active lease returns `no_active_lease` and mutates
  nothing — UNLIKE `requestCancellation`, which finalizes an unleased job to terminal `cancelled`.
- (c) **Frozen wire, clean.** The body is the `drain` variant `{...base, commandKind:"drain", reason}` —
  it carries NO `graceful` key (that is the `cancel` variant); the worker-side strict schema rejects any
  extra key. No new wire op, no migration, no `GovernedControlCommandInput` widening.
- (d) **Idempotent + monotonic**, per `(org, lease, command_id)` and the per-lease sequence.
- (e) **Delivery is real** — a queued drain surfaces on `renewLease` in the `dev.aoa.job/control-v1`
  extension with `cancelRequested === false` (it reaches the drain HANDLER, not the cancel floor).

## Out of scope (why the finding stays open)

- **`graceful_stop` — NOT built (would be inert).** Its only consumer folds into the `cancelRequested`
  boolean floor (server renew mutator matches `cancel || graceful_stop`), so a `graceful_stop` producer
  delivers nothing beyond the existing `cancel(graceful:true)`. A non-inert `graceful_stop` needs a
  distinct deadline-aware consumer + an unforgeable ACK (E9-F009's route (b)) — a larger, separately-owned
  slice. `drain`'s `stopLeasing()` already IS the "finish in-flight" graceful behavior.
- **`checkpoint` — NOT built.** It is excluded from `job_control_commands_kind_check`, so it cannot be
  persisted at all without a `db:generate` migration widening the CHECK, and it has no consumer. Owned by
  SVC-004.

## Ownership note

E9-F008 stays `unowned` in `scripts/finding-ownership.json` with an updated reason (drain now produced;
graceful_stop + checkpoint remain). This ticket is **not** named as its owner: the ownership guard
tokenizes `SVC-005b` → `SVC-005`, which is already COMPLETE (`SVC-005a-result.md`), so naming it would
trip `owner_ticket_already_complete` (the same normalization the E9-F002 → SVC-009 carve avoided). The
finding closes only when all three kinds are produced/retired, at which point its key is deleted in the
same commit that flips its findings.md Status.

## Verification (TDD-via-CI; no local node_modules)

`server/src/__tests__/job-control-commands.integration.test.ts` (embedded PostgreSQL, Linux `verify`
gate): (a) `requestDrain` emits kind `drain` + no state change; (b) no-active-lease → `no_active_lease`
+ no mutation; (e) a real `requestDrain` is delivered on `renewLease` with `cancelRequested === false`,
with a positive control (nothing queued → `extensions: []`). Local pure-node guards stay green
(register citation integrity — `job-control.ts` citations re-pointed by delta; finding-ownership;
ticket-graph).
