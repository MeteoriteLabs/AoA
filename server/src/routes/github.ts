import { Router } from "express";
import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { activityLog, type Db } from "@armyofagents/db";
import { and, desc, eq } from "drizzle-orm";
import {
  GITHUB_PAT_ACTIVITY_KINDS,
  GITHUB_PAT_SECRET_NAME,
  type GitHubPrMetadata,
  type GitHubPrSyncResponse,
} from "@armyofagents/shared";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { logActivity, secretService } from "../services/index.js";
import { issueService } from "../services/issues.js";
import { executionWorkspaceService } from "../services/execution-workspaces.js";
import { createPullRequest, findPullRequestForBranch, GitHubPrError } from "../services/github-pr.js";
import { resolveGitRoot, runGit, push } from "../services/git.js";
const setPatSchema = z.object({ pat: z.string().min(1) });
const syncPrBodySchema = z.object({ force: z.boolean().optional().default(false) });
const createPrBodySchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1),
  body: z.string(),
  base: z.string().min(1),
  draft: z.boolean().default(false),
  /** Explicit head branch — used when workspace.branchName is null (local_fs). */
  head: z.string().min(1).optional(),
});

async function resolveGithubUserFromConnectActivity(
  db: Db,
  companyId: string,
  secretId: string,
): Promise<string | null> {
  try {
    const rows = await db
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.action, GITHUB_PAT_ACTIVITY_KINDS.CONNECTED),
          eq(activityLog.entityId, secretId),
        ),
      )
      .orderBy(desc(activityLog.createdAt))
      .limit(1);
    const githubUser = rows[0]?.details?.githubUser;
    return typeof githubUser === "string" && githubUser.trim().length > 0
      ? githubUser
      : null;
  } catch {
    return null;
  }
}

function isRecentGithubSync(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && Date.now() - time < 60_000;
}

