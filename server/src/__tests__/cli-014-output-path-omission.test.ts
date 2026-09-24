// CLI-014 — the OMIT-NEVER-INVENT pin (ruling `E7-D13`, disposition (c)).
//
// `E7-D13` descopes `detectedFiles.path` for M1 rather than widening a frozen v1 schema to
// render a filename, and makes the descope honest with one constraint: the founder-facing
// surface must not display a path it cannot substantiate. Absent a durable relative path the
// field is OMITTED — not defaulted, not reconstructed from the object key, not filled with the
// digest. `E7-F046` records why no such path exists anywhere on the control plane.
//
// ★★★ THERE IS NO RED HERE, AND THAT IS THE POINT. The behaviour this file pins is already
// correct at HEAD (`foldAttemptEvidence` returns `detectedFiles: []`). A test written against
// correct code passes for free, so on its own it proves NOTHING — the `CLI-013` vacuity trap.
// The proof is entirely in the MUTATIONS recorded in `tickets/CLI-014-design.md`: each arm
// below is shown to go RED when the invention it forbids is introduced. Read the mutation
// table, not the green tick.
//
// ★ NO TENANT DATA. Every assertion here is over a pure fold or a frozen schema; nothing reads
// or writes a row, so founder ruling F10's cross-tenant obligation is not engaged. The
// tenant-scoped half of this surface is `JOB-017`'s `applyAcceptedOutputEvent`, whose
// cross-tenant arms live in `job-accepted-event-seam.integration.test.ts`.

import { describe, expect, it } from "vitest";
import { artifactPreparedPayloadV1Schema } from "@armyofagents/worker-protocol";
import {
  foldAttemptEvidence,
  type AttemptEventRow,
} from "../services/canary-terminal-projection.js";
import { formatRunSummary } from "../services/run-summary.js";

const JOB = "10b10b10-10b1-4b10-8b10-10b10b10b10b";
const ATTEMPT = "a77e3907-a77e-4a77-8a77-a77ea77ea77e";
const ARTIFACT_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ARTIFACT_B = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const START = new Date("2026-09-24T10:00:00.000Z");
const NOW = new Date("2026-09-24T10:00:30.000Z");

/** A stored `artifact_prepared` row, carrying exactly what the frozen wire allows. */
function artifactPreparedRow(sequence: number, artifactId: string): AttemptEventRow {
  return {
    eventId: `evt-${sequence}`,
    sequence,
    eventType: "artifact_prepared",
    event: { eventType: "artifact_prepared", payload: { artifactId, kind: "workspace_patch" } },
    occurredAt: new Date(START.getTime() + sequence * 1000),
  };
}

function terminalRow(sequence: number): AttemptEventRow {
  return {
    eventId: `evt-${sequence}`,
    sequence,
    eventType: "terminal",
    event: { eventType: "terminal", payload: { status: "succeeded" } },
    occurredAt: new Date(START.getTime() + sequence * 1000),
  };
}

describe("CLI-014 / E7-D13 (c) — an unsubstantiated path is OMITTED, never invented", () => {
  it("folds two artifact_prepared events and still reports NO detected files", () => {
    const evidence = foldAttemptEvidence({
      jobId: JOB,
      attemptId: ATTEMPT,
      terminalStatus: "succeeded",
      rows: [artifactPreparedRow(1, ARTIFACT_A), artifactPreparedRow(2, ARTIFACT_B), terminalRow(3)],
      runStartedAt: START,
      now: NOW,
    });

    // ANTI-VACUITY FIRST. An assertion that `detectedFiles` is empty passes just as well when
    // the fold silently dropped the artifact events, or was never handed any — which would make
    // the real assertion below vacuous. Prove the events reached the fold before reading the
    // field they are supposed not to populate.
    const announced = evidence.events.filter((e) => e.type === "artifact_prepared");
    expect(announced).toHaveLength(2);
    expect(announced.map((e) => (e.payload as { artifactId: string }).artifactId))
      .toEqual([ARTIFACT_A, ARTIFACT_B]);

    // THE PIN. Two artifacts were announced and committed; neither yields a file entry,
    // because no relative path is durable anywhere (`E7-F046`).
    expect(evidence.detectedFiles).toEqual([]);
  });

  it("invents nothing from the artifact identity — no folded value appears in a path position", () => {
    const evidence = foldAttemptEvidence({
      jobId: JOB,
      attemptId: ATTEMPT,
      terminalStatus: "succeeded",
      rows: [artifactPreparedRow(1, ARTIFACT_A), terminalRow(2)],
      runStartedAt: START,
      now: NOW,
    });

    // The specific inventions `E7-D13` (c) forbids: the artifact id, the job/attempt identity,
    // and any object-key-shaped reconstruction built from them. None may surface as a path.
    const paths = evidence.detectedFiles.map((f) => f.path);
    expect(paths).not.toContain(ARTIFACT_A);
    for (const forbidden of [ARTIFACT_A, JOB, ATTEMPT]) {
      expect(paths.some((p) => p.includes(forbidden))).toBe(false);
    }
    expect(evidence.detectedFiles).toHaveLength(0);
  });

  it("renders no Files line to the founder when there is nothing to substantiate", () => {
    const summary = formatRunSummary({
      agentName: "Builder",
      outcome: "completed",
      durationMs: 30_000,
      inputTokens: 10,
      outputTokens: 20,
      costUsd: null,
      errorMessage: null,
      detectedFiles: [],
    });
    expect(summary).not.toContain("Files:");

    // POSITIVE CONTROL for this arm: the assertion above is only meaningful if the renderer
    // WOULD have shown a path had one existed. A summary that never emits `Files:` would pass
    // the assertion while proving nothing about omission.
    const withFiles = formatRunSummary({
      agentName: "Builder",
      outcome: "completed",
      durationMs: 30_000,
      inputTokens: 10,
      outputTokens: 20,
      costUsd: null,
      errorMessage: null,
      detectedFiles: [{ path: "src/main.ts" }],
    });
    expect(withFiles).toContain("Files:");
    expect(withFiles).toContain("src/main.ts");
  });

  it("the omission is STRUCTURAL: the frozen payload refuses a path, so a silent widening reds here", () => {
    // `E7-D13` (b) rules that widening this schema is a protocol decision with its own
    // compatibility analysis, never a side effect of adding a display field. This arm is what
    // makes that ruling enforceable rather than advisory.
    expect(artifactPreparedPayloadV1Schema.safeParse({ artifactId: ARTIFACT_A, kind: "workspace_patch" }).success)
      .toBe(true);
    for (const key of ["path", "relativePath", "filename", "objectKey"]) {
      expect(
        artifactPreparedPayloadV1Schema.safeParse({
          artifactId: ARTIFACT_A,
          kind: "workspace_patch",
          [key]: "aoa-output/report.md",
        }).success,
        `frozen artifact_prepared payload must refuse a '${key}' field`,
      ).toBe(false);
    }
  });
});
