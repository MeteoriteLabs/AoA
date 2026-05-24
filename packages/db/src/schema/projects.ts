import { pgTable, uuid, text, timestamp, date, index, jsonb } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { goals } from "./goals.js";
import { agents } from "./agents.js";
import type { AgentEnvConfig } from "@armyofagents/shared";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull().default("department"), // 'department' | 'project'
    status: text("status").notNull().default("backlog"),
    leadAgentId: uuid("lead_agent_id").references(() => agents.id, { onDelete: "set null" }),
    targetDate: date("target_date"),
    color: text("color"),
    functionType: text("function_type").default("general"),
    defaultThreadVisibility: text("default_thread_visibility").notNull().default("open"), // ThreadVisibility: per-dept default for new threads (HR/Finance/Exec -> private)
    executionWorkspacePolicy: jsonb("execution_workspace_policy").$type<Record<string, unknown>>(),
    env: jsonb("env").$type<AgentEnvConfig>(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("projects_company_idx").on(table.companyId),
  }),
);
