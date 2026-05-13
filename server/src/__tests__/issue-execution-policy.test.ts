import { describe, expect, it } from "vitest";

import {
  buildInitialIssueMonitorFields,
  buildIssueMonitorClearedPatch,
  buildIssueMonitorTriggeredPatch,
  normalizeIssueMonitorPolicy,
} from "../services/issue-execution-policy.js";

describe("issue monitor execution policy", () => {
  it("normalizes monitor policy and redacts external refs from metadata", () => {
    expect(
      normalizeIssueMonitorPolicy({
        kind: "check",
        nextCheckAt: "2026-05-13T10:00:00.000Z",
        scheduledBy: "board",
        externalRef: "secret-ticket",
        maxAttempts: 2,
      }),
    ).toMatchObject({
      kind: "check",
      externalRef: "secret-ticket",
      maxAttempts: 2,
    });

    const fields = buildInitialIssueMonitorFields({
      companyId: "company-1",
      issue: { id: "issue-1", status: "in_progress", assigneeAgentId: "agent-1" },
      policy: {
        kind: "check",
        nextCheckAt: "2026-05-13T10:00:00.000Z",
        scheduledBy: "board",
        externalRef: "secret-ticket",
      },
    });

    expect(fields).toMatchObject({
      companyId: "company-1",
      issueId: "issue-1",
      agentId: "agent-1",
      status: "scheduled",
      kind: "check",
      metadata: { externalRefRedacted: true },
    });
    expect(fields?.metadata).not.toHaveProperty("externalRef");
  });

  it("only schedules monitor rows for agent-owned active issues", () => {
    const policy = {
      kind: "check",
      nextCheckAt: "2026-05-13T10:00:00.000Z",
      scheduledBy: "board" as const,
    };

    expect(
      buildInitialIssueMonitorFields({
        companyId: "company-1",
        issue: { id: "issue-1", status: "in_review", assigneeAgentId: "agent-1" },
        policy,
      }),
    ).not.toBeNull();
    expect(
      buildInitialIssueMonitorFields({
        companyId: "company-1",
        issue: { id: "issue-1", status: "todo", assigneeAgentId: "agent-1" },
        policy,
      }),
    ).toBeNull();
    expect(
      buildInitialIssueMonitorFields({
        companyId: "company-1",
        issue: { id: "issue-1", status: "in_progress", assigneeAgentId: null },
        policy,
      }),
    ).toBeNull();
  });

  it("builds trigger and clear patches", () => {
    const now = new Date("2026-05-13T10:00:00.000Z");
    expect(buildIssueMonitorTriggeredPatch({ now, nextAttempt: 2 })).toMatchObject({
      status: "triggered",
      attemptCount: 2,
      lastTriggeredAt: now,
      nextCheckAt: null,
    });
    expect(buildIssueMonitorClearedPatch({ now, clearReason: "done" })).toMatchObject({
      status: "cleared",
      clearedAt: now,
      clearReason: "done",
    });
  });
});
