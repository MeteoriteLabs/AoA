// W3a Task 2 — crew SUCCESS loopback + run-summary wiring.
//
// Two units under test, both from crew-run-outcome.ts:
//   1. resolveCrewRunSummaryArgs — the PURE mapper (runner locals →
//      PostRunSummaryCommentInput). Pins costCents→USD, null handling, the
//      empty detectedFiles, and outcome/errorMessage carry-through.
//   2. postCrewRunSuccess — the COMPOSED success sequence (relay THEN summary),
//      each sub-step in its OWN try/catch so a relay failure still lets the
//      summary post (and vice-versa). Driven with injected deps so the
//      composition is testable without a live DB / heavy mocking.

import { describe, expect, it, vi } from "vitest";
import {
  postCrewRunSuccess,
  resolveCrewRunSummaryArgs,
} from "../services/internal-agent/aoa-agents/crew-run-outcome.js";

describe("resolveCrewRunSummaryArgs (crew run → run-summary input)", () => {
  it("maps runner locals to the shared helper's input (costCents → costUsd)", () => {
    const args = resolveCrewRunSummaryArgs({
      companyId: "co-1",
      issueId: "task-1",
      agentName: "Engineer",
      runtimeConfig: { autoRunSummary: true },
      outcome: "succeeded",
      startedAtMs: 1_000,
      nowMs: 136_000,
      adapterUsage: { inputTokens: 100, outputTokens: 200 },
      costCents: 12,
      errorMessage: null,
      runId: "run-1",
    });
    expect(args).toEqual({
      companyId: "co-1",
      issueId: "task-1",
      agentName: "Engineer",
      runtimeConfig: { autoRunSummary: true },
      outcome: "succeeded",
      runId: "run-1",
      durationMs: 135_000,
      inputTokens: 100,
      outputTokens: 200,
      costUsd: 0.12,
      errorMessage: null,
      detectedFiles: [],
    });
  });

  it("null costCents → null costUsd; missing usage → null tokens; detectedFiles=[]", () => {
    const args = resolveCrewRunSummaryArgs({
      companyId: "co-1",
      issueId: "task-1",
      agentName: "E",
      runtimeConfig: {},
      outcome: "succeeded",
      startedAtMs: 0,
      nowMs: 1_000,
      adapterUsage: undefined,
      costCents: null,
      errorMessage: null,
    });
    expect(args.costUsd).toBeNull();
    expect(args.inputTokens).toBeNull();
    expect(args.outputTokens).toBeNull();
    expect(args.detectedFiles).toEqual([]);
  });

  it("carries outcome + errorMessage + runId through unchanged", () => {
    const args = resolveCrewRunSummaryArgs({
      companyId: "co-1",
      issueId: "task-1",
      agentName: "E",
      runtimeConfig: {},
      outcome: "failed",
      startedAtMs: 0,
      nowMs: 2_000,
      adapterUsage: undefined,
      costCents: null,
      errorMessage: "kaboom",
      runId: "run-9",
    });
    expect(args.outcome).toBe("failed");
    expect(args.errorMessage).toBe("kaboom");
    expect(args.runId).toBe("run-9");
    expect(args.durationMs).toBe(2_000);
  });
});

const successInput = {
  companyId: "co-1",
  issueId: "task-1",
  agentName: "Engineer",
  runtimeConfig: { autoRunSummary: true } as Record<string, unknown>,
  startedAtMs: 1_000,
  nowMs: 136_000,
  adapterUsage: { inputTokens: 100, outputTokens: 200 },
  costCents: 12,
  runId: "run-1",
};

describe("postCrewRunSuccess (composed success side-effect)", () => {
  const db = {} as never;

  it("happy path: relays AND summarizes, returns both true", async () => {
    const relay = vi.fn(async () => ({ posted: true }));
    const summarize = vi.fn(async () => ({ posted: true }));

    const result = await postCrewRunSuccess(db, successInput, { relay, summarize });

    expect(result).toEqual({ relayed: true, summarized: true });
    expect(relay).toHaveBeenCalledTimes(1);
    expect(relay).toHaveBeenCalledWith(db, { issueId: "task-1" });
    expect(summarize).toHaveBeenCalledTimes(1);
    // The summary receives the mapped args with outcome:"succeeded", errorMessage:null.
    const summaryArgs = summarize.mock.calls[0][1];
    expect(summaryArgs).toMatchObject({
      companyId: "co-1",
      issueId: "task-1",
      agentName: "Engineer",
      outcome: "succeeded",
      errorMessage: null,
      costUsd: 0.12,
      detectedFiles: [],
    });
  });

  it("relay THROW is isolated — the summary still posts (relayed:false, summarized:true)", async () => {
    const relay = vi.fn(async () => {
      throw new Error("relay down");
    });
    const summarize = vi.fn(async () => ({ posted: true }));

    const result = await postCrewRunSuccess(db, successInput, { relay, summarize });

    expect(result).toEqual({ relayed: false, summarized: true });
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("relay {posted:false} → relayed:false but summary still runs", async () => {
    const relay = vi.fn(async () => ({ posted: false }));
    const summarize = vi.fn(async () => ({ posted: true }));

    const result = await postCrewRunSuccess(db, successInput, { relay, summarize });

    expect(result).toEqual({ relayed: false, summarized: true });
  });

  it("summary THROW is isolated — the relay still counts (relayed:true, summarized:false)", async () => {
    const relay = vi.fn(async () => ({ posted: true }));
    const summarize = vi.fn(async () => {
      throw new Error("summary down");
    });

    const result = await postCrewRunSuccess(db, successInput, { relay, summarize });

    expect(result).toEqual({ relayed: true, summarized: false });
    expect(relay).toHaveBeenCalledTimes(1);
  });
});
