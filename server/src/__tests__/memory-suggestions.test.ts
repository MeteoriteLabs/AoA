import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@paperclipai/db", () => {
  const makeTable = (name: string) => {
    const cols: Record<string, symbol> = {};
    return new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") {
          if (!cols[prop]) cols[prop] = Symbol(`${name}.${prop}`);
          return cols[prop];
        }
        return undefined;
      },
    });
  };

  return {
    memoryItems: makeTable("memory_items"),
    memoryItemVersions: makeTable("memory_item_versions"),
    suggestions: makeTable("suggestions"),
    agents: makeTable("agents"),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  eq: (..._args: unknown[]) => "eq",
  ilike: (..._args: unknown[]) => "ilike",
  or: (..._args: unknown[]) => "or",
  desc: (..._args: unknown[]) => "desc",
  sql: new Proxy(() => "sql", { get: () => () => "sql", apply: () => "sql" }),
}));

vi.mock("../services/embeddings.js", () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock("../adapters/api-common.js", () => ({
  resolveApiKey: vi.fn(),
}));

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

import { memoryService } from "../services/memory.js";

type MockRow = Record<string, unknown>;

function createSequenceDb(config: {
  selects?: MockRow[][];
  updates?: MockRow[][];
  inserts?: MockRow[][];
} = {}) {
  let selectIdx = 0;
  let updateIdx = 0;
  let insertIdx = 0;
  const captured = {
    insertValues: [] as unknown[],
    updateSets: [] as unknown[],
  };

  const selects = config.selects ?? [];
  const updates = config.updates ?? [];
  const inserts = config.inserts ?? [];

  const buildChain = (kind: "select" | "update" | "insert", getResult: () => MockRow[]) => {
    const chain: Record<string, any> = {};
    for (const method of ["from", "where", "set", "values", "returning", "innerJoin", "leftJoin", "orderBy", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        if (method === "set") captured.updateSets.push(args[0]);
        if (method === "values") captured.insertValues.push(args[0]);
        return chain;
      };
    }
    chain.then = (resolve: (value: MockRow[]) => unknown) => Promise.resolve(resolve(getResult()));
    return chain;
  };

  const db: Record<string, any> = {
    select: () => buildChain("select", () => selects[selectIdx++] ?? []),
    update: () => buildChain("update", () => updates[updateIdx++] ?? []),
    insert: () => buildChain("insert", () => inserts[insertIdx++] ?? []),
  };

  db.transaction = async (fn: (tx: typeof db) => Promise<unknown>) => fn(db as any);

  return { db: db as any, captured };
}

describe("memoryService agent suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates agent memory items as pending with required layer and sourceContext", async () => {
    const { db, captured } = createSequenceDb({
      inserts: [[{ id: "mem-1", status: "pending", source: "agent", layer: "domain" }]],
    });
    const svc = memoryService(db);

    const item = await svc.create("co-1", {
      title: "API guideline",
      content: "Prefer JSON responses",
      category: "reference",
      source: "agent",
      createdBy: "agent-1",
      layer: "domain",
      sourceContext: "Observed repeated response-format fixes",
    });

    expect(item.status).toBe("pending");
    expect(captured.insertValues[0]).toEqual(expect.objectContaining({
      companyId: "co-1",
      source: "agent",
      status: "pending",
      layer: "domain",
      embedding: null,
    }));
  });

  it("rejects agent create without sourceContext", async () => {
    const { db } = createSequenceDb();
    const svc = memoryService(db);

    expect(() => svc.create("co-1", {
      title: "API guideline",
      content: "Prefer JSON responses",
      category: "reference",
      source: "agent",
      createdBy: "agent-1",
      layer: "domain",
      sourceContext: "",
    })).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("creates a pending update suggestion without changing currentVersionId", async () => {
    const { db, captured } = createSequenceDb({
      selects: [
        [{ id: "mem-1", companyId: "co-1", status: "approved", currentVersionId: "ver-1" }],
        [],
        [{ versionNumber: 2 }],
      ],
      inserts: [[{ id: "ver-3", memoryItemId: "mem-1", versionNumber: 3, status: "pending", createdBy: "agent-1" }]],
    });
    const svc = memoryService(db);

    const version = await svc.suggestUpdate(
      "co-1",
      "mem-1",
      "Updated content",
      "The founder keeps correcting this detail",
      "agent-1",
    );

    expect(version).toEqual(expect.objectContaining({
      id: "ver-3",
      status: "pending",
      createdBy: "agent-1",
    }));
    expect(captured.updateSets).toEqual([]);
  });

  it("updates an existing pending version by the same agent instead of duplicating it", async () => {
    const { db, captured } = createSequenceDb({
      selects: [
        [{ id: "mem-1", companyId: "co-1", status: "approved" }],
        [{ id: "ver-pending", memoryItemId: "mem-1", versionNumber: 2, status: "pending", createdBy: "agent-1" }],
      ],
      updates: [[{ id: "ver-pending", memoryItemId: "mem-1", versionNumber: 2, status: "pending", content: "Refined content", createdBy: "agent-1" }]],
    });
    const svc = memoryService(db);

    const version = await svc.suggestUpdate(
      "co-1",
      "mem-1",
      "Refined content",
      "New reasoning",
      "agent-1",
    );

    expect(version.id).toBe("ver-pending");
    expect(captured.insertValues).toHaveLength(0);
    expect(captured.updateSets[0]).toEqual({ content: "Refined content" });
  });

  it("rejects update suggestions for archived items", async () => {
    const { db } = createSequenceDb({
      selects: [[{ id: "mem-1", companyId: "co-1", status: "archived" }]],
    });
    const svc = memoryService(db);

    await expect(svc.suggestUpdate(
      "co-1",
      "mem-1",
      "Updated content",
      "Reason",
      "agent-1",
    )).rejects.toMatchObject({ status: 409 });
  });

  it("returns 404 when suggesting an update for a missing item", async () => {
    const { db } = createSequenceDb({
      selects: [[]],
    });
    const svc = memoryService(db);

    await expect(svc.suggestUpdate(
      "co-1",
      "missing",
      "Updated content",
      "Reason",
      "agent-1",
    )).rejects.toMatchObject({ status: 404 });
  });

  it("creates an archive suggestion without archiving the item", async () => {
    const { db, captured } = createSequenceDb({
      selects: [
        [{ id: "mem-1", companyId: "co-1", title: "Old note", status: "approved" }],
        [{ name: "Atlas" }],
        [],
      ],
      inserts: [[{ id: "sug-1", category: "agent_proposal", actionType: "archive_memory", relatedMemoryItemId: "mem-1" }]],
    });
    const svc = memoryService(db);

    const suggestion = await svc.suggestArchive(
      "co-1",
      "mem-1",
      "This knowledge is obsolete after the workflow change",
      "agent-1",
    );

    expect(suggestion).toEqual(expect.objectContaining({
      id: "sug-1",
      category: "agent_proposal",
      actionType: "archive_memory",
    }));
    expect(captured.insertValues[0]).toEqual(expect.objectContaining({
      category: "agent_proposal",
      actionType: "archive_memory",
      relatedMemoryItemId: "mem-1",
      title: "Agent Atlas suggests archiving 'Old note'",
    }));
    expect(captured.updateSets).toEqual([]);
  });

  it("approves a pending version and makes it current", async () => {
    const { db, captured } = createSequenceDb({
      selects: [
        [{ id: "mem-1", companyId: "co-1", currentVersionId: "ver-1" }],
        [{ id: "ver-2", memoryItemId: "mem-1", versionNumber: 2, content: "New content", status: "pending" }],
      ],
      updates: [
        [],
        [{ id: "ver-2", memoryItemId: "mem-1", versionNumber: 2, content: "New content", status: "approved" }],
        [],
      ],
    });
    const svc = memoryService(db);

    const approved = await svc.approveSuggestedVersion("co-1", "mem-1", "ver-2");

    expect(approved.status).toBe("approved");
    expect(captured.updateSets).toContainEqual({ status: "archived" });
    expect(captured.updateSets).toContainEqual({ status: "approved" });
    expect(captured.updateSets).toContainEqual(expect.objectContaining({
      content: "New content",
      currentVersionId: "ver-2",
    }));
  });

  it("rejects a pending version without changing the item", async () => {
    const { db, captured } = createSequenceDb({
      selects: [[{ id: "mem-1" }]],
      updates: [[{ id: "ver-2", memoryItemId: "mem-1", versionNumber: 2, status: "rejected" }]],
    });
    const svc = memoryService(db);

    const rejected = await svc.rejectSuggestedVersion("co-1", "mem-1", "ver-2");

    expect(rejected.status).toBe("rejected");
    expect(captured.updateSets).toEqual([{ status: "rejected" }]);
  });
});
