import type { RequestHandler } from "express";
import { forbidden, unauthorized } from "../errors.js";
import {
  assertBoard,
  assertCompanyAccess,
} from "../routes/authz.js";

/**
 * Import bundles can be much larger than the global JSON limit. These guards
 * use only actor and path data, so they must run before the 20 MB parser.
 */
export const authorizeNewCompanyImportBody: RequestHandler = (
  req,
  _res,
  next
) => {
  assertBoard(req);
  if (!(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)) {
    throw forbidden("Instance admin required");
  }
  next();
};

export const authorizeExistingCompanyImportBody: RequestHandler = (
  req,
  _res,
  next
) => {
  // This middleware is mounted on the shared `/import` prefix, so req.path is
  // `/preview` for the read-only preview endpoint and `/` for the mutating
  // commit endpoint. Preview remains available to company-scoped actors, while
  // a commit must reject agent/MCP credentials before the 20 MB parser runs.
  const isPreview = /^\/preview\/?$/.test(req.path);
  if (!isPreview) {
    assertBoard(req);
  }
  assertCompanyAccess(req, req.params.companyId as string);
  next();
};

/**
 * Legacy import routes carry their target in the body, so company-level
 * authorization cannot run until after parsing. Still require an authenticated
 * actor (and a board actor for the mutating route) before accepting the larger
 * compatibility payload.
 */
export const authorizeLegacyCompanyImportBody: RequestHandler = (
  req,
  _res,
  next
) => {
  const isPreview = /\/preview\/?$/.test(req.path);
  if (isPreview) {
    if (req.actor.type === "none") {
      throw unauthorized();
    }
  } else {
    assertBoard(req);
  }
  next();
};
