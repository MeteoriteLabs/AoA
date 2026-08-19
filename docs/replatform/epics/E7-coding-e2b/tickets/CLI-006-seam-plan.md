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

## Task 1: Credential binding resolver

**Blocked pending the credential-binding terrain map** (workflow `wf_a79c4b7e-ba8`). The map decides whether a resolver can be safely composed at all, or whether CLI-006 must bind only to an already-authorised credential path. Task steps are written once that returns — writing them now would be the placeholder this skill forbids.

Two constraints are already fixed regardless of the outcome:

- It must **reuse** MIG-008's authority (`deriveE2bKeyGeneration` and whatever function already answers "which credential does this company's execution use"), never re-implement it. A parallel implementation is how CLI-002's memory bundle drifted from the crew lineage and dropped a security predicate.
- It must **fail closed**: no credential, a superseded key generation, or an unresolvable Organization all resolve to *no binding*, which must make placement refuse rather than place with a default.

---

## Task 2: Compose the canary path in the composition root

**Files:**
- Modify: `server/src/index.ts:1073-1101`
- Test: `server/src/__tests__/cli-006-composition.test.ts` (create)

Depends on Task 1.

- [ ] **Step 1: Write the failing test** — assert the composed hook resolves a non-canary org to legacy without touching preflight or placement, and that an unwired `ownerResolver` yields `{owner:"legacy"}`.
- [ ] **Step 2: Run it, expect FAIL** (`ownerResolver` not composed).
- [ ] **Step 3: Compose** `ownerResolver: createRunExecutionOwnerResolver({...})` with the rollout-source wrap, `createCanaryPreflight({ store: createDrizzleCanaryPreflightStore(appDb) })`, the existing `createJobConvertOrchestrator({ bridge })`, and `createJobPlacementService` using the Task 1 resolver.
- [ ] **Step 4: Wire the projector** — pass `onAttemptTerminal` to `createJobEventIngestService`, resolving the run by `distributed_job_id`/`distributed_attempt_id` and calling `projectTerminal` with `finalizeRun: heartbeat.finalizeDistributedRun`.
- [ ] **Step 5: Run tests + typecheck.**
- [ ] **Step 6: Commit.**

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
