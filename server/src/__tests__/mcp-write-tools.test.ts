import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@armyofagents/db", () => {
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
    approvalService: noopFactory,
    issueApprovalService: noopFactory,
    logActivity: vi.fn().mockResolvedValue(undefined),
  };
});

import { mcpServerRoutes } from "../mcp/server.js";

type Project = { id: string; companyId: string; type: "department" | "project"; name?: string };
type Task = {
  id: string;
  companyId: string;
  projectId: string | null;
  title?: string;
  status?: string;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
};
type Comment = { id: string; companyId: string; issueId: string; body: string };

function buildApp(options?: {
  actor?: Record<string, unknown>;
  resolveScope?: (
    companyId: string,
    actor: { source: string; userId: string },
  ) => Promise<any>;
  resolveRole?: (companyId: string, userId: string) => Promise<string>;
  projects?: Project[];
  tasks?: Task[];
  canAccessEntity?: (
    companyId: string,
    userId: string,
    entityType: string,
    action: string,
    context?: any,
  ) => Promise<boolean>;
  createImpl?: (companyId: string, data: any) => Promise<any>;
  updateImpl?: (id: string, data: any) => Promise<any>;
  addCommentImpl?: (
    issueId: string,
    body: string,
    actor: { agentId?: string; userId?: string },
  ) => Promise<any>;
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

  const projectList = options?.projects ?? [];
  const taskList = options?.tasks ?? [];

  const createImpl =
    options?.createImpl ??
    (async (companyId: string, data: any) => ({
      id: "new-task-id",
      companyId,
      projectId: data.projectId ?? null,
      title: data.title,
      description: data.description ?? null,
      status: data.status ?? "backlog",
      priority: data.priority ?? "medium",
    }));

  const updateImpl =
    options?.updateImpl ??
    (async (id: string, data: any) => {
      const existing = taskList.find((t) => t.id === id);
      if (!existing) return null;
      return { ...existing, ...data };
    });

  const addCommentImpl =
    options?.addCommentImpl ??
    (async (issueId: string, body: string, _actor) => ({
      id: "new-comment-id",
      companyId: taskList.find((t) => t.id === issueId)?.companyId ?? "company-1",
      issueId,
      body,
    }));

  app.use(
    "/api",
    mcpServerRoutes({} as any, {
      companiesSvc: {
        getById: vi.fn().mockResolvedValue({ id: "company-1", mcpEnabled: true }),
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
        (async (_companyId, actor) => ({ kind: "founder", userId: actor.userId })),
      resolveRole: options?.resolveRole ?? (async () => "founder"),
      resolveScopedAgentIds: async () => null,
      issuesSvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi
          .fn()
          .mockImplementation(async (id: string) => taskList.find((t) => t.id === id) ?? null),
        create: vi.fn().mockImplementation(createImpl),
        update: vi.fn().mockImplementation(updateImpl),
        addComment: vi.fn().mockImplementation(addCommentImpl),
        listComments: vi.fn().mockResolvedValue([]),
        getComment: vi.fn().mockResolvedValue(null),
      } as any,
      goalsSvc: { list: vi.fn().mockResolvedValue([]), getById: vi.fn().mockResolvedValue(null) } as any,
      memorySvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      } as any,
      artifactsSvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        addVersion: vi.fn(),
      } as any,
      debriefsSvc: { create: vi.fn() } as any,
      extractionSvc: { extractFromDebrief: vi.fn() } as any,
      permissionsSvc: {
        canAccessEntity:
          options?.canAccessEntity ??
          vi.fn().mockResolvedValue(true),
        canAccessMemory: vi.fn().mockResolvedValue(true),
      } as any,
      agentsSvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
      } as any,
      projectsSvc: {
        list: vi.fn().mockResolvedValue(projectList),
        getById: vi
          .fn()
          .mockImplementation(async (id: string) => projectList.find((p) => p.id === id) ?? null),
      } as any,
    }),
  );

  return { app };
}

async function callTool(
  app: express.Express,
  name: string,
  args: Record<string, unknown> = {},
) {
  return request(app)
    .post("/api/companies/company-1/mcp")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
}

