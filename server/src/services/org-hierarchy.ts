import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companyMemberships } from "@paperclipai/db";
import { notFound, unprocessable } from "../errors.js";

export function orgHierarchyService(db: Db) {
  async function assertNoCycle(
    companyId: string,
    entityId: string,
    entityType: "agent" | "user",
    newParentId: string | null,
    newParentType: "agent" | "user" | null,
  ): Promise<void> {
    if (!newParentId || !newParentType) return;
    if (entityId === newParentId && entityType === newParentType) {
      throw unprocessable("Cannot set an entity as its own parent");
    }

    let currentId: string | null = newParentId;
    let currentType: string | null = newParentType;
    let depth = 0;

    while (currentId && currentType && depth < 50) {
      if (currentId === entityId && currentType === entityType) {
        throw unprocessable("Reporting relationship would create a circular chain");
      }

      if (currentType === "agent") {
        const [row] = await db
          .select({ parentType: agents.parentType, parentId: agents.parentId })
          .from(agents)
          .where(eq(agents.id, currentId))
          .limit(1);
        if (!row?.parentId) break;
        currentId = row.parentId;
        currentType = row.parentType;
      } else {
        const [row] = await db
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
        if (!row?.parentId) break;
        currentId = row.parentId;
        currentType = row.parentType;
      }
      depth++;
    }
  }

  async function ensureParent(
    companyId: string,
    parentType: "agent" | "user",
    parentId: string,
  ): Promise<void> {
    if (parentType === "agent") {
      const [row] = await db
        .select({ id: agents.id, status: agents.status })
        .from(agents)
        .where(and(eq(agents.id, parentId), eq(agents.companyId, companyId)))
        .limit(1);
      if (!row) throw notFound("Parent agent not found in this company");
      if (row.status === "terminated") throw unprocessable("Cannot report to a terminated agent");
    } else {
      const [row] = await db
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
      if (!row) throw notFound("Parent user not found or not active in this company");
    }
  }

  async function orphanChildren(
    entityId: string,
    entityType: "agent" | "user",
    txOrDb: Db = db,
  ): Promise<void> {
    await txOrDb
      .update(agents)
      .set({ parentType: null, parentId: null, reportsTo: null })
      .where(and(eq(agents.parentType, entityType), eq(agents.parentId, entityId)));

    await txOrDb
      .update(companyMemberships)
      .set({ parentType: null, parentId: null })
      .where(
        and(
          eq(companyMemberships.parentType, entityType),
          eq(companyMemberships.parentId, entityId),
        ),
      );
  }

  return { assertNoCycle, ensureParent, orphanChildren };
}
