// CLI-006 (Task 3) — the suppression seam.
//
// This is the switch. Everything else in CLI-006 landed inert; this is the edit
// that makes a canary run's `adapter.execute` NOT happen, so it is the one place
// a double-execution defect can exist.
//
// `executeRun` is ~2,700 lines with a dependency surface that is impractical to
// unit-test — the standing CLI-003/005 limitation, recorded as Risk #2 in the
// design. So this file proves what CAN be proven in-process, at two levels:
//
//   1. The DECISION and the WRITE are pure functions, tested and mutation-checked.
//   2. The RETURN'S POSITION is asserted structurally against the source.
//
// (2) is not decoration. The `return` must sit INSIDE the inner `try`, because
// that try's `finally` is the only call site of `deregisterRuntimeHook` and of
// `heartbeatMcpDelivery.cleanup()`. Returning one line earlier — before `try {` —
// typechecks, passes every behavioural test, and silently leaks a 24-hour-valid
// runtime-permission token plus a tmpdir MCP config file that, for non-brokered
// `claude_local`, embeds DATABASE_URL. No TTL, no sweeper. A structural assertion
// is the only thing in this repo that catches that.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildHandoffRunPatch,
  shouldSuppressLegacyExecution,
  type RunExecutionOwner,
} from "../services/run-execution-owner.js";

const JOB = "10b10b10-10b1-4b10-8b10-10b10b10b10b";
const ATTEMPT = "a77e3907-a77e-4a77-8a77-a77ea77ea77e";
const NOW = new Date("2026-08-19T10:00:00.000Z");

const distributed: RunExecutionOwner = { owner: "distributed", jobId: JOB, attemptId: ATTEMPT };

describe("CLI-006/Task 3 — shouldSuppressLegacyExecution", () => {
  it("suppresses ONLY on a distributed owner", () => {
    expect(shouldSuppressLegacyExecution(distributed)).toBe(true);
  });

  it("does NOT suppress for any legacy reason — the fail-safe direction (Invariant 2)", () => {
    // Every short-circuit in the resolver produces one of these. None may suppress:
    // "neither executes" is a silently dropped run, which is worse than a fallback.
    for (const reason of [
      "rollout_not_canary",
      "preflight_refused",
      "convert_failed",
      "placement_not_leasable",
      "transfer_error",
    ] as const) {
      expect(shouldSuppressLegacyExecution({ owner: "legacy", reason }), reason).toBe(false);
    }
  });

  it("does NOT suppress when no decision was made at all", () => {
    // The overwhelmingly common case: a non-canary run never calls the resolver,
    // so the seam sees `undefined`. Absence must read as legacy — that is what
    // makes a partial deployment safe (D4).
    expect(shouldSuppressLegacyExecution(undefined)).toBe(false);
    expect(shouldSuppressLegacyExecution(null)).toBe(false);
  });
});

describe("CLI-006/Task 3 — buildHandoffRunPatch", () => {
  it("marks the run handed off with BOTH ids and the owner", () => {
    expect(buildHandoffRunPatch(distributed, NOW)).toEqual({
      executionOwner: "distributed",
      distributedJobId: JOB,
      distributedAttemptId: ATTEMPT,
      updatedAt: NOW,
    });
  });

  it("does NOT touch `status` — the attempt is the terminal authority now", () => {
    // Writing a terminal here would latch the run before the worker has even
    // leased it, and the projector's later terminal would be discarded.
    expect(Object.keys(buildHandoffRunPatch(distributed, NOW)).sort()).toEqual([
      "distributedAttemptId",
      "distributedJobId",
      "executionOwner",
      "updatedAt",
    ]);
  });

  it("refuses to build a handoff patch from a legacy decision", () => {
    // The marker is what every consumer — reaper, cancel writers, projector —
    // reads to learn the attempt owns this run. Writing it for a run the legacy
    // adapter is about to execute would strand that run permanently: the reaper
    // stands down, cancel routes to a job that will never terminalize, and
    // nothing ever finalizes it.
    expect(() =>
      buildHandoffRunPatch({ owner: "legacy", reason: "convert_failed" }, NOW),
    ).toThrow(/legacy/i);
  });
});

// -- the structural guard -----------------------------------------------------

const HEARTBEAT_SRC = readFileSync(
  fileURLToPath(new URL("../services/heartbeat.ts", import.meta.url)),
  "utf8",
).split(/\r?\n/);

const lineOf = (needle: string): number => {
  const idx = HEARTBEAT_SRC.findIndex((line) => line.includes(needle));
  expect(idx, `expected to find ${needle} in heartbeat.ts`).toBeGreaterThan(-1);
  return idx;
};

describe("CLI-006/Task 3 — the suppression return sits inside the adapter try", () => {
  it("returns AFTER `try {` and BEFORE `adapter.execute`", () => {
    const guard = lineOf("CLI-006-SUPPRESSION-RETURN");
    const exec = lineOf("adapterResult = await adapter.execute({");

    // The `try {` that owns the adapter call is the last one before it.
    const tryLine = HEARTBEAT_SRC.slice(0, exec)
      .map((line, i) => ({ line: line.trim(), i }))
      .filter(({ line }) => line === "try {")
      .at(-1);
    expect(tryLine, "expected a `try {` before adapter.execute").toBeDefined();

    expect(tryLine!.i).toBeLessThan(guard);
    expect(guard).toBeLessThan(exec);
  });

  it("keeps both cleanups in the finally that the suppression return still runs", () => {
    // If either of these ever moves out of that finally, the structural proof
    // above stops meaning anything — so assert their position too.
    const guard = lineOf("CLI-006-SUPPRESSION-RETURN");
    const deregister = lineOf("deregisterRuntimeHook(runtimeHookToken);");
    const cleanup = lineOf("await heartbeatMcpDelivery.cleanup();");

    const finallyLine = HEARTBEAT_SRC.slice(guard, deregister)
      .map((line, i) => ({ line: line.trim(), i: i + guard }))
      .filter(({ line }) => line.startsWith("} finally {"))
      .at(-1);
    expect(finallyLine, "expected a `} finally {` between the guard and the cleanups").toBeDefined();

    expect(guard).toBeLessThan(finallyLine!.i);
    expect(finallyLine!.i).toBeLessThan(deregister);
    expect(deregister).toBeLessThan(cleanup);
  });

  it("has exactly ONE suppression return — the decision is acted on once", () => {
    const hits = HEARTBEAT_SRC.filter((line) => line.includes("CLI-006-SUPPRESSION-RETURN"));
    expect(hits).toHaveLength(1);
  });
});
