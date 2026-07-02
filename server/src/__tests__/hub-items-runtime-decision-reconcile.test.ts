import { describe, expect, it, vi } from "vitest";
import { hubItemsService } from "../services/hub-items.js";
import { runtimeDecisionSourceSnapshot } from "../services/agent-runtime-decisions.js";

function thenableRows<T>(rows: T[]) {
  return {
    then: (resolve: (value: T[]) => unknown) => Promise.resolve(resolve(rows)),
  };
}

describe("hubItems runtime decision reconciliation", () => {
  it("refreshes open runtime decision items while relay_failed remains actionable", async () => {
    const openHubItem = {
      id: "hub-1",
      companyId: "company-1",
      sourceId: "decision-1",
      sourceType: "runtime_decision",
      semanticType: "agent_runtime_decision",
      status: "open",
      title: "Old title",
      summary: "Old summary",
      message: "Old summary",
      sourcePermissionRevision: "1",
      ownerUserId: "founder-1",
      ownerPool: null,
      scopeKey: null,
      version: 0,
      resolvedAt: null,
      archivedAt: null,
    };
    const runtimeDecision = {
      id: "decision-1",
      companyId: "company-1",
      status: "relay_failed",
      title: "Allow command?",
      summary: "Adapter hook disconnected",
      promptText: "pnpm test:run",
      relayError: "Adapter hook disconnected",
      sourceRevision: 2,
    };

    let selectCount = 0;
    const set = vi.fn(() => ({ where: vi.fn(async () => []) }));
    const db = {
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 1) {
          return { from: () => ({ where: () => thenableRows([openHubItem]) }) };
        }
        return {
          from: () => ({
            where: () => ({
              limit: () => thenableRows([runtimeDecision]),
            }),
          }),
        };
      }),
      update: vi.fn(() => ({ set })),
    } as never;

    const result = await hubItemsService(db).reconcile("company-1", {
      sourceType: "runtime_decision",
      sourceId: "decision-1",
    });

    expect(result).toEqual({ healed: 1, closed: 0, refreshed: 1 });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Allow command?",
        summary: "Adapter hook disconnected",
        message: "Adapter hook disconnected",
        sourcePermissionRevision: "2",
      }),
    );
  });

  it("keeps parked runtime decision timeouts visible with timeout context", async () => {
    const openHubItem = {
      id: "hub-1",
      companyId: "company-1",
      sourceId: "decision-1",
      sourceType: "runtime_decision",
      semanticType: "agent_runtime_decision",
      status: "open",
      title: "Old title",
      summary: "Old summary",
      message: "Old summary",
      sourcePermissionRevision: "1",
      ownerUserId: "founder-1",
      ownerPool: null,
      scopeKey: null,
      version: 0,
      resolvedAt: null,
      archivedAt: null,
    };
    const runtimeDecision = {
      id: "decision-1",
      companyId: "company-1",
      status: "cancelled",
      title: "Need direction",
      summary: "Original question",
      promptText: "Which path should I take?",
      relayError: "timeout policy parked the run",
      timeoutPolicy: "park_run",
      sourceRevision: 3,
    };

    let selectCount = 0;
    const set = vi.fn(() => ({ where: vi.fn(async () => []) }));
    const db = {
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 1) {
          return { from: () => ({ where: () => thenableRows([openHubItem]) }) };
        }
        return {
          from: () => ({
            where: () => ({
              limit: () => thenableRows([runtimeDecision]),
            }),
          }),
        };
      }),
      update: vi.fn(() => ({ set })),
    } as never;

    const result = await hubItemsService(db).reconcile("company-1", {
      sourceType: "runtime_decision",
      sourceId: "decision-1",
    });

    expect(result).toEqual({ healed: 1, closed: 0, refreshed: 1 });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Need direction",
        summary: "timeout policy parked the run",
        message: "timeout policy parked the run",
        sourcePermissionRevision: "3",
      }),
    );
  });

  it("reconciler output equals runtimeDecisionSourceSnapshot for parked timeout row", async () => {
    // Prove the reconciler delegates correctly — the output must match
    // runtimeDecisionSourceSnapshot(row) for the parked-timeout branch (the
    // branch most likely to drift if the logic is ever re-inlined).
    const parkedRow = {
      id: "decision-park",
      companyId: "company-1",
      agentId: "agent-1",
      runId: "run-1",
      adapterType: "claude_local",
      adapterSessionId: null,
      adapterSessionParams: null,
      kind: "permission",
      status: "cancelled",
      nonce: "abc123",
      sourceRevision: 5,
      promptHash: null,
      sourceUniqueKey: null,
      title: "Parked: approve shell command?",
      summary: "Command was paused",
      promptText: "Run rm -rf /tmp/old?",
      toolName: "bash",
      command: "rm -rf /tmp/old",
      commandHash: null,
      cwd: null,
      path: "/tmp/old",
      networkTarget: null,
      riskClass: "high",
      options: null,
      timeoutPolicy: "park_run",
      expiresAt: null,
      decision: null,
      answerPayload: null,
      answerIdempotencyKey: null,
      answeredByUserId: null,
      answeredAt: null,
      relayedAt: null,
      relayError: "timeout policy parked the run",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T01:00:00Z"),
    } as Parameters<typeof runtimeDecisionSourceSnapshot>[0];

    const openHubItem = {
      id: "hub-park",
      companyId: "company-1",
      sourceId: "decision-park",
      sourceType: "runtime_decision",
      semanticType: "agent_runtime_decision",
      status: "open",
      title: "Old title",
      summary: "Old summary",
      message: "Old summary",
      sourcePermissionRevision: "1",
      ownerUserId: "founder-1",
      ownerPool: null,
      scopeKey: null,
      version: 0,
      resolvedAt: null,
      archivedAt: null,
    };

    let selectCount = 0;
    const set = vi.fn(() => ({ where: vi.fn(async () => []) }));
    const db = {
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 1) {
          return { from: () => ({ where: () => thenableRows([openHubItem]) }) };
        }
        return {
          from: () => ({
            where: () => ({
              limit: () => thenableRows([parkedRow]),
            }),
          }),
        };
      }),
      update: vi.fn(() => ({ set })),
    } as never;

    // The expected snapshot via the canonical function
    const expected = runtimeDecisionSourceSnapshot(parkedRow);

    // The reconciler must produce the same values — it now delegates to that function
    await hubItemsService(db).reconcile("company-1", {
      sourceType: "runtime_decision",
      sourceId: "decision-park",
    });

    // The parked row is non-terminal (isVisibleTimeoutFollowUp = true), so the
    // reconciler refreshes the hub item (rather than closing it). Verify the
    // patch values match what runtimeDecisionSourceSnapshot returned.
    expect(expected.terminal).toBe(false);
    expect(expected.summary).toBe("timeout policy parked the run"); // relayError branch
    expect(expected.permissionRevision).toBe("5");
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expected.title,
        summary: expected.summary,
        message: expected.summary,
        sourcePermissionRevision: expected.permissionRevision,
      }),
    );
  });
});
