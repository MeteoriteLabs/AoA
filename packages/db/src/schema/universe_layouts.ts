import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/** A persisted panel in a Universe layout snapshot. Presentation only — no content
 * bodies, credentials or live tokens are ever stored here. */
export interface UniverseLayoutPanel {
  key: string;
  ref: {
    companyId: string;
    kind: "task" | "artifact" | "browser";
    id: string;
    version?: string;
  };
  title: string;
  rect: { x: number; y: number; width: number; height: number };
  openedOrdinal: number;
  minimized: boolean;
  pinned: boolean;
  placement?: "auto" | "manual";
}

/** The stored Universe canvas snapshot document (the presentation state). Revision
 * and schemaVersion live in columns; the document itself carries no scope. */
export interface UniverseLayoutDocument {
  panels: UniverseLayoutPanel[];
  order: string[];
  selected: string | null;
  maximized: string | null;
  viewport: { x: number; y: number; zoom: number };
  nextOpenedOrdinal: number;
}

/** One canonical layout row per (company, user, conversation). Owner-only writes;
 * `revision` provides optimistic concurrency, and each applied patch is journaled
 * in `universe_layout_operations` for idempotent acknowledgement. Uses the
 * company-scoped application boundary (like internal_agent_conversations), NOT the
 * frozen replatform distributed-execution RLS table set. */
export const universeLayouts = pgTable(
  "universe_layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    document: jsonb("document").$type<UniverseLayoutDocument>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyUserIdx: index("universe_layouts_company_user_idx").on(
      table.companyId,
      table.userId,
    ),
    ownerConversationUq: uniqueIndex(
      "universe_layouts_owner_conversation_uq",
    ).on(table.userId, table.companyId, table.conversationId),
  }),
);

/** Idempotency journal: each applied patch's operationId, the canonical hash of
 * its payload, and the revision it produced. A replayed operationId with the same
 * hash returns its original acknowledgement; a different hash is a conflict. */
export const universeLayoutOperations = pgTable(
  "universe_layout_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    layoutId: uuid("layout_id")
      .notNull()
      .references(() => universeLayouts.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    operationId: text("operation_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    acknowledgedRevision: bigint("acknowledged_revision", {
      mode: "number",
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    layoutOperationUq: uniqueIndex(
      "universe_layout_operations_layout_op_uq",
    ).on(table.layoutId, table.operationId),
  }),
);
