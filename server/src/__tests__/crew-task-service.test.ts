/**
 * crew-task-service.test.ts — Tasks 2.2+2.3
 *
 * Tests for:
 *   A. resolveCreationGate pure function
 *   B. crewTaskService.proposeWork integration tests (all paths)
 *
 * Mock strategy (mirrors thread-deliverables-approve.test.ts pattern):
 *   - drizzle-orm + @armyofagents/db mocked with Proxy stubs
 *   - writeScopeProposal, preflightCrewDispatch, threadDeliverablesService,
 *     heartbeatService, logActivity all mocked
 *   - resolveCreationGate imported directly (pure function, no mocks needed)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Drizzle + DB mocks ────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _tag: "eq", a, b })),
  and: vi.fn((...args: unknown[]) => ({ _tag: "and", args })),
  ne: vi.fn((a: unknown, b: unknown) => ({ _tag: "ne", a, b })),
  sql: vi.fn(),
}));

vi.mock("@armyofagents/db", () => ({
  discussionEntries: new Proxy({} as Record<string, unknown>, { get: (_t, p) => p }),
  discussions: new Proxy({} as Record<string, unknown>, { get: (_t, p) => p }),
  activityLog: new Proxy({} as Record<string, unknown>, { get: (_t, p) => p }),
  agents: new Proxy({} as Record<string, unknown>, { get: (_t, p) => p }),
}));

// ── scope-proposal-writer mock ────────────────────────────────────────────────
// Use inline vi.fn() in factory (no captured variable — hoisting safe).
vi.mock("../services/scope-proposal-writer.js", () => ({
  writeScopeProposal: vi.fn(),
}));

// ── crew-budget mock ──────────────────────────────────────────────────────────
vi.mock("../services/crew-budget.js", () => ({
  preflightCrewDispatch: vi.fn(),
}));

// ── thread-deliverables mock ──────────────────────────────────────────────────
vi.mock("../services/thread-deliverables.js", () => ({
  threadDeliverablesService: vi.fn(() => ({
    approveProposal: vi.fn(),
    createDeliverableTasks: vi.fn(),
  })),
  default: vi.fn(() => ({
    approveProposal: vi.fn(),
    createDeliverableTasks: vi.fn(),
  })),
}));

// ── heartbeat mock ────────────────────────────────────────────────────────────
vi.mock("../services/heartbeat.js", () => ({
  heartbeatService: vi.fn(() => ({
    wakeup: vi.fn(),
  })),
}));

// ── activity-log mock ─────────────────────────────────────────────────────────
vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(),
}));

// ── live-events mock (pulled in transitively) ─────────────────────────────────
vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));

// ── redaction mock ────────────────────────────────────────────────────────────
vi.mock("../redaction.js", () => ({
  sanitizeRecord: vi.fn((r: unknown) => r),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import { resolveCreationGate, crewTaskService } from "../services/crew-task-service.js";
import { writeScopeProposal } from "../services/scope-proposal-writer.js";
import { preflightCrewDispatch } from "../services/crew-budget.js";
import { threadDeliverablesService } from "../services/thread-deliverables.js";
import { heartbeatService } from "../services/heartbeat.js";
import { logActivity } from "../services/activity-log.js";

// ─── Constants ─────────────────────────────────────────────────────────────────
const CO_ID = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const THREAD_ID = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const PROPOSAL_ID = "cccccccc-0000-4000-8000-cccccccccccc";
const AGENT_ID = "dddddddd-0000-4000-8000-dddddddddddd";
const USER_ID = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";

const BASE_PROPOSALS = [
  { title: "Task One", assigneeRole: "engineer" },
  { title: "Task Two", assigneeRole: "designer" },
];

/** Minimal mock db — the service delegates real DB work to mocked helpers. */
const mockDb = {} as any;

// ─── Typed mock accessors ─────────────────────────────────────────────────────
// Get typed references to the mocked functions after imports.
const mockWriteScopeProposal = vi.mocked(writeScopeProposal);
const mockPreflightCrewDispatch = vi.mocked(preflightCrewDispatch);
const mockLogActivity = vi.mocked(logActivity);

// threadDeliverablesService is a factory — we need the inner approveProposal fn.
// heartbeatService is a factory — we need the inner wakeup fn.
// We'll capture these in beforeEach after calling the factories.
let mockApproveProposal: ReturnType<typeof vi.fn>;
let mockWakeup: ReturnType<typeof vi.fn>;

// ═════════════════════════════════════════════════════════════════════════════
// A. resolveCreationGate pure function
// ═════════════════════════════════════════════════════════════════════════════

