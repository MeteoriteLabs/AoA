/**
 * crew-context-bundle — unit tests (Phase 4 / Tasks 4.1 + 4.2).
 *
 * `buildCrewContextBundle(db, { companyId, threadId?, issueId?, agentId, tokenBudget? })`
 * assembles the dynamic context a crew agent arrives with so it never "starts
 * blind". It produces ONE markdown string with three sub-sections:
 *
 *   - THREAD (threadId set): the Chronicler summary (if any) + routingTerms,
 *     then the last N=20 entries rendered "<author>: <rawContent>".
 *   - TASK   (issueId set): the task title/description/status/priority, plus
 *     the upstream artifact's current-version body (truncated) when linked.
 *   - MEMORY (both): memoryService(db).searchMultiPath(companyId, queryText,
 *     { limit: 5 }) rendered as a list. MUST degrade gracefully — when the
 *     search throws (embeddings/pgvector absent on this instance) OR returns
 *     [], the memory section is simply omitted and the bundle never crashes.
 *
 * Mirrors the project's service-test conventions (Proxy table stubs, no-op
 * drizzle operators, a sequence-based stub db; memoryService module-mocked).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── drizzle-orm mock (no-op operators) ────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  desc: vi.fn((a: unknown) => ({ desc: a })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ inArray: [a, b] })),
}));

// ── @armyofagents/db mock (table proxies) ─────────────────────────────────────
function tableProxy(name: string) {
  return new Proxy({}, { get(_t, prop) { return `${name}.${String(prop)}`; } });
}
vi.mock("@armyofagents/db", () => ({
  discussionEntries: tableProxy("discussionEntries"),
  discussions: tableProxy("discussions"),
  agents: tableProxy("agents"),
  issues: tableProxy("issues"),
  projects: tableProxy("projects"),
  artifacts: tableProxy("artifacts"),
  artifactVersions: tableProxy("artifactVersions"),
  issueContextBundles: tableProxy("issueContextBundles"),
  issueContextBundleItems: tableProxy("issueContextBundleItems"),
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: vi.fn(() => ({
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    })),
  },
}));

// ── memoryService module mock ─────────────────────────────────────────────────
const { mockSearchMultiPath } = vi.hoisted(() => ({ mockSearchMultiPath: vi.fn() }));
vi.mock("../services/memory.js", () => ({
  memoryService: vi.fn(() => ({ searchMultiPath: mockSearchMultiPath })),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { buildCrewContextBundle } from "../services/internal-agent/aoa-agents/crew-context-bundle.js";

// ── Sequence-db helper ────────────────────────────────────────────────────────
// Each terminal await (.then / awaiting the builder) shifts the next queued
// result array. The builder chains .from().where().orderBy().limit() and may
// `await` the chain directly (thenable) — so every chain object is a thenable
// that resolves to the next queued result and also returns itself for the
// intermediate chain methods.
function makeSeqDb(queue: Array<Array<Record<string, unknown>>>) {
  let idx = 0;
  const nextResult = () => {
    const r = queue[idx] ?? [];
    idx += 1;
    return r;
  };
  const makeChain = () => {
    const chain: any = {};
    const ret = () => chain;
    chain.from = ret;
    chain.where = ret;
    chain.orderBy = ret;
    chain.leftJoin = ret;
    chain.innerJoin = ret;
    chain.limit = () => Promise.resolve(nextResult());
    chain.then = (onF: (v: unknown[]) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(nextResult()).then(onF, onR);
    return chain;
  };
  return {
    _consumed: () => idx,
    select: vi.fn(() => makeChain()),
  };
}

describe("buildCrewContextBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchMultiPath.mockReset();
    mockSearchMultiPath.mockResolvedValue([]); // default: no memory
  });

  // (a) THREAD branch renders the last entries (author: text) + the summary.
  it("(a) thread branch: renders the Chronicler summary + the last entries as '<author>: <text>'", async () => {
    const db = makeSeqDb([
      // 1) entries (desc; the builder reverses to chronological)
      [
        { id: "e2", rawContent: "I think we should ship SSO first", authorAgentId: null, createdBy: "user-founder", createdAt: new Date("2026-06-01T10:01:00Z") },
        { id: "e1", rawContent: "We need a precedent for enterprise auth", authorAgentId: "agent-scout", createdBy: "agent", createdAt: new Date("2026-06-01T10:00:00Z") },
      ],
      // 2) thread summary row
      [{ summaryText: "Thread about enterprise authentication strategy.", routingTerms: ["SSO", "SAML"] }],
      // 3) agent-name lookup (one entry had authorAgentId)
      [{ id: "agent-scout", name: "Scout" }],
    ]);

    const out = await buildCrewContextBundle(db as any, {
      companyId: "co-1",
      threadId: "thread-1",
      agentId: "agent-eng",
    });

    // Summary present (prepended as a "Thread summary:" line).
    expect(out).toContain("Thread summary:");
    expect(out).toContain("Thread about enterprise authentication strategy.");
    // routingTerms surfaced.
    expect(out).toContain("SSO");
    // Entries rendered chronologically as "<author>: <text>".
    expect(out).toContain("Scout: We need a precedent for enterprise auth");
    // Founder fallback label for an entry with no authorAgentId.
    expect(out).toMatch(/founder: I think we should ship SSO first/i);
    // Scout's (older) line comes before the founder's (newer) line (chronological).
    expect(out.indexOf("Scout: We need a precedent")).toBeLessThan(
      out.indexOf("I think we should ship SSO first"),
    );
  });

  // (b) TASK branch renders title/description + the upstream artifact body.
  it("(b) task branch: renders the task title/description + the upstream artifact body", async () => {
    const db = makeSeqDb([
      // 1) issue row (has artifactId)
      [{ id: "task-9", title: "Build the SSO login form", description: "Implement SAML SSO per the approved spec.", status: "todo", priority: "high", artifactId: "art-1" }],
      // 2) artifact current-version body
      [{ content: "# SSO Spec\nUse SAML 2.0 with the IdP-initiated flow." }],
    ]);

    const out = await buildCrewContextBundle(db as any, {
      companyId: "co-1",
      issueId: "task-9",
      agentId: "agent-eng",
    });

    expect(out).toContain("Build the SSO login form");
    expect(out).toContain("Implement SAML SSO per the approved spec.");
    // Upstream deliverable rendered.
    expect(out).toContain("Upstream deliverable:");
    expect(out).toContain("Use SAML 2.0 with the IdP-initiated flow.");
  });

  it("(b2) task branch: scopes memory search to the task's project and goal", async () => {
    mockSearchMultiPath.mockResolvedValue([]);
    const db = makeSeqDb([
      [{
        id: "task-9",
        title: "Build the SSO login form",
        description: "Implement SAML SSO per the approved spec.",
        status: "todo",
        priority: "high",
        artifactId: null,
        projectId: "project-auth",
        projectType: "project",
        goalId: "goal-enterprise",
      }],
    ]);

    await buildCrewContextBundle(db as any, {
      companyId: "co-1",
      issueId: "task-9",
      agentId: "agent-eng",
    });

    expect(mockSearchMultiPath).toHaveBeenCalledWith(
      "co-1",
      expect.stringContaining("Build the SSO login form"),
      expect.objectContaining({
        limit: 5,
        projectId: "project-auth",
        goalId: "goal-enterprise",
      }),
    );
  });

  it("(b2a) task branch: scopes memory search to departmentId when the task project is a department", async () => {
    mockSearchMultiPath.mockResolvedValue([]);
    const db = makeSeqDb([
      [{
        id: "task-10",
        title: "Use discussion scope memory",
        description: "The task should retrieve approved department memory.",
        status: "todo",
        priority: "high",
        artifactId: null,
        projectId: "dept-software",
        projectType: "department",
        goalId: null,
      }],
    ]);

    await buildCrewContextBundle(db as any, {
      companyId: "co-1",
      issueId: "task-10",
      agentId: "agent-eng",
    });

    expect(mockSearchMultiPath).toHaveBeenCalledWith(
      "co-1",
      expect.stringContaining("Use discussion scope memory"),
      expect.objectContaining({
        limit: 5,
        departmentId: "dept-software",
      }),
    );
    expect(mockSearchMultiPath.mock.calls[0][2]).not.toHaveProperty("projectId");
  });

  it("(b3) task branch: includes discussion-origin scope handoff context", async () => {
    const db = makeSeqDb([
      [{
        id: "task-9",
        title: "Build guided checklist",
        description: "Use the accepted scope evidence.",
        status: "todo",
        priority: "high",
        artifactId: null,
        projectId: "project-onboarding",
        goalId: "goal-activation",
      }],
      [{
        id: "bundle-1",
        sourceKind: "discussion_scope",
        brief: "Use selected scope evidence.",
      }],
      [
        {
          itemType: "discussion_entry",
          label: "Founder requirement",
          metadata: { excerpt: "Need guided checklist" },
        },
        {
          itemType: "artifact",
          label: "Checklist mockup",
          metadata: { artifactType: "design" },
        },
        {
          itemType: "url",
          label: "Reference URL",
          metadata: { url: "https://example.com/ref" },
        },
      ],
    ]);

    const out = await buildCrewContextBundle(db as any, {
      companyId: "co-1",
      issueId: "task-9",
      agentId: "agent-eng",
    });

    expect(out).toContain("Scope handoff:");
    expect(out).toContain("Use selected scope evidence.");
    expect(out).toContain("Founder requirement");
    expect(out).toContain("Need guided checklist");
    expect(out).toContain("Checklist mockup");
    expect(out).toContain("design");
    expect(out).toContain("https://example.com/ref");
  });

  // (c) MEMORY section populated when searchMultiPath returns items.
  it("(c) memory: lists relevant items when searchMultiPath returns results", async () => {
    mockSearchMultiPath.mockResolvedValue([
      { id: "m1", title: "Auth standard", content: "We standardize on SAML for enterprise.", layer: "domain" },
      { id: "m2", title: "Brand voice", content: "Terse, factual.", layer: "identity" },
    ]);
    const db = makeSeqDb([
      // thread entries
      [{ id: "e1", rawContent: "how do we do auth?", authorAgentId: null, createdBy: "user-1", createdAt: new Date("2026-06-01T10:00:00Z") }],
      // summary (none)
      [],
    ]);

    const out = await buildCrewContextBundle(db as any, {
      companyId: "co-1",
      threadId: "thread-1",
      agentId: "agent-eng",
    });

    expect(mockSearchMultiPath).toHaveBeenCalledTimes(1);
    // queryText derived from the thread (latest entry text or summary).
    const [calledCompanyId, calledQuery, calledOpts] = mockSearchMultiPath.mock.calls[0];
    expect(calledCompanyId).toBe("co-1");
    expect(typeof calledQuery).toBe("string");
    expect(calledQuery.length).toBeGreaterThan(0);
    expect(calledOpts).toMatchObject({ limit: 5 });
    // Items rendered.
    expect(out).toContain("Relevant memory:");
    expect(out).toContain("Auth standard");
    expect(out).toContain("We standardize on SAML for enterprise.");
  });

  // (d) MEMORY degrades to empty (no crash) when searchMultiPath throws OR returns [].
  it("(d) memory degrades gracefully: search throwing (embeddings absent) never crashes the bundle", async () => {
    mockSearchMultiPath.mockRejectedValue(new Error("pgvector unavailable: column embedding does not exist"));
    const db = makeSeqDb([
      [{ id: "e1", rawContent: "ambient chatter", authorAgentId: null, createdBy: "user-1", createdAt: new Date("2026-06-01T10:00:00Z") }],
      [],
    ]);

    const out = await buildCrewContextBundle(db as any, {
      companyId: "co-1",
      threadId: "thread-1",
      agentId: "agent-eng",
    });

    // No throw; the thread context still rendered; no memory section.
    expect(out).toContain("ambient chatter");
    expect(out).not.toContain("Relevant memory:");
  });

  it("(d2) memory empty array → no memory section, thread context preserved", async () => {
    mockSearchMultiPath.mockResolvedValue([]);
    const db = makeSeqDb([
      [{ id: "e1", rawContent: "ambient chatter two", authorAgentId: null, createdBy: "user-1", createdAt: new Date("2026-06-01T10:00:00Z") }],
      [],
    ]);

    const out = await buildCrewContextBundle(db as any, {
      companyId: "co-1",
      threadId: "thread-1",
      agentId: "agent-eng",
    });

    expect(out).toContain("ambient chatter two");
    expect(out).not.toContain("Relevant memory:");
  });

  // (e) tokenBudget trims oldest thread entries first.
  it("(e) tokenBudget: drops the OLDEST thread entries first to fit the budget", async () => {
    // Build 6 chunky entries. With a tiny budget only the most recent survive.
    const big = (n: number) => "X".repeat(400) + ` #${n}`;
    const rowsDesc = [6, 5, 4, 3, 2, 1].map((n) => ({
      id: `e${n}`,
      rawContent: big(n),
      authorAgentId: null,
      createdBy: "user-1",
      createdAt: new Date(2026, 5, 1, 10, n, 0),
    }));
    const db = makeSeqDb([
      rowsDesc, // entries (desc)
      [],       // no summary
    ]);

    // ~120 tokens ≈ 480 chars: enough for ~1 entry, not all 6.
    const out = await buildCrewContextBundle(db as any, {
      companyId: "co-1",
      threadId: "thread-1",
      agentId: "agent-eng",
      tokenBudget: 120,
    });

    // The newest entry (#6) must survive; the oldest (#1) must be dropped first.
    expect(out).toContain("#6");
    expect(out).not.toContain("#1");
    // Budget respected (ceil(len/4) <= budget, with a little slack for headers).
    expect(Math.ceil(out.length / 4)).toBeLessThanOrEqual(120 + 40);
  });

  it("returns empty string when there is genuinely no context (no thread/task, no memory)", async () => {
    mockSearchMultiPath.mockResolvedValue([]);
    const db = makeSeqDb([]);
    const out = await buildCrewContextBundle(db as any, {
      companyId: "co-1",
      agentId: "agent-eng",
    });
    expect(out).toBe("");
    // No thread/task → no searchMultiPath call (no queryText to search on).
    expect(mockSearchMultiPath).not.toHaveBeenCalled();
  });
});
