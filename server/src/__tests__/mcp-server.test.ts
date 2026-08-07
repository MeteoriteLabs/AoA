import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

// U2c: server.ts now also imports the internal-agent tool registry
// (mcp-bridge.ts / tool-registry.js), whose ~90 tools reference many more
// schema tables (agents, internalAgentConfig, heartbeatRuns, ...) — several
// with module-scope `sql` usage (e.g. heartbeat.ts) — than this file's old
// hand-enumerated table list covered. A hand-enumerated allowlist can't keep
// up with that surface, and Vitest's `vi.mock` factory validates named
// exports against the literal keys on the returned object (a dynamic
// catch-all Proxy doesn't satisfy it — only its OWN enumerable keys count).
// `../services/index.js` below is already fully mocked with noop factories,
// which was the actual reason `@armyofagents/db`/`drizzle-orm` needed
// stubbing (real service construction hitting a real DB pool). With that
// path cut, passing the REAL `@armyofagents/db` (real Drizzle table defs) and
// REAL `drizzle-orm` (real query-builder operators) through unmodified is
// both simpler and correct — this file's fake inline `ctx.db` stub objects
// only need the operator calls to not throw, and real operators do that job
// better than hand-rolled ones. Verified: all tests in this file still pass.
vi.mock("@armyofagents/db", async (importOriginal) => {
  return await importOriginal<Record<string, unknown>>();
});

vi.mock("drizzle-orm", async (importOriginal) => {
  return await importOriginal<Record<string, unknown>>();
});

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
    accessService: noopFactory,
    projectService: noopFactory,
    approvalService: noopFactory,
    issueApprovalService: noopFactory,
    logActivity: vi.fn().mockResolvedValue(undefined),
  };
});

// The memory resource read now resolves an RBAC actor + in-SQL access conditions
// (P1-T5), which hit the DB (a bare {} here). Mock the db-backed resolvers so the
// resource-scope tests stay wiring tests; the real gate is proven against
// embedded-pg in the *.integration.test.ts suites.
vi.mock("../services/memory-access-sql.js", () => ({
  actorForMcp: vi.fn(async () => ({ kind: "founder" as const })),
  memoryAccessConditions: vi.fn(() => []),
}));

import { agents, internalAgentConfig } from "@armyofagents/db";
import { mcpServerRoutes } from "../mcp/server.js";

