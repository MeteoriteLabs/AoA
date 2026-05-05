import { Router } from "express";
import type { Db } from "@armyofagents/db";
import { searchService } from "../services/index.js";
import { assertCompanyAccess } from "./authz.js";

export function searchRoutes(db: Db) {
  const router = Router();
  const svc = searchService(db);

  router.get("/companies/:companyId/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const q = req.query.q as string | undefined;
    if (!q?.trim()) {
      res.status(400).json({ error: "Query parameter 'q' is required" });
      return;
    }

    const includeArchived = req.query.includeArchived === "true";
    const limitPerType = req.query.limitPerType ? Number(req.query.limitPerType) : undefined;
    const results = await svc.search(companyId, {
      query: q,
      actor: req.actor,
      includeArchived,
      limitPerType: Number.isFinite(limitPerType) ? limitPerType : undefined,
    });

    res.json(results);
  });

  return router;
}
