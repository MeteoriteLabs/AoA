# SVC-008 — The daemon service supervisor, and the capability widening it earns — DESIGN

**Epic:** E9 · **Lane:** worker-daemon (E9's only daemon-side ticket) · **Start SHA:** `afebb0e51`
**Owns:** finding **E9-F002** (`../findings.md`) — the register is repointed at this ticket in the
same commit.
**Status:** designed, NOT implemented. **Four open questions (§9) are stated, not settled.**
**★★★ START AT §1.** The measurement that produced this ticket named the capability constant as the
blocker. It is not the binding one. **Three deeper constraints make a service structurally
unrunnable today**, and two of them are not in any register.

> **Method.** Written against source re-opened at `afebb0e51`. Every line number below was opened,
> not inherited. Where the measurement that commissioned this design was wrong or incomplete, §1.4
> says so explicitly rather than quietly correcting it. Where this design could not settle a
> question it is in §9, not decided in a subordinate clause.

> **No Protocol Custodian STOP.** Verified independently of the measurement: frozen v1 already
> carries `serviceWorkloadV1Schema` (`packages/worker-protocol/src/job.ts:312-323`), all nine
> service event types (`events.ts:353-372`) with strict payloads (`:266-311`), the service-instance
> machine (`states.ts:199-222`), `checkpoint`/`restore`/`health` in `PROVIDER_OPERATIONS`
> (`capabilities.ts:125-135`), and `serviceSlots` in capacity. **Nothing here needs a wire change,
> so this is a design and not a decision request.** The one judgement that needs an owner is a
> placement-policy call (§9.2) and an effect-authority call (§9.1), both ordinary code decisions.

---

## 1. ★★★ What actually blocks a service today — and why the constant is the smallest of it

### 1.1 The advertised blocker (real, and already filed as E9-F002)

`packages/worker-daemon/src/enrollment/hello-provisioning.ts:27` —
`export const SUPERVISABLE_WORKLOAD_CAPABILITIES: readonly WorkerCapability[] = ["workload.batch"];`
Its docstring: *"Batch only — the supervisor for browser_session/service composes in later sprints,
and D4 forbids reporting a workload the daemon cannot run. Widening this is a deliberate edit, not
a config."* `deriveHelloProvisioning` (`:29-52`) **intersects** the admin ceiling with
`deviceCanProvide`, so `workload.service` is filtered out of every daemon's hello regardless of what
the ceiling says. Placement then demands `workload.${input.workloadType}` unconditionally
(`server/src/services/job-placement.ts:177`, returned at `:190`), so a service job is `queued` /
`no_eligible_target` forever. Pinned in the negative at
`server/src/__tests__/u0-d1-placement-reachability.test.ts:324`.

### 1.2 ★ The mis-supervision blocker — a service dispatched today runs as a batch and *reports success*

`createSpecFor` (`packages/worker-daemon/src/supervisor/supervisor.ts:328-334`) reads only
`workload.command` / `workload.args`. `serviceWorkloadV1Schema` **also** has `command`/`args`
(`job.ts:316-317`), so a service job flows through the batch path with no type error and no branch:
`execute` is a single blocking call raced to a deadline (`supervisor.ts:717-729`), and *when it
returns, the run is over* — `terminal` is emitted from `exec.exitCode` (`:792-795`) and the sandbox
is destroyed (`:808`). The poll loop reads `offer.job.workloadType` **only** as a concurrency class
(`poll/poll-loop.ts:541-542`); nothing else in the daemon branches on it.

**That is the D4 harm in its worst form: mis-supervision that looks like success.** A long-running
service that happens to exit 0 after its startup script finishes is reported `succeeded`. This is
strictly worse than the current `queued` state, and it is the reason the constant and the supervisor
must land in ONE unit (§2.1).

### 1.3 ★★★ The two constraints nobody has filed — and they are the ones that decide this ticket

**(a) The run budget is wrong by construction, and its ceiling is four minutes.**
`resolveRunOpDeadlineMs` (`lifecycle/run-op-deadline.ts:56-68`) reads `workload.maxRuntimeSeconds`.
`batchWorkloadV1Schema` has that field (`job.ts:294`); **`serviceWorkloadV1Schema` does not** — it
has `gracefulStopSeconds` (`job.ts:322`) and nothing else time-shaped. So a service falls to
`RUN_OP_DEADLINE_FLOOR_MS = 60_000` (`:33`), and the sandbox is **born with a 60-second TTL**
(`create` passes `ctx.deadlineMs` straight through to `transport.create({timeoutMs})` and an
idempotent `setTimeout`, `packages/sandbox-e2b-provider/src/e2b-provider.ts:291-292, 319-327`).

Raising the workload's budget does not fix it, because the ceiling is derived, not arbitrary:

```
RUN_OP_DEADLINE_CEILING_MS = OWNED_LABELS_CAPABILITY_TTL_MS (300_000) - RUN_TEARDOWN_HEADROOM_MS (60_000)
                           = 240_000                                   (run-op-deadline.ts:36-46)
```

**(b) The effect authority expires after five minutes and is never re-minted.** The owned-labels
capability is minted at `expiresAt = min(authorityNow + shortTtlMs, leaseDeadline)`
(`server/src/services/owned-labels-mint.ts:92`, `OWNED_LABELS_CAPABILITY_DEFAULT_TTL_MS = 5 * 60_000`
at `:46`) and is minted on **exactly one route**, `POST /worker-control/execution-secrets/resolve`
(`server/src/routes/worker-control.ts:709`, applied at `:764-765`). It is **not** re-issued by
`/leases/:leaseId/renew` (`:511`) — verified by whole-file grep: `ownedLabelsCapability` appears in
that file only at `:764-765`. The supervisor already knows what this costs and says so at
`supervisor.ts:794-806`:

> *"the cap is lease-clamped + never re-minted, so a run longer than its TTL reaches here with an
> EXPIRED cap … Record an HONEST orphan DIRECTLY and return"* → `recordOrphan(run,
> "cap_expired_before_happy_destroy")`.

**Read together: on the networked (sandbox) lane, EVERY service run longer than five minutes ends
with a billable orphaned sandbox that the worker cannot tear down.** Not a slow path — the only
path. And the E2B TTL cannot be stretched afterwards: `transport.setTimeout` is called only from
`create` (`e2b-provider.ts:326-327`), and there is **no TTL-extension operation on the frozen
provider port** (`supervisor/provider.ts:385-404` — `create`/`execute`/`cancel`/`kill`/`destroy`/
`list`/`inspect`/`reconcileCleanup`, plus optional `checkpoint`/`restore`/`health`).

### 1.4 Where the commissioning measurement was wrong, stated so it is not inherited

- It named `job-placement.ts:196`'s `Math.min(600, …)` as *"the real long-running constraint … a
  hard ceiling"*. It is neither hard nor the real one. `boundedDemand` derives demand from the
  **resolved target's own** profile (`job-placement.ts:193-210`, called at `:261`), and
  `providerDemandFits` compares that demand against each candidate (`:504-511`), so the clamp is a
  *demand assertion* that can only ever narrow the candidate set — never a runtime enforcement. The
  runtime enforcement is §1.3(a), which the measurement did not reach.
- It reported *"no daemon file mentions `generation`/`serviceInstanceId`"* and inferred the gap is
  daemon-side implementation only. True as far as it goes, and it stops one layer above the
  authority model that makes the implementation impossible to do safely today.
- It did not surface `RUN_OP_DEADLINE_CEILING_MS`, the never-re-minted capability, or the absence of
  a TTL-extension port operation. Those three are the substance of §3 and §4.

**Everything else the measurement asserted was re-verified and holds**: frozen v1 completeness, the
zero-production-caller `recordServiceHealth` (`packages/db/src/repositories/tenant/job-control.ts:3181`
— whole-tree grep returns the declaration, its interface line `:469`, two fence allow-lists, and
three test files), the generic `terminal`-only projection in ingest
(`server/src/services/job-events.ts:58-78`), `serviceSlots` accounting including the hardcoded
`serviceSlots: 0` on the unprovisioned path (`enrollment/desktop-hello.ts:183`), and
`capabilitiesForIsolation` contributing no `workload.*` name at all.

---

## 2. What SVC-008 builds, and the one sentence that bounds it

**A daemon that can hold a process open under supervision for as long as its authority is valid, and
an advertised capability that is true when it does.** That is the whole ticket.

- **Zero new wire surface.** Every event, payload, status and provider operation used here is frozen
  v1 and already on disk. SVC-008 consumes them.
- **Zero new relations, zero migrations.** No control-plane schema change (that is SVC-002/003).
- **One new daemon module** (`supervisor/service-lifecycle.ts`), **one branch** in
  `runLifecycle`, **one resolver change** (`run-op-deadline.ts`), **one constant edit**
  (`hello-provisioning.ts:27`), **one config default** (`config/config.ts:186`).

**And the sentence that bounds it:** SVC-008 supervises **one instance, on one worker, for one lease
generation**, and emits what it observes. It does **not** decide what any of those observations
mean. Health *policy* (does a missed health kill the instance?), lease/ownership semantics, restart,
checkpoint, drain and generation are all SVC-003/004/005 — see §8. The acceptance table must read
"a service job reaches a worker and is supervised as a service", **never** "services are managed."

---

## 3. The service lifecycle, and exactly how it differs from batch

### 3.1 The shape mismatch, named precisely

For batch, **`execute` returning IS the run ending**. There is no representation of "the process is
still up", so a workload that does not end has no state in this supervisor. The service path
therefore cannot be a parameterisation of the batch path; it is a different sequencer over the same
authorities.

| Step | Batch (`runLifecycle`, `supervisor.ts:468-830`) | Service (`runServiceLifecycle`, new) |
|---|---|---|
| secrets | `materializeRunSecrets` once (`:520`-ish), mints the owned-labels cap | **once, then RE-MATERIALIZED on a schedule** — §4.1 and **§9.1** |
| create | `create` (`:571`), TTL = `opDeadlineMs` | `create`, TTL = the service budget (§3.3) |
| stage | optional `stageFiles` (`:605`) | same, unchanged |
| start | `attempt_started` (`:710`) | `attempt_started`, then **`service_instance_started`** carrying `{serviceId, serviceInstanceId, generation, providerResourceId: sandboxId}` (`events.ts:266-268`) |
| run | **`execute` blocking, raced to `opDeadlineMs`** (`:717-729`) | `execute` started and **not awaited to completion**; the supervisor enters a **supervise loop** |
| observe | best-effort `observeRun` log/progress/usage (`:774`) | the same observation channel, PLUS a health tick emitting **`service_health`** (`events.ts:271-275`) |
| stop | n/a | on stop signal: **`service_graceful_stop_observed`** with a deadline (`:287-289`), then `cancel`, then `kill` after `gracefulStopSeconds` |
| end | `terminal` from `exec.exitCode` (`:792`) | **`service_instance_stopped`** (`:292-294`) or **`service_instance_lost`** (`:297-299`), THEN `terminal` |
| destroy | `destroy` (`:808`), orphan-record if cap expired (`:800-803`) | identical, and §4.1 is what keeps the cap alive to reach it |

**The load-bearing difference is the third-from-last row.** A service emits an instance-terminal
event *before* the attempt terminal, because the instance and the attempt are different objects in
the frozen model (`states.ts:199-222` is a machine the attempt machine does not contain). Emitting
only `terminal` is exactly today's mis-supervision (§1.2) with extra steps.

### 3.2 The supervise loop, exactly

One `setInterval`-free, `schedule`-driven tick (reusing the supervisor's injected `schedule`, so
tests drive it with a fake clock — the existing `withDeadline` already does this, `:335-345`). Per
tick, in order, each step best-effort and individually try/caught:

1. **Cap freshness.** If `run.capExpiresAt` is within `RUN_TEARDOWN_HEADROOM_MS` of `now()`,
   re-materialize (§4.1). If re-materialization fails, this is a **planned stop**, not a crash —
   §4.4.
2. **Health.** If the provider advertises `health` (`provider.advertisedOperations`,
   `provider.ts:387`), call `health(sandboxId, ctx)` → `{status: "healthy" | "unhealthy"}`
   (`provider.ts:330-334`) and emit `service_health` with that status verbatim. The wire enum is the
   same two values (`SERVICE_HEALTH_STATUSES`, `events.ts:271`), so no mapping table exists to get
   wrong. If the provider does not advertise `health`, emit nothing — **do not synthesize a
   `healthy`**; a fabricated health signal is the failure class this programme keeps re-learning.
3. **Liveness.** `inspect(sandboxId, ctx)`. A sandbox the provider no longer knows about is
   `service_instance_lost` (§4.3).
4. **Stop signal.** The existing control-command channel already rides lease renewal
   (`lease/lease-renewal.ts` header: *"A `renewed` with `cancelRequested` is a server-initiated
   cooperative cancel"*). SVC-008 **reuses `cancelRequested` and adds no new channel** — a
   service-specific stop verb is SVC-005's.

**The loop never renews the lease itself.** Lease renewal is already a separate, shipped driver that
DECORATES the supervisor seam (`lease/lease-renewal.ts:1-9`), and its loss path
(`onLeaseLost` → fence close → cleanup) is the mechanism §4.5 relies on. Duplicating it inside the
service loop would create a second, unfenced renewer — the exact shape SVC-002 §4.1 argues against
for its own duplicate-insert problem.

### 3.3 Where the service's budget comes from, since the workload does not carry one

`resolveRunOpDeadlineMs` gains a service arm. **The source of truth is the target's provider
constraint profile**, which already carries the right field:
`providerConstraintProfileV1Schema.maxContinuousRuntimeSeconds`
(`packages/worker-protocol/src/capabilities.ts:174`, min 1, max 604_800). The handoff carries the
resolved target, so the value is available without a wire change.

**But it is clamped by the effect-authority window, not by the profile**, and that clamp is the whole
of §9.1. Until the re-mint question is settled, the service budget is:

```
serviceOpDeadlineMs = min(profile.maxContinuousRuntimeSeconds * 1000, RUN_OP_DEADLINE_CEILING_MS)
```

which is **240 seconds**. A four-minute service is not a service. **This is the single fact that
decides whether SVC-008 can honestly widen the constant**, and it is §5.

---

## 4. Failure modes — what the daemon does, for each

| # | Failure | What the daemon does | The mechanism it reuses |
|---|---|---|---|
| **4.1** | **Effect authority (owned-labels cap) nears expiry.** Unavoidable on any run > 5 min. | Re-materialize secrets on the tick, re-deriving the cap and rebuilding the per-run authorities — the SAME rebuild `runLifecycle` already performs once after redemption (`supervisor.ts:858-863` builds no-op authorities; `runLifecycle` rebuilds them over the real per-run driver). If re-materialization is refused (denied / non-`sandbox_local_only` seam / no control-plane key — `owned-labels-mint.ts:110-118` returns the outcome UNCHANGED in each case), treat it as a **stop deadline**: begin graceful stop NOW, while the current cap is still valid, so `destroy` still runs under authority. **★ Never continue past cap expiry**: that is precisely the orphan at `supervisor.ts:800-803`, and doing it deliberately would be a designed leak. **This is OPEN — §9.1.** |
| **4.2** | **The process exits on its own** (exit 0 or non-zero). | The un-awaited `execute` settles. Emit `service_instance_stopped` with `exitCode` (`events.ts:292-294`), then `terminal` (`succeeded` iff exit 0, matching the batch rule at `:792`), then `destroy`. **A service that exits is not a success by default and not a failure by default** — the exit code decides, and *whether an exit should be replaced* is SVC-004's. | existing `terminal` + `destroy` |
| **4.3** | **The process hangs / the sandbox is gone / the provider stops answering.** | Two distinct answers, and conflating them is the mis-supervision risk. A process that is *up but unhealthy* → `service_health` with `status: "unhealthy"` and **keep supervising** (SVC-003 owns the policy that turns repeated unhealth into a kill). A sandbox the provider cannot `inspect` → `service_instance_lost` with a reason (`events.ts:297-299`), then `terminal` `failed`, then `escalateCleanup` (`supervisor.ts:349`). | `inspect`, `escalateCleanup` |
| **4.4** | **Provider pause/resume** (the accepted E2B caveat, E9 README). | The frozen pair `service_provider_interrupted` / `service_provider_resumed` (`events.ts:302-311`) is emitted when `inspect` reports the sandbox suspended and then live again. **SVC-008 emits; it does not recover.** Recovery is checkpoint/restore = SVC-004. |
| **4.5** | **The lease expires mid-run / renewal is refused.** | **Unchanged from batch, deliberately.** The renewal driver closes the fence-close proxy first, then calls `Supervisor.onLeaseLost`, and every governed effect is denied locally (`lease-renewal.ts:20-25`). The service loop must therefore **check the run's cancelled/lost flag on every tick and stop emitting**, exactly as the batch path checks `run.cancelled` (`supervisor.ts:730`). ★ A service loop that keeps emitting after fence close would be the first daemon component to write past a closed fence. |
| **4.6** | **The control plane goes away** (events cannot be uploaded). | Unchanged: the encrypted SQLite event outbox (WRK-006) buffers, `event-upload.ts` retries without busy-spinning, and a session-terminal condition surfaces as lease loss (4.5). **SVC-008 adds no new durability assumption** — but it does add *volume*: a health tick per interval for hours. **§9.3.** |
| **4.7** | **The daemon restarts under a live service.** | Unchanged: WRK-007 restart recovery + orphan cleanup. The sandbox is reclaimed by label. SVC-008 does **not** attempt restart-in-place — a new instance after a daemon restart is a control-plane replacement decision (SVC-004). |

---

## 5. ★★★ What makes it safe to widen the constant

The docstring at `hello-provisioning.ts:24-26` states the rule this ticket has to satisfy: **"D4
forbids reporting a workload the daemon cannot run."** So the widening is not a step in the plan; it
is a *claim* that becomes true at a specific moment, and the honest form of this section is the exact
condition plus the way a reader checks it.

### 5.1 The condition, stated as a conjunction

`"workload.service"` may be added to `SUPERVISABLE_WORKLOAD_CAPABILITIES` **when all four hold, in
the same commit**:

1. **A service branch exists and is reached.** `runLifecycle` dispatches on
   `handoff.offer.job.workloadType === "service"` to `runServiceLifecycle`, and the branch is
   covered by a test that fails if the dispatch is removed (§6, T1).
2. **A service run emits the instance events, not just `terminal`.** At minimum
   `service_instance_started` on start and exactly one of `service_instance_stopped` /
   `service_instance_lost` on end. This is what makes the run *distinguishable from a batch run* to
   anyone downstream — the direct refutation of §1.2.
3. **★ The run's authority outlives the run, or the run stops before the authority does.** Formally:
   for every service run, `destroy` is attempted while `run.capExpiresAt > now()`. This is the
   clause that is NOT satisfiable today (§1.3b) and is the whole of §9.1. **Until it is satisfied,
   the honest budget is 240 s and the honest advertisement is `workload.service` on a daemon that
   can run a service for four minutes.** Whether that is worth advertising is §9.1's real question.
4. **The advertised capacity is non-zero and real.** `config.concurrency.service` defaults to 0
   today; the widening must ship with a default ≥ 1 and the unprovisioned path's hardcoded
   `serviceSlots: 0` (`enrollment/desktop-hello.ts:183`) left alone — an unprovisioned daemon
   advertising service slots would be a second false claim one field over.

### 5.2 How a reader checks it, without trusting this document

Three checks, each mechanical:

- **Is the branch reached?** `grep -n 'workloadType === "service"' packages/worker-daemon/src/supervisor/` returns a
  line in `runLifecycle`'s dispatch, and deleting it reds T1. (A branch that exists but is never
  dispatched to is this programme's most-repeated defect; a caller count is the check.)
- **Are the events emitted from the shipped path?** `grep -rn 'service_instance_started' packages/worker-daemon/src`
  returns a **production** file, not only a test. Today it returns nothing at all.
- **Does the authority outlive the run?** Read `RUN_OP_DEADLINE_CEILING_MS`
  (`run-op-deadline.ts:44-46`) and `OWNED_LABELS_CAPABILITY_DEFAULT_TTL_MS`
  (`owned-labels-mint.ts:46`). If the ceiling is still `TTL − headroom` and no re-mint path exists,
  clause 3 is **unsatisfied** and the widening is advertising a four-minute service. That is a
  two-file read, and it is deliberately the shortest of the three.

### 5.3 What is NOT a sufficient condition, said out loud

- **Placement returning `leased` is not sufficient.** A lease proves the capability advertisement was
  believed, not that the run was supervised. The mis-supervised batch run of §1.2 would also be
  leased.
- **A green test suite over doubles is not sufficient for clause 3.** The capability window is a
  *server-minted* value; a fake provider and a fake clock can satisfy every assertion while the real
  cap expires. §6's T6 is written to fail on the real arithmetic rather than on a mocked expiry.

---

## 6. Test plan — each with the failing case that must be OBSERVED RED first

Every case names its red state and a mutant, because this programme's recurring defect is a test
that was green before the fix and nobody checked.

| # | Test | The failing case that must be observed RED **before** the fix exists | Mutant that must re-red it after |
|---|---|---|---|
| **T0** | **★ THE REACHABILITY TEST — a service job actually reaching a worker.** End-to-end against the existing placement harness: enroll a daemon whose ceiling includes `workload.service` and whose capacity has `serviceSlots ≥ 1`; submit a service job; assert `decideJobPlacement` returns a **`leased`/eligible** disposition naming that worker, and that the daemon's `poll` → `ack` path hands the offer to the supervisor seam. | **Red today and red for a structural reason:** with `SUPERVISABLE_WORKLOAD_CAPABILITIES = ["workload.batch"]`, `deriveHelloProvisioning` intersects `workload.service` away, so placement returns `queued` / `no_eligible_target`. Run it and watch the disposition, not an exception. | Revert the constant → `queued` → red. Revert the capacity default to 0 → the capability is advertised but `serviceSlots` is 0, so `offerSatisfiesWorker` / capacity gating refuses → red. **Two independent mutants, because clause 4 of §5.1 is a separate claim from clause 1.** |
| **T0′** | **★ What happens to the pinned negative, `u0-d1-placement-reachability.test.ts:324`.** It asserts `expect([...SUPERVISABLE_WORKLOAD_CAPABILITIES]).toEqual(["workload.batch"])` under a comment saying that if either ceiling widens, *"every reachability conclusion below is re-derivable rather than silently stale."* **It goes RED on the widening, and that is the test working, not breaking.** It is **updated, not deleted**: the assertion becomes `toEqual(["workload.batch", "workload.service"])`, the comment is kept verbatim, and **the conclusions below it in that file are re-derived rather than re-asserted** — specifically every case that concludes "the daemon is offerable batch and nothing else" must be re-read and either re-stated for service or explicitly narrowed to batch. ★ **Do not weaken it to `toContain`.** An exact-equality pin is what makes the NEXT widening (browser_session) announce itself; `toContain` would let a third workload in silently, which is the same hole one workload over. | The pin is currently green and must be **observed going red on the constant edit alone**, before any conclusion is re-derived. If it does not go red, the constant being read by the test is not the constant being edited. | Change the pin to `toContain` → the browser_session widening stops announcing itself. There is no automated mutant for that; it is a review rule, recorded here so it is refusable. |
| **T1** | **The service branch is dispatched.** A service handoff reaches `runServiceLifecycle`, a batch handoff reaches `runLifecycle`'s batch body. | **Red today: a service handoff runs the batch body and emits a batch-shaped `terminal`.** Build that assertion first and watch it produce `terminal` with no `service_instance_started` — this is §1.2 exhibited, and it is the strongest single argument in this ticket. | Delete the dispatch → the service handoff runs the batch body → red. |
| **T2** | **A service that does not exit stays supervised.** Fake clock; `execute` never settles. Assert: `service_instance_started` emitted once; **N** `service_health` events across N ticks; **no `terminal`**; the run is still active after the batch op-deadline (60 s) has passed. | Red today: the batch path races `execute` to `opDeadlineMs` and emits `terminal` with `errorCode: "execute_timeout"` at 60 s (`supervisor.ts:727-736`). The red state is that `terminal` appearing. | Restore `withDeadline(execute, opDeadlineMs)` on the service arm → `terminal` at 60 s → red. Drop the health tick → zero `service_health` → red. |
| **T3** | **Graceful stop honours `gracefulStopSeconds`.** Deliver a `cancelRequested` renewal; assert `service_graceful_stop_observed` with a deadline `= now + gracefulStopSeconds`, then `cancel`, then — only after the deadline lapses with the process still up — `kill`, then `service_instance_stopped`, then `terminal`, then `destroy`, **in that order**. | Red today: no stop path exists; the run ends only when `execute` settles. | Swap `cancel`→`kill` (skip graceful) → the ordering assertion reds. Read `gracefulStopSeconds` from the wrong field (or default it) → the deadline assertion reds. **Assert the SEQUENCE, not the set** — a set assertion passes under a supervisor that kills first and emits the graceful event afterwards. |
| **T4** | **The provider does not advertise `health`.** Assert **zero** `service_health` events and that supervision continues. | Red against the naive implementation, which synthesizes `healthy` when it cannot ask. Build that variant and watch a fabricated health signal appear — it is the failure class, in miniature. | Synthesize `healthy` on the unadvertised path → a `service_health` event appears → red. |
| **T5** | **Fence close stops the loop.** Trigger lease loss mid-supervision. Assert: no further `service_health` after the close, `onLeaseLost` cleanup converges, and **nothing is emitted past the closed fence**. | Red against a loop that does not consult the cancelled/lost flag — which is what a first implementation does, because the batch path only needs the check at one point. | Remove the per-tick cancelled/lost check → post-close emissions → red. |
| **T6** | **★ The authority clause of §5.1(3), tested on the real arithmetic.** With `capExpiresAt` derived from the actual constants (`OWNED_LABELS_CAPABILITY_DEFAULT_TTL_MS` and `RUN_TEARDOWN_HEADROOM_MS`, imported, not hardcoded), run a service past the cap window. Assert: **either** the cap was re-materialized and `destroy` ran under a valid cap, **or** graceful stop began before expiry and `destroy` ran under the original cap. Assert `recordOrphan` was **not** called. | **Red today and red under the obvious implementation**: a service loop that just keeps ticking reaches `destroy` with an expired cap and `recordOrphan(run, "cap_expired_before_happy_destroy")` fires. That orphan **is** the red state, it is reachable, and it must be run and seen. | Delete the cap-freshness step from the tick → `recordOrphan` fires → red. Hardcode the TTL in the test instead of importing it → the test survives a constant change that would break production → **caught by review, not by a mutant**; recorded here as the reason for the import. |
| **T7** | **Capacity accounting.** A daemon with `serviceSlots: 1` running one service refuses a second service offer (`poll-loop.ts:541-542` concurrency class) and still accepts a batch offer. | Red today only in that nothing dispatches; the *class* separation is already shipped, so this test's job is to prove SVC-008 did not collapse the classes. | Make the limiter key on a constant instead of `workloadType` → the batch offer is refused → red. |

**Windows** runs the integration arms via `AOA_RUN_WIN_INTEGRATION=1`; otherwise Linux CI.

---

## 7. Sequencing — why the constant is IN this unit and the control-plane consumer is NOT

The commissioning measurement proposed three units (daemon supervisor / control-plane consumer /
the constant) and suggested the constant last.

**The constant belongs in THIS unit, not after it.** Splitting them creates a window in which the
daemon advertises `workload.service` and nothing supervises it — which is §1.2's mis-supervision,
deliberately shipped. The docstring's rule ("D4 forbids reporting a workload the daemon cannot run")
is a conjunction, and §5.1 is its four clauses; a commit that satisfies clauses 1-2-4 and widens the
constant is a commit that made the docstring false. **The widening is one line and it is the last
line of this unit's diff.**

**The control-plane consumer is NOT in this unit, and the cost of that is stated rather than hidden.**
Ingest is generic — `toAcceptInputs` (`job-events.ts:58-78`) durably appends **any** event type and
sets `terminalStatus` only for `terminal`, so every `service_health` /
`service_instance_started` / `_stopped` / `_lost` SVC-008 emits **is durably stored and projects no
state change**. `recordServiceHealth` keeps its zero production callers. That is honest evidence (the
rows exist, are fence-checked and are queryable) and it is **not** convergence. Wiring the projection
is SVC-003's, because deciding what a health event *means for ownership* is literally SVC-003's
Outcome ("Health events do not extend ownership without a successful lease renewal").

---

## 8. What this unit does NOT do, and which ticket owns each

- **Health *semantics*, liveness deadline, bounded lease renewal, fencing an unreachable worker,
  and the `service_health` → `recordServiceHealth` projection → SVC-003.** SVC-008 emits a health
  observation from the provider's own verdict and draws no conclusion from it. It also does not
  touch `ServiceHealthStatus` (`tenant/job-control.ts:620`) — that is **E9-F001**, SVC-003's.
- **Restart, backoff, crash-loop terminalization, checkpoint prepare/restore → SVC-004.** SVC-008
  emits `service_checkpoint_prepared`/`_restored` **never** — it does not call `checkpoint` or
  `restore` at all, even though the port has them (`provider.ts:402-403`). A checkpoint with no
  policy about when to take one and no consumer is a leak of scope.
- **Pause, drain of a running instance, generation rollout, budget/TTL stop, `generation` bumps →
  SVC-005.** SVC-008 **reads** `generation` off the workload and stamps it into every event; it never
  writes or compares one. It reuses the existing `cancelRequested` control signal and adds no
  service-specific stop verb.
- **Duplicate placement, the reconciler, desired state → SVC-002.** SVC-008 has no opinion about how
  many instances should exist; it supervises the one it was handed.
- **Lifting `boundedDemand`'s `Math.min(600, …)` → SVC-002 or SVC-003.** §9.2 explains why it is not
  free and why SVC-008 does not take it.
- **Any control-plane route, UI, or human path to create a service → SVC-007.** After SVC-008 there
  is still no way for a person to start a service.

---

## 9. ★ Open questions this design could not settle

**9.1 — Should the daemon re-mint the owned-labels capability mid-run, and if so how?** This is the
question §5.1(3) turns on and the only one that decides whether `workload.service` means anything.
Three answers, none obviously right. **(a) Re-materialize secrets on the tick** — the route exists
(`/worker-control/execution-secrets/resolve`), the mint is a pure function of the resolve outcome
(`applyOwnedLabelsCapability`, `owned-labels-mint.ts:110-118`), and the supervisor already knows how
to rebuild per-run authorities. Against: it re-runs a **secret resolution** on a schedule, which
widens the blast radius of a compromised worker from one materialization to N, and nobody has ruled
on that. **(b) Issue a fresh cap on lease renewal** — architecturally cleaner (the cap is already
lease-clamped, so binding its refresh to renewal is coherent), but it is a **server** change on the
renew route (`worker-control.ts:511`) and therefore not SVC-008's to make. **(c) Accept the ceiling
and ship a four-minute service** — defensible only if E9's acceptance language is amended to say so,
which is a founder-level edit to the epic, not a ticket decision. **Not decided here.** Whoever rules
should note that (b) also fixes long batch runs, which have the identical orphan today.

**9.2 — Is a service exempt from `boundedDemand`'s `Math.min(600, …)`?** (`job-placement.ts:198`.)
The measurement called it a hard ceiling; §1.4 shows it is a demand assertion, so lifting it is not
free in the direction people assume: **raising** the demanded runtime *narrows* the candidate set
(`providerDemandFits`, `:509-511` refuses any candidate whose `maxContinuousRuntimeSeconds` is below
the demand), so a service demanding 604 800 s would be placeable only on a fleet advertising a
seven-day continuous runtime. The honest options are "leave it and accept that a service's *recorded*
demand understates its runtime" or "derive the demand from the workload for service only". **Not
decided here**, and it is a control-plane decision — SVC-002's or SVC-003's, not SVC-008's.

**9.3 — What is the health tick interval, and who bounds the event volume?** A 10-second tick over
72 hours is ~26 000 `service_health` rows per instance in `job_events` — durably stored, fence-checked,
and (until SVC-003) projecting nothing. A 60-second tick is ~4 300. The frozen wire imposes no rate.
The interval interacts with SVC-003's liveness deadline, so choosing it here would pre-empt SVC-003.
**Recorded, unmade.** Whoever picks it should say what the retention story is, because
`FINDING-retention-authority-and-DE-11.md` says nobody currently owns one.

**9.4 — Does anything extend an E2B sandbox's TTL after `create`?** Measured: `transport.setTimeout`
is called only from `create` (`e2b-provider.ts:326-327`), and the frozen provider port
(`provider.ts:385-404`) has no extension operation. So a service's whole lifetime is fixed at create
time by `ctx.deadlineMs`. If the answer to 9.1 is (a) or (b) and the budget rises above the E2B
template's own maximum, this becomes the next binding constraint. **Not investigated against a real
E2B account** — the two call sites of the isolation conformance suite are both keyless doubles
(recorded in `E0-F015`), so this claim is a code reading, not a provider measurement, and it is
labelled as such.

---

## 10. Register obligations for the landing commit

- **E9-F002 is repointed from `unowned` to `owned` by SVC-008** in `../findings.md` and
  `scripts/finding-ownership.json`, in the same commit as this document — SVC-008 now has a file on
  disk and a `#### SVC-008` node in `program-design.md`, which is the existence bar
  `owner_ticket_missing` enforces (`scripts/lib/finding-ownership.mjs:417-424`). **The finding stays
  `open`**: a design is not a supervisor, and its stated resolution ("a daemon advertises
  `workload.service` and a service job is observed leased") is T0, which this document plans and does
  not run.
- **E9-F002's own text is amended** to carry §1.3 — the run budget and the never-re-minted
  capability. Its current §1 chain is correct and incomplete, and a finding that names only the
  smallest of three blockers will be closed by fixing the smallest of three.
- **A gate-clause entry is NOT added.** `countProductionCallers`
  (`scripts/check-gate-clause-wiring.mjs:155-186`) returns 0 for a symbol that does not exist and an
  `unwired` clause with count 0 **passes**, so a clause naming `runServiceLifecycle` today would be
  admitted and would assert nothing — this programme's defining failure class. **The SVC-008
  implementation commit adds `E9-2-service-supervisor`, `unwired`, symbol `runServiceLifecycle`.**
- **No `ownerTicketDeferrals` entry is created or removed by this commit.**
