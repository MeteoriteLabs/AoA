import { describe, expect, it, vi } from "vitest";
import {
  agentRuntimeDecisionService,
  RuntimeDecisionCancelledError,
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
    commandHash: "command-hash-1",
    cwd: "C:/repo",
    path: null,
    networkTarget: null,
    riskClass: "medium",
    options: null,
    expiresAt: new Date("2026-07-01T12:15:00.000Z"),
    timeoutPolicy: "deny",
    decision: null,
    answerPayload: null,
    answerIdempotencyKey: null,
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

function makeService(
  repoOverrides: Record<string, unknown> = {},
  depOverrides: { runCanceller?: (i: { companyId: string; runId: string; reason: string }) => Promise<void> } = {},
) {
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
  const runCanceller = depOverrides.runCanceller ?? vi.fn(async () => {});
  const service = agentRuntimeDecisionService({} as never, {
    repo: repo as never,
    hubItems: hubItems as never,
    activityLogger,
    runCanceller,
    now,
  });
  return { service, repo, hubItems, activityLogger, runCanceller };
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
        commandHash: expect.any(String),
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

  it("redacts secret-bearing option payloads before persisting prompts", async () => {
    const { service, repo } = makeService();

    await service.createPrompt({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local",
      kind: "work_question",
      nonce: "nonce-options",
      title: "Need a choice",
      options: [
        {
          label: "Use token",
          value: "sk-ant-abc123DEF456ghi789",
          nested: {
            command: "AOA_API_KEY=sk-ant-abc123DEF456ghi789 pnpm test:run",
            unchanged: 42,
            values: ["safe", "sk-ant-abc123DEF456ghi789"],
          },
        },
      ],
      timeoutPolicy: "park_run",
    });

    expect(repo.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          {
            label: "Use token",
            value: "***REDACTED***",
            nested: {
              command: "AOA_API_KEY=***REDACTED*** pnpm test:run",
              unchanged: 42,
              values: ["safe", "***REDACTED***"],
            },
          },
        ],
      }),
    );
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

  it("guards nonce replay upserts to preserve already answered or terminal prompts", async () => {
    let conflictConfig: Record<string, unknown> | null = null;
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn((config) => {
            conflictConfig = config;
            return {
              returning: () => Promise.resolve([baseDecision()]),
            };
          }),
        })),
      })),
    };
    const hubItems = { emit: vi.fn(async () => ({ id: "hub-1", version: 0 })) };
    const service = agentRuntimeDecisionService(db as never, {
      hubItems: hubItems as never,
      activityLogger: vi.fn(async () => {}),
      now,
    });

    await service.createPrompt({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local",
      kind: "permission",
      nonce: "nonce-replay",
      title: "Allow shell command?",
      toolName: "shell",
      command: "pnpm test:run",
      timeoutPolicy: "deny",
    });

    expect(conflictConfig).toEqual(expect.objectContaining({
      setWhere: expect.anything(),
    }));
  });

  it("bumps the source revision when a nonce refresh updates an open prompt", async () => {
    let conflictConfig: { set?: Record<string, unknown> } | null = null;
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn((config) => {
            conflictConfig = config;
            return {
              returning: () => Promise.resolve([baseDecision({ sourceRevision: 8 })]),
            };
          }),
        })),
      })),
    };
    const hubItems = { emit: vi.fn(async () => ({ id: "hub-1", version: 0 })) };
    const service = agentRuntimeDecisionService(db as never, {
      hubItems: hubItems as never,
      activityLogger: vi.fn(async () => {}),
      now,
    });

    await service.createPrompt({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local",
      kind: "permission",
      nonce: "nonce-refresh",
      title: "Allow refreshed command?",
      toolName: "shell",
      command: "pnpm build",
      timeoutPolicy: "deny",
    });

    expect(conflictConfig?.set?.sourceRevision).not.toBe(0);
  });

  it("matches allow-always path scopes across Windows and POSIX separators", async () => {
    const { service, repo } = makeService({
      listTrustRules: vi.fn(async () => [
        baseTrustRule({
          toolName: "edit",
          pathScope: "C:\\repo\\packages\\ui",
          riskClass: null,
        }),
      ]),
    });

    await service.createPrompt({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local",
      kind: "permission",
      nonce: "nonce-windows-path",
      title: "Allow file edit?",
      toolName: "edit",
      path: "C:/repo/packages/ui/src/App.tsx",
      timeoutPolicy: "deny",
    });

    expect(repo.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "answered",
        decision: "allow_always",
      }),
    );
  });

  it("does not match allow-always path scopes when the prompt path traverses outside the scope", async () => {
    const { service, repo } = makeService({
      listTrustRules: vi.fn(async () => [
        baseTrustRule({
          toolName: "edit",
          pathScope: "/repo/src",
          riskClass: null,
        }),
      ]),
    });

    await service.createPrompt({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local",
      kind: "permission",
      nonce: "nonce-traversal-path",
      title: "Allow file edit?",
      toolName: "edit",
      path: "/repo/src/../secrets.env",
      timeoutPolicy: "deny",
    });

    expect(repo.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "created",
        decision: null,
      }),
    );
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

  it("does not match secret-bearing commands by their redacted display text", async () => {
    let trustedCommandHash: string | null = null;
    const { service, repo } = makeService({
      createTrustRule: vi.fn(async (input) => {
        trustedCommandHash = (input as { commandHash?: string | null }).commandHash ?? null;
        return baseTrustRule(input as Record<string, unknown>);
      }),
      listTrustRules: vi.fn(async () =>
        trustedCommandHash
          ? [baseTrustRule({ commandHash: trustedCommandHash, riskClass: null })]
          : []
      ),
    });

    await service.createTrustRule({
      companyId: "company-1",
      agentId: "agent-1",
      adapterType: "claude_local",
      toolName: "shell",
      command: "AOA_API_KEY=sk-ant-abc123DEF456ghi789 pnpm test:run",
      createdByUserId: "founder-1",
    });

    await service.createPrompt({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local",
      kind: "permission",
      nonce: "nonce-secret-command",
      title: "Allow shell command?",
      toolName: "shell",
      command: "AOA_API_KEY=sk-ant-xyz987UVW654rst321 pnpm test:run",
      timeoutPolicy: "deny",
    });

    expect(repo.createDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "created",
        decision: null,
        command: "AOA_API_KEY=***REDACTED*** pnpm test:run",
        commandHash: expect.any(String),
      }),
    );
    expect(repo.markTrustRuleUsed).not.toHaveBeenCalled();
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
        answerIdempotencyKey: "answer-1",
        answeredByUserId: "founder-1",
        answeredAt: now(),
        sourceRevision: 3,
      }),
      expect.objectContaining({
        sourceRevision: 2,
        statuses: ["created", "shown", "relay_failed"],
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
    expect(repo.updateDecision.mock.invocationCallOrder[0]).toBeLessThan(
      activityLogger.mock.invocationCallOrder[0],
    );
    expect(repo.createTrustRule).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        agentId: "agent-1",
        adapterType: "claude_local",
        toolName: "shell",
        commandHash: "command-hash-1",
        createdByUserId: "founder-1",
      }),
    );
    expect(result.status).toBe("answered");
  });

  it("replays an already answered prompt when the same idempotency key is retried", async () => {
    const answered = baseDecision({
      status: "answered",
      decision: "allow_always",
      answerIdempotencyKey: "answer-1",
      answeredByUserId: "founder-1",
      answeredAt: now(),
      sourceRevision: 3,
    });
    const { service, repo, activityLogger, hubItems } = makeService({
      getDecision: vi.fn(async () => answered),
    });

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

    expect(result).toBe(answered);
    expect(repo.updateDecision).not.toHaveBeenCalled();
    expect(repo.createTrustRule).not.toHaveBeenCalled();
    expect(activityLogger).not.toHaveBeenCalled();
    expect(hubItems.emit).not.toHaveBeenCalled();
  });

  it("replays an already relayed prompt when the same idempotency key is retried", async () => {
    const relayed = baseDecision({
      status: "relayed",
      decision: "allow_once",
      answerIdempotencyKey: "answer-1",
      answeredByUserId: "founder-1",
      answeredAt: now(),
      relayedAt: now(),
      sourceRevision: 4,
    });
    const { service, repo, activityLogger, hubItems } = makeService({
      getDecision: vi.fn(async () => relayed),
    });

    const result = await service.answerPrompt({
      companyId: "company-1",
      decisionId: "decision-1",
      actorUserId: "founder-1",
      expectedSourceRevision: 2,
      nonce: "nonce-1",
      kind: "permission",
      decision: "allow_once",
      idempotencyKey: "answer-1",
    });

    expect(result).toBe(relayed);
    expect(repo.updateDecision).not.toHaveBeenCalled();
    expect(repo.createTrustRule).not.toHaveBeenCalled();
    expect(activityLogger).not.toHaveBeenCalled();
    expect(hubItems.emit).not.toHaveBeenCalled();
  });

  it("rejects allow-always answers when the prompt has no concrete scope", async () => {
    const unscoped = baseDecision({
      command: null,
      commandHash: null,
      path: null,
      networkTarget: null,
      riskClass: null,
    });
    const { service, repo } = makeService({
      getDecision: vi.fn(async () => unscoped),
    });

    await expect(
      service.answerPrompt({
        companyId: "company-1",
        decisionId: "decision-1",
        actorUserId: "founder-1",
        expectedSourceRevision: 2,
        nonce: "nonce-1",
        kind: "permission",
        decision: "allow_always",
      }),
    ).rejects.toMatchObject({ status: 422 });

    expect(repo.updateDecision).not.toHaveBeenCalled();
    expect(repo.createTrustRule).not.toHaveBeenCalled();
  });

  it("allows relay-failed prompts to be answered again for retry", async () => {
    const relayFailed = baseDecision({ status: "relay_failed", sourceRevision: 3 });
    const { service, repo } = makeService({
      getDecision: vi.fn(async () => relayFailed),
    });

    await service.answerPrompt({
      companyId: "company-1",
      decisionId: "decision-1",
      actorUserId: "founder-1",
      expectedSourceRevision: 3,
      nonce: "nonce-1",
      kind: "permission",
      decision: "allow_once",
    });

    expect(repo.updateDecision).toHaveBeenCalledWith(
      "decision-1",
      expect.objectContaining({ status: "answered", decision: "allow_once", sourceRevision: 4 }),
      expect.objectContaining({ sourceRevision: 3, statuses: ["created", "shown", "relay_failed"] }),
    );
  });

  it("returns conflict without answer side effects when the guarded answer update loses a race", async () => {
    const { service, repo, activityLogger, hubItems } = makeService({
      updateDecision: vi.fn(async () => null),
    });

    await expect(
      service.answerPrompt({
        companyId: "company-1",
        decisionId: "decision-1",
        actorUserId: "founder-1",
        expectedSourceRevision: 2,
        nonce: "nonce-1",
        kind: "permission",
        decision: "allow_always",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(repo.updateDecision).toHaveBeenCalledWith(
      "decision-1",
      expect.objectContaining({ status: "answered", sourceRevision: 3 }),
      expect.objectContaining({ sourceRevision: 2, statuses: ["created", "shown", "relay_failed"] }),
    );
    expect(activityLogger).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "runtime_decision.answered" }),
    );
    expect(repo.createTrustRule).not.toHaveBeenCalled();
    expect(hubItems.emit).not.toHaveBeenCalled();
  });

  it("matches allow-always rules against redacted command text consistently", async () => {
    let savedRule: ReturnType<typeof baseTrustRule> | null = null;
    const { service, repo } = makeService({
      createTrustRule: vi.fn(async (input) => {
        savedRule = baseTrustRule(input as Record<string, unknown>);
        return savedRule;
      }),
      listTrustRules: vi.fn(async () => savedRule ? [savedRule] : []),
    });

    await service.createTrustRule({
      companyId: "company-1",
      agentId: "agent-1",
      adapterType: "claude_local",
      toolName: "shell",
      command: "AOA_API_KEY=sk-ant-abc123DEF456ghi789 pnpm test:run",
      riskClass: "medium",
      createdByUserId: "founder-1",
    });

    await service.createPrompt({
      companyId: "company-1",
      agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local",
      kind: "permission",
      nonce: "nonce-secret",
      title: "Allow shell command?",
      toolName: "shell",
      command: "AOA_API_KEY=sk-ant-abc123DEF456ghi789 pnpm test:run",
      riskClass: "medium",
      timeoutPolicy: "deny",
    });

    expect(repo.createDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "answered",
        decision: "allow_always",
        command: "AOA_API_KEY=***REDACTED*** pnpm test:run",
      }),
    );
    expect(repo.markTrustRuleUsed).toHaveBeenCalledWith({ ruleId: "rule-1", usedAt: now() });
  });

  it("keeps relay failures actionable and refreshes the hub item", async () => {
    const answered = baseDecision({ status: "answered", sourceRevision: 3 });
    const { service, repo, hubItems } = makeService({
      getDecision: vi.fn(async () => answered),
    });

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
        sourceRevision: 4,
      }),
      expect.objectContaining({
        sourceRevision: 3,
        statuses: ["answered"],
      }),
    );
    expect(hubItems.emit).toHaveBeenCalled();
    expect(result.status).toBe("relay_failed");
  });

  it("skips relay failure side effects when the answered prompt changed concurrently", async () => {
    const answered = baseDecision({ status: "answered", sourceRevision: 3 });
    const { service, repo, hubItems, activityLogger } = makeService({
      getDecision: vi.fn(async () => answered),
      updateDecision: vi.fn(async () => null),
    });

    await expect(
      service.markRelayFailed({
        companyId: "company-1",
        decisionId: "decision-1",
        relayError: "adapter hook disconnected",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(repo.updateDecision).toHaveBeenCalledWith(
      "decision-1",
      expect.objectContaining({ status: "relay_failed", sourceRevision: 4 }),
      expect.objectContaining({ sourceRevision: 3, statuses: ["answered"] }),
    );
    expect(activityLogger).not.toHaveBeenCalled();
    expect(hubItems.emit).not.toHaveBeenCalled();
  });

  it("guards relay success against cancellation races", async () => {
    const answered = baseDecision({ status: "answered", sourceRevision: 3 });
    const { service, repo, hubItems, activityLogger } = makeService({
      getDecision: vi.fn(async () => answered),
      updateDecision: vi.fn(async () => null),
    });

    await expect(
      service.markRelayed({
        companyId: "company-1",
        decisionId: "decision-1",
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(repo.updateDecision).toHaveBeenCalledWith(
      "decision-1",
      expect.objectContaining({ status: "relayed", sourceRevision: 4 }),
      expect.objectContaining({ sourceRevision: 3, statuses: ["answered"] }),
    );
    expect(activityLogger).not.toHaveBeenCalled();
    expect(hubItems.emit).not.toHaveBeenCalled();
  });

  it("throws a runtime cancellation sentinel when a waited prompt is cancelled", async () => {
    const cancelled = baseDecision({ status: "cancelled", sourceRevision: 3, relayError: "run cancelled" });
    const { service } = makeService({
      getDecision: vi.fn(async () => cancelled),
    });

    await expect(
      service.waitForAnswer({
        companyId: "company-1",
        decisionId: "decision-1",
        pollIntervalMs: 0,
        timeoutMs: 1,
      }),
    ).rejects.toBeInstanceOf(RuntimeDecisionCancelledError);
  });

  it("cancels due prompts with park/escalate policies so waiting runs unblock", async () => {
    const due = baseDecision({ id: "due-1", status: "shown", timeoutPolicy: "park_run", sourceRevision: 5 });
    const { service, repo, hubItems, runCanceller } = makeService({
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
        status: "cancelled",
        relayError: "timeout policy parked the run",
        expiresAt: null,
        sourceRevision: 6,
      }),
      expect.objectContaining({
        sourceRevision: 5,
        statuses: ["created", "shown"],
      }),
    );
    expect(hubItems.emit).toHaveBeenCalled();
    expect(runCanceller).toHaveBeenCalledWith({
      companyId: "company-1",
      runId: "11111111-1111-4111-8111-111111111111",
      reason: "timeout policy parked the run",
    });
    expect(result.expired).toBe(0);
  });

  it("applies deny timeout policy as an answer for due permission prompts", async () => {
    const due = baseDecision({ id: "due-1", kind: "permission", timeoutPolicy: "deny", status: "shown", sourceRevision: 5 });
    const { service, repo, hubItems } = makeService({
      listDueForExpiry: vi.fn(async () => [due]),
    });

    const result = await service.expireDuePrompts({
      companyId: "company-1",
      limit: 10,
    });

    expect(repo.updateDecision).toHaveBeenCalledWith(
      "due-1",
      expect.objectContaining({
        status: "answered",
        decision: "deny",
        answeredAt: now(),
        sourceRevision: 6,
      }),
      expect.objectContaining({
        sourceRevision: 5,
        statuses: ["created", "shown"],
      }),
    );
    expect(hubItems.emit).toHaveBeenCalled();
    expect(result.expired).toBe(1);
  });

  it("cancels the run when a due prompt expires with cancel_run policy", async () => {
    const due = baseDecision({ id: "due-1", status: "shown", timeoutPolicy: "cancel_run", sourceRevision: 5 });
    const { service, repo, runCanceller } = makeService({
      listDueForExpiry: vi.fn(async () => [due]),
      updateDecision: vi.fn(async (_id, patch) => baseDecision({ id: "due-1", ...(patch as Record<string, unknown>) })),
    });

    const result = await service.expireDuePrompts({
      companyId: "company-1",
      limit: 10,
    });

    expect(repo.updateDecision).toHaveBeenCalledWith(
      "due-1",
      expect.objectContaining({
        status: "cancelled",
        relayError: "timeout policy cancelled the run",
        sourceRevision: 6,
      }),
      expect.objectContaining({
        sourceRevision: 5,
        statuses: ["created", "shown"],
      }),
    );
    expect(runCanceller).toHaveBeenCalledWith({
      companyId: "company-1",
      runId: "11111111-1111-4111-8111-111111111111",
      reason: "timeout policy cancelled the run",
    });
    expect(result.expired).toBe(1);
  });

  it("does not cancel the run when cancel_run timeout loses the guarded update race", async () => {
    const due = baseDecision({ id: "due-1", status: "shown", timeoutPolicy: "cancel_run", sourceRevision: 5 });
    const { service, runCanceller } = makeService({
      listDueForExpiry: vi.fn(async () => [due]),
      updateDecision: vi.fn(async () => null),
    });

    const result = await service.expireDuePrompts({
      companyId: "company-1",
      limit: 10,
    });

    expect(runCanceller).not.toHaveBeenCalled();
    expect(result.expired).toBe(0);
  });

  it("skips timeout expiry side effects when the prompt revision changed concurrently", async () => {
    const due = baseDecision({ id: "due-1", status: "shown", timeoutPolicy: "deny", sourceRevision: 5 });
    const { service, repo, hubItems } = makeService({
      listDueForExpiry: vi.fn(async () => [due]),
      updateDecision: vi.fn(async () => null),
    });

    const result = await service.expireDuePrompts({
      companyId: "company-1",
      limit: 10,
    });

    expect(repo.updateDecision).toHaveBeenCalledWith(
      "due-1",
      expect.objectContaining({ status: "answered", sourceRevision: 6 }),
      expect.objectContaining({ sourceRevision: 5, statuses: ["created", "shown"] }),
    );
    expect(hubItems.emit).not.toHaveBeenCalled();
    expect(result.expired).toBe(0);
  });

  it("cancels active run prompts and emits hub reconciliation updates", async () => {
    const active = baseDecision({ id: "active-1", status: "shown", sourceRevision: 4 });
    const { service, repo, hubItems, activityLogger } = makeService({
      listActiveForRun: vi.fn(async () => [active]),
      updateDecision: vi.fn(async (_id, patch) => baseDecision({ id: "active-1", ...(patch as Record<string, unknown>) })),
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
      expect.objectContaining({
        sourceRevision: 4,
        statuses: ["created", "shown", "answered", "relay_failed"],
      }),
    );
    expect(hubItems.emit).toHaveBeenCalled();
    expect(result.cancelled).toBe(1);
  });

  it("skips cancellation side effects when an active prompt finalized concurrently", async () => {
    const active = baseDecision({ id: "active-1", status: "answered", sourceRevision: 4 });
    const { service, repo, hubItems, activityLogger } = makeService({
      listActiveForRun: vi.fn(async () => [active]),
      updateDecision: vi.fn(async () => null),
    });

    const result = await service.cancelActiveForRun({
      companyId: "company-1",
      runId: "11111111-1111-4111-8111-111111111111",
      reason: "run cancelled",
    });

    expect(repo.updateDecision).toHaveBeenCalledWith(
      "active-1",
      expect.objectContaining({
        status: "cancelled",
        relayError: "run cancelled",
        sourceRevision: 5,
      }),
      expect.objectContaining({
        sourceRevision: 4,
        statuses: ["created", "shown", "answered", "relay_failed"],
      }),
    );
    expect(activityLogger).not.toHaveBeenCalled();
    expect(hubItems.emit).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(0);
  });

  it("reports runtime decision source terminality for hub reconciliation", () => {
    expect(runtimeDecisionSourceSnapshot(null)).toMatchObject({ terminal: true });
    expect(runtimeDecisionSourceSnapshot(baseDecision({ status: "relay_failed" }))).toMatchObject({
      terminal: false,
      permissionRevision: "2",
    });
    expect(runtimeDecisionSourceSnapshot(baseDecision({
      status: "cancelled",
      timeoutPolicy: "park_run",
      relayError: "timeout policy parked the run",
      summary: "Original question",
    }))).toMatchObject({
      terminal: false,
      summary: "timeout policy parked the run",
    });
    expect(runtimeDecisionSourceSnapshot(baseDecision({ status: "relayed" }))).toMatchObject({
      terminal: true,
    });
    expect(runtimeDecisionSourceSnapshot(baseDecision({ status: "cancelled", timeoutPolicy: "cancel_run" }))).toMatchObject({
      terminal: true,
    });
  });

  it("defaults permission prompt expiry to 1h when none supplied", async () => {
    const { service, repo } = makeService();
    await service.createPrompt({
      companyId: "company-1", agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local", kind: "permission", nonce: "nonce-1",
      title: "Allow?", timeoutPolicy: "deny",
    });
    expect(repo.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: new Date("2026-07-01T13:00:00.000Z") }),
    );
  });

  it("defaults work_question expiry to 24h when none supplied", async () => {
    const { service, repo } = makeService();
    await service.createPrompt({
      companyId: "company-1", agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local", kind: "work_question", nonce: "nonce-2",
      title: "Which approach?", timeoutPolicy: "park_run",
    });
    expect(repo.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: new Date("2026-07-02T12:00:00.000Z") }),
    );
  });

  it("honours an explicitly supplied expiry", async () => {
    const { service, repo } = makeService();
    const explicit = new Date("2026-07-01T12:05:00.000Z");
    await service.createPrompt({
      companyId: "company-1", agentId: "agent-1",
      runId: "11111111-1111-4111-8111-111111111111",
      adapterType: "claude_local", kind: "permission", nonce: "nonce-3",
      title: "Allow?", timeoutPolicy: "deny", expiresAt: explicit,
    });
    expect(repo.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: explicit }),
    );
  });

  it("continue_with_default relays an explicit default option when present", async () => {
    const due = baseDecision({
      id: "d-cwd-1", kind: "permission", timeoutPolicy: "continue_with_default",
      status: "shown", sourceRevision: 5,
      options: [{ label: "Allow once", value: "allow_once", isDefault: true }],
    });
    const updateDecision = vi.fn(async (_id, patch) => baseDecision(patch as Record<string, unknown>));
    const { service } = makeService({ listDueForExpiry: vi.fn(async () => [due]), updateDecision });
    await service.expireDuePrompts({ limit: 10 });
    expect(updateDecision).toHaveBeenCalledWith(
      "d-cwd-1",
      expect.objectContaining({ status: "answered", decision: "allow_once" }),
      expect.objectContaining({ sourceRevision: 5, statuses: ["created", "shown"] }),
    );
  });

  it("continue_with_default without a default falls back to deny for permission", async () => {
    const due = baseDecision({
      id: "d-cwd-2", kind: "permission", timeoutPolicy: "continue_with_default",
      status: "shown", sourceRevision: 3, options: null,
    });
    const updateDecision = vi.fn(async (_id, patch) => baseDecision(patch as Record<string, unknown>));
    const { service } = makeService({ listDueForExpiry: vi.fn(async () => [due]), updateDecision });
    await service.expireDuePrompts({ limit: 10 });
    expect(updateDecision).toHaveBeenCalledWith(
      "d-cwd-2",
      expect.objectContaining({ status: "answered", decision: "deny" }),
      expect.anything(),
    );
  });

  it("continue_with_default without a default parks a work_question (never denies)", async () => {
    const due = baseDecision({
      id: "d-cwd-3", kind: "work_question", timeoutPolicy: "continue_with_default",
      status: "shown", sourceRevision: 1, options: null, decision: null,
    });
    const updateDecision = vi.fn(async (_id, patch) => baseDecision(patch as Record<string, unknown>));
    const runCanceller = vi.fn(async () => {});
    const { service } = makeService(
      { listDueForExpiry: vi.fn(async () => [due]), updateDecision },
      { runCanceller },
    );
    await service.expireDuePrompts({ limit: 10 });
    expect(updateDecision).toHaveBeenCalledWith(
      "d-cwd-3",
      expect.objectContaining({ status: "cancelled" }),
      expect.anything(),
    );
    expect(runCanceller).toHaveBeenCalled();
  });

  it("reports processed count for drain control", async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      baseDecision({ id: `due-${i}`, status: "shown", timeoutPolicy: "cancel_run", sourceRevision: 1 }),
    );
    const { service } = makeService({
      listDueForExpiry: vi.fn(async () => rows),
      updateDecision: vi.fn(async (_id, patch) => baseDecision(patch as Record<string, unknown>)),
    });
    const result = await service.expireDuePrompts({ limit: 100 });
    expect(result.processed).toBe(3);
  });

  it("keeps sweeping after runCanceller throws for one run", async () => {
    const rows = [
      baseDecision({ id: "due-0", runId: "run-a", status: "shown", timeoutPolicy: "cancel_run", sourceRevision: 1 }),
      baseDecision({ id: "due-1", runId: "run-b", status: "shown", timeoutPolicy: "cancel_run", sourceRevision: 1 }),
    ];
    const runCanceller = vi.fn(async ({ runId }: { runId: string }) => {
      if (runId === "run-a") throw new Error("Heartbeat run not found");
    });
    const { service } = makeService(
      {
        listDueForExpiry: vi.fn(async () => rows),
        updateDecision: vi.fn(async (_id, patch) => baseDecision(patch as Record<string, unknown>)),
      },
      { runCanceller },
    );
    const result = await service.expireDuePrompts({ limit: 100 });
    expect(result.processed).toBe(2);
  });
});
