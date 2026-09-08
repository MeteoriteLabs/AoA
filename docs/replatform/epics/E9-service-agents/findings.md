# E9 Service agents — findings

Scoped discoveries for E9. Opened 2026-09-08 by SVC-002 design + terrain mapping at `921b2c1f9`,
after adversarial review returned FIX_FIRST on the design and required these to be **filed** rather
than recorded in prose. Both were fully written out in `tickets/SVC-002-terrain.md` §7 item 3; the
filing here is a transcription of that wording plus the verification re-run for the review.

## E9-F001 — `ServiceHealthStatus` still carries `"interrupted"` while the DB CHECK forbids it, and a shipped result document says the edit was made

**Status:** `open` · **Severity:** MED · **Owner:** `unowned`
**Filed:** 2026-09-08, by SVC-002 terrain mapping (§5.1); re-verified at `921b2c1f9`.
**Affected tickets:** SVC-003 (owns the fix), SVC-001 (source of the false claim).
**Blocks gate:** no. Latent today; live the moment SVC-003 wires health.

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

**Status:** `open` · **Severity:** HIGH · **Owner:** **SVC-008**
(`tickets/SVC-008-design.md`, repointed 2026-09-09 — see §4)
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
