import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { teams } from "./teams.js";
import { agents } from "./agents.js";

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    teamAgentUq: uniqueIndex("team_members_team_agent_uq").on(table.teamId, table.agentId),
    teamIdx: index("team_members_team_idx").on(table.teamId),
    agentIdx: index("team_members_agent_idx").on(table.agentId),
  }),
);
