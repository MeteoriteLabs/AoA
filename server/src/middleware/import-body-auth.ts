import type { RequestHandler } from "express";
import { forbidden } from "../errors.js";
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
  assertCompanyAccess(req, req.params.companyId as string);
  next();
};
