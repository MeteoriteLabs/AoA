# E9 Service agents — findings

Scoped discoveries for E9. Opened 2026-09-08 by SVC-002 design + terrain mapping at `921b2c1f9`,
after adversarial review returned FIX_FIRST on the design and required these to be **filed** rather
than recorded in prose. Both were fully written out in `tickets/SVC-002-terrain.md` §7 item 3; the
filing here is a transcription of that wording plus the verification re-run for the review.

## E9-F001 — `ServiceHealthStatus` still carries `"interrupted"` while the DB CHECK forbids it, and a shipped result document says the edit was made

**Status:** `resolved` 2026-09-10 by **SVC-003a** (`tickets/SVC-003a-result.md`) · **Severity:** MED
**Filed:** 2026-09-08, by SVC-002 terrain mapping (§5.1); re-verified at `921b2c1f9`.
**Affected tickets:** SVC-003 (owned the fix), SVC-001 (source of the false claim).
**Blocks gate:** no. Latent until resolution; it would have gone live the moment SVC-003 wired health,
which is the same commit that closed it.

> **★ CLOSED ON BOTH CONJUNCTS, AND THAT IS THE ONLY WAY IT COULD BE CLOSED.** §3's resolution is a
> conjunction — delete the literal **and** add the missing subset assertion — and half of it is not
> it. Both are in the closing commit: `| "interrupted"` is gone (the type is now derived from a new
> `SERVICE_HEALTH_ASSERTABLE_STATUSES` constant, and the only two `"interrupted"` strings left in the
> tree are inside that constant's own docstring explaining the finding), and
> `server/src/__tests__/service-health-projection.test.ts` carries the reconciliation the finding
> asked for, in both directions, plus a third case pinning that every status the projection can
> actually drive is storable. Observed RED under a mutant that re-adds `"interrupted"` — which is
> literally the base-tree state — killing 2 cases. §3's "do not fix it by widening to all nine" is
> honoured: the domain is FIVE of the nine, with a recorded reason for each of the four omissions,
> and a test that pins the set so a later widening has to be a decision. The
> `scripts/finding-ownership.json` key is deleted in the same commit.

### 1. The contradiction

`packages/db/src/repositories/tenant/job-control.ts:620` still reads:

```ts
export type ServiceHealthStatus = "healthy" | "stopped" | "lost" | "interrupted";
```

It is the **only** `"interrupted"` literal left in `server/src` + `packages/` — verified by
`grep -rn '"interrupted"' server/src packages/*/src`, which returns that one line and nothing else.

Migration `0264` narrowed `service_instances_status_check` to the frozen nine, which exclude
`interrupted`. So `recordServiceHealth({ healthStatus: "interrupted" })` **typechecks and fails at
runtime** with a `23514` CHECK violation, where before SVC-001 it succeeded. The type is also far
narrower than the nine in the other direction — `pending`, `leased`, `starting`, `unhealthy`,
`stopping` and `failed` cannot be expressed at all — and `recordServiceHealth` (`:3181-3189`) is the
only UPDATE path to `service_instances.status` that exists.

### 2. ★ The false self-claim, which is the half that generalises

`SVC-001-design.md` §3.2 CORRECTION 6a instructed *"narrow the edit to removing `interrupted`
only"*. `SVC-001-result.md:192` records it as done:

> *"**`ServiceHealthStatus`** narrowed to *removing* `interrupted` only; widening it would take
> SVC-003's scope on a governed fence mutator."*

**The edit did not happen, and CI was green.** A shipped, dated result document asserts a code change
that is not in the tree. That is a recurring class in this programme, not a one-off: a release gate
claiming a deviation was *"stated in `--list`"* when it never was, and a CLI header narrating a
predicate the code no longer had — twice. The common shape is a **document narrating its own diff**
with nothing comparing the narration to the diff.

**Not corrected in place, deliberately.** `docs/replatform/artifact-policy.md` freezes a `complete`
result: *"a later correction creates a finding and a new ticket/result rather than rewriting approved
evidence."* A dated result document is a measurement. Rewriting it would destroy the record that the
claim was ever made, which is the only durable evidence of the class. This finding is the amendment:
it states what was claimed and what is actually there.

### 3. Why `unowned`, and what would close it

`unowned` because the narrowing edit is SVC-003's by `SVC-001-design.md` §3.2 CORRECTION 6a — it
touches a governed fence mutator's input domain — and **SVC-003 has zero files on disk**, so naming
it as owner would red `owner_ticket_missing` and would be the false-ownership claim E4-F013 exists to
refuse. NOT `accepted`: a shipped result document that misreports its own diff is not something to
accept.

**Resolution.** Delete `| "interrupted"` at `tenant/job-control.ts:620` **and** add the missing
subset assertion against the frozen `SERVICE_INSTANCE_STATUSES`, or the same drift recurs. **Do not
fix it by widening the type to all nine** — that expands a governed fence mutator's input domain,
which CORRECTION 6a reserved for SVC-003. Then flip this Status and DELETE the
`scripts/finding-ownership.json` key in the SAME commit.

## E9-F002 — no worker can ever be offered a service job: the daemon's capability intersection removes `workload.service` before placement ever sees it

**Status:** `open`, **NARROWED** 2026-09-09 by SVC-008b (see §1.6) · **Severity:** HIGH
**Owner:** **`unowned`** as of 2026-09-09 — SVC-008 shipped both halves and an open finding owned by
shipped work is owned by nothing (E4-F013). The natural inheritor is **SVC-003**, which has a node in
`program-design.md` but **no ticket file on disk**, so it cannot be named as a `successor` without
failing the guard's existence bar. Declared rather than hidden; see §1.6 and
`scripts/finding-ownership.json`. (Previously: **SVC-008**, `tickets/SVC-008-design.md`, repointed
2026-09-09 — see §4.)
**Filed:** 2026-09-08, by SVC-002 terrain mapping (§2) and re-verified line-by-line for the design's
adversarial review. **Amended 2026-09-09** with §1.5: the capability constant is the *smallest* of
**five** blockers, and the other four were not in this register. (§1.5 items 4-5 were added the same
day by external review of the SVC-008 design; the first amendment named three.)
**Affected tickets:** SVC-002 through SVC-007 (all of E9's dispatch half), DE-12.
**Blocks gate:** yes for any E9 clause asserting a service is dispatched, leased or run.

### 1. The chain, verified at `921b2c1f9`

1. `packages/worker-daemon/src/enrollment/hello-provisioning.ts:27` —
   `SUPERVISABLE_WORKLOAD_CAPABILITIES: readonly WorkerCapability[] = ["workload.batch"]`. Its
   docstring: *"Batch only — the supervisor for browser_session/service composes in later sprints,
   and D4 forbids reporting a workload the daemon cannot run."*
2. `deriveHelloProvisioning` (`:44-50`) builds `deviceCanProvide` from that constant plus
   `capabilitiesForIsolation`, then **intersects**:
   `reportedCapabilities = parsed.data.capabilityCeiling.filter((cap) => deviceCanProvide.has(cap))`.
   **Widening the admin ceiling alone therefore changes nothing** — the intersection removes
   `workload.service` regardless.
3. Placement demands it unconditionally: `workload.${input.workloadType}` at
   `server/src/services/job-placement.ts:177`, returned in the required set (`:190`). A free
   `serviceSlots` is additionally required (`packages/worker-protocol/src/capabilities.ts:528-530`),
   but that is not the binding constraint.

Pinned by `server/src/__tests__/u0-d1-placement-reachability.test.ts:324`, which asserts the constant
equals `["workload.batch"]` so the conclusion cannot go stale unnoticed.

### 1.5 ★★★ AMENDMENT (2026-09-09) — the constant is the smallest of FIVE blockers

Measured at `afebb0e51` while designing SVC-008. Closing §1 alone would make service dispatch
reachable and structurally broken, which is worse than the current inert state.

1. **Mis-supervision that looks like success.** `createSpecFor`
   (`packages/worker-daemon/src/supervisor/supervisor.ts:328-334`) reads only `workload.command` /
   `args`, which `serviceWorkloadV1Schema` also has (`worker-protocol/src/job.ts:316-317`). So a
   service dispatched today runs the **batch** body — `execute` blocking, raced to a deadline
   (`:717-729`) — and emits a batch-shaped `terminal` (`:792-795`). Nothing branches on
   `workloadType` outside the poll loop's concurrency class (`poll/poll-loop.ts:541-542`).
2. **The run budget is wrong by construction and its ceiling is four minutes.**
   `resolveRunOpDeadlineMs` (`lifecycle/run-op-deadline.ts:56-68`) reads
   `workload.maxRuntimeSeconds`; `batchWorkloadV1Schema` has it (`job.ts:294`),
   `serviceWorkloadV1Schema` does **not**. A service falls to `RUN_OP_DEADLINE_FLOOR_MS = 60_000`
   and the sandbox is born with a 60-second TTL (`sandbox-e2b-provider/src/e2b-provider.ts:291,319-327`).
   The ceiling is `RUN_OP_DEADLINE_CEILING_MS = 240_000` (`run-op-deadline.ts:36-46`).
3. **★ The effect authority expires after five minutes and is never re-minted.** The owned-labels
   capability is `min(now + 5 min, leaseDeadline)` (`server/src/services/owned-labels-mint.ts:46,92`)
   and is minted on exactly one route, `/worker-control/execution-secrets/resolve`
   (`server/src/routes/worker-control.ts:709`, applied `:764-765`) — **not** on
   `/leases/:leaseId/renew` (`:511`). The supervisor already documents the consequence at
   `supervisor.ts:794-806` and answers it with `recordOrphan(run, "cap_expired_before_happy_destroy")`.
   **So on the sandbox lane every service run longer than five minutes ends with a billable orphaned
   sandbox the worker cannot tear down.** And it cannot be papered over at create time: `setTimeout`
   is called only from `create` (`e2b-provider.ts:326-327`) and the frozen provider port
   (`worker-daemon/src/supervisor/provider.ts:385-404`) has **no TTL-extension operation**.

4. **★★★ Nothing on the provider port can witness that a process STARTED.**
   `SandboxProvider.execute` (`worker-daemon/src/supervisor/provider.ts:395`) returns a
   **completion** — `exitCode`/`signal`/`timedOut` — with no launch acknowledgement and no process
   handle, and `RealE2bTransport.runCommand` (`sandbox-e2b-provider/src/real-transport.ts:107-175`)
   settles only when the command exits (its own comment at `:128-131` records that
   `sandbox.commands.run()` is `start()` then `CommandHandle.wait()`). The two ops that could stand
   in describe the **sandbox**, not the command: `inspect` → `getInfo` (`e2b-provider.ts:436-448`)
   and `health` → `sandbox.isRunning()` (`:597-601`, `real-transport.ts:263-270`), both of which
   answer "up" from the moment `create` resolves. **So a failed or hung launch would be durably
   recorded as `service_instance_started` and then as an unbroken stream of `service_health:
   healthy` — mis-supervision that reads as success, which is (1) with more confidence.**
5. **★★★ There is no stop primitive, so `gracefulStopSeconds` cannot be honoured.**
   `RealE2bTransport.signal` (`real-transport.ts:177-187`) **ignores `_kind`**, performs a `getInfo`,
   and returns `{delivered: true}` on both branches including the catch. `E2bSandboxProvider.cancel`
   and `.kill` (`e2b-provider.ts:378-386`) are therefore the same read, and the first actual
   termination on this lane is `terminate` inside `destroy` (`:388-393`). A cancel→wait→kill ladder
   would emit `service_instance_stopped` while the command is still running and then hard-kill the
   sandbox in cleanup. ★ **This is already live for batch:** `CleanupAuthority.#convergeOne`
   (`worker-daemon/src/supervisor/cleanup-authority.ts:279-290`) escalates to `kill` only when
   `cancel.outcome === "ignored"`, which real E2B never returns, so the ladder's `kill` rung is
   structurally unreachable on the real provider — and it is masked by `MockE2bTransport.signal`
   (`mock-transport.ts:140-147`), which **does** honour `kind` and **is therefore more capable than
   production**. Batch survives it (the unconditional `destroy` reclaims anyway), so it is a
   fabricated outcome value and a dead rung rather than a leak. **It belongs in E4/CLI's register,
   not this one** — SVC-008 design §10 records who should file it.

(3) is the binding one for **runtime**; (4) and (5) are the binding ones for **honesty**, and unlike
(1)-(3) they cannot be fixed daemon-side at all. (3) is an **effect-authority** question, recorded
unresolved as SVC-008 design §9.1. (4) and (5) require a **provider-port primitive** —
`startProcess`/`processStatus`/`signalProcess` behind a `processSupervisionMode` field, following the
non-frozen `stageFiles`/`artifactExport` precedent so no wire change is needed — specified as SVC-008
design §3.4 and left open as §9.5. **The wire being ready does not help if the provider cannot
produce what the events assert**, and SVC-008 design §11 restates its conclusion around that: no
Protocol Custodian STOP, but a provider change IS required, and the provider half is the larger unit
and belongs to E4/CLI.

**★ AMENDMENT (2026-09-09) — the provider half is now a written ticket.**
**[SVC-008a](tickets/SVC-008a-design.md)** turns SVC-008 §3.4 into a standalone design: the
`startProcess`/`processStatus`/`signalProcess` trio behind a locally-defined `processSupervisionMode`
(the verified `stageFiles`/`artifactExport` non-frozen precedent, `provider.ts:408`, `:433`, `:437`,
`:460`), every implementer, and a conformance test with both arms. **Blockers (4) and (5) of §1.5 are
SVC-008a's; (1), (2) and the consumption of (5) are SVC-008b's** — the daemon supervisor and the
constant widening, which remain everything else in `SVC-008-design.md`. **(3) — the never-re-minted
effect authority — is SVC-008b's**, and stays open as its `SVC-008-design.md` §9.1.

★ **Correction (2026-09-09, review).** An earlier draft of this amendment said blocker (3) was
"owned by neither", which contradicted this finding's unchanged `SVC-008` owner and
`scripts/finding-ownership.json`'s reason that SVC-008 owns E9-F002 end to end. It was also simply
wrong on its own terms: **SVC-008b *is* everything else in `SVC-008-design.md`**, and §9.1 is in
that document — so (3) was never outside the split, only unlisted in it. The split partitions all
five blockers; nothing is unowned and **no manifest change is implied.**

Two things SVC-008a establishes that this finding did not. **(i) The root cause of (5) is a TYPE:**
`StopOutcome` (`worker-daemon/src/supervisor/provider.ts:146`) has no inhabitant for "I witnessed
nothing", so a provider that cannot observe is forced into an affirmative claim. **(ii) The fix
splits**, and only one half depends on the unverified E2B SDK question — the verdict repair reads a
record the current code already fetches and discards, so it needs no new provider capability at all.
**If the SDK cannot express a detached handle, that is the finding** (SVC-008a §9.1) and SVC-008b
falls to its §3.4 fallback, which SVC-008 §5.1 clause 5 says does not earn the widening.

**This finding's Status, Severity and Owner are unchanged.** It is still `open`, still HIGH, still
owned by `SVC-008` — SVC-008a resolves for it to be *possible*, not for it to be *done*, and the
resolution criterion is still T0: a service job observed leased by a real daemon.

### 1.6 ★★★ NARROWED (2026-09-09) — SVC-008b landed; four of five blockers are closed and the finding STAYS OPEN on the fifth

**★★★ READ THIS FIRST: THIS IS NOT A CLOSURE, AND AN EARLIER DRAFT OF THIS SECTION WAS WRITTEN AS
ONE.** `scripts/finding-ownership.json`'s entry for E9-F002 states the resolve criterion as a
**conjunction**: *"SVC-008's T0 green on a shipped daemon (a service job observed leased) **AND**
blocker (3) answered rather than deferred, OR E9's acceptance language amended…"*. T0 is green.
Blocker (3) is **bounded, not answered** — SVC-008 §9.1 is still unruled — and E9's acceptance
language is unamended. So neither disjunct holds, and flipping the status would be exactly the
defect `gate-clause-wiring.json`'s own `$comment` records from earlier the same day: *"A CLAUSE IS
THE UNIT OF CLAIM, AND HALF A CONJUNCTIVE CLAUSE MAY NOT BE ENROLLED."* The finding stays `open`
and its ownership entry stays in the manifest. What follows is what changed, per blocker.

The half that IS met is met **mechanically**, not by assertion.
`server/src/__tests__/u0-d1-placement-reachability.test.ts` runs the **shipped daemon's derived
hello** (via `deriveHelloProvisioning` + `buildDesktopHello`, the same calls
`bin/worker-daemon.ts` makes) against **D1's committed `worker-b` profile** through the **real**
`evaluateStaticLeaseEligibility`, and a `service` job now returns `eligible: true` with a null
reason code. Reverting the constant reds that case and the exact-equality pin, while both batch
cases stay green.

Per blocker, stated so no reader has to infer which are actually gone:

| # | Blocker | State | Where |
|---|---|---|---|
| §1 | the capability intersection removes `workload.service` | **CLOSED** | `SUPERVISABLE_WORKLOAD_CAPABILITIES` is `["workload.batch", "workload.service"]`; the pin at `u0-d1-placement-reachability.test.ts` is UPDATED to exact-equality on the new pair, deliberately not weakened to `toContain` |
| §1.5(1) | mis-supervision that looks like success | **CLOSED** | `runLifecycle` dispatches `workloadType === "service"` to `runServiceLifecycle` (`supervisor/service-lifecycle.ts`) BEFORE `execute`; T1 asserts `execute` is never called on a service run |
| §1.5(2) | the 60 s budget floor | **CLOSED** | `resolveRunOpDeadlineMs` gains a service arm returning the 240 s ceiling. ★ WITNESSED, and it was not at first: `dispatch-runtime.test.ts`'s pure-resolver block asserts the ceiling for a handoff typed `workloadType: "service"` carrying a service workload with no runtime field, AND the 60 s floor for that same workload untyped — neutralising the arm (`&& false`) reds it. Before that pair the arm had ZERO coverage and the whole 154-file / 1020-test worker-daemon suite stayed green with it dead, i.e. this row read CLOSED on an unwitnessed branch. ★ It does NOT use §3.3's stated source: `maxContinuousRuntimeSeconds` is measured absent from the worker side of the wire (the envelope carries a provider-constraint *reference*), so the profile clamp could not be applied and the deviation is recorded at the call site |
| §1.5(3) | the effect authority expires and is never re-minted | **BOUNDED, NOT FIXED** | The supervise loop stops on `capExpiresAt - RUN_TEARDOWN_HEADROOM_MS` and tears down under a valid cap, so no service run orphans a billable sandbox (T6, on the imported constants). What is NOT done is re-minting: SVC-008 §9.1 is UNRULED and the scheduled-re-materialization option would re-run a secret resolution on a timer. **The consequence is a 240-second service.** |
| §1.5(4) | nothing can witness a launch | **CLOSED by SVC-008a, CONSUMED here** | `startProcess` is the launch witness; no handle ⇒ no `service_instance_started` (T4) |
| §1.5(5) | no stop primitive | **CLOSED by SVC-008a, CONSUMED here** | The ladder derives its verdict from `ProcessSignalResult.observation`, never from `accepted`; a process that survives cancel AND kill is `service_instance_lost`, never `_stopped` (T3) |

**★ TWO ZERO-CALLER CLAUSES BECAME REAL, and they are named because a zero-caller function makes
its clause vacuously true.** SVC-008a shipped `EffectAuthority.startProcess`/`.processStatus`/
`.signalProcess` and `deriveStopVerdict` with its own disclosure that they had **zero production
callers** and that "SVC-008b's service loop is the consumer". Measured with the register's own
`countProductionCallers`, before/after: `startProcess` 10→11, `processStatus` 15→16,
`signalProcess` 10→11, and **`deriveStopVerdict` 0→2** — SVC-008b is its first production consumer.

**★ WHAT IS STILL NOT TRUE AFTER THIS.** A daemon can be offered a service job and will supervise
one; nothing yet *creates* one. SVC-008b adds **no consumer** of `recordServiceHealth` and no
`service_health` projection — its `countProductionCallers` reading is **2 at base and 2 at head**,
unchanged by this diff. (An earlier draft of this line said it "keeps its zero production callers";
that number was false against the very instrument cited two paragraphs above, which counts the
declaration and the implementation. The substance — no new consumer — is what the clause needs.)
Ingest is generic (`toAcceptInputs` durably appends any event type and sets `terminalStatus` only for
`terminal`), so every `service_health` / `_started` / `_stopped` / `_lost` emitted here is durably
stored and **projects no state change**. Wiring that projection is SVC-003's, because deciding what
a health event means for ownership is SVC-003's Outcome. Restart/checkpoint are SVC-004's; drain and
generation are SVC-005's; a human path is SVC-007's.

**WHAT WOULD CLOSE THIS FINDING, unchanged from the manifest and restated so nobody has to
reconstruct it:** blocker §1.5(3) answered rather than bounded — a ruling on SVC-008 §9.1 (re-mint
on the tick, re-mint on lease renewal, or accept the ceiling) — **or** E9's acceptance language
amended to say a service is dispatchable only within the effect-authority window, with DE-12's
`deliveryEvidence` corrected to carry that reason. Until one of those, a "service" on this fleet is
a four-minute service, and that sentence is the finding.

**★ AND IT IS NOW `unowned`, which is a downgrade in accountability, said out loud.** SVC-008 owned
this end to end; SVC-008 has shipped. §9.1 option (b) — a fresh capability minted on
`/leases/:leaseId/renew` — is a **server** change on the renew route that SVC-008 §9.1 itself says is
*"not SVC-008's to make"*, and option (a) is an unruled security question. The inheritor that fits is
**SVC-003** (`program-design.md` §SVC-003, "Long-session lease and health semantics"), whose Outcome
is the lease/ownership authority question — but SVC-003 has **no file** under
`docs/replatform/epics/*/tickets/`, and the guard holds `successor` to the same existence bar as
`ticket`. Naming SVC-002 instead (which *does* have a file) to get past that check would be exactly
the register-accuracy defect the guard exists to prevent. **What blocks:** any E9/D4 clause asserting
a *long-running* service, and the 72-hour D4 continuity canary specifically — it cannot be run
against a 240-second service. It no longer blocks service **dispatch** or **supervision**. When
SVC-003 gets a ticket file, flip this back to `owned` and name it.

### 2. Consequence, and why it is filed at HIGH

A reconciler built to `SVC-002-design.md` **creates jobs that can never be placed or leased**. The
placement outcome is `queued` / `no_eligible_target` (`job-placement.ts:642-654`), not a failure, so
nothing errors and nothing alerts: every reconciled service accumulates one `queued` job and one
`pending` instance forever. `GO-BOOK.md:1763-1769` already records the sequencing —
*"enabling `workload.service` dispatch is a prerequisite step before health/restart/drain, not a
given"* — but no register carried it as a finding, and it is additionally **a third and unrecorded
reason DE-12's control cannot fire** (`docs/architecture/distributed-execution-audit-debt.json`
records two).

### 3. Why it was `unowned`, and what would close it

It was `unowned` because the change is a worker-daemon one — widen the constant **and** compose the
service supervisor the daemon does not have — and **no ticket on disk carried it**. SVC-002 through
SVC-007 are control-plane tickets; naming any of them would have been false ownership. HIGH may never
be `accepted` and is not being accepted.

**Resolution.** A daemon advertises `workload.service` and a service job is observed leased **or**
E9's acceptance language is amended to say no service is dispatchable and DE-12's `deliveryEvidence`
is corrected to carry this third reason. Then flip this Status and DELETE the
`scripts/finding-ownership.json` key in the SAME commit.

### 4. Ownership (2026-09-09) — repointed to SVC-008, and the finding stays OPEN

**SVC-008** (`tickets/SVC-008-design.md` + a `#### SVC-008` node in `docs/replatform/program-design.md`)
is filed as E9's only daemon-side ticket and owns this finding. It designs the service lifecycle, the
budget derivation, the four-clause safety condition for widening the constant, and the reachability
test — including what happens to the negative pin at `u0-d1-placement-reachability.test.ts:324`
(updated to an exact-equality pin over both workloads, **not** deleted and **not** weakened to
`toContain`).

**The Status stays `open`, deliberately.** SVC-008 is a *design*; its own resolution criterion —
a service job **observed leased** by a real daemon — is its T0, which the design plans and does not
run. Flipping this finding on a design document would be the "document narrating its own diff"
failure that E9-F001 exists to record. It closes when T0 is green on a shipped daemon, and blocker
(3) of §1.5 is answered rather than deferred.

## E9-F003 — a `service_reconcile` job's executor principal is the SERVICE id under the kind `service_instance`, and that mislabel reaches the worker's lease envelope

**Status:** `open` · **Severity:** MED · **Owner:** `unowned`
**Filed:** 2026-09-10, by the SVC-002 implementation unit, after external review of PR #406
raised it against the shipped reconciler. Recorded in prose since 2026-09-08
(`tickets/SVC-002-terrain.md` §5.4) and **never filed** — which is the weak form this programme
keeps re-learning, so it is filed now.
**Affected tickets:** SVC-003 (the natural inheritor, no file on disk), SVC-002 (first producer).
**Blocks gate:** no for dispatch; yes for any clause asserting that a job is attributable to a
service INSTANCE from the job side.

### 1. The mislabel, verified at `ca5089663`

`serviceSourceIsAdmitted` (`packages/db/src/repositories/tenant/job-control.ts`) selects `id` from
**`services`** and returns it as `{ kind: "service_instance", id: row.id }`. That value becomes
`jobs.executor_principal_kind` / `executor_principal_id`, whose kind column is unconstrained `text`
with no CHECK (`packages/db/src/schema/jobs.ts:54`), so nothing refuses it.

**It does not stop at the row.** `job-leasing.ts`'s `principal()` maps
`kind === "service_instance"` to `principalType: "service"`, and the `service_reconcile` arm of
`source()` puts that `defaultExecutor` into the lease envelope's `executionPrincipal`. So a worker
receives an envelope whose `executionPrincipal.principalId` is the **service** id while the same
envelope's `serviceWorkloadV1` carries a **different** UUID in `serviceInstanceId`. Nothing
reconciles the two, and nothing today reads `executor_principal_id` expecting an instance
(`execution-secret-handle-mint-runner` reads it only for `agent`; `job-fence.ts`'s
`ownerPrincipalId` comparison is self-consistent with whatever was minted), so the consequence
today is a **mislabel**, not a broken flow. It becomes load-bearing the moment SVC-003 fences or
attributes anything instance-scoped from the job side.

### 2. Why SVC-002 did not fix it, and why the obvious fix is worse

The reviewer's proposed repair — *"pass the created instance identity through the admission path
and persist it as the executor principal"* — is not available to SVC-002:

1. **`serviceReconcileSourceSchema` carries no `serviceInstanceId`**
   (`packages/worker-protocol/src/source.ts`). Adding it is a **frozen wire change and a Protocol
   Custodian STOP**, recorded unresolved as `SVC-002-design.md` §10.2, which says a custodian
   should rule because SVC-003's fence work will face the same question with less freedom.
2. **Reading the instance id off the workload instead would be strictly worse.** That field is
   caller-controlled and validated against nothing (`stampServiceIdentity` covers `serviceId` and
   `generation` only, and says so). Promoting an unauthorized caller-supplied value into a
   persisted principal id turns a mislabel into an authorization defect.

**What SVC-002 did deliver instead, and it is a different guarantee:** `service_instances.job_id`
and `.attempt_id` (migration 0275), written in the same transaction, correlate the instance with
the job **from the instance side**. That is the attribution SVC-003 needs for its own rows. What
remains missing is the job-side and envelope-side identity, which is this finding.

### 2a. ★ 2026-09-10 — SVC-003a consumed that attribution, and the finding is NOT closed by it

SVC-003a (`tickets/SVC-003a-result.md`) built the projection §1's last sentence anticipated, and it
resolves the instance **exactly** the way §2 says it must: from `service_instances.job_id`/
`.attempt_id`, never from the envelope's `executionPrincipal` and never from the workload's
caller-controlled `serviceInstanceId`. The payload's instance id is treated as a CLAIM that must
match the attributed row, and a mismatch is refused (`identity_mismatch`, pinned by T4 and killed by
a mutant that drops the comparison).

**That narrows the blast radius; it does not close the finding, and the difference matters.** What
SVC-003a proves is that ONE consumer does not depend on the mislabel. The mislabel itself is
unchanged: `jobs.executor_principal_id` for a `service_reconcile` job still holds a **service** id
under the kind `service_instance`, and the lease envelope still carries it. Any future reader that
takes `executionPrincipal.principalId` for an instance id is still wrong, and the fix is still
either the frozen-wire ruling of §2(1) or a redefinition of what that column means for this source
kind — neither of which SVC-003a made. **Status stays `open`; owner stays `unowned`** (SVC-003a is
shipped, and an open finding owned by shipped work is owned by nothing — E4-F013).

### 3. Why `unowned`, and what would close it

`unowned` because the fix is either a frozen-wire ruling or a change to what
`executor_principal_id` means for this source kind, and the ticket that owns instance identity and
fencing is **SVC-003**, which has a node in `program-design.md` and **no file** under
`docs/replatform/epics/*/tickets/`. Naming it would fail the guard's existence bar; naming SVC-002
(which does have a file) to get past that check would be exactly the register-accuracy defect the
guard exists to prevent — SVC-002 shipped and cannot make a custodian ruling. Not `accepted`: an
identity field that names the wrong entity is not something to accept.

**Resolution.** A Protocol Custodian ruling on `SVC-002-design.md` §10.2 — either add
`serviceInstanceId` to `serviceReconcileSourceSchema` so admission can authorize and stamp it, or
rule that the executor principal for `service_reconcile` is deliberately the SERVICE and rename the
kind from `service_instance` to `service` so the label stops lying. Either way the lease envelope's
`executionPrincipal` and the workload's `serviceInstanceId` must agree or be documented as
different things on purpose. Then flip this Status and DELETE the
`scripts/finding-ownership.json` key in the SAME commit.


## E9-F004 — the frozen lifecycle makes `stopping` the sole predecessor of `stopped`, and NO frozen worker event can assert `stopping`

**Status:** `open` · **Severity:** MED · **Owner:** `unowned`
**Filed:** 2026-09-10, by SVC-003a, after external review of PR #410 caught the consequence in the
shipped diff. **Found by ARMING a symbol that had zero production callers** — the gap had existed
since the table was frozen and nothing could see it, because nothing consumed the table.
**Affected tickets:** SVC-005 (owns the stop-request side and is the natural place for a `stopping`
writer), SVC-003 (first consumer), SVC-008 (the emitter side).
**Blocks gate:** no — SVC-003a works around it. Yes for any clause asserting the instance lifecycle
is traversed edge-by-edge as the frozen table models it.

### 1. The contradiction, verified at `6b39c77f6`

`SERVICE_INSTANCE_TRANSITIONS` (`packages/worker-protocol/src/states.ts`) gives `stopped` exactly
one predecessor:

```
  starting:  [... "stopping" ...]      healthy: [... "stopping" ...]
  unhealthy: [... "stopping" ...]      leased:  [... "stopping" ...]
  stopping:  ["stopped", "failed", "lost"]
```

**No frozen worker event can assert `stopping`.** The five service events are
`service_instance_started` (`starting`), `service_health` (`healthy`/`unhealthy`),
`service_instance_stopped`, `service_instance_lost`, and `service_graceful_stop_observed` — whose
payload is `{ref, deadline}` and which observes a REQUEST, so projecting a process fact from it is
the E7-F034 fail-open SVC-008a exists to refuse. And the shipped supervisor does not pass through
it either: `packages/worker-daemon/src/supervisor/service-lifecycle.ts:293` emits
`service_instance_stopped` directly on an observed `exited`/`gone` — **from `healthy`** — and `:362`
does the same after the graceful ladder.

### 2. What it cost, and why it was invisible

SVC-003a's first revision derived its legality predicate as the DIRECT edges of the frozen table.
Under that derivation **every normal service stop** was refused as `illegal_transition`: the
instance stayed `healthy` inside `service_instances_live_service_uq`, so SVC-002's reconciler could
never replace it — a permanent wedge, and the exact opposite of the ticket's purpose.

**It passed a suite with a named positive control and thirteen killed mutants.** The end-to-end
case drove `service_instance_lost`, which the frozen table makes reachable from every non-terminal
status, so the one status with an unreachable predecessor was the one status never driven. *A
lifecycle table proven over the transitions a suite happens to exercise is not proven over the
table.*

### 3. The workaround SVC-003a shipped, and the residual it leaves

`predecessorsOf` admits every status from which the target is reachable by a legal path whose every
INTERMEDIATE step is a status no event can project (`pending`, `stopping`). In one sentence: *a
worker may skip only the states it cannot witness.* The safety property is untouched at any path
length — the three terminals have no outgoing edges, so no path leaves one and none is ever a
predecessor.

**The residual is real and is why this stays open.** `stopped` is now admitted from `leased` as
well as from the live states, which is wider than the frozen table permits in one hop. The
projection cannot distinguish "skipped `stopping` because nothing writes it" from "skipped
`starting` and `healthy` too", so a service that never started can be reported `stopped`. Nothing
downstream depends on that distinction today; SVC-004's restart policy might.

### 4. What would close it

Either (a) **SVC-005 writes `stopping`** when it issues the graceful stop — a control-plane write
from the request side, which is legitimate because the request IS the control plane's own fact,
unlike a worker asserting it; or (b) a **frozen-table amendment** removing `stopping` from the
`stopped` path, which is a v1 wire change and a Protocol Custodian call. `unowned` because SVC-005
has **no file on disk** and naming it would fail the guard's existence bar (E4-F013). Not
`accepted`: a lifecycle model with an unassertable mandatory state is not something to accept.

## E9-F005 — the daemon emits an attempt terminal with NO service event on the no-handle path, stranding the instance

**Status:** `resolved` 2026-09-10 by **SVC-003a** (`tickets/SVC-003a-result.md`) · **Severity:** MED
**Filed:** 2026-09-10, by SVC-003a, after external review of PR #410. Filed although it is resolved
in the same commit, because the DAEMON behaviour is unchanged and SVC-004's restart policy will meet
it again.
**Affected tickets:** SVC-003 (resolved it), SVC-004 (restart policy), SVC-008 (the emitter).
**Blocks gate:** no.

### 1. The path

`packages/worker-daemon/src/supervisor/service-lifecycle.ts:166` says it in its own words:

> *"No handle ⇒ NO `service_instance_started`. The instance never leaves `leased` and the attempt
> fails."*

So a launch whose `startProcess` throws — and a workload rejected before the supervise loop — emits
`attempt_started` and then a failed `terminal`, with **no service event at all**. The attempt is
terminal while the instance sits `leased` (or `pending`, if `attempt_started` never landed either)
**inside** `service_instances_live_service_uq`, where SVC-002's reconciler can never replace it. It
is E9-F004's permanent wedge reached through a different door, and SVC-008b's own accounting —
*"emits exactly one of `service_instance_stopped` / `service_instance_lost` before the attempt
`terminal`"* — is true only of the paths that got that far.

### 2. How SVC-003a resolved it, and the bound it carries

A **non-succeeded** attempt `terminal` drives the instance to `failed`. Three bounds keep it a
backstop rather than a second opinion: a `succeeded` terminal projects nothing (the service already
emitted `_stopped`, and re-asserting would be the projection overruling an observation); it carries
no claim, so the target is fixed by (job, attempt) attribution; and it is the ONLY projection with
`whenAlreadyTerminal: "noop"`, so on the normal path — where the instance is already terminal — it
is a no-op rather than a refusal on the happy path of every service run. Every service event keeps
`"refuse"`, so the split-brain refusal is untouched; a mutant that flips that default reds the
split-brain case.

**Left for SVC-004:** `failed` is the honest instance status for a run that ended badly, but WHETHER
such an instance should be restarted, and with what backoff, is SVC-004's crash-loop clause. SVC-003a
has no opinion about it.
