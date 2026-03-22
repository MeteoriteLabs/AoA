import { describe, it, expect, vi } from "vitest";

vi.mock("@paperclipai/db", () => {
  const makeTable = (name: string) => {
    const cols: Record<string, symbol> = {};
    return new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") {
          if (!cols[prop]) cols[prop] = Symbol(prop);
          return cols[prop];
        }
        return undefined;
      },
    });
  };

  return {
    agents: makeTable("agents"),
    companyMemberships: makeTable("company_memberships"),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  eq: (..._args: unknown[]) => "eq",
}));

type MockRow = Record<string, unknown>;

function createSequenceDb(config: {
  selects?: MockRow[][];
  updates?: MockRow[][];
} = {}) {
  let selectIdx = 0;
  let updateIdx = 0;
  const selects = config.selects ?? [];
  const updates = config.updates ?? [];

  function makeChain(getResult: () => MockRow[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "set", "values", "returning", "innerJoin", "leftJoin", "orderBy", "limit"]) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.then = (resolve: (v: MockRow[]) => unknown) => Promise.resolve(resolve(getResult()));
    return chain;
  }

  return {
    select: (..._args: unknown[]) => makeChain(() => selects[selectIdx++] ?? []),
    update: (..._args: unknown[]) => makeChain(() => updates[updateIdx++] ?? []),
    insert: (..._args: unknown[]) => makeChain(() => []),
    delete: (..._args: unknown[]) => makeChain(() => []),
  };
}

import { orgHierarchyService } from "../services/org-hierarchy.ts";

describe("orgHierarchyService", () => {
  describe("assertNoCycle", () => {
    it("allows null parent (root node)", async () => {
      const db = createSequenceDb();
      const svc = orgHierarchyService(db as any);

      // Should not throw
      await svc.assertNoCycle("company-1", "agent-1", "agent", null, null);
    });

    it("rejects self-reference", async () => {
      const db = createSequenceDb();
      const svc = orgHierarchyService(db as any);

      await expect(
        svc.assertNoCycle("company-1", "agent-1", "agent", "agent-1", "agent"),
      ).rejects.toThrow("Cannot set an entity as its own parent");
    });

    it("detects agent→agent cycle (A→B→A)", async () => {
      // Agent B's parent is agent A (parentType='agent', parentId='agent-1')
      const db = createSequenceDb({
        selects: [
          [{ parentType: "agent", parentId: "agent-1" }], // query for agent B's parent → points to A
        ],
      });
      const svc = orgHierarchyService(db as any);

      // Setting A's parent to B would create A→B→A cycle
      await expect(
        svc.assertNoCycle("company-1", "agent-1", "agent", "agent-2", "agent"),
      ).rejects.toThrow("circular chain");
    });

    it("allows valid chain with no cycle", async () => {
      // Agent B's parent is Agent C (no cycle when setting A's parent to B)
      const db = createSequenceDb({
        selects: [
          [{ parentType: "agent", parentId: "agent-3" }], // B's parent → C
          [{ parentType: null, parentId: null }],          // C's parent → null (root)
        ],
      });
      const svc = orgHierarchyService(db as any);

      await svc.assertNoCycle("company-1", "agent-1", "agent", "agent-2", "agent");
    });

    it("stops at depth limit (50 steps) without throwing", async () => {
      // Create a chain of 60 agents, none cycling back
      const selects: MockRow[][] = [];
      for (let i = 0; i < 60; i++) {
        selects.push([{ parentType: "agent", parentId: `agent-${i + 100}` }]);
      }
      const db = createSequenceDb({ selects });
      const svc = orgHierarchyService(db as any);

      // Should not throw — just stops after 50 steps
      await svc.assertNoCycle("company-1", "agent-0", "agent", "agent-99", "agent");
    });

    it("handles mixed agent→user chain without false positive", async () => {
      // Agent B parent is User X, User X parent is null
      const db = createSequenceDb({
        selects: [
          [{ parentType: "user", parentId: "user-x" }],  // agent B → user X
          [{ parentType: null, parentId: null }],          // user X → root
        ],
      });
      const svc = orgHierarchyService(db as any);

      await svc.assertNoCycle("company-1", "agent-1", "agent", "agent-2", "agent");
    });
  });

  describe("ensureParent", () => {
    it("accepts valid agent parent in same company", async () => {
      const db = createSequenceDb({
        selects: [[{ id: "agent-parent", status: "idle" }]],
      });
      const svc = orgHierarchyService(db as any);

      await svc.ensureParent("company-1", "agent", "agent-parent");
    });

    it("rejects missing agent parent", async () => {
      const db = createSequenceDb({
        selects: [[]],
      });
      const svc = orgHierarchyService(db as any);

      await expect(
        svc.ensureParent("company-1", "agent", "agent-nonexistent"),
      ).rejects.toThrow("Parent agent not found");
    });

    it("rejects terminated agent parent", async () => {
      const db = createSequenceDb({
        selects: [[{ id: "agent-parent", status: "terminated" }]],
      });
      const svc = orgHierarchyService(db as any);

      await expect(
        svc.ensureParent("company-1", "agent", "agent-parent"),
      ).rejects.toThrow("Cannot report to a terminated agent");
    });

    it("accepts valid user parent with active membership", async () => {
      const db = createSequenceDb({
        selects: [[{ principalId: "user-1" }]],
      });
      const svc = orgHierarchyService(db as any);

      await svc.ensureParent("company-1", "user", "user-1");
    });

    it("rejects user parent without active membership", async () => {
      const db = createSequenceDb({
        selects: [[]],
      });
      const svc = orgHierarchyService(db as any);

      await expect(
        svc.ensureParent("company-1", "user", "user-nonexistent"),
      ).rejects.toThrow("Parent user not found");
    });
  });

  describe("orphanChildren", () => {
    it("calls update on agents and companyMemberships tables", async () => {
      const updateCalls: string[] = [];
      const db = createSequenceDb({
        updates: [[], []], // two update calls (agents + company_memberships)
      });

      // Track update calls
      const origUpdate = db.update;
      db.update = (...args: unknown[]) => {
        updateCalls.push("update");
        return origUpdate(...args);
      };

      const svc = orgHierarchyService(db as any);
      await svc.orphanChildren("agent-1", "agent");

      expect(updateCalls).toHaveLength(2);
    });

    it("accepts custom txOrDb parameter", async () => {
      const tx = createSequenceDb({
        updates: [[], []],
      });
      const db = createSequenceDb();
      const svc = orgHierarchyService(db as any);

      // Should use tx, not db
      await svc.orphanChildren("agent-1", "agent", tx as any);
    });
  });
});
