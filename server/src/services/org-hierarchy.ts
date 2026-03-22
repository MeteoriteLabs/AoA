import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companyMemberships } from "@paperclipai/db";

export function orgHierarchyService(db: Db) {
  async function orphanChildren(
    entityId: string,
    entityType: "agent" | "user",
    txOrDb: Db = db,
  ): Promise<void> {
    const agentSetClause = entityType === "agent"
      ? { parentType: null, parentId: null, reportsTo: null, updatedAt: new Date() }
      : { parentType: null, parentId: null, updatedAt: new Date() };
    await txOrDb
      .update(agents)
      .set(agentSetClause)
      .where(and(eq(agents.parentType, entityType), eq(agents.parentId, entityId)));

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

  return { orphanChildren };
}
