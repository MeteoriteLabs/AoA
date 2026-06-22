import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";

vi.mock("drizzle-orm", () => drizzleOperatorStubs());

vi.mock("@armyofagents/db", () => ({
  agents: makeTableProxy("agents"),
  aoaAgentTriggers: makeTableProxy("aoa_agent_triggers"),
  companies: makeTableProxy("companies"),
  heartbeatRuns: makeTableProxy("heartbeat_runs"),
  internalAgentRuns: makeTableProxy("internal_agent_runs"),
}));

const mockAdapterTestEnvironment = vi.hoisted(() => vi.fn());
const mockNormalizeAdapterConfigForPersistence = vi.hoisted(() =>
  vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
);
const mockResolveAdapterConfigForRuntime = vi.hoisted(() =>
  vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
);
const mockAcquireForRun = vi.hoisted(() => vi.fn());
const mockReleaseRunLease = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  agentService: () => ({
    getById: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    resolveByReference: vi.fn(),
    update: vi.fn(),
    orgForCompany: vi.fn().mockResolvedValue([]),
    listConfigRevisions: vi.fn().mockResolvedValue([]),
    getConfigRevision: vi.fn(),
    getChainOfCommand: vi.fn().mockResolvedValue([]),
    backfillParentFields: vi.fn().mockResolvedValue(0),
    listKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeKey: vi.fn(),
    getKeyById: vi.fn(),
  }),
  agentInstructionsService: () => ({
    getBundle: vi.fn(),
    readFile: vi.fn(),
    updateBundle: vi.fn(),
    writeFile: vi.fn(),
    deleteFile: vi.fn(),
    exportFiles: vi.fn(),
    ensureManagedBundle: vi.fn(),
    materializeManagedBundle: vi.fn(),
  }),
  accessService: () => ({ canUser: vi.fn(), hasPermission: vi.fn() }),
  approvalService: () => ({}),
  companySkillService: () => ({ listRuntimeSkillEntries: vi.fn() }),
  heartbeatService: () => ({}),
  issueApprovalService: () => ({}),
  issueService: () => ({}),
  logActivity: vi.fn(),
  secretService: () => ({
    normalizeAdapterConfigForPersistence: mockNormalizeAdapterConfigForPersistence,
    resolveAdapterConfigForRuntime: mockResolveAdapterConfigForRuntime,
    syncEnvBindingsForTarget: vi.fn(),
  }),
  syncInstructionsBundleConfigFromFilePath: vi.fn(
    (_agent: unknown, config: Record<string, unknown>) => config,
  ),
}));

vi.mock("../adapters/index.js", () => ({
  findActiveServerAdapter: vi.fn(),
  findServerAdapter: vi.fn(() => ({
    type: "process",
    testEnvironment: mockAdapterTestEnvironment,
  })),
  listAdapterModels: vi.fn(),
}));

vi.mock("../services/environment-run-orchestrator.js", () => ({
  environmentRunOrchestrator: vi.fn(() => ({
    acquireForRun: mockAcquireForRun,
  })),
}));

vi.mock("../services/environment-runtime.js", () => ({
  environmentRuntimeService: vi.fn(() => ({
    releaseRunLease: mockReleaseRunLease,
  })),
}));

vi.mock("@armyofagents/adapter-claude-local/server", () => ({
  runClaudeLogin: vi.fn(),
}));

vi.mock("@armyofagents/adapter-codex-local", () => ({
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX: false,
  DEFAULT_CODEX_LOCAL_MODEL: "gpt-4.1",
}));

vi.mock("@armyofagents/adapter-cursor-local", () => ({
  DEFAULT_CURSOR_LOCAL_MODEL: "claude-sonnet-4-20250514",
}));

vi.mock("@armyofagents/adapter-opencode-local/server", () => ({
  ensureOpenCodeModelConfiguredAndAvailable: vi.fn(),
}));

import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";

const COMPANY_ID = "company-1";
const ENVIRONMENT_ID = "22222222-2222-4222-8222-222222222222";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      type: "board",
      source: "local_implicit",
      userId: "board",
      companyIds: [COMPANY_ID],
      isInstanceAdmin: true,
    } as never;
    next();
  });
  app.use("/api", agentRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("POST /companies/:companyId/adapters/:type/test-environment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapterTestEnvironment.mockResolvedValue({
      adapterType: "process",
      status: "pass",
      checks: [],
      testedAt: "2026-06-01T00:00:00.000Z",
    });
    mockAcquireForRun.mockResolvedValue({
      environment: {
        id: ENVIRONMENT_ID,
        companyId: COMPANY_ID,
        name: "E2B Cloud QA",
        driver: "sandbox",
        status: "active",
        config: { provider: "e2b" },
      },
      lease: {
        id: "lease-1",
        companyId: COMPANY_ID,
        environmentId: ENVIRONMENT_ID,
        provider: "e2b",
        providerLeaseId: "sandbox-1",
        metadata: {},
      },
      leaseContext: {},
      adapterType: "process",
      configPatch: {
        executionTarget: {
          type: "provider-sandbox",
          provider: "e2b",
          providerLeaseId: "sandbox-1",
          remoteCwd: "/home/user/aoa-workspace",
          shell: "bash",
          env: {},
          runner: { execute: vi.fn() },
        },
      },
    });
  });

  it("passes the selected environment execution target into the adapter test and releases the lease", async () => {
    const res = await request(makeApp())
      .post(`/api/companies/${COMPANY_ID}/adapters/process/test-environment`)
      .send({
        environmentId: ENVIRONMENT_ID,
        adapterConfig: { command: "pwd" },
      });

    expect(res.status).toBe(200);
    expect(mockAcquireForRun).toHaveBeenCalledWith(expect.objectContaining({
      companyId: COMPANY_ID,
      environmentId: ENVIRONMENT_ID,
      adapterType: "process",
      issueId: null,
      persistedExecutionWorkspace: null,
    }));
    expect(mockAdapterTestEnvironment).toHaveBeenCalledWith(expect.objectContaining({
      companyId: COMPANY_ID,
      adapterType: "process",
      config: { command: "pwd" },
      environmentName: "E2B Cloud QA",
      executionTarget: expect.objectContaining({
        type: "provider-sandbox",
        provider: "e2b",
        remoteCwd: "/home/user/aoa-workspace",
      }),
    }));
    expect(mockReleaseRunLease).toHaveBeenCalledWith(expect.objectContaining({
      environment: expect.objectContaining({ id: ENVIRONMENT_ID }),
      lease: expect.objectContaining({ id: "lease-1" }),
      status: "released",
    }));
  });
});
