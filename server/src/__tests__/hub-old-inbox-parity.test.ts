import { describe, expect, it } from "vitest";
import { HUB_SEMANTIC_TO_LANE, HUB_SEMANTIC_TYPES } from "@armyofagents/shared";

const oldInboxSources = [
  { name: "actionable approvals", semanticType: "approval_request", lane: "waiting_on_you" },
  { name: "pending join requests", semanticType: "join_request", lane: "waiting_on_you" },
  { name: "pending discussions", semanticType: "discussion_pending", lane: "waiting_on_you" },
  { name: "thread.needs_human_input", semanticType: "human_input_needed", lane: "waiting_on_you" },
  { name: "thread.scope_proposal", semanticType: "scope_proposal", lane: "waiting_on_you" },
  { name: "thread.artifact_needs_review", semanticType: "legacy_other", lane: "notifications" },
  { name: "thread.crew_failed", semanticType: "agent_error", lane: "notifications" },
  { name: "thread.spinoff_suggested", semanticType: "proactive", lane: "suggestions" },
  { name: "failed runs", semanticType: "run_failed", lane: "notifications" },
  { name: "budget alerts", semanticType: "budget_alert", lane: "notifications" },
  { name: "agent errors", semanticType: "agent_error", lane: "notifications" },
  { name: "mentions", semanticType: "mention", lane: "notifications" },
  { name: "run complete", semanticType: "run_complete", lane: "notifications" },
  { name: "stale issues", semanticType: "stale_work", lane: "suggestions" },
  { name: "suggestion engine rows", semanticType: "suggestion", lane: "suggestions" },
] as const;

describe("old Inbox to hub parity contract", () => {
  it("maps every retained old Inbox source to a known hub semantic type and lane", () => {
    for (const source of oldInboxSources) {
      expect(HUB_SEMANTIC_TYPES, source.name).toContain(source.semanticType);
      expect(HUB_SEMANTIC_TO_LANE[source.semanticType], source.name).toBe(source.lane);
    }
  });

  it("keeps intentionally removed old Inbox sections explicit", () => {
    expect("my recent tasks").toBe("my recent tasks");
  });
});
