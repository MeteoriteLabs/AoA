// CLI-006 (D2) — the canary preflight store reads its three privileged evidence
// scalars through the SECURITY DEFINER wrapper, NOT through MIG-008's drizzle store.
//
// This file originally asserted the opposite: that `listLeases` / `platformDefaultEnv` /
// `currentKeyGeneration` were the SAME function references as
// `createDrizzleReconciliationStore`'s, so a fork could never silently read a different
// inventory. That rationale was right about WHAT to read and wrong about WHO reads it.
//
// BLOCKER E (E-1): the reconciler's store queries `environment_leases` / `environments` /
// `runtime_provider_keys` / `company_secret_versions` DIRECTLY, while the preflight store
// runs on the NON-OWNER `aoa_app` pool, which holds ZERO privileges on all four. Every
// delegated call raised 42501, `canary-preflight.ts:191-200` folded it into
// `preflight_error`, and the gate answered "I could not read" — a refusal indistinguishable
// from a policy decision. Reference identity with the reconciler's store is now the WRONG
// invariant; the reads go through migration 0266's owner-owned definer function instead.
//
// The anti-drift guarantee survives in a different form: the definer function reads the
// SAME rows with the SAME predicates, and the tests below pin that each member is sourced
// from `readCanaryPreflightEvidence` rather than re-querying anything itself.

import { beforeEach, describe, expect, it, vi } from "vitest";

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

const readCanaryPreflightEvidence = vi.fn();
vi.mock("../services/canary-preflight-evidence.js", () => ({
  readCanaryPreflightEvidence: (...args: unknown[]) => readCanaryPreflightEvidence(...args),
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

describe("CLI-006 — canary preflight store reads through the definer function", () => {
  const db = {} as never;
  const store = createDrizzleCanaryPreflightStore(db);

  beforeEach(() => {
    readCanaryPreflightEvidence.mockReset();
  });

  it.each([
    ["listLeases", () => listLeases],
    ["platformDefaultEnv", () => platformDefaultEnv],
    ["currentKeyGeneration", () => currentKeyGeneration],
  ])("no longer delegates `%s` to MIG-008's drizzle store", (name, forbidden) => {
    // The reconciler's store is permission-denied on this pool; reusing its members by
    // reference is exactly the defect BLOCKER E names.
    expect(typeof store[name as "listLeases"], name).toBe("function");
    expect(store[name as "listLeases"], name).not.toBe(forbidden());
  });

  it("sources `listLeases` from the definer function, narrowed to lease ids", async () => {
    readCanaryPreflightEvidence.mockResolvedValue({
      leaseIds: ["lease-1", "lease-2"],
      platformDefaultEnvironmentId: null,
      keyGeneration: null,
    });

    await expect(store.listLeases("co-1")).resolves.toEqual([{ id: "lease-1" }, { id: "lease-2" }]);
    expect(readCanaryPreflightEvidence).toHaveBeenCalledWith(db, "co-1");
  });

  it.each([
    [null, null],
    ["env-1", { environmentId: "env-1" }],
  ])("maps platform-default env %s through the definer function", async (id, expected) => {
    readCanaryPreflightEvidence.mockResolvedValue({
      leaseIds: [],
      platformDefaultEnvironmentId: id,
      keyGeneration: null,
    });

    await expect(store.platformDefaultEnv("co-1")).resolves.toEqual(expected);
    expect(readCanaryPreflightEvidence).toHaveBeenCalledWith(db, "co-1");
  });

  it("sources `currentKeyGeneration` from the definer function", async () => {
    readCanaryPreflightEvidence.mockResolvedValue({
      leaseIds: [],
      platformDefaultEnvironmentId: null,
      keyGeneration: "sec-1:3",
    });

    await expect(store.currentKeyGeneration("co-1")).resolves.toBe("sec-1:3");
    expect(readCanaryPreflightEvidence).toHaveBeenCalledWith(db, "co-1");
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
