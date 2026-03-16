import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues, taskDependencies } from "@paperclipai/db";
import { logActivity } from "./activity-log.js";
import { heartbeatService } from "./heartbeat.js";
import { conflict, notFound, unprocessable } from "../errors.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

interface WakeTask {
  agentId: string;
  issueId: string;
}

const TERMINAL_STATUSES = ["done", "cancelled"];
const MAX_CHAIN_DEPTH = 50;

export function dependencyService(db: Db) {
  const heartbeat = heartbeatService(db);

  async function fireWakeups(tasks: WakeTask[]) {
    for (const wake of tasks) {
      await heartbeat.wakeup(wake.agentId, {
        source: "automation",
        triggerDetail: "system",
        reason: "dependency_unblocked",
        payload: { issueId: wake.issueId },
      });
    }
  }

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
    const wakeups = await maybeUnblockTx(companyId, dependentIssueId, db);
    await fireWakeups(wakeups);

    return deleted;
  }

  async function getDependencies(companyId: string, issueId: string) {
    return db
      .select({
        id: taskDependencies.id,
        dependencyIssueId: taskDependencies.dependencyIssueId,
        title: issues.title,
        status: issues.status,
        identifier: issues.identifier,
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

  async function getDependentsTx(companyId: string, issueId: string, tx: Tx | Db) {
    return (tx as Db)
      .select({
        id: taskDependencies.id,
        dependentIssueId: taskDependencies.dependentIssueId,
        title: issues.title,
        status: issues.status,
        identifier: issues.identifier,
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

  async function getDependents(companyId: string, issueId: string) {
    return getDependentsTx(companyId, issueId, db);
  }

  /**
   * Core resolution logic — runs all DB ops through the provided tx/db.
   * Returns tasks that need wakeup (to be called after transaction commits).
   */
  async function resolveDependenciesTx(
    companyId: string,
    completedIssueId: string,
    tx: Tx | Db,
  ): Promise<WakeTask[]> {
    const dependents = await getDependentsTx(companyId, completedIssueId, tx);
    const wakeups: WakeTask[] = [];

    for (const dep of dependents) {
      if (dep.status !== "blocked") continue;

      // Check if ALL dependencies of this dependent are now done
      const remaining = await (tx as Db)
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
      await (tx as Db)
        .update(issues)
        .set({ status: "todo", updatedAt: new Date() })
        .where(eq(issues.id, dep.dependentIssueId));

      await logActivity(tx as Db, {
        companyId,
        actorType: "system",
        actorId: "system",
        action: "dependency.unblocked",
        entityType: "issue",
        entityId: dep.dependentIssueId,
        details: { resolvedByIssueId: completedIssueId },
      });

      // Collect agent for wakeup (after tx commits)
      const [task] = await (tx as Db)
        .select({ assigneeAgentId: issues.assigneeAgentId })
        .from(issues)
        .where(eq(issues.id, dep.dependentIssueId));

      if (task?.assigneeAgentId) {
        wakeups.push({ agentId: task.assigneeAgentId, issueId: dep.dependentIssueId });
      }
    }

    return wakeups;
  }

  /**
   * Public API: resolves dependencies with optional outer transaction.
   * When outerTx is provided, DB ops run inside it and wakeups are returned (caller handles them after commit).
   * When called standalone, wraps in its own transaction and fires wakeups after.
   */
  async function resolveDependencies(
    companyId: string,
    completedIssueId: string,
    outerTx?: Tx,
  ): Promise<{ tasksToWake: WakeTask[] }> {
    if (outerTx) {
      const tasksToWake = await resolveDependenciesTx(companyId, completedIssueId, outerTx);
      return { tasksToWake };
    }

    const tasksToWake = await db.transaction(async (tx) => {
      return resolveDependenciesTx(companyId, completedIssueId, tx);
    });
    await fireWakeups(tasksToWake);
    return { tasksToWake };
  }

  /**
   * Core maybeUnblock logic — runs through tx/db, returns wakeups.
   */
  async function maybeUnblockTx(
    companyId: string,
    dependentIssueId: string,
    tx: Tx | Db,
  ): Promise<WakeTask[]> {
    const [task] = await (tx as Db)
      .select({ status: issues.status })
      .from(issues)
      .where(and(eq(issues.id, dependentIssueId), eq(issues.companyId, companyId)));

    if (!task || task.status !== "blocked") return [];

    const remaining = await (tx as Db)
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
      await (tx as Db)
        .update(issues)
        .set({ status: "todo", updatedAt: new Date() })
        .where(eq(issues.id, dependentIssueId));

      await logActivity(tx as Db, {
        companyId,
        actorType: "system",
        actorId: "system",
        action: "dependency.unblocked",
        entityType: "issue",
        entityId: dependentIssueId,
      });

      const [unblocked] = await (tx as Db)
        .select({ assigneeAgentId: issues.assigneeAgentId })
        .from(issues)
        .where(eq(issues.id, dependentIssueId));

      if (unblocked?.assigneeAgentId) {
        return [{ agentId: unblocked.assigneeAgentId, issueId: dependentIssueId }];
      }
    }

    return [];
  }

  async function handleCancelledDependency(
    companyId: string,
    cancelledIssueId: string,
    outerTx?: Tx,
  ) {
    const tx = outerTx ?? db;
    const dependents = await getDependentsTx(companyId, cancelledIssueId, tx);

    for (const dep of dependents) {
      await logActivity(tx as Db, {
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

  return {
    addDependency,
    removeDependency,
    getDependencies,
    getDependents,
    resolveDependencies,
    handleCancelledDependency,
  };
}
