import { describe, it, expect, vi } from "vitest";

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  and: (..._a: unknown[]) => "and",
  eq: (..._a: unknown[]) => "eq",
  or: (..._a: unknown[]) => "or",
  lt: (..._a: unknown[]) => "lt",
  isNull: (..._a: unknown[]) => "isNull",
  lte: (..._a: unknown[]) => "lte",
  inArray: (..._a: unknown[]) => "inArray",
  sql: new Proxy(() => "sql", { get: () => () => "sql", apply: () => "sql" }),
}));

// Mock @armyofagents/db
vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) => {
    const cols: Record<string, symbol> = {};
    return new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") {
          if (!cols[prop]) cols[prop] = Symbol(prop);
          return cols[prop];
        }
        return undefined;
      },
    });
  };
  return {
    fileImportJobs: makeTable("file_import_jobs"),
    memoryItems: makeTable("memory_items"),
    projects: makeTable("projects"),
    companies: makeTable("companies"),
  };
});

// Mock live-events
vi.mock("../services/live-events.js", () => ({ publishLiveEvent: vi.fn() }));

// Mock activity-log
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));

// ── extractFromRawText ──────────────────────────────────────────────────────

describe("extractionService.extractFromRawText", () => {
  it("is exported from extractionService", async () => {
    const { extractionService } = await import("../services/extraction.js");
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) };
    const svc = extractionService(db as any);
    expect(typeof svc.extractFromRawText).toBe("function");
  });

  it("returns empty array for blank text", async () => {
    const { extractionService } = await import("../services/extraction.js");
    const db = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) };
    const svc = extractionService(db as any);
    const result = await svc.extractFromRawText("co-1", "   ");
    expect(result).toEqual([]);
  });
});

// ── extractTextFromBuffer ───────────────────────────────────────────────────

describe("extractTextFromBuffer", () => {
  it("extracts plain text from TXT buffer", async () => {
    const { extractTextFromBuffer } = await import("../services/file-import.js");
    const buffer = Buffer.from("Hello world\n\nSecond paragraph.");
    const result = await extractTextFromBuffer(buffer, "text/plain");
    expect(result.text).toBe("Hello world\n\nSecond paragraph.");
    expect(result.warnings).toEqual([]);
  });

  it("throws for unsupported MIME type", async () => {
    const { extractTextFromBuffer } = await import("../services/file-import.js");
    const buffer = Buffer.from("data");
    await expect(
      extractTextFromBuffer(buffer, "image/jpeg")
    ).rejects.toThrow("Unsupported MIME type");
  });
});
