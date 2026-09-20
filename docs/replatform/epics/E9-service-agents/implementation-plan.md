# E9 — Long-running Service Agents — Implementation Plan (SCOPED, milestone **M3**)

**Plan status:** `scoped` — **deliberately not a ticket plan.** This document fixes the
epic's *boundary*: what is already built, what is consumed, what is locked, what is
measurably blocked, and what would have to be true to pass the gate. Per-ticket
implementation tasks are **not** here. See [§8](#8-ticket-implementation-tasks--written-at-step-0).

> **Doctrine, cited rather than asserted.** `GO-BOOK.md:1906-1908` §7: *"Sprints 6–9 have
> scope and sequence, not implementation plans. Deliberate: they depend on what dispatch
> looks like once live, and a plan written five sprints early goes stale — which is the
> exact failure this audit exists to fix. Step 1 of each is 'write the plan'."* Restated as
> the milestone rule at
> [`../../epic-regrooming/scope-triage.md:167-171`](../../epic-regrooming/scope-triage.md).

---

## 1. Status and milestone position

| Item | Recorded value |
|---|---|
| Epic status | `backlog` (`README.md:3`) |
| Milestone | **M3 — workload breadth** (`scope-triage.md:184`, `:216-217`) |
| Milestone scope | `SVC-003`/`005`/`007` **residuals**, plus `SVC-004` and `SVC-006` (`scope-triage.md:216-217`) |
| Entry | **M2 passed** (`scope-triage.md:184`). M2 needs M1b → M1a → M0. Four milestones sit between HEAD and E9 entry. |
| Named exit gate | **full D4**, including the 72-hour continuity campaign (`scope-triage.md:224`; clauses at `test-gates.md:133-145`) |
| Epic exit gate | `README.md:12` — desired state, generation, placement, health, restart, checkpoint, drain, budgets, UI, and the 72-hour D4 continuity/reconciliation canary pass **without public ingress**. |
| Dependencies | E7; `SVC-007` additionally requires `E10-REALTIME-FOUNDATION` (`README.md:4`) |
| Release coupling | Service is a **mandatory** private-beta workload: E9/D4 blocks `REL-005` even with its exposure flag off (`README.md:16`) |
| Out of scope permanently | Public ingress is **unrepresentable** (`README.md:16`; `scope-triage.md:276`) |

**E9 is the most-wired epic in the register and the furthest from its gate.** Six gate
clauses are `wired` — more than any other epic — and the exit gate is untouched. That gap is
this plan's subject.

---

## 2. What is ALREADY BUILT

The README says `backlog`. `README.md:5-11` is an unusually honest as-built record and is
the primary source for this section; every row below is also checked against the register.

### 2.1 Shipped tickets

| Unit | State | What it delivered |
|---|---|---|
| **SVC-001** — desired-state schema + API | **COMPLETE — CI GREEN** at `e974364d2` (`tickets/SVC-001-result.md:4`) | The storage half: service definition, generation, instance, restart policy, TTL, budget, checkpoint references. |
| **SVC-002** — reconciler + placement | **SHIPPED** (`tickets/SVC-002-result.md`) | The desired-state reconciler and its arming path, with `service_instances_live_service_uq` as the duplicate-placement authority and the `desired_state='running'` predicate. Opened `E9-F003`; **closed no finding**. |
| **SVC-003a** — health projection | **COMPLETE — CI-VALIDATED** | A service observation now **projects**: a worker event moves `service_instances.status` inside the fenced ingest transaction, attributed from SVC-002's `job_id`/`attempt_id` rather than the worker's caller-controlled payload, fenced on the instance's generation, and refused when the FROZEN transition table forbids the move. Armed `canTransitionServiceInstanceStatus`, which had **zero production callers**. **Closes `E9-F001`** (both conjuncts); **opens `E9-F004`**; opened and resolved `E9-F005`. |
| **SVC-003b** — liveness deadline | **SHIPPED** | A live instance whose worker stopped being observed is driven `lost` **by a clock, not an event**, leaves the live-unique index, and is replaced in the same tick. **Two windows that never substitute**: an observed instance is aged against a short liveness window, a never-observed one against `created_at` under a longer admission window; both collapses are mutation-pinned. Opens `E9-F007`, `E9-F008`, `E9-F009`. |
| **SVC-005a** — generation rollout | **SHIPPED** | `rollServiceGeneration`: immutable generation N+1 + a `services.generation` compare-and-set in one transaction under the service's row lock, draining the live instance through the same `requestCancellation({graceful:true})` + attempt-terminal-backstop composition SVC-007a's stop uses. **The fence lives at placement** — step 4b of `reconcileServiceWithinTenant` refuses a cross-generation placement while a previous generation's instance is terminal-by-*assumption* and its attempt is non-terminal, using the durable `service_instances.terminalized_by` (migration `0279`). Opens `E9-F012`. |
| **SVC-007a** — service create + desired state | **SHIPPED** | Makes false the sentence three records carried: **something creates a service, and something writes a generation.** Create + immutable generation-1 in one transaction; desired-state moves through the FROZEN `SERVICE_DESIRED_TRANSITIONS`, arming `canTransitionServiceDesiredState` — the **second** dead frozen fence this epic armed. Stop reaches the shipped `requestCancellation({graceful:true})` channel, and the desired-state write + cancellation + instance terminalization are ONE transaction under the service's row lock. Opens and resolves `E9-F006`. |
| **SVC-007b** — audit | **SHIPPED** | An **audit** unit whose first job was to test its inherited claim — and the claim fell. Both **mutating** service routes now write an `activity_log` row in the **same tenant transaction** as the mutation, carrying the operator's `reason`. `insertActivityLog` takes a plain `Db`; the fence was `jobAuditBridge`'s requirement, not the table's. Opens `E9-F010` (half-resolved) and `E9-F011`. |
| **SVC-008a** — provider process port | **SHIPPED** (`088de1084`) | `startProcess` / `processStatus` / `signalProcess` behind a locally-defined `processSupervisionMode`, plus `deriveStopVerdict`. The root cause it fixed is a **type**: `StopOutcome` had no inhabitant for *"I witnessed nothing"*, so a provider that cannot observe was forced into an affirmative claim. **The work belongs to E4/CLI's port lane** despite the SVC id (`README.md:5`). |
| **SVC-008b** — daemon service supervisor | **SHIPPED** | `runServiceLifecycle` branches before `execute`; the capability widening lands **in the same commit** as the supervisor branch that makes it true. `deriveStopVerdict` went 0→2 production callers here. **A service job can now be offered to a worker and is supervised as a service.** |
| **SVC-005b** — the `drain` producer | **DESIGN ONLY**, no result (`tickets/SVC-005b-design.md:3`) | Would close the `drain` third of `E9-F008`; explicitly **does not** close `E9-F008` (`graceful_stop` and `checkpoint` stay zero-producer). |
| **SVC-009** — re-mint the effect authority | **slice b1 SHIPPED, INERT; b2 not built** | See §5.1. |

### 2.2 Gate clauses — six `wired`, more than any other epic

`scripts/gate-clause-wiring.json`:

| Clause | Status | Symbol |
|---|---|---|
| `E9-1-service-reconciler` | `wired` | `createServiceReconciler` |
| `E9-2-service-supervisor` | `wired` | `runServiceLifecycle` |
| `E9-3-service-health-projection` | `wired` | `applyServiceProjectionForFence` |
| `E9-4-service-liveness-deadline` | `wired` | `sweepOrganizationServiceLiveness` |
| `E9-4-service-create-and-desired-state` | `wired` | `createServiceWithinTenant` |
| `E9-5-service-generation-rollout` | `wired` | `rollServiceGeneration` |

★ Two distinct clauses carry the ordinal **`E9-4`**. The keys are unique so no guard is
affected, but the numbering is not a sequence any more. Recorded, not fixed here.

★ **Not one of the six moves the exit gate, and each result says so in its own words.**
Every shipped SVC result carries an explicit *"It does NOT move the exit gate"* paragraph
(`README.md:6,8,9,10,11`). A wired clause is a claim that a symbol has production callers,
never that a gate clause is satisfied.

### 2.3 Four tickets stay OPEN — exactly which conjunct is missing

Each of these Outcomes is a conjunction. Naming the missing conjunct is the whole point of
this section: *"Half of a conjunction is not it"* (`README.md:10`).

**`SVC-003` — Outcome is a FIVE-way conjunction** (`program-design.md:1040`: health,
liveness deadline, graceful stop, checkpoint request, bounded lease renewal).

| Conjunct | State |
|---|---|
| service health | **DELIVERED** — SVC-003a's projection |
| liveness deadline | **DELIVERED** — SVC-003b |
| **graceful stop** | **NOT DELIVERED** — blocked on `E9-F008`: `graceful_stop` has **zero producers** and `queueGovernedControlCommand` is narrowed at the **type** level against it |
| **checkpoint request** | **NOT DELIVERED** — and **unstorable**: `job_control_commands_kind_check` permits five of the frozen six and omits `checkpoint` (`packages/db/src/schema/job_control_commands.ts:89-92`). The row cannot be written at all. |
| **bounded lease renewal** | **NOT DELIVERED** — only its negative half is pinned (a health event does not extend ownership). Each renewal *extent* is bounded and always was; the **total** is unbounded, and bounding it needs SVC-005's TTL/budget columns. |

**`SVC-005` — Outcome: pause/resume, worker drain, replace-before/after-stop, hard
runtime/spend limits** (`program-design.md:1054`).

| Conjunct | State |
|---|---|
| operator pause/resume | **DELIVERED** — SVC-007a's desired-state transitions |
| generation rollout (the writer + the placement fence) | **DELIVERED** — SVC-005a |
| **worker drain** | **NOT DELIVERED** — blocked on `E9-F008` (zero producers + type-level narrowing). `SVC-005b` is designed and unbuilt. |
| **replace-BEFORE-stop** | **STRUCTURALLY UNREACHABLE** under `service_instances_live_service_uq`, which permits exactly one non-terminal instance per `(organization, service)`. Not a gap to fill — a shape to re-decide. |
| **hard runtime/spend limits** | **UNBUILT** |
| **stuck-stop force-kill** | **UNBUILT** |
| acceptance: *"no two generations may perform external effects simultaneously"* | **NOT CLAIMED.** SVC-005a claims only *"no two generations are PLACED while the older one is un-drained or unwitnessed."* The residual is `E9-F012`; see §4. |

**`SVC-007` — Outcome: create/update/pause/resume/stop controls AND a view of desired state,
generation, active instance, health, checkpoint, budget, restart history**
(`program-design.md:1068`).

| Conjunct | State |
|---|---|
| create / pause / resume / stop controls | **DELIVERED** — SVC-007a |
| every control action is audited | **HALF DELIVERED** — SVC-007b wires `activity_log` into the two **mutating** routes. The **roll** route writes nothing durable, and three mutating endpoints on the same router (job submission, `drain`, worker `revoke`) also write nothing. That is `E9-F010`'s still-open half. |
| generation update | ★ **MOVED SINCE THE README's SVC-007a ENTRY.** `README.md:9` lists *"nothing rolls a generation (SVC-005)"* as not-delivered; SVC-005a subsequently shipped `rollServiceGeneration`. The **route-level** audit for it is still missing (above). |
| **TTL / checkpoint acceptance** | **NOT DELIVERED** — SVC-004 / SVC-005 |
| **the view** (checkpoint, budget, restart history) | **NOT DELIVERED** — the view carries none of the three |
| **idempotent create** | **NOT DELIVERED** |
| **`E10-REALTIME-FOUNDATION` durable catch-up** | **NO CLAIM MADE** — and SVC-007 *cannot* claim reconnect-safe continuity until that gate passes (`README.md:16`) |
| **★ the largest** — *"no service job is leased anywhere in its suite"* | **NOT DELIVERED** — the DAEMON half of "created, supervised, projected" is unexercised. See §5.1. |

**`SVC-008` — both halves SHIPPED** (`README.md:5`), and the triage classes it **C1**
(*"shipped, retained, not required by M1"*, `scope-triage.md:37`, `:371`). What stays open is
not the ticket but its finding: **`E9-F002`**, because its resolve criterion is a
conjunction and only the T0 conjunct holds. SVC-008's own acceptance clause *"no service run
reaches `destroy` with an expired effect authority"* **is** satisfied — by **bounding** the
supervise loop, not by fixing the cap. The consequence is §5.1.

---

## 3. Consumed as-built interfaces — import, do not edit

| Interface | Location | E9 use |
|---|---|---|
| Frozen instance transition table | `packages/worker-protocol/src/states.ts` — `SERVICE_INSTANCE_TRANSITIONS`, `canTransitionServiceInstanceStatus` | The projection's refusal authority. Frozen; `E9-F004` is a defect **in** it, not a licence to edit it. |
| Frozen control-command vocabulary | `packages/worker-protocol/src/transport.ts:601-608` — `CONTROL_COMMAND_KINDS` (six kinds) | Three are produced; `graceful_stop`, `drain`, `checkpoint` are not (`E9-F008`). |
| Frozen provider port | `packages/worker-daemon/src/supervisor/provider.ts` — `SandboxProvider` + SVC-008a's `startProcess`/`processStatus`/`signalProcess` | The supervise loop's only process oracle. `execute` is a **completion** oracle and must never be used for a service. |
| Duplicate-placement authority | `service_instances_live_service_uq` | Exactly one non-terminal instance per `(organization, service)`. `listReconcilableServices` filters on the byte-identical predicate. |
| Fence classifier | `packages/db/src/repositories/tenant/job-fence.ts` — `classifyFence` | Returns `attempt_terminal` before any other test; that is what makes SVC-005a's placement stall **clear** rather than wedge. |
| Cancellation channel | `requestCancellation({graceful:true})` | Shared by SVC-007a's operator stop and SVC-005a's roll drain. |
| Tenant audit write | `server/src/services/activity-log.ts` — `insertActivityLog` | Takes a plain `Db`; `aoa_app` holds `GRANT SELECT, INSERT ON activity_log` (`0213:98`, re-affirmed `0214:166`) under no RLS. The fenceless transactional write is the **norm** (`stageJobInputFiles`, 2 production callers) and `jobAuditBridge` the deviation (0 callers). |
| Effect-authority mint | `server/src/services/owned-labels-mint.ts:52` `OWNED_LABELS_CAPABILITY_EXTENSION_NAMESPACE`, `:129-141` | Delivered on `body.extensions[]` as a **non-critical** extension — frozen-wire-clean, no new top-level field. |
| Lease renewal | `server/src/services/job-fencing.ts:290-308` (the SVC-009 b1 re-mint), route `server/src/routes/worker-control.ts` | Re-verifies the fence and extends the lease; the cap is already lease-clamped, so re-minting here costs nothing new in blast radius. |

---

## 4. Shared decisions and locked contracts

[`decisions.md`](./decisions.md) — **one entry, and it is load-bearing.**

**`E9-D001` — bounded same-service external-effect overlap is PERMITTED; the existing
structural fences ARE its fencing-and-idempotency policy.** Date `2026-09-20`, status
`locked` (founder ruling, operator acting as founder / Protocol Custodian). It is **route
(c)** of `E9-F012` §4 and the third closure route of `E9-F007` §3 — *the escape branch the
acceptance clause itself contemplates*:

> No two generations may perform external effects simultaneously **unless a later approved
> architecture decision explicitly permits overlap and defines its fencing and idempotency
> policy.**

Two findings reached that clause from opposite ends and established the same impossibility:
`E9-F007` (same-generation: the liveness deadline writes exactly one table and deliberately
does **not** touch the lease, because a sweeper with lease authority would be a second owner
of ownership beside `renewLease`/`reapExpiredLeases` — which SVC-003's own acceptance
sentence forbids) and `E9-F012` (cross-generation: a closed fence stops the old worker
**writing**, not its **process**; nothing in the control plane observes a remote process).

**Frozen contracts E9 does not touch:** `SERVICE_INSTANCE_TRANSITIONS`,
`CONTROL_COMMAND_KINDS`, and the `SandboxProvider` port (`decisions.md:3-6`). A breaking wire
change requires the Protocol Custodian and a versioned contract directory.

**Register-close coupling, currently blocking:** `E9-F012`'s status flip and its
`finding-ownership.json` key delete require rewording **DE-12**'s `deliveryEvidence` in
`docs/architecture/distributed-execution-threat-controls.json`, which cites the `E9-F012`
token — `check-distributed-execution-foundation.mjs` clause 3 refuses a dangling citation.
That is a shared-register edit the **register custodian** owns; the three edits land
together. `E9-F007`, having no such coupling, is closed.

---

## 5. Known blockers, measured

### 5.1 ★★★ `E9-F002` — a service is capped at 240 seconds, and closing it is owned OUTSIDE E9

**Severity HIGH; status `open`; owner `SVC-008` with successor `SVC-009`**
(`scripts/finding-ownership.json`).

The run-op deadline is **derived so it cannot drift from its reason**
(`packages/worker-daemon/src/lifecycle/run-op-deadline.ts:38,42,45-46`):

```ts
export const OWNED_LABELS_CAPABILITY_TTL_MS = 300_000;
export const RUN_TEARDOWN_HEADROOM_MS      =  60_000;
export const RUN_OP_DEADLINE_CEILING_MS =
  OWNED_LABELS_CAPABILITY_TTL_MS - RUN_TEARDOWN_HEADROOM_MS;   // 240_000
```

and the service arm returns exactly that ceiling (`:84-86`). The cause is that the run's
Ed25519 `OwnedLabelsCapability` is minted **once** on the secret-resolve route with a
5-minute lease-clamped TTL and is never re-minted; past its TTL the worker cannot tear its
own sandbox down and leaves a billable orphan. SVC-008b **bounded** this (the supervise loop
stops on `capExpiresAt − RUN_TEARDOWN_HEADROOM_MS`), so no run orphans a sandbox — the
consequence is a **240-second service**.

**What has shipped toward it, and what has not.** The founder ruled **option (b)**
(re-mint on lease renewal). `SVC-009` slice **b1 is SHIPPED and INERT**:
`server/src/services/job-fencing.ts:302-308` appends the re-minted capability to
`body.extensions[]` on a fresh renewal — inert on two counts, absent a configured signing
key (the default today) the reply is byte-identical, and no worker consumes the extension.
Slice **b2 is not built**: `run-op-deadline.ts:84-91` computes the deadline from
**constants** at run start and never reads the held capability's expiry.

**★ And b2 alone still would not close it.** `SVC-009-design.md` §4, carrying the ruling's
accepted Rider: the E2B sandbox TTL is fixed at `create` with **no extension operation**, so
even a re-minted cap and a recomputed teardown window leave the sandbox dying at its
create-time TTL. Lifting the observable ceiling additionally needs a longer create-time
deadline (a runtime field the worker side of the wire does not carry today) and a
sandbox-TTL-extension primitive — **both owned outside E9.** The close criterion is *"a
service run observed past 240 s"*, so **E9-F002 cannot be closed by E9 at all.**

**Why this is the epic's first blocker.** `test-gates.md:135` D4-01 requires a campaign on
the same candidate for **at least 72 consecutive wall-clock hours**. A 240-second service
cannot produce it, and the ownership entry says so in as many words.

### 5.2 Migration-gated work needs a `db:generate`-capable checkout

`checkpoint` is one of the six frozen `CONTROL_COMMAND_KINDS`
(`packages/worker-protocol/src/transport.ts:601-608`) and is **omitted** from the persisted
set:

```ts
// packages/db/src/schema/job_control_commands.ts:89-92
commandKindValid: check(
  "job_control_commands_kind_check",
  sql`command_kind IN ('cancel', 'drain', 'graceful_stop', 'product_approval_result', 'runtime_decision_result')`,
),
```

Widening that CHECK is **table DDL**, which `CLAUDE.md` rule 1 and Decision #19/#122 require
to be `pnpm db:generate` output — it is not in either C14 narrow-exception class and may
**never** be hand-authored. The latest committed migration is
`packages/db/src/migrations/0282_internal_agent_runs_distributed_marker.sql`. So
`SVC-003`'s checkpoint-request conjunct, `SVC-004` in full, and any part of `E9-F008` that
touches `checkpoint` **cannot proceed in a checkout without a working `db:generate`
toolchain**, regardless of design readiness. Step 0 must verify the toolchain before
scheduling any of it.

### 5.3 Open findings — seven, measured at HEAD

`E9-F001`, `E9-F003`, `E9-F005`, `E9-F006`, `E9-F007` are resolved.

| Finding | Sev | What it blocks |
|---|---|---|
| **`E9-F002`** | **HIGH** | §5.1. A service is a 240-second service. Blocks D4-01 outright. Owner `SVC-008`, successor `SVC-009`; closure needs work owned outside E9. |
| **`E9-F004`** | MED · `unowned` | The frozen table makes `stopping` the **sole** predecessor of `stopped`, and **no frozen worker event can assert `stopping`**. The sixth event, `service_graceful_stop_observed`, carries only `{ref, deadline}` and observes a **request** — projecting a process fact from it is the E7-F034 fail-open SVC-008a exists to refuse. SVC-003a's first revision refused every normal service stop and wedged the instance; it survived a named positive control and thirteen mutants because the only end-to-end case drove `service_instance_lost`. Blocks a clean service stop. |
| **`E9-F008`** | MED · `unowned` | Three of six frozen control-command kinds (`graceful_stop`, `drain`, `checkpoint`) have **zero producers**; `checkpoint` additionally cannot be persisted (§5.2); and a repository docstring said otherwise. Not a one-line gap — `queueGovernedControlCommand` is narrowed at the **type** level. **Blocks SVC-003's graceful-stop and checkpoint conjuncts and SVC-005's drain conjunct.** `SVC-005b` is designed for the `drain` third only. |
| **`E9-F009`** | MED · `unowned` | A `lost` row records the **status**, not the **author** — a deadline kill and a worker-reported loss are indistinguishable after the fact, and they differ on something material: a deadline kill means the worker **may still be running**. The instance-specific durable half shipped as `service_instances.terminalized_by` (migration `0279`) because SVC-005a's fence needs it as an **input**; the **durable telemetry half** is deliberately not delivered. |
| **`E9-F010`** | MED · `unowned` (**half resolved**) | Both mutating *service* routes now write `activity_log`. Still open on: the **roll** route, plus job submission, `drain` and worker `revoke` on the same router — **unwired rather than blocked**. `jobAuditBridge` still has zero production callers. Note DE-01 is untouched: its `audit` clause is about **policy-denial** events, not mutating actions. Blocks SVC-007's "every control action is audited". |
| **`E9-F011`** | LOW · `unowned` | `createServiceWithinTenant`'s `null` branch **commits** a service with no generation — the permanent `no_generation` wedge — while its docstring said the transaction rolls back. Unreachable by construction today; the docstring is corrected and the fix left to SVC-005's rollout, which makes the conflict constructible for the first time. |
| **`E9-F012`** | **HIGH** · `unowned` | Substantively **resolved by `E9-D001` route (c)**; the register close is **pending the custodian** (§4). It does not block the gate — E9's gate is unmet for larger reasons — but it bounds what SVC-005a may be read to claim. DE-12's `deliveryStatus` stays `partial`; a `logger.info` line is not a durable record. |

### 5.4 Other measured blockers

- **No service job is leased anywhere in any E9 suite** (`README.md:9`, `:11`). The daemon
  half of "created, supervised, projected" is unexercised end to end. This is distinct from
  §5.1: the capability is now advertised and `workload.service` is in
  `SUPERVISABLE_WORKLOAD_CAPABILITIES` (`packages/worker-daemon/src/enrollment/hello-provisioning.ts:59`),
  so the block is coverage, not reachability.
- **`SVC-007` cannot claim reconnect-safe continuity until `E10-REALTIME-FOUNDATION`
  passes** (`README.md:16`). That gate is not in M3's scope list.
- **`SVC-004` and `SVC-006` have no ticket files** — design, terrain and acceptance intent
  all have to be written. `SVC-006` is the D4 canary itself.
- **The reconciler's proof is per-service, not per-process.** SVC-007a proved convergence
  through `createServiceReconciler(...).tick()` with the admitted-organization enumerator
  **stubbed** — what is proven is that a created service enters `listReconcilableServices`'s
  window, **not** that the process wiring runs (`README.md:9`).
- **A recurring shape, worth pre-empting at Step 0: the bounded-sweep starvation bug.**
  External review of PR #413 found the batch ordered by `created_at`, so healthy instances —
  which never leave the live set — filled it forever and a silent instance created after
  them was **never inspected**. That is PR #406's starvation bug rebuilt one function along,
  **beside its own correction note**.

---

## 6. Exit gate

**Normative gate (the only one that completes E9):** `README.md:12` — desired state,
generation, placement, health, restart, checkpoint, drain, budgets, UI, and the **72-hour D4
continuity/reconciliation canary** pass **without public ingress**. Its test authority is
**full D4** (`test-gates.md:133-145`): D4-01 ≥72 consecutive wall-clock hours on one
candidate; D4-02's fault schedule (two control-plane restarts, two worker restarts, one
15-minute partition, one drain, one generation update, one checkpoint restore, one
budget/TTL stop, plus provider pause/resume or a forced 15-minute outage); D4-03 zero
overlapping active fences or effectful generations; D4-04 zero post-fence
secret/context/connector/artifact operations; D4-05 health events never extend lease
ownership; D4-06 ≥99.5% healthy availability; D4-07 convergence ≤2min / ≤10min; D4-08
bounded, attributable ambiguous effects; D4-09 checkpoint identity match.

