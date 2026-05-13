import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: () => undefined,
  getActorInfo: () => ({ userId: "u-1", actorType: "user" }),
}));

// Stub the service module to break the drizzle-orm ESM cycle
vi.mock("../services/environments.js", () => ({
  environmentService: vi.fn(() => ({})),
}));

import { environmentRoutes } from "../routes/environments.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const envId = "22222222-2222-4222-8222-222222222222";

const mockEnv = {
  id: envId,
  companyId,
  name: "Production",
  envVars: { API_URL: "https://api.example.com" },
  connectionTarget: null,
  target: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function buildApp(mockSvc: unknown) {
  const app = express();
  app.use(express.json());
  app.use(environmentRoutes({ svc: mockSvc as never }));
  return app;
}

describe("environments routes", () => {
  beforeEach(() => vi.clearAllMocks());

  // GET list
  it("GET /companies/:cid/environments returns 200 with list", async () => {
    const svc = {
      list: vi.fn(async () => [mockEnv]),
    };
    const app = buildApp(svc);
    const res = await request(app).get(`/companies/${companyId}/environments`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(envId);
    expect(svc.list).toHaveBeenCalledWith(companyId);
  });

  // GET detail — found
  it("GET /companies/:cid/environments/:id returns 200 with env", async () => {
    const svc = {
      get: vi.fn(async () => mockEnv),
    };
    const app = buildApp(svc);
    const res = await request(app).get(`/companies/${companyId}/environments/${envId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(envId);
    expect(res.body.name).toBe("Production");
    expect(svc.get).toHaveBeenCalledWith(companyId, envId);
  });

  // GET detail — not found
  it("GET /companies/:cid/environments/:id returns 404 when not found", async () => {
    const svc = {
      get: vi.fn(async () => null),
    };
    const app = buildApp(svc);
    const res = await request(app).get(`/companies/${companyId}/environments/missing`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  // POST create — success
  it("POST /companies/:cid/environments returns 201 with created env", async () => {
    const svc = {
      create: vi.fn(async () => mockEnv),
    };
    const app = buildApp(svc);
    const res = await request(app)
      .post(`/companies/${companyId}/environments`)
      .send({ name: "Production", envVars: { API_URL: "https://api.example.com" } });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(envId);
    expect(svc.create).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({ name: "Production" }),
    );
  });

  it("POST /companies/:cid/environments accepts a sandbox-docker target", async () => {
    const target = { type: "sandbox-docker", image: "node:22-bookworm" };
    const svc = {
      create: vi.fn(async () => ({ ...mockEnv, target })),
    };
    const app = buildApp(svc);
    const res = await request(app)
      .post(`/companies/${companyId}/environments`)
      .send({ name: "Docker", envVars: {}, target });
    expect(res.status).toBe(201);
    expect(res.body.target).toEqual(target);
    expect(svc.create).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({ target }),
    );
  });

  // POST create — invalid body (missing name)
  it("POST /companies/:cid/environments returns 400 on invalid body", async () => {
    const svc = {
      create: vi.fn(),
    };
    const app = buildApp(svc);
    const res = await request(app)
      .post(`/companies/${companyId}/environments`)
      .send({}); // missing required `name`
    expect(res.status).toBe(400);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("POST /companies/:cid/environments returns 400 on invalid target", async () => {
    const svc = {
      create: vi.fn(),
    };
    const app = buildApp(svc);
    const res = await request(app)
      .post(`/companies/${companyId}/environments`)
      .send({ name: "Broken", target: { type: "sandbox-docker" } });
    expect(res.status).toBe(400);
    expect(svc.create).not.toHaveBeenCalled();
  });

  // PATCH update — success
  it("PATCH /companies/:cid/environments/:id returns 200 with updated env", async () => {
    const updated = { ...mockEnv, name: "Staging" };
    const svc = {
      update: vi.fn(async () => updated),
    };
    const app = buildApp(svc);
    const res = await request(app)
      .patch(`/companies/${companyId}/environments/${envId}`)
      .send({ name: "Staging" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Staging");
    expect(svc.update).toHaveBeenCalledWith(
      companyId,
      envId,
      expect.objectContaining({ name: "Staging" }),
    );
  });

  it("PATCH /companies/:cid/environments/:id accepts clearing target", async () => {
    const svc = {
      update: vi.fn(async () => ({ ...mockEnv, target: null })),
    };
    const app = buildApp(svc);
    const res = await request(app)
      .patch(`/companies/${companyId}/environments/${envId}`)
      .send({ target: null });
    expect(res.status).toBe(200);
    expect(res.body.target).toBeNull();
    expect(svc.update).toHaveBeenCalledWith(
      companyId,
      envId,
      expect.objectContaining({ target: null }),
    );
  });

  // PATCH update — not found
  it("PATCH /companies/:cid/environments/:id returns 404 when not found", async () => {
    const svc = {
      update: vi.fn(async () => null),
    };
    const app = buildApp(svc);
    const res = await request(app)
      .patch(`/companies/${companyId}/environments/missing`)
      .send({ name: "Staging" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  // DELETE — success
  it("DELETE /companies/:cid/environments/:id returns 204", async () => {
    const svc = {
      delete: vi.fn(async () => mockEnv),
    };
    const app = buildApp(svc);
    const res = await request(app).delete(`/companies/${companyId}/environments/${envId}`);
    expect(res.status).toBe(204);
    expect(svc.delete).toHaveBeenCalledWith(companyId, envId);
  });

  // DELETE — not found
  it("DELETE /companies/:cid/environments/:id returns 404 when service returns null", async () => {
    const svc = {
      delete: vi.fn(async () => null),
    };
    const app = buildApp(svc);
    const res = await request(app).delete(`/companies/${companyId}/environments/missing`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
