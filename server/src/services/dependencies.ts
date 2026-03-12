import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues, taskDependencies } from "@paperclipai/db";
import { logActivity } from "./activity-log.js";
import { heartbeatService } from "./heartbeat.js";
import { conflict, notFound, unprocessable } from "../errors.js";

const TERMINAL_STATUSES = ["done", "cancelled"];
const MAX_CHAIN_DEPTH = 50;

export function dependencyService(db: Db) {
  const heartbeat = heartbeatService(db);

  async function addDependency(
    companyId: string,
    dependentIssueId: string,
    dependencyIssueId: string,
  ) {
    // No self-dependency
    if (dependentIssueId === dependencyIssueId) {
      throw unprocessable("A task cannot depend on itself");
    }

    // Verify both issues exist and belong to company
    const [dependent, dependency] = await Promise.all([
      db
        .select({ id: issues.id, status: issues.status })
        .from(issues)
        .where(and(eq(issues.id, dependentIssueId), eq(issues.companyId, companyId)))
        .then((r) => r[0] ?? null),
      db
        .select({ id: issues.id, status: issues.status })
        .from(issues)
        .where(and(eq(issues.id, dependencyIssueId), eq(issues.companyId, companyId)))
        .then((r) => r[0] ?? null),
    ]);

    if (!dependent) throw notFound("Dependent task not found");
    if (!dependency) throw notFound("Dependency task not found");

    // Circular dependency check — walk upstream from dependencyIssueId
    await assertNoCycle(companyId, dependencyIssueId, dependentIssueId);

    // Insert (unique constraint catches duplicates)
    const [row] = await db
      .insert(taskDependencies)
      .values({ companyId, dependentIssueId, dependencyIssueId })
      .returning()
      .catch((err: unknown) => {
        if (err instanceof Error && err.message.includes("task_dep_unique_idx")) {
          throw conflict("This dependency already exists");
        }
        throw err;
      });

    // Auto-block only if:
    // 1. The dependency task is NOT done (still needs to be completed)
    // 2. The dependent task is in a non-terminal status (can be blocked)
    if (
      !TERMINAL_STATUSES.includes(dependency.status) &&
      !TERMINAL_STATUSES.includes(dependent.status) &&
      dependent.status !== "blocked"
    ) {
      await db
        .update(issues)
        .set({ status: "blocked", updatedAt: new Date() })
        .where(eq(issues.id, dependentIssueId));
    }

    await logActivity(db, {
      companyId,
      actorType: "system",
      actorId: "system",
      action: "dependency.added",
      entityType: "issue",
      entityId: dependentIssueId,
      details: { dependencyIssueId },
    });

    return row;
  }

  async function removeDependency(
    companyId: string,
    dependentIssueId: string,
    dependencyIssueId: string,
  ) {
    const [deleted] = await db
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.companyId, companyId),
          eq(taskDependencies.dependentIssueId, dependentIssueId),
          eq(taskDependencies.dependencyIssueId, dependencyIssueId),
        ),
      )
      .returning();

    if (!deleted) throw notFound("Dependency not found");

    await logActivity(db, {
      companyId,
      actorType: "system",
      actorId: "system",
      action: "dependency.removed",
      entityType: "issue",
      entityId: dependentIssueId,
      details: { dependencyIssueId },
    });

    // Re-evaluate: should the dependent be unblocked?
    await maybeUnblock(companyId, dependentIssueId);

    return deleted;
  }

  async function getDependencies(companyId: string, issueId: string) {
    return db
      .select({
        id: taskDependencies.id,
        dependencyIssueId: taskDependencies.dependencyIssueId,
        title: issues.title,
        status: issues.status,
        createdAt: taskDependencies.createdAt,
      })
      .from(taskDependencies)
      .innerJoin(issues, eq(issues.id, taskDependencies.dependencyIssueId))
      .where(
        and(
          eq(taskDependencies.companyId, companyId),
          eq(taskDependencies.dependentIssueId, issueId),
        ),
      );
  }

  async function getDependents(companyId: string, issueId: string) {
    return db
      .select({
        id: taskDependencies.id,
        dependentIssueId: taskDependencies.dependentIssueId,
        title: issues.title,
        status: issues.status,
        createdAt: taskDependencies.createdAt,
      })
      .from(taskDependencies)
      .innerJoin(issues, eq(issues.id, taskDependencies.dependentIssueId))
      .where(
        and(
          eq(taskDependencies.companyId, companyId),
          eq(taskDependencies.dependencyIssueId, issueId),
        ),
      );
  }

  async function resolveDependencies(companyId: string, completedIssueId: string) {
    const dependents = await getDependents(companyId, completedIssueId);

    for (const dep of dependents) {
      if (dep.status !== "blocked") continue;

      // Check if ALL dependencies of this dependent are now done
      const remaining = await db
        .select({ status: issues.status })
        .from(taskDependencies)
        .innerJoin(issues, eq(issues.id, taskDependencies.dependencyIssueId))
        .where(
          and(
            eq(taskDependencies.companyId, companyId),
            eq(taskDependencies.dependentIssueId, dep.dependentIssueId),
          ),
        );

      const allDone = remaining.every((r) => r.status === "done");
      if (!allDone) continue;

      // Unblock → todo
      await db
        .update(issues)
        .set({ status: "todo", updatedAt: new Date() })
        .where(eq(issues.id, dep.dependentIssueId));

      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "system",
        action: "dependency.unblocked",
        entityType: "issue",
        entityId: dep.dependentIssueId,
        details: { resolvedByIssueId: completedIssueId },
      });

      // Wake agent if assigned
      const [task] = await db
        .select({ assigneeAgentId: issues.assigneeAgentId })
        .from(issues)
        .where(eq(issues.id, dep.dependentIssueId));

      if (task?.assigneeAgentId) {
        await heartbeat.wakeup(task.assigneeAgentId, {
          source: "automation",
          triggerDetail: "system",
          reason: "dependency_unblocked",
          payload: { issueId: dep.dependentIssueId },
        });
      }
    }
  }

  async function handleCancelledDependency(companyId: string, cancelledIssueId: string) {
    const dependents = await getDependents(companyId, cancelledIssueId);

    for (const dep of dependents) {
      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "system",
        action: "dependency.cancelled_warning",
        entityType: "issue",
        entityId: dep.dependentIssueId,
        details: {
          cancelledDependencyIssueId: cancelledIssueId,
          message: "A dependency task was cancelled. Manual resolution required.",
        },
      });
    }
  }

  // --- Internal helpers ---

  async function assertNoCycle(
    companyId: string,
    startIssueId: string,
    targetIssueId: string,
  ) {
    // Walk upstream from startIssueId. If we ever reach targetIssueId, it's a cycle.
    let currentIds = [startIssueId];

    for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
      if (currentIds.length === 0) return; // no more upstream — no cycle

      const upstream = await db
        .select({ depId: taskDependencies.dependencyIssueId })
        .from(taskDependencies)
        .where(
          and(
            eq(taskDependencies.companyId, companyId),
            inArray(taskDependencies.dependentIssueId, currentIds),
          ),
        );

      const nextIds = upstream.map((r) => r.depId);
      if (nextIds.includes(targetIssueId)) {
        throw unprocessable("Circular dependency detected");
      }

      currentIds = nextIds;
    }

    throw unprocessable("Dependency chain exceeds maximum depth of 50");
  }

  async function maybeUnblock(companyId: string, dependentIssueId: string) {
    // Only unblock if the task is currently blocked
    const [task] = await db
      .select({ status: issues.status })
      .from(issues)
      .where(and(eq(issues.id, dependentIssueId), eq(issues.companyId, companyId)));

    if (!task || task.status !== "blocked") return;

    const remaining = await db
      .select({ status: issues.status })
      .from(taskDependencies)
      .innerJoin(issues, eq(issues.id, taskDependencies.dependencyIssueId))
      .where(
        and(
          eq(taskDependencies.companyId, companyId),
          eq(taskDependencies.dependentIssueId, dependentIssueId),
        ),
      );

    // No remaining deps or all done → unblock
    if (remaining.length === 0 || remaining.every((r) => r.status === "done")) {
      await db
        .update(issues)
        .set({ status: "todo", updatedAt: new Date() })
        .where(eq(issues.id, dependentIssueId));

      await logActivity(db, {
        companyId,
        actorType: "system",
        actorId: "system",
        action: "dependency.unblocked",
        entityType: "issue",
        entityId: dependentIssueId,
      });

      // Wake agent if assigned
      const [unblocked] = await db
        .select({ assigneeAgentId: issues.assigneeAgentId })
        .from(issues)
        .where(eq(issues.id, dependentIssueId));

      if (unblocked?.assigneeAgentId) {
        await heartbeat.wakeup(unblocked.assigneeAgentId, {
          source: "automation",
          triggerDetail: "system",
          reason: "dependency_unblocked",
          payload: { issueId: dependentIssueId },
        });
      }
    }
  }

  return {
    addDependency,
    removeDependency,
    getDependencies,
    getDependents,
    resolveDependencies,
    handleCancelledDependency,
  };
}
