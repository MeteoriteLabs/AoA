import { index, pgTable, text, timestamp, uniqueIndex, uuid, jsonb } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * External MCP servers a company has registered. `transport` selects which
 * columns are meaningful: "http" uses url + headerTemplate; "stdio" uses
 * command + args.
 *
 * SECRETS: headerTemplate/envTemplate values hold `${VAR}` PLACEHOLDERS ONLY.
 * The real value lives in company_secrets and is referenced by secretRef.
 */
export const companyMcpConnectors = pgTable(
  "company_mcp_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // Server name as it appears in MCP config. Lowercase, no spaces.
    serverName: text("server_name").notNull(),
    displayName: text("display_name").notNull(),
    transport: text("transport").notNull(), // "http" | "stdio"
    url: text("url"),
    command: text("command"),
    args: jsonb("args").$type<string[]>().notNull().default([]),
    headerTemplate: jsonb("header_template").$type<Record<string, string>>().notNull().default({}),
    envTemplate: jsonb("env_template").$type<Record<string, string>>().notNull().default({}),
    // Key into company_secrets (e.g. "mcp:notion"). Null for unauthenticated servers.
    secretRef: text("secret_ref"),
    source: text("source").notNull().default("byo"), // "byo" | "catalog"
    status: text("status").notNull().default("pending_approval"), // pending_approval | active | disabled
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("company_mcp_connectors_company_idx").on(table.companyId),
    companyNameUq: uniqueIndex("company_mcp_connectors_company_name_uq").on(
      table.companyId,
      table.serverName,
    ),
  }),
);
