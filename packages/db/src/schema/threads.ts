import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { assets } from "./assets.js";
import { artifacts } from "./artifacts.js";
import {
  discussions,
  discussionEntries,
  discussionExtractedItems,
} from "./discussions.js";

// ── thread_participants: who's on a thread (humans + agents) ──
export const threadParticipants = pgTable(
  "thread_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull().references(() => discussions.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(), // ThreadParticipantPrincipalType: user|agent
    principalId: text("principal_id").notNull(), // user id (text) OR agent id (uuid stored as text)
    role: text("role").notNull(), // ThreadParticipantRole: owner|co_owner|collaborator|viewer|worker
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadIdx: index("thread_participants_thread_idx").on(table.threadId),
    principalIdx: index("thread_participants_principal_idx").on(table.principalType, table.principalId),
    companyIdx: index("thread_participants_company_idx").on(table.companyId),
    // Eng-review A1: prevents duplicate owner rows; Plan 2 upserts via onConflictDoNothing
    uniqParticipant: uniqueIndex("thread_participants_unique").on(
      table.threadId, table.principalType, table.principalId,
    ),
  }),
);

// ── thread_links: typed relationships between threads ──
export const threadLinks = pgTable(
  "thread_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    fromThreadId: uuid("from_thread_id").notNull().references(() => discussions.id, { onDelete: "cascade" }),
    toThreadId: uuid("to_thread_id").notNull().references(() => discussions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // ThreadLinkKind: link|spinoff|fork|merge|goal_cluster|spawned_from_task
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fromIdx: index("thread_links_from_idx").on(table.fromThreadId),
    toIdx: index("thread_links_to_idx").on(table.toThreadId),
  }),
);

// ── scope_item_dependencies: pre-task -> pre-task blocking (before tasks exist) ──
export const scopeItemDependencies = pgTable(
  "scope_item_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerItemId: uuid("blocker_item_id").notNull().references(() => discussionExtractedItems.id, { onDelete: "cascade" }),
    blockedItemId: uuid("blocked_item_id").notNull().references(() => discussionExtractedItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    blockerIdx: index("scope_item_dependencies_blocker_idx").on(table.blockerItemId),
    blockedIdx: index("scope_item_dependencies_blocked_idx").on(table.blockedItemId),
  }),
);

// ── thread_plan_steps: the live ordered Plan in the Scope tab ──
export const threadPlanSteps = pgTable(
  "thread_plan_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id").notNull().references(() => discussions.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull().default(0), // "order" is a SQL reserved word -> step_order
    title: text("title").notNull(),
    collapsed: boolean("collapsed").notNull().default(false),
    linkedItemId: uuid("linked_item_id").references(() => discussionExtractedItems.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadIdx: index("thread_plan_steps_thread_idx").on(table.threadId),
  }),
);

// ── thread_inbox_items: the Unlisted queue (un-routed inbound) ──
export const threadInboxItems = pgTable(
  "thread_inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    rawContent: text("raw_content").notNull(),
    originSource: text("origin_source"), // ThreadOriginSource
    originMedium: text("origin_medium"), // ThreadOriginMedium
    routerConfidence: doublePrecision("router_confidence"), // 0..1 internal score (never shown raw)
    routerDecision: text("router_decision"), // ThreadRouterDecision: auto_attach|suggest|human
    suggestedThreadId: uuid("suggested_thread_id").references(() => discussions.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"), // ThreadInboxStatus: pending|attached|dismissed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("thread_inbox_items_company_status_idx").on(table.companyId, table.status),
  }),
);

// ── discussion_entry_attachments: link assets/artifacts to entries ──
export const discussionEntryAttachments = pgTable(
  "discussion_entry_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    discussionEntryId: uuid("discussion_entry_id").notNull().references(() => discussionEntries.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    artifactId: uuid("artifact_id").references(() => artifacts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entryIdx: index("discussion_entry_attachments_entry_idx").on(table.discussionEntryId),
  }),
);
