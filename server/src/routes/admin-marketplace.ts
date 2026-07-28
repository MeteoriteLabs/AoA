import { Router } from "express";
import type {
  MarketplaceReconcileErrorResponse,
  MarketplaceReconcileResponse,
} from "@armyofagents/shared";
import {
  MarketplaceCatalogRefreshError,
  MarketplaceReconcileExecutionError,
  type MarketplaceReconciliationActor,
  type MarketplaceReconcileResult,
} from "../services/marketplace-reconcile.js";
import {
  assertBoard,
  assertCanManageInstanceSettings,
  getActorInfo,
} from "./authz.js";

export interface AdminMarketplaceRoutesDeps {
  reconcile: (
    actor: MarketplaceReconciliationActor,
  ) => Promise<MarketplaceReconcileResult>;
}

/**
 * Instance-wide operational controls. The in-flight join prevents an
 * ambiguous client retry from starting a second fleet pass concurrently.
 * Sequential retries remain safe because every underlying repair is
 * idempotent and re-diagnoses before mutation.
 */
export function createAdminMarketplaceRouter(
  deps: AdminMarketplaceRoutesDeps
): Router {
  const router = Router();
  let inFlight: Promise<MarketplaceReconcileResult> | null = null;

  router.post("/reconcile", async (req, res, next) => {
    try {
      assertBoard(req);
      assertCanManageInstanceSettings(req);

      const replayed = inFlight !== null;
      const actorInfo = getActorInfo(req);
      const operation =
        inFlight ??
        deps.reconcile({
          actorType: "user",
          actorId: actorInfo.actorId,
        });
      if (!inFlight) inFlight = operation;

      try {
        const result = await operation;
        const response: MarketplaceReconcileResponse = {
          ...result,
          replayed,
        };
        res.json(response);
      } finally {
        if (inFlight === operation) inFlight = null;
      }
    } catch (error) {
      if (error instanceof MarketplaceCatalogRefreshError) {
        const response: MarketplaceReconcileErrorResponse = {
          error: error.message,
          operationId: error.operationId,
          catalogStatus: error.catalogStatus,
          catalogOutcome: error.catalogOutcome,
          catalogError: error.catalogError,
        };
        res.status(502).json(response);
        return;
      }
      if (error instanceof MarketplaceReconcileExecutionError) {
        const response: MarketplaceReconcileErrorResponse = {
          error: error.message,
          operationId: error.operationId,
        };
        res.status(500).json(response);
        return;
      }
      next(error);
    }
  });

  return router;
}
