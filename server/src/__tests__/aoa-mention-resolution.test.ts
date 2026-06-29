// Milestone B1: @mention resolution must include kind='aoa' agents so that
// AoA agents (e.g. Commander sub-agents) are mentionable in task comments.
// kind='platform' stays excluded by design.
//
// Contract test (proxy-table + hoisted-mock harness, per
// agents-list-excludes-platform.test.ts).  Windows-runnable.
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above top-level consts, so mock fns we also assert on
// must be created via vi.hoisted (vitest-sanctioned pattern).
const { inArrayMock, andMock, eqMock } = vi.hoisted(() => ({
  inArrayMock: vi.fn((col: unknown, vals: unknown) => ({ inArray: [col, vals] })),
  andMock: vi.fn((...a: unknown[]) => ({ and: a })),
  eqMock: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}));

vi.mock("drizzle-orm", () => ({
  and: andMock,
  eq: eqMock,
  inArray: inArrayMock,
  asc: vi.fn((c: unknown) => ({ asc: c })),
  desc: vi.fn((c: unknown) => ({ desc: c })),
  isNull: vi.fn((c: unknown) => ({ isNull: c })),
  or: vi.fn((...a: unknown[]) => ({ or: a })),
  sql: vi.fn((s: unknown, ...v: unknown[]) => { const o: any = { sql: s, v }; o.as = () => o; return o; }),
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") return Symbol(`${name}.${prop}`);
        return undefined;
      },
    });
  // Exactly the tables issues.ts imports (lines 3-24 of issues.ts).
  return {
    activityLog: makeTable("activity_log"),
    agents: makeTable("agents"),
    assets: makeTable("assets"),
    authUsers: makeTable("auth_users"),
    companies: makeTable("companies"),
    companyMemberships: makeTable("company_memberships"),
    executionWorkspaces: makeTable("execution_workspaces"),
    goals: makeTable("goals"),
    heartbeatRuns: makeTable("heartbeat_runs"),
    issueAttachments: makeTable("issue_attachments"),
    issueLabels: makeTable("issue_labels"),
    issueComments: makeTable("issue_comments"),
    issueMonitors: makeTable("issue_monitors"),
    issueReadStates: makeTable("issue_read_states"),
    issues: makeTable("issues"),
    labels: makeTable("labels"),
    projectWorkspaces: makeTable("project_workspaces"),
    projects: makeTable("projects"),
    taskDependencies: makeTable("task_dependencies"),
    userRoles: makeTable("user_roles"),
    // Required by services/embeddings.ts (B1: createEmbeddingService target map)
    memoryItems: makeTable("memory_items"),
    discussions: makeTable("discussions"),
    discussionExtractedItems: makeTable("discussion_extracted_items"),
    embeddingQueue: makeTable("embedding_queue"),
  };
});

vi.mock("@armyofagents/shared", () => ({
  extractProjectMentionIds: vi.fn(() => []),
}));

// issues.ts now imports hub-items.ts (W1a Task 10); mock it so the real module
// (and its @armyofagents/shared imports) never load — this suite tests mention
// resolution, not the emit path.
vi.mock("../services/hub-items.js", () => ({
  hubItemsService: vi.fn(() => ({ emit: vi.fn(async () => ({ id: "hub-1" })) })),
}));

vi.mock("../errors.js", () => ({
  conflict: (m: string) => new Error(m),
  notFound: (m: string) => new Error(m),
  unprocessable: (m: string) => new Error(m),
}));

vi.mock("../middleware/logger.js", () => {
  function makeLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => makeLogger();
    return l;
  }
  return { logger: makeLogger() };
});

vi.mock("./dependencies.js", () => ({
  dependencyService: vi.fn(() => ({})),
}));

vi.mock("./heartbeat.js", () => ({
  heartbeatService: vi.fn(() => ({})),
}));

vi.mock("./instance-settings.js", () => ({
  instanceSettingsService: vi.fn(() => ({})),
}));

vi.mock("./issue-user-context.js", () => ({
  deriveIssueUserContext: vi.fn(() => ({})),
}));

vi.mock("./execution-workspace-policy.js", () => ({
  issueExecutionWorkspaceModeForPersistedWorkspace: vi.fn(() => "none"),
}));

vi.mock("./notifications.js", () => ({
  notificationService: vi.fn(() => ({})),
}));

vi.mock("../routes/issues-planning-mode-dispatch.js", () => ({
  shouldDispatchIssueWakeup: vi.fn(() => true),
}));

vi.mock("./issue-execution-policy.js", () => ({
  buildInitialIssueMonitorFields: vi.fn(() => ({})),
  buildIssueMonitorClearedPatch: vi.fn(() => ({})),
  normalizeIssueMonitorPolicy: vi.fn((p: unknown) => p),
}));

import { issueService } from "../services/issues.js";

// A chain that returns an empty array so findMentionedAgents doesn't error.
function makeSelectChain(rows: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "leftJoin", "innerJoin"]) {
    chain[m] = (..._a: unknown[]) => chain;
  }
  chain.then = (resolve: (v: unknown[]) => unknown) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

describe("findMentionedAgents resolves kind='aoa' agents (B1 contract)", () => {
  beforeEach(() => {
    inArrayMock.mockClear();
    andMock.mockClear();
    eqMock.mockClear();
  });

  it("calls inArray(agents.kind, ['org','aoa']) — not eq(agents.kind,'org')", async () => {
    const db: any = {
      select: () => makeSelectChain([]),
    };
    const svc = issueService(db);
    // Body must contain an @-mention so findMentionedAgents doesn't short-circuit.
    await svc.findMentionedAgents("co-1", "ping @SomeAgent please");

    // inArray must have been called with a second arg that includes both kinds.
    const inArrayCall = inArrayMock.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).includes("org") && (c[1] as string[]).includes("aoa")
    );
    expect(
      inArrayCall,
      "Expected inArray(agents.kind, [...'org'...'aoa'...]) to be called"
    ).toBeTruthy();

    // eq must NOT have been called with "org" as the kind value for this query.
    const eqKindOrgCall = eqMock.mock.calls.some((c) => c[1] === "org");
    expect(
      eqKindOrgCall,
      "eq(agents.kind, 'org') should not be called — that was the old pre-B1 predicate"
    ).toBe(false);
  });
});