**Named partial gates that may SUPPORT but never COMPLETE it:** none exist for E9.
`M1-D1-SPINE` and `M1-D2-CODING` are the only named partial gates in the triage
(`scope-triage.md:140-155`); both are `task_run`-scoped and both are declared
**non-promoting** (`:157-159`).

**The six `wired` clauses do not support it either.** A wired clause asserts a symbol has
production callers. Every shipped SVC result explicitly disclaims the gate.

**Two things D4 is not, recorded so a campaign is not mis-specified:**
- D4 is *"checkpoint-and-reconcile continuity under the accepted E2B caveat, not a promise
  of one uninterrupted sandbox"* (`README.md:16`; `test-gates.md:135`).
- **`E9-D001` changes what D4-03 can mean.** Bounded same-service overlap is now a
  documented allowance with a stated fencing policy, not a defect. A campaign must record
  the allowance rather than assert overlap never occurred.

---

## 7. NOT in scope

- **Public ingress.** *"Public ingress remains unrepresentable"* (`README.md:16`) and is a
  programme exclusion (`scope-triage.md:276`) — not a later phase.
- **Editing the frozen contracts.** `SERVICE_INSTANCE_TRANSITIONS`, `CONTROL_COMMAND_KINDS`
  and the `SandboxProvider` port are untouched by every E9 decision (`decisions.md:3-6`).
  `E9-F004` is a defect inside a frozen table and is **not** a licence to edit it.
