import { eq, count, isNull, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { memoryFoldersService, seedCompanyRootFolder } from "./memory-folders.js";
import { ensureInternalAgentConfig } from "./internal-agent/aoa-agents/ensure-internal-agent-config.js";
import {
  ensureCrewAgents,
  ensureInfrastructureAgents,
  isCrewMarketplaceManaged,
} from "./internal-agent/aoa-agents/crew-seeding.js";
import { logger } from "../middleware/logger.js";
import {
  companies,
  agents,
  agentApiKeys,
  agentConfigRevisions,
  agentProjects,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  issues,
  issueApprovals,
  issueAttachments,
  issueComments,
  issueDocuments,
  issueReadStates,
  assets,
  projects,
  projectGoals,
  projectWorkspaces,
  executionWorkspaces,
  goals,
  heartbeatRuns,
  heartbeatRunEvents,
  heartbeatRunWatchdogDecisions,
  costEvents,
  financeEvents,
  approvalComments,
  approvals,
  activityLog,
  companySecrets,
  companySkills,
  documents,
  documentRevisions,
  feedbackExports,
  feedbackVotes,
  joinRequests,
  invites,
  notifications,
  principalPermissionGrants,
  companyMemberships,
  mcpApiKeys,
  mcpClientConnections,
  workspaceOperations,
  workspaceRuntimeServices,
} from "@armyofagents/db";
import { notCrewAssigned } from "./issue-crew-scope.js";

export function companyService(db: Db) {
  const ISSUE_PREFIX_FALLBACK = "CMP";

  function deriveIssuePrefixBase(name: string) {
    const normalized = name.toUpperCase().replace(/[^A-Z]/g, "");
    return normalized.slice(0, 3) || ISSUE_PREFIX_FALLBACK;
  }

  function suffixForAttempt(attempt: number) {
    if (attempt <= 1) return "";
    return "A".repeat(attempt - 1);
  }

  function isIssuePrefixConflict(error: unknown) {
    let current: unknown = error;
    const seen = new Set<unknown>();

    while (typeof current === "object" && current !== null && !seen.has(current)) {
      seen.add(current);
      const candidate = current as {
        cause?: unknown;
        code?: unknown;
        constraint?: unknown;
        constraint_name?: unknown;
      };
      const constraint = typeof candidate.constraint === "string"
        ? candidate.constraint
        : typeof candidate.constraint_name === "string"
          ? candidate.constraint_name
          : undefined;

      if (candidate.code === "23505" && constraint === "companies_issue_prefix_idx") {
        return true;
      }

      current = candidate.cause;
    }

    return false;
  }

  async function createCompanyWithUniquePrefix(data: typeof companies.$inferInsert) {
    const base = deriveIssuePrefixBase(data.name);
    let suffix = 1;
    while (suffix < 10000) {
      const candidate = `${base}${suffixForAttempt(suffix)}`;
      try {
        const rows = await db
          .insert(companies)
          .values({ ...data, issuePrefix: candidate })
          .returning();
        const company = rows[0];
        await seedCompanyRootFolder(memoryFoldersService(db), {
          companyId: company.id,
        }).catch((err: unknown) => {
          logger.warn({ err, companyId: company.id }, "memory company-root folder seeding failed");
        });
        // Decision #100 — the Commander Team comes with every company.
        // Eagerly seed (1) the default internal_agent_config row and (2) the
        // Commander kind='aoa' agent linked into that config. (1) MUST precede
        // (2) — ensureCommanderAgent's internal_agent_config UPDATE no-ops
        // without an existing config row. Both are idempotent and seeded
        // non-fatally — exactly mirroring the root-folder seed above — so a
        // seed failure never breaks company create.
        //
        // Phase 1 (Task C1 + Phase D batch 2): the Discussion Extraction
        // ("Scribe") agent is no longer seeded at company create. The
        // autonomous extraction drain is gated OFF (AOA_SCRIBE_AUTONOMOUS_
        // DRAIN_ENABLED) — extraction now runs as tool calls from Memory
        // Keeper (phase=done sweep) and Adjutant (optional, mid-discussion).
        // `ensureExtractionAgent` is preserved in the codebase for rollback
        // safety and so the dispatcher's lazy ensure on the legacy autonomous
        // path keeps working when the env flag is re-enabled; it is no longer
        // wired into bootstrap.
        //
        // T3.5: skip the legacy CREW seeders if marketplace already governs this
        // company's crew. A brand-new company that gets a marketplace install
        // immediately after creation must not have those agents overwritten by
        // the legacy seeders.
        //
        // Read the gate BEFORE seeding anything. The predicate matches any
        // kind='aoa' row with a non-`@legacy` templateOrigin, and the seeders
        // below insert kind='aoa' rows — reading after writing would be a
        // read-your-own-writes hazard the moment anyone stamps an origin at
        // insert time (today nothing does; see crew-seeding.ts). The failure
        // mode is silent: the company would see its own fresh Commander,
        // conclude "marketplace-managed", and skip its entire crew.
        //
        // isCrewMarketplaceManaged fails open to `false` on a DB error, so a
        // transient blip degrades to the legacy seeders rather than leaving the
        // company crewless — the same semantics the inline copy of this query
        // used to provide.
        const crewIsMarketplaceManaged = await isCrewMarketplaceManaged(db, company.id);

        // P8d: internal_agent_config + the infrastructure agents (Commander,
        // Steward) are seeded UNCONDITIONALLY — they are not marketplace-owned,
        // and a company without a config row has no autonomy/provider/model
        // dial at all. Only the CREW roster is gated. config MUST precede
        // ensureInfrastructureAgents: ensureCommanderAgent's
        // internal_agent_config UPDATE no-ops without an existing config row.
        await ensureInternalAgentConfig(db, company.id).catch((err: unknown) => {
          logger.warn({ err, companyId: company.id }, "internal_agent_config seeding failed");
        });
        await ensureInfrastructureAgents(db, company.id);

        if (!crewIsMarketplaceManaged) {
          await ensureCrewAgents(db, company.id);
        }
        return company;
      } catch (error) {
        if (!isIssuePrefixConflict(error)) throw error;
      }
      suffix += 1;
    }
    throw new Error("Unable to allocate unique issue prefix");
  }

  return {
    list: () => db.select().from(companies),

    getById: (id: string) =>
      db
        .select()
        .from(companies)
        .where(eq(companies.id, id))
        .then((rows) => rows[0] ?? null),

    create: async (data: typeof companies.$inferInsert) => createCompanyWithUniquePrefix(data),

    update: (id: string, data: Partial<typeof companies.$inferInsert>) =>
      db
        .update(companies)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(companies.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    archive: (id: string) =>
      db
        .update(companies)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(companies.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    remove: (id: string) =>
      db.transaction(async (tx) => {
        // All work creation locks the company before child rows. Take the same
        // parent lock before the explicit child deletes to avoid lock cycles.
        await tx.execute(sql`select id from ${companies} where ${companies.id} = ${id} for update`);
        // Delete from child tables in dependency order.
        //
        // Schema-level FK cascades (migration 0066) make the explicit deletes
        // here belt-and-suspenders rather than load-bearing — but the order is
        // preserved so dependency relationships remain documented and so that
        // any future regression in the cascade rules surfaces here, not in a
        // 500 from /api/companies/:id.
        // === Workspace runtime (depends on executionWorkspaces, agents) ===
        await tx.delete(workspaceRuntimeServices).where(eq(workspaceRuntimeServices.companyId, id));
        await tx.delete(workspaceOperations).where(eq(workspaceOperations.companyId, id));
        // === Heartbeat surface (depends on agents, runs) ===
        await tx.delete(heartbeatRunWatchdogDecisions).where(eq(heartbeatRunWatchdogDecisions.companyId, id));
        await tx.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.companyId, id));
        await tx.delete(agentTaskSessions).where(eq(agentTaskSessions.companyId, id));
        await tx.delete(heartbeatRuns).where(eq(heartbeatRuns.companyId, id));
        await tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, id));
        // === Agent runtime ===
        await tx.delete(agentApiKeys).where(eq(agentApiKeys.companyId, id));
        await tx.delete(agentRuntimeState).where(eq(agentRuntimeState.companyId, id));
        // === Issue dependents ===
        await tx.delete(issueAttachments).where(eq(issueAttachments.companyId, id));
        await tx.delete(issueDocuments).where(eq(issueDocuments.companyId, id));
        await tx.delete(issueApprovals).where(eq(issueApprovals.companyId, id));
        await tx.delete(issueComments).where(eq(issueComments.companyId, id));
        // === Cost / finance ===
        await tx.delete(financeEvents).where(eq(financeEvents.companyId, id));
        await tx.delete(costEvents).where(eq(costEvents.companyId, id));
        // === Approvals ===
        await tx.delete(approvalComments).where(eq(approvalComments.companyId, id));
        await tx.delete(approvals).where(eq(approvals.companyId, id));
        // === Memberships, secrets, invites ===
        await tx.delete(companySecrets).where(eq(companySecrets.companyId, id));
        await tx.delete(joinRequests).where(eq(joinRequests.companyId, id));
        await tx.delete(invites).where(eq(invites.companyId, id));
        await tx.delete(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, id));
        await tx.delete(companyMemberships).where(eq(companyMemberships.companyId, id));
        await tx.delete(mcpClientConnections).where(eq(mcpClientConnections.companyId, id));
        await tx.delete(mcpApiKeys).where(eq(mcpApiKeys.companyId, id));
        // === Feedback ===
        await tx.delete(feedbackExports).where(eq(feedbackExports.companyId, id));
        await tx.delete(feedbackVotes).where(eq(feedbackVotes.companyId, id));
        // === Documents & artifacts ===
        await tx.delete(documentRevisions).where(eq(documentRevisions.companyId, id));
        await tx.delete(documents).where(eq(documents.companyId, id));
        await tx.delete(assets).where(eq(assets.companyId, id));
        await tx.delete(issueReadStates).where(eq(issueReadStates.companyId, id));
        // === Workspace surface (depends on heartbeatRuns, projects) ===
        await tx.delete(executionWorkspaces).where(eq(executionWorkspaces.companyId, id));
        await tx.delete(projectWorkspaces).where(eq(projectWorkspaces.companyId, id));
        await tx.delete(agentProjects).where(eq(agentProjects.companyId, id));
        // === Issue surface ===
        await tx.delete(issues).where(eq(issues.companyId, id));
        // === Goals, projects (parents in dependency order) ===
        await tx.delete(projectGoals).where(eq(projectGoals.companyId, id));
        await tx.delete(goals).where(eq(goals.companyId, id));
        await tx.delete(projects).where(eq(projects.companyId, id));
        // === Agent config + skills ===
        await tx.delete(agentConfigRevisions).where(eq(agentConfigRevisions.companyId, id));
        await tx.delete(companySkills).where(eq(companySkills.companyId, id));
        // === Top-level: agents, activity log ===
        await tx.delete(agents).where(eq(agents.companyId, id));
        await tx.delete(activityLog).where(eq(activityLog.companyId, id));
        const rows = await tx
          .delete(companies)
          .where(eq(companies.id, id))
          .returning();
        return rows[0] ?? null;
      }),

    stats: () =>
      Promise.all([
        db
          .select({ companyId: agents.companyId, count: count() })
          .from(agents)
          // Per-company agent counts exclude platform (Commander-team) agents.
          .where(eq(agents.kind, "org"))
          .groupBy(agents.companyId),
        db
          .select({ companyId: issues.companyId, count: count() })
          .from(issues)
          // Per-company issue (active-tasks) counts exclude crew-agent tasks, so
          // the lobby card mirrors the agent count's org-only intent. This is a
          // CROSS-COMPANY batch (groupBy company_id, no fixed company), so the
          // crew predicate is the CORRELATED form (no arg → agents.company_id =
          // issues.company_id). Crew tasks live only on the Crew Board.
          .where(notCrewAssigned())
          .groupBy(issues.companyId),
        db
          .select({ companyId: approvals.companyId, count: count() })
          .from(approvals)
          .where(eq(approvals.status, "pending"))
          .groupBy(approvals.companyId),
        db
          .select({ companyId: notifications.companyId, count: count() })
          .from(notifications)
          .where(isNull(notifications.readAt))
          .groupBy(notifications.companyId),
      ]).then(([agentRows, issueRows, approvalRows, notificationRows]) => {
        const result: Record<
          string,
          {
            agentCount: number;
            issueCount: number;
            pendingApprovalCount: number;
            unreadNotificationCount: number;
          }
        > = {};
        function ensure(companyId: string) {
          if (!result[companyId]) {
            result[companyId] = {
              agentCount: 0,
              issueCount: 0,
              pendingApprovalCount: 0,
              unreadNotificationCount: 0,
            };
          }
          return result[companyId];
        }
        for (const row of agentRows) {
          ensure(row.companyId).agentCount = row.count;
        }
        for (const row of issueRows) {
          ensure(row.companyId).issueCount = row.count;
        }
        for (const row of approvalRows) {
          ensure(row.companyId).pendingApprovalCount = row.count;
        }
        for (const row of notificationRows) {
          ensure(row.companyId).unreadNotificationCount = row.count;
        }
        return result;
      }),
  };
}
