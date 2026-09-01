// server/src/services/distributed-rollout-port.ts
//
// Unit 1.5 — the process-wide port that carries the CLI-006 rollout hook to EVERY
// `heartbeatService` instance, not just the scheduler's.
//
// ★ WHY THIS EXISTS — MEASURED, not theorised.
//
// `heartbeatService(db, options?)` reads the hook from `options?.distributedRollout`
// (`heartbeat.ts`), and exactly ONE construction site supplies it:
//
//   index.ts   heartbeatService(db, { distributedRollout: distributedRolloutHook })   // scheduler only,
//                                                                                     // and itself behind
//                                                                                     // `if (config.heartbeatSchedulerEnabled)`
//
// Every other construction is bare:
//
//   routes/issues.ts        heartbeatService(db)     <- the task-creation path
//   routes/agents.ts        heartbeatService(db)
//   routes/approvals.ts     heartbeatService(db)
//   services/issue-assignee-wakeup.ts   heartbeatService(db).wakeup(...)
//   services/comment-wakeup-outbox.ts   heartbeatService(db).wakeup(...)
//   services/work-question-continuations.ts
//   index.ts (x2)
//
// And `enqueueWakeup` does not merely queue — it EXECUTES on its own instance
// (`dispatchQueuedRunsAfterAgentSignal` -> `startQueuedRunsForSingleAgent` ->
// `claimQueuedRun` -> `void executeRun(...)`). So `executeRun` closes over THAT
// instance's `distributedRolloutHook === undefined`, `distributedRolloutState` stays
// `"off"`, and the canary conjunct fails.
//
// The observable consequence, reproduced on a live single-box fleet before this port
// existed: an HTTP-created task assigned to an eligible `org`/`claude_local` agent, with
// the rollout dial correctly set to `mode:"canary"`, produced
//
//     heartbeat_runs = 1, execution_owner = NULL, and NO `[CLI-006]` log line at all
//
// i.e. byte-for-byte indistinguishable from "the canary evaluated this run and chose
// legacy". A silent, unfalsifiable no-op — the failure class this programme treats as
// worse than a crash.
//
// ★ BE PRECISE ABOUT WHAT THAT PROBE PROVED. The `[CLI-006]` decision block is guarded by
// SEVEN conjuncts, so its silence alone does not isolate any one of them:
//
//   distributedRolloutHook && distributedRolloutState === "canary" && shouldAutoCheckoutForWake
//     && distributedRolloutOrganizationId && issueId && issueContext
//     && issueContext.assigneeAgentId === agent.id
//
// The probe establishes the SYMPTOM; the source establishes the CAUSE. Four of those
// conjuncts were independently satisfied by that probe — `shouldAutoCheckoutForWake` folds
// in issueId/issueContext/assignee and admits `issue_assigned` (it excludes only
// `issue_comment_mentioned` and `execution_*` wakes) — and `distributedRolloutState` and
// `distributedRolloutOrganizationId` are both PRODUCED by the hook, so a missing hook is
// sufficient to force all three of its conjuncts false at once. Combined with the fact that
// the executing instance is demonstrably constructed bare, the hook is the cause. A future
// reader debugging a different silent canary should re-check all seven rather than assume
// this one.
//
// ★ THIS IS THE IDIOM THE REPO ALREADY ARGUED FOR. `distributed-cancellation-port.ts`
// documents the identical hazard for `cancelRun`, names the same bare call sites, and
// says: "Only the scheduler instance receives `distributedRollout`. A port added to
// `heartbeatService`'s options would therefore be `undefined` at every real cancel: the
// code would look wired, typecheck, and never fire." It then solves that for
// cancellation — while the rollout hook it cites as the example stayed injection-only.
// This module closes that gap with the same instance-independent registration.

import type { HeartbeatDistributedRolloutHook } from "./heartbeat-distributed-rollout.js";

let registeredHook: HeartbeatDistributedRolloutHook | undefined;

/**
 * Register (or clear, with `undefined`) the process-wide rollout hook. Called once from
 * the `index.ts` distributed block — deliberately OUTSIDE `if (config.heartbeatSchedulerEnabled)`,
 * because the route-constructed instances that actually execute task runs exist whether or
 * not the scheduler does.
 *
 * Clearing exists so a test — or a config reload — cannot leak one deployment's hook into
 * another, mirroring `setDistributedCancellationPort`.
 */
export function setDistributedRolloutPort(hook: HeartbeatDistributedRolloutHook | undefined): void {
  registeredHook = hook;
}

/**
 * The hook for a `heartbeatService` built without one.
 *
 * ★ Precedence: an EXPLICIT `options.distributedRollout` always wins over this port — the
 * caller that bothered to inject is never overridden, so the scheduler's existing wiring is
 * byte-identical and no test that constructs a deliberately-hookless instance with an
 * explicit `undefined` option changes behaviour... with one caveat worth stating plainly:
 * `heartbeatService(db)` (no options at all) DOES now pick the port up. That is the entire
 * point of the change, and it is why the flag-off default matters — see below.
 *
 * ★ Inert when distributed execution is off: `index.ts` only builds and registers the hook
 * inside the distributed block, so on a flag-off deployment this returns `undefined` and
 * every instance behaves exactly as before.
 */
export function getDistributedRolloutPort(): HeartbeatDistributedRolloutHook | undefined {
  return registeredHook;
}
