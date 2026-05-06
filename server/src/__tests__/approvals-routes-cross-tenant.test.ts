import express from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";

const getById = vi.fn();
const approve = vi.fn();
const reject = vi.fn();
const requestRevision = vi.fn();

vi.mock("../services/index.js", () => ({
  approvalService: () => ({
    getById,
    approve,
    reject,
    requestRevision,
    list: vi.fn(),
    listComments: vi.fn(),
    addComment: vi.fn(),
    resubmit: vi.fn(),
    create: vi.fn(),
  }),
  issueApprovalService: () => ({ listIssuesForApproval: vi.fn().mockResolvedValue([]) }),
  trustScoreService: () => ({ updateOnReview: vi.fn() }),
  heartbeatService: () => ({ wakeup: vi.fn().mockResolvedValue(null) }),
  secretService: () => ({
    normalizeHireApprovalPayloadForPersistence: vi.fn(),
  }),
  logActivity: vi.fn(),
}));

import { approvalRoutes } from "../routes/approvals.js";
import { errorHandler } from "../middleware/error-handler.js";

function makeApp(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", approvalRoutes({} as any));
  app.use(errorHandler);
  return app;
}

const companyAActor = {
  type: "board",
  source: "session",
  userId: "user-A",
  companyIds: ["company-A"],
  isInstanceAdmin: false,
};
const companyBActor = { ...companyAActor, userId: "user-B", companyIds: ["company-B"] };

describe("/approvals cross-tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("403 when companyA user tries to approve a companyB approval", async () => {
    getById.mockResolvedValue({
      id: "ap1",
      companyId: "company-B",
      status: "pending",
      type: "test",
      requestedByAgentId: null,
    });
    const app = makeApp(companyAActor);
    const res = await request(app).post("/api/approvals/ap1/approve").send({});
    expect(res.status).toBe(403);
    expect(approve).not.toHaveBeenCalled();
  });

  it("403 cross-tenant on /reject", async () => {
    getById.mockResolvedValue({
      id: "ap1",
      companyId: "company-B",
      status: "pending",
      type: "test",
      requestedByAgentId: null,
    });
    const app = makeApp(companyAActor);
    const res = await request(app).post("/api/approvals/ap1/reject").send({});
    expect(res.status).toBe(403);
    expect(reject).not.toHaveBeenCalled();
  });

  it("403 cross-tenant on /request-revision", async () => {
    getById.mockResolvedValue({
      id: "ap1",
      companyId: "company-B",
      status: "pending",
      type: "test",
      requestedByAgentId: null,
    });
    const app = makeApp(companyAActor);
    const res = await request(app).post("/api/approvals/ap1/request-revision").send({});
    expect(res.status).toBe(403);
    expect(requestRevision).not.toHaveBeenCalled();
  });

  it("404 on unknown approval id", async () => {
    getById.mockResolvedValue(null);
    const app = makeApp(companyAActor);
    const res = await request(app).post("/api/approvals/missing/approve").send({});
    expect(res.status).toBe(404);
  });

  it("200 same-company; decidedByUserId derived from actor", async () => {
    getById.mockResolvedValue({
      id: "ap1",
      companyId: "company-A",
      status: "pending",
      requestedByAgentId: null,
      type: "test",
    });
    approve.mockResolvedValue({
      id: "ap1",
      companyId: "company-A",
      status: "approved",
      type: "test",
      requestedByAgentId: null,
      payload: {},
    });
    const app = makeApp(companyAActor);
    const res = await request(app).post("/api/approvals/ap1/approve").send({ decisionNote: "ok" });
    expect(res.status).toBe(200);
    expect(approve).toHaveBeenCalledWith("ap1", "user-A", "ok");
  });

  it("400 when body contains decidedByUserId (strict schema rejects)", async () => {
    const app = makeApp(companyAActor);
    const res = await request(app)
      .post("/api/approvals/ap1/approve")
      .send({ decisionNote: "ok", decidedByUserId: "alice@evil.com" });
    expect(res.status).toBe(400);
  });
});
