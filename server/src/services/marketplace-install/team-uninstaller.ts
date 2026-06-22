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

export interface UninstallTeamOpts {
  db: Db;
  companyId: string;
  teamId: string;
}

export interface UninstallTeamResult {
  deletedAgentIds: string[];
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

  const memberRows = await db
    .select({ agentId: teamMembers.agentId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));

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