function readGitHubPrMetadata(value: unknown): GitHubPrMetadata | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<GitHubPrMetadata>;
  if (
    typeof candidate.url !== "string" ||
    typeof candidate.number !== "number" ||
    (candidate.state !== "open" && candidate.state !== "closed" && candidate.state !== "merged") ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }
  return {
    url: candidate.url,
    number: candidate.number,
    state: candidate.state,
    createdAt: candidate.createdAt,
    draft: candidate.draft ?? false,
  };
}

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
      action: GITHUB_PAT_ACTIVITY_KINDS.CONNECTED,
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
      action: GITHUB_PAT_ACTIVITY_KINDS.DISCONNECTED,
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
    if (!row || row.status !== "active") {
      res.json({ configured: false });
      return;
    }
    const githubUser =
      row.externalRef ??
      (await resolveGithubUserFromConnectActivity(db, companyId, row.id));
    res.json({
      configured: true,
      githubUser,
      createdAt: row.createdAt,
    });
  });

  /**
   * Reconcile a workspace branch against GitHub PRs. This is used by the
   * workspace Git panel to show real PR state even when the PR was created
   * outside this app or before metadata was persisted locally.
   */
  router.post("/execution-workspaces/:id/github-pr/sync", async (req, res) => {
    assertBoard(req);

    const parsed = syncPrBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
      return;
    }

    const wsSvc = executionWorkspaceService(db);
    const ws = await wsSvc.getById(req.params.id);
    if (!ws) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    assertCompanyAccess(req, ws.companyId);

    if (!ws.repoUrl) {
      res.status(400).json({ error: "Workspace missing repoUrl - cannot sync PR" });
      return;
    }
    if (!ws.branchName) {
      res.status(400).json({ error: "Workspace missing branchName - cannot sync PR" });
      return;
    }

    const existingMeta = (ws.metadata as Record<string, unknown> | null) ?? {};
    if (!parsed.data.force && isRecentGithubSync(existingMeta.githubLastSyncedAt)) {
      const response: GitHubPrSyncResponse = {
        workspaceId: ws.id,
        repoUrl: ws.repoUrl,
        branchName: ws.branchName,
        baseRef: ws.baseRef ?? null,
        pr: readGitHubPrMetadata(existingMeta.pr),
        githubLastSyncedAt: existingMeta.githubLastSyncedAt,
        githubSyncError:
          typeof existingMeta.githubSyncError === "string" ? existingMeta.githubSyncError : null,
        cached: true,
      };
      res.json(response);
      return;
    }

    const now = new Date().toISOString();
    try {
      const result = await findPullRequestForBranch(db, {
        companyId: ws.companyId,
        repoUrl: ws.repoUrl,
        branchName: ws.branchName,
      });
      const nextBaseRef = ws.baseRef ?? result.baseRef ?? null;
      const nextMetadata: Record<string, unknown> = {
        ...existingMeta,
        githubLastSyncedAt: now,
        githubSyncError: null,
        noPrFound: result.pr ? false : true,
      };
      if (result.pr) {
        nextMetadata.pr = result.pr;
      } else {
        delete nextMetadata.pr;
      }

      const update: {
        baseRef?: string;
        metadata: Record<string, unknown>;
      } = { metadata: nextMetadata };
      if (nextBaseRef && nextBaseRef !== ws.baseRef) {
        update.baseRef = nextBaseRef;
      }
      await wsSvc.update(ws.id, update);

      const response: GitHubPrSyncResponse = {
        workspaceId: ws.id,
        repoUrl: ws.repoUrl,
        branchName: ws.branchName,
        baseRef: nextBaseRef,
        pr: result.pr,
        githubLastSyncedAt: now,
        githubSyncError: null,
        cached: false,
      };
      res.json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "GitHub sync failed";
      await wsSvc.update(ws.id, {
        metadata: {
          ...existingMeta,
          githubLastSyncedAt: now,
          githubSyncError: message,
        },
      });

      if (err instanceof GitHubPrError) {
        res.status(err.status).json({ error: err.message, hint: err.scopeHint });
        return;
      }
      res.status(502).json({ error: "GitHub sync failed", hint: message });
    }
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

    // Resolve head branch: client-provided > DB record > live git detection
    let headBranch = parsed.data.head ?? ws.branchName ?? null;
    if (!headBranch && ws.cwd) {
      try {
        const gitRoot = await resolveGitRoot(ws.cwd);
        if (gitRoot) {
          const detected = await runGit(["branch", "--show-current"], gitRoot, { timeout: 5_000 });
          if (detected) headBranch = detected;
        }
      } catch {
        // Fall through — headBranch stays null
      }
    }

    if (!headBranch) {
      res.status(400).json({ error: "Cannot determine head branch — no branchName in DB and git detection failed" });
      return;
    }

    // Auto-push: ensure the branch exists on the remote before creating the PR.
    // Without this, GitHub returns 422 ("head sha can't be blank").
    if (ws.cwd) {
      try {
        const gitRoot = await resolveGitRoot(ws.cwd);
        if (gitRoot) {
          try {
            await runGit(["remote", "get-url", "origin"], gitRoot, { timeout: 5_000 });
          } catch {
            await runGit(["remote", "add", "origin", ws.repoUrl], gitRoot, { timeout: 5_000 });
          }

          // Check if the branch has an upstream. If not, push it.
          try {
            await runGit(
              ["rev-parse", "--abbrev-ref", `${headBranch}@{upstream}`],
              gitRoot,
              { timeout: 5_000 },
            );
          } catch {
            // No upstream — need to push. Retrieve PAT for auth.
            const sSvc = secretService(db);
            const secret = await sSvc.getByName(issue.companyId, GITHUB_PAT_SECRET_NAME);
            const pat = secret
              ? await sSvc.resolveSecretValue(issue.companyId, secret.id, "latest", {
                  consumerType: "system",
                  consumerId: "github:auto-push",
                  actorType: "system",
                  issueId: issue.id,
                  configPath: "github.pat",
                }).catch(() => null)
              : null;
            await push(gitRoot, "origin", headBranch, pat ? { pat } : undefined);
          }
        }
      } catch (pushErr) {
        const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        res.status(400).json({
          error: `Failed to push branch "${headBranch}" to remote before creating PR`,
          hint: msg,
        });
        return;
      }
    }

    try {
      const pr = await createPullRequest(db, {
        companyId: issue.companyId,
        repoUrl: ws.repoUrl,
        base: parsed.data.base,
        head: headBranch,
        title: parsed.data.title,
        body: parsed.data.body,
        draft: parsed.data.draft,
      });

      const now = new Date().toISOString();
      const prMetadata: GitHubPrMetadata = {
        url: pr.url,
        number: pr.number,
        state: pr.state,
        createdAt: now,
        draft: pr.draft,
      };

      const existingMeta = (ws.metadata as Record<string, unknown> | null) ?? {};
      const update: {
        baseRef?: string;
        metadata: Record<string, unknown>;
      } = {
        metadata: {
          ...existingMeta,
          pr: prMetadata,
          githubLastSyncedAt: now,
          githubSyncError: null,
          noPrFound: false,
        },
      };
      if (!ws.baseRef) {
        update.baseRef = parsed.data.base;
      }
      await wsSvc.update(ws.id, update);

      await issueSvcInstance.addComment(
        issue.id,
        `Pull request created: ${pr.url}`,
        { userId: req.actor.userId ?? "board", agentId: undefined },
      );

      await logActivity(db, {
        companyId: issue.companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: GITHUB_PAT_ACTIVITY_KINDS.PR_CREATED,
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
