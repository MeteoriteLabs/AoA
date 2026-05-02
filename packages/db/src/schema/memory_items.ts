import {
  type AnyPgColumn,
  customType,
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { goals } from "./goals.js";
import { issues } from "./issues.js";
import { artifacts } from "./artifacts.js";
import { agents } from "./agents.js";
import { memoryItemVersions } from "./memory_item_versions.js";
import { fileImportJobs } from "./file_import_jobs.js";

/**
 * Custom Drizzle type for pgvector's `vector(N)` column.
 * Stores/retrieves a number[] and maps to the SQL `vector` type.
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    // pgvector returns "[0.1,0.2,...]" string
    return JSON.parse(value);
  },
});

export const memoryItems = pgTable(
  "memory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    category: text("category").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull().default("pending"),
    tags: jsonb("tags").default([]).$type<string[]>(),
    departmentId: uuid("department_id").references(() => projects.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdBy: text("created_by").notNull(),
    // V2 fields
    layer: text("layer"),
    priority: integer("priority").notNull().default(0),
    visibility: text("visibility").notNull().default("scoped"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references((): AnyPgColumn => issues.id, { onDelete: "set null" }),
    sourceArtifactId: uuid("source_artifact_id").references(() => artifacts.id, { onDelete: "set null" }),
    sourceContext: text("source_context"),
    accessedAt: timestamp("accessed_at", { withTimezone: true }),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => memoryItemVersions.id, { onDelete: "set null" }),
    // V2: Semantic retrieval — pgvector embedding (1536-dim, OpenAI text-embedding-3-small)
    embedding: vector("embedding"),
    // V2: Retry persistence — prevents infinite retry loops for failed embeddings
    embeddingRetries: integer("embedding_retries").notNull().default(0),
    // V2.6: agent-personal memory scope. Set when an agent retains an item to its own bucket.
    // Items with agentId set are visible only to that agent + founder/team_lead in that scope.
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    // V2.6: trust signal for retrieval ranking. Bumped on shownToAgent + founder validate +
    // observer pattern confirmation. Default 1 (creation counts as one validation).
    validationCount: integer("validation_count").notNull().default(1),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    // V2.6: marks the item for eager skill-file delivery to scoped agents (Tier 1 push).
    // Materialized into the synthesized "company-knowledge" skill at run start.
    pinnedToSkill: boolean("pinned_to_skill").notNull().default(false),
    // V2.6: tracks which file import job created this item (nullable — most items are not file-imported)
    importJobId: uuid("import_job_id").references(() => fileImportJobs.id, {
      onDelete: "set null",
    }),
    // Phase 6: tree path within the dept's memory hierarchy. Empty string = dept root.
    // POSIX-style with `/` separators. e.g. "Engineering/Decisions" or "Company".
    folderPath: text("folder_path").notNull().default(""),
    // Phase 6: tracks which user last opened this item in the explorer (for Recents on home).
    // Distinct from accessedAt (used by staleness detection).
    lastAccessedByUserId: uuid("last_accessed_by_user_id"),
    // Phase 6: drives the virtual "Pinned" folder at the top of the tree.
    // NOT the same as pinnedToSkill (which materializes into agent skill files).
    founderPinnedToTop: boolean("founder_pinned_to_top").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("memory_items_company_idx").on(table.companyId),
    companyCategoryIdx: index("memory_items_company_category_idx").on(table.companyId, table.category),
    companyStatusIdx: index("memory_items_company_status_idx").on(table.companyId, table.status),
    companyLayerStatusIdx: index("memory_items_company_layer_status_idx").on(table.companyId, table.layer, table.status),
    goalActiveContextIdx: index("memory_items_goal_active_context_idx").on(table.goalId, table.expiresAt),
    taskWorkingIdx: index("memory_items_task_working_idx").on(table.taskId),
    // V2.6: scope by agent for agent-personal memory retrieval.
    agentScopeIdx: index("memory_items_agent_scope_idx").on(table.companyId, table.agentId, table.status),
    // V2.6: surface pinned items quickly for skill materialization.
    pinnedSkillIdx: index("memory_items_pinned_skill_idx").on(table.companyId, table.pinnedToSkill, table.status),
    folderPathIdx: index("memory_items_folder_path_idx").on(
      table.companyId,
      table.departmentId,
      table.folderPath,
    ),
    foundersPinnedIdx: index("memory_items_founder_pinned_idx").on(
      table.companyId,
      table.founderPinnedToTop,
    ),
  }),
);
