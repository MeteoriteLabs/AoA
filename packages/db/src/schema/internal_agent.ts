import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { agents } from "./agents.js";

// ── Table 5: internal_agent_config ──────────────────────────────────────────

export const internalAgentConfig = pgTable(
  "internal_agent_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .unique()
      .references(() => companies.id, { onDelete: "cascade" }),

    // Execution mode — Sprint 2A (Decision #91) made CLI the only dispatched
    // path. 'api' is still a valid historical value in existing rows and the
    // column stays for rollback safety, but agent-loop.ts no longer branches
    // on it — every Commander turn goes through cli-mode.ts.
    executionMode: text("execution_mode").notNull().default("cli"), // 'api' | 'cli'

    // Legacy API-mode settings (dormant post-Sprint-2A, kept for rollback
    // safety and for the `model` column's potential future reuse as a CLI
    // flag). Not read by the dispatch path.
    provider: text("provider").default("anthropic"), // 'anthropic' | 'openai' | 'google'
    model: text("model").default("claude-sonnet-4-6"),
    // Cheap-model fallback (D4): if set and monthly spend ≥ 80% of budget,
    // heartbeat swaps adapter model to this value for the rest of the month.
    cheapModel: text("cheap_model"),

    // CLI mode settings
    cliTool: text("cli_tool"), // 'claude_cli' | 'codex' | 'opencode' | null

    // Autonomy
    autonomyLevel: integer("autonomy_level").notNull().default(0), // 0-3, v2.5 ships with 0 only

    // Capabilities
    enabledCapabilities: jsonb("enabled_capabilities").notNull().default([
      "discussion_processing",
      "proactive_suggestions",
      "organizational_queries",
      "system_actions",
      "context_briefing",
      "memory_management",
      "conflict_detection",
      "budget_awareness",
      "workflow_coaching",
      "workflow_discovery",
      "cross_department_coordination",
      "department_personas",
    ]),

    // Notifications
    notificationPreference: text("notification_preference")
      .notNull()
      .default("realtime"), // 'silent' | 'digest' | 'realtime'

    // Context
    contextTokenBudget: integer("context_token_budget").notNull().default(8000),

    // Budget (cents — DA-25)
    budgetMonthlyCents: integer("budget_monthly_cents"), // null = unlimited
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),

    // Proactive scheduling
    proactiveIntervalMinutes: integer("proactive_interval_minutes")
      .notNull()
      .default(240), // 4 hours
    lastProactiveRunAt: timestamp("last_proactive_run_at", {
      withTimezone: true,
    }),

    // Metadata
    metadata: jsonb("metadata").default({}),

    // Per-tool permission overrides for Commander. Keys are tool names.
    // Null = use system defaults (enabled=true, requireConfirmation=false, minimumRole=team_member).
    commanderToolPermissions: jsonb("commander_tool_permissions"),

    // Plan 3 Task 8: company-level crew kill-switch.
    // When true, no crew roles fire for ANY thread in this company.
    // Thread-level pause is in discussions.crewPaused.
    crewPaused: boolean("crew_paused").notNull().default(false),

    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyIdx: uniqueIndex("internal_agent_config_company_uq").on(
      table.companyId,
    ),
  }),
);

// ── Table 6: internal_agent_conversations ───────────────────────────────────

export const internalAgentConversations = pgTable(
  "internal_agent_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),

    status: text("status").notNull().default("active"), // 'active' | 'archived'

    // Summarized context from older messages
    summarizedContext: text("summarized_context"), // compressed history for token management
    summarizedUpToMessageId: uuid("summarized_up_to_message_id"), // last message included in summary

    messageCount: integer("message_count").notNull().default(0), // denormalized

    // Multi-chat (Sprint 3): user-visible conversation title, archive timestamp,
    // and founder-visible sharing flag (RBAC option C).
    title: text("title"),            // null = auto-title from first message
    archivedAt: timestamp("archived_at", { withTimezone: true }), // null = active
    pinned: boolean("pinned").notNull().default(false),
    sharedWithCompany: boolean("shared_with_company").notNull().default(false),

    // Manual drag-and-drop ordering of the session list. null = not manually
    // ordered (the list falls back to recency/date groups). Once the user drags,
    // every visible conversation gets an explicit index here and the UI switches
    // to a flat user-arranged list. (Batch 2: Commander session reorder.)
    sortOrder: integer("sort_order"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyUserIdx: index("ia_conversations_company_user_idx").on(
      table.companyId,
      table.userId,
    ),
    activeIdx: index("ia_conversations_active_idx").on(
      table.companyId,
      table.userId,
      table.status,
    ),
  }),
);

// ── Table 7: internal_agent_messages ────────────────────────────────────────

