import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { SEARCH_ENTITY_TYPES, type SearchEntityType } from "@paperclipai/shared";
import { groupSearchResults, searchService } from "../services/index.js";
import { assertCompanyAccess } from "./authz.js";

function parseEntityTypes(raw: string | undefined): SearchEntityType[] | null {
  if (!raw) return [...SEARCH_ENTITY_TYPES];
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) return [...SEARCH_ENTITY_TYPES];
  if (values.some((value) => !SEARCH_ENTITY_TYPES.includes(value as SearchEntityType))) {
    return null;
  }
  return values as SearchEntityType[];
}

export function searchRoutes(db: Db) {
  const router = Router();
  const svc = searchService(db);

  router.get("/companies/:companyId/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const entityTypes = parseEntityTypes(req.query.types as string | undefined);
    if (!entityTypes) {
      res.status(400).json({
        error: `types must contain only: ${SEARCH_ENTITY_TYPES.join(", ")}`,
      });
      return;
    }

    const results = await svc.search(companyId, (req.query.q as string | undefined) ?? "", entityTypes);
    res.json(groupSearchResults(results));
  });

  return router;
}
