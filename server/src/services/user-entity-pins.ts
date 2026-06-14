import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { userEntityPins, issues, artifacts, goals } from "@armyofagents/db";

export type UserEntityPinRow = {
  id: string;
  userId: string;
  companyId: string;
  entityType: string;
  entityId: string;
  pinnedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export function userEntityPinService(db: Db) {
  return {
    async list(userId: string, companyId: string): Promise<UserEntityPinRow[]> {
      const rows = await db
        .select()
        .from(userEntityPins)
        .where(
          and(
            eq(userEntityPins.userId, userId),
            eq(userEntityPins.companyId, companyId),
          ),
        )
        .orderBy(desc(userEntityPins.pinnedAt));
      return rows as UserEntityPinRow[];
    },

    async pin(
      userId: string,
      companyId: string,
      entityType: string,
      entityId: string,
    ): Promise<UserEntityPinRow> {
      const [row] = await db
        .insert(userEntityPins)
        .values({ userId, companyId, entityType, entityId })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        // Row already exists — fetch and return it.
        const [existing] = await db
          .select()
          .from(userEntityPins)
          .where(
            and(
              eq(userEntityPins.userId, userId),
              eq(userEntityPins.companyId, companyId),
              eq(userEntityPins.entityType, entityType),
              eq(userEntityPins.entityId, entityId),
            ),
          );
        return existing as UserEntityPinRow;
      }
      return row as UserEntityPinRow;
    },

    async unpin(
      userId: string,
      companyId: string,
      entityType: string,
      entityId: string,
    ): Promise<void> {
      await db
        .delete(userEntityPins)
        .where(
          and(
            eq(userEntityPins.userId, userId),
            eq(userEntityPins.companyId, companyId),
            eq(userEntityPins.entityType, entityType),
            eq(userEntityPins.entityId, entityId),
          ),
        );
    },

    async entityExistsInCompany(
      companyId: string,
      entityType: string,
      entityId: string,
    ): Promise<boolean> {
      switch (entityType) {
        case "task": {
          const rows = await db
            .select({ id: issues.id })
            .from(issues)
            .where(and(eq(issues.id, entityId), eq(issues.companyId, companyId)));
          return rows.length > 0;
        }
        case "artifact": {
          const rows = await db
            .select({ id: artifacts.id })
            .from(artifacts)
            .where(and(eq(artifacts.id, entityId), eq(artifacts.companyId, companyId)));
          return rows.length > 0;
        }
        case "goal": {
          const rows = await db
            .select({ id: goals.id })
            .from(goals)
            .where(and(eq(goals.id, entityId), eq(goals.companyId, companyId)));
          return rows.length > 0;
        }
        default:
          return false;
      }
    },
  };
}
