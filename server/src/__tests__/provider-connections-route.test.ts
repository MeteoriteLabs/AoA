// server/src/__tests__/provider-connections-route.test.ts
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { providerConnectionRoutes } from "../routes/provider-connections.js";

function appWith(db: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).actor = { type: "board", userId: "u1" }; next(); });
  app.use("/api", providerConnectionRoutes(db as never, { trustBoundary: "single_tenant" } as never));
  return app;
}

describe("provider-connections routes", () => {
  it("401s a non-board actor on list", async () => {
    const app = express();
    app.use((req, _res, next) => { (req as any).actor = { type: "agent" }; next(); });
    app.use("/api", providerConnectionRoutes({} as never, { trustBoundary: "single_tenant" } as never));
    const res = await request(app).get("/api/companies/co1/provider-connections");
    expect(res.status).toBe(401);
  });
});
