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

type Agent = { id: string; companyId: string; status: string; name?: string };
type Project = { id: string; companyId: string; type: "department" | "project"; name?: string };

function buildApp(options?: {
  actor?: Record<string, unknown>;
  resolveScope?: (companyId: string, userId: string) => Promise<any>;
  resolveRole?: (companyId: string, userId: string) => Promise<string>;
  resolveScopedAgentIds?: (companyId: string, scope: any) => Promise<Set<string> | null>;
  agents?: Agent[];
  projects?: Project[];
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

  const agentList = options?.agents ?? [];
  const projectList = options?.projects ?? [];

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
      resolveRole: options?.resolveRole ?? (async () => "founder"),
      resolveScopedAgentIds:
        options?.resolveScopedAgentIds ?? (async () => null),
      issuesSvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      } as any,
      goalsSvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
      } as any,
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
      debriefsSvc: {
        create: vi.fn(),
      } as any,
      extractionSvc: {
        extractFromDebrief: vi.fn(),
      } as any,
      permissionsSvc: {
        canAccessEntity: vi.fn().mockResolvedValue(true),
        canAccessMemory: vi.fn().mockResolvedValue(true),
      } as any,
      agentsSvc: {
        list: vi.fn().mockImplementation(async (companyId: string) =>
          agentList.filter((a) => a.companyId === companyId),
        ),
        getById: vi
          .fn()
          .mockImplementation(async (id: string) => agentList.find((a) => a.id === id) ?? null),
      } as any,
      projectsSvc: {
        list: vi
          .fn()
          .mockImplementation(async (companyId: string) =>
            projectList.filter((p) => p.companyId === companyId),
          ),
        getById: vi
          .fn()
          .mockImplementation(async (id: string) => projectList.find((p) => p.id === id) ?? null),
      } as any,
    }),
  );

  return { app };
}

async function callTool(app: express.Express, name: string, args: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/companies/company-1/mcp")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return res;
}

describe("MCP read tools", () => {
  describe("tools/list exposes the new read tools", () => {
    it("lists me, list-agents, get-agent, list-projects, get-project", async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post("/api/companies/company-1/mcp")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
      expect(res.status).toBe(200);
      const names = res.body.result.tools.map((t: any) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "me",
          "list-agents",
          "get-agent",
          "list-projects",
          "get-project",
        ]),
      );
    });
  });

  describe("me", () => {
    it("returns authenticated user info including role", async () => {
      const { app } = buildApp();
      const res = await callTool(app, "me", {});
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload.userId).toBe("user-1");
      expect(payload.companyId).toBe("company-1");
      expect(payload.role).toBe("founder");
    });

    it("reports scoped role for non-founder users", async () => {
      const { app } = buildApp({
        resolveScope: async (_cid, userId) => ({
          kind: "scoped",
          userId,
          projectIds: new Set(["project-1"]),
        }),
        resolveRole: async () => "team_member",
      });
      const res = await callTool(app, "me", {});
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload.role).toBe("team_member");
    });
  });

  describe("list-agents", () => {
    it("returns agents for the caller's company", async () => {
      const { app } = buildApp({
        agents: [
          { id: "agent-1", companyId: "company-1", status: "active" },
          { id: "agent-2", companyId: "company-1", status: "active" },
          { id: "agent-X", companyId: "other-company", status: "active" },
        ],
      });
      const res = await callTool(app, "list-agents", {});
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(2);
      expect(payload.every((a: any) => a.companyId === "company-1")).toBe(true);
    });

    it("filters by status when provided", async () => {
      const { app } = buildApp({
        agents: [
          { id: "agent-1", companyId: "company-1", status: "active" },
          { id: "agent-2", companyId: "company-1", status: "idle" },
        ],
      });
      const res = await callTool(app, "list-agents", { status: "active" });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(1);
      expect(payload[0].id).toBe("agent-1");
    });

    it("scoped user sees only agents linked to their projects", async () => {
      const { app } = buildApp({
        resolveScope: async (_cid, userId) => ({
          kind: "scoped",
          userId,
          projectIds: new Set(["project-1"]),
        }),
        resolveScopedAgentIds: async () => new Set(["agent-1"]),
        agents: [
          { id: "agent-1", companyId: "company-1", status: "active" },
          { id: "agent-2", companyId: "company-1", status: "active" },
        ],
      });
      const res = await callTool(app, "list-agents", {});
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(1);
      expect(payload[0].id).toBe("agent-1");
    });
  });

  describe("get-agent", () => {
    it("returns an agent by id when caller has access", async () => {
      const { app } = buildApp({
        agents: [{ id: "agent-1", companyId: "company-1", status: "active", name: "Coder" }],
      });
      const res = await callTool(app, "get-agent", { agentId: "agent-1" });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload.id).toBe("agent-1");
    });

    it("returns 404 when the agent is in another company", async () => {
      const { app } = buildApp({
        agents: [{ id: "agent-X", companyId: "other-company", status: "active" }],
      });
      const res = await callTool(app, "get-agent", { agentId: "agent-X" });
      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/not found/i);
    });
  });

  describe("list-projects", () => {
    it("returns both departments and projects for the caller's company", async () => {
      const { app } = buildApp({
        projects: [
          { id: "dept-1", companyId: "company-1", type: "department", name: "Engineering" },
          { id: "proj-1", companyId: "company-1", type: "project", name: "Launch" },
          { id: "other", companyId: "other-company", type: "project", name: "Hidden" },
        ],
      });
      const res = await callTool(app, "list-projects", {});
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(2);
      expect(payload.some((p: any) => p.type === "department")).toBe(true);
      expect(payload.some((p: any) => p.type === "project")).toBe(true);
    });

    it("scoped user sees only projects in their scope", async () => {
      const { app } = buildApp({
        resolveScope: async (_cid, userId) => ({
          kind: "scoped",
          userId,
          projectIds: new Set(["proj-1"]),
        }),
        projects: [
          { id: "proj-1", companyId: "company-1", type: "project" },
          { id: "proj-2", companyId: "company-1", type: "project" },
        ],
      });
      const res = await callTool(app, "list-projects", {});
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(1);
      expect(payload[0].id).toBe("proj-1");
    });
  });

  describe("get-project", () => {
    it("returns a project by id when caller has access", async () => {
      const { app } = buildApp({
        projects: [{ id: "proj-1", companyId: "company-1", type: "project", name: "Launch" }],
      });
      const res = await callTool(app, "get-project", { projectId: "proj-1" });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload.id).toBe("proj-1");
    });

    it("returns 404 when the project is in another company", async () => {
      const { app } = buildApp({
        projects: [{ id: "other", companyId: "other-company", type: "project" }],
      });
      const res = await callTool(app, "get-project", { projectId: "other" });
      expect(res.status).toBe(404);
      expect(res.body.error.message).toMatch(/not found/i);
    });

    it("returns 404 when scoped user queries a project outside their scope", async () => {
      const { app } = buildApp({
        resolveScope: async (_cid, userId) => ({
          kind: "scoped",
          userId,
          projectIds: new Set(["proj-1"]),
        }),
        projects: [
          { id: "proj-1", companyId: "company-1", type: "project" },
          { id: "proj-2", companyId: "company-1", type: "project" },
        ],
      });
      const res = await callTool(app, "get-project", { projectId: "proj-2" });
      expect(res.status).toBe(404);
    });
  });
});
