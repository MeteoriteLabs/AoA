import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createMarketplaceRouter } from "../routes/marketplace.js";

vi.mock("../routes/authz.js", () => ({
  assertBoard: (_req: any) => {
    // No-op: allow all requests through in tests
  },
}));

const VALID_CATALOG = {
  schemaVersion: "1.0.0",
  generatedAt: "2026-04-30T00:00:00.000Z",
  itemCount: 0,
  items: [],
};

describe("marketplace routes", () => {
  it("GET /catalog returns 503 when not synced", async () => {
    const service = {
      readCache: async () => null,
      sync: async () => null,
      getStatus: async () => null,
    } as any;

    const app = express();
    app.use("/api/marketplace", createMarketplaceRouter({ service }));

    const res = await request(app).get("/api/marketplace/catalog");
    expect(res.status).toBe(503);
  });

  it("GET /catalog returns cached catalog", async () => {
    const service = {
      readCache: async () => VALID_CATALOG,
      sync: async () => VALID_CATALOG,
      getStatus: async () => null,
    } as any;

    const app = express();
    app.use("/api/marketplace", createMarketplaceRouter({ service }));

    const res = await request(app).get("/api/marketplace/catalog");
    expect(res.status).toBe(200);
    expect(res.body.schemaVersion).toBe("1.0.0");
  });

  it("POST /catalog/sync triggers sync and returns status", async () => {
    const service = {
      readCache: async () => VALID_CATALOG,
      sync: async () => VALID_CATALOG,
      getStatus: async () => ({
        lastSyncedAt: "2026-04-30T00:00:00.000Z",
        lastSyncStatus: "success",
        source: "cdn",
        schemaVersion: "1.0.0",
        itemCount: 0,
      }),
    } as any;

    const app = express();
    // Attach a minimal actor so assertBoard's req.actor check passes
    app.use((req: any, _res, next) => {
      req.actor = { type: "board" };
      next();
    });
    app.use("/api/marketplace", createMarketplaceRouter({ service }));

    const res = await request(app).post("/api/marketplace/catalog/sync");
    expect(res.status).toBe(200);
    expect(res.body.itemCount).toBe(0);
  });

  it("GET /catalog/status returns sync metadata", async () => {
    const service = {
      readCache: async () => VALID_CATALOG,
      sync: async () => VALID_CATALOG,
      getStatus: async () => ({
        lastSyncedAt: "2026-04-30T00:00:00.000Z",
        lastSyncStatus: "success",
        source: "cdn",
        schemaVersion: "1.0.0",
        itemCount: 0,
      }),
    } as any;

    const app = express();
    app.use("/api/marketplace", createMarketplaceRouter({ service }));

    const res = await request(app).get("/api/marketplace/catalog/status");
    expect(res.status).toBe(200);
    expect(res.body.lastSyncStatus).toBe("success");
  });
});
