import type { Request, Router } from "express";
import type { Db } from "@armyofagents/db";
import { issueService } from "../services/issues.js";

const ISSUE_IDENTIFIER_RE = /^[A-Z]+-\d+$/i;

export function createIssueParamNormalizer(db: Db) {
  const issues = issueService(db);

  /**
   * Resolve an issue identifier (e.g. `ACM-1`) to its UUID. When `companyId`
   * is provided, the lookup is company-scoped (`getByIdentifierInCompany`) so
   * an identifier that two orgs' companies both own resolves to THIS company's
   * task — never another org's. When `companyId` is absent (bare
   * `/issues/:id…` routes with no company in the URL), it falls back to the
   * UNSCOPED global resolve; those callers re-check authz on the resolved
   * issue's company, so the global resolve cannot leak across tenants (see
   * `issueService.getByIdentifier` doc).
   */
  return async function normalizeIssueParam(
    rawId: string,
    companyId?: string,
  ): Promise<string> {
    if (ISSUE_IDENTIFIER_RE.test(rawId)) {
      const issue = companyId
        ? await issues.getByIdentifierInCompany(companyId, rawId)
        : await issues.getByIdentifier(rawId);
      if (issue) return issue.id;
    }
    return rawId;
  };
}

/**
 * Register `router.param` normalizers that resolve issue identifiers to UUIDs.
 *
 * When `companyParamName` is supplied AND that param is present on the request
 * (a company-scoped route such as `/companies/:companyId/issues/:issueId/…`),
 * the resolve is company-scoped. Otherwise it falls back to the unscoped global
 * resolve (bare `/issues/:id…` routes). Express populates all of a matched
 * route's params before the param callbacks fire, and `:companyId` precedes
 * `:issueId` in the company-scoped route paths, so `req.params[companyParamName]`
 * is available here without needing `mergeParams`.
 */
export function registerIssueParamNormalizer(
  router: Router,
  db: Db,
  paramNames: string[],
  companyParamName?: string,
) {
  const normalizeIssueParam = createIssueParamNormalizer(db);
  for (const paramName of paramNames) {
    router.param(paramName, async (req: Request, _res, next, rawId) => {
      try {
        const companyId = companyParamName
          ? (req.params[companyParamName] as string | undefined)
          : undefined;
        req.params[paramName] = await normalizeIssueParam(rawId, companyId);
        next();
      } catch (err) {
        next(err);
      }
    });
  }
}
