import { rm } from "node:fs/promises";
import path from "node:path";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { executionWorkspaces, projectWorkspaces } from "@armyofagents/db";
import { logger } from "../middleware/logger.js";

export interface WorkspaceCleanupRetrySweepResult {
  scanned: number;
  recovered: number;
  stillBlocked: number;
  /** Rows archived WITHOUT a filesystem removal because the path is preserved. */
  preserved: number;
}

/**
 * Windows-focused retry: agent heartbeat subprocesses often hold file handles open
 * briefly after a run, so the initial `git worktree remove` / `rm -rf` fails with
 * "Permission denied". Git metadata is already cleaned; only the directory lingers.
 * This sweeper retries filesystem removal for cleanup_failed workspaces that closed
 * more than 60s ago and promotes them to `archived` on success.
 *
 * SAFETY: it mirrors the containment guards in cleanupExecutionWorkspaceArtifacts —
 * it ONLY removes a runtime-created directory, and NEVER a path that is (or contains)
 * a project workspace checkout. A `cleanup_failed` row that fails those gates is a
 * deliberately-preserved workspace that was mis-flagged; it is archived without
 * touching the filesystem. Without this guard the sweeper would `rm -rf` the user's
 * shared project repo and any uncommitted work.
 */
export async function retryCleanupFailedWorkspaces(
  db: Db,
): Promise<WorkspaceCleanupRetrySweepResult> {
  const failed = await db
    .select({
      id: executionWorkspaces.id,
      cwd: executionWorkspaces.cwd,
      providerRef: executionWorkspaces.providerRef,
      providerType: executionWorkspaces.providerType,
      metadata: executionWorkspaces.metadata,
    })
    .from(executionWorkspaces)
    .where(
      and(
        eq(executionWorkspaces.status, "cleanup_failed"),
        lt(executionWorkspaces.closedAt, sql`now() - interval '60 seconds'`),
      ),
    );

  let recovered = 0;
  let stillBlocked = 0;
  let preserved = 0;

  // Project workspace checkouts are the user's real repos / shared working dirs.
  // Never delete a path that equals, or is an ancestor of, one of them.
  const projectCwds = (
    await db.select({ cwd: projectWorkspaces.cwd }).from(projectWorkspaces)
  )
    .map((r) => r.cwd)
    .filter((c): c is string => Boolean(c))
    .map((c) => path.resolve(c));

  const markArchived = async (id: string) => {
    await db
      .update(executionWorkspaces)
      .set({ status: "archived", cleanupReason: null, updatedAt: new Date() })
      .where(eq(executionWorkspaces.id, id));
  };

  for (const ws of failed) {
    const target = ws.providerRef ?? ws.cwd;
    if (!target) {
      // No path to clean — mark archived so we stop re-scanning.
      await markArchived(ws.id);
      recovered++;
      continue;
    }

    // Mirror cleanupExecutionWorkspaceArtifacts' gates: the runtime only ever
    // removes a directory it created, and never one that is/contains a project
    // workspace. A row failing these gates is a preserve case mis-flagged as
    // cleanup_failed — archive it WITHOUT touching the filesystem.
    const createdByRuntime =
      (ws.metadata as Record<string, unknown> | null)?.createdByRuntime === true;
    const resolvedTarget = path.resolve(target);
    const containsProjectWorkspace = projectCwds.some(
      (pc) => resolvedTarget === pc || pc.startsWith(`${resolvedTarget}${path.sep}`),
    );

    // Mirror cleanupExecutionWorkspaceArtifacts' provider-specific gates:
    //  - git_worktree: an isolated runtime worktree dir — always retried,
    //    regardless of createdByRuntime (eager worktrees persist
    //    createdByRuntime:false, providerRef=worktreePath), UNLESS it is/contains
    //    a project workspace.
    //  - local_fs: only the runtime-created directory is removed, never a
    //    shared/external dir, and never one that is/contains a project workspace.
    //  - any other provider: nothing to remove — preserve.
    const removable =
      !containsProjectWorkspace &&
      (ws.providerType === "git_worktree" ||
        (ws.providerType === "local_fs" && createdByRuntime));

    if (!removable) {
      logger.warn(
        {
          wsId: ws.id,
          path: target,
          providerType: ws.providerType,
          createdByRuntime,
          containsProjectWorkspace,
        },
        "cleanup_failed retry skipped: preserved path (not a removable runtime dir, or contains a project workspace); archiving without removal",
      );
      await markArchived(ws.id);
      preserved++;
      continue;
    }

    try {
      await rm(target, { recursive: true, force: true });
      await markArchived(ws.id);
      recovered++;
    } catch (err) {
      stillBlocked++;
      logger.debug(
        { wsId: ws.id, path: target, err },
        "cleanup_failed retry still blocked",
      );
    }
  }

  if (failed.length > 0) {
    logger.info(
      { scanned: failed.length, recovered, stillBlocked, preserved },
      "Workspace cleanup retry sweep complete",
    );
  }

  return { scanned: failed.length, recovered, stillBlocked, preserved };
}

export function scheduleCleanupRetrySweeper(
  db: Db,
  intervalMs = 60_000,
): NodeJS.Timeout {
  return setInterval(() => {
    void retryCleanupFailedWorkspaces(db).catch((err) => {
      logger.error({ err }, "Workspace cleanup retry sweep failed");
    });
  }, intervalMs);
}
