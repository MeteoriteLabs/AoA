/**
 * aoa-runner-context-bundle — Phase 4 / Task 4.3 runner-wiring test.
 *
 * Proves the END-TO-END wiring: on a thread-mention run, `runAoaAgent` builds
 * a crew context bundle and passes it into `buildTriggerPrompt`, so the prompt
 * handed to the adapter now CONTAINS the prior thread entries + a `## Context`
 * section — not just `Thread: <id>` (the IDs-only "agents start blind" prompt
 * this phase fixes).
 *
 * `crew-context-bundle.js` is module-mocked here (its internals are exercised
 * in crew-context-bundle.test.ts) so this test asserts ONLY the wiring: the
 * runner calls it with the right args and the returned string reaches the
 * adapter's config.promptTemplate. Mirrors aoa-runner.test.ts's mock set.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const { execMock, createEventMock, buildMcpMock, buildBridgeSpecMock, bundleMock } = vi.hoisted(() => ({
  execMock: vi.fn().mockResolvedValue({ exitCode: 0 }),
  createEventMock: vi.fn().mockResolvedValue(undefined),
  buildMcpMock: vi.fn(() => ({ mcpServers: {} })),
  buildBridgeSpecMock: vi.fn(() => ({ command: "node", args: ["/x/mcp-bridge.js"], env: {} })),
  bundleMock: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => ({ and: a }), eq: (a: unknown, b: unknown) => ({ eq: [a, b] }) }));
vi.mock("@armyofagents/db", () => {
  const t = (n: string) => new Proxy({}, { get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined) });
  return { agents: t("a"), internalAgentRuns: t("iar"), discussionEntries: t("de"), issues: t("i") };
});
vi.mock("../adapters/registry.js", () => ({ getServerAdapter: () => ({ execute: execMock, getRuntimeCommandSpec: () => ({}) }) }));
vi.mock("../services/costs.js", () => ({ costService: () => ({ createEvent: createEventMock }) }));
vi.mock("../services/internal-agent/cli-mode.js", () => ({ buildMcpConfig: buildMcpMock, buildMcpBridgeSpec: buildBridgeSpecMock }));
vi.mock("../services/heartbeat.js", () => ({ resolveAdapterExecutionContext: () => ({ executionTarget: {}, runtimeCommandSpec: {} }) }));
vi.mock("../services/internal-agent/aoa-agents/bridge-path.js", () => ({ resolveBridgeEntrypoint: () => "/x/mcp-bridge.js" }));
vi.mock("node:fs/promises", () => ({ writeFile: vi.fn().mockResolvedValue(undefined), unlink: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../middleware/logger.js", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("../services/thread-agent-actions.js", () => ({
  threadAgentActionService: () => ({
    commitThreadAgentActions: vi.fn().mockResolvedValue({ committed: 0, suppressed: 0, blocked: 0, failed: 0 }),
  }),
}));

// The crew context bundle — module-mocked. Its internals are tested separately.
vi.mock("../services/internal-agent/aoa-agents/crew-context-bundle.js", () => ({
  buildCrewContextBundle: bundleMock,
}));

import { runAoaAgent } from "../services/internal-agent/aoa-agents/runner.js";

// Thenable chain stub (mirrors aoa-runner.test.ts).
function ch(ret: unknown[]) {
  const c: any = {};
  c.values = () => c; c.set = () => c; c.where = () => c; c.from = () => c;
  c.returning = () => Promise.resolve(ret);
  c.then = (r: (v: unknown[]) => unknown) => Promise.resolve(ret).then(r);
  return c;
}

describe("runAoaAgent — context bundle wiring (Task 4.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundleMock.mockReset();
    execMock.mockClear();
    execMock.mockResolvedValue({ exitCode: 0 });
  });

  it("thread-mention run: prompt sent to the adapter CONTAINS the prior entries + a ## Context section (not just 'Thread: <id>')", async () => {
    // The bundle the runner will inject (a rendered conversation).
    bundleMock.mockResolvedValue(
      "Recent conversation:\nfounder: we need a precedent for enterprise auth\nScout: SAML 2.0 is our standard",
    );

    const db: any = {
      select: () => ch([{ id: "scout-1", companyId: "co-1", name: "Scout", adapterType: "claude_local", adapterConfig: {}, runtimeConfig: { aoa: { instruction: "## Persona\nScout.", role: "scout" } } }]),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "run-ctx" }]) }) }),
      update: () => ch([{ id: "x" }]),
    };

    await runAoaAgent(db, "scout-1", {
      companyId: "co-1",
      source: "thread.participation",
      threadId: "thread-77",
      mention: "@Scout what precedent applies?",
      effectiveAutonomy: 1,
    });

    // The bundle builder was called with the run's thread context.
    expect(bundleMock).toHaveBeenCalledTimes(1);
    const bundleArgs = bundleMock.mock.calls[0][1];
    expect(bundleArgs).toMatchObject({ companyId: "co-1", threadId: "thread-77", agentId: "scout-1" });

    // The adapter received the bundle inside its prompt.
    const execArg = execMock.mock.calls[0][0];
    const prompt = String(execArg.config.promptTemplate);
    expect(prompt).toContain("## Context");
    expect(prompt).toContain("founder: we need a precedent for enterprise auth");
    expect(prompt).toContain("Scout: SAML 2.0 is our standard");
    // The IDs-only line is still present, but it is no longer ALL the agent gets.
    expect(prompt).toContain("Thread: thread-77");
  });

  it("task run: passes issueId into the bundle builder", async () => {
    bundleMock.mockResolvedValue("Task: Build the SSO form\nUpstream deliverable:\n# Spec");

    const db: any = {
      select: () => ch([{ id: "eng-1", companyId: "co-1", name: "Engineer", adapterType: "claude_local", adapterConfig: {}, runtimeConfig: { aoa: { instruction: "## Persona\nEngineer.", role: "engineer" } } }]),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "run-task" }]) }) }),
      // checkout + getById both go through issueService — mocked below so the
      // task-claim path is satisfied without a real service.
      update: () => ch([{ id: "x" }]),
    };

    // Stub issueService so checkout()/getById() don't hit a real db. The runner
    // imports it dynamically inside the issueId branches.
    vi.doMock("../services/issues.js", () => ({
      issueService: () => ({
        checkout: vi.fn().mockResolvedValue(undefined),
        // After execute, the silent-stuck guard reads the task; return a moved
        // task (status not in_progress) so it does NOT throw.
        getById: vi.fn().mockResolvedValue({ id: "task-9", status: "done", executionRunId: null }),
      }),
    }));

    await runAoaAgent(db, "eng-1", {
      companyId: "co-1",
      source: "dispatcher.task",
      issueId: "task-9",
      effectiveAutonomy: 2,
    });

    expect(bundleMock).toHaveBeenCalledTimes(1);
    const bundleArgs = bundleMock.mock.calls[0][1];
    expect(bundleArgs).toMatchObject({ companyId: "co-1", issueId: "task-9", agentId: "eng-1" });

    const execArg = execMock.mock.calls[0][0];
    const prompt = String(execArg.config.promptTemplate);
    expect(prompt).toContain("## Context");
    expect(prompt).toContain("Build the SSO form");
  });

  it("bundle builder throwing NEVER breaks the run (best-effort; prompt still sent without ## Context)", async () => {
    bundleMock.mockRejectedValue(new Error("bundle exploded"));

    const db: any = {
      select: () => ch([{ id: "scout-1", companyId: "co-1", name: "Scout", adapterType: "claude_local", adapterConfig: {}, runtimeConfig: { aoa: { instruction: "## Persona\nScout.", role: "scout" } } }]),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "run-x" }]) }) }),
      update: () => ch([{ id: "x" }]),
    };

    const result = await runAoaAgent(db, "scout-1", {
      companyId: "co-1",
      source: "thread.participation",
      threadId: "thread-88",
      mention: "@Scout",
      effectiveAutonomy: 1,
    });

    // Run still completed (bundle failure swallowed).
    expect(result.status).not.toBe("failed");
    // Adapter still ran, prompt still sent — just no Context section.
    const execArg = execMock.mock.calls[0][0];
    const prompt = String(execArg.config.promptTemplate);
    expect(prompt).toContain("Thread: thread-88");
    expect(prompt).not.toContain("## Context");
  });
});
