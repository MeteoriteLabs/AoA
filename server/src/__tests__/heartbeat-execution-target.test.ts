import { describe, expect, it, vi } from "vitest";

vi.mock("@armyofagents/db", () => {
  const makeTable = () =>
    new Proxy({}, { get: (_target, prop) => (prop === "$inferSelect" || prop === "$inferInsert" ? {} : Symbol(String(prop))) });
  return {
    agents: makeTable(),
    agentRuntimeState: makeTable(),
    agentTaskSessions: makeTable(),
    agentWakeupRequests: makeTable(),
    heartbeatRunEvents: makeTable(),
    heartbeatRuns: makeTable(),
    costEvents: makeTable(),
    environments: makeTable(),
    issues: makeTable(),
    projectWorkspaces: makeTable(),
    memoryItems: makeTable(),
    companies: makeTable(),
    taskDependencies: makeTable(),
    issueAttachments: makeTable(),
    issueComments: makeTable(),
    assets: makeTable(),
    projects: makeTable(),
    companySkills: makeTable(),
    teamMembers: makeTable(),
    teamCoordinations: makeTable(),
    teams: makeTable(),
    // Required by services/embeddings.ts (B1: createEmbeddingService target map)
    discussions: makeTable(),
    discussionExtractedItems: makeTable(),
    embeddingQueue: makeTable(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  asc: (..._args: unknown[]) => "asc",
  desc: (..._args: unknown[]) => "desc",
  eq: (..._args: unknown[]) => "eq",
  gt: (..._args: unknown[]) => "gt",
  inArray: (..._args: unknown[]) => "inArray",
  lte: (..._args: unknown[]) => "lte",
  ne: (..._args: unknown[]) => "ne",
  or: (..._args: unknown[]) => "or",
  sql: new Proxy(() => ({ as: () => "sql" }), {
    get: () => () => ({ as: () => "sql" }),
    apply: () => ({ as: () => "sql" }),
  }),
}));

vi.mock("../services/live-events.js", () => ({ publishLiveEvent: vi.fn() }));
vi.mock("../services/run-log-store.js", () => ({ getRunLogStore: vi.fn() }));
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));
vi.mock("../adapters/index.js", () => ({ getServerAdapter: vi.fn(), runningProcesses: new Map() }));
vi.mock("../agent-auth-jwt.js", () => ({ createLocalAgentJwt: vi.fn() }));
vi.mock("../adapters/api-common.js", () => ({ setSecretResolver: vi.fn() }));
vi.mock("../services/secrets.js", () => ({ secretService: vi.fn(() => ({})) }));
vi.mock("../services/output-detection.js", () => ({ outputDetectionService: vi.fn(() => ({})) }));
vi.mock("../services/run-summary.js", () => ({ formatRunSummary: vi.fn() }));
vi.mock("../services/environment-run-orchestrator.js", () => ({
  environmentRunOrchestrator: vi.fn(() => ({
    acquireForRun: vi.fn(),
  })),
}));
vi.mock("../middleware/logger.js", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  applyEnvironmentAcquisitionConfig,
  applyEnvironmentRuntimeTarget,
  mergeAdapterRuntimeServiceReports,
  resolveOutputDetectionCwd,
  resolveAdapterExecutionContext,
  resolveAdapterManagedRuntimeExecutionWorkspaceId,
} from "../services/heartbeat.js";

