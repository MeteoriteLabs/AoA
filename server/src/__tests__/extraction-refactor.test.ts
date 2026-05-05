import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  desc: vi.fn((a: unknown) => ({ desc: a })),
  sql: Object.assign(
    vi.fn((strings: any, ...values: any[]) => ({
      sql: strings,
      values,
      as: vi.fn().mockReturnValue("aliased"),
    })),
    { raw: vi.fn((input: any) => input) },
  ),
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === "_") return { name };
        if (typeof prop === "string") return Symbol(`${name}.${prop}`);
        return undefined;
      },
    });
  return {
    discussions: makeTable("discussions"),
    discussionEntries: makeTable("discussion_entries"),
    discussionExtractedItems: makeTable("discussion_extracted_items"),
    internalAgentConfig: makeTable("internal_agent_config"),
    internalAgentRuns: makeTable("internal_agent_runs"),
    projects: makeTable("projects"),
    debriefs: makeTable("debriefs"),
    briefs: makeTable("briefs"),
    briefItems: makeTable("brief_items"),
  };
});

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

// Mock live-events
const mockPublishLiveEvent = vi.fn();
vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: (...args: unknown[]) => mockPublishLiveEvent(...args),
}));

// Mock providers
const mockGetProviderApiKey = vi.fn();
const mockCreateProvider = vi.fn();
vi.mock("../services/internal-agent/providers/index.js", () => ({
  getProviderApiKey: (...args: unknown[]) => mockGetProviderApiKey(...args),
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
}));

import { extractionService } from "../services/extraction.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    discussionId: "disc-1",
    rawContent: "We need to build a user onboarding flow. Also, always use TypeScript strict mode.",
    inputType: "paste",
    extractionStatus: "pending",
    extractionRunId: null,
    departmentId: null,
    projectId: null,
    goalId: null,
    ...overrides,
  };
}

function createMockDiscussion(overrides: Record<string, unknown> = {}) {
  return {
    id: "disc-1",
    companyId: "company-1",
    title: "Product planning",
    scopeType: null,
    scopeId: null,
    ...overrides,
  };
}

/** Creates an async iterable that yields text chunks then a done chunk */
function createMockStream(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "text" as const, delta: text };
      yield { type: "done" as const, usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}

