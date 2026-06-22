import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { companyRoutes } from "../routes/companies.js";

const stats = {
  "co-1": { agentCount: 7, issueCount: 24, pendingApprovalCount: 3, unreadNotificationCount: 12 },
  "co-2": { agentCount: 3, issueCount: 9, pendingApprovalCount: 0, unreadNotificationCount: 2 },
};

vi.mock("../services/index.js", () => ({
  companyService: () => ({
    list: vi.fn(),
    stats: vi.fn().mockResolvedValue(stats),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
  }),
  companyPortabilityService: () => ({
    exportBundle: vi.fn(),
    previewExport: vi.fn(),
    previewImport: vi.fn(),
    importBundle: vi.fn(),
  }),
  accessService: () => ({
    canUser: vi.fn(),
    ensureMembership: vi.fn(),
  }),
  logActivity: vi.fn(),
}));

describe("GET /api/companies/stats", () => {
  function makeApp(actor: Record<string, unknown>) {
    const app = express();
    app.use((req, _res, next) => {
      (req as { actor: Record<string, unknown> }).actor = actor;
      next();
    });
    app.use("/api/companies", companyRoutes({} as never, { deploymentMode: "local_trusted" }));
    return app;
  }

  it("returns pendingApprovalCount and unreadNotificationCount per accessible company", async () => {
    const app = makeApp({
      type: "board",
      userId: "u1",
      companyIds: ["co-1", "co-2"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app).get("/api/companies/stats");

    expect(res.status).toBe(200);
    expect(res.body["co-1"]).toEqual({
      agentCount: 7,
      issueCount: 24,
      pendingApprovalCount: 3,
      unreadNotificationCount: 12,
    });
    expect(res.body["co-2"]).toEqual({
      agentCount: 3,
      issueCount: 9,
      pendingApprovalCount: 0,
      unreadNotificationCount: 2,
    });
  });

  it("filters out companies the actor cannot access (multi-tenant isolation)", async () => {
    const app = makeApp({
      type: "board",
      userId: "u1",
      companyIds: ["co-1"], // only co-1
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app).get("/api/companies/stats");

    expect(res.status).toBe(200);
    expect(res.body["co-1"]).toBeDefined();
    expect(res.body["co-1"].pendingApprovalCount).toBe(3);
    expect(res.body["co-2"]).toBeUndefined();
  });
});
