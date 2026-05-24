import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock drizzle + db package ---

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) => {
    const cols: Record<string, symbol> = {};
    return new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") {
          if (!cols[prop]) cols[prop] = Symbol(prop);
          return cols[prop];
        }
        return undefined;
      },
    });
  };

  return {
    executionWorkspaces: makeTable("execution_workspaces"),
    issues: makeTable("issues"),
    projects: makeTable("projects"),
    projectWorkspaces: makeTable("project_workspaces"),
    workspaceRuntimeServices: makeTable("workspace_runtime_services"),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _type: "and", args }),
  eq: (col: unknown, value: unknown) => ({ _type: "eq", col, value }),
}));

// --- Mock services ---

const mockSvc = vi.hoisted(() => ({
  getById: vi.fn(),
  getCloseReadiness: vi.fn(),
  loadEffectiveRuntimeServicesByExecutionWorkspace: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  listSummaries: vi.fn(),
}));

const mockWorkspaceOperationService = vi.hoisted(() => ({
  createRecorder: vi.fn(() => ({ record: vi.fn(), finalize: vi.fn() })),
}));

const mockInstanceSettings = vi.hoisted(() => ({
  getExperimental: vi.fn().mockResolvedValue({ enableIsolatedWorkspaces: true }),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

const mockStopRuntimeServices = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCleanupArtifacts = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ cleaned: true, warnings: [] }),
);

// Capture db.update(...).set(...).where(...) calls for shared-workspace detach assertion
const mockDbUpdateIssues = vi.hoisted(() => {
  const setFn = vi.fn();
  const whereFn = vi.fn();
  const update = vi.fn((_table: unknown) => ({
    set: (patch: unknown) => {
      setFn(patch);
      return { where: whereFn };
    },
  }));
  return { update, setFn, whereFn };
});

vi.mock("../services/index.js", () => ({
  executionWorkspaceService: () => mockSvc,
  instanceSettingsService: () => mockInstanceSettings,
  workspaceOperationService: () => mockWorkspaceOperationService,
  logActivity: mockLogActivity,
}));

vi.mock("../services/workspace-runtime.js", () => ({
  buildWorkspaceRuntimeDesiredStatePatch: vi.fn().mockReturnValue({ desiredState: "stopped", serviceStates: null }),
  stopRuntimeServicesForExecutionWorkspace: mockStopRuntimeServices,
  ensurePersistedExecutionWorkspaceAvailable: vi.fn(),
  listConfiguredRuntimeServiceEntries: vi.fn().mockReturnValue([]),
  refreshPersistedRuntimeServiceRows: vi.fn(({ rows }) => rows),
  resolveConfiguredRuntimeServiceIndexForRow: vi.fn().mockReturnValue(null),
  startRuntimeServicesForWorkspaceControl: vi.fn(),
  cleanupExecutionWorkspaceArtifacts: mockCleanupArtifacts,
}));

vi.mock("../services/execution-workspace-policy.js", () => ({
  parseProjectExecutionWorkspacePolicy: vi.fn().mockReturnValue(null),
}));

vi.mock("../services/workspace-authz.js", () => ({
  assertCanConfigureWorkspaceShellCommands: vi.fn().mockResolvedValue(undefined),
  assertCanControlWorkspace: vi.fn().mockResolvedValue(undefined),
  workspaceConfigPatchHasShellCommands: vi.fn().mockReturnValue(false),
}));

import { executionWorkspaceRoutes } from "../routes/execution-workspaces.js";

function buildExistingWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    companyId: "co-1",
    projectId: "proj-1",
    projectWorkspaceId: null,
    sourceIssueId: null,
    mode: "isolated_workspace",
    strategyType: "git_worktree",
    name: "feature-x",
    status: "active",
    cwd: null,
    repoUrl: null,
    baseRef: null,
    branchName: null,
    providerType: "adapter_managed",
    providerRef: null,
    derivedFromExecutionWorkspaceId: null,
    lastUsedAt: new Date(),
    openedAt: new Date(),
    closedAt: null,
    cleanupEligibleAt: null,
    cleanupReason: null,
    config: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildReadiness(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "ws-1",
    state: "ready",
    blockingReasons: [],
    warnings: [],
    linkedIssues: [],
    plannedActions: [],
    isDestructiveCloseAllowed: true,
    isSharedWorkspace: false,
    isProjectPrimaryWorkspace: false,
    git: null,
    runtimeServices: [],
    ...overrides,
  };
}

