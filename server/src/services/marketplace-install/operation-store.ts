/**
 * @fileoverview CRUD layer for marketplace_install_operations table.
 *
 * Pure data access — no orchestration, no live-events, no installer dispatch.
 * The orchestrator (orchestrator.ts) sits one layer above and composes these
 * primitives with the installers.
 *
 * Idempotency: 24h window enforced in app via createdAt cutoff (not DB
 * constraint, since the unique index is unbounded — see schema for details).
 */

import { eq, and, gt } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { marketplaceInstallOperations } from "@armyofagents/db";
import type { CascadeStepResult } from "@armyofagents/db";
import type { CatalogItem } from "@armyofagents/shared";

const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface OperationRow {
  id: string;
  companyId: string;
  catalogItemId: string;
  itemType: "plugin" | "skill" | "agent" | "team";
  targetDepartmentId: string | null;
  status: "pending" | "running" | "success" | "failure";
  resultEntityId: string | null;
  errorMessage: string | null;
  cascadeResults: CascadeStepResult[] | null;
  idempotencyKey: string | null;
  requestedByUserId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}

export interface CreateOperationInput {
  companyId: string;
  catalogItem: CatalogItem;
  targetDepartmentId?: string;
  idempotencyKey?: string;
  requestedByUserId: string;
}

/**
 * Look up a recent operation by idempotency key (within 24h window).
 * Returns null if no match — caller proceeds with createOperation.
 */
export async function findExistingByIdempotencyKey(
  db: Db,
  companyId: string,
  idempotencyKey: string,
): Promise<OperationRow | null> {
  const cutoff = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  const rows = await db
    .select()
    .from(marketplaceInstallOperations)
    .where(
      and(
        eq(marketplaceInstallOperations.companyId, companyId),
        eq(marketplaceInstallOperations.idempotencyKey, idempotencyKey),
        gt(marketplaceInstallOperations.createdAt, cutoff),
      ),
    )
    .limit(1);
  return (rows[0] as OperationRow | undefined) ?? null;
}

/**
 * Insert a new operation row in `pending` status.
 *
 * The DB has `defaultRandom()` on `id`, `defaultNow()` on `startedAt`/`createdAt`,
 * and `default("pending")` on `status` — we still pass `status` explicitly so
 * the row reads identically before and after the install loop runs.
 */
export async function createOperation(db: Db, input: CreateOperationInput): Promise<OperationRow> {
  const [row] = await db
    .insert(marketplaceInstallOperations)
    .values({
      companyId: input.companyId,
      catalogItemId: input.catalogItem.id,
      itemType: input.catalogItem.type,
      targetDepartmentId: input.targetDepartmentId ?? null,
      status: "pending",
      idempotencyKey: input.idempotencyKey ?? null,
      requestedByUserId: input.requestedByUserId,
    })
    .returning();
  return row as OperationRow;
}

/**
 * Patch an operation row. Only the status-transition columns are writable
 * via this helper — id, companyId, itemType, etc. are immutable by contract.
 */
export async function updateOperation(
  db: Db,
  id: string,
  patch: Partial<Pick<OperationRow, "status" | "resultEntityId" | "errorMessage" | "cascadeResults" | "completedAt">>,
): Promise<void> {
  await db
    .update(marketplaceInstallOperations)
    .set(patch)
    .where(eq(marketplaceInstallOperations.id, id));
}

/**
 * Look up an operation by id, scoped to companyId for RBAC isolation.
 * Returns null if the row doesn't exist OR belongs to another company —
 * the route handler maps both to 404 to avoid leaking presence/absence.
 */
export async function findOperationById(db: Db, id: string, companyId: string): Promise<OperationRow | null> {
  const rows = await db
    .select()
    .from(marketplaceInstallOperations)
    .where(
      and(
        eq(marketplaceInstallOperations.id, id),
        eq(marketplaceInstallOperations.companyId, companyId),
      ),
    )
    .limit(1);
  return (rows[0] as OperationRow | undefined) ?? null;
}