- **Hand-authored DDL.** Widening `job_control_commands_kind_check` is table DDL and must be
  `db:generate` output (§5.2). Neither C14 exception class covers it.
- **The E2B sandbox-TTL walls** — a longer create-time deadline and a TTL-extension
  primitive. Both are *"owned outside E9"* (`SVC-009-design.md` §4), and without them
  `E9-F002` cannot close however much E9 builds.
- **`SVC-008a`'s port work.** It carries an SVC id but *"the work belongs to E4/CLI's port
  lane"* (`README.md:5`).
- **`E9-F012`'s register close.** It is a shared-register edit the register custodian owns
  (§4), not E9 engineering.
- **Re-opening the acceptance of SVC-001/002/003a/003b/005a/007a/007b/008a/008b.** They
  shipped; the triage classes SVC-008 **C1** and forbids re-opening C1 acceptance
  (`scope-triage.md:35`).
- **Replace-BEFORE-stop as a build item.** It is structurally unreachable under the live
  instance index; changing that is an architecture decision, not a task.

---

## 8. Ticket implementation tasks — WRITTEN AT STEP 0

**There are none here, by design.** Per-ticket tasks are authored **just-in-time at M3's
Step 0, against HEAD**. The doctrine is `GO-BOOK.md:1906-1908` §7, restated at
`scope-triage.md:167-171`: *"a plan written five sprints early goes stale — which is the
exact failure this audit exists to fix."* Four milestones sit between HEAD and E9's entry,
and this epic has shipped ten units in roughly two weeks — every measurement in §2 and §5
must be **re-taken** at Step 0, never inherited.

