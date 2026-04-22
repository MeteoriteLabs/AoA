import { and, eq, lt, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { executionWorkspaces, projects } from "@paperclipai/db";
import { executionWorkspaceService } from "./execution-workspaces.js";
import { parseProjectExecutionWorkspacePolicy } from "./execution-workspace-policy.js";
import { instanceSettingsService } from "./instance-settings.js";
import { logger } from "../middleware/logger.js";

export interface WorkspaceTtlSweepResult {
  scanned: number;
  marked: number;
  blocked: number;
  skipped: number;
}

export async function sweepExpiredWorkspaces(db: Db): Promise<WorkspaceTtlSweepResult> {
  const experimental = await instanceSettingsService(db).getExperimental();
  if (!experimental.enableWorkspaceTtlSweeper) {
    return { scanned: 0, marked: 0, blocked: 0, skipped: 0 };
  }

  const svc = executionWorkspaceService(db);
  const projectRows = await db
    .select({
      id: projects.id,
      executionWorkspacePolicy: projects.executionWorkspacePolicy,
    })
    .from(projects);

  let scanned = 0;
  let marked = 0;
  let blocked = 0;
  let skipped = 0;

  for (const row of projectRows) {
    const policy = parseProjectExecutionWorkspacePolicy(row.executionWorkspacePolicy);
    const ttlDays = policy?.ttlDays;
    if (!ttlDays || ttlDays <= 0) {
      skipped++;
      continue;
    }

    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

    const candidates = await db
      .select({
        id: executionWorkspaces.id,
        cleanupEligibleAt: executionWorkspaces.cleanupEligibleAt,
      })
      .from(executionWorkspaces)
      .where(
        and(
          eq(executionWorkspaces.projectId, row.id),
          ne(executionWorkspaces.status, "archived"),
          lt(executionWorkspaces.lastUsedAt, cutoff),
        ),
      );

    for (const ws of candidates) {
      scanned++;

      if (ws.cleanupEligibleAt) {
        // already stamped by a previous sweep; don't re-mark
        skipped++;
        continue;
      }

      let readinessState: string | null = null;
      try {
        const readiness = await svc.getCloseReadiness(ws.id);
        readinessState = readiness?.state ?? null;
      } catch (err) {
        logger.warn(
          { err, workspaceId: ws.id },
          "TTL sweeper readiness check failed — treating as blocked",
        );
        blocked++;
        continue;
      }

      if (!readinessState || readinessState === "blocked") {
        blocked++;
        continue;
      }

      await db
        .update(executionWorkspaces)
        .set({
          cleanupEligibleAt: new Date(),
          cleanupReason: `ttl_sweep:${ttlDays}d`,
          updatedAt: new Date(),
        })
        .where(eq(executionWorkspaces.id, ws.id));

      marked++;
    }
  }

  logger.info({ scanned, marked, blocked, skipped }, "Workspace TTL sweep complete");
  return { scanned, marked, blocked, skipped };
}

export function scheduleTtlSweeper(db: Db, intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    void sweepExpiredWorkspaces(db).catch((err) => {
      logger.error({ err }, "Workspace TTL sweep failed");
    });
  }, intervalMs);
}
