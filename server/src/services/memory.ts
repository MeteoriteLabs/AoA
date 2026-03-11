import { and, eq, ilike, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { memoryItems } from "@paperclipai/db";

export interface MemoryFilters {
  category?: string;
  status?: string;
  source?: string;
  departmentId?: string;
  projectId?: string;
  tags?: string[];
  search?: string;
}

export function memoryService(db: Db) {
  return {
    list: (companyId: string, filters: MemoryFilters = {}) => {
      const conditions = [eq(memoryItems.companyId, companyId)];

      if (filters.category) {
        conditions.push(eq(memoryItems.category, filters.category));
      }
      if (filters.status) {
        conditions.push(eq(memoryItems.status, filters.status));
      }
      if (filters.source) {
        conditions.push(eq(memoryItems.source, filters.source));
      }
      if (filters.departmentId) {
        conditions.push(eq(memoryItems.departmentId, filters.departmentId));
      }
      if (filters.projectId) {
        conditions.push(eq(memoryItems.projectId, filters.projectId));
      }
      if (filters.search) {
        conditions.push(
          ilike(memoryItems.title, `%${filters.search}%`),
        );
      }
      if (filters.tags && filters.tags.length > 0) {
        // Check if any of the requested tags exist in the JSONB tags array
        for (const tag of filters.tags) {
          conditions.push(sql`${memoryItems.tags} @> ${JSON.stringify([tag])}::jsonb`);
        }
      }

      return db.select().from(memoryItems).where(and(...conditions));
    },

    getById: (companyId: string, id: string) =>
      db
        .select()
        .from(memoryItems)
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .then((rows) => rows[0] ?? null),

    create: (companyId: string, data: Omit<typeof memoryItems.$inferInsert, "companyId">) => {
      // Critical rule #6: Founder-created items are auto-approved; all others default to pending
      const status = data.source === "founder" ? "approved" : "pending";
      return db
        .insert(memoryItems)
        .values({ ...data, companyId, status })
        .returning()
        .then((rows) => rows[0]);
    },

    update: (companyId: string, id: string, data: Partial<typeof memoryItems.$inferInsert>) =>
      db
        .update(memoryItems)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null),

    remove: (companyId: string, id: string) =>
      db
        .delete(memoryItems)
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null),

    approve: (companyId: string, id: string) =>
      db
        .update(memoryItems)
        .set({ status: "approved", updatedAt: new Date() })
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null),

    reject: (companyId: string, id: string) =>
      db
        .update(memoryItems)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}
