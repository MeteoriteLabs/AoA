import { describe, it, expect, beforeEach } from "vitest";
import { memoryService } from "../services/memory.js";
import { memoryItems as itemsTableRef, memoryItemVersions as versionsTableRef } from "@paperclipai/db";
import type { Db } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
let items: any[];
let versions: any[];
let itemIdCounter = 0;
let versionIdCounter = 0;

function newItemId() { return `item-${++itemIdCounter}`; }
function newVersionId() { return `ver-${++versionIdCounter}`; }

// ---------------------------------------------------------------------------
// Drizzle AST evaluator
// ---------------------------------------------------------------------------
// Drizzle builds SQL AST nodes (all have constructor "SQL") containing queryChunks.
// The chunks follow these patterns:
//
//   eq(col, val)  → [StringChunk(""), PgColumn, StringChunk([" = "]), Param{value}, StringChunk("")]
//   and(a,b,c)    → [StringChunk("("), innerSQL{[a, StringChunk([" and "]), b, ...]}, StringChunk(")")]
//   desc(col)     → [StringChunk(""), PgColumn, StringChunk([" desc"])]
//   max(col)      → [StringChunk(["max("]), PgColumn, StringChunk([")"]])]
//
// StringChunk stores the string in .value which is an array like [' = '].
// PgColumn has .name and .columnType.
// Param has .value as the plain JS value.

function getStringChunkValue(chunk: any): string | null {
  if (!chunk || chunk.constructor?.name !== "StringChunk") return null;
  const arr = chunk.value;
  if (Array.isArray(arr) && arr.length > 0) return arr[0];
  return null;
}

function isColumn(chunk: any): boolean {
  return !!chunk?.columnType;
}

function isParam(chunk: any): boolean {
  return chunk?.constructor?.name === "Param";
}

function isSqlNode(chunk: any): boolean {
  return chunk?.constructor?.name === "SQL" && Array.isArray(chunk.queryChunks);
}

// Drizzle column .name is snake_case (e.g. "company_id") but our mock rows
// store camelCase keys (e.g. "companyId") because that's what JS code passes
// to .values(). This function maps snake_case → camelCase.
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// Get the row value for a Drizzle column reference
function rowVal(row: any, col: any): any {
  // Try camelCase first (what our mock stores), then snake_case
  const camel = snakeToCamel(col.name);
  if (camel in row) return row[camel];
  return row[col.name];
}

// Extract the plain JS value from a Drizzle Param or sql-template interpolated value.
// sql`` interpolations can be raw primitive strings (typeof "string") or Param objects.
function extractValue(chunk: any): any {
  if (chunk === null || chunk === undefined) return chunk;
  if (isParam(chunk)) return chunk.value;
  // Raw primitive from sql`` template
  if (typeof chunk === "string" || typeof chunk === "number" || typeof chunk === "boolean") return chunk;
  // String/Number object wrapper
  if (chunk.valueOf && typeof chunk.valueOf === "function") return chunk.valueOf();
  return chunk;
}

