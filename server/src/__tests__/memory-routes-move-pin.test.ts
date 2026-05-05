import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { memoryRoutes } from "../routes/memory.js";

vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: () => undefined,
  getActorInfo: () => ({ userId: "u-1", actorType: "user" }),
}));
vi.mock("../middleware/rbac.js", () => ({
  assertRole: async () => undefined,
}));

vi.mock("../services/index.js", () => {
  return {
    memoryService: () => ({
      moveItem: vi.fn(async (id: string, _companyId: string, folderPath: string) => {
        if (id === "missing") return null;
        return { id, companyId: _companyId, folderPath };
      }),
      setPinnedToTop: vi.fn(async (id: string, _companyId: string, pinned: boolean) => {
        if (id === "missing") return null;
        return { id, companyId: _companyId, founderPinnedToTop: pinned };
      }),
    }),
    logActivity: vi.fn(async () => undefined),
  };
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(memoryRoutes({} as never));
  return app;
}

describe("memory routes — move + pin-to-top", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PATCH /companies/:cid/memory/items/:id/move updates folderPath", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/companies/co-1/memory/items/i-1/move")
      .send({ folderPath: "Engineering/Decisions" });
    expect(res.status).toBe(200);
    expect(res.body.folderPath).toBe("Engineering/Decisions");
  });

  it("PATCH /move returns 400 for invalid path", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/companies/co-1/memory/items/i-1/move")
      .send({ folderPath: "/leading/slash" });
    expect(res.status).toBe(400);
  });

  it("PATCH /move returns 404 if item missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/companies/co-1/memory/items/missing/move")
      .send({ folderPath: "Engineering" });
    expect(res.status).toBe(404);
  });

  it("PATCH /pin-to-top sets the flag", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/companies/co-1/memory/items/i-1/pin-to-top")
      .send({ pinned: true });
    expect(res.status).toBe(200);
    expect(res.body.founderPinnedToTop).toBe(true);
  });

  it("PATCH /pin-to-top returns 400 if pinned is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .patch("/companies/co-1/memory/items/i-1/pin-to-top")
      .send({});
    expect(res.status).toBe(400);
  });
});
