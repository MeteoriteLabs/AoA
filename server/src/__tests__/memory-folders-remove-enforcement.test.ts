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

function createMockDb(initialFolders: FolderRow[] = []) {
  const folders: FolderRow[] = [...initialFolders];
  const executeMock = vi.fn().mockResolvedValue(undefined);

  return {
    folders,
    execute: executeMock,
    select: () => ({
      from: () => ({
        where: async () => folders,
      }),
    }),
    insert: () => ({
      values: (row: FolderRow) => ({
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
        // Remove deleted folder from array
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

  it("reparents items + sub-folders + deletes folder when seedKey is null", async () => {
    const folder: FolderRow = {
      id: "f-q3",
      companyId: "co-1",
      path: "engineering/Q3",
      seedKey: null,
    };
    const db = createMockDb([folder]);
    const svc = memoryFoldersService(db as never);
    await expect(svc.remove("f-q3", "co-1")).resolves.toBeUndefined();
    // db.execute should have been called twice: once for items, once for sub-folders
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it("when target folder not found, returns silently (idempotent)", async () => {
    // Empty db — no folders exist
    const db = createMockDb([]);
    const svc = memoryFoldersService(db as never);
    await expect(svc.remove("f-missing", "co-1")).resolves.toBeUndefined();
    // db.execute should NOT have been called (early return before SQL)
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("computes parent path correctly for top-level user folder", async () => {
    // engineering/Q3 -> parent "engineering"
    const folder: FolderRow = { id: "f-x", companyId: "co-1", path: "engineering/Q3", seedKey: null };
    const db = createMockDb([folder]);
    const svc = memoryFoldersService(db as never);
    await expect(svc.remove("f-x", "co-1")).resolves.toBeUndefined();
    // Verify execute was called with sql fragments containing the parent path
    expect(db.execute).toHaveBeenCalledTimes(2);
    // The first call's SQL fragment vals should contain the parent path "engineering"
    const firstCall = db.execute.mock.calls[0][0];
    expect(JSON.stringify(firstCall)).toContain("engineering");
  });

  it("computes parent path correctly for nested user folder", async () => {
    // engineering/Q3/OKRs -> parent "engineering/Q3"
    const folder: FolderRow = { id: "f-okrs", companyId: "co-1", path: "engineering/Q3/OKRs", seedKey: null };
    const db = createMockDb([folder]);
    const svc = memoryFoldersService(db as never);
    await expect(svc.remove("f-okrs", "co-1")).resolves.toBeUndefined();
    expect(db.execute).toHaveBeenCalledTimes(2);
    // The SQL fragment vals should contain "engineering/Q3" as the parent path
    const firstCall = db.execute.mock.calls[0][0];
    expect(JSON.stringify(firstCall)).toContain("engineering/Q3");
  });
});
