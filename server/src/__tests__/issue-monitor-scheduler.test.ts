import { describe, expect, it } from "vitest";

import {
  ISSUE_MONITOR_DUE_REASON,
  buildIssueMonitorWake,
  shouldClearDueIssueMonitor,
} from "../services/issue-monitor-scheduler.js";

describe("issue monitor scheduler helpers", () => {
  it("builds cheap-profile monitor wake payloads with deterministic idempotency keys", () => {
    expect(
      buildIssueMonitorWake({
        monitorId: "monitor-1",
        issueId: "issue-1",
        agentId: "agent-1",
        companyId: "company-1",
        nextAttempt: 2,
      }),
    ).toMatchObject({
      companyId: "company-1",
      agentId: "agent-1",
      reason: ISSUE_MONITOR_DUE_REASON,
      idempotencyKey: "issue_monitor_due:monitor-1:2",
      payload: {
        issueId: "issue-1",
        monitorId: "monitor-1",
        wakeReason: ISSUE_MONITOR_DUE_REASON,
        monitorAttempt: 2,
        modelProfileHint: "cheap",
        recoveryModelProfile: "cheap",
      },
    });
  });

  it("clears due monitors when timeout or max attempts are exhausted", () => {
    const now = new Date(Date.UTC(2026, 4, 13, 12));

    expect(
      shouldClearDueIssueMonitor({
        attemptCount: 3,
        maxAttempts: 3,
        timeoutAt: null,
        now,
      }),
    ).toBe("max_attempts_exhausted");
    expect(
      shouldClearDueIssueMonitor({
        attemptCount: 0,
        maxAttempts: null,
        timeoutAt: new Date(now.getTime() - 1),
        now,
      }),
    ).toBe("timeout_exceeded");
    expect(
      shouldClearDueIssueMonitor({
        attemptCount: 0,
        maxAttempts: 2,
        timeoutAt: new Date(now.getTime() + 1_000),
        now,
      }),
    ).toBeNull();
  });
});
