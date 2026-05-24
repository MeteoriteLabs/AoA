/**
 * threads-mention.test.ts
 * TDD: Task 1 — @mention parsing + agent wakeup / human notification dispatch
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must come before imports that use them) ──────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => ({ eq: [a, b] })),
}));

vi.mock("@armyofagents/db", () => ({
  agents: {
    id: "agents_id",
    companyId: "agents_company_id",
    name: "agents_name",
    slug: "agents_slug",
  },
  authUsers: {
    id: "auth_id",
    companyId: "auth_company_id",
    name: "auth_name",
    email: "auth_email",
  },
  agentWakeupRequests: {
    id: "awr_id",
    companyId: "awr_company_id",
    agentId: "awr_agent_id",
    source: "awr_source",
    triggerDetail: "awr_trigger_detail",
    reason: "awr_reason",
    payload: "awr_payload",
    status: "awr_status",
    requestedByActorType: "awr_requested_by_actor_type",
    requestedByActorId: "awr_requested_by_actor_id",
  },
  notifications: {
    id: "n_id",
    companyId: "n_company_id",
    userId: "n_user_id",
    type: "n_type",
    title: "n_title",
    message: "n_message",
    relatedEntityType: "n_related_entity_type",
    relatedEntityId: "n_related_entity_id",
  },
}));

// Import the pure function (no DB) directly
import { parseMentions, processMentions } from "../services/threads.js";

// ── parseMentions ─────────────────────────────────────────────────────────────

describe("parseMentions", () => {
  it("extracts a single @mention from text", () => {
    expect(parseMentions("Hello @alice")).toEqual([{ raw: "@alice", name: "alice" }]);
  });

  it("extracts multiple @mentions from text", () => {
    const result = parseMentions("Hello @alice and @Bot");
    expect(result).toEqual([
      { raw: "@alice", name: "alice" },
      { raw: "@Bot", name: "Bot" },
    ]);
  });

  it("returns empty array when no mentions", () => {
    expect(parseMentions("No mentions here")).toEqual([]);
    expect(parseMentions("")).toEqual([]);
  });

  it("deduplicates repeated mentions", () => {
    const result = parseMentions("@alice and @alice again");
    // alice appears twice — deduped to one
    expect(result.filter((m) => m.name === "alice").length).toBe(1);
  });

  it("ignores email-style @ (mentions must be standalone word)", () => {
    // user@example.com should not extract "example" as a mention
    const result = parseMentions("Email user@example.com here");
    // "@example" is preceded by "user" not whitespace/start — should not match
    const names = result.map((m) => m.name);
    expect(names).not.toContain("example");
  });

  it("handles mention at start of string", () => {
    const result = parseMentions("@Bot please help");
    expect(result).toEqual([{ raw: "@Bot", name: "Bot" }]);
  });
});

// ── processMentions ────────────────────────────────────────────────────────────

describe("processMentions (dispatch)", () => {
  function makeMockDb({
    agentRow,
    authRow,
  }: {
    agentRow?: any;
    authRow?: any;
  }) {
    const insertValues = vi.fn().mockReturnThis();
    const insertChain = { values: insertValues };

    // We use a queue for the select calls
    const selectQueue: any[][] = [
      // First select: agent lookup
      agentRow ? [agentRow] : [],
      // Second select: user lookup (if no agent found)
      authRow ? [authRow] : [],
    ];
    let selectIdx = 0;

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: vi.fn((fn: (rows: any[]) => any) =>
        Promise.resolve(fn(selectQueue[selectIdx++] ?? [])),
      ),
    };

    return {
      db: {
        select: vi.fn(() => selectChain),
        insert: vi.fn(() => insertChain),
      } as any,
      insertValues,
    };
  }

  beforeEach(() => vi.clearAllMocks());

  it("creates an agent_wakeup_requests row when mention resolves to an agent", async () => {
    const { db, insertValues } = makeMockDb({
      agentRow: { id: "agent-1", name: "Bot", slug: "bot" },
    });

    await processMentions(
      db,
      "company-1",
      "thread-1",
      "entry-1",
      [{ raw: "@Bot", name: "Bot" }],
    );

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        agentId: "agent-1",
        source: "thread_mention",
      }),
    );
  });

  it("creates a notifications row when mention resolves to a human user", async () => {
    const { db, insertValues } = makeMockDb({
      agentRow: null, // no agent with that name
      authRow: { id: "user-1", name: "alice" },
    });

    await processMentions(
      db,
      "company-1",
      "thread-1",
      "entry-1",
      [{ raw: "@alice", name: "alice" }],
    );

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        userId: "user-1",
        type: "thread.mention",
      }),
    );
  });

  it("skips mentions that resolve to neither agent nor user", async () => {
    const { db, insertValues } = makeMockDb({
      agentRow: null,
      authRow: null,
    });

    await processMentions(
      db,
      "company-1",
      "thread-1",
      "entry-1",
      [{ raw: "@unknown", name: "unknown" }],
    );

    expect(insertValues).not.toHaveBeenCalled();
  });

  it("handles multiple mentions in one call", async () => {
    // We need a mock db that returns two different results for agent lookups
    const insertValues = vi.fn().mockReturnThis();
    const insertChain = { values: insertValues };

    const agentRows = [
      [{ id: "agent-1", name: "Bot" }], // first mention → agent
      [], // second mention → no agent
    ];
    const authRows = [
      [], // no auth for first (already resolved as agent)
      [{ id: "user-2", name: "alice" }], // auth for second
    ];
    // selectQueue interleaves agent+auth lookups per mention
    const selectQueue = [
      agentRows[0], // @Bot → agent lookup
      // no auth lookup needed since agent found
      agentRows[1], // @alice → agent lookup (not found)
      authRows[1], // @alice → user lookup (found)
    ];
    let idx = 0;
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: vi.fn((fn: (rows: any[]) => any) =>
        Promise.resolve(fn(selectQueue[idx++] ?? [])),
      ),
    };
    const db = {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
    } as any;

    await processMentions(
      db,
      "company-1",
      "thread-1",
      "entry-1",
      [
        { raw: "@Bot", name: "Bot" },
        { raw: "@alice", name: "alice" },
      ],
    );

    expect(db.insert).toHaveBeenCalledTimes(2);
  });
});
