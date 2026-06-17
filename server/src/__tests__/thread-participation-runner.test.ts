/**
 * thread-participation-runner — unit tests (Phase 2 / Task 2.1).
 *
 * `makeThreadParticipationRunner(db)` returns a `ParticipantRunner` that:
 *   1. Resolves the thread's company + thread-level autonomy from `discussions`.
 *   2. Resolves the company-level autonomy fallback from `internal_agent_config`.
 *   3. Resolves the crew role for the agent (resolveCrewRole — same path the
 *      dispatcher uses) so the trigger prompt is role-aware.
 *   4. Invokes `runAoaAgent(db, agentId, { companyId, source:"thread.participation",
 *      threadId, mention: prompt, effectiveAutonomy, role })`.
 *   5. Returns `""` (empty) — the agent SELF-POSTS its reply via the `post_entry`
 *      MCP tool DURING its run. `requestParticipation` skips its own entry-insert
 *      on the empty return, so there is NO double-post.
 *
 * This mirrors `controller-adjutant-runner.test.ts` (Proxy-table-stub +
 * sequence-db pattern; runner.js + resolve-crew-role.js module-mocked so no
 * real CLI spawn and no aoaAgentTriggers read).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── drizzle-orm mock ──────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  ne: vi.fn((a: unknown, b: unknown) => ({ ne: [a, b] })),
}));

// ── @armyofagents/db mock ─────────────────────────────────────────────────────
function tableProxy(name: string) {
  return new Proxy({}, { get(_t, prop) { return `${name}_${String(prop)}`; } });
}

vi.mock("@armyofagents/db", () => ({
  discussionEntries: tableProxy("discussionEntries"),
  discussions: tableProxy("discussions"),
  internalAgentConfig: tableProxy("internalAgentConfig"),
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

// ── runner.ts mock — we never want a real CLI spawn ──────────────────────────
// The default value path dynamic-imports runner.js; tests inject deps.runAgent
// and never hit it, but mock it anyway so the transitive heavy subtree
// (embeddings, ~40 tool modules) is never resolved against the partial db mock.
const { mockRunAoaAgent } = vi.hoisted(() => ({ mockRunAoaAgent: vi.fn() }));
vi.mock(
  "../services/internal-agent/aoa-agents/runner.js",
  () => ({ runAoaAgent: mockRunAoaAgent }),
);

// ── resolve-crew-role.ts mock ─────────────────────────────────────────────────
// The runner resolves the agent's crew role so the trigger prompt is role-aware.
// Module-mock it so the test controls the resolved role without an
// aoaAgentTriggers read.
const { mockResolveCrewRole } = vi.hoisted(() => ({ mockResolveCrewRole: vi.fn() }));
vi.mock(
  "../services/internal-agent/aoa-agents/resolve-crew-role.js",
  () => ({ resolveCrewRole: mockResolveCrewRole }),
);

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { makeThreadParticipationRunner } from "../services/internal-agent/aoa-agents/thread-participation-runner.js";

// ── DB builder helpers ────────────────────────────────────────────────────────

/**
 * Build a minimal stub db.
 * The runner does:
 *   select 1: discussions (returns threadRow or [])           — .limit()
 *   select 2: internalAgentConfig (returns companyCfgRow or []) — .limit()
 * resolveCrewRole is module-mocked so it does NOT touch this db.
 */
