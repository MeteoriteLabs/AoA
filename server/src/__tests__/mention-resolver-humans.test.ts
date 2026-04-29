import { describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((c: unknown) => ({ asc: c })),
  desc: vi.fn((c: unknown) => ({ desc: c })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  inArray: vi.fn((c: unknown, v: unknown) => ({ inArray: [c, v] })),
  isNull: vi.fn((c: unknown) => ({ isNull: c })),
  or: vi.fn((...args: unknown[]) => ({ or: args })),
  sql: vi.fn(() => ({ sql: true })),
}));

vi.mock("@armyofagents/db", () => ({
  // Tables accessed by issues.ts — stubs are sufficient because the mock DB
  // intercepts all method calls before drizzle interacts with them.
  activityLog: {},
  agents: { id: "agents_id", name: "agents_name", companyId: "agents_company_id" },
  assets: {},
  authUsers: { id: "auth_users_id", name: "auth_users_name" },
  companies: {},
  companyMemberships: {},
  executionWorkspaces: {},
  goals: {},
  heartbeatRuns: {},
  issueAttachments: {},
  issueLabels: {},
  issueComments: {},
  issueReadStates: {},
  issues: {},
  labels: {},
  projectWorkspaces: {},
  projects: {},
  taskDependencies: {},
  userRoles: { userId: "user_roles_user_id", companyId: "user_roles_company_id" },
}));

vi.mock("@armyofagents/shared", () => ({
  extractProjectMentionIds: vi.fn(() => []),
}));

vi.mock("../errors.js", () => ({
  conflict: (msg: string) => Object.assign(new Error(msg), { status: 409 }),
  notFound: (msg: string) => Object.assign(new Error(msg), { status: 404 }),
  unprocessable: (msg: string) => Object.assign(new Error(msg), { status: 422 }),
}));

vi.mock("../services/dependencies.js", () => ({
  dependencyService: vi.fn(() => ({})),
}));
vi.mock("../services/heartbeat.js", () => ({
  heartbeatService: vi.fn(() => ({})),
}));
vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: vi.fn(() => ({})),
}));
vi.mock("../services/issue-user-context.js", () => ({
  deriveIssueUserContext: vi.fn(),
}));
vi.mock("../services/execution-workspace-policy.js", () => ({
  issueExecutionWorkspaceModeForPersistedWorkspace: vi.fn(),
}));

import { issueService } from "../services/issues.js";

// ── Hand-rolled mock DB for innerJoin chain ──────────────────────────────────
//
// The query path is:
//   db.select({...}).from(authUsers).innerJoin(userRoles, ...).where(...)
//
// This is a single-query helper — a hand-rolled chain is more readable than
// the sequence-based factory and keeps each test explicit + self-contained.

function makeUsersDb(rows: Array<{ id: string; name: string }>) {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(rows),
        }),
      }),
    }),
  } as never;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("issueService.findMentionedHumans", () => {
  it("matches @alice and @bob in body", async () => {
    const db = makeUsersDb([
      { id: "u1", name: "alice" },
      { id: "u2", name: "bob" },
    ]);
    const result = await issueService(db).findMentionedHumans(
      "co-1",
      "hey @alice and @bob can you look at this",
    );
    expect(result.sort()).toEqual(["u1", "u2"]);
  });

  it("returns empty array when body has no @-mentions", async () => {
    const db = makeUsersDb([
      { id: "u1", name: "alice" },
      { id: "u2", name: "bob" },
    ]);
    const result = await issueService(db).findMentionedHumans(
      "co-1",
      "no mentions here at all",
    );
    expect(result).toEqual([]);
  });

  it("strips -h suffix to disambiguate human from agent of the same name", async () => {
    const db = makeUsersDb([{ id: "u1", name: "alice" }]);
    const result = await issueService(db).findMentionedHumans(
      "co-1",
      "@alice-h please review",
    );
    expect(result).toEqual(["u1"]);
  });

  it("filters out users whose names are not mentioned", async () => {
    const db = makeUsersDb([
      { id: "u1", name: "alice" },
      { id: "u2", name: "bob" },
      { id: "u3", name: "charlie" },
    ]);
    const result = await issueService(db).findMentionedHumans(
      "co-1",
      "hi @alice",
    );
    expect(result).toEqual(["u1"]);
  });

  it("stops at trailing punctuation in mentions", async () => {
    const db = makeUsersDb([
      { id: "u1", name: "alice" },
      { id: "u2", name: "bob" },
      { id: "u3", name: "charlie" },
    ]);
    const result = await issueService(db).findMentionedHumans(
      "co-1",
      "thanks @alice. cc @bob, also @charlie!",
    );
    expect(result.sort()).toEqual(["u1", "u2", "u3"]);
  });

  it("matches case-insensitively against authUsers.name", async () => {
    const db = makeUsersDb([{ id: "u1", name: "Alice" }]);
    const result = await issueService(db).findMentionedHumans("c1", "ping @ALICE");
    expect(result).toEqual(["u1"]);
  });

  it("returns unique user IDs even when a user has multiple userRoles entries", async () => {
    // Simulate the join returning the same user 3 times (one per project role)
    const db = makeUsersDb([
      { id: "u1", name: "alice" },
      { id: "u1", name: "alice" },
      { id: "u1", name: "alice" },
    ]);
    const result = await issueService(db).findMentionedHumans("c1", "@alice");
    expect(result).toEqual(["u1"]);
  });

  it("deduplicates the same @-token mentioned twice in body", async () => {
    const db = makeUsersDb([{ id: "u1", name: "alice" }]);
    const result = await issueService(db).findMentionedHumans("c1", "@alice please review @alice");
    expect(result).toEqual(["u1"]);
  });

  it("stops cleanly at trailing punctuation like ; : ) ]", async () => {
    const db = makeUsersDb([
      { id: "u1", name: "alice" },
      { id: "u2", name: "bob" },
      { id: "u3", name: "charlie" },
    ]);
    const body = "ping @alice; cc @bob: also (@charlie)";
    const result = await issueService(db).findMentionedHumans("c1", body);
    expect(result.sort()).toEqual(["u1", "u2", "u3"]);
  });
});
