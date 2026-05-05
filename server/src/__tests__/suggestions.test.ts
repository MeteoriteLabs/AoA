import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIssueCreate = vi.fn();
const mockMemoryCreate = vi.fn();
const mockFeedbackRunAllDetectors = vi.fn();

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
    agents: makeTable("agents"),
    companies: makeTable("companies"),
    goals: makeTable("goals"),
    issues: makeTable("issues"),
    memoryFeedbackPatterns: makeTable("memory_feedback_patterns"),
    memoryItems: makeTable("memory_items"),
    projects: makeTable("projects"),
    suggestions: makeTable("suggestions"),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  desc: (..._args: unknown[]) => "desc",
  eq: (..._args: unknown[]) => "eq",
  inArray: (..._args: unknown[]) => "inArray",
  isNull: (..._args: unknown[]) => "isNull",
  lt: (..._args: unknown[]) => "lt",
  notInArray: (..._args: unknown[]) => "notInArray",
  or: (..._args: unknown[]) => "or",
  sql: new Proxy(() => "sql", { get: () => () => "sql", apply: () => "sql" }),
}));

vi.mock("../services/issues.js", () => ({
  issueService: () => ({
    create: mockIssueCreate,
  }),
}));

vi.mock("../services/memory.js", () => ({
  memoryService: () => ({
    create: mockMemoryCreate,
  }),
}));

vi.mock("../services/memory-feedback.js", () => ({
  memoryFeedbackService: () => ({
    runAllDetectors: mockFeedbackRunAllDetectors,
  }),
}));

import { suggestionService } from "../services/suggestions.js";

type MockRow = Record<string, unknown>;

function createSequenceDb(config: {
  selects?: MockRow[][];
  inserts?: MockRow[][];
  updates?: MockRow[][];
} = {}) {
  let selectIdx = 0;
  let insertIdx = 0;
  let updateIdx = 0;
  const insertValues: unknown[] = [];

  function makeChain(getResult: () => MockRow[]) {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "groupBy", "orderBy", "limit", "values", "set", "returning"]) {
      chain[method] = (...args: unknown[]) => {
        if (method === "values") insertValues.push(args[0]);
        return chain;
      };
    }
    chain.then = (resolve: (value: MockRow[]) => unknown) => Promise.resolve(resolve(getResult()));
    return chain;
  }

  const db = {
    select: (..._args: unknown[]) => makeChain(() => config.selects?.[selectIdx++] ?? []),
    insert: (..._args: unknown[]) => makeChain(() => config.inserts?.[insertIdx++] ?? []),
    update: (..._args: unknown[]) => makeChain(() => config.updates?.[updateIdx++] ?? []),
    transaction: async (callback: (tx: any) => unknown) => callback(db),
    __insertValues: insertValues,
  };

  return db;
}

