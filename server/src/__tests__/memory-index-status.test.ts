/**
 * server/src/__tests__/memory-index-status.test.ts
 *
 * Task W5 — two-axis memory index status tests.
 *
 * Covers:
 *   A. deriveIndexStatus: pure function, all 4 output states.
 *   B. enrichWithIndexStatus (via list): batched queue lookup, per-item
 *      indexStatus, top-level semanticAvailable.
 *   C. semanticAvailable independence: item with stored vector stays "indexed"
 *      even when the company has no key (semanticAvailable = false).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeTableProxy,
  drizzleOperatorStubs,
  mockDbCapabilities,
} from "./helpers/drizzle-mock.js";

// ── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock("@armyofagents/db", () => ({
  embeddingQueue: makeTableProxy("embedding_queue"),
  memoryItems: makeTableProxy("memory_items"),
  agents: makeTableProxy("agents"),
  memoryItemVersions: makeTableProxy("memory_item_versions"),
  memoryRetrievals: makeTableProxy("memory_retrievals"),
  suggestions: makeTableProxy("suggestions"),
}));

vi.mock("drizzle-orm", () => drizzleOperatorStubs());

// Default: vector support enabled. Override per-test for no-vector path.
vi.mock("../services/db-capabilities.js", () => mockDbCapabilities({ hasVectorSupport: true }));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Stub memory.ts deps to avoid pulling in live modules.
vi.mock("../services/memory-projection.js", () => ({
  buildMemoryInsert: vi.fn(),
  memoryItemsSelection: vi.fn().mockReturnValue({}),
}));
vi.mock("../adapters/api-common.js", () => ({
  resolveApiKey: vi.fn(),
}));
vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));
vi.mock("../errors.js", () => ({
  badRequest: (msg: string) => new Error(msg),
  conflict: (msg: string) => new Error(msg),
  notFound: (msg: string) => new Error(msg),
}));
vi.mock("@armyofagents/shared", () => ({
  MEMORY_ITEM_LAYERS: ["identity", "domain", "active_context", "working"],
  normalizeMemoryFolderPath: (p: string) => p,
}));
vi.mock("../services/embeddings.js", () => ({
  generateEmbedding: vi.fn(),
}));
vi.mock("../services/memory-write.js", () => ({
  enqueueMemoryEmbedding: vi.fn(),
}));

// Key resolver for memory-index-status — mocked so tests control semanticAvailable.
vi.mock("../services/internal-agent/providers/index.js", () => ({
  getProviderApiKey: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { deriveIndexStatus } from "../services/memory-index-status.js";
import { getProviderApiKey } from "../services/internal-agent/providers/index.js";
import { getDbCapabilities } from "../services/db-capabilities.js";

// ─────────────────────────────────────────────────────────────────────────────
// Section A: deriveIndexStatus — pure function
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveIndexStatus (pure function)", () => {
  describe("hasVector=true always returns 'indexed'", () => {
    it("hasVector=true, queueStatus=null → indexed", () => {
      expect(deriveIndexStatus({ hasVector: true, queueStatus: null })).toBe("indexed");
    });

    it("hasVector=true, queueStatus='failed' → indexed (vector wins over failed queue)", () => {
      expect(deriveIndexStatus({ hasVector: true, queueStatus: "failed" })).toBe("indexed");
    });

    it("hasVector=true, queueStatus='pending' → indexed (vector wins over pending queue)", () => {
      expect(deriveIndexStatus({ hasVector: true, queueStatus: "pending" })).toBe("indexed");
    });

    it("hasVector=true, queueStatus='processing' → indexed", () => {
      expect(deriveIndexStatus({ hasVector: true, queueStatus: "processing" })).toBe("indexed");
    });

    it("hasVector=true, queueStatus='completed' → indexed", () => {
      expect(deriveIndexStatus({ hasVector: true, queueStatus: "completed" })).toBe("indexed");
    });
  });

  describe("hasVector=false, queue determines status", () => {
    it("no vector + queueStatus='failed' → failed", () => {
      expect(deriveIndexStatus({ hasVector: false, queueStatus: "failed" })).toBe("failed");
    });

    it("no vector + queueStatus='pending' → pending", () => {
      expect(deriveIndexStatus({ hasVector: false, queueStatus: "pending" })).toBe("pending");
    });

    it("no vector + queueStatus='processing' → pending", () => {
      expect(deriveIndexStatus({ hasVector: false, queueStatus: "processing" })).toBe("pending");
    });

    it("no vector + queueStatus='completed' → not_indexed (completed without vector = stale or cleared)", () => {
      expect(deriveIndexStatus({ hasVector: false, queueStatus: "completed" })).toBe("not_indexed");
    });

    it("no vector + queueStatus=null → not_indexed", () => {
      expect(deriveIndexStatus({ hasVector: false, queueStatus: null })).toBe("not_indexed");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B: list enrichment — indexStatus per item + semanticAvailable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a mock DB that:
 *   - First select() → returns memory items (from memoryItems table)
 *   - Second select() → returns embedding_queue rows (from embeddingQueue table)
 */
