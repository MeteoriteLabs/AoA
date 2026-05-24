import { describe, expect, it, vi } from "vitest";
import { agentApiKeys, agents } from "@armyofagents/db";
import { authorizeCompanyUpgrade } from "../services/upgrade-auth.js";

function makeUpgradeAuthDb(input: {
  key?: Record<string, unknown> | null;
  agent?: Record<string, unknown> | null;
}) {
  return {
    select: vi.fn(() => {
      let table: unknown = null;
      const chain = {
        from(nextTable: unknown) {
          table = nextTable;
          return chain;
        },
        where() {
          return chain;
        },
        then(resolve: (rows: unknown[]) => unknown) {
          const rows =
            table === agentApiKeys
              ? input.key
                ? [input.key]
                : []
              : table === agents && input.agent
                ? [input.agent]
                : [];
          return Promise.resolve(resolve(rows));
        },
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  };
}

describe("authorizeCompanyUpgrade", () => {
  it("rejects agent API keys for pending or terminated agents", async () => {
    for (const status of ["pending_approval", "terminated"]) {
      const db = makeUpgradeAuthDb({
        key: { id: `key-${status}`, companyId: "company-1", agentId: "agent-1" },
        agent: { id: "agent-1", companyId: "company-1", status },
      });

      const actor = await authorizeCompanyUpgrade(
        db as any,
        { headers: { authorization: "Bearer secret" } } as any,
        "company-1",
        new URL("ws://aoa.local/preview/services/svc-1/ws"),
        { deploymentMode: "authenticated" },
      );

      expect(actor).toBeNull();
      expect(db.update).not.toHaveBeenCalled();
    }
  });

  it("accepts active agent API keys for the same company", async () => {
    const db = makeUpgradeAuthDb({
      key: { id: "key-1", companyId: "company-1", agentId: "agent-1" },
      agent: { id: "agent-1", companyId: "company-1", status: "idle" },
    });

    const actor = await authorizeCompanyUpgrade(
      db as any,
      { headers: { authorization: "Bearer secret" } } as any,
      "company-1",
      new URL("ws://aoa.local/preview/services/svc-1/ws"),
      { deploymentMode: "authenticated" },
    );

    expect(actor).toEqual({
      companyId: "company-1",
      actorType: "agent",
      actorId: "agent-1",
    });
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});
