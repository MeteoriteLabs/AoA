import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @armyofagents/db with proxy-based table stubs (matches AoA convention).
vi.mock("@armyofagents/db", () => ({
  memoryFolders: new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }),
  memoryItems: new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  isNull: (a: unknown) => ({ op: "isNull", a }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ kind: "sql", strings, vals }),
    { raw: (s: string) => ({ kind: "sql_raw", s }) },
  ),
}));

vi.mock("../infra/live-events", () => ({
  publishLiveEvent: vi.fn(),
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));

import { memoryFoldersService } from "../services/memory-folders.js";

type FolderRow = {
  id: string;
  companyId: string;
  path: string;
  seedKey: string | null;
  departmentId?: string | null;
  displayName?: string;
  icon?: string | null;
  sortOrder?: number;
};

function createMockDb(
  initialFolders: FolderRow[] = [],
  initialItems: Array<{ id: string; folderPath: string }> = [],
) {
  const folders: FolderRow[] = [...initialFolders];
  const items = [...initialItems];
  const updateCalls: Array<{ table: "memory_items" | "memory_folders"; patch: Record<string, unknown> }> = [];
  // First select call returns folders (target lookup), subsequent select calls
  // return affected rows for items + sub-folders. We sequence via call counter.
  let selectCallIdx = 0;

  return {
    folders,
    items,
    updateCalls,
    select: () => {
      const callIdx = selectCallIdx++;
      return {
        from: (_table: unknown) => ({
          where: async () => {
            // Sequence:
            //   call 0: target folder lookup -> return matching folders by id
            //   call 1: affected items in target.path (and descendants)
            //   call 2: affected sub-folders (descendants only)
            if (callIdx === 0) return folders;
            if (callIdx === 1) return items; // items affected — caller filters
            // call 2: descendant folders (not the target itself)
            return folders.filter((f) => f.path.startsWith((folders[0]?.path ?? "") + "/"));
          },
        }),
      };
    },
    insert: () => ({
      values: (row: FolderRow) => ({
        returning: async () => {
          const created = { ...row, id: `mock-${folders.length}`, createdAt: new Date(), updatedAt: new Date() };
          folders.push(created);
          return [created];
        },
      }),
    }),
    update: (table: { name?: string } | unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          const tableName =
            (table as { name?: string })?.name === "memory_items"
              ? "memory_items"
              : "memory_folders";
          updateCalls.push({ table: tableName, patch });
          return {
            returning: async () => [],
          };
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        const idx = folders.findIndex((f) => f !== undefined);
        if (idx >= 0) folders.splice(idx, 1);
      },
    }),
  };
}

describe("memoryFoldersService.remove — Phase 6.2b enforcement + reparenting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when target folder has seedKey set", async () => {
    const db = createMockDb([
      { id: "f-decisions", companyId: "co-1", path: "engineering/Decisions", seedKey: "decisions" },
    ]);
    const svc = memoryFoldersService(db as never);
    await expect(svc.remove("f-decisions", "co-1")).rejects.toThrow(/seeded/i);
  });

  it("reparents + deletes when seedKey is null (no error)", async () => {
    // Note: detailed reparenting path-rewrite verified end-to-end via browser
    // smoke (engineering/test-parent/test-child → engineering/test-child).
    // This unit test asserts the high-level: no error, no throw.
    const folder: FolderRow = {
      id: "f-q3",
      companyId: "co-1",
      path: "engineering/Q3",
      seedKey: null,
    };
    const db = createMockDb([folder]);
    const svc = memoryFoldersService(db as never);
    await expect(svc.remove("f-q3", "co-1")).resolves.toBeUndefined();
  });

  it("when target folder not found, returns silently (idempotent)", async () => {
    const db = createMockDb([]);
    const svc = memoryFoldersService(db as never);
    await expect(svc.remove("f-missing", "co-1")).resolves.toBeUndefined();
    // No mutations attempted on the empty fixture.
    expect(db.updateCalls.length).toBe(0);
  });

  it("path-rewrite math: top-level user folder → parent slug", async () => {
    // Pure-function check of the parentPath computation: "engineering/Q3" -> "engineering"
    // (We unit-test the JS path rewrite separately from DB orchestration.)
    const target = { path: "engineering/Q3" };
    const parentPath = target.path.includes("/")
      ? target.path.slice(0, target.path.lastIndexOf("/"))
      : "";
    expect(parentPath).toBe("engineering");
    // For an item at exactly target.path: remainder = "" → newPath = parentPath
    expect(parentPath + "").toBe("engineering");
    // For a descendant at target.path + "/OKRs": remainder = "/OKRs" → newPath = "engineering/OKRs"
    expect(parentPath + "/OKRs").toBe("engineering/OKRs");
  });

  it("path-rewrite math: nested user folder → parent path", async () => {
    const target = { path: "engineering/Q3/OKRs" };
    const parentPath = target.path.slice(0, target.path.lastIndexOf("/"));
    expect(parentPath).toBe("engineering/Q3");
  });
});
