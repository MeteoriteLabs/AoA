import { describe, expect, it } from "vitest";
import {
  buildApprovalHubEmit,
  buildDiscussionPendingHubEmit,
  buildJoinRequestHubEmit,
  buildStaleIssueHubEmit,
  buildSuggestionHubEmit,
} from "../services/hub-source-producers.js";

describe("hub source producers", () => {
  it("maps pending approvals to approval_request in Waiting on you", () => {
    const emit = buildApprovalHubEmit({
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      requestedByAgentId: "agent-1",
      requestedByUserId: null,
      payload: { agentName: "Scout" },
      createdAt: new Date("2026-06-29T00:00:00Z"),
      updatedAt: new Date("2026-06-29T00:00:00Z"),
    });

    expect(emit).toMatchObject({
      companyId: "company-1",
      semanticType: "approval_request",
      sourceType: "approval",
      sourceId: "approval-1",
      ownerPool: "board",
      sourceActorType: "agent",
      sourceActorId: "agent-1",
      summary: "Agent: Scout",
    });
    expect(emit.title).toContain("hire agent");
  });

  it("maps join requests to founder-gated join_request items", () => {
    const emit = buildJoinRequestHubEmit({
      id: "join-1",
      companyId: "company-1",
      requestType: "agent",
      status: "pending_approval",
      agentName: "OpenClaw Worker",
      requestEmailSnapshot: null,
      adapterType: "openclaw",
      createdAt: new Date("2026-06-29T00:00:00Z"),
      updatedAt: new Date("2026-06-29T00:00:00Z"),
    });

    expect(emit).toMatchObject({
      semanticType: "join_request",
      sourceType: "join_request",
      sourceId: "join-1",
      ownerPool: "board",
    });
    expect(emit.title).toContain("OpenClaw Worker");
  });

  it("maps pending discussions to discussion_pending items with owner and scope", () => {
    const emit = buildDiscussionPendingHubEmit({
      id: "discussion-1",
      companyId: "company-1",
      title: "Q3 planning",
      ownerUserId: "user-1",
      scopeType: "project",
      scopeId: "project-1",
      lastPendingActorType: "agent",
      lastPendingActorId: "agent-1",
      pendingItemCount: 3,
      updatedAt: new Date("2026-06-29T00:00:00Z"),
    });

    expect(emit).toMatchObject({
      semanticType: "discussion_pending",
      sourceType: "discussion",
      sourceId: "discussion-1",
      ownerUserId: "user-1",
      scopeKey: "project:project-1",
      sourceActorType: "agent",
      sourceActorId: "agent-1",
      title: "Review 3 pending items in Q3 planning",
    });
  });

  it("maps pending suggestions to suggestions lane items", () => {
    const emit = buildSuggestionHubEmit({
      id: "suggestion-1",
      companyId: "company-1",
      category: "risk_flag",
      title: "Goal is at risk",
      evidence: "No activity for 14 days.",
      status: "pending",
      createdAt: new Date("2026-06-29T00:00:00Z"),
      updatedAt: new Date("2026-06-29T00:00:00Z"),
    });

    expect(emit).toMatchObject({
      semanticType: "suggestion",
      sourceType: "suggestion",
      sourceId: "suggestion-1",
      title: "Goal is at risk",
      summary: "No activity for 14 days.",
    });
  });

  it("maps stale issues to stale_work without going through suggestions", () => {
    const emit = buildStaleIssueHubEmit({
      id: "issue-1",
      companyId: "company-1",
      title: "Draft launch copy",
      assigneeUserId: "user-1",
      assigneeAgentId: null,
      status: "todo",
      updatedAt: new Date("2026-06-20T00:00:00Z"),
    });

    expect(emit).toMatchObject({
      semanticType: "stale_work",
      sourceType: "issue",
      sourceId: "issue-1",
      ownerUserId: "user-1",
      title: "Stale task: Draft launch copy",
    });
  });
});
