import { pgTable, uuid, text, integer, timestamp, boolean, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    issuePrefix: text("issue_prefix").notNull().default("PAP"),
    issueCounter: integer("issue_counter").notNull().default(0),
    budgetMonthlyCents: integer("budget_monthly_cents").notNull().default(0),
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),
    requireBoardApprovalForNewAgents: boolean("require_board_approval_for_new_agents")
      .notNull()
      .default(true),
    vision: text("vision"),
    mission: text("mission"),
    values: text("values"),
    brandColor: text("brand_color"),
    logoAssetId: uuid("logo_asset_id"),
    rootFolder: text("root_folder"),
    mcpEnabled: boolean("mcp_enabled").notNull().default(false),
    // Thread-Native Agent Coordination Phase 1 (Task A1).
    // Onboarding wizard writes the founder's Commander adapter pick here;
    // resolveCrewAdapterForCompany() (Task D6) reads this column first and
    // falls back to internal_agent_config.provider when empty. Empty object
    // = legacy company (created before onboarding offered adapter selection).
    // Shape contract: see CommanderAdapterConfigSchema in
    // packages/shared/src/api/threads-contract.ts (Pre-Task 0.6).
    commanderAdapterConfig: jsonb("commander_adapter_config")
      .$type<{ adapter: string; model: string } | Record<string, never>>()
      .notNull()
      .default({}),
    // Crew adapter pick — `default` covers every crew agent that doesn't
    // have a per-agent override; `perAgent` keys by agent.id (uuid string).
    // Shape contract: CrewAdapterConfigSchema in
    // packages/shared/src/api/threads-contract.ts (Pre-Task 0.6).
    crewAdapterConfig: jsonb("crew_adapter_config")
      .$type<{
        default?: { adapter: string; model: string };
        perAgent?: Record<string, { adapter: string; model: string }>;
      } | Record<string, never>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    enableTeams: boolean("enable_teams").notNull().default(false),
  },
  (table) => ({
    issuePrefixUniqueIdx: uniqueIndex("companies_issue_prefix_idx").on(table.issuePrefix),
  }),
);
