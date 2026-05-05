import { rm } from "node:fs/promises";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { executionWorkspaces } from "@armyofagents/db";
import { logger } from "../middleware/logger.js";

export interface WorkspaceCleanupRetrySweepResult {
  scanned: number;
  recovered: number;
  stillBlocked: number;
}

/**
 * Windows-focused retry: agent heartbeat subprocesses often hold file handles open
 * briefly after a run, so the initial `git worktree remove` / `rm -rf` fails with
 * "Permission denied". Git metadata is already cleaned; only the directory lingers.
 * This sweeper retries filesystem removal for cleanup_failed workspaces that closed
 * more than 60s ago and promotes them to `archived` on success.
 */
export async function retryCleanupFailedWorkspaces(
  db: Db,
): Promise<WorkspaceCleanupRetrySweepResult> {
  const failed = await db
    .select({
      id: executionWorkspaces.id,
      cwd: executionWorkspaces.cwd,
      providerRef: executionWorkspaces.providerRef,
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

  for (const ws of failed) {
    const target = ws.providerRef ?? ws.cwd;
    if (!target) {
      // No path to clean — mark archived so we stop re-scanning.
      await db
        .update(executionWorkspaces)
        .set({ status: "archived", cleanupReason: null, updatedAt: new Date() })
        .where(eq(executionWorkspaces.id, ws.id));
      recovered++;
      continue;
    }
    try {
      await rm(target, { recursive: true, force: true });
      await db
        .update(executionWorkspaces)
        .set({ status: "archived", cleanupReason: null, updatedAt: new Date() })
        .where(eq(executionWorkspaces.id, ws.id));
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
      { scanned: failed.length, recovered, stillBlocked },
      "Workspace cleanup retry sweep complete",
    );
  }

  return { scanned: failed.length, recovered, stillBlocked };
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