describe("heartbeat adapter execution target context", () => {
  it("defaults missing adapter config target to local context", () => {
    const result = resolveAdapterExecutionContext({}, { getRuntimeCommandSpec: vi.fn(() => null) });

    expect(result).toEqual({
      executionTarget: { type: "local" },
      runtimeCommandSpec: null,
    });
  });

  it("passes sandbox-docker config and runtime command spec through", () => {
    const getRuntimeCommandSpec = vi.fn(() => ({
      command: "codex",
      detectCommand: "command -v codex",
      installCommand: "npm install -g @openai/codex",
    }));

    const result = resolveAdapterExecutionContext(
      {
        executionTarget: {
          type: "sandbox-docker",
          image: "node:22",
          workdir: "/workspace/app",
          shell: "bash",
          network: "none",
          env: { NODE_ENV: "test", IGNORED: 1 },
        },
      },
      { getRuntimeCommandSpec },
    );

    expect(result).toEqual({
      executionTarget: {
        type: "sandbox-docker",
        image: "node:22",
        workdir: "/workspace/app",
        shell: "bash",
        network: "none",
        remove: true,
        env: { NODE_ENV: "test" },
        installCommand: null,
      },
      runtimeCommandSpec: {
        command: "codex",
        detectCommand: "command -v codex",
        installCommand: "npm install -g @openai/codex",
      },
    });
    expect(getRuntimeCommandSpec).toHaveBeenCalledWith(expect.objectContaining({
      executionTarget: expect.objectContaining({ image: "node:22" }),
    }));
  });

  it("throws before adapter execution context can be built for invalid targets", () => {
    const execute = vi.fn();
    const adapter = { execute, getRuntimeCommandSpec: vi.fn() };

    expect(() =>
      resolveAdapterExecutionContext(
        { executionTarget: { type: "sandbox-docker" } },
        adapter,
      ),
    ).toThrow('executionTarget.image is required for target "sandbox-docker"');
    expect(execute).not.toHaveBeenCalled();
  });

  it("applies an environment target over adapter config target", () => {
    const result = applyEnvironmentRuntimeTarget(
      {
        executionTarget: { type: "sandbox-docker", image: "node:20-bookworm" },
        env: { AGENT_ONLY: "1" },
      },
      { target: { type: "local" } },
    );

    expect(result.executionTarget).toEqual({ type: "local" });
    expect(result.env).toEqual({ AGENT_ONLY: "1" });
  });

  it("preserves adapter config target when environment target is absent", () => {
    const config = {
      executionTarget: { type: "sandbox-docker", image: "node:20-bookworm" },
      env: { AGENT_ONLY: "1" },
    };

    expect(applyEnvironmentRuntimeTarget(config, { target: null })).toBe(config);
  });

  it("applies acquired environment config patch over existing adapter config", () => {
    const result = applyEnvironmentAcquisitionConfig(
      {
        executionTarget: { type: "sandbox-docker", image: "node:20-bookworm" },
        env: { AGENT_ONLY: "1" },
      },
      {
        configPatch: {
          executionTarget: { type: "local" },
        },
      },
    );

    expect(result).toEqual({
      executionTarget: { type: "local" },
      env: { AGENT_ONLY: "1" },
    });
  });

  it("uses the persisted execution workspace id for adapter-managed runtime services", () => {
    expect(
      resolveAdapterManagedRuntimeExecutionWorkspaceId({
        persistedExecutionWorkspace: { id: "execution-workspace-live" },
        issue: { executionWorkspaceId: "execution-workspace-from-issue" },
      }),
    ).toBe("execution-workspace-live");

    expect(
      resolveAdapterManagedRuntimeExecutionWorkspaceId({
        persistedExecutionWorkspace: null,
        issue: { executionWorkspaceId: "execution-workspace-from-issue" },
      }),
    ).toBe("execution-workspace-from-issue");
  });

  it("preserves adapter-provided runtime service metadata when detection sees the same URL", () => {
    const reports = mergeAdapterRuntimeServiceReports({
      adapterReports: [
        {
          serviceName: "localhost:5173",
          scopeType: "execution_workspace",
          url: "http://127.0.0.1:5173",
          command: "pnpm dev",
          stopPolicy: "manual",
        },
      ],
      detectedReports: [
        {
          serviceName: "localhost:5173",
          scopeType: "execution_workspace",
          url: "http://127.0.0.1:5173/",
          command: null,
        },
      ],
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      url: "http://127.0.0.1:5173",
      command: "pnpm dev",
      stopPolicy: "manual",
    });
  });

  it("prefers adapter execution cwd for output detection", () => {
    expect(
      resolveOutputDetectionCwd({
        adapterExecutionCwd: "C:/repo/actual",
        effectiveCwd: "C:/aoa/fallback",
      }),
    ).toBe("C:/repo/actual");
  });

  it("falls back to effective cwd when adapter execution cwd is missing", () => {
    expect(
      resolveOutputDetectionCwd({
        adapterExecutionCwd: null,
        effectiveCwd: "C:/aoa/fallback",
      }),
    ).toBe("C:/aoa/fallback");
  });
});