function buildApp(options?: {
  actor?: Record<string, unknown>;
  resolveScope?: (
    companyId: string,
    actor: { source: string; userId: string },
  ) => Promise<any>;
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
        (async (_companyId, actor) => ({ kind: "founder", userId: actor.userId })),
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
      resolveScope: async (_companyId, actor) => ({
        kind: "scoped",
        userId: actor.userId,
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
      resolveScope: async (_companyId, actor) => ({
        kind: "scoped",
        userId: actor.userId,
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
      resolveScope: async (_companyId, actor) => ({
        kind: "scoped",
        userId: actor.userId,
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

// ---------------------------------------------------------------------------
// U10 — plugin tools over the broker (tools/list, U10-b)
// ---------------------------------------------------------------------------
//
// An agent-with-runId actor's tools/list request must succeed through the
// REAL resolveAgentBrokerContext()/resolveBrokerToolContext() path (it runs
// unconditionally before the plugin-tools branch appends anything), so
// these tests provide a minimal but real-shaped `db` — a table-identity-
// dispatched chain mock — rather than the bare `{}` the rest of this file
// uses for "mcp"-actor tests that never reach that path. The dedicated
// embedded-Postgres proof lives in plugin-broker-cloud.integration.test.ts
// (U10-c); these are fast, isolated unit tests for the wiring itself.
type Row = Record<string, unknown>;

/** A `Promise` decorated with drizzle's chain methods, all returning itself. */
function chainRows(rows: Row[]) {
  const thenable = Promise.resolve(rows) as Promise<Row[]> & Record<string, unknown>;
  thenable.from = () => thenable;
  thenable.where = () => thenable;
  thenable.limit = () => thenable;
  thenable.orderBy = () => thenable;
  return thenable;
}

function makeAgentBrokerDb(overrides: { agentRows?: Row[]; configRows?: Row[] } = {}) {
  const tableRows = new Map<unknown, Row[]>([
    [
      agents,
      overrides.agentRows ?? [
        { id: "agent-a", companyId: "c1", kind: "aoa", runtimeConfig: {} },
      ],
    ],
    [internalAgentConfig, overrides.configRows ?? [{ crewAutonomyLevel: 0 }]],
  ]);
  return {
    select: (..._cols: unknown[]) => ({
      from: (table: unknown) => chainRows(tableRows.get(table) ?? []),
    }),
  };
}

function buildAgentApp(options: {
  actor: Record<string, unknown>;
  db?: ReturnType<typeof makeAgentBrokerDb>;
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = options.actor;
    next();
  });
  app.use(
    "/api",
    mcpServerRoutes((options.db ?? makeAgentBrokerDb()) as any, {
      companiesSvc: {
        getById: vi.fn().mockImplementation(async (id: string) => ({ id, mcpEnabled: true })),
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
      resolveScope: async (_companyId, actor) => ({ kind: "founder" as const, userId: actor.userId }),
      resolveRole: async () => "team_member",
      resolveScopedAgentIds: async () => null,
    }),
  );
  return app;
}

describe("U10: plugin tool descriptors over the broker tools/list", () => {
  afterEach(() => {
    delete (globalThis as any).__paperclipPluginToolDispatcher;
  });

  it("includes company-scoped plugin tool descriptors for an agent actor", async () => {
    const listToolsForAgent = vi.fn(({ companyId }: { companyId: string }) =>
      companyId === "c1"
        ? [
            {
              name: "acme.linear:search-issues",
              displayName: "Search issues",
              description: "Search Linear issues",
              parametersSchema: { type: "object", properties: { query: { type: "string" } } },
              pluginId: "plugin-1",
            },
          ]
        : [],
    );
    (globalThis as any).__paperclipPluginToolDispatcher = { listToolsForAgent };

    const app = buildAgentApp({
      actor: {
        type: "agent",
        source: "agent_jwt",
        companyId: "c1",
        agentId: "agent-a",
        runId: "run-r",
      },
    });

    const res = await request(app)
      .post("/api/companies/c1/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

    expect(res.status).toBe(200);
    const names = (res.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain("acme.linear:search-issues");
    expect(listToolsForAgent).toHaveBeenCalledWith({ companyId: "c1" });
    // Plugin descriptors are appended alongside the internal registry list,
    // not a replacement for it.
    const pluginTool = (res.body.result.tools as Array<{ name: string; inputSchema: unknown }>).find(
      (t) => t.name === "acme.linear:search-issues",
    );
    expect(pluginTool?.inputSchema).toEqual({
      type: "object",
      properties: { query: { type: "string" } },
    });
  });

  it("is company-scoped — a different company's agent actor does not see it", async () => {
    const listToolsForAgent = vi.fn(({ companyId }: { companyId: string }) =>
      companyId === "c1"
        ? [
            {
              name: "acme.linear:search-issues",
              displayName: "d",
              description: "d",
              parametersSchema: {},
              pluginId: "plugin-1",
            },
          ]
        : [],
    );
    (globalThis as any).__paperclipPluginToolDispatcher = { listToolsForAgent };

    const app = buildAgentApp({
      actor: {
        type: "agent",
        source: "agent_jwt",
        companyId: "c2",
        agentId: "agent-b",
        runId: "run-s",
      },
      db: makeAgentBrokerDb({
        agentRows: [{ id: "agent-b", companyId: "c2", kind: "aoa", runtimeConfig: {} }],
      }),
    });

    const res = await request(app)
      .post("/api/companies/c2/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

    expect(res.status).toBe(200);
    const names = (res.body.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).not.toContain("acme.linear:search-issues");
    expect(listToolsForAgent).toHaveBeenCalledWith({ companyId: "c2" });
  });

  it("degrades to no plugin tools (never breaks the broker) when the dispatcher throws", async () => {
    (globalThis as any).__paperclipPluginToolDispatcher = {
      listToolsForAgent: () => {
        throw new Error("registry unavailable");
      },
    };

    const app = buildAgentApp({
      actor: {
        type: "agent",
        source: "agent_jwt",
        companyId: "c1",
        agentId: "agent-a",
        runId: "run-r",
      },
    });

    const res = await request(app)
      .post("/api/companies/c1/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.result.tools)).toBe(true);
  });
});
