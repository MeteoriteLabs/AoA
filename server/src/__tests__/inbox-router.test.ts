/**
 * inbox-router.test.ts
 * TDD: Task 1.3 — routeInboxItem orchestrator + enqueueNavigatorRoutingWakeup
 *
 * Tests cover:
 * - off-dial → routerDecision='human', routingStatus='routed', no attach
 * - auto_attach (confident match, dial=auto_attach) → attachInboxItemToThread called, routingStatus='routed'
 * - ambiguous (near-tie, dial=auto_attach) → enqueueNavigatorRoutingWakeup called with
 *   payload.candidateThreadIds (NOT payload.threadId), routingStatus='escalated', navigatorWakeupId set
 * - suggest (confident match, dial=suggest) → routerDecision='suggest', suggestedThreadId written,
 *   no attach, routingStatus='routed', routedAt set
 * - uncomputable (embeddings unavailable) → action='human', routingStatus='routed', routedAt set
 * - atomic claim: claim returning 0 rows → no-op (P0 regression guard — no findSimilar, no attach, no insert)
 * - action throw → routingStatus='failed' + routingErrorCode, no crash
 * - activityLog called with action='thread.inbox_item.routed'
 *
 * Harness change (P0 fix): routeInboxItem now opens with an atomic UPDATE claim
 * (pending_route → routing) instead of a SELECT item-load. The first mock call is
 * now update().set().where().returning() — the claimReturning option drives whether
 * the claim succeeds (returns item) or fails (returns []).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ _op: "and", args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _op: "eq", a, b })),
  ne: vi.fn((a: unknown, b: unknown) => ({ _op: "ne", a, b })),
}));

vi.mock("@armyofagents/db", () => ({
  agents: new Proxy({} as any, { get: (_t, p) => p }),
  agentWakeupRequests: new Proxy({} as any, { get: (_t, p) => p }),
  threadInboxItems: new Proxy({} as any, { get: (_t, p) => p }),
  internalAgentConfig: new Proxy({} as any, { get: (_t, p) => p }),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// ── Module-level mocks for service dependencies ────────────────────────────────

const mockAttachInboxItemToThread = vi.fn();
const mockPromoteInboxItemToNewThread = vi.fn();
const mockLogActivity = vi.fn();

vi.mock("../services/inbox-attach.js", () => ({
  attachInboxItemToThread: (...args: any[]) => mockAttachInboxItemToThread(...args),
  promoteInboxItemToNewThread: (...args: any[]) => mockPromoteInboxItemToNewThread(...args),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: (...args: any[]) => mockLogActivity(...args),
}));

const mockFindSimilarThreadsScored = vi.fn();
vi.mock("../services/internal-agent/tools/thread-find-similar.js", () => ({
  findSimilarThreadsScored: (...args: any[]) => mockFindSimilarThreadsScored(...args),
}));

import { routeInboxItem } from "../services/inbox-router.js";

// ── Constants used across tests ────────────────────────────────────────────────

const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INBOX_ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THREAD_1_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const THREAD_2_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NAVIGATOR_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const WAKEUP_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

// ── DB builder ────────────────────────────────────────────────────────────────
//
// routeInboxItem call sequence (after P0 atomic-claim fix):
//
//   STEP 1 — update().set({routingStatus:'routing'}).where(...).returning()
//              → claimReturning (the claimed item, or [] for no-op)
//
//   STEP 2 — select(internalAgentConfig)  → configResult
//
//   STEP 3 — (optional) select(agents) for Navigator → navigatorResult
//
// All subsequent update() calls are lifecycle writes (routerDecision/confidence,
// then per-action status). They are captured in capturedUpdateSets via onUpdateSet.

interface MakeDbOptions {
  /**
   * What the atomic claim UPDATE returns. Default: the pending item (claim wins).
   * Pass [] to simulate "already claimed/handled" (the P0 no-op path).
   */
  claimReturning?: any[];
  /** What the internalAgentConfig select returns. Default: { inboundRoutingLevel: 'off' }. */
  configResult?: any[];
  /** What the agents select returns when looking up Navigator (only when escalate_navigator). */
  navigatorResult?: any[];
  /** Capture the values passed to each update.set() call. */
  onUpdateSet?: (values: any) => void;
  /** Capture the values passed to insert.values() call. */
  onInsertValues?: (values: any) => void;
  /** If provided, insert.values().returning() will resolve to this. */
  insertReturning?: any[];
}

