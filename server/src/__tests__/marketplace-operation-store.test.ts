import { describe, it, expect, vi } from "vitest";

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return { marketplaceInstallOperations: tableProxy };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("eq"),
  and: () => Symbol("and"),
  gt: () => Symbol("gt"),
}));

import { createOperation } from "../services/marketplace-install/operation-store.js";
import type { CreateOperationInput } from "../services/marketplace-install/operation-store.js";
import type { CatalogItem } from "@armyofagents/shared";

const SKILL_ITEM: CatalogItem = {
  id: "skill:aoa-curated/code-review",
  type: "skill",
  name: "Code Review",
  description: "...",
  version: "1.0.0",
  source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  category: "engineering",
  tags: [],
};

const EXISTING_ROW = {
  id: "existing-op-uuid",
  companyId: "c1",
  catalogItemId: "skill:aoa-curated/code-review",
  itemType: "skill" as const,
  targetDepartmentId: null,
  status: "success" as const,
  resultEntityId: "skill-uuid-1",
  errorMessage: null,
  cascadeResults: null,
  idempotencyKey: "idem-key-1",
  requestedByUserId: "user-1",
  startedAt: new Date("2026-04-01T00:00:00Z"),
  completedAt: new Date("2026-04-01T00:01:00Z"),
  createdAt: new Date("2026-04-01T00:00:00Z"),
};

const INPUT: CreateOperationInput = {
  companyId: "c1",
  catalogItem: SKILL_ITEM,
  idempotencyKey: "idem-key-1",
  requestedByUserId: "user-1",
};

describe("createOperation — conflict handling", () => {
  it("returns the new row when insert succeeds (happy path)", async () => {
    const NEW_ROW = { ...EXISTING_ROW, id: "new-op-uuid", createdAt: new Date() };
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([NEW_ROW]),
          }),
        }),
      }),
    };

    const result = await createOperation(db as any, INPUT);
    expect(result.id).toBe("new-op-uuid");
  });

  it("fetches and returns existing row when insert conflicts (stale idempotency key)", async () => {
    let selectCalled = false;
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]), // conflict — empty
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => {
            selectCalled = true;
            return {
              limit: () => Promise.resolve([EXISTING_ROW]),
            };
          },
        }),
      }),
    };

    const result = await createOperation(db as any, INPUT);
    expect(selectCalled).toBe(true);
    expect(result.id).toBe("existing-op-uuid");
  });

  it("throws if insert conflicts and the fallback select finds nothing (extreme race)", async () => {
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([]), // conflict
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]), // gone
          }),
        }),
      }),
    };

    await expect(createOperation(db as any, INPUT)).rejects.toThrow(
      /idempotency conflict.*not found/i,
    );
  });

  it("skips the fallback select when insert succeeds (no idempotencyKey provided)", async () => {
    const NEW_ROW = { ...EXISTING_ROW, id: "new-op-no-key", idempotencyKey: null };
    let selectCalled = false;
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve([NEW_ROW]),
          }),
        }),
      }),
      select: () => {
        selectCalled = true;
        return {} as any;
      },
    };

    const inputNoKey: CreateOperationInput = { ...INPUT, idempotencyKey: undefined };
    const result = await createOperation(db as any, inputNoKey);
    expect(result.id).toBe("new-op-no-key");
    expect(selectCalled).toBe(false);
  });
});
