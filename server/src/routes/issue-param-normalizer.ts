import type { Router } from "express";
import type { Db } from "@armyofagents/db";
import { issueService } from "../services/issues.js";

const ISSUE_IDENTIFIER_RE = /^[A-Z]+-\d+$/i;

export function createIssueParamNormalizer(db: Db) {
  const issues = issueService(db);

  return async function normalizeIssueParam(rawId: string): Promise<string> {
    if (ISSUE_IDENTIFIER_RE.test(rawId)) {
      const issue = await issues.getByIdentifier(rawId);
      if (issue) return issue.id;
    }
    return rawId;
  };
}

export function registerIssueParamNormalizer(
  router: Router,
  db: Db,
  paramNames: string[],
) {
  const normalizeIssueParam = createIssueParamNormalizer(db);
  for (const paramName of paramNames) {
    router.param(paramName, async (req, _res, next, rawId) => {
      try {
        req.params[paramName] = await normalizeIssueParam(rawId);
        next();
      } catch (err) {
        next(err);
      }
    });
  }
}
