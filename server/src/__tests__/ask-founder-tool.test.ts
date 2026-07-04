import { describe, expect, it, vi, beforeEach } from "vitest";

// Real cancelled-error class (the tool catches it by instanceof). Defined inside
// vi.hoisted so it exists when the hoisted vi.mock factory references it (a plain
// top-level class would be in its temporal dead zone at hoist time).
const { createPrompt, waitForAnswer, markRelayed, FakeCancelledError } = vi.hoisted(() => {
  class FakeCancelledError extends Error {
    readonly decision: unknown;
    constructor() {
      super("cancelled");
      this.name = "RuntimeDecisionCancelledError";
      this.decision = {};
    }
  }
  return {
    createPrompt: vi.fn(),
    waitForAnswer: vi.fn(),
    markRelayed: vi.fn(),
    FakeCancelledError,
  };
});

vi.mock("../services/agent-runtime-decisions.js", () => ({
  agentRuntimeDecisionService: () => ({ createPrompt, waitForAnswer, markRelayed }),
  RuntimeDecisionCancelledError: FakeCancelledError,
}));

import { handleAskFounder } from "../mcp/tools/ask-founder-tool.js";

function makeCtx(actor: Record<string, unknown>, getById = vi.fn()) {
  return {
    db: {} as any,
    companyId: "co-1",
    actor: { userId: "agent-1", companyId: "co-1", keyId: null, ...actor },
    scope: { kind: "founder", userId: "agent-1" },
    services: { agentsSvc: { getById } },
    actorInfo: {},
    resolveRole: vi.fn(),
    resolveScopedAgentIds: vi.fn(),
  } as any;
}

beforeEach(() => {
  createPrompt.mockReset();
  waitForAnswer.mockReset();
  markRelayed.mockReset();
});