describe("MCP write tools", () => {
  describe("tools/list exposes the new write tools", () => {
    it("lists create-task, update-task, and add-task-comment", async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post("/api/companies/company-1/mcp")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
      expect(res.status).toBe(200);
      const names = res.body.result.tools.map((t: any) => t.name);
      expect(names).toEqual(
        expect.arrayContaining(["create-task", "update-task", "add-task-comment"]),
      );
    });
  });

  describe("create-task", () => {
    it("founder can create a task directly", async () => {
      const { app } = buildApp({
        projects: [{ id: "proj-1", companyId: "company-1", type: "department" }],
      });
      const res = await callTool(app, "create-task", {
        title: "Fix login bug",
        projectId: "proj-1",
        description: "Investigate 401 errors",
      });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload.id).toBeTruthy();
      expect(payload.title).toBe("Fix login bug");
    });

    it("does NOT route through Discussion pipeline (Decision #14 revised)", async () => {
      const debriefCreate = vi.fn().mockResolvedValue({ id: "debrief-1" });
      const extractFromDebrief = vi.fn().mockResolvedValue(undefined);
      const issueCreate = vi.fn().mockResolvedValue({
        id: "new-task-id",
        title: "Direct",
        projectId: null,
        companyId: "company-1",
      });

      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as any).actor = {
          type: "mcp",
          source: "mcp_key",
          userId: "user-1",
          companyId: "company-1",
          keyId: "key-1",
        };
        next();
      });
      app.use(
        "/api",
        mcpServerRoutes({} as any, {
          companiesSvc: {
            getById: vi.fn().mockResolvedValue({ id: "company-1", mcpEnabled: true }),
          } as any,
          mcpSvc: { touchClient: vi.fn().mockResolvedValue(null) } as any,
          resolveScope: async (_c, actor) => ({ kind: "founder", userId: actor.userId }),
          resolveRole: async () => "founder",
          resolveScopedAgentIds: async () => null,
          issuesSvc: {
            list: vi.fn().mockResolvedValue([]),
            getById: vi.fn().mockResolvedValue(null),
            create: issueCreate,
            update: vi.fn(),
            addComment: vi.fn(),
            listComments: vi.fn().mockResolvedValue([]),
            getComment: vi.fn().mockResolvedValue(null),
          } as any,
          goalsSvc: { list: vi.fn().mockResolvedValue([]), getById: vi.fn() } as any,
          memorySvc: { list: vi.fn(), getById: vi.fn(), create: vi.fn() } as any,
          artifactsSvc: { list: vi.fn(), getById: vi.fn(), addVersion: vi.fn() } as any,
          debriefsSvc: { create: debriefCreate } as any,
          extractionSvc: { extractFromDebrief } as any,
          permissionsSvc: {
            canAccessEntity: vi.fn().mockResolvedValue(true),
            canAccessMemory: vi.fn().mockResolvedValue(true),
          } as any,
          agentsSvc: { list: vi.fn(), getById: vi.fn() } as any,
          projectsSvc: { list: vi.fn(), getById: vi.fn().mockResolvedValue(null) } as any,
        }),
      );
      const res = await callTool(app, "create-task", { title: "Direct" });
      expect(res.status).toBe(200);
      expect(issueCreate).toHaveBeenCalledTimes(1);
      expect(debriefCreate).not.toHaveBeenCalled();
      expect(extractFromDebrief).not.toHaveBeenCalled();
    });

    it("team_lead can create a task in their department", async () => {
      const { app } = buildApp({
        resolveScope: async (_c, actor) => ({
          kind: "scoped",
          userId: actor.userId,
          projectIds: new Set(["proj-lead"]),
        }),
        resolveRole: async () => "team_lead",
        projects: [{ id: "proj-lead", companyId: "company-1", type: "department" }],
      });
      const res = await callTool(app, "create-task", {
        title: "PM task",
        projectId: "proj-lead",
      });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload.id).toBeTruthy();
    });

    it("team_member cannot create in a project outside their scope", async () => {
      const { app } = buildApp({
        resolveScope: async (_c, actor) => ({
          kind: "scoped",
          userId: actor.userId,
          projectIds: new Set(["proj-mine"]),
        }),
        resolveRole: async () => "team_member",
        projects: [
          { id: "proj-mine", companyId: "company-1", type: "project" },
          { id: "proj-other", companyId: "company-1", type: "project" },
        ],
      });
      const res = await callTool(app, "create-task", {
        title: "Forbidden",
        projectId: "proj-other",
      });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/scope|forbidden|permission/i);
    });

    it("rejects creation against a project in another company (404)", async () => {
      const { app } = buildApp({
        projects: [{ id: "proj-other-co", companyId: "other-company", type: "project" }],
      });
      const res = await callTool(app, "create-task", {
        title: "Cross-tenant",
        projectId: "proj-other-co",
      });
      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/not found/i);
    });

    it("returns 403 when role cannot create tasks (canAccessEntity=false)", async () => {
      const { app } = buildApp({
        resolveScope: async (_c, actor) => ({
          kind: "scoped",
          userId: actor.userId,
          projectIds: new Set(["proj-1"]),
        }),
        resolveRole: async () => "team_member",
        projects: [{ id: "proj-1", companyId: "company-1", type: "department" }],
        canAccessEntity: vi.fn().mockResolvedValue(false),
      });
      const res = await callTool(app, "create-task", {
        title: "Blocked by role",
        projectId: "proj-1",
      });
      expect(res.status).toBe(403);
    });
  });

  describe("update-task", () => {
    it("founder can update title, status, priority", async () => {
      const { app } = buildApp({
        tasks: [
          {
            id: "t-1",
            companyId: "company-1",
            projectId: "proj-1",
            title: "Old",
            status: "todo",
          },
        ],
      });
      const res = await callTool(app, "update-task", {
        taskId: "t-1",
        title: "Updated title",
        status: "in_progress",
        priority: "high",
      });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload.title).toBe("Updated title");
      expect(payload.status).toBe("in_progress");
    });

    it("rejects cross-company update (404)", async () => {
      const { app } = buildApp({
        tasks: [{ id: "t-x", companyId: "other-company", projectId: "proj-x" }],
      });
      const res = await callTool(app, "update-task", {
        taskId: "t-x",
        status: "done",
      });
      expect(res.status).toBe(404);
    });

    it("scoped user cannot update task outside their scope (404)", async () => {
      const { app } = buildApp({
        resolveScope: async (_c, actor) => ({
          kind: "scoped",
          userId: actor.userId,
          projectIds: new Set(["proj-mine"]),
        }),
        resolveRole: async () => "team_member",
        tasks: [{ id: "t-other", companyId: "company-1", projectId: "proj-other" }],
      });
      const res = await callTool(app, "update-task", {
        taskId: "t-other",
        status: "done",
      });
      expect(res.status).toBe(404);
    });

    it("returns 403 when role cannot update task", async () => {
      const { app } = buildApp({
        resolveScope: async (_c, actor) => ({
          kind: "scoped",
          userId: actor.userId,
          projectIds: new Set(["proj-1"]),
        }),
        resolveRole: async () => "team_member",
        tasks: [{ id: "t-1", companyId: "company-1", projectId: "proj-1" }],
        canAccessEntity: vi.fn().mockResolvedValue(false),
      });
      const res = await callTool(app, "update-task", {
        taskId: "t-1",
        status: "in_progress",
      });
      expect(res.status).toBe(403);
    });
  });

  describe("add-task-comment", () => {
    it("adds a comment to an accessible task", async () => {
      const { app } = buildApp({
        tasks: [{ id: "t-1", companyId: "company-1", projectId: "proj-1" }],
      });
      const res = await callTool(app, "add-task-comment", {
        taskId: "t-1",
        body: "Looking into this now",
      });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload.id).toBeTruthy();
      expect(payload.body).toBe("Looking into this now");
    });

    it("rejects cross-company comment (404)", async () => {
      const { app } = buildApp({
        tasks: [{ id: "t-x", companyId: "other-company", projectId: null }],
      });
      const res = await callTool(app, "add-task-comment", {
        taskId: "t-x",
        body: "nope",
      });
      expect(res.status).toBe(404);
    });

    it("scoped user cannot comment outside their scope (404)", async () => {
      const { app } = buildApp({
        resolveScope: async (_c, actor) => ({
          kind: "scoped",
          userId: actor.userId,
          projectIds: new Set(["proj-mine"]),
        }),
        resolveRole: async () => "team_member",
        tasks: [{ id: "t-other", companyId: "company-1", projectId: "proj-other" }],
      });
      const res = await callTool(app, "add-task-comment", {
        taskId: "t-other",
        body: "blocked",
      });
      expect(res.status).toBe(404);
    });

    it("team_member CAN comment on a task in their scope (read access suffices)", async () => {
      const { app } = buildApp({
        resolveScope: async (_c, actor) => ({
          kind: "scoped",
          userId: actor.userId,
          projectIds: new Set(["proj-1"]),
        }),
        resolveRole: async () => "team_member",
        tasks: [{ id: "t-1", companyId: "company-1", projectId: "proj-1" }],
      });
      const res = await callTool(app, "add-task-comment", {
        taskId: "t-1",
        body: "I can comment",
      });
      expect(res.status).toBe(200);
    });
  });
});