// Evaluate a Drizzle SQL condition node against a plain JS row object.
// Returns true if the row matches the condition.
function evalCondition(node: any, row: any): boolean {
  if (!node) return true;

  const chunks: any[] = node.queryChunks;
  if (!chunks) return true;

  // and/or wrapper: [StringChunk("("), innerSQL{[cond, " and ", cond, ...]}, StringChunk(")")]
  if (chunks.length === 3 && isSqlNode(chunks[1])) {
    const openStr = getStringChunkValue(chunks[0]);
    if (openStr === "(" || openStr === "") {
      return evalInnerAndOr(chunks[1].queryChunks, row);
    }
  }

  // eq/comparison: [StringChunk(""), Column, StringChunk(" = "), Param, StringChunk("")]
  if (chunks.length === 5) {
    const col = chunks[1];
    const opChunk = chunks[2];
    const valChunk = chunks[3];
    if (isColumn(col)) {
      // If the value chunk is a SQL node (e.g. sql.raw() in ANY(...)), we can't evaluate it — pass through
      if (isSqlNode(valChunk)) return true;
      const op = getStringChunkValue(opChunk)?.trim() ?? "=";
      const rv = rowVal(row, col);
      const condVal = extractValue(valChunk);
      if (op === "=") return rv == condVal;
      if (op === "!=" || op === "<>") return rv != condVal;
      if (op === "IS NOT DISTINCT FROM") return rv === condVal;
      return rv == condVal;
    }
    // sql template with != — same 5-chunk pattern but val chunk may be a string primitive
    if (isColumn(col)) {
      const opChunkStr = getStringChunkValue(opChunk)?.trim();
      if (opChunkStr === "!=") {
        const paramVal = extractValue(valChunk);
        return rowVal(row, col) != paramVal;
      }
    }
  }

  // sql`${col} != ${val}` — any length, find column and operator
  if (chunks.length >= 3) {
    const col = chunks.find((c: any) => isColumn(c));
    if (col) {
      const allStrs = chunks.map((c: any) => getStringChunkValue(c)).filter(Boolean).join("");
      if (allStrs.includes("!=")) {
        const opIdx = chunks.findIndex((c: any) => getStringChunkValue(c)?.includes("!="));
        if (opIdx !== -1 && opIdx + 1 < chunks.length) {
          const vc = chunks[opIdx + 1];
          return rowVal(row, col) != extractValue(vc);
        }
      }
    }
  }

  // sql`` ANY(...) and other complex patterns — pass through
  return true;
}

function evalInnerAndOr(innerChunks: any[], row: any): boolean {
  // innerChunks alternates: [condSQL, StringChunk(" and "), condSQL, ...]
  const conditions: any[] = [];
  let operator = "and";
  for (const c of innerChunks) {
    if (isSqlNode(c)) {
      conditions.push(c);
    } else {
      const str = getStringChunkValue(c)?.trim().toLowerCase() ?? "";
      if (str === "or") operator = "or";
    }
  }
  if (operator === "or") return conditions.some((c) => evalCondition(c, row));
  return conditions.every((c) => evalCondition(c, row));
}

// Evaluate a desc() node to get a sort comparator
function evalOrderBy(node: any): ((a: any, b: any) => number) | null {
  if (!node) return null;
  const chunks: any[] = node.queryChunks ?? [];
  // desc/asc: [StringChunk, Column, StringChunk]
  if (chunks.length === 3) {
    const col = chunks[1];
    const dirChunk = chunks[2];
    if (isColumn(col)) {
      const dir = getStringChunkValue(dirChunk)?.trim().toLowerCase() ?? "asc";
      const isDesc = dir === "desc";
      return (a, b) => {
        const av = rowVal(a, col);
        const bv = rowVal(b, col);
        if (av === bv) return 0;
        return isDesc ? (av > bv ? -1 : 1) : (av < bv ? -1 : 1);
      };
    }
  }
  return null;
}