function makeListDb(opts: {
  memoryRows?: Array<Record<string, unknown>>;
  queueRows?: Array<Record<string, unknown>>;
}) {
  const memoryRows = opts.memoryRows ?? [];
  const queueRows = opts.queueRows ?? [];
  let selectCount = 0;

  function makeChain(result: Array<Record<string, unknown>>) {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit", "leftJoin", "innerJoin"]) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve(result));
    return chain;
  }

  return {
    select: (..._args: unknown[]) => {
      const idx = selectCount++;
      // First call = memory_items rows; second call = embedding_queue rows.
      return makeChain(idx === 0 ? memoryRows : queueRows);
    },
  };
}

describe("list enrichment", () => {
  const mockGetProviderApiKey = getProviderApiKey as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: getDbCapabilities returns hasVectorSupport:true (set in mock above).
  });

  it("enriches items with indexStatus and returns semanticAvailable:true when key resolves", async () => {
    mockGetProviderApiKey.mockResolvedValue("sk-test-key");

    const db = makeListDb({
      memoryRows: [
        { id: "m-1", companyId: "co-1", title: "T1", embedding: null },
        { id: "m-2", companyId: "co-1", title: "T2", embedding: [0.1, 0.2] }, // has vector
        { id: "m-3", companyId: "co-1", title: "T3", embedding: null },
      ],
      queueRows: [
        { targetId: "m-1", status: "failed", createdAt: new Date("2026-01-02") },
        { targetId: "m-3", status: "pending", createdAt: new Date("2026-01-02") },
      ],
    });

    const { memoryService } = await import("../services/memory.js");
    const svc = memoryService(db as any);
    const result = await svc.list("co-1");

    expect(result.semanticAvailable).toBe(true);
    expect(result.items).toHaveLength(3);

    const m1 = result.items.find((i) => i.id === "m-1");
    const m2 = result.items.find((i) => i.id === "m-2");
    const m3 = result.items.find((i) => i.id === "m-3");

    expect(m1?.indexStatus).toBe("failed");    // no vector, queue=failed
    expect(m2?.indexStatus).toBe("indexed");   // has vector → always indexed
    expect(m3?.indexStatus).toBe("pending");   // no vector, queue=pending
  });

  it("returns semanticAvailable:false when key resolution throws", async () => {
    mockGetProviderApiKey.mockRejectedValue(new Error("No API key configured"));

    const db = makeListDb({
      memoryRows: [
        { id: "m-1", companyId: "co-1", title: "T1", embedding: null },
      ],
      queueRows: [],
    });

    const { memoryService } = await import("../services/memory.js");
    const svc = memoryService(db as any);
    const result = await svc.list("co-1");

    expect(result.semanticAvailable).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.indexStatus).toBe("not_indexed");
  });

  it("item with stored vector stays 'indexed' even when semanticAvailable is false (key removed)", async () => {
    // Key is gone — company can't embed new items.
    mockGetProviderApiKey.mockRejectedValue(new Error("No API key"));

    const db = makeListDb({
      memoryRows: [
        { id: "m-vec", companyId: "co-1", title: "Has vector", embedding: [0.5, 0.5] },
        { id: "m-none", companyId: "co-1", title: "No vector", embedding: null },
      ],
      queueRows: [],
    });

    const { memoryService } = await import("../services/memory.js");
    const svc = memoryService(db as any);
    const result = await svc.list("co-1");

    // Axis 2: company can't embed.
    expect(result.semanticAvailable).toBe(false);

    // Axis 1: per-item is independent.
    const vec = result.items.find((i) => i.id === "m-vec");
    const none = result.items.find((i) => i.id === "m-none");

    expect(vec?.indexStatus).toBe("indexed");     // stored vector wins
    expect(none?.indexStatus).toBe("not_indexed"); // no vector, no queue row
  });

  it("empty list returns semanticAvailable and empty items array", async () => {
    mockGetProviderApiKey.mockResolvedValue("sk-ok");

    const db = makeListDb({ memoryRows: [], queueRows: [] });

    const { memoryService } = await import("../services/memory.js");
    const svc = memoryService(db as any);
    const result = await svc.list("co-1");

    expect(result.semanticAvailable).toBe(true);
    expect(result.items).toHaveLength(0);
  });

  it("uses only one queue query regardless of item count (no N+1)", async () => {
    mockGetProviderApiKey.mockResolvedValue("sk-ok");

    // Build a db that counts select() calls.
    let selectCalls = 0;
    const db = {
      select: (..._args: unknown[]) => {
        selectCalls++;
        const result = selectCalls === 1
          ? [
              { id: "m-1", companyId: "co-1", embedding: null },
              { id: "m-2", companyId: "co-1", embedding: null },
              { id: "m-3", companyId: "co-1", embedding: null },
            ]
          : []; // queue rows = empty

        const chain: Record<string, unknown> = {};
        for (const m of ["from", "where", "orderBy", "limit"]) {
          chain[m] = (..._a: unknown[]) => chain;
        }
        chain.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve(resolve(result));
        return chain;
      },
    };

    const { memoryService } = await import("../services/memory.js");
    const svc = memoryService(db as any);
    await svc.list("co-1");

    // Exactly 2 select calls: one for memory_items, one for embedding_queue.
    expect(selectCalls).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section C: resolveSemanticAvailable — no-vector short-circuit
// ─────────────────────────────────────────────────────────────────────────────
//
// The db-capabilities mock in this file is set up via mockDbCapabilities() which
// returns a plain object (not a vi.fn). To test the no-vector path we use a
// separate vi.mock override in an isolated module scope via doMock/resetModules.

describe("resolveSemanticAvailable — short-circuits when hasVectorSupport=false", () => {
  it("returns false and never calls getProviderApiKey when pgvector is absent", async () => {
    // Reset module registry so we can inject fresh mocks.
    vi.resetModules();

    // Re-declare mocks for this isolated import.
    vi.doMock("@armyofagents/db", () => ({
      embeddingQueue: makeTableProxy("embedding_queue"),
      memoryItems: makeTableProxy("memory_items"),
    }));
    vi.doMock("drizzle-orm", () => drizzleOperatorStubs());
    vi.doMock("../middleware/logger.js", () => ({
      logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
    }));

    // No vector support.
    vi.doMock("../services/db-capabilities.js", () => ({
      getDbCapabilities: () => ({ hasVectorSupport: false }),
      setDbCapabilities: () => {},
      probeDbCapabilities: () => Promise.resolve({ hasVectorSupport: false }),
    }));

    const keyResolverMock = vi.fn().mockResolvedValue("sk-has-key");
    vi.doMock("../services/internal-agent/providers/index.js", () => ({
      getProviderApiKey: keyResolverMock,
    }));

    const { resolveSemanticAvailable } = await import("../services/memory-index-status.js");

    const fakeDb = {} as any;
    const result = await resolveSemanticAvailable(fakeDb, "co-1");

    // Must be false: pgvector absent short-circuits before key check.
    expect(result).toBe(false);
    // Must NOT have called the key resolver.
    expect(keyResolverMock).not.toHaveBeenCalled();
  });
});
