/**
 * Unit tests for assertAgentStatusTransition — the service-level guard that
 * prevents crew agents (calling issueService.update directly via tools) from
 * bypassing the route-only in_review guard, and enforces the autonomy dial for
 * completion-ish transitions (in_review requires Assist≥1, done requires Drive≥2).
 *
 * These test the PURE guard function. The only DB dependency is the approval
 * lookup inside assertAgentInReviewReviewPath (reached for the in_review path),
 * which we mock with a fluent select chain (mirrors agent-in-review-guard.test.ts).
 */
import { describe, it, expect } from "vitest";

import { assertAgentStatusTransition } from "../services/issue-agent-status-guard.js";
import { HttpError } from "../errors.js";

// ── Mock DB ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock DB for the approval lookup inside the in_review path.
 * approvalRows: what the inner join SELECT returns.
 */
function buildMockDb(approvalRows: Array<{ status: string }>) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(approvalRows),
    select: () => chain,
  };
  return {
    select: () => chain,
  };
}

// A DB whose approval lookup would throw if called — used to prove a code path
// returns BEFORE touching the database (dial gates, ownership, non-agent actors).
const explodingDb = {
  select: () => {
    throw new Error("DB should not be queried on this path");
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("assertAgentStatusTransition", () => {
  // ── done at Drive (dial 2), own task → resolves ──
  it("resolves when crew agent completes its own task at Drive (dial 2)", async () => {
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-A" },
          updateFields: { status: "done" },
          actor: { actorType: "agent", agentId: "agent-A", effectiveDial: 2 },
        },
        explodingDb as never,
      ),
    ).resolves.toBeUndefined();
  });

  // ── done at Assist (dial 1), own task → throws (Drive required) ──
  it("throws when agent marks own task done at Assist (dial 1 < 2)", async () => {
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-A" },
          updateFields: { status: "done" },
          actor: { actorType: "agent", agentId: "agent-A", effectiveDial: 1 },
        },
        explodingDb as never,
      ),
    ).rejects.toThrow(HttpError);
  });

  // ── in_review at Assist (dial 1), own task, human assignee in update → resolves ──
  it("resolves for in_review at Assist (dial 1) when update sets a human assignee", async () => {
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-A" },
          updateFields: { status: "in_review", assigneeUserId: "user-1" },
          actor: { actorType: "agent", agentId: "agent-A", effectiveDial: 1 },
        },
        // assignee path returns before DB lookup; use exploding db to prove it
        explodingDb as never,
      ),
    ).resolves.toBeUndefined();
  });

  // ── in_review at Assist (dial 1), own task, linked pending approval → resolves ──
  it("resolves for in_review at Assist (dial 1) when a linked pending approval exists", async () => {
    const db = buildMockDb([{ status: "pending" }]);
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-A" },
          updateFields: { status: "in_review" },
          actor: { actorType: "agent", agentId: "agent-A", effectiveDial: 1 },
        },
        db as never,
      ),
    ).resolves.toBeUndefined();
  });

  // ── in_review at Manual (dial 0), own task → throws (Assist required) ──
  it("throws when agent moves own task to in_review at Manual (dial 0 < 1)", async () => {
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-A" },
          updateFields: { status: "in_review", assigneeUserId: "user-1" },
          actor: { actorType: "agent", agentId: "agent-A", effectiveDial: 0 },
        },
        explodingDb as never,
      ),
    ).rejects.toThrow(HttpError);
  });

  // ── in_review at Assist, own task, NO review path → throws (delegates to in_review guard) ──
  it("throws for in_review at Assist when there is no review path", async () => {
    const db = buildMockDb([]); // no approvals
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-A" },
          updateFields: { status: "in_review" },
          actor: { actorType: "agent", agentId: "agent-A", effectiveDial: 1 },
        },
        db as never,
      ),
    ).rejects.toThrow(HttpError);
  });

  // ── NOT own task → throws (ownership) ──
  it("throws when agent tries to complete a task assigned to a different agent", async () => {
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-OTHER" },
          updateFields: { status: "done" },
          actor: { actorType: "agent", agentId: "agent-A", effectiveDial: 2 },
        },
        explodingDb as never,
      ),
    ).rejects.toThrow(HttpError);
  });

  // ── agent with no agentId → throws (ownership: cannot prove it owns the task) ──
  it("throws when actor is agent but no agentId is provided", async () => {
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-A" },
          updateFields: { status: "done" },
          actor: { actorType: "agent", agentId: null, effectiveDial: 2 },
        },
        explodingDb as never,
      ),
    ).rejects.toThrow(HttpError);
  });

  // ── actorType 'system' → resolves (Commander/system bypass) ──
  it("resolves for system actor (Commander/system bypass)", async () => {
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "in_progress", assigneeAgentId: null },
          updateFields: { status: "done" },
          actor: { actorType: "system" },
        },
        explodingDb as never,
      ),
    ).resolves.toBeUndefined();
  });

  // ── actorType 'board' → resolves ──
  it("resolves for board actor", async () => {
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-A" },
          updateFields: { status: "done" },
          actor: { actorType: "board" },
        },
        explodingDb as never,
      ),
    ).resolves.toBeUndefined();
  });

  // ── actorType 'user' → resolves ──
  it("resolves for user actor", async () => {
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-A" },
          updateFields: { status: "done" },
          actor: { actorType: "user" },
        },
        explodingDb as never,
      ),
    ).resolves.toBeUndefined();
  });

  // ── non-completion transition (e.g. in_progress) by agent → resolves (not gated) ──
  it("resolves for agent transition to a non-completion status (in_progress)", async () => {
    await expect(
      assertAgentStatusTransition(
        {
          existing: { id: "issue-1", status: "todo", assigneeAgentId: "agent-A" },
          updateFields: { status: "in_progress" },
          actor: { actorType: "agent", agentId: "agent-A", effectiveDial: 0 },
        },
        explodingDb as never,
      ),
    ).resolves.toBeUndefined();
  });
});
