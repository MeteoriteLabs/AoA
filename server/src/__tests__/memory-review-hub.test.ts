// server/src/__tests__/memory-review-hub.test.ts
//
// Mem T4 — memory_review Inbox signpost: producer + reconciler + emit.
//
// Coverage:
//   1. buildMemoryReviewHubEmit — one company-level emit, singular/plural noun.
//   2. reconcileMemoryReview (via hubItemsService.reconcile "memory") — terminal
//      close when zero founder-gated pending remain; non-terminal count-in-title
//      heal when rows remain.
//   3. writeMemoryAndIndex emit guard — signposts only for founder-gated pending
//      memory (source != founder, layer != working, status == pending).
//
// ESM cycle workaround (CLAUDE.md Test Patterns): mock @armyofagents/db +
// drizzle-orm with Proxy table stubs + no-op operators so importing the real
// hub-items / hub-source-producers modules never pulls drizzle's require(esm)
// cycle. Sequence-based db doubles drive the reconcile/count queries.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted spies ────────────────────────────────────────────────────────────
const { mockEmitHubItem } = vi.hoisted(() => ({ mockEmitHubItem: vi.fn() }));
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

// ── Module mocks ─────────────────────────────────────────────────────────────
vi.mock("@armyofagents/db", () => {
  const makeTable = () =>
    new Proxy(
      {},
      {
        get(_t, p) {
          if (p === "$inferSelect" || p === "$inferInsert") return {};
          return Symbol(String(p));
        },
      },
    );
  // Enumerate the tables the imported graph binds (vitest's named-export interop
  // only exposes OWN properties of the factory return — a bare Proxy namespace
  // leaves every named import undefined).
  const TABLE_NAMES = [
    "hubItems", "hubItemUserState", "hubAudit", "activityLog", "agentRuntimeDecisions",
    "companyMemberships", "approvals", "heartbeatRuns", "joinRequests", "discussions",
    "discussionEntries", "suggestions", "issues", "companies", "costEvents",
    "workQuestions", "memoryItems", "memoryItemVersions", "memoryRetrievals",
    "memoryFolders", "embeddingQueue", "agents", "projects", "goals", "userRoles",
  ];
  const mod: Record<string, unknown> = {};
  for (const name of TABLE_NAMES) mod[name] = makeTable();
  return mod;
});

vi.mock("drizzle-orm", () => {
  const op = (name: string) => (..._a: unknown[]) => name;
  const sql: ((...a: unknown[]) => string) & { raw?: unknown; join?: unknown } =
    (..._a: unknown[]) => "sql";
  sql.raw = (s: unknown) => s;
  sql.join = (..._a: unknown[]) => "sqljoin";
  return {
    and: op("and"),
    or: op("or"),
    eq: op("eq"),
    ne: op("ne"),
    isNull: op("isNull"),
    isNotNull: op("isNotNull"),
    inArray: op("inArray"),
    desc: op("desc"),
    asc: op("asc"),
    gt: op("gt"),
    gte: op("gte"),
    lt: op("lt"),
    lte: op("lte"),
    sql,
  };
});

vi.mock("../services/live-events.js", () => ({ publishLiveEvent: vi.fn() }));

vi.mock("../services/org-hierarchy.js", () => ({
  orgHierarchyService: () => ({
    getFounderUserId: async () => "founder-1",
    getFirstHumanAncestor: async () => null,
  }),
}));

vi.mock("../services/db-capabilities.js", () => ({
  getDbCapabilities: () => ({ hasVectorSupport: false }),
}));

vi.mock("../services/memory.js", () => ({
  memoryService: () => ({ create: mockCreate }),
}));

// Keep the REAL buildMemoryReviewHubEmit (pure) but spy on emitHubItem so the
// write path's signpost is observable without a full hub emit.
vi.mock("../services/hub-source-producers.js", async (importActual) => {
  const actual = await importActual<typeof import("../services/hub-source-producers.js")>();
  return { ...actual, emitHubItem: mockEmitHubItem };
});

// ── Imports (after mocks) ────────────────────────────────────────────────────
import { buildMemoryReviewHubEmit } from "../services/hub-source-producers.js";
import { hubItemsService } from "../services/hub-items.js";
import { writeMemoryAndIndex } from "../services/memory-write.js";

// ── Helpers ──────────────────────────────────────────────────────────────────
function thenableRows<T>(rows: T[]) {
  return { then: (resolve: (value: T[]) => unknown) => Promise.resolve(resolve(rows)) };
}

const openMemoryItem = () => ({
  id: "hub-mem-1",
  companyId: "co-1",
  sourceId: "co-1", // sourceId IS the companyId for memory_review
  sourceType: "memory",
  semanticType: "memory_review",
  status: "open",
  title: "Review 1 memory item",
  summary: "1 memory item is ready for your approval.",
  message: "1 memory item is ready for your approval.",
  sourcePermissionRevision: "2026-07-19T00:00:00.000Z",
  ownerUserId: "founder-1",
  ownerPool: null,
  scopeKey: null,
  version: 0,
  resolvedAt: null,
  archivedAt: null,
});

