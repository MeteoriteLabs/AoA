import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { memoryFolders } from "@armyofagents/db";
import { normalizeMemoryFolderPath } from "@armyofagents/shared";
import { getSeedFoldersForFunctionType } from "./memory-folder-seeds.js";
import { logger } from "../middleware/logger.js";

const log = logger.child({ service: "memory-folders" });

interface CreateInput {
  companyId: string;
  departmentId: string | null;
  path: string;
  displayName: string;
  icon?: string | null;
  seedKey?: string | null;
  sortOrder?: number;
}

interface UpdateInput {
  path?: string;
  displayName?: string;
  icon?: string | null;
  sortOrder?: number;
}

interface ListInput {
  companyId: string;
  departmentId?: string | null;
}

interface SeedInput {
  companyId: string;
  departmentId: string;
  departmentSlug: string;
  functionType: string | null;
}

export function memoryFoldersService(db: Db) {
  return {
    list: async ({ companyId, departmentId }: ListInput) => {
      const conditions = [eq(memoryFolders.companyId, companyId)];
      if (departmentId === null) {
        conditions.push(isNull(memoryFolders.departmentId));
      } else if (departmentId !== undefined) {
        conditions.push(eq(memoryFolders.departmentId, departmentId));
      }
      return db.select().from(memoryFolders).where(and(...conditions));
    },

    create: async (input: CreateInput) => {
      const path = normalizeMemoryFolderPath(input.path);
      const [row] = await db
        .insert(memoryFolders)
        .values({
          companyId: input.companyId,
          departmentId: input.departmentId,
          path,
          displayName: input.displayName,
          icon: input.icon ?? null,
          seedKey: input.seedKey ?? null,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning();
      return row;
    },

    update: async (id: string, companyId: string, patch: UpdateInput) => {
      const next: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.path !== undefined) next.path = normalizeMemoryFolderPath(patch.path);
      if (patch.displayName !== undefined) next.displayName = patch.displayName;
      if (patch.icon !== undefined) next.icon = patch.icon;
      if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;
      const [row] = await db
        .update(memoryFolders)
        .set(next)
        .where(and(eq(memoryFolders.id, id), eq(memoryFolders.companyId, companyId)))
        .returning();
      return row ?? null;
    },

    remove: async (id: string, companyId: string): Promise<void> => {
      await db
        .delete(memoryFolders)
        .where(and(eq(memoryFolders.id, id), eq(memoryFolders.companyId, companyId)));
    },

    seedForDepartment: async (input: SeedInput) => {
      const seeds = getSeedFoldersForFunctionType(input.functionType);
      // Idempotent: skip seeds that already exist (matched by seedKey + dept).
      const existing = await db
        .select()
        .from(memoryFolders)
        .where(
          and(
            eq(memoryFolders.companyId, input.companyId),
            eq(memoryFolders.departmentId, input.departmentId),
          ),
        );
      const existingKeys = new Set(
        existing.map((row: { seedKey: string | null }) => row.seedKey).filter(Boolean),
      );
      const toCreate = seeds.filter((s) => !existingKeys.has(s.seedKey));
      if (toCreate.length === 0) return [];
      const created = [];
      for (const seed of toCreate) {
        const [row] = await db
          .insert(memoryFolders)
          .values({
            companyId: input.companyId,
            departmentId: input.departmentId,
            path: `${input.departmentSlug}/${seed.path}`,
            displayName: seed.displayName,
            icon: seed.icon ?? null,
            seedKey: seed.seedKey,
            sortOrder: 0,
          })
          .returning();
        created.push(row);
      }
      log.info({ companyId: input.companyId, departmentId: input.departmentId, count: created.length }, "seeded folders");
      return created;
    },
  };
}

export type MemoryFoldersService = ReturnType<typeof memoryFoldersService>;
