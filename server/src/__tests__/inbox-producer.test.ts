// server/src/__tests__/inbox-producer.test.ts
//
// Task 0.5 (Inbound Dirty-Data Routing) — unit tests for inbox-producer.ts.
//
// Three cases:
//   (a) happy path — inserts with the right column set (status, routingStatus,
//       dedupKey, originMedium, originSource, rawContent) → deduped:false
//   (b) dedup path — unique violation on `thread_inbox_items_company_dedup_idx`
//       → SELECT existing row → deduped:true, correct id, no duplicate insert
//   (c) dedupKey stability — same inputs always produce the same SHA-256 hex
//
// Mock-DB style mirrors scope-proposal-writer.test.ts / inbox-attach.test.ts:
//   - plain vi.fn() chains for insert/select
//   - no drizzle internals imported; only the service + computeDedupKey are under test

import { describe, expect, it, vi } from "vitest";
import { enqueueInboxItem, computeDedupKey } from "../services/inbox-producer.js";
import crypto from "crypto";

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMPANY = "co-test-1234";

function makeUniqueViolationError(constraint: string): Error {
  const err: any = new Error(`duplicate key value violates unique constraint "${constraint}"`);
  err.code = "23505";
  err.constraint = constraint;
  return err;
}

const DEDUP_INDEX = "thread_inbox_items_company_dedup_idx";

/**
 * Build a mock db for enqueueInboxItem.
 *
 * The insert chain either:
 *   - resolves with [{ id: insertedId }]  (happy path)
 *   - throws insertError                   (dedup / other violation path)
 *
 * The select chain (fallback after dedup) returns [{ id: existingId }].
 */
function makeDb(opts: {
  insertedId?: string;
  insertError?: Error;
  existingId?: string;
}) {
  const {
    insertedId = "inbox-item-new-1",
    insertError,
    existingId = "inbox-item-existing-1",
  } = opts;

  // Track the insert values payload so tests can assert the column set.
  let capturedInsertValues: any = undefined;

  // insert chain: .insert(table).values(v).returning(cols)
  const insert = vi.fn().mockImplementation((_table: any) => ({
    values: vi.fn().mockImplementation((vals: any) => {
      capturedInsertValues = vals;
      return {
        returning: vi.fn().mockImplementation((_cols?: any) => {
          if (insertError) return Promise.reject(insertError);
          return Promise.resolve([{ id: insertedId }]);
        }),
      };
    }),
  }));

  // select chain: .select(cols).from(table).where(pred) → [{ id: existingId }]
  const select = vi.fn().mockImplementation((_cols?: any) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ id: existingId }]),
  }));

  const db: any = { insert, select };

  return { db, getInsertValues: () => capturedInsertValues, insert, select };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("enqueueInboxItem", () => {
  // (a) happy path
  describe("happy path", () => {
    it("returns deduped:false with the new row id", async () => {
      const { db } = makeDb({ insertedId: "inbox-abc-123" });

      const result = await enqueueInboxItem(db, {
        companyId: COMPANY,
        originMedium: "mcp",
        originSource: "external-bot",
        rawContent: "Hello world",
      });

      expect(result.deduped).toBe(false);
      expect(result.inboxItemId).toBe("inbox-abc-123");
    });

    it("inserts with status='pending' and routingStatus='pending_route'", async () => {
      const { db, getInsertValues } = makeDb({});

      await enqueueInboxItem(db, {
        companyId: COMPANY,
        originMedium: "mcp",
        originSource: "src",
        rawContent: "content",
      });

      const vals = getInsertValues();
      expect(vals.status).toBe("pending");
      expect(vals.routingStatus).toBe("pending_route");
    });

    it("inserts the companyId, originMedium, originSource, rawContent", async () => {
      const { db, getInsertValues } = makeDb({});

      await enqueueInboxItem(db, {
        companyId: COMPANY,
        originMedium: "paste",
        originSource: "founder-paste",
        rawContent: "raw content here",
      });

      const vals = getInsertValues();
      expect(vals.companyId).toBe(COMPANY);
      expect(vals.originMedium).toBe("paste");
      expect(vals.originSource).toBe("founder-paste");
      expect(vals.rawContent).toBe("raw content here");
    });

    it("inserts a dedupKey that matches computeDedupKey output", async () => {
      const { db, getInsertValues } = makeDb({});
      const medium = "mcp";
      const source = "bot-42";
      const content = "the message";

      await enqueueInboxItem(db, {
        companyId: COMPANY,
        originMedium: medium,
        originSource: source,
        rawContent: content,
      });

      const expected = computeDedupKey(COMPANY, medium, source, content);
      expect(getInsertValues().dedupKey).toBe(expected);
    });

    it("coerces null originSource to null in the insert (not undefined)", async () => {
      const { db, getInsertValues } = makeDb({});

      await enqueueInboxItem(db, {
        companyId: COMPANY,
        originMedium: "mcp",
        originSource: null,
        rawContent: "content",
      });

      expect(getInsertValues().originSource).toBeNull();
    });

    it("includes createdBy when provided", async () => {
      const { db, getInsertValues } = makeDb({});

      await enqueueInboxItem(db, {
        companyId: COMPANY,
        originMedium: "mcp",
        rawContent: "x",
        createdBy: "user-77",
      });

      expect(getInsertValues().createdBy).toBe("user-77");
    });

    it("does NOT set createdBy in values when not provided", async () => {
      const { db, getInsertValues } = makeDb({});

      await enqueueInboxItem(db, {
        companyId: COMPANY,
        originMedium: "mcp",
        rawContent: "x",
        // createdBy omitted
      });

      // Key must not be present (spreading `{}` from the conditional keeps it absent)
      expect(Object.prototype.hasOwnProperty.call(getInsertValues(), "createdBy")).toBe(false);
    });
  });

  // (b) dedup path
  describe("durable dedup (Codex #8)", () => {
    it("returns deduped:true with the existing row id when the dedup index fires", async () => {
      const dedupErr = makeUniqueViolationError(DEDUP_INDEX);
      const { db } = makeDb({ insertError: dedupErr, existingId: "inbox-existing-42" });

      const result = await enqueueInboxItem(db, {
        companyId: COMPANY,
        originMedium: "mcp",
        originSource: "bot",
        rawContent: "hello",
      });

      expect(result.deduped).toBe(true);
      expect(result.inboxItemId).toBe("inbox-existing-42");
    });

    it("does not propagate the unique violation (no throw on dedup)", async () => {
      const dedupErr = makeUniqueViolationError(DEDUP_INDEX);
      const { db } = makeDb({ insertError: dedupErr });

      await expect(
        enqueueInboxItem(db, {
          companyId: COMPANY,
          originMedium: "mcp",
          rawContent: "dupe",
        }),
      ).resolves.not.toThrow();
    });

    it("only one insert attempt is made (no retry after dedup)", async () => {
      const dedupErr = makeUniqueViolationError(DEDUP_INDEX);
      const { db, insert } = makeDb({ insertError: dedupErr });

      await enqueueInboxItem(db, {
        companyId: COMPANY,
        originMedium: "mcp",
        rawContent: "dupe",
      });

      expect(insert).toHaveBeenCalledOnce();
    });

    it("SELECTs the existing row after the dedup violation", async () => {
      const dedupErr = makeUniqueViolationError(DEDUP_INDEX);
      const { db, select } = makeDb({ insertError: dedupErr, existingId: "exists-99" });

      const result = await enqueueInboxItem(db, {
        companyId: COMPANY,
        originMedium: "mcp",
        rawContent: "dupe",
      });

      expect(select).toHaveBeenCalledOnce();
      expect(result.inboxItemId).toBe("exists-99");
    });

    it("re-throws a 23505 from a DIFFERENT index (does not swallow unrelated violations)", async () => {
      const otherErr = makeUniqueViolationError("some_other_unique_idx");
      const { db } = makeDb({ insertError: otherErr });

      await expect(
        enqueueInboxItem(db, {
          companyId: COMPANY,
          originMedium: "mcp",
          rawContent: "unrelated violation",
        }),
      ).rejects.toThrow();
    });

    it("re-throws a non-23505 error (e.g. network failure)", async () => {
      const networkErr = new Error("connection refused");
      const { db } = makeDb({ insertError: networkErr });

      await expect(
        enqueueInboxItem(db, {
          companyId: COMPANY,
          originMedium: "mcp",
          rawContent: "content",
        }),
      ).rejects.toThrow("connection refused");
    });
  });
});

