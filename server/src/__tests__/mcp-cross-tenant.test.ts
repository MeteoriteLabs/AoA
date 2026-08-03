import express from "express";
import request from "supertest";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { setDeploymentMode } from "../config/deployment-mode.js";

const cloudMembership = vi.hoisted(() => ({
  hasActive: vi.fn<(_db: unknown, companyId: string, userId: string) => Promise<boolean>>(),
}));

vi.mock("../services/upgrade-socket-authorization.js", () => ({
  hasActiveCloudMembership: cloudMembership.hasActive,
}));

// Break the drizzle-orm ESM cycle (mirrors mcp-server.test.ts).
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
    memoryItems: makeTable(),
    embeddingQueue: makeTable(),
    discussions: makeTable(),
    discussionExtractedItems: makeTable(),
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
    accessService: noopFactory,
    projectService: noopFactory,
    approvalService: noopFactory,
    issueApprovalService: noopFactory,
    logActivity: vi.fn().mockResolvedValue(undefined),
  };
});

import { mcpServerRoutes } from "../mcp/server.js";
import { errorHandler } from "../middleware/error-handler.js";

function buildApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  const touchClient = vi.fn().mockResolvedValue(null);
  const getById = vi.fn().mockResolvedValue({ id: "company-B", mcpEnabled: true });
  app.use(
    "/api",
    mcpServerRoutes({} as any, {
      companiesSvc: { getById, update: vi.fn() } as any,
      mcpSvc: {
        touchClient,
        getStatus: vi.fn(),
        listKeys: vi.fn(),
        createKey: vi.fn(),
        requireOwnedKey: vi.fn(),
        revokeKey: vi.fn(),
        listClients: vi.fn(),
      } as any,
      resolveScope: async (_companyId, a) => ({ kind: "founder", userId: a.userId }),
      issuesSvc: { list: vi.fn(), getById: vi.fn(), update: vi.fn() } as any,
      goalsSvc: { list: vi.fn(), getById: vi.fn() } as any,
      memorySvc: { list: vi.fn(), getById: vi.fn(), create: vi.fn() } as any,
      artifactsSvc: { list: vi.fn(), getById: vi.fn(), addVersion: vi.fn() } as any,
      debriefsSvc: { create: vi.fn() } as any,
      extractionSvc: { extractFromDebrief: vi.fn() } as any,
      permissionsSvc: {
        canAccessEntity: vi.fn().mockResolvedValue(true),
        canAccessMemory: vi.fn().mockResolvedValue(true),
      } as any,
    }),
  );
  app.use(errorHandler);
  return { app, touchClient, getById };
}

describe("MCP inbound cross-tenant (cloud_auth)", () => {
  beforeEach(() => {
    setDeploymentMode("cloud_auth");
    cloudMembership.hasActive.mockReset().mockResolvedValue(true);
  });

  it("403s a company-A mcp key hitting a company-B JSON-RPC endpoint (service not called)", async () => {
    const { app, touchClient } = buildApp({
      type: "mcp",
      source: "mcp_key",
      userId: "user-A",
      companyId: "company-A",
      keyId: "key-A",
    });
    const res = await request(app)
      .post("/api/companies/company-B/mcp")
      .send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/another company/i);
    // The cross-company denial fires BEFORE any downstream MCP work.
    expect(touchClient).not.toHaveBeenCalled();
    expect(cloudMembership.hasActive).not.toHaveBeenCalled();
  });

  it("403s a company-A mcp key reading a company-B task resource", async () => {
    const { app, touchClient } = buildApp({
      type: "mcp",
      source: "mcp_key",
      userId: "user-A",
      companyId: "company-A",
      keyId: "key-A",
    });
    const res = await request(app)
      .post("/api/companies/company-B/mcp")
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/read",
        params: { uri: "aoa://tasks/task-1" },
      });
    expect(res.status).toBe(403);
    expect(touchClient).not.toHaveBeenCalled();
  });

  it("allows the SAME company mcp key (positive control — initialize succeeds)", async () => {
    const { app, touchClient } = buildApp({
      type: "mcp",
      source: "mcp_key",
      userId: "user-B",
      companyId: "company-B",
      keyId: "key-B",
    });
    const res = await request(app)
      .post("/api/companies/company-B/mcp")
      .send({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} });
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo).toBeDefined();
    expect(touchClient).toHaveBeenCalled();
    expect(cloudMembership.hasActive).toHaveBeenCalledWith({}, "company-B", "user-B");
  });

  it("403s a same-company mcp key after its owner's live membership is suspended", async () => {
    cloudMembership.hasActive.mockResolvedValue(false);
    const { app, touchClient, getById } = buildApp({
      type: "mcp",
      source: "mcp_key",
      userId: "user-suspended",
      companyId: "company-B",
      keyId: "key-suspended",
    });
    const res = await request(app)
      .post("/api/companies/company-B/mcp")
      .send({ jsonrpc: "2.0", id: 4, method: "initialize", params: {} });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/active company access/i);
    expect(cloudMembership.hasActive).toHaveBeenCalledWith({}, "company-B", "user-suspended");
    expect(getById).not.toHaveBeenCalled();
    expect(touchClient).not.toHaveBeenCalled();
  });
});
