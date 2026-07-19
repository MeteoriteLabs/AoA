import { index, integer, jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { agents } from "./agents.js";
import { authUsers } from "./auth.js";

/**
 * WS6 — durable per-department braindump capture, feeding the Librarian
 * crew agent (see server/src/services/internal-agent/aoa-agents/ensure-librarian.ts).
 *
 * Status machine: pending -> running -> proposed -> failed. ("approved" is a
 * DERIVED view, not a stored terminal status — see
 * server/src/services/braindump.ts for why: it depends on the founder
 * approving every linked memory_items row, which is many-to-one and already
 * tracked on memory_items itself.)
 *
 * Idempotency: unique on (companyId, departmentId, idempotencyKey) so a
 * resubmit/retry with the same caller-supplied key reuses the existing row
 * instead of creating a duplicate capture or double-dispatching the
 * Librarian.
 */
export const braindumpCaptures = pgTable(
  "braindump_captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    content: text("content").notNull(),
    contentLength: integer("content_length").notNull(),
    status: text("status").notNull().default("pending"), // pending | running | proposed | failed
    librarianAgentId: uuid("librarian_agent_id").references(() => agents.id, { onDelete: "set null" }),
    /** internal_agent_runs.id for the dispatch, when one was created. No FK
     *  (mirrors work_questions.originatingRunId) — cross-cutting run id, kept
     *  loosely coupled so a run-table cleanup never blocks a capture row. */
    runId: uuid("run_id"),
    /** Best-effort correlation only (time-window + agent + department query
     *  against memory_items after a successful run) — see braindump.ts. Not
     *  authoritative; the memory_items rows themselves are the source of
     *  truth for what was proposed. */
    proposedMemoryItemIds: jsonb("proposed_memory_item_ids").$type<string[]>().notNull().default([]),
    failureReason: text("failure_reason"),
    dispatchStartedAt: timestamp("dispatch_started_at", { withTimezone: true }),
    dispatchCompletedAt: timestamp("dispatch_completed_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUq: uniqueIndex("braindump_captures_idempotency_uq").on(
      table.companyId,
      table.departmentId,
      table.idempotencyKey,
    ),
    companyDepartmentStatusIdx: index("braindump_captures_company_department_status_idx").on(
      table.companyId,
      table.departmentId,
      table.status,
    ),
  }),
);