// ── dedupKey stability ─────────────────────────────────────────────────────────

describe("computeDedupKey", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const key = computeDedupKey("co-1", "mcp", "src", "content");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same key for the same inputs (stable)", () => {
    const a = computeDedupKey("co-1", "mcp", "src", "hello");
    const b = computeDedupKey("co-1", "mcp", "src", "hello");
    expect(a).toBe(b);
  });

  it("matches the expected SHA-256 of the NUL-delimited payload", () => {
    const companyId = "co-abc";
    const medium = "paste";
    const source = "founder";
    const content = "raw content";
    const payload = [companyId, medium, source, content].join("\0");
    const expected = crypto.createHash("sha256").update(payload).digest("hex");
    expect(computeDedupKey(companyId, medium, source, content)).toBe(expected);
  });

  it("treats null and undefined originSource as empty string (same key)", () => {
    const keyNull = computeDedupKey("co-1", "mcp", null, "data");
    const keyUndef = computeDedupKey("co-1", "mcp", undefined, "data");
    expect(keyNull).toBe(keyUndef);
  });

  it("different companyId → different key", () => {
    const k1 = computeDedupKey("co-1", "mcp", "src", "data");
    const k2 = computeDedupKey("co-2", "mcp", "src", "data");
    expect(k1).not.toBe(k2);
  });

  it("different originMedium → different key", () => {
    const k1 = computeDedupKey("co-1", "mcp", "src", "data");
    const k2 = computeDedupKey("co-1", "paste", "src", "data");
    expect(k1).not.toBe(k2);
  });

  it("different originSource → different key", () => {
    const k1 = computeDedupKey("co-1", "mcp", "bot-1", "data");
    const k2 = computeDedupKey("co-1", "mcp", "bot-2", "data");
    expect(k1).not.toBe(k2);
  });

  it("different rawContent → different key", () => {
    const k1 = computeDedupKey("co-1", "mcp", "src", "hello");
    const k2 = computeDedupKey("co-1", "mcp", "src", "world");
    expect(k1).not.toBe(k2);
  });

  it("is not susceptible to field-boundary collisions (NUL delimiter)", () => {
    // Without NUL delimiter, "co-1" + "mcp" + "src" could equal "co-1m" + "cp" + "src"
    // With NUL: "co-1\0mcp\0src" vs "co-1m\0cp\0src" → different strings → different keys
    const k1 = computeDedupKey("co-1", "mcp", "src", "data");
    const k2 = computeDedupKey("co-1m", "cp", "src", "data");
    expect(k1).not.toBe(k2);
  });
});