export const internalAgentMessages = pgTable(
  "internal_agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => internalAgentConversations.id, { onDelete: "cascade" }),

    role: text("role").notNull(), // 'user' | 'assistant' | 'system' | 'tool_call' | 'tool_result'
    content: text("content"), // nullable for tool_call messages where content is in toolCalls

    // Tool interaction
    toolCalls: jsonb("tool_calls"), // array of { id, name, input }
    toolResults: jsonb("tool_results"), // array of { toolCallId, result }

    // Context at time of message
    pageContext: text("page_context"), // which page the user was on
    departmentContext: uuid("department_context"), // if agent was in department persona mode

    // Metadata
    tokenCount: integer("token_count"), // estimated tokens this message consumed
    runId: uuid("run_id").references(() => internalAgentRuns.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    conversationIdx: index("ia_messages_conversation_idx").on(
      table.conversationId,
    ),
    conversationTimeIdx: index("ia_messages_conversation_time_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    runIdx: index("ia_messages_run_idx").on(table.runId),
  }),
);

// ── Table 8: internal_agent_runs ────────────────────────────────────────────

export const internalAgentRuns = pgTable(
  "internal_agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    // Trigger classification (DA-27)
    triggerType: text("trigger_type").notNull(), // 'conversation' | 'proactive' | 'event' | 'sub_agent'
    triggerSource: text("trigger_source").notNull(), // extensible: 'user_message', 'discussion_entry', etc.

    // Execution state
    status: text("status").notNull().default("running"), // 'running' | 'completed' | 'failed'
    errorMessage: text("error_message"), // populated on failure

    // What the agent did
    toolsCalled: jsonb("tools_called").default([]), // array of { name, input, output, durationMs, success }
    summary: text("summary"), // human-readable summary of what happened

    // Cost tracking (DA-25: cents, not USD)
    tokenUsage: jsonb("token_usage"), // { inputTokens, outputTokens, cachedInputTokens }
    costCents: integer("cost_cents"),
    durationMs: integer("duration_ms"),

    // Context
    departmentContext: uuid("department_context").references(
      () => projects.id,
      { onDelete: "set null" },
    ),
    userId: text("user_id"), // who triggered (null for proactive/event)
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    // Plain uuid, not a FK — mutual reference with messages.runId would create
    // insert ordering issues (message references run, run references message)
    conversationMessageId: uuid("conversation_message_id"),

    // Related entity
    relatedEntityType: text("related_entity_type"), // 'discussion' | 'task' | 'agent' | 'goal' | 'memory' | null
    relatedEntityId: uuid("related_entity_id"),

    // LLM info
    provider: text("provider"), // 'anthropic' | 'openai' | 'google'
    model: text("model"), // specific model used

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    companyIdx: index("ia_runs_company_idx").on(table.companyId),
    companyStatusIdx: index("ia_runs_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    triggerIdx: index("ia_runs_trigger_idx").on(
      table.companyId,
      table.triggerType,
      table.triggerSource,
    ),
    createdAtIdx: index("ia_runs_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
    relatedEntityIdx: index("ia_runs_related_entity_idx").on(
      table.relatedEntityType,
      table.relatedEntityId,
    ),
    agentIdx: index("ia_runs_agent_idx").on(table.companyId, table.agentId),
  }),
);

// ── Table 9: internal_agent_reminders ───────────────────────────────────────

export const internalAgentReminders = pgTable(
  "internal_agent_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),

    content: text("content").notNull(), // "Follow up on dashboard project"
    triggerAt: timestamp("trigger_at", { withTimezone: true }).notNull(),

    status: text("status").notNull().default("pending"), // 'pending' | 'fired' | 'cancelled'

    firedRunId: uuid("fired_run_id").references(() => internalAgentRuns.id, {
      onDelete: "set null",
    }),

    // Optional link to entity
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyUserIdx: index("ia_reminders_company_user_idx").on(
      table.companyId,
      table.userId,
    ),
    pendingIdx: index("ia_reminders_pending_idx").on(
      table.status,
      table.triggerAt,
    ),
  }),
);

// ── Relations ───────────────────────────────────────────────────────────────

export const internalAgentConfigRelations = relations(
  internalAgentConfig,
  ({ one }) => ({
    company: one(companies, {
      fields: [internalAgentConfig.companyId],
      references: [companies.id],
    }),
    agent: one(agents, {
      fields: [internalAgentConfig.agentId],
      references: [agents.id],
    }),
  }),
);

export const internalAgentConversationsRelations = relations(
  internalAgentConversations,
  ({ one, many }) => ({
    company: one(companies, {
      fields: [internalAgentConversations.companyId],
      references: [companies.id],
    }),
    messages: many(internalAgentMessages),
  }),
);

export const internalAgentMessagesRelations = relations(
  internalAgentMessages,
  ({ one }) => ({
    conversation: one(internalAgentConversations, {
      fields: [internalAgentMessages.conversationId],
      references: [internalAgentConversations.id],
    }),
    run: one(internalAgentRuns, {
      fields: [internalAgentMessages.runId],
      references: [internalAgentRuns.id],
    }),
  }),
);

export const internalAgentRunsRelations = relations(
  internalAgentRuns,
  ({ one }) => ({
    company: one(companies, {
      fields: [internalAgentRuns.companyId],
      references: [companies.id],
    }),
    department: one(projects, {
      fields: [internalAgentRuns.departmentContext],
      references: [projects.id],
    }),
  }),
);

export const internalAgentRemindersRelations = relations(
  internalAgentReminders,
  ({ one }) => ({
    company: one(companies, {
      fields: [internalAgentReminders.companyId],
      references: [companies.id],
    }),
  }),
);
