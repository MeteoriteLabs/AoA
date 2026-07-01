import { describe, expect, it, vi } from "vitest";
import {
  agentRuntimeDecisionService,
  runtimeDecisionSourceSnapshot,
} from "../services/agent-runtime-decisions.js";

const now = () => new Date("2026-07-01T12:00:00.000Z");

function baseDecision(overrides: Record<string, unknown> = {}) {
  return {
    id: "decision-1",
    companyId: "company-1",
    agentId: "agent-1",
    runId: "11111111-1111-4111-8111-111111111111",
    adapterType: "claude_local",
    adapterSessionId: null,
    adapterSessionParams: null,
    kind: "permission",
    status: "shown",
    nonce: "nonce-1",
    sourceRevision: 2,
    promptHash: "hash-1",
    sourceUniqueKey: "runtime:company-1:11111111-1111-4111-8111-111111111111:nonce-1",
    title: "Allow command?",
    summary: "Run tests",
    promptText: "pnpm test:run",
    toolName: "shell",
    command: "pnpm test:run",
    cwd: "C:/repo",
    path: null,
    networkTarget: null,
    riskClass: "medium",
    options: null,
    expiresAt: new Date("2026-07-01T12:15:00.000Z"),
    timeoutPolicy: "deny",
    decision: null,
    answerPayload: null,
    answeredByUserId: null,
    answeredAt: null,
    relayedAt: null,
    relayError: null,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function baseTrustRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    companyId: "company-1",
    agentId: "agent-1",
    adapterType: "claude_local",
    toolName: "shell",
    commandHash: null,
    pathScope: null,
    networkScope: null,
    riskClass: "medium",
    enabled: true,
    expiresAt: null,
    createdByUserId: "founder-1",
    lastUsedAt: null,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

function makeService(repoOverrides: Record<string, unknown> = {}) {
  const repo = {
    createDecision: vi.fn(async (input) => baseDecision(input as Record<string, unknown>)),
    getDecision: vi.fn(async () => baseDecision()),
    listActiveForRun: vi.fn(async () => []),
    listTrustRules: vi.fn(async () => []),
    createTrustRule: vi.fn(async (input) => baseTrustRule(input as Record<string, unknown>)),
    revokeTrustRule: vi.fn(async () => baseTrustRule({ enabled: false })),
    markTrustRuleUsed: vi.fn(async () => {}),
    updateDecision: vi.fn(async (_id, patch) => baseDecision(patch as Record<string, unknown>)),
    listDueForExpiry: vi.fn(async () => []),
    ...repoOverrides,
  };
  const hubItems = {
    emit: vi.fn(async () => ({ id: "hub-1", version: 0 })),
  };
  const activityLogger = vi.fn(async () => {});
  const service = agentRuntimeDecisionService({} as never, {
    repo: repo as never,
    hubItems: hubItems as never,
    activityLogger,
    now,
  });
  return { service, repo, hubItems, activityLogger };
}

describe("agentRuntimeDecisionService", () => {
  it("creates a redacted runtime permission prompt and emits a Waiting on you hub item", async () => {
    const { service, repo, hubItems } = makeService();

    const result = await service.createPrompt({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local",
      kind: "permission",
      nonce: "nonce-1",
      title: "Allow shell command?",
      summary: "Command includes sk-ant-abc123DEF456ghi789.",
      promptText: "Run AOA_API_KEY=sk-ant-abc123DEF456ghi789 pnpm test:run",
      toolName: "shell",
      command: "AOA_API_KEY=sk-ant-abc123DEF456ghi789 pnpm test:run",
      timeoutPolicy: "deny",
    });

    expect(repo.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        kind: "permission",
        status: "created",
        sourceRevision: 0,
        summary: "Command includes ***REDACTED***.",
        promptText: "Run AOA_API_KEY=***REDACTED*** pnpm test:run",
        command: "AOA_API_KEY=***REDACTED*** pnpm test:run",
        promptHash: expect.any(String),
        sourceUniqueKey: "runtime:company-1:11111111-1111-4111-8111-111111111111:nonce-1",
      }),
    );
    expect(hubItems.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        semanticType: "agent_runtime_decision",
        sourceType: "runtime_decision",
        sourceId: result.decision.id,
        sourceActorType: "agent",
        sourceActorId: "agent-1",
        sourcePermissionRevision: "0",
      }),
    );
    expect(result.hubItem).toMatchObject({ id: "hub-1" });
  });

  it("auto-answers matching allow-always trust rules for permission prompts", async () => {
    const { service, repo } = makeService({
      listTrustRules: vi.fn(async () => [baseTrustRule()]),
    });

    const result = await service.createPrompt({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local",
      kind: "permission",
      nonce: "nonce-trusted",
      title: "Allow shell command?",
      toolName: "shell",
      command: "pnpm test:run",
      riskClass: "medium",
      timeoutPolicy: "deny",
    });

    expect(repo.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "answered",
        sourceRevision: 1,
        decision: "allow_always",
        answeredByUserId: "founder-1",
        answeredAt: now(),
      }),
    );
    expect(repo.markTrustRuleUsed).toHaveBeenCalledWith({ ruleId: "rule-1", usedAt: now() });
    expect(result.decision.status).toBe("answered");
  });

  it("does not auto-answer non-matching trust rules or work questions", async () => {
    const { service, repo } = makeService({
      listTrustRules: vi.fn(async () => [baseTrustRule({ riskClass: "high" })]),
    });

    await service.createPrompt({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local",
      kind: "permission",
      nonce: "nonce-untrusted",
      title: "Allow shell command?",
      toolName: "shell",
      command: "pnpm test:run",
      riskClass: "medium",
      timeoutPolicy: "deny",
    });
    expect(repo.createDecision).toHaveBeenLastCalledWith(expect.objectContaining({ status: "created", decision: null }));

    await service.createPrompt({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local",
      kind: "work_question",
      nonce: "nonce-question",
      title: "Need product answer",
      timeoutPolicy: "escalate",
    });
    expect(repo.createDecision).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "work_question", status: "created" }));
  });

  it("creates, lists, and revokes allow-always trust rules with audit rows", async () => {
    const { service, repo, activityLogger } = makeService();

    const created = await service.createTrustRule({
      companyId: "company-1",
      agentId: "agent-1",
      adapterType: "claude_local",
      toolName: "shell",
      command: "pnpm test:run",
      riskClass: "medium",
      createdByUserId: "founder-1",
    });
    const listed = await service.listTrustRules({ companyId: "company-1", adapterType: "claude_local" });
    const revoked = await service.revokeTrustRule({
      companyId: "company-1",
      ruleId: "rule-1",
      actorUserId: "founder-1",
    });

    expect(repo.createTrustRule).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        adapterType: "claude_local",
        enabled: true,
        commandHash: expect.any(String),
      }),
    );
    expect(repo.listTrustRules).toHaveBeenCalledWith({ companyId: "company-1", adapterType: "claude_local" });
    expect(repo.revokeTrustRule).toHaveBeenCalledWith({ companyId: "company-1", ruleId: "rule-1" });
    expect(activityLogger).toHaveBeenCalledWith(expect.objectContaining({ action: "runtime_decision_trust_rule.created" }));
    expect(activityLogger).toHaveBeenCalledWith(expect.objectContaining({ action: "runtime_decision_trust_rule.revoked" }));
    expect(created.id).toBe("rule-1");
    expect(listed).toEqual([]);
    expect(revoked.enabled).toBe(false);
  });

  it("rejects answers with a stale source revision or wrong nonce", async () => {
    const { service, repo } = makeService();

    await expect(
      service.answerPrompt({
        companyId: "company-1",
        decisionId: "decision-1",
        actorUserId: "founder-1",
        expectedSourceRevision: 1,
        nonce: "nonce-1",
        kind: "permission",
        decision: "allow_once",
      }),
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      service.answerPrompt({
        companyId: "company-1",
        decisionId: "decision-1",
        actorUserId: "founder-1",
        expectedSourceRevision: 2,
        nonce: "wrong",
        kind: "permission",
        decision: "allow_once",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(repo.updateDecision).not.toHaveBeenCalled();
  });

  it("answers permission prompts by moving to answered with incremented source revision", async () => {
    const { service, repo, activityLogger } = makeService();

    const result = await service.answerPrompt({
      companyId: "company-1",
      decisionId: "decision-1",
      actorUserId: "founder-1",
      expectedSourceRevision: 2,
      nonce: "nonce-1",
      kind: "permission",
      decision: "allow_always",
      idempotencyKey: "answer-1",
    });

    expect(repo.updateDecision).toHaveBeenCalledWith(
      "decision-1",
      expect.objectContaining({
        status: "answered",
        decision: "allow_always",
        answeredByUserId: "founder-1",
        answeredAt: now(),
        sourceRevision: 3,
      }),
    );
    expect(activityLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        actorType: "user",
        actorId: "founder-1",
        action: "runtime_decision.answered",
        entityType: "agent_runtime_decision",
        entityId: "decision-1",
        agentId: "agent-1",
        runId: "11111111-1111-4111-8111-111111111111",
      }),
    );
    expect(activityLogger.mock.invocationCallOrder[0]).toBeLessThan(
      repo.updateDecision.mock.invocationCallOrder[0],
    );
    expect(repo.createTrustRule).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        agentId: "agent-1",
        adapterType: "claude_local",
        toolName: "shell",
        commandHash: expect.any(String),
        createdByUserId: "founder-1",
      }),
    );
    expect(result.status).toBe("answered");
  });

  it("keeps relay failures actionable and refreshes the hub item", async () => {
    const { service, repo, hubItems } = makeService();

    const result = await service.markRelayFailed({
      companyId: "company-1",
      decisionId: "decision-1",
      relayError: "adapter hook disconnected",
    });

    expect(repo.updateDecision).toHaveBeenCalledWith(
      "decision-1",
      expect.objectContaining({
        status: "relay_failed",
        relayError: "adapter hook disconnected",
        sourceRevision: 3,
      }),
    );
    expect(hubItems.emit).toHaveBeenCalled();
    expect(result.status).toBe("relay_failed");
  });

  it("expires due prompts with bounded batch behavior", async () => {
    const due = baseDecision({ id: "due-1", status: "shown", sourceRevision: 5 });
    const { service, repo, hubItems } = makeService({
      listDueForExpiry: vi.fn(async () => [due]),
    });

    const result = await service.expireDuePrompts({
      companyId: "company-1",
      limit: 10,
    });

    expect(repo.listDueForExpiry).toHaveBeenCalledWith({
      companyId: "company-1",
      now: now(),
      limit: 10,
    });
    expect(repo.updateDecision).toHaveBeenCalledWith(
      "due-1",
      expect.objectContaining({
        status: "expired",
        sourceRevision: 6,
      }),
    );
    expect(hubItems.emit).toHaveBeenCalled();
    expect(result.expired).toBe(1);
  });

  it("cancels active run prompts and emits hub reconciliation updates", async () => {
    const active = baseDecision({ id: "active-1", status: "shown", sourceRevision: 4 });
    const { service, repo, hubItems, activityLogger } = makeService({
      listActiveForRun: vi.fn(async () => [active]),
    });

    const result = await service.cancelActiveForRun({
      companyId: "company-1",
      runId: "11111111-1111-4111-8111-111111111111",
      reason: "run cancelled",
    });

    expect(repo.listActiveForRun).toHaveBeenCalledWith({
      companyId: "company-1",
      runId: "11111111-1111-4111-8111-111111111111",
    });
    expect(activityLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "runtime_decision.cancelled",
        entityId: "active-1",
        details: { sourceRevision: 4, reason: "run cancelled" },
      }),
    );
    expect(repo.updateDecision).toHaveBeenCalledWith(
      "active-1",
      expect.objectContaining({
        status: "cancelled",
        relayError: "run cancelled",
        sourceRevision: 5,
      }),
    );
    expect(hubItems.emit).toHaveBeenCalled();
    expect(result.cancelled).toBe(1);
  });

  it("reports relay_failed prompts as non-terminal and relayed prompts as terminal for hub reconciliation", () => {
    expect(runtimeDecisionSourceSnapshot(null)).toMatchObject({ terminal: true });
    expect(runtimeDecisionSourceSnapshot(baseDecision({ status: "relay_failed" }))).toMatchObject({
      terminal: false,
      permissionRevision: "2",
    });
    expect(runtimeDecisionSourceSnapshot(baseDecision({ status: "relayed" }))).toMatchObject({
      terminal: true,
    });
  });
});
