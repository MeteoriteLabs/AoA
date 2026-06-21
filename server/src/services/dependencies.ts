import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { issues, taskDependencies } from "@armyofagents/db";
import { logActivity } from "./activity-log.js";
import { enqueueIssueAssigneeWakeup } from "./issue-assignee-wakeup.js";
import { conflict, notFound, unprocessable } from "../errors.js";
import { shouldDispatchIssueWakeup } from "../routes/issues-planning-mode-dispatch.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

interface WakeTask {
  companyId: string;
  agentId: string;
  issueId: string;
  workMode: string | null;
}

/**
 * A dependency in any of these statuses no longer blocks its dependents.
 * Both `done` and `cancelled` are terminal: a cancelled upstream task is
 * resolved (it won't ever complete), so it must release downstream tasks the
 * same way a completed one does. (A-H9)
 */
export const TERMINAL_STATUSES = ["done", "cancelled"];
const MAX_CHAIN_DEPTH = 50;

export function dependencyService(db: Db) {
  async function fireWakeups(tasks: WakeTask[]) {
    for (const wake of tasks) {
      if (!shouldDispatchIssueWakeup({ workMode: wake.workMode })) continue;
      await enqueueIssueAssigneeWakeup(db, {
        companyId: wake.companyId,
        agentId: wake.agentId,
        issueId: wake.issueId,
        source: "automation",
        reason: "dependency_unblocked",
      });
    }
  }

  async function addDependency(
    companyId: string,
    dependentIssueId: string,
    dependencyIssueId: string,
    outerTx?: Tx,
  ) {
    const conn = (outerTx ?? db) as Db;

    // No self-dependency
    if (dependentIssueId === dependencyIssueId) {
      throw unprocessable("A task cannot depend on itself");
    }

    // Verify both issues exist and belong to company
    const [dependent, dependency] = await Promise.all([
      conn
        .select({ id: issues.id, status: issues.status })
        .from(issues)
        .where(and(eq(issues.id, dependentIssueId), eq(issues.companyId, companyId)))
        .then((r) => r[0] ?? null),
      conn
        .select({ id: issues.id, status: issues.status })
        .from(issues)
        .where(and(eq(issues.id, dependencyIssueId), eq(issues.companyId, companyId)))
        .then((r) => r[0] ?? null),
    ]);

    if (!dependent) throw notFound("Dependent task not found");
    if (!dependency) throw notFound("Dependency task not found");

    // Circular dependency check — walk upstream from dependencyIssueId
    await assertNoCycle(companyId, dependencyIssueId, dependentIssueId, conn);

    // Insert (unique constraint catches duplicates)
    const [row] = await conn
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
      await conn
        .update(issues)
        .set({ status: "blocked", updatedAt: new Date() })
        .where(eq(issues.id, dependentIssueId));
    }

    await logActivity(conn, {
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

      const allDone = remaining.every((r) => TERMINAL_STATUSES.includes(r.status));
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
        .select({ assigneeAgentId: issues.assigneeAgentId, workMode: issues.workMode })
        .from(issues)
        .where(eq(issues.id, dep.dependentIssueId));

      if (task?.assigneeAgentId) {
        wakeups.push({ companyId, agentId: task.assigneeAgentId, issueId: dep.dependentIssueId, workMode: task.workMode ?? null });
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

    // No remaining deps or all terminal (done OR cancelled) → unblock
    if (remaining.length === 0 || remaining.every((r) => TERMINAL_STATUSES.includes(r.status))) {
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
        .select({ assigneeAgentId: issues.assigneeAgentId, workMode: issues.workMode })
        .from(issues)
        .where(eq(issues.id, dependentIssueId));

      if (unblocked?.assigneeAgentId) {
        return [{ companyId, agentId: unblocked.assigneeAgentId, issueId: dependentIssueId, workMode: unblocked.workMode ?? null }];
      }
    }

    return [];
  }

  /**
   * A cancelled dependency is terminal — it satisfies (releases) its dependents
   * exactly like a `done` one would. For each dependent we run the same
   * maybeUnblock logic and RETURN the resulting wakeups so the caller can fire
   * heartbeat wakeups after the transaction commits (symmetric with the `done`
   * path through resolveDependencies). Without propagating these wakes, an
   * unblocked dependent would never get dispatched. (A-H9)
   */
  async function handleCancelledDependency(
    companyId: string,
    cancelledIssueId: string,
    outerTx?: Tx,
  ): Promise<WakeTask[]> {
    const tx = outerTx ?? db;
    const dependents = await getDependentsTx(companyId, cancelledIssueId, tx);
    const wakeups: WakeTask[] = [];

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
          message: "A dependency task was cancelled; releasing the dependent (all remaining dependencies terminal).",
        },
      });

      // Release the dependent if all of its remaining dependencies are now
      // terminal (the just-cancelled one plus any already-done ones).
      const unblockWakes = await maybeUnblockTx(companyId, dep.dependentIssueId, tx);
      wakeups.push(...unblockWakes);
    }

    return wakeups;
  }

  // --- Internal helpers ---

  async function assertNoCycle(
    companyId: string,
    startIssueId: string,
    targetIssueId: string,
    conn: Tx | Db = db,
  ) {
    // Walk upstream from startIssueId. If we ever reach targetIssueId, it's a cycle.
    let currentIds = [startIssueId];

    for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth++) {
      if (currentIds.length === 0) return; // no more upstream — no cycle

      const upstream = await (conn as Db)
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
