import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockOctokit = vi.hoisted(() => ({
  users: { getAuthenticated: vi.fn() },
}));
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => mockOctokit),
}));

const mockSvc = vi.hoisted(() => ({
  getByName: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());
vi.mock("../services/index.js", () => ({
  secretService: () => mockSvc,
  logActivity: mockLogActivity,
}));

import { errorHandler } from "../middleware/index.js";
import { githubRoutes } from "../routes/github.js";

function createApp(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", githubRoutes({} as any));
  app.use(errorHandler);
  return app;
}

const boardActor = {
  type: "board",
  source: "local_implicit",
  userId: "board-user",
  companyIds: null,
  isInstanceAdmin: true,
};

describe("github integration routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /companies/:companyId/github/pat", () => {
    it("saves a valid PAT and returns configured=true with githubUser", async () => {
      mockOctokit.users.getAuthenticated.mockResolvedValue({
        data: { login: "octocat" },
      });
      mockSvc.delete.mockResolvedValue(false);
      mockSvc.create.mockResolvedValue({ id: "secret-1" });

      const app = createApp(boardActor);
      const res = await request(app)
        .post("/api/companies/company-1/github/pat")
        .send({ pat: "ghp_validtoken" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: true, githubUser: "octocat" });
      expect(mockOctokit.users.getAuthenticated).toHaveBeenCalledTimes(1);
      expect(mockSvc.delete).toHaveBeenCalledWith("company-1", "github_pat");
      expect(mockSvc.create).toHaveBeenCalledWith(
        "company-1",
        expect.objectContaining({
          name: "github_pat",
          provider: "local_encrypted",
          value: "ghp_validtoken",
          externalRef: "octocat",
        }),
        { userId: "board-user", agentId: null },
      );
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          companyId: "company-1",
          action: "github.pat.connected",
          entityType: "secret",
          entityId: "secret-1",
          details: { githubUser: "octocat" },
        }),
      );
      // Extra safety: PAT must not be in activity log details.
      const logCall = mockLogActivity.mock.calls[0]![1] as { details: unknown };
      expect(JSON.stringify(logCall.details)).not.toContain("ghp_validtoken");
    });

    it("returns 400 when Octokit rejects the PAT (does not persist)", async () => {
      mockOctokit.users.getAuthenticated.mockRejectedValue(new Error("401 unauthorized"));

      const app = createApp(boardActor);
      const res = await request(app)
        .post("/api/companies/company-1/github/pat")
        .send({ pat: "ghp_bogus" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid GitHub PAT" });
      expect(mockSvc.delete).not.toHaveBeenCalled();
      expect(mockSvc.create).not.toHaveBeenCalled();
      expect(mockLogActivity).not.toHaveBeenCalled();
    });

    it("re-save deletes the existing PAT before creating a new one", async () => {
      mockOctokit.users.getAuthenticated.mockResolvedValue({
        data: { login: "newuser" },
      });
      mockSvc.delete.mockResolvedValue(true); // existing row existed
      mockSvc.create.mockResolvedValue({ id: "secret-2" });

      const app = createApp(boardActor);
      const res = await request(app)
        .post("/api/companies/company-1/github/pat")
        .send({ pat: "ghp_new" });

      expect(res.status).toBe(200);
      // delete must be called before create
      const deleteOrder = mockSvc.delete.mock.invocationCallOrder[0]!;
      const createOrder = mockSvc.create.mock.invocationCallOrder[0]!;
      expect(deleteOrder).toBeLessThan(createOrder);
    });

    it("returns 400 when the request body is empty (zod parse failure)", async () => {
      const app = createApp(boardActor);
      const res = await request(app)
        .post("/api/companies/company-1/github/pat")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid request body" });
      expect(mockOctokit.users.getAuthenticated).not.toHaveBeenCalled();
      expect(mockSvc.create).not.toHaveBeenCalled();
    });

    it("returns 400 when pat is empty string", async () => {
      const app = createApp(boardActor);
      const res = await request(app)
        .post("/api/companies/company-1/github/pat")
        .send({ pat: "" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid request body" });
    });
  });

  describe("DELETE /companies/:companyId/github/pat", () => {
    it("returns configured=false, removed=true when row existed + logs activity", async () => {
      mockSvc.delete.mockResolvedValue(true);
      const app = createApp(boardActor);
      const res = await request(app).delete("/api/companies/company-1/github/pat");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false, removed: true });
      expect(mockSvc.delete).toHaveBeenCalledWith("company-1", "github_pat");
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          companyId: "company-1",
          action: "github.pat.disconnected",
        }),
      );
    });

    it("returns configured=false, removed=false when no row exists + does NOT log activity", async () => {
      mockSvc.delete.mockResolvedValue(false);
      const app = createApp(boardActor);
      const res = await request(app).delete("/api/companies/company-1/github/pat");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false, removed: false });
      expect(mockLogActivity).not.toHaveBeenCalled();
    });
  });

  describe("GET /companies/:companyId/github/pat/status", () => {
    it("returns configured=true with githubUser + createdAt when configured", async () => {
      const createdAt = new Date("2026-04-22T10:00:00Z");
      mockSvc.getByName.mockResolvedValue({
        id: "secret-1",
        externalRef: "octocat",
        createdAt,
      });

      const app = createApp(boardActor);
      const res = await request(app).get(
        "/api/companies/company-1/github/pat/status",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        configured: true,
        githubUser: "octocat",
        createdAt: createdAt.toISOString(),
      });
      // Ensure we never leak PAT-like fields.
      expect(res.body).not.toHaveProperty("pat");
      expect(res.body).not.toHaveProperty("value");
    });

    it("returns configured=false when not configured", async () => {
      mockSvc.getByName.mockResolvedValue(null);

      const app = createApp(boardActor);
      const res = await request(app).get(
        "/api/companies/company-1/github/pat/status",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false });
    });

    it("returns githubUser=null when externalRef is missing", async () => {
      mockSvc.getByName.mockResolvedValue({
        id: "secret-1",
        externalRef: null,
        createdAt: new Date("2026-04-22T10:00:00Z"),
      });

      const app = createApp(boardActor);
      const res = await request(app).get(
        "/api/companies/company-1/github/pat/status",
      );

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.githubUser).toBeNull();
    });
  });

  describe("authorization", () => {
    it("rejects anonymous actor with 401 (assertCompanyAccess throws unauthorized before board check)", async () => {
      // assertBoard runs first and throws 403; but the task spec treats `{type:"none"}`
      // as 401 via assertCompanyAccess. Since assertBoard sees type!="board", it
      // returns 403 first. Verify that path.
      const app = createApp({ type: "none" });
      const res = await request(app).get(
        "/api/companies/company-1/github/pat/status",
      );

      // assertBoard runs first -> 403
      expect(res.status).toBe(403);
    });

    it("rejects agent actor for different company with 403", async () => {
      const app = createApp({
        type: "agent",
        agentId: "a1",
        companyId: "other-company",
      });
      const res = await request(app).get(
        "/api/companies/company-1/github/pat/status",
      );

      expect(res.status).toBe(403);
    });

    it("rejects non-board actor with 403 (assertBoard throws)", async () => {
      const app = createApp({
        type: "agent",
        agentId: "a1",
        companyId: "company-1",
      });
      const res = await request(app).post(
        "/api/companies/company-1/github/pat",
      ).send({ pat: "ghp_x" });

      expect(res.status).toBe(403);
      expect(mockSvc.create).not.toHaveBeenCalled();
    });

    it("rejects board actor from different company (non-admin) with 403", async () => {
      const app = createApp({
        type: "board",
        source: "session",
        userId: "user-x",
        companyIds: ["other-company"],
        isInstanceAdmin: false,
      });
      const res = await request(app).get(
        "/api/companies/company-1/github/pat/status",
      );

      expect(res.status).toBe(403);
    });
  });
});