function makeDb(opts: {
  threadRow?: Record<string, unknown> | null;
  companyCfgRow?: Record<string, unknown> | null;
  beforeEntryRows?: Array<Record<string, unknown>>;
  afterEntryRows?: Array<Record<string, unknown>>;
}) {
  const {
    threadRow = null,
    companyCfgRow = null,
    beforeEntryRows = [],
    afterEntryRows = [{ id: "agent-entry-posted" }],
  } = opts;

  const results: Array<Array<Record<string, unknown>>> = [
    threadRow ? [threadRow] : [],
    companyCfgRow ? [companyCfgRow] : [],
    beforeEntryRows,
    afterEntryRows,
  ];
  let callIdx = 0;

  const db = {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(() => {
        const row = results[callIdx] ?? [];
        callIdx++;
        return Promise.resolve(row);
      }),
    })),
  };

  return db;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("makeThreadParticipationRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAoaAgent.mockReset();
    mockResolveCrewRole.mockReset();
  });

  it("1: calls runAoaAgent with thread.participation payload and returns \"\" (agent self-posts)", async () => {
    mockRunAoaAgent.mockResolvedValue({ status: "succeeded" });
    mockResolveCrewRole.mockResolvedValue("scout");

    const db = makeDb({
      threadRow: { companyId: "company-abc", autonomyLevel: 2 },
      companyCfgRow: { autonomyLevel: 0 },
    });

    const runner = makeThreadParticipationRunner(db as any);
    const reply = await runner({
      threadId: "thread-42",
      agentId: "agent-scout-1",
      prompt: "@Scout what do you see?",
    });

    // Payload assertion — effectiveAutonomy resolves thread(2) ?? company(0) → 2.
    expect(mockRunAoaAgent).toHaveBeenCalledOnce();
    expect(mockRunAoaAgent).toHaveBeenCalledWith(
      db,
      "agent-scout-1",
      {
        companyId: "company-abc",
        source: "thread.participation",
        threadId: "thread-42",
        mention: "@Scout what do you see?",
        effectiveAutonomy: 2,
        role: "scout",
      },
    );

    // CRITICAL: the runner returns "" so requestParticipation skips its insert
    // (the agent already self-posted via post_entry). No double-post.
    expect(reply).toBe("");
  });

  it("2: effectiveAutonomy falls back to company autonomyLevel when thread.autonomyLevel is null", async () => {
    mockRunAoaAgent.mockResolvedValue({ status: "succeeded" });
    mockResolveCrewRole.mockResolvedValue("engineer");

    const db = makeDb({
      threadRow: { companyId: "company-l1", autonomyLevel: null },
      companyCfgRow: { autonomyLevel: 1 },
    });

    const runner = makeThreadParticipationRunner(db as any);
    await runner({ threadId: "thread-l1", agentId: "agent-eng-1", prompt: "ship it" });

    expect(mockRunAoaAgent).toHaveBeenCalledOnce();
    const payload = mockRunAoaAgent.mock.calls[0][2];
    expect(payload.effectiveAutonomy).toBe(1);
  });

  it("3: effectiveAutonomy defaults to 0 when neither thread nor company config sets it", async () => {
    mockRunAoaAgent.mockResolvedValue({ status: "succeeded" });
    mockResolveCrewRole.mockResolvedValue("planner");

    const db = makeDb({
      threadRow: { companyId: "company-x", autonomyLevel: null },
      companyCfgRow: null, // no internal_agent_config row
    });

    const runner = makeThreadParticipationRunner(db as any);
    await runner({ threadId: "thread-x", agentId: "agent-planner-1", prompt: "plan" });

    const payload = mockRunAoaAgent.mock.calls[0][2];
    expect(payload.effectiveAutonomy).toBe(0);
  });

  it("4: passes the resolved crew role through so the trigger prompt is role-aware", async () => {
    mockRunAoaAgent.mockResolvedValue({ status: "succeeded" });
    mockResolveCrewRole.mockResolvedValue("engineer");

    const db = makeDb({
      threadRow: { companyId: "company-role", autonomyLevel: 2 },
      companyCfgRow: { autonomyLevel: 0 },
    });

    const runner = makeThreadParticipationRunner(db as any);
    await runner({ threadId: "thread-role", agentId: "agent-eng-2", prompt: "@Engineer build" });

    expect(mockResolveCrewRole).toHaveBeenCalledWith(db, "agent-eng-2");
    const payload = mockRunAoaAgent.mock.calls[0][2];
    expect(payload.role).toBe("engineer");
  });

  it("5: role is undefined (omitted) when resolveCrewRole returns null — payload still valid", async () => {
    mockRunAoaAgent.mockResolvedValue({ status: "succeeded" });
    mockResolveCrewRole.mockResolvedValue(null);

    const db = makeDb({
      threadRow: { companyId: "company-norole", autonomyLevel: 2 },
      companyCfgRow: { autonomyLevel: 0 },
    });

    const runner = makeThreadParticipationRunner(db as any);
    const reply = await runner({ threadId: "thread-norole", agentId: "agent-unknown", prompt: "hi" });

    expect(mockRunAoaAgent).toHaveBeenCalledOnce();
    const payload = mockRunAoaAgent.mock.calls[0][2];
    // null role → the field is omitted (undefined), not literal null, so the
    // prompt builder's `typeof payload.role === "string"` check skips it cleanly.
    expect(payload.role).toBeUndefined();
    expect(reply).toBe("");
  });

  it("6: returns \"\" even when the underlying run fails (the agent owns its own posting)", async () => {
    // Whatever the run status, the runner returns "" — requestParticipation must
    // not synthesize an entry. A failed run that posted nothing is fine; a stray
    // empty entry would be worse (it pollutes the chat).
    mockRunAoaAgent.mockResolvedValue({ status: "failed", errorMessage: "cli exited 1" });
    mockResolveCrewRole.mockResolvedValue("scout");

    const db = makeDb({
      threadRow: { companyId: "company-fail", autonomyLevel: 1 },
      companyCfgRow: { autonomyLevel: 0 },
    });

    const runner = makeThreadParticipationRunner(db as any);
    const reply = await runner({ threadId: "thread-fail", agentId: "agent-scout-f", prompt: "go" });

    expect(reply).toBe("");
  });

  it("7: throws when a successful run does not create an agent-authored post_entry", async () => {
    mockRunAoaAgent.mockResolvedValue({ status: "succeeded" });
    mockResolveCrewRole.mockResolvedValue("adjutant");

    const db = makeDb({
      threadRow: { companyId: "company-no-post", autonomyLevel: 1 },
      companyCfgRow: { autonomyLevel: 0 },
      beforeEntryRows: [{ id: "old-entry" }],
      afterEntryRows: [{ id: "old-entry" }],
    });

    const runner = makeThreadParticipationRunner(db as any);
    await expect(
      runner({ threadId: "thread-no-post", agentId: "agent-adj", prompt: "@Adjutant respond" }),
    ).rejects.toThrow(/without an agent-authored post_entry/i);
  });

  it("8: throws when the thread is not found (caller surfaces the error)", async () => {
    mockResolveCrewRole.mockResolvedValue("scout");
    const db = makeDb({ threadRow: null });

    const runner = makeThreadParticipationRunner(db as any);
    await expect(
      runner({ threadId: "thread-missing", agentId: "agent-x", prompt: "hi" }),
    ).rejects.toThrow(/thread not found/i);

    expect(mockRunAoaAgent).not.toHaveBeenCalled();
  });
});