function createApp() {
  const db = {
    update: mockDbUpdateIssues.update,
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(resolve([]));
      return chain;
    }),
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: true,
      companyIds: ["co-1"],
    };
    next();
  });
  app.use("/api", executionWorkspaceRoutes(db as any));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
  return app;
}

describe("PATCH /api/execution-workspaces/:id — archive flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstanceSettings.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: true });
    mockSvc.loadEffectiveRuntimeServicesByExecutionWorkspace.mockResolvedValue([]);
    mockStopRuntimeServices.mockResolvedValue(undefined);
    mockCleanupArtifacts.mockResolvedValue({ cleaned: true, warnings: [] });
  });

  it("returns 409 with blockingReasons when readiness.state === 'blocked'", async () => {
    const existing = buildExistingWorkspace({ mode: "isolated_workspace" });
    mockSvc.getById.mockResolvedValue(existing);
    mockSvc.getCloseReadiness.mockResolvedValue(
      buildReadiness({
        state: "blocked",
        blockingReasons: ["This workspace is still linked to an open task."],
      }),
    );

    const res = await request(createApp())
      .patch(`/api/execution-workspaces/ws-1`)
      .send({ status: "archived" });

    expect(res.status).toBe(409);
    expect(res.body.blockingReasons).toEqual([
      "This workspace is still linked to an open task.",
    ]);
    expect(res.body.error).toBe("This workspace is still linked to an open task.");
    expect(mockSvc.update).not.toHaveBeenCalled();
  });

  it("detaches linked issues before cleanup when workspace is shared_workspace", async () => {
    const existing = buildExistingWorkspace({ mode: "shared_workspace" });
    mockSvc.getById.mockResolvedValue(existing);
    mockSvc.getCloseReadiness.mockResolvedValue(
      buildReadiness({ state: "ready_with_warnings", isSharedWorkspace: true }),
    );
    mockSvc.update.mockResolvedValue({ ...existing, status: "archived" });

    const res = await request(createApp())
      .patch(`/api/execution-workspaces/ws-1`)
      .send({ status: "archived" });

    expect(res.status).toBe(200);
    // issues.executionWorkspaceId nulled
    expect(mockDbUpdateIssues.setFn).toHaveBeenCalledWith({ executionWorkspaceId: null });
    expect(mockDbUpdateIssues.whereFn).toHaveBeenCalled();
    // archive still proceeds
    expect(mockSvc.update).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ status: "archived" }),
    );
  });

  it("does not detach linked issues for isolated_workspace archives", async () => {
    const existing = buildExistingWorkspace({ mode: "isolated_workspace" });
    mockSvc.getById.mockResolvedValue(existing);
    mockSvc.getCloseReadiness.mockResolvedValue(buildReadiness());
    mockSvc.update.mockResolvedValue({ ...existing, status: "archived" });

    const res = await request(createApp())
      .patch(`/api/execution-workspaces/ws-1`)
      .send({ status: "archived" });

    expect(res.status).toBe(200);
    // issues update NOT called
    expect(mockDbUpdateIssues.setFn).not.toHaveBeenCalled();
    expect(mockSvc.update).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ status: "archived" }),
    );
  });

  it("proceeds with archive when readiness.state is 'ready'", async () => {
    const existing = buildExistingWorkspace();
    mockSvc.getById.mockResolvedValue(existing);
    mockSvc.getCloseReadiness.mockResolvedValue(buildReadiness({ state: "ready" }));
    mockSvc.update.mockResolvedValue({ ...existing, status: "archived" });

    const res = await request(createApp())
      .patch(`/api/execution-workspaces/ws-1`)
      .send({ status: "archived" });

    expect(res.status).toBe(200);
    expect(mockStopRuntimeServices).toHaveBeenCalled();
    expect(mockCleanupArtifacts).toHaveBeenCalled();
  });

  it("proceeds with archive when readiness.state is 'ready_with_warnings'", async () => {
    const existing = buildExistingWorkspace();
    mockSvc.getById.mockResolvedValue(existing);
    mockSvc.getCloseReadiness.mockResolvedValue(
      buildReadiness({ state: "ready_with_warnings", warnings: ["dirty files"] }),
    );
    mockSvc.update.mockResolvedValue({ ...existing, status: "archived" });

    const res = await request(createApp())
      .patch(`/api/execution-workspaces/ws-1`)
      .send({ status: "archived" });

    expect(res.status).toBe(200);
  });

  it("passes non-archive patches straight through without readiness check", async () => {
    const existing = buildExistingWorkspace();
    mockSvc.getById.mockResolvedValue(existing);
    mockSvc.update.mockResolvedValue({ ...existing, status: "idle" });

    const res = await request(createApp())
      .patch(`/api/execution-workspaces/ws-1`)
      .send({ status: "idle" });

    expect(res.status).toBe(200);
    expect(mockSvc.getCloseReadiness).not.toHaveBeenCalled();
    expect(mockSvc.update).toHaveBeenCalled();
  });

  it("passes through archive update when workspace already archived (no-op on readiness)", async () => {
    const existing = buildExistingWorkspace({ status: "archived" });
    mockSvc.getById.mockResolvedValue(existing);
    mockSvc.update.mockResolvedValue(existing);

    const res = await request(createApp())
      .patch(`/api/execution-workspaces/ws-1`)
      .send({ status: "archived" });

    expect(res.status).toBe(200);
    // readiness check is skipped for already-archived workspaces
    expect(mockSvc.getCloseReadiness).not.toHaveBeenCalled();
  });

  it("preserves existing metadata.config when PATCH body has metadata without config key", async () => {
    const existing = buildExistingWorkspace({
      metadata: {
        config: { provisionCommand: "pnpm install" },
        other: "original",
      },
    });
    mockSvc.getById.mockResolvedValue(existing);
    mockSvc.update.mockResolvedValue({ ...existing, status: "idle" });

    const res = await request(createApp())
      .patch(`/api/execution-workspaces/ws-1`)
      .send({ metadata: { other: "updated" } });

    expect(res.status).toBe(200);
    expect(mockSvc.update).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          config: { provisionCommand: "pnpm install" },
          other: "updated",
        }),
      }),
    );
  });
});

