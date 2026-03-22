import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @paperclipai/db to avoid drizzle-orm ESM cycle
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

import { orgHierarchyService } from "../services/org-hierarchy.js";

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
    _selectIdx: () => selectIdx,
    _updateIdx: () => updateIdx,
  } as unknown;
}

describe("orgHierarchyService", () => {
  describe("ensureParent", () => {
    it("validates parent agent exists and is not terminated", async () => {
      const db = createSequenceDb({
        selects: [
          [{ id: "agent-1", status: "active" }],
        ],
      });
      const svc = orgHierarchyService(db as any);
      await expect(svc.ensureParent("company-1", "agent", "agent-1")).resolves.toBeUndefined();
    });

    it("throws when parent agent not found", async () => {
      const db = createSequenceDb({ selects: [[]] });
      const svc = orgHierarchyService(db as any);
      await expect(svc.ensureParent("company-1", "agent", "nonexistent")).rejects.toThrow(
        "Parent agent not found",
      );
    });

    it("throws when parent agent is terminated", async () => {
      const db = createSequenceDb({
        selects: [[{ id: "agent-1", status: "terminated" }]],
      });
      const svc = orgHierarchyService(db as any);
      await expect(svc.ensureParent("company-1", "agent", "agent-1")).rejects.toThrow(
        "Cannot report to a terminated agent",
      );
    });

    it("validates parent user has active membership", async () => {
      const db = createSequenceDb({
        selects: [[{ principalId: "user-1" }]],
      });
      const svc = orgHierarchyService(db as any);
      await expect(svc.ensureParent("company-1", "user", "user-1")).resolves.toBeUndefined();
    });

    it("throws when parent user not found or inactive", async () => {
      const db = createSequenceDb({ selects: [[]] });
      const svc = orgHierarchyService(db as any);
      await expect(svc.ensureParent("company-1", "user", "nonexistent")).rejects.toThrow(
        "Parent user not found or not active",
      );
    });
  });

  describe("assertNoCycle", () => {
    it("allows null parent (root node)", async () => {
      const db = createSequenceDb();
      const svc = orgHierarchyService(db as any);
      await expect(svc.assertNoCycle("c1", "user-1", "user", null, null)).resolves.toBeUndefined();
    });

    it("throws on self-reference", async () => {
      const db = createSequenceDb();
      const svc = orgHierarchyService(db as any);
      await expect(svc.assertNoCycle("c1", "user-1", "user", "user-1", "user")).rejects.toThrow(
        "Cannot set an entity as its own parent",
      );
    });

    it("detects cycle: A → B → A", async () => {
      // user-A wants to report to user-B
      // user-B's parent is user-A → cycle!
      const db = createSequenceDb({
        selects: [
          // lookup user-B's parent → user-A
          [{ parentType: "user", parentId: "user-A" }],
        ],
      });
      const svc = orgHierarchyService(db as any);
      await expect(
        svc.assertNoCycle("c1", "user-A", "user", "user-B", "user"),
      ).rejects.toThrow("circular reporting chain");
    });

    it("allows valid chain without cycle", async () => {
      // user-A wants to report to user-B
      // user-B has no parent (root)
      const db = createSequenceDb({
        selects: [
          // lookup user-B's parent → null
          [{ parentType: null, parentId: null }],
        ],
      });
      const svc = orgHierarchyService(db as any);
      await expect(
        svc.assertNoCycle("c1", "user-A", "user", "user-B", "user"),
      ).resolves.toBeUndefined();
    });

    it("detects cycle through mixed agent-user chain", async () => {
      // agent-A wants to report to user-B
      // user-B's parent is agent-A → cycle!
      const db = createSequenceDb({
        selects: [
          // lookup user-B (type=user) parent → agent-A
          [{ parentType: "agent", parentId: "agent-A" }],
        ],
      });
      const svc = orgHierarchyService(db as any);
      await expect(
        svc.assertNoCycle("c1", "agent-A", "agent", "user-B", "user"),
      ).rejects.toThrow("circular reporting chain");
    });
  });

  describe("orphanChildren", () => {
    it("orphans both agent and user children", async () => {
      const updateCalls: string[] = [];
      const mockTx = {
        update: (table: any) => {
          const chain: Record<string, unknown> = {};
          for (const m of ["set", "where", "from"]) {
            chain[m] = (..._args: unknown[]) => {
              if (m === "set") updateCalls.push("update");
              return chain;
            };
          }
          chain.then = (resolve: (v: any[]) => unknown) => Promise.resolve(resolve([]));
          return chain;
        },
      };

      const db = createSequenceDb();
      const svc = orgHierarchyService(db as any);
      await svc.orphanChildren("user-1", "user", mockTx as any);
      // Should have called update twice: once for agents, once for company_memberships
      expect(updateCalls).toHaveLength(2);
    });
  });
});
