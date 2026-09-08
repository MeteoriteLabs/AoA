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

**Status:** `open` · **Severity:** HIGH · **Owner:** `unowned`
**Filed:** 2026-09-08, by SVC-002 terrain mapping (§2) and re-verified line-by-line for the design's
adversarial review.
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

### 2. Consequence, and why it is filed at HIGH

A reconciler built to `SVC-002-design.md` **creates jobs that can never be placed or leased**. The
placement outcome is `queued` / `no_eligible_target` (`job-placement.ts:642-654`), not a failure, so
nothing errors and nothing alerts: every reconciled service accumulates one `queued` job and one
`pending` instance forever. `GO-BOOK.md:1763-1769` already records the sequencing —
*"enabling `workload.service` dispatch is a prerequisite step before health/restart/drain, not a
given"* — but no register carried it as a finding, and it is additionally **a third and unrecorded
reason DE-12's control cannot fire** (`docs/architecture/distributed-execution-audit-debt.json`
records two).

### 3. Why `unowned`, and what would close it

`unowned` because the change is a worker-daemon one — widen the constant **and** compose the service
supervisor the daemon does not have — and **no ticket on disk carries it**. SVC-002 through SVC-007
are control-plane tickets; naming any of them would be false ownership. HIGH may never be `accepted`
and is not being accepted.

**Resolution.** A daemon advertises `workload.service` and a service job is observed leased **or**
E9's acceptance language is amended to say no service is dispatchable and DE-12's `deliveryEvidence`
is corrected to carry this third reason. Then flip this Status and DELETE the
`scripts/finding-ownership.json` key in the SAME commit.
