import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @armyofagents/db with proxy-based table stubs (matches AoA convention).
vi.mock("@armyofagents/db", () => ({
  memoryFolders: new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  isNull: (a: unknown) => ({ op: "isNull", a }),
}));

import { memoryFoldersService } from "../services/memory-folders.js";

function createMockDb() {
  const folders: Array<Record<string, unknown>> = [];
  return {
    folders,
    select: () => ({
      from: () => ({
        where: async () => folders,
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          const created = { ...row, id: `mock-${folders.length}`, createdAt: new Date(), updatedAt: new Date() };
          folders.push(created);
          return [created];
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (folders.length === 0) return [];
            folders[0] = { ...folders[0], ...patch };
            return [folders[0]];
          },
        }),
      }),
    }),
    delete: () => ({
      where: async () => {
        folders.splice(0);
      },
    }),
  };
}

describe("memoryFoldersService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a folder with companyId and normalized path", async () => {
    const db = createMockDb();
    const svc = memoryFoldersService(db as never);
    const created = await svc.create({
      companyId: "co-1",
      departmentId: "dept-1",
      path: "  Engineering/Decisions  ",
      displayName: "Decisions",
    });
    expect(created.path).toBe("Engineering/Decisions");
    expect(created.companyId).toBe("co-1");
  });

  it("lists folders scoped to companyId", async () => {
    const db = createMockDb();
    db.folders.push({ id: "f-1", companyId: "co-1", path: "Engineering/Decisions" });
    const svc = memoryFoldersService(db as never);
    const list = await svc.list({ companyId: "co-1" });
    expect(list).toHaveLength(1);
  });

  it("update normalizes path", async () => {
    const db = createMockDb();
    db.folders.push({ id: "f-1", companyId: "co-1", path: "Engineering" });
    const svc = memoryFoldersService(db as never);
    const updated = await svc.update("f-1", "co-1", { path: "  Engineering/Subfolder  " });
    expect(updated?.path).toBe("Engineering/Subfolder");
  });

  it("seedForDepartment inserts one row per FolderSeed scoped to dept", async () => {
    const db = createMockDb();
    const svc = memoryFoldersService(db as never);
    await svc.seedForDepartment({
      companyId: "co-1",
      departmentId: "dept-1",
      departmentSlug: "engineering",
      functionType: "software_development",
    });
    expect(db.folders).toHaveLength(5);
    expect(db.folders[0].path).toBe("engineering/Decisions");
    expect(db.folders[0].seedKey).toBe("software_development.decisions");
  });

  it("seedForDepartment is idempotent — second call inserts nothing", async () => {
    const db = createMockDb();
    const svc = memoryFoldersService(db as never);
    await svc.seedForDepartment({
      companyId: "co-1",
      departmentId: "dept-1",
      departmentSlug: "engineering",
      functionType: "software_development",
    });
    const before = db.folders.length;
    await svc.seedForDepartment({
      companyId: "co-1",
      departmentId: "dept-1",
      departmentSlug: "engineering",
      functionType: "software_development",
    });
    expect(db.folders.length).toBe(before);
  });
});
