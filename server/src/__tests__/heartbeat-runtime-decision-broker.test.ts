import { describe, expect, it, vi } from "vitest";
import { RuntimeDecisionCancelledError } from "../services/agent-runtime-decisions.js";
import { createHeartbeatRuntimeDecisionBroker } from "../services/heartbeat.js";

const run = {
  id: "33333333-3333-3333-3333-333333333333",
  companyId: "11111111-1111-1111-1111-111111111111",
  agentId: "22222222-2222-2222-2222-222222222222",
};

const agent = {
  id: run.agentId,
  companyId: run.companyId,
  name: "Builder",
  adapterType: "codex_local",
  adapterConfig: {},
};

const runtime = {
  sessionId: "legacy-session",
  sessionDisplayId: "display-session",
  sessionParams: { session: "display-session" },
  taskKey: "issue:1",
};

function decisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    companyId: run.companyId,
    agentId: run.agentId,
    runId: run.id,
    adapterType: "codex_local",
    adapterSessionId: "display-session",
    adapterSessionParams: { session: "display-session" },
    kind: "permission",
    status: "created",
    nonce: "nonce-1",
    sourceRevision: 0,
    promptHash: "hash",
    sourceUniqueKey: "runtime:key",
    title: "Allow command?",
    summary: "Needs shell",
    promptText: "Run pnpm test?",
    toolName: "shell",
    command: "pnpm test",
    cwd: null,
    path: null,
    networkTarget: null,
    riskClass: "medium",
    options: null,
    expiresAt: null,
    timeoutPolicy: "deny",
    decision: null,
    answerPayload: null,
    answeredByUserId: null,
    answeredAt: null,
    relayedAt: null,
    relayError: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("heartbeat runtime decision broker", () => {
  it("creates a permission prompt, marks the run waiting, relays the answer, and clears waiting state", async () => {
    const created = decisionRow();
    const answered = decisionRow({ status: "answered", sourceRevision: 1, decision: "allow_once" });
    const relayed = decisionRow({ status: "relayed", sourceRevision: 2, decision: "allow_once" });
    const runtimeDecisions = {
      createPrompt: vi.fn().mockResolvedValue({ decision: created, hubItem: { id: "hub-1" } }),
      waitForAnswer: vi.fn().mockResolvedValue(answered),
      markRelayed: vi.fn().mockResolvedValue(relayed),
      markRelayFailed: vi.fn(),
    };
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const markRunWaiting = vi.fn().mockResolvedValue(undefined);
    const clearRunWaiting = vi.fn().mockResolvedValue(undefined);

    const broker = createHeartbeatRuntimeDecisionBroker({
      run,
      agent,
      runtime,
      runtimeDecisions,
      appendRunEvent,
      markRunWaiting,
      clearRunWaiting,
      pollIntervalMs: 0,
    });

    const result = await broker.requestPermission({
      nonce: "nonce-1",
      title: "Allow command?",
      summary: "Needs shell",
      promptText: "Run pnpm test?",
      toolName: "shell",
      command: "pnpm test",
      riskClass: "medium",
    });

    expect(result).toEqual({
      kind: "permission",
      decisionId: created.id,
      decision: "allow_once",
      sourceRevision: 2,
    });
    expect(runtimeDecisions.createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: run.companyId,
        agentId: run.agentId,
        runId: run.id,
        adapterType: "codex_local",
        adapterSessionId: "display-session",
        adapterSessionParams: { session: "display-session" },
        kind: "permission",
        nonce: "nonce-1",
        timeoutPolicy: "deny",
      }),
    );
    expect(markRunWaiting).toHaveBeenCalledWith(created);
    expect(runtimeDecisions.waitForAnswer).toHaveBeenCalledWith({
      companyId: run.companyId,
      decisionId: created.id,
      pollIntervalMs: 0,
    });
    expect(runtimeDecisions.markRelayed).toHaveBeenCalledWith({ companyId: run.companyId, decisionId: created.id });
    expect(clearRunWaiting).toHaveBeenCalledWith(relayed);
    expect(appendRunEvent.mock.calls.map((call) => call[0].eventType)).toEqual([
      "runtime_decision.prompt_created",
      "runtime_decision.prompt_answered",
      "runtime_decision.relayed",
    ]);
  });

  it("marks relay_failed if the answered prompt cannot be relayed back to the adapter", async () => {
    const created = decisionRow();
    const answered = decisionRow({ status: "answered", sourceRevision: 1, decision: "deny" });
    const relayError = new Error("adapter channel closed");
    const runtimeDecisions = {
      createPrompt: vi.fn().mockResolvedValue({ decision: created, hubItem: { id: "hub-1" } }),
      waitForAnswer: vi.fn().mockResolvedValue(answered),
      markRelayed: vi.fn().mockRejectedValue(relayError),
      markRelayFailed: vi.fn().mockResolvedValue(decisionRow({ status: "relay_failed", relayError: "adapter channel closed" })),
    };
    const broker = createHeartbeatRuntimeDecisionBroker({
      run,
      agent,
      runtime,
      runtimeDecisions,
      appendRunEvent: vi.fn().mockResolvedValue(undefined),
      markRunWaiting: vi.fn().mockResolvedValue(undefined),
      clearRunWaiting: vi.fn().mockResolvedValue(undefined),
      pollIntervalMs: 0,
    });

    await expect(
      broker.requestPermission({
        nonce: "nonce-1",
        title: "Allow command?",
      }),
    ).rejects.toThrow("adapter channel closed");

    expect(runtimeDecisions.markRelayFailed).toHaveBeenCalledWith({
      companyId: run.companyId,
      decisionId: created.id,
      relayError: "adapter channel closed",
    });
  });

  it("defaults work-question prompts to park_run instead of the permission deny policy", async () => {
    const created = decisionRow({ kind: "work_question", timeoutPolicy: "park_run" });
    const answered = decisionRow({
      kind: "work_question",
      status: "answered",
      sourceRevision: 1,
      answerPayload: { choice: "ship it" },
    });
    const relayed = decisionRow({
      kind: "work_question",
      status: "relayed",
      sourceRevision: 2,
      answerPayload: { choice: "ship it" },
    });
    const runtimeDecisions = {
      createPrompt: vi.fn().mockResolvedValue({ decision: created, hubItem: { id: "hub-1" } }),
      waitForAnswer: vi.fn().mockResolvedValue(answered),
      markRelayed: vi.fn().mockResolvedValue(relayed),
      markRelayFailed: vi.fn(),
    };
    const broker = createHeartbeatRuntimeDecisionBroker({
      run,
      agent,
      runtime,
      runtimeDecisions,
      appendRunEvent: vi.fn().mockResolvedValue(undefined),
      markRunWaiting: vi.fn().mockResolvedValue(undefined),
      clearRunWaiting: vi.fn().mockResolvedValue(undefined),
      pollIntervalMs: 0,
    });

    await broker.askWorkQuestion({
      nonce: "question-1",
      title: "Pick a release path",
    });

    expect(runtimeDecisions.createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "work_question",
        timeoutPolicy: "park_run",
      }),
    );
  });

  it("propagates runtime decision cancellation without marking relay failure", async () => {
    const created = decisionRow();
    const cancelled = decisionRow({ status: "cancelled", sourceRevision: 1, relayError: "run cancelled" });
    const cancelError = new RuntimeDecisionCancelledError(cancelled as never);
    const runtimeDecisions = {
      createPrompt: vi.fn().mockResolvedValue({ decision: created, hubItem: { id: "hub-1" } }),
      waitForAnswer: vi.fn().mockRejectedValue(cancelError),
      markRelayed: vi.fn(),
      markRelayFailed: vi.fn(),
    };
    const broker = createHeartbeatRuntimeDecisionBroker({
      run,
      agent,
      runtime,
      runtimeDecisions,
      appendRunEvent: vi.fn().mockResolvedValue(undefined),
      markRunWaiting: vi.fn().mockResolvedValue(undefined),
      clearRunWaiting: vi.fn().mockResolvedValue(undefined),
      pollIntervalMs: 0,
    });

    await expect(
      broker.requestPermission({
        nonce: "nonce-1",
        title: "Allow command?",
      }),
    ).rejects.toBe(cancelError);

    expect(runtimeDecisions.markRelayed).not.toHaveBeenCalled();
    expect(runtimeDecisions.markRelayFailed).not.toHaveBeenCalled();
  });

  it("preserves cancellation when markRelayed loses a race to run cancellation", async () => {
    const created = decisionRow();
    const answered = decisionRow({ status: "answered", sourceRevision: 1, decision: "allow_once" });
    const cancelled = decisionRow({ status: "cancelled", sourceRevision: 2, relayError: "run cancelled" });
    const cancelError = new RuntimeDecisionCancelledError(cancelled as never);
    const runtimeDecisions = {
      createPrompt: vi.fn().mockResolvedValue({ decision: created, hubItem: { id: "hub-1" } }),
      waitForAnswer: vi.fn().mockResolvedValue(answered),
      markRelayed: vi.fn().mockRejectedValue(cancelError),
      markRelayFailed: vi.fn(),
    };
    const broker = createHeartbeatRuntimeDecisionBroker({
      run,
      agent,
      runtime,
      runtimeDecisions,
      appendRunEvent: vi.fn().mockResolvedValue(undefined),
      markRunWaiting: vi.fn().mockResolvedValue(undefined),
      clearRunWaiting: vi.fn().mockResolvedValue(undefined),
      pollIntervalMs: 0,
    });

    await expect(
      broker.requestPermission({
        nonce: "nonce-1",
        title: "Allow command?",
      }),
    ).rejects.toBe(cancelError);

    expect(runtimeDecisions.markRelayed).toHaveBeenCalledWith({ companyId: run.companyId, decisionId: created.id });
    expect(runtimeDecisions.markRelayFailed).not.toHaveBeenCalled();
  });
});
