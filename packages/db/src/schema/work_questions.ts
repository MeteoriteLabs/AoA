import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { WorkQuestionAnswer, WorkQuestionOption } from "@armyofagents/shared";
import { agents } from "./agents.js";
import { authUsers } from "./auth.js";
import { companies } from "./companies.js";
import { discussionEntries, discussions } from "./discussions.js";
import { executionWorkspaces } from "./execution_workspaces.js";
import { issues } from "./issues.js";

export const workQuestions = pgTable(
  "work_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    askingAgentId: uuid("asking_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    originatingRunKind: text("originating_run_kind"),
    // Polymorphic heartbeat_runs/internal_agent_runs identifier.
    originatingRunId: uuid("originating_run_id"),
    executionWorkspaceId: uuid("execution_workspace_id").references(
      () => executionWorkspaces.id,
      { onDelete: "set null" },
    ),
    sourceDiscussionId: uuid("source_discussion_id").references(() => discussions.id, {
      onDelete: "set null",
    }),
    sourceDiscussionEntryId: uuid("source_discussion_entry_id").references(
      () => discussionEntries.id,
      { onDelete: "set null" },
    ),
    primaryRecipientUserId: text("primary_recipient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    currentRecipientUserId: text("current_recipient_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    question: text("question").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>(),
    options: jsonb("options").$type<WorkQuestionOption[]>(),
    blocking: boolean("blocking").notNull().default(true),
    status: text("status").notNull().default("open"),
    answer: jsonb("answer").$type<WorkQuestionAnswer>(),
    answerIdempotencyKey: text("answer_idempotency_key"),
    answeredByUserId: text("answered_by_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    continuationStatus: text("continuation_status").notNull().default("not_needed"),
    continuationRunKind: text("continuation_run_kind"),
    // Polymorphic heartbeat_runs/internal_agent_runs identifier.
    continuationRunId: uuid("continuation_run_id"),
    continuationError: text("continuation_error"),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyRecipientStatusIdx: index("work_questions_company_recipient_status_idx").on(
      table.companyId,
      table.currentRecipientUserId,
      table.status,
    ),
    issueStatusCreatedIdx: index("work_questions_issue_status_created_idx").on(
      table.issueId,
      table.status,
      table.createdAt,
    ),
    sourceDiscussionCreatedIdx: index("work_questions_source_discussion_created_idx").on(
      table.sourceDiscussionId,
      table.createdAt,
    ),
    workspaceCreatedIdx: index("work_questions_workspace_created_idx").on(
      table.executionWorkspaceId,
      table.createdAt,
    ),
    originatingRunIdx: index("work_questions_originating_run_idx").on(
      table.originatingRunKind,
      table.originatingRunId,
    ),
    continuationStatusIdx: index("work_questions_continuation_status_idx").on(
      table.continuationStatus,
      table.updatedAt,
    ),
  }),
);
