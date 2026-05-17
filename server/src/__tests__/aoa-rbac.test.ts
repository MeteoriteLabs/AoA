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

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  create: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  terminate: vi.fn(),
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
}));

const mockHeartbeatService = vi.hoisted(() => ({
  cancelActiveForAgent: vi.fn().mockResolvedValue(undefined),
  wakeup: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  getRun: vi.fn(),
  getActiveRunForAgent: vi.fn(),
  cancelRun: vi.fn(),
  getRuntimeState: vi.fn(),
  listTaskSessions: vi.fn().mockResolvedValue([]),
  resetRuntimeSession: vi.fn(),
  listEvents: vi.fn().mockResolvedValue([]),
  readLog: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
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
  companySkillService: () => ({ listRuntimeSkillEntries: vi.fn(), resolveSkillKeys: vi.fn().mockResolvedValue([]) }),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => ({}),
  logActivity: vi.fn(),
  secretService: () => ({
    resolveAdapterConfigForRuntime: vi.fn(),
    normalizeAdapterConfigForPersistence: vi.fn(
      async (_companyId: string, config: Record<string, unknown>) => config,
    ),
    syncEnvBindingsForTarget: vi.fn().mockResolvedValue(undefined),
  }),
  syncInstructionsBundleConfigFromFilePath: vi.fn(
    (_agent: unknown, config: Record<string, unknown>) => config,
  ),
}));

vi.mock("../adapters/index.js", () => ({
  findActiveServerAdapter: vi.fn(),
  findServerAdapter: vi.fn(),
  listAdapterModels: vi.fn(),
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

// ── RBAC mock — controls assertRole behaviour per test ──────────────────────
const mockAssertRole = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../middleware/rbac.js", () => ({
  assertRole: mockAssertRole,
  assertDepartmentAccess: vi.fn().mockResolvedValue(undefined),
  assertMemoryAccess: vi.fn().mockResolvedValue(undefined),
  assertMemoryApproval: vi.fn().mockResolvedValue(undefined),
  assertEntityAccess: vi.fn().mockResolvedValue(undefined),
}));

import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";
import { forbidden } from "../errors.js";

const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const TRIGGER_ID = "22222222-2222-4222-8222-222222222222";

const founderActor = {
  type: "board" as const,
  source: "session" as const,
  userId: "founder-user",
  companyIds: [COMPANY_ID],
  isInstanceAdmin: false,
};

const memberActor = {
  type: "board" as const,
  source: "session" as const,
  userId: "member-user",
  companyIds: [COMPANY_ID],
  isInstanceAdmin: false,
};

// Chainable mock DB for insert/update chains used by trigger endpoints
function makeTriggerDb(insertResult: Record<string, unknown>, updateResult: Record<string, unknown> | null = null) {
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockReturnThis(),
        then: vi.fn((fn: (rows: unknown[]) => unknown) =>
          Promise.resolve(fn([insertResult])),
        ),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockReturnThis(),
          then: vi.fn((fn: (rows: unknown[]) => unknown) =>
            Promise.resolve(fn(updateResult ? [updateResult] : [])),
          ),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: vi.fn((fn: (rows: unknown[]) => unknown) =>
        Promise.resolve(fn([])),
      ),
    })),
  };
}

function makeApp(actor: typeof founderActor | typeof memberActor, db: unknown = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api", agentRoutes(db as never));
  app.use(errorHandler);
  return app;
}

describe("AoA RBAC — D1 (founder-gated create / disable / triggers)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── AoA create (C4): POST /companies/:companyId/agents ──────────────────────

  describe("POST /companies/:companyId/agents {kind:'aoa'}", () => {
    it("non-founder → 403", async () => {
      // Simulate assertRole throwing forbidden for a non-founder
      mockAssertRole.mockRejectedValueOnce(forbidden("Requires one of: founder"));

      const res = await request(makeApp(memberActor))
        .post(`/api/companies/${COMPANY_ID}/agents`)
        .send({ name: "AoA Commander", kind: "aoa", adapterType: "process" });

      expect(res.status).toBe(403);
      expect(mockAssertRole).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        COMPANY_ID,
        "founder",
      );
      expect(mockAgentService.create).not.toHaveBeenCalled();
    });

    it("founder → 201", async () => {
      // assertRole resolves (default) — founder passes
      mockAssertRole.mockResolvedValueOnce(undefined);

      const createdAgent = {
        id: AGENT_ID,
        companyId: COMPANY_ID,
        name: "AoA Commander",
        kind: "aoa",
        role: "general",
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
        status: "idle",
      };
      mockAgentService.create.mockResolvedValueOnce(createdAgent);
      // materializeDefaultInstructionsBundleForNewAgent returns early for "process" adapter
      // since adapterSupportsInstructionsBundle("process") is false

      const res = await request(makeApp(founderActor))
        .post(`/api/companies/${COMPANY_ID}/agents`)
        .send({ name: "AoA Commander", kind: "aoa", adapterType: "process" });

      expect(res.status).toBe(201);
      expect(mockAssertRole).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        COMPANY_ID,
        "founder",
      );
      expect(mockAgentService.create).toHaveBeenCalled();
    });
  });

  // ── AoA trigger (C1): PATCH /companies/:companyId/agents/:id/triggers/:triggerId ──

  describe("PATCH /companies/:companyId/agents/:id/triggers/:triggerId", () => {
    it("team_member → 403", async () => {
      // Simulate assertRole throwing forbidden for a non-founder
      mockAssertRole.mockRejectedValueOnce(forbidden("Requires one of: founder"));

      const res = await request(makeApp(memberActor))
        .patch(`/api/companies/${COMPANY_ID}/agents/${AGENT_ID}/triggers/${TRIGGER_ID}`)
        .send({ enabled: false });

      expect(res.status).toBe(403);
      expect(mockAssertRole).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        COMPANY_ID,
        "founder",
      );
    });

    it("founder → 200", async () => {
      mockAssertRole.mockResolvedValueOnce(undefined);

      const updatedTrigger = {
        id: TRIGGER_ID,
        companyId: COMPANY_ID,
        agentId: AGENT_ID,
        kind: "schedule",
        enabled: false,
        config: {},
        updatedAt: new Date().toISOString(),
      };
      const db = makeTriggerDb(
        { id: TRIGGER_ID },
        updatedTrigger,
      );

      const res = await request(makeApp(founderActor, db))
        .patch(`/api/companies/${COMPANY_ID}/agents/${AGENT_ID}/triggers/${TRIGGER_ID}`)
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(mockAssertRole).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        COMPANY_ID,
        "founder",
      );
    });
  });
});
