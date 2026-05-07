import express from "express";
import supertest from "supertest";
import { describe, it, expect, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { pluginRoutes } from "../routes/plugins.js";
import { createMarketplaceRouter } from "../routes/marketplace.js";

// ---------------------------------------------------------------------------
// Shared test actors
// ---------------------------------------------------------------------------

const NON_ADMIN = {
  type: "board",
  source: "session",
  isInstanceAdmin: false,
  userId: "user-test",
  companyIds: [],
};

const LOCAL_IMPLICIT = {
  type: "board",
  source: "local_implicit",
  isInstanceAdmin: false,
  userId: "user-local",
  companyIds: [],
};

// ---------------------------------------------------------------------------
// Unit tests: assertCanManageInstanceSettings
// ---------------------------------------------------------------------------

describe("assertCanManageInstanceSettings", () => {
  function makeReq(overrides: Record<string, unknown> = {}) {
    return {
      actor: {
        type: "board",
        source: "session",
        isInstanceAdmin: false,
        ...overrides,
      },
    };
  }

  it("allows local_implicit board regardless of isInstanceAdmin", async () => {
    const { assertCanManageInstanceSettings } = await import("../routes/authz.js");
    expect(() =>
      assertCanManageInstanceSettings(makeReq({ source: "local_implicit" }) as any)
    ).not.toThrow();
  });

  it("allows session board with isInstanceAdmin=true", async () => {
    const { assertCanManageInstanceSettings } = await import("../routes/authz.js");
    expect(() =>
      assertCanManageInstanceSettings(makeReq({ isInstanceAdmin: true }) as any)
    ).not.toThrow();
  });

  it("throws 403 for session board with isInstanceAdmin=false", async () => {
    const { assertCanManageInstanceSettings } = await import("../routes/authz.js");
    expect(() =>
      assertCanManageInstanceSettings(makeReq() as any)
    ).toThrow(/Instance admin access required/);
  });

  it("throws 403 for non-board actor", async () => {
    const { assertCanManageInstanceSettings } = await import("../routes/authz.js");
    expect(() =>
      assertCanManageInstanceSettings({ actor: { type: "agent" } } as any)
    ).toThrow(/Board access required/);
  });
});

// ---------------------------------------------------------------------------
// HTTP-level tests: plugin admin routes
// ---------------------------------------------------------------------------

describe("plugin admin routes — non-admin board gets 403", () => {
  function makeApp(actor: object) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    // Mount with minimal stubs — authz fires before any db/loader access
    const db = {} as any;
    const loader = {} as any;
    const router = pluginRoutes(db, loader);
    app.use("/api", router);
    app.use(errorHandler);
    return supertest(app);
  }

  const cases = [
    { method: "post" as const, path: "/api/plugins/install", body: {} },
    { method: "delete" as const, path: "/api/plugins/plugin-test-id" },
    { method: "post" as const, path: "/api/plugins/plugin-test-id/enable", body: {} },
    { method: "post" as const, path: "/api/plugins/plugin-test-id/disable", body: {} },
    { method: "post" as const, path: "/api/plugins/plugin-test-id/upgrade", body: {} },
    { method: "post" as const, path: "/api/plugins/plugin-test-id/config", body: {} },
    { method: "post" as const, path: "/api/plugins/plugin-test-id/config/test", body: {} },
    { method: "post" as const, path: "/api/plugins/plugin-test-id/jobs/job-test-id/trigger", body: {} },
    { method: "post" as const, path: "/api/plugins/plugin-test-id/rollback", body: {} },
  ];

  for (const { method, path, body } of cases) {
    it(`${method.toUpperCase()} ${path} → 403 for non-admin board`, async () => {
      const agent = makeApp(NON_ADMIN);
      const req = agent[method](path);
      if (body !== undefined) req.send(body);
      const res = await req;
      expect(res.status).toBe(403);
    });

    it(`${method.toUpperCase()} ${path} → NOT 403 for local_implicit`, async () => {
      const agent = makeApp(LOCAL_IMPLICIT);
      const req = agent[method](path);
      if (body !== undefined) req.send(body);
      const res = await req;
      expect(res.status).not.toBe(403);
    });
  }
});

// ---------------------------------------------------------------------------
// HTTP-level tests: marketplace catalog/sync
// ---------------------------------------------------------------------------

describe("marketplace catalog/sync — non-admin board gets 403", () => {
  function makeMarketplaceApp(actor: object) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    const mockService = {
      sync: vi.fn().mockResolvedValue({ itemCount: 0 }),
      readCache: vi.fn().mockResolvedValue(null),
      getStatus: vi.fn().mockResolvedValue(null),
    };
    const router = createMarketplaceRouter({ service: mockService as any });
    app.use("/api/marketplace", router);
    app.use(errorHandler);
    return supertest(app);
  }

  it("POST /api/marketplace/catalog/sync → 403 for non-admin", async () => {
    const res = await makeMarketplaceApp(NON_ADMIN).post("/api/marketplace/catalog/sync");
    expect(res.status).toBe(403);
  });

  it("POST /api/marketplace/catalog/sync → NOT 403 for local_implicit", async () => {
    const res = await makeMarketplaceApp(LOCAL_IMPLICIT).post("/api/marketplace/catalog/sync");
    expect(res.status).not.toBe(403);
  });
});