describe("POST /api/execution-workspaces/:id/runtime-services/stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstanceSettings.getExperimental.mockResolvedValue({ enableIsolatedWorkspaces: true });
    mockStopRuntimeServices.mockResolvedValue(undefined);
  });

  it("accepts a persisted effective runtime service id instead of relying on getById embedding services", async () => {
    const existing = buildExistingWorkspace({
      cwd: "C:/tmp/ws-1",
      config: { workspaceRuntime: { services: [{ name: "web", command: "pnpm dev" }] } },
      metadata: { config: { workspaceRuntime: { services: [{ name: "web", command: "pnpm dev" }] } } },
    });
    const runtimeServiceId = "00000000-0000-4000-8000-000000000001";
    const service = {
      id: runtimeServiceId,
      companyId: "co-1",
      projectId: "proj-1",
      projectWorkspaceId: null,
      executionWorkspaceId: "ws-1",
      issueId: null,
      scopeType: "execution_workspace",
      scopeId: "ws-1",
      serviceName: "web",
      status: "running",
      lifecycle: "shared",
      reuseKey: null,
      command: "pnpm dev",
      cwd: "C:/tmp/ws-1",
      port: 3200,
      url: "http://127.0.0.1:3200",
      provider: "local_process",
      providerRef: "12345",
      ownerAgentId: null,
      startedByRunId: null,
      lastUsedAt: new Date(),
      startedAt: new Date(),
      stoppedAt: null,
      stopPolicy: null,
      healthStatus: "healthy",
      healthCheckedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockSvc.getById.mockResolvedValue(existing);
    mockSvc.loadEffectiveRuntimeServicesByExecutionWorkspace.mockResolvedValue([service]);
    mockSvc.update.mockResolvedValue(existing);

    const res = await request(createApp())
      .post(`/api/execution-workspaces/ws-1/runtime-services/stop`)
      .send({ runtimeServiceId });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockStopRuntimeServices).toHaveBeenCalledWith(expect.objectContaining({
      executionWorkspaceId: "ws-1",
      runtimeServiceId,
    }));
  });
});
