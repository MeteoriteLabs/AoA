/**
 * DB-backed companion to the pure `memory-access.ts` (enterprise memory model, P1).
 *
 * `memory-access.ts` is deliberately pure (its P0 test imports it without mocking
 * @armyofagents/db). This sibling holds the code that must touch the DB or Drizzle:
 * the actor resolvers and the `memoryAccessConditions` WHERE-builder (P1-T2). It
 * type-imports MemoryActor from the pure module so both stay in sync.
 */
import { and, eq } from "drizzle-orm";
import { agentProjects, userRoles, type Db } from "@armyofagents/db";
import type { MemoryActor } from "./memory-access.js";

/**
 * Actor for an agent run. departmentIds = the agent's `agent_projects` project ids.
 * These are `projects.id` rows of either type (department OR project), so the RBAC
 * filter matches a memory row's `departmentId` AND `projectId` against this set.
 * An agent with no assignments simply sees only identity + company-visibility memory.
 */
export async function actorForAgentRun(
  db: Db,
  companyId: string,
  agentId: string,
): Promise<MemoryActor> {
  const rows = await db
    .select({ projectId: agentProjects.projectId })
    .from(agentProjects)
    .where(and(eq(agentProjects.companyId, companyId), eq(agentProjects.agentId, agentId)));
  const departmentIds = rows.map((r) => r.projectId).filter((id): id is string => Boolean(id));
  return { kind: "agent", agentId, departmentIds };
}

/**
 * Actor for a human. A founder role short-circuits to `{ kind: "founder" }`. Otherwise
 * the actor is team_lead (if any team_lead row) or team_member, scoped to the
 * `projects.id` named on their role rows. Zero roles → team_member with no departments
 * (least privilege). Mirrors `resolveUserRole` in mcp/tools/scope.ts and is deliberately
 * stricter than `resolveUserScope`'s board-zero-rows→founder rule (an MCP-board concept,
 * not a run-path one).
 */
export async function actorForUser(
  db: Db,
  companyId: string,
  userId: string,
): Promise<MemoryActor> {
  const roles = await db
    .select({ role: userRoles.role, projectId: userRoles.projectId })
    .from(userRoles)
    .where(and(eq(userRoles.companyId, companyId), eq(userRoles.userId, userId)));
  if (roles.some((r) => r.role === "founder")) return { kind: "founder" };
  const departmentIds = roles.map((r) => r.projectId).filter((id): id is string => Boolean(id));
  const kind = roles.some((r) => r.role === "team_lead") ? "team_lead" : "team_member";
  return { kind, userId, departmentIds };
}

/** MCP dispatch helper: agent callers resolve via agent_projects, everyone else via user_roles. */
export async function actorForMcp(
  db: Db,
  companyId: string,
  actor: { source: string; userId: string; agentId?: string | null },
): Promise<MemoryActor> {
  if (actor.source === "agent" && actor.agentId) {
    return actorForAgentRun(db, companyId, actor.agentId);
  }
  return actorForUser(db, companyId, actor.userId);
}
