// CLI-006 (D5) — the run-experience projector.
//
// A canary-owned run produces its evidence on the DISTRIBUTED side (JOB-005 durable
// events + MIG-003 realtime catch-up). The projector surfaces that evidence in the
// EXISTING run experience — `heartbeat_run_events`, the run's terminal status, and
// the shared run-summary comment writer — so a founder sees the same thing they see
// for a legacy run.
//
// Invariant 8: this is a READ/PROJECT path. It never invents run state. It maps the
// attempt's durable terminal onto the run and nothing more; `setRunStatus` keeps its
// own terminal latch, so the projector cannot resurrect a run a cancel already
// finished.
//
// Best-effort per substep, exactly like the crew loopback (`postCrewRunSuccess`):
// one failing substep must not cost the others, and the projector must never throw
// into its caller.

import { describe, expect, it, vi } from "vitest";
import {
  createCanaryRunProjector,
  type CanaryAttemptEvidence,
  type CanaryRunProjectorDeps,
} from "../services/canary-run-projector.js";

const RUN = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const COMPANY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ISSUE = "88888888-8888-4888-8888-888888888888";

function evidence(overrides: Partial<CanaryAttemptEvidence> = {}): CanaryAttemptEvidence {
  return {
    jobId: "10b10b10-10b1-4b10-8b10-10b10b10b10b",
    attemptId: "a77e3907-a77e-4a77-8a77-a77ea77ea77e",
    events: [
      { eventId: "e1", seq: 1, type: "log", stream: "stdout", message: "building" },
      { eventId: "e2", seq: 2, type: "progress", message: "50%" },
    ],
    terminal: { outcome: "succeeded", errorCode: null, errorMessage: null },
    usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.01, durationMs: 1234 },
    detectedFiles: [],
    ...overrides,
  };
}

function deps(overrides: Partial<CanaryRunProjectorDeps> = {}): CanaryRunProjectorDeps {
  return {
    appendRunEvent: vi.fn(async () => {}),
    setRunStatus: vi.fn(async () => {}),
    postRunSummary: vi.fn(async () => ({ posted: true })),
    ...overrides,
  };
}

const target = {
  runId: RUN,
  companyId: COMPANY,
  issueId: ISSUE,
  agentName: "Coder",
  runtimeConfig: {} as Record<string, unknown>,
};

describe("CLI-006 D5 — canary run projector", () => {
  it("projects durable events into the run experience in seq order", async () => {
    const d = deps();
    await createCanaryRunProjector(d).projectTerminal({ target, evidence: evidence() });
    const calls = (d.appendRunEvent as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[0].seq)).toEqual([1, 2]);
    expect(calls[0][0].message).toBe("building");
  });

  it("projects events in seq order even when the source arrives out of order", async () => {
    const d = deps();
    await createCanaryRunProjector(d).projectTerminal({
      target,
      evidence: evidence({
        events: [
          { eventId: "e2", seq: 2, type: "progress", message: "50%" },
          { eventId: "e1", seq: 1, type: "log", stream: "stdout", message: "building" },
        ],
      }),
    });
    const calls = (d.appendRunEvent as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[0].seq)).toEqual([1, 2]);
  });

  it("suppresses duplicate eventIds (JOB-005 fan-out may redeliver)", async () => {
    const d = deps();
    await createCanaryRunProjector(d).projectTerminal({
      target,
      evidence: evidence({
        events: [
          { eventId: "e1", seq: 1, type: "log", message: "once" },
          { eventId: "e1", seq: 1, type: "log", message: "once" },
          { eventId: "e2", seq: 2, type: "log", message: "twice" },
        ],
      }),
    });
    expect((d.appendRunEvent as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it.each([
    ["succeeded", "completed"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["timed_out", "failed"],
  ] as const)("maps attempt terminal `%s` onto run status `%s`", async (outcome, status) => {
    const d = deps();
    await createCanaryRunProjector(d).projectTerminal({
      target,
      evidence: evidence({ terminal: { outcome, errorCode: null, errorMessage: null } }),
    });
    expect(d.setRunStatus).toHaveBeenCalledWith(RUN, status, expect.anything());
  });

  it("carries the attempt's usage onto the run and the summary comment", async () => {
    const d = deps();
    await createCanaryRunProjector(d).projectTerminal({ target, evidence: evidence() });
    expect(d.postRunSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY,
        issueId: ISSUE,
        outcome: "succeeded",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
        durationMs: 1234,
      }),
    );
  });

  it("passes the terminal error through to the run and the summary", async () => {
    const d = deps();
    await createCanaryRunProjector(d).projectTerminal({
      target,
      evidence: evidence({
        terminal: { outcome: "failed", errorCode: "execute_timeout", errorMessage: "boom" },
      }),
    });
    expect(d.postRunSummary).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", errorMessage: "boom" }),
    );
  });

  // Best-effort, per substep — the crew-loopback contract.
  it("still sets the run terminal when event projection throws", async () => {
    const d = deps({
      appendRunEvent: vi.fn(async () => {
        throw new Error("events down");
      }),
    });
    await createCanaryRunProjector(d).projectTerminal({ target, evidence: evidence() });
    expect(d.setRunStatus).toHaveBeenCalled();
  });

  it("still posts the summary when the terminal write throws", async () => {
    const d = deps({
      setRunStatus: vi.fn(async () => {
        throw new Error("status down");
      }),
    });
    await createCanaryRunProjector(d).projectTerminal({ target, evidence: evidence() });
    expect(d.postRunSummary).toHaveBeenCalled();
  });

  it("never throws, even when every substep fails", async () => {
    const d = deps({
      appendRunEvent: vi.fn(async () => {
        throw new Error("a");
      }),
      setRunStatus: vi.fn(async () => {
        throw new Error("b");
      }),
      postRunSummary: vi.fn(async () => {
        throw new Error("c");
      }),
    });
    await expect(
      createCanaryRunProjector(d).projectTerminal({ target, evidence: evidence() }),
    ).resolves.toBeUndefined();
  });

  // Invariant 8 — a projection is not an authority. It hands the terminal to
  // `setRunStatus`, whose own latch refuses to resurrect an already-terminal run;
  // the projector must not work around that with a second write path.
  it("routes the terminal ONLY through setRunStatus (no second write path)", async () => {
    const d = deps();
    await createCanaryRunProjector(d).projectTerminal({ target, evidence: evidence() });
    expect(d.setRunStatus).toHaveBeenCalledTimes(1);
  });

  it("skips the summary comment when there is no issue (nothing to comment on)", async () => {
    const d = deps();
    await createCanaryRunProjector(d).projectTerminal({
      target: { ...target, issueId: null },
      evidence: evidence(),
    });
    expect(d.postRunSummary).not.toHaveBeenCalled();
    // The run still reaches its terminal — the run experience is not issue-gated.
    expect(d.setRunStatus).toHaveBeenCalled();
  });
});