// Extract column name from max() aggregate node
function getMaxColumnName(maxNode: any): string | null {
  const chunks: any[] = maxNode?.queryChunks ?? [];
  for (const c of chunks) {
    if (isColumn(c)) return c.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mock Db factory
// ---------------------------------------------------------------------------
function createMockDb(): Db {
  const db: any = {
    select(colsArg?: any) {
      // Detect aggregate select: { maxVer: max(col) }
      let _aggColName: string | null = null;
      // Detect projection: { id: col }
      let _projection: Record<string, string> | null = null;

      if (colsArg && typeof colsArg === "object") {
        const keys = Object.keys(colsArg);
        if (keys.includes("maxVer")) {
          _aggColName = getMaxColumnName(colsArg.maxVer);
        } else if (keys.length > 0) {
          const proj: Record<string, string> = {};
          for (const [k, v] of Object.entries(colsArg as Record<string, any>)) {
            if (isColumn(v)) proj[k] = v.name;
          }
          if (Object.keys(proj).length > 0) _projection = proj;
        }
      }

      return {
        from(table: any) {
          const isVersionsTable = table === versionsTableRef;
          const getArr = (): any[] => (isVersionsTable ? versions : items);
          let _conditions: any[] = [];
          let _orderByFn: ((a: any, b: any) => number) | null = null;
          let _limitVal: number | null = null;
          let _isJoined = false;

          const builder: any = {
            where(cond: any) {
              if (cond) _conditions.push(cond);
              return builder;
            },
            orderBy(...args: any[]) {
              const fn = evalOrderBy(args[0]);
              if (fn) _orderByFn = fn;
              return builder;
            },
            limit(n: number) {
              _limitVal = n;
              return builder;
            },
            innerJoin(_joinedTable: any, _cond: any) {
              _isJoined = true;
              return builder;
            },
            then(resolve: (rows: any[]) => any, reject?: (e: any) => any): Promise<any> {
              return Promise.resolve().then(() => {
                try {
                  let rows: any[];

                  if (_aggColName) {
                    // max() aggregate — filter first, then compute max
                    const filtered = getArr().filter((r) =>
                      _conditions.every((c) => evalCondition(c, r))
                    );
                    const camelAgg = snakeToCamel(_aggColName);
                    const vals = filtered.map((r) => r[camelAgg] ?? r[_aggColName!]).filter((v) => v !== null && v !== undefined);
                    const maxVal = vals.length > 0 ? Math.max(...vals) : null;
                    return resolve([{ maxVer: maxVal }]);
                  }

                  if (_isJoined) {
                    // innerJoin memoryItemVersions → memoryItems
                    // The from-table is whichever was used; we join the other
                    // For listPending: from(memoryItemVersions).innerJoin(memoryItems, ...)
                    const joined: any[] = [];
                    for (const v of versions) {
                      const matchedItem = items.find((i) => i.id === v.memoryItemId);
                      if (matchedItem) {
                        // Merged row — item fields dominate id
                        joined.push({ ...matchedItem, ...v, id: matchedItem.id });
                      }
                    }
                    rows = joined.filter((r) => _conditions.every((c) => evalCondition(c, r)));
                  } else {
                    rows = getArr().filter((r) => _conditions.every((c) => evalCondition(c, r)));
                  }

                  if (_orderByFn) rows = [...rows].sort(_orderByFn);
                  if (_limitVal !== null) rows = rows.slice(0, _limitVal);

                  if (_projection) {
                    rows = rows.map((r) => {
                      const out: any = {};
                      for (const [k, colName] of Object.entries(_projection!)) {
                        out[k] = r[snakeToCamel(colName)] ?? r[colName];
                      }
                      return out;
                    });
                  }

                  return resolve(rows);
                } catch (e) {
                  if (reject) return reject(e);
                  throw e;
                }
              });
            },
          };
          return builder;
        },
      };
    },

    insert(table: any) {
      const isVersionsTable = table === versionsTableRef;
      return {
        values(data: any) {
          return {
            returning() {
              const id = isVersionsTable ? newVersionId() : newItemId();
              const row = { id, ...data };
              if (isVersionsTable) versions.push(row);
              else items.push(row);
              return Promise.resolve([row]);
            },
          };
        },
      };
    },

    update(table: any) {
      const isVersionsTable = table === versionsTableRef;
      const getArr = (): any[] => (isVersionsTable ? versions : items);
      return {
        set(patch: any) {
          return {
            where(cond: any) {
              return {
                returning() {
                  const arr = getArr();
                  const updated: any[] = [];
                  for (let i = 0; i < arr.length; i++) {
                    if (!cond || evalCondition(cond, arr[i])) {
                      arr[i] = { ...arr[i], ...patch };
                      updated.push(arr[i]);
                    }
                  }
                  return Promise.resolve(updated);
                },
                // fire-and-forget (no .returning())
                then(resolve: (v: undefined) => any) {
                  const arr = getArr();
                  for (let i = 0; i < arr.length; i++) {
                    if (!cond || evalCondition(cond, arr[i])) {
                      arr[i] = { ...arr[i], ...patch };
                    }
                  }
                  return Promise.resolve(resolve(undefined));
                },
              };
            },
          };
        },
      };
    },

    delete(table: any) {
      const isVersionsTable = table === versionsTableRef;
      const getArr = (): any[] => (isVersionsTable ? versions : items);
      return {
        where(cond: any) {
          return {
            returning() {
              const arr = getArr();
              const deleted: any[] = [];
              const kept: any[] = [];
              for (const row of arr) {
                if (evalCondition(cond, row)) deleted.push(row);
                else kept.push(row);
              }
              if (isVersionsTable) { versions.length = 0; versions.push(...kept); }
              else { items.length = 0; items.push(...kept); }
              return Promise.resolve(deleted);
            },
            then(resolve: (v: undefined) => any) {
              const arr = getArr();
              const kept = arr.filter((r) => !evalCondition(cond, r));
              if (isVersionsTable) { versions.length = 0; versions.push(...kept); }
              else { items.length = 0; items.push(...kept); }
              return Promise.resolve(resolve(undefined));
            },
          };
        },
      };
    },

    transaction(fn: (tx: any) => Promise<any>) {
      return fn(db);
    },
  };

  return db as unknown as Db;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const COMPANY = "company-1";
const FOUNDER = "founder-user";
const AGENT = "agent-user";

describe("memoryService — versioning", () => {
  let svc: ReturnType<typeof memoryService>;

  beforeEach(() => {
    items = [];
    versions = [];
    itemIdCounter = 0;
    versionIdCounter = 0;
    svc = memoryService(createMockDb());
  });

  // -------------------------------------------------------------------------
  // Group: create
  // -------------------------------------------------------------------------
  describe("create", () => {
    it("founder create → item status=approved, version 1 approved, currentVersionId set", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T1", content: "Hello world", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );

      expect(item.status).toBe("approved");
      expect(item.currentVersionId).toBeTruthy();

      expect(versions).toHaveLength(1);
      const ver = versions[0];
      expect(ver.versionNumber).toBe(1);
      expect(ver.status).toBe("approved");
      expect(ver.memoryItemId).toBe(item.id);
      expect(item.currentVersionId).toBe(ver.id);
    });

    it("non-founder create → item status=pending, version 1 pending, currentVersionId null", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T2", content: "Agent content", category: "insight", source: "agent" },
        AGENT,
        false,
      );

      expect(item.status).toBe("pending");
      expect(item.currentVersionId).toBeNull();

      expect(versions).toHaveLength(1);
      const ver = versions[0];
      expect(ver.versionNumber).toBe(1);
      expect(ver.status).toBe("pending");
    });
  });

  // -------------------------------------------------------------------------
  // Group: approve / reject
  // -------------------------------------------------------------------------
  describe("approve / reject", () => {
    it("approve pending item → item approved, version approved, currentVersionId set, content denormalized", async () => {
      const pendingItem = await svc.create(
        COMPANY,
        { title: "T3", content: "Agent suggestion", category: "context", source: "agent" },
        AGENT,
        false,
      );
      expect(pendingItem.status).toBe("pending");

      const approved = await svc.approve(COMPANY, pendingItem.id);
      expect(approved).not.toBeNull();
      expect(approved!.status).toBe("approved");
      expect(approved!.currentVersionId).toBeTruthy();
      expect(approved!.content).toBe("Agent suggestion");

      const ver = versions.find((v: any) => v.id === approved!.currentVersionId);
      expect(ver?.status).toBe("approved");
    });

    it("approve V1-era item (no versions) → item approved, no errors", async () => {
      // Seed a V1-era item directly (no versions)
      items.push({
        id: "v1-item",
        companyId: COMPANY,
        title: "Legacy",
        content: "Old content",
        category: "reference",
        source: "founder",
        status: "pending",
        currentVersionId: null,
        createdBy: FOUNDER,
      });

      const result = await svc.approve(COMPANY, "v1-item");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("approved");
    });

    it("reject item → item rejected, pending versions archived", async () => {
      const agentItem = await svc.create(
        COMPANY,
        { title: "T4", content: "Reject me", category: "context", source: "agent" },
        AGENT,
        false,
      );

      const rejected = await svc.reject(COMPANY, agentItem.id);
      expect(rejected).not.toBeNull();
      expect(rejected!.status).toBe("rejected");

      const itemVersions = versions.filter((v: any) => v.memoryItemId === agentItem.id);
      expect(itemVersions.every((v: any) => v.status === "archived")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Group: update
  // -------------------------------------------------------------------------
  describe("update", () => {
    it("founder update with content change → new version approved, currentVersionId updated, old version preserved", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T5", content: "Original", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );
      const originalVersionId = item.currentVersionId;

      const updated = await svc.update(COMPANY, item.id, { content: "Updated content" }, FOUNDER, true);
      expect(updated).not.toBeNull();
      expect(updated!.currentVersionId).not.toBe(originalVersionId);
      expect(updated!.content).toBe("Updated content");

      // Two versions total
      const itemVersions = versions.filter((v: any) => v.memoryItemId === item.id);
      expect(itemVersions).toHaveLength(2);
      // Old version still exists
      expect(itemVersions.find((v: any) => v.id === originalVersionId)).toBeDefined();
    });

    it("agent suggest update → pending version created, currentVersionId NOT changed, content NOT changed", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T6", content: "Stable", category: "reference", source: "founder" },
        FOUNDER,
        true,
      );
      const originalVersionId = item.currentVersionId;
      const originalContent = item.content;

      const result = await svc.update(COMPANY, item.id, { content: "Agent edit" }, AGENT, false);
      expect(result).not.toBeNull();

      // Item in store should still have old currentVersionId and content
      const storedItem = items.find((i: any) => i.id === item.id);
      expect(storedItem?.currentVersionId).toBe(originalVersionId);
      expect(storedItem?.content).toBe(originalContent);

      // A new pending version was created
      const allVersions = versions.filter((v: any) => v.memoryItemId === item.id);
      expect(allVersions).toHaveLength(2);
      const pendingVer = allVersions.find((v: any) => v.status === "pending");
      expect(pendingVer).toBeDefined();
      expect(pendingVer?.content).toBe("Agent edit");
    });
  });

  // -------------------------------------------------------------------------
  // Group: suggestUpdate
  // -------------------------------------------------------------------------
  describe("suggestUpdate", () => {
    it("creates pending version without changing item", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T7", content: "Base content", category: "insight", source: "founder" },
        FOUNDER,
        true,
      );
      const originalVersionId = item.currentVersionId;

      const version = await svc.suggestUpdate(COMPANY, item.id, "Suggested new content", "task-context", AGENT);
      expect(version).not.toBeNull();
      expect(version!.status).toBe("pending");
      expect(version!.content).toBe("Suggested new content");
      expect(version!.memoryItemId).toBe(item.id);

      // Item unchanged
      const storedItem = items.find((i: any) => i.id === item.id);
      expect(storedItem?.currentVersionId).toBe(originalVersionId);
    });

    it("returns null for non-existent item", async () => {
      const result = await svc.suggestUpdate(COMPANY, "nonexistent-id", "content", null, AGENT);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Group: saveDraft
  // -------------------------------------------------------------------------
  describe("saveDraft", () => {
    it("creates new draft version, currentVersionId unchanged", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T8", content: "v1 content", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );
      const originalVersionId = item.currentVersionId;

      const draft = await svc.saveDraft(COMPANY, item.id, "Draft content", FOUNDER);
      expect(draft).not.toBeNull();
      expect(draft!.status).toBe("draft");
      expect(draft!.content).toBe("Draft content");

      const storedItem = items.find((i: any) => i.id === item.id);
      expect(storedItem?.currentVersionId).toBe(originalVersionId);

      const allVersions = versions.filter((v: any) => v.memoryItemId === item.id);
      expect(allVersions).toHaveLength(2);
    });

    it("saveDraft updates existing draft (not a new row)", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T9", content: "v1", category: "context", source: "founder" },
        FOUNDER,
        true,
      );

      const draft1 = await svc.saveDraft(COMPANY, item.id, "Draft v1", FOUNDER);
      expect(draft1).not.toBeNull();

      const beforeCount = versions.length;
      await svc.saveDraft(COMPANY, item.id, "Draft v2", FOUNDER);

      // No new row
      expect(versions).toHaveLength(beforeCount);
      // Content updated in place
      const draftRow = versions.find((v: any) => v.id === draft1!.id);
      expect(draftRow?.content).toBe("Draft v2");
    });
  });

  // -------------------------------------------------------------------------
  // Group: publishDraft
  // -------------------------------------------------------------------------
  describe("publishDraft", () => {
    it("promotes draft to approved, archives old approved, updates currentVersionId + content", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T10", content: "v1 approved", category: "preference", source: "founder" },
        FOUNDER,
        true,
      );
      const oldVersionId = item.currentVersionId;

      await svc.saveDraft(COMPANY, item.id, "Published content", FOUNDER);
      const published = await svc.publishDraft(COMPANY, item.id, FOUNDER);

      expect(published).not.toBeNull();
      expect(published!.content).toBe("Published content");
      expect(published!.currentVersionId).not.toBe(oldVersionId);
      expect(published!.status).toBe("approved");

      const oldVer = versions.find((v: any) => v.id === oldVersionId);
      expect(oldVer?.status).toBe("archived");

      const newVer = versions.find((v: any) => v.id === published!.currentVersionId);
      expect(newVer?.status).toBe("approved");
    });

    it("returns null when no draft exists", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T11", content: "no draft", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );

      const result = await svc.publishDraft(COMPANY, item.id, FOUNDER);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Group: discardDraft
  // -------------------------------------------------------------------------
  describe("discardDraft", () => {
    it("removes the draft version row", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T12", content: "stable", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );

      await svc.saveDraft(COMPANY, item.id, "to be discarded", FOUNDER);
      const countBefore = versions.filter((v: any) => v.memoryItemId === item.id).length;
      expect(countBefore).toBe(2);

      const discarded = await svc.discardDraft(COMPANY, item.id);
      expect(discarded).not.toBeNull();
      expect(discarded!.status).toBe("draft");

      const countAfter = versions.filter((v: any) => v.memoryItemId === item.id).length;
      expect(countAfter).toBe(1);
    });

    it("returns null when no draft exists", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T13", content: "no draft", category: "reference", source: "founder" },
        FOUNDER,
        true,
      );

      const result = await svc.discardDraft(COMPANY, item.id);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Group: approveVersion
  // -------------------------------------------------------------------------
  describe("approveVersion", () => {
    it("pending version → approved, old version archived, currentVersionId updated", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T14", content: "v1", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );
      const v1Id = item.currentVersionId!;

      const v2 = await svc.suggestUpdate(COMPANY, item.id, "v2 suggestion", null, AGENT);
      expect(v2!.status).toBe("pending");

      const updated = await svc.approveVersion(COMPANY, item.id, v2!.id);
      expect(updated).not.toBeNull();
      expect(updated!.currentVersionId).toBe(v2!.id);
      expect(updated!.content).toBe("v2 suggestion");
      expect(updated!.status).toBe("approved");

      const v1Row = versions.find((v: any) => v.id === v1Id);
      expect(v1Row?.status).toBe("archived");

      const v2Row = versions.find((v: any) => v.id === v2!.id);
      expect(v2Row?.status).toBe("approved");
    });

    it("non-pending version → returns null", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T15", content: "v1", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );
      const v1Id = item.currentVersionId!;

      // v1 is approved, not pending — should return null
      const result = await svc.approveVersion(COMPANY, item.id, v1Id);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Group: rejectVersion
  // -------------------------------------------------------------------------
  describe("rejectVersion", () => {
    it("pending version → archived, currentVersionId unchanged", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T16", content: "v1", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );
      const originalCurrentVersionId = item.currentVersionId;

      const suggestion = await svc.suggestUpdate(COMPANY, item.id, "rejected suggestion", null, AGENT);

      const result = await svc.rejectVersion(COMPANY, item.id, suggestion!.id);
      expect(result).not.toBeNull();
      expect(result!.status).toBe("archived");

      const storedItem = items.find((i: any) => i.id === item.id);
      expect(storedItem?.currentVersionId).toBe(originalCurrentVersionId);
    });

    it("non-pending version → returns null", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T17", content: "v1", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );
      const v1Id = item.currentVersionId!;

      // v1 is approved, not pending
      const result = await svc.rejectVersion(COMPANY, item.id, v1Id);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Group: restore
  // -------------------------------------------------------------------------
  describe("restore", () => {
    it("restore non-archived item → returns null", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T18", content: "active", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );
      // item is approved, not archived
      const result = await svc.restore(COMPANY, item.id);
      expect(result).toBeNull();
    });

    it("restore archived item → item approved", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T19", content: "to archive", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );
      // Manually archive the item
      const idx = items.findIndex((i: any) => i.id === item.id);
      items[idx] = { ...items[idx], status: "archived" };

      const result = await svc.restore(COMPANY, item.id);
      expect(result).not.toBeNull();
      expect(result!.status).toBe("approved");
    });
  });

  // -------------------------------------------------------------------------
  // Group: getVersionHistory
  // -------------------------------------------------------------------------
  describe("getVersionHistory", () => {
    it("returns null for non-existent item", async () => {
      const result = await svc.getVersionHistory(COMPANY, "nonexistent");
      expect(result).toBeNull();
    });

    it("returns versions ordered by versionNumber desc", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "T20", content: "v1 content", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );

      // Add v2 (founder update)
      await svc.update(COMPANY, item.id, { content: "v2 content" }, FOUNDER, true);

      const history = await svc.getVersionHistory(COMPANY, item.id);
      expect(history).not.toBeNull();
      expect(history!.length).toBeGreaterThanOrEqual(2);
      // First element should have the highest version number
      expect(history![0].versionNumber).toBeGreaterThan(history![1].versionNumber);
    });
  });

  // -------------------------------------------------------------------------
  // Group: list
  // -------------------------------------------------------------------------
  describe("list", () => {
    it("supports layer filter", async () => {
      await svc.create(
        COMPANY,
        { title: "Domain item", content: "...", category: "decision", source: "founder", layer: "domain" },
        FOUNDER,
        true,
      );
      await svc.create(
        COMPANY,
        { title: "Identity item", content: "...", category: "decision", source: "founder", layer: "identity" },
        FOUNDER,
        true,
      );

      const allItems = await svc.list(COMPANY, {});
      expect(allItems.length).toBe(2);

      const domainItems = await svc.list(COMPANY, { layer: "domain" });
      expect(domainItems.length).toBe(1);
      expect(domainItems[0].title).toBe("Domain item");
    });
  });

  // -------------------------------------------------------------------------
  // Group: listPending
  // -------------------------------------------------------------------------
  describe("listPending", () => {
    it("returns items with status=pending (item-level)", async () => {
      const agentItem = await svc.create(
        COMPANY,
        { title: "Pending item", content: "agent work", category: "insight", source: "agent" },
        AGENT,
        false,
      );
      // Create an approved item (should not appear)
      await svc.create(
        COMPANY,
        { title: "Approved item", content: "founder work", category: "decision", source: "founder" },
        FOUNDER,
        true,
      );

      expect(agentItem.status).toBe("pending");

      const pending = await svc.listPending(COMPANY);
      const pendingIds = pending.map((i: any) => i.id);
      expect(pendingIds).toContain(agentItem.id);
    });

    it("returns approved item that has pending versions (version-level pending)", async () => {
      const item = await svc.create(
        COMPANY,
        { title: "Has pending version", content: "v1", category: "reference", source: "founder" },
        FOUNDER,
        true,
      );
      // Agent suggests update → creates pending version on an approved item
      await svc.suggestUpdate(COMPANY, item.id, "v2 suggestion", null, AGENT);

      // Verify state before calling listPending
      const pendingVersionsForItem = versions.filter((v: any) => v.memoryItemId === item.id && v.status === "pending");
      expect(pendingVersionsForItem.length).toBeGreaterThan(0);

      const pending = await svc.listPending(COMPANY);
      const pendingIds = pending.map((i: any) => i.id);
      // The item has a pending version — it should appear in the list
      expect(pendingIds).toContain(item.id);
    });
  });
});
