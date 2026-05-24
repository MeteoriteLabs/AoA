import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { goals } from "./goals.js";
import { issues } from "./issues.js";
import { memoryItems } from "./memory_items.js";
import { internalAgentRuns } from "./internal_agent.js";

// ── Table 1: discussions ──────────────────────────────────────────────────────

export const discussions = pgTable(
  "discussions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title"), // nullable — auto-generated if not provided
    status: text("status").notNull().default("active"), // 'active' | 'archived'

    // Polymorphic scope — what this discussion is about
    scopeType: text("scope_type"), // 'department' | 'project' | 'goal' | null
    scopeId: uuid("scope_id"), // FK resolved at app level based on scopeType

    tags: jsonb("tags").default([]), // string array for flexible categorization

    // ── Threads v1: thread-container fields ──
    originSource: text("origin_source"), // ThreadOriginSource: human|agent|external|system
    originMedium: text("origin_medium"), // ThreadOriginMedium
    intent: jsonb("intent").default([]), // ThreadIntent[] (multi-tag)
    phase: text("phase").notNull().default("discuss"), // ThreadPhase: discuss|scope|assign|done
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }), // goal-as-property
    visibility: text("visibility").notNull().default("open"), // ThreadVisibility: open|private
    ownerUserId: text("owner_user_id"), // accountable human (TEXT like issues.assigneeUserId); null = Unclaimed
    autonomyLevel: integer("autonomy_level"), // 1..3; null = fall back to internal_agent_config
    subtype: text("subtype").notNull().default("normal"), // ThreadSubtype: normal|live
    forkedFromId: uuid("forked_from_id").references((): AnyPgColumn => discussions.id, { onDelete: "set null" }),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => discussions.id, { onDelete: "set null" }),
    summaryText: text("summary_text"),
    summaryNext: text("summary_next"),
    summaryUpdatedAt: timestamp("summary_updated_at", { withTimezone: true }),
    entrySeq: integer("entry_seq").notNull().default(0), // atomic per-thread entry counter (Plan 7 seq assignment)

    // Denormalized metadata
    entryCount: integer("entry_count").notNull().default(0),
    pendingItemCount: integer("pending_item_count").notNull().default(0),
    lastEntryAt: timestamp("last_entry_at", { withTimezone: true }),

    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyIdx: index("discussions_company_idx").on(table.companyId),
    companyStatusIdx: index("discussions_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    scopeIdx: index("discussions_scope_idx").on(table.scopeType, table.scopeId),
    lastEntryIdx: index("discussions_last_entry_idx").on(
      table.companyId,
      table.lastEntryAt,
    ),
  }),
);

// ── Table 2: discussion_entries ───────────────────────────────────────────────

export const discussionEntries = pgTable(
  "discussion_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    discussionId: uuid("discussion_id")
      .notNull()
      .references(() => discussions.id, { onDelete: "cascade" }),

    // Input
    inputType: text("input_type").notNull(), // 'paste' | 'write' | 'voice' | 'mcp'
    rawContent: text("raw_content").notNull(),
    title: text("title"), // nullable, optional per-entry title

    // Source metadata
    sourceInfo: jsonb("source_info"), // { transcriptionModel, mcpSource, mcpClientId, ... }

    // Scope override (entry-level > discussion-level, per Decision #61 pattern)
    departmentId: uuid("department_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    goalId: uuid("goal_id").references(() => goals.id, {
      onDelete: "set null",
    }),

    // Processing state
    extractionStatus: text("extraction_status").notNull().default("pending"),
    // 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'
    extractionRunId: uuid("extraction_run_id").references(
      () => internalAgentRuns.id,
      { onDelete: "set null" },
    ),

    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    discussionIdx: index("discussion_entries_discussion_idx").on(
      table.discussionId,
    ),
    extractionStatusIdx: index("discussion_entries_extraction_status_idx").on(
      table.extractionStatus,
    ),
    createdAtIdx: index("discussion_entries_created_at_idx").on(
      table.discussionId,
      table.createdAt,
    ),
  }),
);

// ── Table 3: discussion_extracted_items ───────────────────────────────────────

