# E9 Decisions

Breaking wire decisions require the Protocol Custodian and a versioned contract directory. The
entries below are architecture decisions for the service-agents epic; they change no wire contract
(the frozen `SERVICE_INSTANCE_TRANSITIONS`, `CONTROL_COMMAND_KINDS` and the `SandboxProvider` port
are untouched).

## E9-D001 — Bounded same-service external-effect overlap is PERMITTED; the existing structural fences ARE its fencing-and-idempotency policy

- **Date (UTC):** `2026-09-20`
- **Status:** `locked` (founder ruling 2026-09-20, enacted per the E9 service-lifecycle handoff; the
  operator acting as founder / Protocol-Custodian). This is route **(c)** of E9-F012 §4 and the third
  closure route of E9-F007 §3 — the escape branch the acceptance clause itself contemplates.
- **Context:** E9's acceptance clause for SVC-005 reads, verbatim:

  > No two generations may perform external effects simultaneously unless a later approved
  > architecture decision explicitly permits overlap and defines its fencing and idempotency policy.

  Two findings reach this clause from opposite ends, and both established the same impossibility.
  - **E9-F007** (HIGH, SVC-003b) — the liveness deadline (`sweepServiceInstanceLiveness`,
    `packages/db/src/repositories/tenant/job-control.ts`) drives a live `service_instances` row to
    `lost` on a clock and writes **exactly one table**: it does not revoke, expire or extend the
    worker's lease (pinned by `L-T11`; mutant `L17` reds it). That restraint is deliberate — a sweeper
    with lease authority would be a second owner of ownership beside `renewLease` and
    `reapExpiredLeases`, which E9's own SVC-003 acceptance sentence ("health events do not extend
    ownership without a successful lease renewal") forbids. The consequence is that in the exact case
    the deadline exists for, the worker is **still alive**: `runServiceLifecycle`'s supervise loop
    answers an unanswerable `processStatus` read with `unknown ⇒ emit nothing`
    (`packages/worker-daemon/src/supervisor/service-lifecycle.ts`) while `lease-renewal.ts` renews on a
    separate driver, so a worker can emit nothing, keep its fence, and keep its supervised **process**
    performing external effects while SVC-002's reconciler starts a replacement. This is a
    **same-generation** overlap, reached one ticket before rollout existed.
  - **E9-F012** (HIGH, SVC-005a) — a **cross-generation** rollout cannot prove the old generation's
    process stopped. A closed fence stops the old worker **writing**, not its **process**:
    `classifyFence` (`packages/db/src/repositories/tenant/job-fence.ts`) returns `attempt_terminal`
    before any other test, which is genuinely stronger than "we asked it to stop" but is still not the
    clause. Nothing in the control plane observes a remote process.

  Both findings enumerated the only alternatives that would make the overlap literally impossible, and
  neither is available today: (a) a control-plane-reachable `processStatus` over SVC-008a's port —
  there is no channel from the control plane to that port; (b) a `graceful_stop` producer plus an
  unforgeable stop-witness ACK — blocked on **E9-F008**, which measures that the frozen `graceful_stop`
  control-command kind has **zero producers** and that its only worker consumer folds into the
  `cancelRequested` boolean floor (`packages/worker-daemon/src/lease/lease-renewal.ts`), so a producer
  built today would be inert and indistinguishable from a cancel, honouring no deadline and returning
  no witness. Route (c) — an approved decision that permits the overlap and defines its policy — is the
  clause's own contemplated escape and the only closure that does not depend on unbuilt code.

