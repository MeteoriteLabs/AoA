import { describe, expect, it, vi } from "vitest";
import { hubItemsService } from "../services/hub-items.js";

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
});
