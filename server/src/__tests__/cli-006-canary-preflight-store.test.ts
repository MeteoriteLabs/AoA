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
// The anti-drift guarantee survives in a different form: the definer functions read the
// SAME rows with the SAME predicates, and the tests below pin that each member is sourced
// from the wrapper rather than re-querying anything itself.
//
// ROUND 6 — there are now TWO functions and NO shared state. A single function returning one
// row per lease forced a choice between two defects: the two scalar-only members hydrating the
// whole lease inventory to read one scalar, or a single-flight coalescing them. That
// single-flight was store-global and keyed only by company, so two OVERLAPPING `check()` calls
// shared one snapshot and a lease committed between them was invisible to the second — the
// fail-open `canary-preflight.ts:30-33` refuses to cache in order to prevent. Splitting the
// function dissolves the choice instead of scoping it, so the tests below pin INDEPENDENCE
// (every call reads) rather than coalescing.

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

const readCanaryPreflightLeaseIds = vi.fn();
const readCanaryPreflightScalars = vi.fn();
vi.mock("../services/canary-preflight-evidence.js", () => ({
  readCanaryPreflightLeaseIds: (...args: unknown[]) => readCanaryPreflightLeaseIds(...args),
  readCanaryPreflightScalars: (...args: unknown[]) => readCanaryPreflightScalars(...args),
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
    readCanaryPreflightLeaseIds.mockReset();
    readCanaryPreflightScalars.mockReset();
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

  it("sources `listLeases` from the leases function, narrowed to lease ids", async () => {
    readCanaryPreflightLeaseIds.mockResolvedValue(["lease-1", "lease-2"]);

    await expect(store.listLeases("co-1")).resolves.toEqual([{ id: "lease-1" }, { id: "lease-2" }]);
    expect(readCanaryPreflightLeaseIds).toHaveBeenCalledWith(db, "co-1");
  });

  it.each([
    [null, null],
    ["env-1", { environmentId: "env-1" }],
  ])("maps platform-default env %s through the scalars function", async (id, expected) => {
    readCanaryPreflightScalars.mockResolvedValue({
      platformDefaultEnvironmentId: id,
      keyGeneration: null,
    });

    await expect(store.platformDefaultEnv("co-1")).resolves.toEqual(expected);
    expect(readCanaryPreflightScalars).toHaveBeenCalledWith(db, "co-1");
  });

  it("sources `currentKeyGeneration` from the scalars function", async () => {
    readCanaryPreflightScalars.mockResolvedValue({
      platformDefaultEnvironmentId: null,
      keyGeneration: "sec-1:3",
    });

    await expect(store.currentKeyGeneration("co-1")).resolves.toBe("sec-1:3");
    expect(readCanaryPreflightScalars).toHaveBeenCalledWith(db, "co-1");
  });

  // ROUND 6. The gate fires all three members in ONE `Promise.all`
  // (`canary-preflight.ts:139-145`). The contract that matters is INDEPENDENCE: this gate is
  // "deliberately NOT cached" (`canary-preflight.ts:30-33`) because a stale `true` outliving a
  // newly-unreconciled resource is the fail-open the module exists to close. A store-global
  // single-flight broke that for OVERLAPPING checks; two functions with no shared state cannot.
  it("reads independently on every call — no coalescing, even within one burst", async () => {
    readCanaryPreflightLeaseIds.mockResolvedValue(["lease-1"]);
    readCanaryPreflightScalars.mockResolvedValue({
      platformDefaultEnvironmentId: "env-1",
      keyGeneration: "sec-1:2",
    });

    const [leases, platformDefault, keyGeneration] = await Promise.all([
      store.listLeases("co-1"),
      store.platformDefaultEnv("co-1"),
      store.currentKeyGeneration("co-1"),
    ]);

    expect(leases).toEqual([{ id: "lease-1" }]);
    expect(platformDefault).toEqual({ environmentId: "env-1" });
    expect(keyGeneration).toBe("sec-1:2");
    // Two scalar members, two scalar reads: nothing is shared or replayed.
    expect(readCanaryPreflightScalars).toHaveBeenCalledTimes(2);
  });

  it("never lets a scalar read touch the lease inventory", async () => {
    // The point of the split. `environment_leases` is scanned by `listLeases` and by nothing
    // else — which is what the pre-BLOCKER-E code did, and what a comment here once claimed
    // while three reads were in fact scanning it.
    readCanaryPreflightScalars.mockResolvedValue({
      platformDefaultEnvironmentId: null,
      keyGeneration: null,
    });

    await Promise.all([store.platformDefaultEnv("co-1"), store.currentKeyGeneration("co-1")]);

    expect(readCanaryPreflightLeaseIds).not.toHaveBeenCalled();
  });

  it("does not share state between overlapping reads for the same company", async () => {
    // The round-6 defect: a store-global in-flight map keyed by company let a SECOND, later
    // `check()` reuse the FIRST check's snapshot, so a lease committed in between was
    // invisible to it. With no shared state, every overlapping call reads for itself.
    let resolveFirst: ((v: readonly string[]) => void) | undefined;
    readCanaryPreflightLeaseIds
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce(["lease-late"]);

    const first = store.listLeases("co-1");
    const second = store.listLeases("co-1");
    resolveFirst?.([]);

    expect(await first).toEqual([]);
    expect(await second).toEqual([{ id: "lease-late" }]);
    expect(readCanaryPreflightLeaseIds).toHaveBeenCalledTimes(2);
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