function makePendingItem() {
  return {
    id: INBOX_ITEM_ID,
    companyId: COMPANY_ID,
    rawContent: "Test inbox item content",
  };
}

function makeDb(opts: MakeDbOptions = {}) {
  const {
    claimReturning = [makePendingItem()],
    configResult = [{ inboundRoutingLevel: "off" }],
    navigatorResult,
    onUpdateSet,
    onInsertValues,
    insertReturning = [{ id: WAKEUP_ID }],
  } = opts;

  // Build select queue: only internalAgentConfig + optional Navigator lookup.
  // The item-load SELECT is gone — replaced by the atomic claim UPDATE.
  const selectQueue: any[][] = [configResult];
  if (navigatorResult !== undefined) {
    selectQueue.push(navigatorResult);
  }

  let selectCallIndex = 0;

  const makeSelectChain = (resultIndex: number) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(selectQueue[resultIndex] ?? []),
  });

  const capturedUpdateSets: any[] = [];

  // Track whether the next update() call is the atomic claim (first call) or a
  // lifecycle write (subsequent calls). The claim uses .returning(); lifecycle
  // writes do not (they use .catch() for the failure path).
  let updateCallIndex = 0;

  const db = {
    select: vi.fn(() => {
      const idx = selectCallIndex++;
      return makeSelectChain(idx);
    }),
    update: vi.fn(() => {
      const isClaimCall = updateCallIndex === 0;
      updateCallIndex++;
      return {
        set: vi.fn((values: any) => {
          capturedUpdateSets.push(values);
          onUpdateSet?.(values);
          if (isClaimCall) {
            // Atomic claim: returns the item (or [] for already-claimed no-op).
            return {
              where: vi.fn(() => ({
                returning: vi.fn().mockResolvedValue(claimReturning),
              })),
            };
          }
          // Lifecycle write: .where().catch() chain (no .returning()).
          return {
            where: vi.fn().mockReturnThis(),
            catch: vi.fn().mockReturnThis(),
          };
        }),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn((values: any) => {
        onInsertValues?.(values);
        return {
          returning: vi.fn().mockResolvedValue(insertReturning),
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        };
      }),
    })),
  } as any;

  return { db, capturedUpdateSets };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("routeInboxItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAttachInboxItemToThread.mockResolvedValue({ posted: true, entryId: "e1", alreadyHandled: false });
    mockPromoteInboxItemToNewThread.mockResolvedValue({ threadId: THREAD_1_ID, entryId: "e2", alreadyHandled: false });
    mockLogActivity.mockResolvedValue(undefined);
  });

  // ── off-dial → human, no attach ─────────────────────────────────────────────

  it("off-dial → routerDecision='human', routingStatus='routed', no attach called", async () => {
    mockFindSimilarThreadsScored.mockResolvedValue({
      available: true,
      results: [{ threadId: THREAD_1_ID, distance: 0.1 }],
    });

    const { db, capturedUpdateSets } = makeDb({
      configResult: [{ inboundRoutingLevel: "off" }],
    });

    const result = await routeInboxItem(db, { inboxItemId: INBOX_ITEM_ID });

    expect(result.action).toBe("human");
    expect(result.outcome).toBe("attach_confident");
    expect(mockAttachInboxItemToThread).not.toHaveBeenCalled();

    // routerDecision written as 'human'
    const fieldWrite = capturedUpdateSets.find((s) => s.routerDecision === "human");
    expect(fieldWrite).toBeDefined();

    // routingStatus written as 'routed'
    const statusWrite = capturedUpdateSets.find((s) => s.routingStatus === "routed");
    expect(statusWrite).toBeDefined();
  });

  // ── auto_attach (confident, clear gap, dial=auto_attach) ────────────────────

  it("auto_attach: calls attachInboxItemToThread, routingStatus='routed'", async () => {
    // distance 0.1 (< ATTACH_CONFIDENCE=0.25), gap = 0.2 - 0.1 = 0.1 (>= AMBIGUITY_MARGIN=0.05)
    mockFindSimilarThreadsScored.mockResolvedValue({
      available: true,
      results: [
        { threadId: THREAD_1_ID, distance: 0.1 },
        { threadId: THREAD_2_ID, distance: 0.2 },
      ],
    });

    const { db, capturedUpdateSets } = makeDb({
      configResult: [{ inboundRoutingLevel: "auto_attach" }],
    });

    const result = await routeInboxItem(db, {
      inboxItemId: INBOX_ITEM_ID,
      embedText: async () => [],
    });

    expect(result.action).toBe("auto_attach");
    expect(result.outcome).toBe("attach_confident");

    // attachInboxItemToThread called with the right args
    expect(mockAttachInboxItemToThread).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        companyId: COMPANY_ID,
        inboxItemId: INBOX_ITEM_ID,
        threadId: THREAD_1_ID,
        actor: expect.objectContaining({ actorId: "system", actorType: "system" }),
      }),
    );

    // routingStatus written as 'routed'
    const statusWrite = capturedUpdateSets.find((s) => s.routingStatus === "routed");
    expect(statusWrite).toBeDefined();
  });

  // ── ambiguous (near-tie, dial=auto_attach) → escalate_navigator ─────────────

  it("ambiguous: enqueueNavigatorRoutingWakeup called with payload.candidateThreadIds (NOT payload.threadId), routingStatus='escalated', navigatorWakeupId set", async () => {
    // distance 0.1 (< ATTACH_CONFIDENCE), gap = 0.12 - 0.1 = 0.02 (< AMBIGUITY_MARGIN=0.05 → ambiguous)
    mockFindSimilarThreadsScored.mockResolvedValue({
      available: true,
      results: [
        { threadId: THREAD_1_ID, distance: 0.1 },
        { threadId: THREAD_2_ID, distance: 0.12 },
      ],
    });

    const capturedInsertValues: any[] = [];
    const { db, capturedUpdateSets } = makeDb({
      configResult: [{ inboundRoutingLevel: "auto_attach" }],
      navigatorResult: [{ id: NAVIGATOR_ID }],
      onInsertValues: (v) => capturedInsertValues.push(v),
      insertReturning: [{ id: WAKEUP_ID }],
    });

    const result = await routeInboxItem(db, {
      inboxItemId: INBOX_ITEM_ID,
      embedText: async () => [],
    });

    expect(result.action).toBe("escalate_navigator");
    expect(result.outcome).toBe("ambiguous");

    // Insert called (for agentWakeupRequests)
    expect(db.insert).toHaveBeenCalled();

    // Verify payload: candidateThreadIds present, threadId NOT present (Codex #4)
    expect(capturedInsertValues).toHaveLength(1);
    const payload = capturedInsertValues[0];
    expect(payload.source).toBe("inbox.routing_ambiguous");
    expect(payload.payload.candidateThreadIds).toEqual([THREAD_1_ID, THREAD_2_ID]);
    expect(payload.payload.inboxItemId).toBe(INBOX_ITEM_ID);
    expect(payload.payload).not.toHaveProperty("threadId"); // Codex #4 guard

    // routingStatus='escalated', navigatorWakeupId set
    const escalatedWrite = capturedUpdateSets.find(
      (s) => s.routingStatus === "escalated" && s.navigatorWakeupId === WAKEUP_ID,
    );
    expect(escalatedWrite).toBeDefined();
    expect(escalatedWrite.routedAt).toBeInstanceOf(Date);

    // attach NOT called
    expect(mockAttachInboxItemToThread).not.toHaveBeenCalled();
  });

  // ── suggest (confident, dial=suggest) ───────────────────────────────────────

  it("suggest: routerDecision='suggest', suggestedThreadId written, no attach, routingStatus='routed', routedAt set", async () => {
    // confident match: distance 0.1, gap = 0.2 - 0.1 = 0.1 (>= 0.05)
    mockFindSimilarThreadsScored.mockResolvedValue({
      available: true,
      results: [
        { threadId: THREAD_1_ID, distance: 0.1 },
        { threadId: THREAD_2_ID, distance: 0.2 },
      ],
    });

    const { db, capturedUpdateSets } = makeDb({
      configResult: [{ inboundRoutingLevel: "suggest" }],
    });

    const result = await routeInboxItem(db, {
      inboxItemId: INBOX_ITEM_ID,
      embedText: async () => [],
    });

    expect(result.action).toBe("suggest");
    expect(result.outcome).toBe("attach_confident");

    // No attach
    expect(mockAttachInboxItemToThread).not.toHaveBeenCalled();

    // routerDecision='suggest' + suggestedThreadId written
    const fieldWrite = capturedUpdateSets.find(
      (s) => s.routerDecision === "suggest" && s.suggestedThreadId === THREAD_1_ID,
    );
    expect(fieldWrite).toBeDefined();

    // routingStatus='routed' AND routedAt set (audit completeness fix)
    const statusWrite = capturedUpdateSets.find(
      (s) => s.routingStatus === "routed" && s.routedAt instanceof Date,
    );
    expect(statusWrite).toBeDefined();
  });

  // ── uncomputable (embeddings unavailable) → human ───────────────────────────

  it("uncomputable: action='human', routingStatus='routed', routedAt set, no attach", async () => {
    mockFindSimilarThreadsScored.mockResolvedValue({
      available: false,
      results: [],
    });

    const { db, capturedUpdateSets } = makeDb({
      configResult: [{ inboundRoutingLevel: "auto_attach" }],
    });

    const result = await routeInboxItem(db, {
      inboxItemId: INBOX_ITEM_ID,
      // embedText intentionally absent to simulate unavailable embeddings
    });

    expect(result.action).toBe("human");
    expect(result.outcome).toBe("uncomputable");

    expect(mockAttachInboxItemToThread).not.toHaveBeenCalled();

    // routingStatus='routed' AND routedAt set (audit completeness fix)
    const statusWrite = capturedUpdateSets.find(
      (s) => s.routingStatus === "routed" && s.routedAt instanceof Date,
    );
    expect(statusWrite).toBeDefined();
  });

  // ── P0 atomicity regression guard ─────────────────────────────────────────────
  //
  // The key regression guard: when the atomic claim UPDATE returns 0 rows (the item
  // was already claimed by a concurrent caller), routeInboxItem must return a no-op
  // result immediately WITHOUT calling findSimilarThreadsScored, attach, promote, or insert.
  //
  // This is the exact failure mode that caused the double-routing P0 bug:
  //   - BEFORE: SELECT read pending_route → both callers passed the guard → both acted
  //   - AFTER:  UPDATE claim → only ONE wins → the other gets 0 rows → no-op
  //
  // Verified by passing claimReturning=[] (claim fails → no-op).

  it("P0 atomicity: claim returns 0 rows → no-op, no findSimilar, no attach, no insert", async () => {
    mockFindSimilarThreadsScored.mockResolvedValue({
      available: true,
      results: [{ threadId: THREAD_1_ID, distance: 0.1 }],
    });

    const { db } = makeDb({
      claimReturning: [], // Simulate: concurrent caller already claimed this item
      configResult: [{ inboundRoutingLevel: "auto_attach" }],
    });

    const result = await routeInboxItem(db, { inboxItemId: INBOX_ITEM_ID });

    // No-op result
    expect(result.action).toBe("human");
    expect(result.outcome).toBe("uncomputable");

    // findSimilarThreadsScored must NOT be called (claim lost → no further work)
    expect(mockFindSimilarThreadsScored).not.toHaveBeenCalled();
    // No attach, no promote, no insert
    expect(mockAttachInboxItemToThread).not.toHaveBeenCalled();
    expect(mockPromoteInboxItemToNewThread).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    // No select calls at all (config SELECT is skipped when claim fails)
    expect(db.select).not.toHaveBeenCalled();
  });

  // ── action throw → routingStatus='failed' + routingErrorCode, no crash ───────

  it("action throw → routingStatus='failed' + routingErrorCode written, no crash, still returns {action,outcome}", async () => {
    // auto_attach path
    mockFindSimilarThreadsScored.mockResolvedValue({
      available: true,
      results: [
        { threadId: THREAD_1_ID, distance: 0.1 },
        { threadId: THREAD_2_ID, distance: 0.2 },
      ],
    });

    mockAttachInboxItemToThread.mockRejectedValueOnce(
      new Error("COMPANY_MISMATCH: inbox item belongs to a different company"),
    );

    const capturedUpdateSets: any[] = [];
    const { db } = makeDb({
      configResult: [{ inboundRoutingLevel: "auto_attach" }],
      onUpdateSet: (v) => capturedUpdateSets.push(v),
    });

    // Must not throw
    const result = await routeInboxItem(db, {
      inboxItemId: INBOX_ITEM_ID,
      embedText: async () => [],
    });

    expect(result.action).toBe("auto_attach");
    expect(result.outcome).toBe("attach_confident");

    // routingStatus='failed' + routingErrorCode written
    const failedWrite = capturedUpdateSets.find(
      (s) => s.routingStatus === "failed" && s.routingErrorCode === "COMPANY_MISMATCH",
    );
    expect(failedWrite).toBeDefined();

    // logActivity must NOT be called after a failed action
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  // ── activityLog called with action='thread.inbox_item.routed' ─────────────────

  it("logActivity called with action='thread.inbox_item.routed' on success", async () => {
    mockFindSimilarThreadsScored.mockResolvedValue({
      available: true,
      results: [],
    });

    const { db } = makeDb({
      configResult: [{ inboundRoutingLevel: "off" }],
    });

    await routeInboxItem(db, { inboxItemId: INBOX_ITEM_ID });

    expect(mockLogActivity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        companyId: COMPANY_ID,
        actorType: "system",
        actorId: "system",
        action: "thread.inbox_item.routed",
        entityType: "thread_inbox_item",
        entityId: INBOX_ITEM_ID,
      }),
    );
  });

  // ── escalation gap computation ────────────────────────────────────────────────

  it("escalation: gap correctly computed as top2 - top1 distance", async () => {
    mockFindSimilarThreadsScored.mockResolvedValue({
      available: true,
      results: [
        { threadId: THREAD_1_ID, distance: 0.1 },
        { threadId: THREAD_2_ID, distance: 0.12 }, // gap = 0.02
      ],
    });

    const capturedInsertValues: any[] = [];
    const { db } = makeDb({
      configResult: [{ inboundRoutingLevel: "auto_attach" }],
      navigatorResult: [{ id: NAVIGATOR_ID }],
      onInsertValues: (v) => capturedInsertValues.push(v),
    });

    await routeInboxItem(db, { inboxItemId: INBOX_ITEM_ID });

    expect(capturedInsertValues[0]?.payload?.gap).toBeCloseTo(0.02, 5);
    expect(capturedInsertValues[0]?.payload?.distances).toEqual([0.1, 0.12]);
  });

  it("escalation: gap=null when only one candidate — single result yields attach_confident", async () => {
    // Only one result — gap = Infinity → attach_confident (not ambiguous).
    mockFindSimilarThreadsScored.mockResolvedValue({
      available: true,
      results: [
        { threadId: THREAD_1_ID, distance: 0.1 },
      ],
    });

    const { db } = makeDb({
      configResult: [{ inboundRoutingLevel: "auto_attach" }],
    });

    const result = await routeInboxItem(db, { inboxItemId: INBOX_ITEM_ID });
    expect(result.action).toBe("auto_attach");
    expect(result.outcome).toBe("attach_confident");
  });
});
