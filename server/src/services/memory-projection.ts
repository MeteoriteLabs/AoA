import { memoryItems } from "@armyofagents/db";
import { getDbCapabilities } from "./db-capabilities.js";

/**
 * Drizzle select-column map for memoryItems that conditionally includes
 * the `embedding` column based on pgvector availability.
 *
 * Use this in place of `.select().from(memoryItems)` so queries don't
 * reference a column that doesn't exist on installs without pgvector.
 *
 * Why: migration 0038_marvelous_vapor.sql creates the embedding column
 * conditionally (only when `pg_extension` contains 'vector'). But the
 * Drizzle schema always references the column, so `SELECT *` generates
 * `SELECT ... embedding ...` which 500s on installs without pgvector.
 */
export function memoryItemsSelection(hasVector?: boolean) {
  const effective = hasVector ?? getDbCapabilities().hasVectorSupport;
  const base = {
    id: memoryItems.id,
    companyId: memoryItems.companyId,
    title: memoryItems.title,
    content: memoryItems.content,
    category: memoryItems.category,
    source: memoryItems.source,
    status: memoryItems.status,
    tags: memoryItems.tags,
    departmentId: memoryItems.departmentId,
    projectId: memoryItems.projectId,
    createdBy: memoryItems.createdBy,
    layer: memoryItems.layer,
    priority: memoryItems.priority,
    visibility: memoryItems.visibility,
    expiresAt: memoryItems.expiresAt,
    goalId: memoryItems.goalId,
    taskId: memoryItems.taskId,
    sourceArtifactId: memoryItems.sourceArtifactId,
    sourceContext: memoryItems.sourceContext,
    accessedAt: memoryItems.accessedAt,
    currentVersionId: memoryItems.currentVersionId,
    embeddingRetries: memoryItems.embeddingRetries,
    createdAt: memoryItems.createdAt,
    updatedAt: memoryItems.updatedAt,
  };
  return effective ? { ...base, embedding: memoryItems.embedding } : base;
}
