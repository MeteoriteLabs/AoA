import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@paperclipai/db", () => {
  const makeTable = () =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "$inferSelect" || prop === "$inferInsert") return {};
          return Symbol(String(prop));
        },
      },
    );

  return {
    issues: makeTable(),
    userRoles: makeTable(),
    projectGoals: makeTable(),
    agentProjects: makeTable(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  eq: (..._args: unknown[]) => "eq",
  inArray: (..._args: unknown[]) => "inArray",
}));

vi.mock("../services/index.js", () => {
  const noopFactory = () => ({});
  return {
    agentService: noopFactory,
    artifactService: noopFactory,
    companyService: noopFactory,
    debriefService: noopFactory,
    extractionService: noopFactory,
    goalService: noopFactory,
    issueService: noopFactory,
    memoryService: noopFactory,
    mcpService: noopFactory,
    permissionService: noopFactory,
    projectService: noopFactory,
    logActivity: vi.fn().mockResolvedValue(undefined),
  };
});

import { mcpServerRoutes } from "../mcp/server.js";

function buildApp(options?: {
  actor?: Record<string, unknown>;
  resolveScope?: (companyId: string, userId: string) => Promise<any>;
  issues?: any[];
  memoryItem?: Record<string, unknown> | null;
  permissionsSvc?: {
    canAccessEntity?: ReturnType<typeof vi.fn>;
    canAccessMemory?: ReturnType<typeof vi.fn>;
  };
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor =
      options?.actor ??
      ({
        type: "mcp",
        source: "mcp_key",
        userId: "user-1",
        companyId: "company-1",
        keyId: "key-1",
      } as const);
    next();
  });

  const debriefCreate = vi.fn().mockResolvedValue({ id: "debrief-1", title: "Inbound" });
  const extractFromDebrief = vi.fn().mockResolvedValue(undefined);
  const memoryCreate = vi.fn().mockImplementation(async (_companyId, data) => ({
    id: "memory-1",
    status: data.status,
    title: data.title,
    source: data.source,
  }));
  const issueUpdate = vi.fn().mockImplementation(async (_id, patch) => ({
    id: "task-1",
    companyId: "company-1",
    projectId: "project-1",
    assigneeUserId: "user-1",
    status: patch.status,
  }));
  const permissionsSvc = {
    canAccessEntity: options?.permissionsSvc?.canAccessEntity ?? vi.fn().mockResolvedValue(true),
    canAccessMemory: options?.permissionsSvc?.canAccessMemory ?? vi.fn().mockResolvedValue(true),
  };

  app.use(
    "/api",
    mcpServerRoutes({} as any, {
      companiesSvc: {
        getById: vi.fn().mockResolvedValue({
          id: "company-1",
          mcpEnabled: true,
        }),
        update: vi.fn(),
      } as any,
      mcpSvc: {
        touchClient: vi.fn().mockResolvedValue(null),
        getStatus: vi.fn(),
        listKeys: vi.fn(),
        createKey: vi.fn(),
        requireOwnedKey: vi.fn(),
        revokeKey: vi.fn(),
        listClients: vi.fn(),
      } as any,
      resolveScope:
        options?.resolveScope ??
        (async (_companyId, userId) => ({ kind: "founder", userId })),
      issuesSvc: {
        list: vi.fn().mockResolvedValue(options?.issues ?? []),
        getById: vi.fn().mockResolvedValue(
          (options?.issues ?? []).find((issue) => issue.id === "task-1") ?? null,
        ),
        update: issueUpdate,
      } as any,
      goalsSvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
      } as any,
      memorySvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(options?.memoryItem ?? null),
        create: memoryCreate,
      } as any,
      artifactsSvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        addVersion: vi.fn(),
      } as any,
      debriefsSvc: {
        create: debriefCreate,
      } as any,
      extractionSvc: {
        extractFromDebrief,
      } as any,
      permissionsSvc: permissionsSvc as any,
    }),
  );

  return {
    app,
    debriefCreate,
    extractFromDebrief,
    memoryCreate,
    issueUpdate,
    permissionsSvc,
  };
}

