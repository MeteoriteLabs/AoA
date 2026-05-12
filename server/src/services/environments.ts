import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { environments } from "@armyofagents/db";
import type { CreateEnvironmentInput, UpdateEnvironmentInput } from "@armyofagents/shared";

export function environmentsService(db: Db) {
  return {
    list: async (companyId: string) => {
      return db.select().from(environments).where(eq(environments.companyId, companyId));
    },

    get: async (companyId: string, id: string) => {
      const rows = await db
        .select()
        .from(environments)
        .where(and(eq(environments.id, id), eq(environments.companyId, companyId)));
      return rows[0] ?? null;
    },

    create: async (companyId: string, input: CreateEnvironmentInput) => {
      const [env] = await db
        .insert(environments)
        .values({ companyId, ...input })
        .returning();
      return env;
    },

    update: async (companyId: string, id: string, input: UpdateEnvironmentInput) => {
      const rows = await db
        .update(environments)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(environments.id, id), eq(environments.companyId, companyId)))
        .returning();
      return rows[0] ?? null;
    },

    delete: async (companyId: string, id: string) => {
      await db
        .delete(environments)
        .where(and(eq(environments.id, id), eq(environments.companyId, companyId)));
    },
  };
}
