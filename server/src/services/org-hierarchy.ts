import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companyMemberships } from "@paperclipai/db";
import { conflict, notFound } from "../errors.js";

const MAX_CHAIN_DEPTH = 50;

type ParentType = "agent" | "user";
type EntityType = "agent" | "user";

export function orgHierarchyService(db: Db) {
  async function ensureParent(
    companyId: string,
    parentType: ParentType,
    parentId: string,
  ): Promise<void> {
    if (parentType === "agent") {
      const rows = await db
        .select({ id: agents.id, status: agents.status })
        .from(agents)
        .where(and(eq(agents.id, parentId), eq(agents.companyId, companyId)))
        .limit(1);
      if (!rows[0]) throw notFound("Parent agent not found in this company");
      if (rows[0].status === "terminated") throw conflict("Cannot report to a terminated agent");
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
      if (!rows[0]) throw notFound("Parent user not found or not active in this company");
    }
  }

  async function assertNoCycle(
    companyId: string,
    entityId: string,
    entityType: EntityType,
    newParentId: string | null,
    newParentType: ParentType | null,
  ): Promise<void> {
    if (!newParentId || !newParentType) return;
    if (entityId === newParentId && entityType === newParentType) {
      throw conflict("Cannot set an entity as its own parent");
    }

    let currentId: string | null = newParentId;
    let currentType: string | null = newParentType;
    let depth = 0;

    while (currentId && currentType && depth < MAX_CHAIN_DEPTH) {
      if (currentId === entityId && currentType === entityType) {
        throw conflict(
          `Cannot set parent: would create a circular reporting chain (depth ${depth})`,
        );
      }

      if (currentType === "agent") {
        const rows = await db
          .select({ parentType: agents.parentType, parentId: agents.parentId })
          .from(agents)
          .where(eq(agents.id, currentId))
          .limit(1);
        if (!rows[0] || !rows[0].parentId) break;
        currentId = rows[0].parentId;
        currentType = rows[0].parentType;
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
        if (!rows[0] || !rows[0].parentId) break;
        currentId = rows[0].parentId;
        currentType = rows[0].parentType;
      }
      depth++;
    }
  }

  async function orphanChildren(
    entityId: string,
    entityType: EntityType,
    txOrDb: Db = db,
  ): Promise<void> {
    // Orphan child agents pointing to this entity
    await txOrDb
      .update(agents)
      .set({ parentType: null, parentId: null, reportsTo: null })
      .where(and(eq(agents.parentType, entityType), eq(agents.parentId, entityId)));

    // Orphan child users pointing to this entity
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

  return {
    ensureParent,
    assertNoCycle,
    orphanChildren,
  };
}