Tickets that will need tasks, with their disposition as measured for this plan:

| Ticket | Disposition today | What Step 0 must resolve first |
|---|---|---|
| `SVC-003` residual | OPEN on 3 of 5 conjuncts | Graceful stop and checkpoint request both route through `E9-F008`; checkpoint additionally needs §5.2's migration toolchain. Bounded lease renewal needs SVC-005's TTL/budget columns, so it **sequences after** SVC-005, not before. |
| `SVC-005` residual | OPEN on drain, hard limits, force-kill | `SVC-005b` is designed and unbuilt for the `drain` third only. Decide whether it is revived as-is or folded into a whole-`E9-F008` unit. Replace-before-stop needs a decision, not a task. |
| `SVC-007` residual | OPEN on audit-completeness, the view, idempotent create, realtime | The view's three missing columns (checkpoint, budget, restart history) depend on SVC-004/SVC-005 existing at all. `E10-REALTIME-FOUNDATION` must be confirmed passed. |
| `SVC-004` — restart, backoff, checkpoint recovery | **no ticket file**; node at `program-design.md:1044` | Fully migration-gated (§5.2). Its acceptance — *"local disk alone cannot qualify as recovery state"* — interacts with DAT-002's artifact path. |
| `SVC-006` — service golden canary | **no ticket file**; node at `program-design.md:1058` | **This is the D4 campaign.** It cannot be scheduled while §5.1 holds: 72 hours cannot be run against a 240-second service. |
| `SVC-009` b2 | b1 shipped inert; b2 unbuilt | Must sequence **with** the sandbox-TTL work owned outside E9 — in isolation neither changes an observed service duration (`SVC-009-design.md` §4). |
| *(unfiled)* — `E9-F004`'s `stopping` predecessor | no ticket | Either a frozen-table amendment (Protocol Custodian) or a new event that can honestly assert `stopping`. Decide the route before writing tasks. |
| *(custodian)* — `E9-F012` close | not engineering | DE-12 reword + status flip + key delete, in one commit, by the register custodian. |

