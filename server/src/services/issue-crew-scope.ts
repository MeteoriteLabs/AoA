import { not, sql, type SQL } from "drizzle-orm";
import { agents, issues } from "@armyofagents/db";

/**
 * Crew/org task scope — the ONE definition of "crew task" (2026-06-02).
 *
 * Plan: docs/aoa/plans/2026-06-02-unified-crew-board-design.md (ENG CLEARED).
 *
 * A task is a **crew task** iff its current `assigneeAgentId` points at a
 * non-terminated `kind='aoa'` agent (Commander + sub-agents — Scout, Engineer,
 * Planner, Adjutant, Chronicler, Navigator, Memory Keeper, Commander). It is
 * assignee-derived and mutable: reassigning a task between the crew world and
 * the org/human world moves it automatically, with no stored "class" column and
 * no migration (query-time predicate — eng-review locked decision #1).
 *
 * Everything else — unassigned tasks, tasks assigned to humans, tasks assigned
 * to `kind='org'` agents, and tasks assigned to a terminated crew agent — is an
 * **org/human task** (`notCrewAssigned`).
 *
 * These two builders are the single source of truth. The crew board, the
 * fail-safe `taskScope` default in `issueService.list()`, and the org-workload
 * count queries all reuse them so the classification can never drift.
 */

/**
 * `EXISTS(SELECT 1 FROM agents WHERE agents.id = issues.assignee_agent_id AND
 * agents.company_id = :cid AND agents.kind = 'aoa' AND agents.status <>
 * 'terminated')` — true when the task is assigned to an active crew agent.
 *
 * Lifted verbatim from the previous inline `crewBoard` block in
 * `services/issues.ts` so the crew-board surface is byte-equivalent.
 */
export function crewAssigneeExists(companyId: string): SQL<boolean> {
  return sql<boolean>`
    EXISTS (
      SELECT 1
      FROM ${agents}
      WHERE ${agents.id} = ${issues.assigneeAgentId}
        AND ${agents.companyId} = ${companyId}
        AND ${agents.kind} = 'aoa'
        AND ${agents.status} <> 'terminated'
    )
  `;
}

/**
 * `NOT (crewAssigneeExists)` — true for every org/human task: assignee is null,
 * a human, a non-aoa agent, or a terminated crew agent. This is the fail-safe
 * predicate pushed by the default `'org'` scope, so a caller that forgets to
 * scope now *hides* crew tasks (safe) instead of leaking them.
 */
export function notCrewAssigned(companyId: string): SQL<boolean> {
  // drizzle's `not()` is typed SQL<unknown>; the negation of a boolean predicate
  // is still boolean — re-assert the element type for callers/condition arrays.
  return not(crewAssigneeExists(companyId)) as SQL<boolean>;
}

/**
 * The board-surface scope of an issues query.
 *  - `'org'`  → org agents + humans + unassigned (pushes `notCrewAssigned`). DEFAULT.
 *  - `'crew'` → active-crew-assigned only (pushes `crewAssigneeExists`). The Crew Board.
 *  - `'all'`  → no scope predicate. The task GRAPH (deps, goal rollups, search,
 *               delete-safety, portability/export) and explicit admin/debug paths.
 */
export type TaskScope = "org" | "crew" | "all";

/**
 * Resolve the effective task scope for an `issueService.list()` call, applying
 * the **fail-safe default of `'org'`** and the `crewBoard` back-compat alias.
 *
 * Precedence:
 *  1. An explicit `taskScope` always wins (including over `crewBoard`).
 *  2. Else `crewBoard === true` maps to `'crew'` (legacy CrewBoard UI param).
 *  3. Else default to `'org'` (fail-safe — a forgotten filter hides crew).
 */
export function resolveTaskScope(filters?: {
  taskScope?: TaskScope;
  crewBoard?: boolean;
}): TaskScope {
  if (filters?.taskScope) return filters.taskScope;
  if (filters?.crewBoard === true) return "crew";
  return "org";
}

/** Whether a resolved scope opts the list query into the crew-board LEFT JOIN. */
export function scopeUsesCrewJoin(scope: TaskScope): boolean {
  return scope === "crew";
}
