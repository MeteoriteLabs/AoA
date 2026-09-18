// server/src/__tests__/crew-seam-suppression.test.ts — MIG-006 slice 1.
//
// The crew distributed-execution seam in runAoaAgent: the durable handoff marker (PURE) and the
// STRUCTURAL shape of the suppression seam — the one place a double-execution defect could live.
// The full behavioral proof (flag-on suppresses adapter.execute; flag-off/port-absent still run
// it) lands as a fast-follow (slice 1b) BEFORE the off-by-default crew flag is ever armed, so the
// runtime-proof gap is never a production risk.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildCrewHandoffMarkerPatch } from "../services/internal-agent/aoa-agents/crew-handoff-marker.js";

describe("buildCrewHandoffMarkerPatch — MIG-006 durable crew handoff marker", () => {
  const distributed = { owner: "distributed", jobId: "job-1", attemptId: "att-1" } as const;

  it("emits exactly the three marker columns internal_agent_runs has — NO updatedAt", () => {
    // heartbeat_runs' buildHandoffRunPatch also emits updatedAt; internal_agent_runs has no such
    // column, so a naive reuse would throw at runtime on an unknown column.
    expect(buildCrewHandoffMarkerPatch(distributed, new Date())).toEqual({
      executionOwner: "distributed",
      distributedJobId: "job-1",
      distributedAttemptId: "att-1",
    });
  });

  it("THROWS on a legacy owner (a marker for a legacy run would strand it — reaper stands down)", () => {
    expect(() =>
      buildCrewHandoffMarkerPatch({ owner: "legacy", reason: "rollout_not_canary" }, new Date()),
    ).toThrow();
  });

  it("never latches status (the attempt is the terminal authority from handoff on)", () => {
    expect(buildCrewHandoffMarkerPatch(distributed, new Date())).not.toHaveProperty("status");
  });
});

const RUNNER = readFileSync(
  path.join(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "services",
    "internal-agent",
    "aoa-agents",
    "runner.ts",
  ),
  "utf8",
);

describe("runAoaAgent crew distributed seam — structural (MIG-006 slice 1)", () => {
  it("reads the rollout hook lazily via the process-wide port (never captured at module scope)", () => {
    expect(RUNNER).toContain("getDistributedRolloutPort()");
  });

  it("builds the crew batch workload and gates it through the crew-flag-first gate", () => {
    expect(RUNNER).toContain("buildTaskRunBatchWorkload(");
    expect(RUNNER).toContain("resolveCrewDistributedGate(");
  });

  it("resolves the single ownership decision with a crew_run source", () => {
    expect(RUNNER).toMatch(/resolveExecutionOwner\(/);
    expect(RUNNER).toMatch(/kind:\s*"crew_run"/);
  });

  it("suppresses the legacy adapter with exactly ONE CREW-SUPPRESSION-RETURN, before adapter.execute", () => {
    const occurrences = RUNNER.split("CREW-SUPPRESSION-RETURN").length - 1;
    expect(occurrences).toBe(1);
    expect(RUNNER).toContain("shouldSuppressLegacyExecution(");
    // The suppression return must sit before the legacy executor, or it suppresses nothing.
    expect(RUNNER.indexOf("CREW-SUPPRESSION-RETURN")).toBeGreaterThan(0);
    expect(RUNNER.indexOf("CREW-SUPPRESSION-RETURN")).toBeLessThan(RUNNER.indexOf("adapter.execute("));
  });

  it("writes the durable marker via buildCrewHandoffMarkerPatch on suppression", () => {
    expect(RUNNER).toContain("buildCrewHandoffMarkerPatch(");
  });
});