export const discussionExtractedItems = pgTable(
  "discussion_extracted_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    discussionEntryId: uuid("discussion_entry_id")
      .notNull()
      .references(() => discussionEntries.id, { onDelete: "cascade" }),

    // Item content
    type: text("type").notNull(),
    // 'decision' | 'task' | 'insight' | 'context' | 'reference' | 'preference'
    title: text("title").notNull(),
    description: text("description"),

    // Suggestions from extraction
    suggestedPriority: text("suggested_priority"), // 'urgent' | 'high' | 'medium' | 'low'
    suggestedAssigneeId: uuid("suggested_assignee_id"),
    suggestedDepartmentId: uuid("suggested_department_id").references(
      () => projects.id,
      { onDelete: "set null" },
    ),
    suggestedProjectId: uuid("suggested_project_id").references(
      () => projects.id,
      { onDelete: "set null" },
    ),
    suggestedLayer: text("suggested_layer"), // 'identity' | 'domain' | 'active_context' | 'working'
    suggestedGoalId: uuid("suggested_goal_id").references(() => goals.id, {
      onDelete: "set null",
    }),

    // Founder overrides (applied during review)
    layer: text("layer"), // actual memory layer chosen by founder
    priority: text("priority"), // actual priority chosen by founder

    // Memory dedup
    dedupAction: text("dedup_action"), // 'create_separate' | 'update_existing' | 'replace'
    selectedMemoryId: uuid("selected_memory_id").references(
      () => memoryItems.id,
      { onDelete: "set null" },
    ),
    mergedContent: text("merged_content"), // preview of merge result

    // Status
    status: text("status").notNull().default("pending"),
    // 'pending' | 'approved' | 'rejected' | 'edited'

    // Result links (populated after approval)
    resultTaskId: uuid("result_task_id").references(() => issues.id, {
      onDelete: "set null",
    }),
    resultMemoryId: uuid("result_memory_id").references(() => memoryItems.id, {
      onDelete: "set null",
    }),

    // Conflict detection
    conflictsWith: jsonb("conflicts_with"), // array of { entityType, entityId, description }

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    entryIdx: index("discussion_extracted_items_entry_idx").on(
      table.discussionEntryId,
    ),
    statusIdx: index("discussion_extracted_items_status_idx").on(
      table.discussionEntryId,
      table.status,
    ),
  }),
);

// ── Table 4: discussion_annotations ──────────────────────────────────────────

export const discussionAnnotations = pgTable(
  "discussion_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    discussionEntryId: uuid("discussion_entry_id")
      .notNull()
      .references(() => discussionEntries.id, { onDelete: "cascade" }),

    content: text("content").notNull(),

    // Position in the entry text (for inline annotations)
    // null = general annotation on the whole entry
    anchorStart: integer("anchor_start"), // character offset start
    anchorEnd: integer("anchor_end"), // character offset end

    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    entryIdx: index("discussion_annotations_entry_idx").on(
      table.discussionEntryId,
    ),
  }),
);

// ── Relations ────────────────────────────────────────────────────────────────

export const discussionsRelations = relations(discussions, ({ one, many }) => ({
  company: one(companies, {
    fields: [discussions.companyId],
    references: [companies.id],
  }),
  entries: many(discussionEntries),
}));

export const discussionEntriesRelations = relations(
  discussionEntries,
  ({ one, many }) => ({
    discussion: one(discussions, {
      fields: [discussionEntries.discussionId],
      references: [discussions.id],
    }),
    extractedItems: many(discussionExtractedItems),
    annotations: many(discussionAnnotations),
    department: one(projects, {
      fields: [discussionEntries.departmentId],
      references: [projects.id],
      relationName: "entryDepartment",
    }),
    project: one(projects, {
      fields: [discussionEntries.projectId],
      references: [projects.id],
      relationName: "entryProject",
    }),
    goal: one(goals, {
      fields: [discussionEntries.goalId],
      references: [goals.id],
    }),
    extractionRun: one(internalAgentRuns, {
      fields: [discussionEntries.extractionRunId],
      references: [internalAgentRuns.id],
    }),
  }),
);

export const discussionExtractedItemsRelations = relations(
  discussionExtractedItems,
  ({ one }) => ({
    entry: one(discussionEntries, {
      fields: [discussionExtractedItems.discussionEntryId],
      references: [discussionEntries.id],
    }),
    resultTask: one(issues, {
      fields: [discussionExtractedItems.resultTaskId],
      references: [issues.id],
    }),
    resultMemory: one(memoryItems, {
      fields: [discussionExtractedItems.resultMemoryId],
      references: [memoryItems.id],
      relationName: "extractedItemResultMemory",
    }),
  }),
);

export const discussionAnnotationsRelations = relations(
  discussionAnnotations,
  ({ one }) => ({
    entry: one(discussionEntries, {
      fields: [discussionAnnotations.discussionEntryId],
      references: [discussionEntries.id],
    }),
  }),
);
