import { Router } from "express";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import type { Db } from "@armyofagents/db";
import type { GitHubPrMetadata } from "@armyofagents/shared";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { logActivity, secretService } from "../services/index.js";
import { issueService } from "../services/issues.js";
import { executionWorkspaceService } from "../services/execution-workspaces.js";
import {
  createPullRequest,
  GitHubPrError,
  GITHUB_PAT_SECRET_NAME,
} from "../services/github-pr.js";

// Re-export so callers (tests, UI-adjacent server code) can keep importing
// the canonical secret name from the routes module.
export { GITHUB_PAT_SECRET_NAME };
const setPatSchema = z.object({ pat: z.string().min(1) });
const createPrBodySchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1),
  body: z.string(),
  base: z.string().min(1),
  draft: z.boolean().default(false),
});

export function githubRoutes(db: Db) {
  const router = Router();
  const svc = secretService(db);

  /**
   * Save a GitHub PAT for this company. Verifies the PAT via Octokit before
   * storing. Any existing PAT row is deleted first so re-saves are idempotent.
   * The PAT itself is never echoed back — only `{configured, githubUser}`.
   */
  router.post("/companies/:companyId/github/pat", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const parsed = setPatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    let githubUser: string;
    try {
      const octokit = new Octokit({ auth: parsed.data.pat });
      const { data } = await octokit.users.getAuthenticated();
      githubUser = data.login;
    } catch {
      res.status(400).json({ error: "Invalid GitHub PAT" });
      return;
    }

    // Replace any existing PAT (idempotent — `delete` returns false when none).
    await svc.delete(companyId, GITHUB_PAT_SECRET_NAME);
    const created = await svc.create(
      companyId,
      {
        name: GITHUB_PAT_SECRET_NAME,
        provider: "local_encrypted",
        value: parsed.data.pat,
        description: `GitHub PAT for ${githubUser}`,
        externalRef: githubUser,
      },
      { userId: req.actor.userId ?? "board", agentId: null },
    );

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "github.pat.connected",
      entityType: "secret",
      entityId: created.id,
      details: { githubUser },
    });

    res.json({ configured: true, githubUser });
  });

  /** Remove the stored GitHub PAT. Idempotent. */
  router.delete("/companies/:companyId/github/pat", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const existing = await svc.getByName(companyId, GITHUB_PAT_SECRET_NAME);
    if (!existing) {
      res.json({ configured: false, removed: false });
      return;
    }

    await svc.delete(companyId, GITHUB_PAT_SECRET_NAME);
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "github.pat.disconnected",
      entityType: "secret",
      entityId: existing.id,
      details: { githubUser: existing.externalRef ?? null },
    });

    res.json({ configured: false, removed: true });
  });

  /** Read whether a PAT is configured — never returns the PAT itself. */
  router.get("/companies/:companyId/github/pat/status", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const row = await svc.getByName(companyId, GITHUB_PAT_SECRET_NAME);
    if (!row) {
      res.json({ configured: false });
      return;
    }
    res.json({
      configured: true,
      githubUser: row.externalRef ?? null,
      createdAt: row.createdAt,
    });
  });

  /**
   * Create a GitHub pull request for a task using the company's stored PAT.
   * Persists the PR URL into the linked execution workspace's `metadata.pr`,
   * posts a task comment, and writes an activity log entry.
   */
  router.post("/issues/:issueId/github-pr", async (req, res) => {
    assertBoard(req);

    const parsed = createPrBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
      return;
    }

    const issueSvcInstance = issueService(db);
    const issue = await issueSvcInstance.getById(req.params.issueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);

    const wsSvc = executionWorkspaceService(db);
    const ws = await wsSvc.getById(parsed.data.workspaceId);
    if (!ws) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    if (ws.companyId !== issue.companyId) {
      res.status(403).json({ error: "Workspace does not belong to issue's company" });
      return;
    }
    if (!ws.repoUrl) {
      res.status(400).json({ error: "Workspace missing repoUrl — cannot create PR" });
      return;
    }
    if (!ws.branchName) {
      res.status(400).json({ error: "Workspace missing branchName — cannot create PR" });
      return;
    }

    try {
      const pr = await createPullRequest(db, {
        companyId: issue.companyId,
        repoUrl: ws.repoUrl,
        base: parsed.data.base,
        head: ws.branchName,
        title: parsed.data.title,
        body: parsed.data.body,
        draft: parsed.data.draft,
      });

      const prMetadata: GitHubPrMetadata = {
        url: pr.url,
        number: pr.number,
        state: pr.state,
        createdAt: new Date().toISOString(),
        draft: pr.draft,
      };

      const existingMeta = (ws.metadata as Record<string, unknown> | null) ?? {};
      await wsSvc.update(ws.id, {
        metadata: {
          ...existingMeta,
          pr: prMetadata,
        },
      });

      await issueSvcInstance.addComment(
        issue.id,
        `Pull request created: ${pr.url}`,
        { userId: req.actor.userId ?? "board", agentId: undefined },
      );

      await logActivity(db, {
        companyId: issue.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "github.pr.created",
        entityType: "issue",
        entityId: issue.id,
        details: {
          prUrl: pr.url,
          prNumber: pr.number,
          workspaceId: ws.id,
          draft: pr.draft,
        },
      });

      res.json(pr);
    } catch (err) {
      if (err instanceof GitHubPrError) {
        res.status(err.status).json({ error: err.message, hint: err.scopeHint });
        return;
      }
      throw err;
    }
  });

  return router;
}