describe("mcp server routes", () => {
  it("rejects unauthenticated MCP requests", async () => {
    const { app } = buildApp({
      actor: { type: "none", source: "none" },
    });

    const res = await request(app)
      .post("/api/companies/company-1/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Unauthorized");
  });

  it("filters task resources by scoped project access", async () => {
    const { app } = buildApp({
      resolveScope: async (_companyId, userId) => ({
        kind: "scoped",
        userId,
        projectIds: new Set(["project-1"]),
      }),
      issues: [
        { id: "task-1", companyId: "company-1", projectId: "project-1", title: "Visible task" },
        { id: "task-2", companyId: "company-1", projectId: "project-2", title: "Hidden task" },
      ],
    });

    const res = await request(app)
      .post("/api/companies/company-1/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "aoa://tasks" } });

    expect(res.status).toBe(200);
    const payload = JSON.parse(res.body.result.contents[0].text);
    expect(payload).toEqual([
      expect.objectContaining({ id: "task-1", title: "Visible task" }),
    ]);
  });

  it("does not expose pending memory items", async () => {
    const { app } = buildApp({
      memoryItem: {
        id: "memory-1",
        companyId: "company-1",
        status: "pending",
      },
    });

    const res = await request(app)
      .post("/api/companies/company-1/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "aoa://memory/memory-1" } });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("Memory item not found");
  });

  it("routes debrief-push into the debrief pipeline", async () => {
    const { app, debriefCreate, extractFromDebrief } = buildApp();

    const res = await request(app)
      .post("/api/companies/company-1/mcp")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "debrief-push",
          arguments: {
            content: "Summarize this planning session",
            title: "Planning notes",
          },
        },
      });

    expect(res.status).toBe(200);
    expect(debriefCreate).toHaveBeenCalled();
    expect(extractFromDebrief).toHaveBeenCalledWith("company-1", "debrief-1");
    expect(JSON.parse(res.body.result.content[0].text)).toEqual({
      debriefId: "debrief-1",
      status: "processing",
    });
  });

  it("creates pending memory suggestions instead of approved memory", async () => {
    const { app, memoryCreate } = buildApp();

    const res = await request(app)
      .post("/api/companies/company-1/mcp")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "suggest-memory",
          arguments: {
            title: "Style guide",
            content: "Use concise release notes",
            category: "reference",
          },
        },
      });

    expect(res.status).toBe(200);
    expect(memoryCreate).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        title: "Style guide",
        source: "mcp",
        status: "pending",
      }),
    );
    expect(JSON.parse(res.body.result.content[0].text)).toEqual({
      id: "memory-1",
      status: "pending",
    });
  });

  it("rejects task status updates when RBAC denies write access", async () => {
    const { app, issueUpdate } = buildApp({
      resolveScope: async (_companyId, userId) => ({
        kind: "scoped",
        userId,
        projectIds: new Set(["project-1"]),
      }),
      issues: [
        {
          id: "task-1",
          companyId: "company-1",
          projectId: "project-1",
          assigneeUserId: "someone-else",
          title: "Restricted task",
        },
      ],
      permissionsSvc: {
        canAccessEntity: vi.fn().mockResolvedValue(false),
      },
    });

    const res = await request(app)
      .post("/api/companies/company-1/mcp")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "update-task-status",
          arguments: {
            taskId: "task-1",
            status: "done",
          },
        },
      });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Insufficient permissions for task update");
    expect(issueUpdate).not.toHaveBeenCalled();
  });

  it("rejects memory suggestions targeting an out-of-scope department", async () => {
    const { app, memoryCreate } = buildApp({
      resolveScope: async (_companyId, userId) => ({
        kind: "scoped",
        userId,
        projectIds: new Set(["project-1"]),
      }),
    });

    const res = await request(app)
      .post("/api/companies/company-1/mcp")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "suggest-memory",
          arguments: {
            title: "Scoped note",
            content: "Only for another department",
            category: "reference",
            departmentId: "00000000-0000-0000-0000-000000000002",
          },
        },
      });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("Department is outside your scope");
    expect(memoryCreate).not.toHaveBeenCalled();
  });
});
