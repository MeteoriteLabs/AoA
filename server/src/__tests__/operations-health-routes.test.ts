import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { operationsHealthRoutes } from "../routes/operations-health.js";

function appFor(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use(
    "/api",
    operationsHealthRoutes({} as any, {
      deploymentMode: "local_trusted",
      deploymentExposure: "private",
      authReady: true,
      companyDeletionEnabled: true,
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("operations health routes", () => {
  it("returns company health for accessible company", async () => {
    const app = appFor({
      type: "board",
      userId: "u1",
      companyIds: ["c1"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app).get("/api/companies/c1/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scope: "company", companyId: "c1" });
  });

  it("rejects company health across company boundary", async () => {
    const app = appFor({
      type: "board",
      userId: "u1",
      companyIds: ["c1"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app).get("/api/companies/c2/health");

    expect(res.status).toBe(403);
  });

  it("returns instance health for instance admin", async () => {
    const app = appFor({
      type: "board",
      userId: "admin",
      companyIds: [],
      source: "session",
      isInstanceAdmin: true,
    });

    const res = await request(app).get("/api/instance/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scope: "instance" });
  });

  it("rejects instance health for non-admin", async () => {
    const app = appFor({
      type: "board",
      userId: "u1",
      companyIds: ["c1"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app).get("/api/instance/health");

    expect(res.status).toBe(403);
  });

  it("does not expose secret-like values in instance health reports", async () => {
    const app = appFor({
      type: "board",
      userId: "admin",
      companyIds: [],
      source: "session",
      isInstanceAdmin: true,
    });

    const res = await request(app).get("/api/instance/health");

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/secret-value|password-value|token-value/i);
  });
});
