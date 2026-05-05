import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, companyMemberships } from "@armyofagents/db";
import { notFound, unprocessable } from "../errors.js";

/**
 * Maximum depth for chain walking in cycle detection.
 * Prevents infinite loops on corrupted data.
 */
const MAX_CHAIN_DEPTH = 50;

export type EntityType = "agent" | "user";

/**
 * Shared org-hierarchy helpers used by both agentService and teamService.
 */
export function orgHierarchyService(db: Db) {
  /**
   * Walk the mixed agent/user parent chain starting from newParentId
   * and throw if we encounter entityId (which would create a cycle).
   *
   * - null parent → root node, no cycle possible
   * - self-reference → immediate rejection
   * - depth ≥ 50 → stop walking (no throw, prevents infinite loop on corrupt data)
   */
  async function assertNoCycle(
    companyId: string,
    entityId: string,
    entityType: EntityType,
    newParentId: string | null,
    newParentType: EntityType | null,
  ): Promise<void> {
    if (!newParentId || !newParentType) return;

    if (entityId === newParentId && entityType === newParentType) {
      throw unprocessable("Cannot set an entity as its own parent");
    }

    let currentId: string | null = newParentId;
    let currentType: EntityType | null = newParentType;
    let depth = 0;

    while (currentId && currentType && depth < MAX_CHAIN_DEPTH) {
      if (currentId === entityId && currentType === entityType) {
        throw unprocessable(
          `Cannot set parent: would create a circular reporting chain (depth ${depth})`,
        );
      }

      if (currentType === "agent") {
        const rows = await db
          .select({ parentType: agents.parentType, parentId: agents.parentId })
          .from(agents)
          .where(eq(agents.id, currentId))
          .limit(1);
        const row = rows[0];
        if (!row || !row.parentId) break;
        currentType = row.parentType as EntityType | null;
        currentId = row.parentId as string | null;
      } else {
        const rows = await db
          .select({
            parentType: companyMemberships.parentType,
            parentId: companyMemberships.parentId,
          })
          .from(companyMemberships)
          .where(
            and(
              eq(companyMemberships.companyId, companyId),
              eq(companyMemberships.principalType, "user"),
              eq(companyMemberships.principalId, currentId),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (!row || !row.parentId) break;
        currentType = row.parentType as EntityType | null;
        currentId = row.parentId as string | null;
      }

      depth++;
    }
  }

  /**
   * Validate that parentId refers to a valid, active entity in the same company.
   *
   * - agent parent: must exist in same company, not terminated
   * - user parent:  must have an active company_memberships row
   */
  async function ensureParent(
    companyId: string,
    parentType: EntityType,
    parentId: string,
  ): Promise<void> {
    if (parentType === "agent") {
      const rows = await db
        .select({ id: agents.id, status: agents.status })
        .from(agents)
        .where(and(eq(agents.id, parentId), eq(agents.companyId, companyId)))
        .limit(1);
      if (!rows[0]) throw notFound("Parent agent not found in this company");
      if (rows[0].status === "terminated") {
        throw unprocessable("Cannot report to a terminated agent");
      }
    } else {
      const rows = await db
        .select({ principalId: companyMemberships.principalId })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, parentId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .limit(1);
      if (!rows[0]) {
        throw unprocessable(
          "Parent user not found or not active in this company",
        );
      }
    }
  }

  /**
   * Nullify parent fields on all children of the given entity.
   * Used when terminating/removing an agent or removing a user from a company.
   *
   * - Clears parentType, parentId on child agents
   * - Clears reportsTo on child agents only when entityType is "agent"
   *   (reportsTo is agent-to-agent only; user parents don't affect it)
   * - Clears parentType, parentId on child users (via company_memberships)
   */
  async function orphanChildren(
    entityId: string,
    entityType: EntityType,
    txOrDb: Db = db,
  ): Promise<void> {
    // Orphan child agents — only clear reportsTo for agent parents
    const agentSetClause = entityType === "agent"
      ? { parentType: null, parentId: null, reportsTo: null, updatedAt: new Date() }
      : { parentType: null, parentId: null, updatedAt: new Date() };
    await txOrDb
      .update(agents)
      .set(agentSetClause)
      .where(and(eq(agents.parentType, entityType), eq(agents.parentId, entityId)));

    // Orphan child users (company_memberships)
    await txOrDb
      .update(companyMemberships)
      .set({ parentType: null, parentId: null, updatedAt: new Date() })
      .where(
        and(
          eq(companyMemberships.parentType, entityType),
          eq(companyMemberships.parentId, entityId),
        ),
      );
  }

  return { assertNoCycle, ensureParent, orphanChildren };
}
