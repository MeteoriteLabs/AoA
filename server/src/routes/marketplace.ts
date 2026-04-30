/**
 * @fileoverview Marketplace catalog REST API routes
 *
 * - GET /api/marketplace/catalog        — return latest cached catalog
 * - POST /api/marketplace/catalog/sync  — trigger manual sync (founder only)
 * - GET /api/marketplace/catalog/status — sync metadata (last sync, source, version)
 */

import { Router } from "express";
import type { MarketplaceCatalogService } from "../services/aoa-marketplace.js";
import { assertBoard } from "./authz.js";

export interface MarketplaceRoutesDeps {
  service: MarketplaceCatalogService;
}

export function createMarketplaceRouter(deps: MarketplaceRoutesDeps): Router {
  const { service } = deps;
  const router = Router();

  router.get("/catalog", async (_req, res) => {
    const catalog = await service.readCache();
    if (!catalog) {
      res.status(503).json({ error: "Catalog not yet synced" });
      return;
    }
    res.json(catalog);
  });

  router.post("/catalog/sync", async (req, res) => {
    assertBoard(req);
    const catalog = await service.sync();
    if (!catalog) {
      res.status(502).json({ error: "Sync failed", status: await service.getStatus() });
      return;
    }
    res.json({ status: await service.getStatus(), itemCount: catalog.itemCount });
  });

  router.get("/catalog/status", async (_req, res) => {
    const status = await service.getStatus();
    if (!status) {
      res.status(404).json({ error: "No catalog cached yet" });
      return;
    }
    res.json(status);
  });

  return router;
}
