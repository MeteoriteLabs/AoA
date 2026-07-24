import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  teams,
  teamMembers,
  agents,
  aoaAgentTriggers,
  marketplaceInstallOperations,
} from "@armyofagents/db";
import { logger } from "../../middleware/logger.js";
import { protectedAgentsIn, protectedAgentRefusal } from "../protected-agents.js";

export interface UninstallTeamOpts {
  db: Db;
  companyId: string;
  teamId: string;
}

export interface UninstallTeamResult {
  deletedAgentIds: string[];
}

/** A protected agent this uninstall would have destroyed. */
export interface BlockedProtectedAgent {
  id: string;
  name: string;
  role: string;
}

/**
 * Thrown when a team uninstall would destroy a protected AoA agent (D23).
 *
 * Distinct type so the route can answer 409 rather than the catch-all 500 —
 * this is a client-correctable refusal, not a server fault.
 */
export class ProtectedAgentUninstallError extends Error {
  readonly protectedAgents: BlockedProtectedAgent[];

  constructor(message: string, protectedAgents: BlockedProtectedAgent[]) {
    super(message);
    this.name = "ProtectedAgentUninstallError";
    this.protectedAgents = protectedAgents;
  }
}

/**
 * Reverse of installTeam: delete agents + trigger rows + team row.
 * Skills are left in place — they may be shared with other agents.
 * The entire delete is wrapped in a single Postgres transaction (all-or-nothing).
 * Safe to call multiple times (idempotent: second call returns empty deletedAgentIds
 * because the team row is gone after the first run).
 *
 * Cascade order:
 *   1. aoaAgentTriggers   WHERE agentId IN (team's agents)
 *   2. agents             WHERE companyId + id IN (team's agents)  → FK-cascades team_members
 *   3. teams              WHERE companyId + id = teamId            → FK-cascades team_members
 *   4. marketplace_install_operations                              → audit log
 *
 * ── Protected agents (D23) ──────────────────────────────────────────────────
 *
 * This function deletes member agents with raw SQL, so **`DELETE /agents/:id`'s
 * guards never see it** — a per-agent route check cannot cover this path. If any
 * member is a protected AoA agent ({@link protectedAgentsIn}) the whole uninstall
 * is refused with {@link ProtectedAgentUninstallError}, before the transaction
 * opens and before anything is written.
 *
 * Whole-team refusal rather than "delete the rest, keep the protected ones":
 * this operation is documented all-or-nothing, and silently returning a
 * `deletedAgentIds` that omits members the caller asked to remove is a worse
 * failure than refusing. The refusal names the blocking agents.
 *
 * ⚠️ Once T2.4 publishes Steward into `team:aoa-curated/default-crew`, that team
 * becomes un-uninstallable through this route for exactly this reason. That is
 * intended, but it is a product-visible consequence — not an accident.
 */
export async function uninstallTeam(opts: UninstallTeamOpts): Promise<UninstallTeamResult> {
  const { db, companyId, teamId } = opts;

  // ── Pre-flight: read current state outside the transaction ────────────────

  const [teamRow] = await db
    .select({ id: teams.id, templateOrigin: teams.templateOrigin })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.companyId, companyId)))
    .limit(1);

  if (!teamRow) {
    throw new Error(`Team not found: ${teamId}`);
  }

  // Joined to `agents` because the protected-agent check needs each member's
  // identity signals (name + templateOrigin), not just its id. The companyId
  // predicate matches the delete below, so the two can never disagree about
  // which rows are in scope.
  const memberRows = await db
    .select({
      agentId: teamMembers.agentId,
      name: agents.name,
      templateOrigin: agents.templateOrigin,
    })
    .from(teamMembers)
    .innerJoin(agents, eq(agents.id, teamMembers.agentId))
    .where(and(eq(teamMembers.teamId, teamId), eq(agents.companyId, companyId)));

  const blocked = protectedAgentsIn(memberRows);
  if (blocked.length > 0) {
    const protectedAgents: BlockedProtectedAgent[] = blocked.map(({ agent, role }) => ({
      id: agent.agentId,
      name: agent.name,
      role: role.slug,
    }));
    logger.warn(
      { companyId, teamId, protectedAgents },
      "marketplace: team uninstall refused — protected AoA agents",
    );
    throw new ProtectedAgentUninstallError(
      protectedAgentRefusal(
        blocked.map(({ agent, role }) => ({ name: agent.name, role })),
        "Uninstalling this team",
      ),
      protectedAgents,
    );
  }

  const agentIds = memberRows.map((m) => m.agentId);

  // ── Atomic delete ─────────────────────────────────────────────────────────

  const deletedAgentIds: string[] = [];

  await db.transaction(async (tx) => {
    if (agentIds.length > 0) {
      // 1. Delete trigger rows for all team agents
      await tx
        .delete(aoaAgentTriggers)
        .where(inArray(aoaAgentTriggers.agentId, agentIds));

      // 2. Delete agents (FK cascade removes team_members rows too)
      const deleted = await tx
        .delete(agents)
        .where(and(eq(agents.companyId, companyId), inArray(agents.id, agentIds)))
        .returning({ id: agents.id });

      deletedAgentIds.push(...deleted.map((r) => r.id));
    }

    // 3. Delete team row (FK cascade also removes any remaining team_members rows)
    await tx
      .delete(teams)
      .where(and(eq(teams.id, teamId), eq(teams.companyId, companyId)));

    // 4. Audit log
    await tx.insert(marketplaceInstallOperations).values({
      companyId,
      catalogItemId: teamRow.templateOrigin ?? teamId,
      itemType: "team",
      status: "success",
      resultEntityId: teamId,
      completedAt: new Date(),
    });
  });

  logger.info({ companyId, teamId, deletedAgentIds }, "marketplace: team uninstalled");
  return { deletedAgentIds };
}
