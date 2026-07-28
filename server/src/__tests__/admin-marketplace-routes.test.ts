import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { createAdminMarketplaceRouter } from "../routes/admin-marketplace.js";
import {
  MarketplaceCatalogRefreshError,
  MarketplaceReconcileExecutionError,
  type MarketplaceReconcileResult,
} from "../services/marketplace-reconcile.js";

const RESULT: MarketplaceReconcileResult = {
  operationId: "operation-1",
  status: "success",
  repairs: {
    crewCompaniesRepaired: 0,
    legacyStewardsAdopted: 0,
    teamsReconciled: 0,
    teamMembersAdded: 0,
  },
  catalog: {
    generatedAt: "2026-07-28T00:00:00.000Z",
    canonicalDigestSha256: "a".repeat(64),
    schemaVersion: "1.0.0",
    itemCount: 0,
    source: "cdn",
  },
  companiesExamined: 1,
  crewRepair: {
    catalogReady: true,
    inspected: 1,
    repaired: 0,
    skippedFailClosed: 0,
    skippedCooldown: 0,
    skippedOverBudget: 0,
    failed: 0,
  },
  legacySteward: {
    disabled: false,
    catalogReady: true,
    inspected: 0,
    adopted: 0,
    skippedOverBudget: 0,
    failed: 0,
  },
  crewUpdates: { succeeded: 1, failed: 0 },
  teamReconcile: { teamsReconciled: 0, membersAdded: 0 },
  failures: [],
};

function makeApp(
  actor: object,
  reconcile: () => Promise<MarketplaceReconcileResult>,
  onRequest?: () => void,
) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    onRequest?.();
    next();
  });
  app.use(
    "/api/admin/marketplace",
    createAdminMarketplaceRouter({ reconcile }),
  );
  app.use(errorHandler);
  return app;
}

describe("POST /api/admin/marketplace/reconcile", () => {
  it("rejects an unauthenticated request", async () => {
    const reconcile = vi.fn().mockResolvedValue(RESULT);
    const response = await request(
      makeApp({ type: "none", source: "none" }, reconcile),
    ).post("/api/admin/marketplace/reconcile");

    expect(response.status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("rejects a board user who is not an instance admin", async () => {
    const reconcile = vi.fn().mockResolvedValue(RESULT);
    const response = await request(
      makeApp(
        {
          type: "board",
          source: "session",
          isInstanceAdmin: false,
          companyIds: ["company-1"],
        },
        reconcile,
      ),
    ).post("/api/admin/marketplace/reconcile");

    expect(response.status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("allows an instance admin and returns the operation artifact", async () => {
    const reconcile = vi.fn().mockResolvedValue(RESULT);
    const response = await request(
      makeApp(
        {
          type: "board",
          source: "session",
          userId: "admin-1",
          isInstanceAdmin: true,
          companyIds: [],
        },
        reconcile,
      ),
    ).post("/api/admin/marketplace/reconcile");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      operationId: "operation-1",
      replayed: false,
      status: "success",
      catalog: {
        canonicalDigestSha256: "a".repeat(64),
      },
    });
    expect(reconcile).toHaveBeenCalledWith({
      actorType: "user",
      actorId: "admin-1",
    });
  });

  it("joins a concurrent replay to the same operation", async () => {
    let resolveOperation!: (result: MarketplaceReconcileResult) => void;
    const pending = new Promise<MarketplaceReconcileResult>((resolve) => {
      resolveOperation = resolve;
    });
    const reconcile = vi.fn(() => pending);
    let requestsEntered = 0;
    let resolveBothEntered!: () => void;
    const bothEntered = new Promise<void>((resolve) => {
      resolveBothEntered = resolve;
    });
    const app = makeApp(
      {
        type: "board",
        source: "session",
        isInstanceAdmin: true,
        companyIds: [],
      },
      reconcile,
      () => {
        requestsEntered += 1;
        if (requestsEntered === 2) resolveBothEntered();
      },
    );

    const first = request(app).post("/api/admin/marketplace/reconcile");
    const firstResponse = first.then((response) => response);
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1));
    const secondResponse = request(app)
      .post("/api/admin/marketplace/reconcile")
      .then((response) => response);
    await bothEntered;
    expect(reconcile).toHaveBeenCalledTimes(1);

    resolveOperation(RESULT);
    const [firstResult, secondResult] = await Promise.all([
      firstResponse,
      secondResponse,
    ]);

    expect(firstResult.status).toBe(200);
    expect(secondResult.status).toBe(200);
    expect(firstResult.body.operationId).toBe("operation-1");
    expect(secondResult.body.operationId).toBe("operation-1");
    expect(
      [firstResult.body.replayed, secondResult.body.replayed].sort(),
    ).toEqual([false, true]);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("returns the operation ID when maintenance fails", async () => {
    const response = await request(
      makeApp(
        {
          type: "board",
          source: "session",
          isInstanceAdmin: true,
          companyIds: [],
        },
        vi.fn().mockRejectedValue(
          new MarketplaceReconcileExecutionError("operation-failed"),
        ),
      ),
    ).post("/api/admin/marketplace/reconcile");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Marketplace reconciliation failed",
      operationId: "operation-failed",
    });
  });

  it("returns 502 without running maintenance when catalog refresh fails", async () => {
    const response = await request(
      makeApp(
        {
          type: "board",
          source: "session",
          isInstanceAdmin: true,
          companyIds: [],
        },
        vi.fn().mockRejectedValue(
          new MarketplaceCatalogRefreshError(
            "operation-catalog",
            {
              lastSyncedAt: "2026-07-28T00:00:00.000Z",
              lastSyncStatus: "failure",
              lastSyncError: "network down",
              source: "cdn",
              schemaVersion: "1.0.0",
              itemCount: 0,
            },
            "failure",
            "network down",
          ),
        ),
      ),
    ).post("/api/admin/marketplace/reconcile");

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({
      error: "Marketplace catalog refresh failed; no reconciliation was run",
      operationId: "operation-catalog",
      catalogStatus: { lastSyncStatus: "failure" },
      catalogOutcome: "failure",
      catalogError: "network down",
    });
  });
});
