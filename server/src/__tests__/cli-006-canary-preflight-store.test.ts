// CLI-006 (D2) — the canary preflight store DELEGATES to MIG-008's store.
//
// The gate must see exactly the inventory the reconciler recorded. A parallel
// re-implementation of `listLeases` / `platformDefaultEnv` / `currentKeyGeneration`
// is how CLI-002's memory bundle drifted from the crew lineage it claimed parity
// with and silently dropped the `status='approved'` predicate — a security gate
// bypass that only an adversarial review caught.
//
// These tests make divergence structurally impossible rather than merely unlikely:
// the delegated members must be the SAME function references, so a future edit that
// forks them fails here instead of silently reading a different inventory.

import { describe, expect, it, vi } from "vitest";

const listLeases = vi.fn();
const platformDefaultEnv = vi.fn();
const currentKeyGeneration = vi.fn();
const casClaimPaused = vi.fn();
const insertRecordIfAbsent = vi.fn();

vi.mock("../services/legacy-resource-reconciliation-store.js", () => ({
  createDrizzleReconciliationStore: () => ({
    listLeases,
    platformDefaultEnv,
    currentKeyGeneration,
    casClaimPaused,
    insertRecordIfAbsent,
  }),
}));

vi.mock("@armyofagents/db", () => {
  const table = new Proxy({}, { get: (_t, p) => Symbol(String(p)) });
  return { companies: table, legacyResourceReconciliation: table };
});

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ and: a }),
  eq: (...a: unknown[]) => ({ eq: a }),
}));

const { createDrizzleCanaryPreflightStore } = await import("../services/canary-preflight-store.js");

describe("CLI-006 — canary preflight store delegates to MIG-008", () => {
  const store = createDrizzleCanaryPreflightStore({} as never);

  it.each([
    ["listLeases", () => listLeases],
    ["platformDefaultEnv", () => platformDefaultEnv],
    ["currentKeyGeneration", () => currentKeyGeneration],
  ])("reuses MIG-008's `%s` by reference, never a re-implementation", (name, expected) => {
    expect(store[name as "listLeases"]).toBe(expected());
  });

  // The gate is READ-ONLY by construction: it must not even be able to reconcile
  // as a side effect of being consulted.
  it.each(["casClaimPaused", "insertRecordIfAbsent"])(
    "does NOT expose the mutating member `%s`",
    (name) => {
      expect((store as Record<string, unknown>)[name]).toBeUndefined();
    },
  );

  it("adds the two reads MIG-008's store does not have", () => {
    expect(typeof store.listOrganizationCompanyIds).toBe("function");
    expect(typeof store.listRecords).toBe("function");
  });
});