- **Decision:**
  1. **The overlap is PERMITTED, bounded, and confined to EXTERNAL EFFECTS.** For a single service, at
     most two execution generations/instances may perform **external effects** concurrently, for a
     window bounded by the old generation's **lease TTL plus the reaper's expired-lease interval**.
     After that window `classifyFence` returns `attempt_terminal` (the old worker can no longer write
     through the fenced ingest) and `reapExpiredLeases` expires the stale lease. This is a
     double-execution window for external **effects** only. It is **never** a double-write window for
     service **state**.
  2. **Fencing policy — what makes STATE overlap impossible and bounds the effect overlap.** These
     four mechanisms already exist and are load-bearing; this decision names them as the policy:
     - `service_instances_live_service_uq` permits exactly **one non-terminal instance** per
       `(organization, service)`, and `listReconcilableServices` filters on the byte-identical
       predicate. A replacement is placed only after the incumbent reaches a terminal status, so two
       instances are never live in **state** at once.
     - **SVC-003a's split-brain refusal** — the three frozen terminal statuses (`stopped`/`failed`/
       `lost`) have no outgoing edges and appear in no predecessor set, so a terminalized instance's
       late worker events return `illegal_transition` and cannot resurrect it. Two live rows under the
       unique key remain impossible even under racing/late events.
     - **The attempt-terminal write-fence** — from the instant the old attempt is terminal, the old
       worker cannot write anything through the fenced ingest (`classifyFence`). A closed fence is a
       hard write-fence, not a request.
     - **Cross-generation placement refusal** — `reconcileServiceWithinTenant` step 4b refuses placing
       generation N+1 while a previous generation's instance is terminal-by-assumption
       (`terminalized_by ∉ {worker_stopped}`) **and** its attempt is non-terminal, so a rollout stalls
       until the old attempt is write-fenced rather than racing it.
  3. **Idempotency policy — what makes the permitted EFFECT overlap safe.** A service's external
     effects **MUST be idempotent across generations and instances**, keyed on a stable operation
     identity rather than on liveness. The control plane cannot witness a remote process stopping, so
     during the bounded window the old generation's process may still perform effects while the
     replacement starts; requiring idempotency is what makes that safe, and is exactly the condition
     the acceptance clause's escape sentence anticipates. This is now a charted requirement of running
     a service on this platform.
  4. **No new ownership authority is granted.** This decision does **not** give the liveness deadline
     or the reconciler any right to revoke or expire the old lease. Ownership stays with `renewLease`
     and `reapExpiredLeases`; the overlap is permitted, not fenced by a second owner.
  5. **A future cooperative-stop mechanism TIGHTENS but is not required.** When a deadline-aware
     `graceful_stop` producer plus an unforgeable stop-witness ACK later land (E9-F008 plus a distinct
     worker consumer), a cooperative stop issued to the old lease at the moment of terminalization may
     shorten this window. That is an **optimisation of an already-permitted-and-bounded overlap**, not
     a precondition of it, and its absence does not reopen this allowance.

- **Alternatives:**
  - **Give the deadline / reconciler the right to revoke the old fence** (rejected). It creates a
    second authority over the ownership column beside `renewLease`/`reapExpiredLeases`, which E9's own
    SVC-003 acceptance sentence forbids, and it would revoke on a clock that fired precisely *because*
    the worker went quiet — i.e. on an assumption, the fail-open SVC-008b's stop-verdict work exists to
    refuse.
  - **A `graceful_stop` producer + unforgeable ACK issued to the old lease** (deferred, not rejected).
    Blocked on E9-F008: the frozen `graceful_stop` kind has no producer and its only worker consumer
    folds into the `cancelRequested` floor, so a producer built today is inert, cannot honour the
    deadline, and returns no stop-witness. It becomes the §5 tightening mechanism once a deadline-aware
    consumer exists.
  - **Do not terminalize / stall forever** (rejected). The permanent wedge SVC-003b and SVC-005a exist
    to remove — a stuck service no code notices — which is strictly worse than a bounded, structurally
    state-fenced, idempotency-tolerated effect overlap.

- **Consequences:**
  - E9-F007 and E9-F012 are converted from gaps into **documented allowances** and both close; the
    SVC-005 acceptance clause is satisfied by its own escape branch and is not relitigated.
  - Service authors MUST make external effects idempotent across generations — a charted platform
    requirement, to be surfaced wherever service-authoring guidance lives.
  - **DE-12's audit conjunction is UNAFFECTED and stays `partial`.** This decision permits the overlap;
    it adds no partition/drain audit, which DE-12 and E0-F013 Decision 1 track separately. No
    `distributed-execution-threat-controls.json` change is implied by this decision.
  - E9-F008 stays **open** (its `graceful_stop` and `checkpoint` producer halves are untouched here);
    the §5 tightening mechanism depends on it plus a new worker consumer.

- **Affected tickets / findings:** E9-F007 (closed by this), E9-F012 (closed by this), SVC-005 (owns
  the acceptance clause), SVC-003 (created the same-generation route as E9-F007), E9-F008 (the deferred
  §5 tightening mechanism; stays open).
