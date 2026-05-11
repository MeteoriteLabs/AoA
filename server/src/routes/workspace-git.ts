/**
 * Git operations routes for execution workspaces.
 *
 * Exposes 4 endpoints:
 *   GET  /execution-workspaces/:id/git/status
 *   GET  /execution-workspaces/:id/git/log
 *   POST /execution-workspaces/:id/git/commit
 *   POST /execution-workspaces/:id/git/push
 *
 * All routes use resolveWorkspaceGit() helper to DRY the shared preamble:
 * workspace lookup, access check, git root resolution, and null handling.
 */

import { and, eq, inArray } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { heartbeatRuns, issues } from "@armyofagents/db";
import { executionWorkspaceService } from "../services/index.js";
import { assertCompanyAccess } from "./authz.js";
import { assertCanControlWorkspace } from "../services/workspace-authz.js";
import {
  resolveGitRoot,
  getStatus,
  getLog,
  commit,
  push,
  getCachedStatus,
  setCachedStatus,
  invalidateStatusCache,
  type GitStatusResult,
} from "../services/git.js";

// ---------------------------------------------------------------------------
// Shared preamble helper
// ---------------------------------------------------------------------------

interface WorkspaceGitContext {
  workspace: {
    id: string;
    companyId: string;
    projectId: string | null;
    cwd: string | null;
  };
  gitRoot: string;
}

/**
 * Shared preamble for all git routes.
 * Looks up workspace, verifies access, resolves git root.
 * Sends error response and returns null if any step fails.
 */
async function resolveWorkspaceGit(
  db: Db,
  req: Request,
  res: Response,
  id: string,
  opts?: { requireControl?: boolean },
): Promise<WorkspaceGitContext | null> {
  const svc = executionWorkspaceService(db);
  const workspace = await svc.getById(id);

  if (!workspace) {
    res.status(404).json({ error: "Execution workspace not found" });
    return null;
  }

  assertCompanyAccess(req, workspace.companyId);

  if (opts?.requireControl) {
    await assertCanControlWorkspace(db, req, {
      companyId: workspace.companyId,
      projectId: workspace.projectId ?? null,
    });
  }

  const cwd = workspace.cwd;
  if (!cwd) {
    res.json({ gitAvailable: false, reason: "Workspace has no local directory path." });
    return null;
  }

  const gitRoot = await resolveGitRoot(cwd);
  if (!gitRoot) {
    res.json({ gitAvailable: false, reason: "This workspace directory is not a git repository." });
    return null;
  }

  return {
    workspace: {
      id: workspace.id,
      companyId: workspace.companyId,
      projectId: workspace.projectId ?? null,
      cwd,
    },
    gitRoot,
  };
}

// ---------------------------------------------------------------------------
// Active run check (soft warning for write operations)
// ---------------------------------------------------------------------------

async function hasActiveRunForWorkspace(db: Db, workspaceId: string): Promise<boolean> {
  try {
    // Find issues linked to this workspace, then check for active runs on their assigned agents
    const linkedIssues = await db
      .select({ assigneeAgentId: issues.assigneeAgentId })
      .from(issues)
      .where(eq(issues.executionWorkspaceId, workspaceId));

    const agentIds = linkedIssues
      .map((i) => i.assigneeAgentId)
      .filter((id): id is string => id !== null);

    if (agentIds.length === 0) return false;

    const activeRuns = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(
        and(
          inArray(heartbeatRuns.agentId, agentIds),
          inArray(heartbeatRuns.status, ["queued", "running"]),
        ),
      )
      .limit(1);

    return activeRuns.length > 0;
  } catch {
    return false; // Fail open — don't block git operations if the check fails
  }
}

// ---------------------------------------------------------------------------
// Secret retrieval for push auth
// ---------------------------------------------------------------------------

async function getGitHubPat(db: Db, companyId: string): Promise<string | null> {
  try {
    // Import dynamically to avoid circular dependency
    const { secretService } = await import("../services/index.js");
    const svc = secretService(db);
    const secret = await svc.getByName(companyId, "github_pat");
    if (!secret) return null;
    return await svc.resolveSecretValue(companyId, secret.id, "latest");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function workspaceGitRoutes(db: Db) {
  const router = Router();

  // GET /execution-workspaces/:id/git/status
  router.get("/execution-workspaces/:id/git/status", async (req, res) => {
    const ctx = await resolveWorkspaceGit(db, req, res, req.params.id);
    if (!ctx) return;

    // Check cache first
    const cached = getCachedStatus(ctx.workspace.id);
    if (cached) {
      res.json({ gitAvailable: true, ...cached });
      return;
    }

    const status = await getStatus(ctx.gitRoot);
    setCachedStatus(ctx.workspace.id, status);
    res.json({ gitAvailable: true, ...status });
  });

  // GET /execution-workspaces/:id/git/log
  router.get("/execution-workspaces/:id/git/log", async (req, res) => {
    const ctx = await resolveWorkspaceGit(db, req, res, req.params.id);
    if (!ctx) return;

    const limit = req.query.limit ? Number.parseInt(req.query.limit as string, 10) : 5;
    const safeLimit = Number.isNaN(limit) || limit < 1 ? 5 : Math.min(limit, 50);

    const entries = await getLog(ctx.gitRoot, safeLimit);
    res.json({ gitAvailable: true, entries });
  });

  // POST /execution-workspaces/:id/git/commit
  router.post("/execution-workspaces/:id/git/commit", async (req, res) => {
    const ctx = await resolveWorkspaceGit(db, req, res, req.params.id, { requireControl: true });
    if (!ctx) return;

    const { message, files } = req.body as { message?: string; files?: string[] };

    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "Commit message is required." });
      return;
    }

    if (!files || !Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: "Files array is required. Select files to commit." });
      return;
    }

    try {
      const result = await commit(ctx.gitRoot, message, files);

      // Check for active agent run (soft warning)
      const hasActiveRun = await hasActiveRunForWorkspace(db, ctx.workspace.id);
      if (hasActiveRun) {
        result.activeRunWarning = true;
      }

      // Invalidate status cache after successful commit
      invalidateStatusCache(ctx.workspace.id);

      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Commit failed";
      // Detached HEAD and path traversal errors are user-facing
      if (msg.includes("detached HEAD") || msg.includes("escapes the repository") || msg.includes("deny-list")) {
        res.status(400).json({ error: msg });
        return;
      }
      res.status(500).json({ error: msg });
    }
  });

  // POST /execution-workspaces/:id/git/push
  router.post("/execution-workspaces/:id/git/push", async (req, res) => {
    const ctx = await resolveWorkspaceGit(db, req, res, req.params.id, { requireControl: true });
    if (!ctx) return;

    const { remote, branch } = req.body as { remote?: string; branch?: string };

    try {
      // Retrieve stored GitHub PAT for authentication
      const pat = await getGitHubPat(db, ctx.workspace.companyId);

      const result = await push(ctx.gitRoot, remote, branch, pat ? { pat } : undefined);

      // Check for active agent run (soft warning)
      const hasActiveRun = await hasActiveRunForWorkspace(db, ctx.workspace.id);
      if (hasActiveRun) {
        result.activeRunWarning = true;
      }

      // Invalidate status cache after successful push
      invalidateStatusCache(ctx.workspace.id);

      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Push failed";
      if (msg.includes("detached HEAD") || msg.includes("No remote configured")) {
        res.status(400).json({ error: msg });
        return;
      }
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