---

## 9. Reopen triggers

Re-open and re-measure this plan — do not execute it — if any of the following becomes true:

1. **`RUN_OP_DEADLINE_CEILING_MS` stops being 240 s**, or `run-op-deadline.ts:84-91` starts
   reading the held capability's expiry instead of constants. That is `SVC-009` b2 landing
   and it changes §5.1's shape.
2. **A sandbox-TTL-extension primitive or a longer create-time deadline appears** — the two
   walls owned outside E9. Without them `E9-F002` cannot close; with them it can.
3. **A service run is observed past 240 s.** That is `E9-F002`'s literal close criterion and
   the precondition for scheduling `SVC-006`.
4. **`job_control_commands_kind_check` gains `checkpoint`**, or a `db:generate`-capable
   checkout becomes available — §5.2's gate on `SVC-003`'s checkpoint conjunct and `SVC-004`.
5. **Any of `graceful_stop` / `drain` / `checkpoint` gains a producer** (`E9-F008`), or
   `SVC-005b` ships — that releases SVC-003's and SVC-005's blocked conjuncts.
6. **Any gate clause's status changes**, or a **seventh** E9 clause is enrolled — and note
   that a wired clause still proves nothing about the gate.
7. **`E9-F012`'s register close lands**, or DE-12's `deliveryStatus` moves off `partial`.
8. **A service job is observed leased in any E9 suite** — §5.4's largest coverage gap.
9. **`E10-REALTIME-FOUNDATION` passes or is rescoped** — `SVC-007`'s dependency and the
   epic's durable-catch-up conjunct.
10. **M2 passes**, which is E9's actual entry condition (`scope-triage.md:184`). That is the
    trigger to write the real ticket plans, not to run this one.