describe("ask_founder tool", () => {
  it("403s when the caller is not an agent actor", async () => {
    const res = await handleAskFounder(
      makeCtx({ source: "board", agentId: null, runId: null }),
      { question: "Ship it?" },
    );
    expect(res.ok).toBe(false);
    expect((res as any).status).toBe(403);
  });

  it("403s when the agent has no active run", async () => {
    const res = await handleAskFounder(
      makeCtx({ source: "agent", agentId: "agent-1", runId: null }),
      { question: "Ship it?" },
    );
    expect(res.ok).toBe(false);
    expect((res as any).status).toBe(403);
  });

  it("creates a work_question prompt (park_run + options) and returns the answer", async () => {
    const getById = vi.fn().mockResolvedValue({ adapterType: "codex_local" });
    createPrompt.mockResolvedValue({ decision: { id: "d1" } });
    waitForAnswer.mockResolvedValue({ answerPayload: { value: "yes" } });
    markRelayed.mockResolvedValue({ id: "d1", status: "relayed" });

    const res = await handleAskFounder(
      makeCtx({ source: "agent", agentId: "agent-1", runId: "run-1" }, getById),
      {
        question: "Ship the release?",
        options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" },
        ],
      },
    );

    expect(createPrompt).toHaveBeenCalledTimes(1);
    const arg = createPrompt.mock.calls[0][0];
    expect(arg.kind).toBe("work_question");
    expect(arg.timeoutPolicy).toBe("park_run");
    expect(arg.agentId).toBe("agent-1");
    expect(arg.runId).toBe("run-1");
    expect(arg.adapterType).toBe("codex_local");
    expect(arg.options).toEqual([
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ]);
    expect(res.ok).toBe(true);
    expect((res as any).data).toEqual({ answered: true, answer: { value: "yes" } });
  });

  it("coerces empty/whitespace context to a null summary (schema-honesty)", async () => {
    const getById = vi.fn().mockResolvedValue({ adapterType: "codex_local" });
    createPrompt.mockResolvedValue({ decision: { id: "d1" } });
    waitForAnswer.mockResolvedValue({ answerPayload: { text: "ok" } });
    markRelayed.mockResolvedValue({ id: "d1", status: "relayed" });

    await handleAskFounder(
      makeCtx({ source: "agent", agentId: "agent-1", runId: "run-1" }, getById),
      { question: "Ship it?", context: "   " },
    );

    // Empty/whitespace context must not persist as an empty-string summary
    // (runtimeDecisionDetailSchema.summary is .min(1)).
    expect(createPrompt.mock.calls[0][0].summary).toBeNull();
  });

  it("passes option description + rationale through to createPrompt", async () => {
    const getById = vi.fn().mockResolvedValue({ adapterType: "codex_local" });
    createPrompt.mockResolvedValue({ decision: { id: "d1" } });
    waitForAnswer.mockResolvedValue({ answerPayload: { value: "saas" } });
    markRelayed.mockResolvedValue({ id: "d1", status: "relayed" });

    await handleAskFounder(
      makeCtx({ source: "agent", agentId: "agent-1", runId: "run-1" }, getById),
      {
        question: "Which segment?",
        options: [
          { label: "SaaS", value: "saas", description: "Founder-led.", rationale: "High WTP." },
          { label: "Agencies", value: "agencies" },
        ],
      },
    );

    expect(createPrompt.mock.calls[0][0].options).toEqual([
      { label: "SaaS", value: "saas", description: "Founder-led.", rationale: "High WTP." },
      { label: "Agencies", value: "agencies" },
    ]);
  });

  it("returns a graceful parked result (NOT isError) when the wait is cancelled", async () => {
    const getById = vi.fn().mockResolvedValue({ adapterType: "codex_local" });
    createPrompt.mockResolvedValue({ decision: { id: "d1" } });
    waitForAnswer.mockRejectedValue(new FakeCancelledError());

    const res = await handleAskFounder(
      makeCtx({ source: "agent", agentId: "agent-1", runId: "run-1" }, getById),
      { question: "Ship it?" },
    );

    expect(res.ok).toBe(true);
    expect((res as any).data).toEqual({
      answered: false,
      status: "parked",
      note: "parked for founder",
    });
  });

  it("returns a graceful parked result when the block times out", async () => {
    const getById = vi.fn().mockResolvedValue({ adapterType: "codex_local" });
    createPrompt.mockResolvedValue({ decision: { id: "d1" } });
    waitForAnswer.mockRejectedValue(new Error("Timed out waiting for runtime decision answer"));

    const res = await handleAskFounder(
      makeCtx({ source: "agent", agentId: "agent-1", runId: "run-1" }, getById),
      { question: "Ship it?" },
    );

    expect(res.ok).toBe(true);
    expect((res as any).data.status).toBe("parked");
  });

  it("returns parked when the decision is no longer actionable (terminal race)", async () => {
    // waitForAnswer throws conflict("Runtime decision prompt is no longer
    // actionable") if the row hit a terminal non-answered status (relayed/expired)
    // while we polled. That is a benign "no answer" outcome under park_run — the
    // model must STOP, not surface a hard error.
    const getById = vi.fn().mockResolvedValue({ adapterType: "codex_local" });
    createPrompt.mockResolvedValue({ decision: { id: "d1" } });
    waitForAnswer.mockRejectedValue(
      new Error("Runtime decision prompt is no longer actionable"),
    );

    const res = await handleAskFounder(
      makeCtx({ source: "agent", agentId: "agent-1", runId: "run-1" }, getById),
      { question: "Ship it?" },
    );

    expect(res.ok).toBe(true);
    expect((res as any).data.status).toBe("parked");
  });

  it("propagates a terminal-run 409 from createPrompt (zombie guard)", async () => {
    const getById = vi.fn().mockResolvedValue({ adapterType: "codex_local" });
    const conflictErr = Object.assign(new Error("run is terminal"), { status: 409 });
    createPrompt.mockRejectedValue(conflictErr);

    await expect(
      handleAskFounder(
        makeCtx({ source: "agent", agentId: "agent-1", runId: "run-1" }, getById),
        { question: "Ship it?" },
      ),
    ).rejects.toThrow("run is terminal");
  });

  it("rejects options with duplicate values (uniqueness guard)", async () => {
    const getById = vi.fn().mockResolvedValue({ adapterType: "codex_local" });
    await expect(
      handleAskFounder(
        makeCtx({ source: "agent", agentId: "agent-1", runId: "run-1" }, getById),
        {
          question: "Pick one?",
          options: [
            { label: "A", value: "x" },
            { label: "B", value: "x" },
          ],
        },
      ),
    ).rejects.toThrow(/unique/i);
    expect(createPrompt).not.toHaveBeenCalled();
  });
});
