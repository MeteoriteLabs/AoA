# CLI-006 Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transfer execution ownership of one canary Organization's coding run from the legacy in-process adapter to a distributed worker attempt, and surface its evidence in the existing run experience.

**Architecture:** A durable `execution_owner` marker on `heartbeat_runs` makes the transfer visible to every consumer that would otherwise terminalize, cancel, or reap the run. One decision function (`resolveRunExecutionOwner`) is computed at a single point late in `executeRun` — after context assembly, because the immutable job envelope carries context as artifacts — and both the placement and the legacy-suppression guard read that one value. The attempt becomes the terminal authority; a projector fires from the JOB-005 after-commit ingest hook and finalizes the run.

**Tech Stack:** TypeScript, Drizzle ORM, Vitest, Express 5, Postgres. Worktree `C:\e3`, branch `docs/replatform-program` (PR #323).

---

## Status of work already landed

These tasks are **complete and pushed**; they are listed so the plan reads as a whole and so a fresh engineer does not redo them.

| # | Task | Commit |
|---|---|---|
| — | Projector non-terminal-status defect (`succeeded` ≠ `"completed"`) | `089ee34ab` |
| — | Migration 0258 — `execution_owner` / `distributed_job_id` / `distributed_attempt_id` | `113463f92` |
| — | R1: reaper stands down for distributed-owned runs | `d5d7e890c` |
| — | R1b: reaper honours the terminal latch before recovering | `ad2e15eb5` |
| — | After-commit attempt-terminal projection trigger | `ddaa29b78` |
| — | Drizzle canary preflight store (delegating to MIG-008) | `5624beba0` |
| — | Projector finalization + won/lost latch semantics (R7) | `0b6d146f6` |
| — | `finalizeDistributedRun` capability on `heartbeatService` | `eccdfb639` |

**Invariant honoured throughout:** every safety net lands *before* the thing that arms it. Nothing above changes behaviour for any existing run — the marker is null everywhere, the trigger is unwired, the resolver is uncomposed. The seam (Task 3) is the switch, and it goes last.

---

## File structure for the remaining work

| File | Responsibility |
|---|---|
| `server/src/services/canary-credential-binding.ts` | **Create.** Resolve which provider credential a canary attempt binds to. Delegates to MIG-008's authority; never re-implements it. |
| `server/src/index.ts` | **Modify** (~1073-1101). Compose `ownerResolver` + preflight + placement service into the rollout hook, and wire `onAttemptTerminal` → projector → `finalizeDistributedRun`. |
| `server/src/services/heartbeat.ts` | **Modify** (~5145-5147). The ownership call and the suppression guard. The only edit to the legacy call site. |
| `server/src/services/heartbeat.ts` | **Modify** (cancel writers ~6761/6809/6857/6894). Route a distributed-owned run's cancel to `requestCancellation`. |
| `server/src/routes/issues.ts` | **Modify** (~177-197). The raw `tx.update` cancel writer that bypasses `setRunStatus` entirely. |
| `docker/d1/campaign.env` | **Modify.** Nonce bump — `server/src` is off the D1 lane's path filter. |

---

## Task 1: Credential binding resolver — DONE

**Files:**
- Create: `server/src/services/canary-credential-binding.ts`
- Test: `server/src/__tests__/cli-006-canary-credential-binding.test.ts`

**Outcome: compose a constant, non-asserting binding (four explicit nulls). REFUSE any credential-derived resolver.**

The adversarial map established that a credential-derived resolver is not merely risky here, it is not constructible. `resolveCredentialBinding` receives four fields (`job-placement.ts:398-403`); `resolveProviderCredential` needs nine (`provider-resolution.ts:155-165`). Three of the six missing ones cannot be threaded:

- **`currentEnv` is an ordering impossibility.** The heartbeat computes `resolvedEnv` at `heartbeat.ts:3378` and `hbProviderId` at `:3430` — 140+ and 190+ lines AFTER the convert/place seam that reaches this resolver. A resolver here would have to re-derive the run's own credential decision from inputs that do not exist yet, producing two decisions per run that can disagree.
- **`executionTargetId` is circular.** `chooseGovernedSubscriptionBinding` validates against an expected target; placement is what chooses one.
- **`agentId` is not on the job.** Reachable only through `jobs.executorPrincipalId`, which is overloaded (`{kind:"worker", id: agentId}` for task_run, an opaque operationId for one_shot).

**Verified independently before accepting:** `requestedTarget: null` is hardcoded on every submitted job (`job-submission.ts:134-138`), and `TARGET_KIND_BY_CLASS` maps `owner_desktop` to `{desktop, local_host}` only while `pooled_gvisor` sits under `managed_cloud` (`execution-target-resolver.ts:52-55`). With four nulls the pin is null, routing falls to the `pooled_gvisor` branch (`:195`), and **no reachable path reaches an `owner_desktop` target** — the DE-29 owner-misrouting class is structurally excluded.

That exclusion is load-bearing because the check that would otherwise catch misrouting is **tautological**: `credentialOwnerId` is read off the routed target's profile (`job-placement.ts:279-281`) and `requiredOwnerPrincipalId` off the same profile (`:289`), so `candidateFits` compares a value to itself (`:548-555`).

**Do not enrich this binding.** A rotating value (a key generation, a freshly-read credential row) is hashed into `placementInputDigest`/`placementPolicyDigest`; a digest that changes between first placement and a retry throws `placement_already_decided` → `transfer_error` → that run falls back to legacy permanently. Credential-generation freshness belongs to the preflight, which already owns it.

- [x] Implementation + 8 tests locking the nulls, byte-stability, key-set stability, and copy-on-return.

## Task 2a: Compose the canary ownership path — DONE

**Files:** Modify `server/src/index.ts:1055-1101`; test `server/src/__tests__/cli-006-run-execution-owner.test.ts`.

Composed `ownerResolver` from the shared rollout source, the MIG-008 preflight over its delegating store, the existing convert orchestrator, and the placement SERVICE with the null credential binding. `deploymentEnabled` uses the already-resolved `config.distributedExecutionEnabled`, not a second `process.env` read — two reads of the gate can disagree after a reload.

**The placement adapter is extracted as a named, tested `toRunExecutionPlacement` because the compiler cannot guard it.** `JobPlacementServiceInput` requires `now` and `maxHeartbeatAgeMs`, which `RunExecutionPlacement.place` does not supply; since `place` uses method-shorthand syntax, TypeScript's parameter bivariance lets `placement: placementService` compile clean — **verified by mutating the real composition root and running `tsc` (exit 0)**. At runtime that hands `decideJobPlacement` `now: undefined`, failing its `now instanceof Date` check → `invalid_placement_input` → every canary transfer silently falls back to legacy, with no type error and no failing test.

- [x] Composition + 4 adapter tests (22 total in that file). Commit `f569a9985`.

---

## Task 2b: Wire the projector into the ingest hook

**Files:**
- Modify: `server/src/services/job-events.ts` — already accepts `onAttemptTerminal` (landed `ddaa29b78`)
- Modify: `server/src/routes/worker-control.ts:74-98` — add `onAttemptTerminal` to opts, pass to `createJobEventIngestService`
- Modify: `server/src/app.ts:446-454` — thread it through
- Modify: `server/src/index.ts` — build the callback
- Test: `server/src/__tests__/cli-006-projector-wiring.test.ts` (create)

**Composition-ordering problem to solve first, before any code.** `createJobEventIngestService` is composed in `worker-control.ts:98` (reached via `app.ts:447`), not at the composition root, so the callback threads three hops. Worse, the callback needs `heartbeat.finalizeDistributedRun`, and `heartbeatService` is constructed inside a *different* conditional (`if (config.heartbeatSchedulerEnabled)`) from the distributed block (`if (config.distributedExecutionEnabled && distributedExecutionDatabases)`). **Those two conditions are independent: a deployment can enable one without the other.**

Decide explicitly, and write the decision into the plan before implementing:
- What the callback does when distributed execution is on but the heartbeat scheduler is off (no `finalizeDistributedRun` available). Fail-closed answer: project the terminal and the summary, skip finalization, and log — never silently drop.
- Whether the callback is built lazily (resolved at call time) or eagerly (requires reordering the two blocks).

- [ ] **Step 1: Write the ordering decision into this task**, then the failing test asserting a terminal signal reaches `projectTerminal` with the run resolved by `distributed_job_id`/`distributed_attempt_id`.
- [ ] **Step 2: Run it, expect FAIL.**
- [ ] **Step 3: Add `onAttemptTerminal` to `workerControlRoutes` opts and pass it to `createJobEventIngestService`.**
- [ ] **Step 4: Thread through `app.ts` opts.**
- [ ] **Step 5: Build the callback in `index.ts`** — resolve the run by the marker columns, construct the projector with `finalizeRun` per the ordering decision.
- [ ] **Step 6: Run tests + typecheck. Commit.**

---

## Task 3: The suppression seam

**Files:**
- Modify: `server/src/services/heartbeat.ts` (ownership call before `:5145`; guard between `:5146` and `:5147`)
- Test: `server/src/__tests__/cli-006-seam-suppression.test.ts` (create)

**The insertion point is load-bearing and verified.** The `return` must be **inside** the inner `try`, not before it. `heartbeatMcpDelivery.cleanup()` has exactly one call site (`:5192`, in that inner `finally`) and `deregisterRuntimeHook` one (`:5190`). Returning before `try {` skips both, leaking a 24h-valid runtime-permission token and a tmpdir MCP config file that, for non-brokered `claude_local`, **embeds `DATABASE_URL`** — no TTL, no sweeper.

- [ ] **Step 1: Write the failing test** — on a suppressed run assert `adapter.execute` is NOT called, and `deregisterRuntimeHook` + `heartbeatMcpDelivery.cleanup` are each called exactly once.
- [ ] **Step 2: Run it, expect FAIL.**
- [ ] **Step 3: Add the ownership call** before `:5145`, guarded on `distributedRolloutHook && distributedRolloutState === "canary" && distributedRolloutOrganizationId && issueId && issueContext && issueContext.assigneeAgentId === agent.id`, storing the single result.
- [ ] **Step 4: Add the suppression guard** as the first statement inside the inner `try` — mark the run handed off (`execution_owner`, job/attempt ids, `updatedAt`), append one lifecycle run event, `return`.
- [ ] **Step 5: Run tests + typecheck.** Confirm TS definite-assignment on `adapterResult` survives an early return inside the try — assert with `tsc`, not inspection.
- [ ] **Step 6: Mutation-check** — move the `return` one line up (before `try {`); the cleanup test must go RED. Restore.
- [ ] **Step 7: Commit.**

---

## Task 4: Cancel routing for distributed-owned runs (R3)

**Files:**
- Modify: `server/src/services/heartbeat.ts` (`:6761` `cancelRun`, `:6809`/`:6857`/`:6894` `cancelBudgetScopeWork`)
- Modify: `server/src/routes/issues.ts:177-197`
- Test: `server/src/__tests__/cli-006-cancel-routing.test.ts` (create)

**Today cancel is a lie for these runs.** Every writer's only stop mechanism is `runningProcesses.get(run.id)`, which misses; `grep requestCancellation server/src/services/heartbeat.ts` returns zero hits. Worse, the writer latches the run `cancelled`, so the projector's later terminal is discarded and the distributed evidence is lost.

**`issues.ts:177-197` is the trap:** it writes `cancelled` with a raw `tx.update`, bypassing `setRunStatus` entirely — so a guard placed only in `setRunStatus`/`cancelRun` does not cover it.

- [ ] **Step 1: Write the failing test** — for each of the five writers, with a distributed-marked run, assert `requestCancellation` is called with the stored `jobId` and the heartbeat side does NOT write a terminal status.
- [ ] **Step 2: Run it, expect FAIL** on all five.
- [ ] **Step 3: Route each writer** — on `execution_owner === "distributed"`, call the fence-revoking `requestCancellation` and leave terminalization to the projector.
- [ ] **Step 4: Run tests + typecheck.**
- [ ] **Step 5: Commit.**

---

## Task 5: Org capacity double-count (R4)

**Files:**
- Test: `server/src/__tests__/cli-006-capacity-trap.test.ts` (create)

`resolveOrgCapacityUsage = legacyRunning + heldAttempts` (`org-concurrency.ts:136-144`). A suppressed run satisfies `legacyRunning` (still `status='running'`) while its attempt satisfies `heldAttempts`, and capacity is claimed at submit — inside the convert, i.e. inside `resolveRunExecutionOwner`. **At `concurrency_cap = 1` — the natural operator choice for a canary — the transfer is structurally impossible:** admission denies with 429 → `convert_failed` → legacy, silently.

This task documents the trap with tests rather than changing the capacity engine (JOB-007 owns it); the operator guidance goes in the result doc.

- [ ] **Step 1: Write the test** — cap 1 with one running legacy run for the org asserts `{owner:"legacy", reason:"convert_failed"}`; a companion at cap ≥ 2 asserts `{owner:"distributed"}`.
- [ ] **Step 2: Run and confirm both pass** (this characterises current behaviour; it is not expected to fail first).
- [ ] **Step 3: Commit.**

---

## Task 6: The unguarded await in the outer finally (R6)

**Files:**
- Modify: `server/src/services/heartbeat.ts:5799`
- Test: add to `server/src/__tests__/cli-006-seam-suppression.test.ts`

`dispatchQueuedRunsAfterAgentSignal` at `:5799` is the only bare `await` in the outer `finally` (the neighbours at `:5783`/`:5792`/`:5795` are `.catch`-chained). It throws in the tenant-isolated branch (`:2829`). If it throws after a suppression `return`, `executeRun`'s promise rejects into the call-site `.catch` (`:2717`/`:2780`), which — seeing the run still `running` — writes `pre_spawn_failed` and releases the issue. **That is exactly the legacy finalization the seam exists to prevent, reached through an exception.**

- [ ] **Step 1: Write the failing test** — force `dispatchQueuedRunsAfterAgentSignal` to reject on a suppressed run; assert status stays `running` and `errorCode` is not `pre_spawn_failed`.
- [ ] **Step 2: Run it, expect FAIL.**
- [ ] **Step 3: Fix** — `.catch(() => undefined)` on `:5799`.
- [ ] **Step 4: Run tests. Commit.**

---

## Task 7: Fire the D1 lane

**Files:**
- Modify: `docker/d1/campaign.env`

`server/src` is **not** on `d1-merge-train.yml`'s path filter, so a server-only change silently does not run the live lane. This bit DEP-009 already.

- [ ] **Step 1: Bump the re-trigger nonce** with a comment naming the CLI-006 seam.
- [ ] **Step 2: Commit and push; watch the lane to green.**

---

## Task 8: Adversarial review and result doc

- [ ] **Step 1: Adversarial review workflow** — refute-by-default, targeting double-execution specifically: partial deployment, config change mid-run, replayed convert, placement succeeding after the suppression check, and a worker leasing an attempt whose run already went legacy.
- [ ] **Step 2: Controller re-verification** — re-trace each confirmed finding personally; fix fail-first.
- [ ] **Step 3: Write `CLI-006-result.md`** — including an honest deferral list. Known deferrals: the D1/D2 volume clauses are operator campaign records; the JOB-006 sweeper still has no production trigger, so a lease that expires without a terminal event has no convergence path.
- [ ] **Step 4: Commit, push, watch CI.**

---

## Self-review notes

- **Spec coverage:** the 13 acceptance verbs map to Tasks 2-4 (create/schedule/lease/stage/execute/stream/patch/review/retry/cancel) and the existing JOB-008 surface (audit/operator inspection); non-canary isolation is the four-mode matrix already landed in `cli-006-canary-rollout-mode.test.ts`.
- **Known gap, deliberately not hidden:** with the JOB-006 sweeper unscheduled, an attempt whose lease expires without emitting a terminal event strands its run in `running` forever. Task 8 records it; scheduling `createJobControlSweeper` belongs to MIG-002's cutover, not to the canary.
- **Task 1 is genuinely unwritten**, not a placeholder — it is blocked on a security decision in flight, and the plan says so rather than inventing steps.
