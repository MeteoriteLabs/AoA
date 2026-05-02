import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@armyofagents/db", () => ({
  memoryFolders: new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }),
  memoryAssets: new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }),
  memoryItems: new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  isNull: (a: unknown) => ({ op: "isNull", a }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ op: "sql", strings, values }),
}));

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }));
vi.mock("../services/live-events.js", () => ({ publishLiveEvent: publishMock }));

import { memoryFoldersService } from "../services/memory-folders.js";
import { memoryAssetsService } from "../services/memory-assets.js";

function tinyDb() {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    select: () => ({ from: () => ({ where: async () => rows }) }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          const created = { ...row, id: `r-${rows.length}`, createdAt: new Date(), updatedAt: new Date() };
          rows.push(created);
          return [created];
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (rows.length === 0) return [];
            rows[0] = { ...rows[0], ...patch };
            return [rows[0]];
          },
        }),
      }),
    }),
    delete: () => ({ where: async () => { rows.splice(0); } }),
  };
}

describe("LiveEvents publishes from memory services", () => {
  beforeEach(() => publishMock.mockClear());

  it("memoryFoldersService.create publishes memory.folder.created", async () => {
    const db = tinyDb();
    const svc = memoryFoldersService(db as never);
    await svc.create({
      companyId: "co-1",
      departmentId: null,
      path: "Engineering",
      displayName: "Engineering",
    });
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "memory.folder.created",
        companyId: "co-1",
      }),
    );
  });

  it("memoryAssetsService.create publishes memory.asset.created", async () => {
    const db = tinyDb();
    const svc = memoryAssetsService(db as never);
    await svc.create({
      companyId: "co-1",
      departmentId: null,
      folderPath: "Files",
      fileName: "x.pdf",
      mimeType: "application/pdf",
      fileSize: 1,
      storageKey: "k",
    });
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "memory.asset.created",
        companyId: "co-1",
      }),
    );
  });

  it("memoryFoldersService.remove publishes memory.folder.deleted", async () => {
    const db = tinyDb();
    db.rows.push({ id: "f-1", companyId: "co-1" });
    const svc = memoryFoldersService(db as never);
    await svc.remove("f-1", "co-1");
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "memory.folder.deleted",
        companyId: "co-1",
      }),
    );
  });
});