describe("resolveCreationGate (pure function)", () => {
  it("autonomy=0 → await_human", () => {
    expect(resolveCreationGate(0)).toBe("await_human");
  });

  it("autonomy=1 → await_human", () => {
    expect(resolveCreationGate(1)).toBe("await_human");
  });

  it("autonomy=2 → auto_approve", () => {
    expect(resolveCreationGate(2)).toBe("auto_approve");
  });

  it("autonomy=null → await_human (fail closed)", () => {
    expect(resolveCreationGate(null)).toBe("await_human");
  });

  it("autonomy=undefined → await_human (fail closed)", () => {
    expect(resolveCreationGate(undefined)).toBe("await_human");
  });

  it("autonomy=3 → auto_approve (any number >= 2)", () => {
    expect(resolveCreationGate(3)).toBe("auto_approve");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B. crewTaskService.proposeWork integration tests
// ═════════════════════════════════════════════════════════════════════════════

describe("crewTaskService.proposeWork", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-capture the inner mock fns from the factory mocks after clearAllMocks.
    // The factories return fresh vi.fn() instances each call in the mock, but
    // since crewTaskService() calls heartbeatService(db) and threadDeliverablesService(db)
    // internally, we capture the fns that the next factory call will return.
    // We use a shared approach: set up the factory to return a stable mock instance.
    mockApproveProposal = vi.fn();
    mockWakeup = vi.fn();

    vi.mocked(threadDeliverablesService).mockReturnValue({
      approveProposal: mockApproveProposal,
      createDeliverableTasks: vi.fn(),
    } as any);

    vi.mocked(heartbeatService).mockReturnValue({
      wakeup: mockWakeup,
    } as any);

    // Default: writeScopeProposal returns fresh proposal (existing:false)
    mockWriteScopeProposal.mockResolvedValue({
      entryId: PROPOSAL_ID,
      proposalCursorSeq: 5,
      existing: false,
    });

    // Default: budget allows
    mockPreflightCrewDispatch.mockResolvedValue({ allowed: true });

    // Default: approve succeeds with two tasks
    mockApproveProposal.mockResolvedValue({
      ok: true,
      alreadyApproved: false,
      taskIds: ["task-1", "task-2"],
      createdTasks: [
        { id: "task-1", assigneeAgentId: "agent-a", workMode: null },
        { id: "task-2", assigneeAgentId: "agent-b", workMode: null },
      ],
    });

    mockWakeup.mockResolvedValue(undefined);
    mockLogActivity.mockResolvedValue(undefined);
  });

  // ── B1. await_human path (autonomy=0) ────────────────────────────────────────
  it("autonomy=0 (await_human): card written, no issues created, no dispatch", async () => {
    const svc = crewTaskService(mockDb);
    const result = await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 0,
      summary: "Build auth flow",
      proposedTasks: BASE_PROPOSALS,
      createdBy: { agentId: AGENT_ID },
    });

    expect(mockWriteScopeProposal).toHaveBeenCalledTimes(1);
    expect(mockWriteScopeProposal).toHaveBeenCalledWith(mockDb, expect.objectContaining({
      threadId: THREAD_ID,
      companyId: CO_ID,
    }));

    expect(result.proposalId).toBe(PROPOSAL_ID);
    expect(result.autoApproved).toBe(false);
    expect(result.existing).toBe(false);
    expect(result.createdIssueIds).toBeUndefined();

    // MUST NOT approve or dispatch
    expect(mockApproveProposal).not.toHaveBeenCalled();
    expect(mockWakeup).not.toHaveBeenCalled();
    expect(mockPreflightCrewDispatch).not.toHaveBeenCalled();
  });

  // ── B2. await_human path (autonomy=1) ────────────────────────────────────────
  it("autonomy=1 (await_human): card written, no issues created, no dispatch", async () => {
    const svc = crewTaskService(mockDb);
    const result = await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 1,
      summary: "Plan the sprint",
      proposedTasks: BASE_PROPOSALS,
      createdBy: { userId: USER_ID },
    });

    expect(mockWriteScopeProposal).toHaveBeenCalledTimes(1);
    expect(result.autoApproved).toBe(false);
    expect(mockApproveProposal).not.toHaveBeenCalled();
    expect(mockWakeup).not.toHaveBeenCalled();
  });

  // ── B3. auto_approve (autonomy=2) happy path ──────────────────────────────────
  it("autonomy=2 (auto_approve): card written, approval invoked, tasks created, dispatch fired once per distinct assignee", async () => {
    const svc = crewTaskService(mockDb);
    const result = await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 2,
      summary: "Build the product",
      proposedTasks: BASE_PROPOSALS,
      createdBy: { agentId: AGENT_ID },
    });

    // Card was written
    expect(mockWriteScopeProposal).toHaveBeenCalledTimes(1);

    // Budget was checked
    expect(mockPreflightCrewDispatch).toHaveBeenCalledTimes(1);

    // Approval handler was invoked
    expect(mockApproveProposal).toHaveBeenCalledTimes(1);
    expect(mockApproveProposal).toHaveBeenCalledWith(expect.objectContaining({
      threadId: THREAD_ID,
      companyId: CO_ID,
      proposalEntryId: PROPOSAL_ID,
    }));

    // Tasks created
    expect(result.autoApproved).toBe(true);
    expect(result.existing).toBe(false);
    expect(result.createdIssueIds).toEqual(["task-1", "task-2"]);

    // Dispatch fired once per DISTINCT assignee (2 distinct: agent-a, agent-b)
    expect(mockWakeup).toHaveBeenCalledTimes(2);
    const wakeupAgentIds = mockWakeup.mock.calls.map((c) => c[0]);
    expect(wakeupAgentIds).toContain("agent-a");
    expect(wakeupAgentIds).toContain("agent-b");
  });

  // ── B4. auto_approve: tasks with same assignee — only one wakeup ─────────────
  it("auto_approve: two tasks with the same assigneeAgentId → wakeup fired once", async () => {
    mockApproveProposal.mockResolvedValue({
      ok: true,
      alreadyApproved: false,
      taskIds: ["task-1", "task-2"],
      createdTasks: [
        { id: "task-1", assigneeAgentId: "agent-x", workMode: null },
        { id: "task-2", assigneeAgentId: "agent-x", workMode: null },
      ],
    });

    const svc = crewTaskService(mockDb);
    await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 2,
      summary: "Same assignee",
      proposedTasks: BASE_PROPOSALS,
      createdBy: { agentId: AGENT_ID },
    });

    // Only ONE wakeup for the single distinct assignee
    expect(mockWakeup).toHaveBeenCalledTimes(1);
    expect(mockWakeup.mock.calls[0][0]).toBe("agent-x");
  });

  // ── B5. auto_approve: tasks with no assignees → no wakeup ────────────────────
  it("auto_approve: tasks with no assigneeAgentId → no wakeup fired", async () => {
    mockApproveProposal.mockResolvedValue({
      ok: true,
      alreadyApproved: false,
      taskIds: ["task-1"],
      createdTasks: [
        { id: "task-1", assigneeAgentId: null, workMode: null },
      ],
    });

    const svc = crewTaskService(mockDb);
    await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 2,
      summary: "No assignee",
      proposedTasks: [{ title: "Unassigned task" }],
      createdBy: { agentId: AGENT_ID },
    });

    expect(mockWakeup).not.toHaveBeenCalled();
  });

  // ── B6. budget blocked at L2 (auto_approve path) ──────────────────────────────
  it("budget blocked: card still written; approval/dispatch SKIPPED; returns blockedReason", async () => {
    mockPreflightCrewDispatch.mockResolvedValue({
      allowed: false,
      reason: "Budget exhausted for this company",
      reasonCode: "budget_exhausted",
    });

    const svc = crewTaskService(mockDb);
    const result = await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 2,
      summary: "Budget blocked run",
      proposedTasks: BASE_PROPOSALS,
      createdBy: { agentId: AGENT_ID },
    });

    // Card was written (budget never blocks the card write — Codex #16)
    expect(mockWriteScopeProposal).toHaveBeenCalledTimes(1);

    // Budget was checked
    expect(mockPreflightCrewDispatch).toHaveBeenCalledTimes(1);

    // Approval and dispatch SKIPPED
    expect(mockApproveProposal).not.toHaveBeenCalled();
    expect(mockWakeup).not.toHaveBeenCalled();

    // Card stayed pending — return reflects blocked state
    expect(result.proposalId).toBe(PROPOSAL_ID);
    expect(result.autoApproved).toBe(false);
    expect(result.existing).toBe(false);
    expect(result.blockedReason).toBe("budget_exhausted");
    expect(result.createdIssueIds).toBeUndefined();
  });

  // ── B7. idempotent: writeScopeProposal returns existing:true ─────────────────
  it("idempotent: existing proposal → returns existing:true, no approval, no dispatch", async () => {
    mockWriteScopeProposal.mockResolvedValue({
      entryId: PROPOSAL_ID,
      proposalCursorSeq: 3,
      existing: true,
    });

    const svc = crewTaskService(mockDb);
    const result = await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 2, // even at L2, existing should not re-approve
      summary: "Duplicate proposal",
      proposedTasks: BASE_PROPOSALS,
      createdBy: { agentId: AGENT_ID },
    });

    expect(mockWriteScopeProposal).toHaveBeenCalledTimes(1);
    expect(result.proposalId).toBe(PROPOSAL_ID);
    expect(result.existing).toBe(true);
    expect(result.autoApproved).toBe(false);

    // NO approval or dispatch
    expect(mockApproveProposal).not.toHaveBeenCalled();
    expect(mockWakeup).not.toHaveBeenCalled();
    expect(mockPreflightCrewDispatch).not.toHaveBeenCalled();
  });

  // ── B8. activity_log written for proposal creation ────────────────────────────
  it("activity_log written for proposal creation (await_human)", async () => {
    const svc = crewTaskService(mockDb);
    await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 0,
      summary: "Activity log check",
      proposedTasks: BASE_PROPOSALS,
      createdBy: { agentId: AGENT_ID },
    });

    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    const logCall = mockLogActivity.mock.calls[0];
    expect(logCall[0]).toBe(mockDb);
    expect(logCall[1]).toMatchObject({
      companyId: CO_ID,
      entityId: PROPOSAL_ID,
      action: expect.stringContaining("proposal"),
    });
  });

  // ── B9. activity_log written for auto-approval ────────────────────────────────
  it("activity_log written for both proposal creation and auto-approval at L2", async () => {
    const svc = crewTaskService(mockDb);
    await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 2,
      summary: "Auto-approve activity log check",
      proposedTasks: BASE_PROPOSALS,
      createdBy: { agentId: AGENT_ID },
    });

    // At minimum 2 logActivity calls: one for proposal, one for auto-approval
    expect(mockLogActivity).toHaveBeenCalledTimes(2);

    const actions = mockLogActivity.mock.calls.map((c) => c[1].action as string);
    // One call for the proposal write
    expect(actions.some((a) => a.includes("proposal"))).toBe(true);
    // One call for the auto-approval
    expect(actions.some((a) => a.includes("auto_approv") || a.includes("approved"))).toBe(true);
  });

  // ── B10. writeScopeProposal called with agentId from createdBy ────────────────
  it("passes agentId from createdBy to writeScopeProposal", async () => {
    const svc = crewTaskService(mockDb);
    await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 0,
      summary: "Agent id passthrough",
      proposedTasks: BASE_PROPOSALS,
      createdBy: { agentId: AGENT_ID, userId: USER_ID },
    });

    expect(mockWriteScopeProposal).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ agentId: AGENT_ID }),
    );
  });

  // ── B11. when createdBy has no agentId, passes null ───────────────────────────
  it("passes null agentId to writeScopeProposal when createdBy has no agentId", async () => {
    const svc = crewTaskService(mockDb);
    await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 0,
      summary: "User-triggered proposal",
      proposedTasks: BASE_PROPOSALS,
      createdBy: { userId: USER_ID },
    });

    expect(mockWriteScopeProposal).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ agentId: null }),
    );
  });

  // ── B12. budget blocked: thread_paused returns blockedReason ─────────────────
  it("budget gate: thread_paused → returns blockedReason=thread_paused, card written", async () => {
    mockPreflightCrewDispatch.mockResolvedValue({
      allowed: false,
      reason: "Crew paused for this thread",
      reasonCode: "thread_paused",
    });

    const svc = crewTaskService(mockDb);
    const result = await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 2,
      summary: "Paused thread",
      proposedTasks: BASE_PROPOSALS,
      createdBy: { agentId: AGENT_ID },
    });

    expect(mockWriteScopeProposal).toHaveBeenCalledTimes(1);
    expect(mockApproveProposal).not.toHaveBeenCalled();
    expect(result.blockedReason).toBe("thread_paused");
  });

  // ── B13. proposeWork passes proposedTasks to writeScopeProposal ──────────────
  it("passes summary and proposedTasks to writeScopeProposal proposal arg", async () => {
    const svc = crewTaskService(mockDb);
    await svc.proposeWork({
      threadId: THREAD_ID,
      companyId: CO_ID,
      autonomy: 0,
      summary: "My summary",
      proposedTasks: [{ title: "Only task" }],
      createdBy: { agentId: AGENT_ID },
    });

    expect(mockWriteScopeProposal).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        proposal: expect.objectContaining({
          summary: "My summary",
          proposedTasks: [{ title: "Only task" }],
        }),
      }),
    );
  });
});