/** Builds a mock DB with a select queue and captured inserts/updates */
function createMockDb() {
  const selectQueue: any[][] = [];
  const capturedInserts: Array<{ table: string; values: any }> = [];
  const capturedUpdates: Array<{ table: string; set: any }> = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: vi.fn((fn: (rows: any[]) => any) =>
        Promise.resolve(fn(selectQueue.shift() ?? [])),
      ),
    })),
    insert: vi.fn((table: any) => ({
      values: vi.fn((values: any) => {
        const tableName = table?._?.name ?? "unknown";
        capturedInserts.push({ table: tableName, values });
        return {
          returning: vi.fn().mockReturnThis(),
          then: vi.fn((fn: (rows: any[]) => any) => {
            if (Array.isArray(values)) {
              return Promise.resolve(fn(values.map((v: any, i: number) => ({ id: `gen-${i}`, ...v }))));
            }
            return Promise.resolve(fn([{ id: `run-1`, ...values }]));
          }),
        };
      }),
    })),
    update: vi.fn((table: any) => ({
      set: vi.fn((setData: any) => {
        const tableName = table?._?.name ?? "unknown";
        capturedUpdates.push({ table: tableName, set: setData });
        return {
          where: vi.fn().mockReturnThis(),
          catch: vi.fn().mockReturnThis(),
          then: vi.fn((fn?: (rows: any[]) => any) =>
            Promise.resolve(fn ? fn([]) : undefined),
          ),
        };
      }),
    })),
    transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(db)),
  };

  return { db, selectQueue, capturedInserts, capturedUpdates };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("extractFromDiscussionEntry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPublishLiveEvent.mockClear();
    mockGetProviderApiKey.mockClear();
    mockCreateProvider.mockClear();
  });

  it("extracts via agent provider when internalAgentConfig is configured", async () => {
    const { db, selectQueue, capturedInserts, capturedUpdates } = createMockDb();

    const extractedJson = JSON.stringify([
      { type: "task", title: "Build onboarding flow", description: "User onboarding", priority: "high", department: null, layer: "active_context" },
      { type: "preference", title: "Use TypeScript strict mode", description: "Always enable strict", department: null, layer: "domain" },
    ]);

    // Queue: 1) entry, 2) discussion, 3) internalAgentConfig (pre-check), 4) previous entries, 5) departments
    selectQueue.push(
      [createMockEntry()],
      [createMockDiscussion()],
      [{ id: "cfg-1", companyId: "company-1", provider: "anthropic", model: "claude-sonnet-4-6" }],
      [],
      [{ id: "dept-1", name: "Engineering", type: "department" }],
    );

    const mockProvider = { name: "anthropic", chat: vi.fn(() => createMockStream(extractedJson)) };
    mockGetProviderApiKey.mockResolvedValue("test-api-key");
    mockCreateProvider.mockReturnValue(mockProvider);

    const service = extractionService(db as any);
    await service.extractFromDiscussionEntry("company-1", "entry-1");

    expect(mockCreateProvider).toHaveBeenCalledWith("anthropic", "test-api-key");
    expect(mockProvider.chat).toHaveBeenCalledTimes(1);

    const itemInserts = capturedInserts.filter((i) => i.table === "discussion_extracted_items");
    expect(itemInserts.length).toBe(1);
    expect(itemInserts[0].values).toHaveLength(2);
    expect(itemInserts[0].values[0].title).toBe("Build onboarding flow");
    expect(itemInserts[0].values[1].title).toBe("Use TypeScript strict mode");

    const runInserts = capturedInserts.filter((i) => i.table === "internal_agent_runs");
    expect(runInserts.length).toBe(1);
    expect(runInserts[0].values.triggerSource).toBe("discussion_entry");

    const statusUpdates = capturedUpdates.filter((u) => u.table === "discussion_entries");
    const completedUpdate = statusUpdates.find((u) => u.set.extractionStatus === "completed");
    expect(completedUpdate).toBeDefined();

    expect(mockPublishLiveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        type: "discussion.extraction.completed",
      }),
    );
  });

  it("falls back to legacy extraction when agent not configured", async () => {
    const { db, selectQueue, capturedInserts, capturedUpdates } = createMockDb();

    const extractedJson = JSON.stringify([
      { type: "task", title: "Build onboarding flow", description: "User onboarding", priority: "medium" },
    ]);

    // Queue: 1) entry, 2) discussion, 3) internalAgentConfig (empty), 4) previous entries, 5) departments
    selectQueue.push(
      [createMockEntry()],
      [createMockDiscussion()],
      [],  // no internalAgentConfig
      [],  // previous entries
      [],  // departments
    );

    // Ensure callLLM falls through DB key lookup to env var fallback
    mockGetProviderApiKey.mockRejectedValue(new Error("not found"));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: extractedJson } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    process.env.OPENAI_API_KEY = "test-legacy-key";

    const service = extractionService(db as any);
    await service.extractFromDiscussionEntry("company-1", "entry-1");

    expect(mockFetch).toHaveBeenCalled();
    expect(mockCreateProvider).not.toHaveBeenCalled();

    const itemInserts = capturedInserts.filter((i) => i.table === "discussion_extracted_items");
    expect(itemInserts.length).toBe(1);

    const runInserts = capturedInserts.filter((i) => i.table === "internal_agent_runs");
    expect(runInserts.length).toBe(0);

    const completedUpdate = capturedUpdates.find(
      (u) => u.table === "discussion_entries" && u.set.extractionStatus === "completed",
    );
    expect(completedUpdate).toBeDefined();

    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("transitions status: pending → processing → completed", async () => {
    const { db, selectQueue, capturedUpdates } = createMockDb();

    // Queue: 1) entry, 2) discussion, 3) internalAgentConfig, 4) previous entries, 5) departments
    selectQueue.push(
      [createMockEntry()],
      [createMockDiscussion()],
      [{ id: "cfg-1", companyId: "company-1", provider: "openai", model: "gpt-4o" }],
      [],
      [],
    );

    const mockProvider = {
      name: "openai",
      chat: vi.fn(() => createMockStream(JSON.stringify([]))),
    };
    mockGetProviderApiKey.mockResolvedValue("test-key");
    mockCreateProvider.mockReturnValue(mockProvider);

    const service = extractionService(db as any);
    await service.extractFromDiscussionEntry("company-1", "entry-1");

    const entryUpdates = capturedUpdates.filter((u) => u.table === "discussion_entries");
    expect(entryUpdates.length).toBeGreaterThanOrEqual(2);
    expect(entryUpdates[0].set.extractionStatus).toBe("processing");
    const completedUpdate = entryUpdates.find((u) => u.set.extractionStatus === "completed");
    expect(completedUpdate).toBeDefined();
  });

  it("transitions to failed status on error", async () => {
    const { db, selectQueue, capturedUpdates } = createMockDb();

    // Queue: 1) entry, 2) discussion, 3) internalAgentConfig, 4) previous entries, 5) departments
    selectQueue.push(
      [createMockEntry()],
      [createMockDiscussion()],
      [{ id: "cfg-1", companyId: "company-1", provider: "anthropic", model: "claude-sonnet-4-6" }],
      [],
      [],
    );

    // Pre-check succeeds, but actual extraction call fails
    mockGetProviderApiKey
      .mockResolvedValueOnce("test-api-key")
      .mockRejectedValueOnce(new Error("No API key"));

    const service = extractionService(db as any);
    await service.extractFromDiscussionEntry("company-1", "entry-1");

    const entryUpdates = capturedUpdates.filter((u) => u.table === "discussion_entries");
    expect(entryUpdates[0].set.extractionStatus).toBe("processing");
    const failedUpdate = entryUpdates.find((u) => u.set.extractionStatus === "failed");
    expect(failedUpdate).toBeDefined();

    expect(mockPublishLiveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        type: "discussion.extraction.failed",
      }),
    );
  });
});