describe("suggestionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeedbackRunAllDetectors.mockResolvedValue({ patternsCreated: 0, suggestionsCreated: 0 });
    mockIssueCreate.mockResolvedValue({ id: "issue-created" });
    mockMemoryCreate.mockResolvedValue({ id: "memory-created" });
  });

  it("detects memory gaps for departments with no domain items", async () => {
    const db = createSequenceDb({
      selects: [
        [{ id: "dept-1", name: "Engineering" }],
        [],
        [{ id: "identity-1" }],
        [],
        [],
      ],
    });

    const svc = suggestionService(db as any);
    const result = await svc.detectMemoryGaps("co-1");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: "memory_gap",
      actionType: "suggest_memory",
      title: "No domain memory exists for Engineering",
    });
  });

  it("detects patterns when feedback reaches three occurrences", async () => {
    const db = createSequenceDb({
      selects: [
        [
          {
            id: "pattern-1",
            patternType: "tone_correction",
            occurrenceCount: 4,
            sourceAgentId: "agent-1",
          },
        ],
        [{ id: "agent-1", name: "Writer" }],
      ],
    });

    const svc = suggestionService(db as any);
    const result = await svc.detectPatternDetected("co-1");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: "pattern_detected",
      actionType: "suggest_memory",
    });
    expect(result[0].title).toContain("4 times");
  });

  it("does not create duplicate pending suggestions", async () => {
    const db = createSequenceDb({
      selects: [[{ category: "goal_gap", actionPayload: { goalId: "goal-1" } }]],
    });

    const svc = suggestionService(db as any);
    vi.spyOn(svc, "detectGoalGaps").mockResolvedValue([
      {
        category: "goal_gap",
        actionType: "create_task",
        title: "gap",
        evidence: null,
        actionPayload: { goalId: "goal-1" },
      },
    ] as any);
    vi.spyOn(svc, "detectPipelineBottlenecks").mockResolvedValue([]);
    vi.spyOn(svc, "detectMemoryGaps").mockResolvedValue([]);
    vi.spyOn(svc, "detectPatternDetected").mockResolvedValue([]);
    vi.spyOn(svc, "detectBudgetOptimization").mockResolvedValue([]);
    vi.spyOn(svc, "detectRecurringWork").mockResolvedValue([]);
    vi.spyOn(svc, "detectRiskFlags").mockResolvedValue([]);
    vi.spyOn(svc, "detectWorkloadBalance").mockResolvedValue([]);

    const result = await svc.runAllDetectors("co-1");

    expect(result).toEqual({ detected: 1, created: 0 });
    expect((db as any).__insertValues).toHaveLength(0);
  });

  it("accept executes create_task payload correctly", async () => {
    const db = createSequenceDb({
      selects: [[
        {
          id: "sug-1",
          companyId: "co-1",
          category: "goal_gap",
          actionType: "create_task",
          actionPayload: { title: "Create kickoff task", priority: "high" },
          title: "gap",
          evidence: null,
          status: "pending",
        },
      ]],
      updates: [[{ id: "sug-1", status: "accepted" }]],
    });

    const svc = suggestionService(db as any);
    const result = await svc.accept("co-1", "sug-1");

    expect(mockIssueCreate).toHaveBeenCalledWith(
      "co-1",
      expect.objectContaining({ title: "Create kickoff task", priority: "high" }),
      expect.anything(),
    );
    expect(result.execution).toEqual({
      actionType: "create_task",
      entityType: "issue",
      entityId: "issue-created",
    });
  });

  it("dismiss updates suggestion status", async () => {
    const db = createSequenceDb({
      selects: [[
        {
          id: "sug-1",
          companyId: "co-1",
          category: "goal_gap",
          actionType: "create_task",
          actionPayload: { title: "x" },
          title: "gap",
          evidence: null,
          status: "pending",
        },
      ]],
      updates: [[{ id: "sug-1", status: "dismissed" }]],
    });

    const svc = suggestionService(db as any);
    const result = await svc.dismiss("co-1", "sug-1");

    expect(result).toEqual({ id: "sug-1", status: "dismissed" });
  });

  it("runAllDetectors aggregates detector output", async () => {
    const db = createSequenceDb({
      selects: [[]],
      inserts: [[]],
    });

    const svc = suggestionService(db as any);
    vi.spyOn(svc, "detectGoalGaps").mockResolvedValue([
      {
        category: "goal_gap",
        actionType: "create_task",
        title: "goal",
        evidence: null,
        actionPayload: { goalId: "goal-1" },
      },
    ] as any);
    vi.spyOn(svc, "detectPipelineBottlenecks").mockResolvedValue([]);
    vi.spyOn(svc, "detectMemoryGaps").mockResolvedValue([
      {
        category: "memory_gap",
        actionType: "suggest_memory",
        title: "memory",
        evidence: null,
        actionPayload: { title: "Guideline", content: "X", category: "reference" },
      },
    ] as any);
    vi.spyOn(svc, "detectPatternDetected").mockResolvedValue([]);
    vi.spyOn(svc, "detectBudgetOptimization").mockResolvedValue([]);
    vi.spyOn(svc, "detectRecurringWork").mockResolvedValue([]);
    vi.spyOn(svc, "detectRiskFlags").mockResolvedValue([]);
    vi.spyOn(svc, "detectWorkloadBalance").mockResolvedValue([]);

    const result = await svc.runAllDetectors("co-1");

    expect(result).toEqual({ detected: 2, created: 2 });
    expect((db as any).__insertValues).toHaveLength(1);
  });

  it("returns empty arrays when detectors have no data", async () => {
    const db = createSequenceDb({
      selects: [[], []],
    });

    const svc = suggestionService(db as any);
    await expect(svc.detectGoalGaps("co-1")).resolves.toEqual([]);
    await expect(svc.detectPatternDetected("co-1")).resolves.toEqual([]);
  });
});