// reconcile() select order: #1 = open-items scan; #2 = reconcileMemoryReview count.
function makeReconcileDb(count: number, opts: { close?: boolean } = {}) {
  const item = openMemoryItem();
  const archivedRow = {
    ...item,
    status: "archived",
    version: item.version + 1,
    archivedAt: new Date("2026-07-20T00:00:00.000Z"),
  };
  let selectCount = 0;
  const updateReturning = vi.fn(async () => [archivedRow]);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const healWhere = vi.fn(async () => []);
  const set = vi.fn(() => (opts.close ? { where: updateWhere } : { where: healWhere }));
  const insertValues = vi.fn(async () => []);
  const db = {
    select: vi.fn(() => {
      selectCount += 1;
      if (selectCount === 1) {
        return { from: () => ({ where: () => thenableRows([item]) }) };
      }
      return { from: () => ({ where: () => thenableRows([{ count }]) }) };
    }),
    update: vi.fn(() => ({ set })),
    insert: vi.fn(() => ({ values: insertValues })),
  } as never;
  return { db, set, insertValues };
}

// Emit-path db double: only countPendingMemory touches the db (create +
// enqueue are mocked / no-op). select().from().where() → [{ count }].
function makeEmitDb(count = 3) {
  return {
    select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([{ count }]) }) })),
  } as never;
}

// ============================================================================
// 1. Producer
// ============================================================================
describe("buildMemoryReviewHubEmit", () => {
  it("builds one company-level memory_review emit", () => {
    const emit = buildMemoryReviewHubEmit({
      companyId: "co-1",
      count: 4,
      ownerUserId: "founder-1",
      updatedAt: new Date("2026-07-20T00:00:00Z"),
    });
    expect(emit.semanticType).toBe("memory_review");
    expect(emit.sourceType).toBe("memory");
    expect(emit.sourceId).toBe("co-1");
    expect(emit.companyId).toBe("co-1");
    expect(emit.ownerUserId).toBe("founder-1");
    expect(emit.title).toMatch(/4 memory items/i);
  });

  it("uses the singular noun for a single item", () => {
    const emit = buildMemoryReviewHubEmit({
      companyId: "co-1",
      count: 1,
      ownerUserId: "founder-1",
      updatedAt: new Date("2026-07-20T00:00:00Z"),
    });
    expect(emit.title).toMatch(/1 memory item\b/i);
  });
});

// ============================================================================
// 2. Reconciler (via hubItemsService.reconcile "memory")
// ============================================================================
describe("reconcileMemoryReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("closes the memory_review row when zero founder-gated pending remain", async () => {
    const { db, set, insertValues } = makeReconcileDb(0, { close: true });
    const result = await hubItemsService(db).reconcile("co-1", { sourceType: "memory" });
    expect(result).toEqual({ healed: 1, closed: 1, refreshed: 0 });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" }));
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reconcile_close", actorType: "system", actorId: "reconciler" }),
    );
  });

  it("heals the count in the title while rows remain (non-terminal)", async () => {
    const { db, set } = makeReconcileDb(3);
    const result = await hubItemsService(db).reconcile("co-1", { sourceType: "memory" });
    expect(result).toEqual({ healed: 1, closed: 0, refreshed: 1 });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ title: "Review 3 memory items" }));
  });
});

// ============================================================================
// 3. Emit at the memory-write chokepoint
// ============================================================================
describe("writeMemoryAndIndex — memory_review emit guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signposts founder-gated pending agent memory (source=agent, layer=domain)", async () => {
    mockCreate.mockResolvedValue({
      id: "mem-1",
      companyId: "co-1",
      source: "agent",
      status: "pending",
      layer: "domain",
      title: "T",
      content: "c",
    });
    await writeMemoryAndIndex(makeEmitDb(3), "co-1", {
      title: "T",
      content: "c",
      source: "agent",
      status: "pending",
      layer: "domain",
    } as never);
    expect(mockEmitHubItem).toHaveBeenCalledTimes(1);
    const emitArgs = mockEmitHubItem.mock.calls[0][1] as {
      sourceType: string;
      semanticType: string;
      sourceId: string;
      title: string;
    };
    expect(emitArgs.sourceType).toBe("memory");
    expect(emitArgs.semanticType).toBe("memory_review");
    expect(emitArgs.sourceId).toBe("co-1");
    expect(emitArgs.title).toMatch(/3 memory items/i);
  });

  it("does NOT signpost a founder-authored write (source=founder)", async () => {
    mockCreate.mockResolvedValue({
      id: "mem-2",
      companyId: "co-1",
      source: "founder",
      status: "pending",
      layer: "identity",
      title: "T",
      content: "c",
    });
    await writeMemoryAndIndex(makeEmitDb(1), "co-1", {
      title: "T",
      content: "c",
      source: "founder",
      layer: "identity",
    } as never);
    expect(mockEmitHubItem).not.toHaveBeenCalled();
  });

  it("does NOT signpost ephemeral working memory (layer=working)", async () => {
    mockCreate.mockResolvedValue({
      id: "mem-3",
      companyId: "co-1",
      source: "agent",
      status: "pending",
      layer: "working",
      title: "T",
      content: "c",
    });
    await writeMemoryAndIndex(makeEmitDb(1), "co-1", {
      title: "T",
      content: "c",
      source: "agent",
      status: "pending",
      layer: "working",
    } as never);
    expect(mockEmitHubItem).not.toHaveBeenCalled();
  });
});
