// CLI-006 (D2) — the MIG-008 canary preflight.
//
// Acceptance (program-design.md:794): "MIG-008 has reconciled legacy environment
// leases/resources and moved provider-control authority BEFORE the rollout flag can
// transfer the first live execution."
//
// Two properties carry the whole gate (design §2.7-8):
//   1. Closure is COMPUTED, not stored — MIG-008 persists crosswalk records and
//      `assertClosure` is a pure function, so the preflight RE-DERIVES closure
//      read-only rather than trusting a flag. `reconcileCompanyLegacyResources`
//      cannot be reused: it CAS-claims and inserts (it mutates).
//   2. Closure is COMPANY-scoped while the canary flag is ORGANIZATION-scoped, and
//      an Organization may hold many Companies — so the gate must enumerate EVERY
//      Company under the Organization. Checking only the run's Company is a
//      fail-open, and is the first thing an adversarial review should try.
//
// Everything that is not a clean, current, complete reconciliation refuses.

import { describe, expect, it } from "vitest";
import {
  createCanaryPreflight,
  type CanaryPreflightStore,
} from "../services/canary-preflight.js";
import { CANARY_CREDENTIAL_AUTHORITY } from "../services/canary-mint-authority.js";
import {
  resourceKeyForLease,
  resourceKeyForPlatformDefaultEnv,
  type LegacyLeaseInput,
  type ReconciliationRecord,
} from "../services/legacy-resource-reconciliation.js";

const ORG = "55555555-5555-4555-8555-555555555555";
const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY_GEN = "secret-1:5";

function lease(overrides: Partial<LegacyLeaseInput> & { id: string; companyId: string }): LegacyLeaseInput {
  return {
    environmentId: null,
    status: "released",
    leasePolicy: "ephemeral",
    provider: "e2b",
    providerLeaseId: null,
    agentId: null,
    commanderConversationId: null,
    executionWorkspaceId: null,
    issueId: null,
    heartbeatRunId: null,
    cleanupStatus: null,
    ...overrides,
  };
}

function record(overrides: Partial<ReconciliationRecord> & { companyId: string; resourceKey: string }): ReconciliationRecord {
  return {
    environmentLeaseId: null,
    environmentId: null,
    resourceType: "ephemeral",
    legacyStatus: "released",
    provider: "e2b",
    providerLeaseId: null,
    disposition: "terminal_cleanup",
    resourceLabelsHash: null,
    keyGeneration: KEY_GEN,
    cleanupOutcome: null,
    reason: "test fixture",
    ...overrides,
  };
}

/** A store where both Companies of the Organization are cleanly reconciled. */
function cleanStore(): CanaryPreflightStore {
  const leases: Record<string, LegacyLeaseInput[]> = {
    [COMPANY_A]: [lease({ id: "1easeaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", companyId: COMPANY_A })],
    [COMPANY_B]: [lease({ id: "1easebbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", companyId: COMPANY_B })],
  };
  const records: Record<string, ReconciliationRecord[]> = {
    [COMPANY_A]: [
      record({
        companyId: COMPANY_A,
        resourceKey: resourceKeyForLease("1easeaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      }),
    ],
    [COMPANY_B]: [
      record({
        companyId: COMPANY_B,
        resourceKey: resourceKeyForLease("1easebbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      }),
    ],
  };
  return {
    listOrganizationCompanyIds: async () => [COMPANY_A, COMPANY_B],
    listLeases: async (companyId) => leases[companyId] ?? [],
    platformDefaultEnv: async () => null,
    listRecords: async (companyId) => records[companyId] ?? [],
    currentKeyGeneration: async () => KEY_GEN,
  };
}

function withStore(overrides: Partial<CanaryPreflightStore>): CanaryPreflightStore {
  return { ...cleanStore(), ...overrides };
}

describe("CLI-006 D2 — canary preflight (fail-closed, org-wide, recomputed)", () => {
  it("admits an Organization whose every Company is cleanly reconciled at the current key generation", async () => {
    const preflight = createCanaryPreflight({ store: cleanStore() });
    const result = await preflight.check({ organizationId: ORG });
    expect(result.ok).toBe(true);
  });

  // The fail-open the scope mismatch invites.
  it("REFUSES when a SIBLING Company in the Organization is unreconciled", async () => {
    const preflight = createCanaryPreflight({
      store: withStore({
        // Company B has a legacy lease with no crosswalk record.
        listRecords: async (companyId) =>
          companyId === COMPANY_B
            ? []
            : [
                record({
                  companyId: COMPANY_A,
                  resourceKey: resourceKeyForLease("1easeaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
                }),
              ],
      }),
    });
    const result = await preflight.check({ organizationId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("reconciliation_incomplete");
    expect(result.companyId).toBe(COMPANY_B);
  });

  it("REFUSES when a resource is recorded `unattributable`", async () => {
    const preflight = createCanaryPreflight({
      store: withStore({
        listRecords: async (companyId) =>
          companyId === COMPANY_A
            ? [
                record({
                  companyId: COMPANY_A,
                  resourceKey: resourceKeyForLease("1easeaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
                  disposition: "unattributable",
                  resourceType: "unattributable",
                }),
              ]
            : [
                record({
                  companyId: COMPANY_B,
                  resourceKey: resourceKeyForLease("1easebbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
                }),
              ],
      }),
    });
    const result = await preflight.check({ organizationId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("reconciliation_incomplete");
  });

  it("REFUSES when the platform-default environment has no crosswalk record", async () => {
    const preflight = createCanaryPreflight({
      store: withStore({
        platformDefaultEnv: async (companyId) =>
          companyId === COMPANY_A ? { environmentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" } : null,
      }),
    });
    const result = await preflight.check({ organizationId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("reconciliation_incomplete");
  });

  it("ADMITS when the platform-default environment IS reconciled", async () => {
    const environmentId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const preflight = createCanaryPreflight({
      store: withStore({
        platformDefaultEnv: async (companyId) => (companyId === COMPANY_A ? { environmentId } : null),
        listRecords: async (companyId) =>
          companyId === COMPANY_A
            ? [
                record({
                  companyId: COMPANY_A,
                  resourceKey: resourceKeyForLease("1easeaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
                }),
                record({
                  companyId: COMPANY_A,
                  resourceKey: resourceKeyForPlatformDefaultEnv(environmentId),
                }),
              ]
            : [
                record({
                  companyId: COMPANY_B,
                  resourceKey: resourceKeyForLease("1easebbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
                }),
              ],
      }),
    });
    expect((await preflight.check({ organizationId: ORG })).ok).toBe(true);
  });

  // Credential authority — the second half of the acceptance clause.
  it("REFUSES when a record carries a SUPERSEDED key generation", async () => {
    const preflight = createCanaryPreflight({
      store: withStore({
        listRecords: async (companyId) =>
          companyId === COMPANY_A
            ? [
                record({
                  companyId: COMPANY_A,
                  resourceKey: resourceKeyForLease("1easeaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
                  keyGeneration: "secret-1:4",
                }),
              ]
            : [
                record({
                  companyId: COMPANY_B,
                  resourceKey: resourceKeyForLease("1easebbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
                }),
              ],
      }),
    });
    const result = await preflight.check({ organizationId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("credential_authority_not_moved");
  });

  it("REFUSES when provider-control authority has not moved at all (no key generation)", async () => {
    const preflight = createCanaryPreflight({
      store: withStore({ currentKeyGeneration: async () => null }),
    });
    const result = await preflight.check({ organizationId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("credential_authority_not_moved");
  });

  it("REFUSES when the Organization resolves to no Companies (nothing was reconciled)", async () => {
    const preflight = createCanaryPreflight({
      store: withStore({ listOrganizationCompanyIds: async () => [] }),
    });
    const result = await preflight.check({ organizationId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("no_companies");
  });

  // Fail-closed on unreadability — never "assume reconciled".
  it("REFUSES (never throws) when the store throws", async () => {
    const preflight = createCanaryPreflight({
      store: withStore({
        listLeases: async () => {
          throw new Error("db down");
        },
      }),
    });
    const result = await preflight.check({ organizationId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("preflight_error");
  });

  it("REFUSES when company enumeration itself throws", async () => {
    const preflight = createCanaryPreflight({
      store: withStore({
        listOrganizationCompanyIds: async () => {
          throw new Error("db down");
        },
      }),
    });
    const result = await preflight.check({ organizationId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("preflight_error");
  });

  // A legacy lease created AFTER reconciliation must re-close the gate — the
  // self-healing direction the design commits to (§4 D2).
  it("REFUSES again when a NEW legacy lease appears after a clean reconciliation", async () => {
    const store = cleanStore();
    const preflight = createCanaryPreflight({ store });
    expect((await preflight.check({ organizationId: ORG })).ok).toBe(true);

    const withNewLease = createCanaryPreflight({
      store: {
        ...store,
        listLeases: async (companyId) =>
          companyId === COMPANY_A
            ? [
                lease({ id: "1easeaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", companyId: COMPANY_A }),
                lease({ id: "1easenew-nnnn-4nnn-8nnn-nnnnnnnnnnnn", companyId: COMPANY_A }),
              ]
            : store.listLeases(companyId),
      },
    });
    const result = await withNewLease.check({ organizationId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("reconciliation_incomplete");
  });

  // The preflight is read-only: it must not reuse the mutating reconcile pass.
  it("performs NO writes (read-only store surface only)", async () => {
    const calls: string[] = [];
    const store = cleanStore();
    const preflight = createCanaryPreflight({
      store: {
        listOrganizationCompanyIds: async (...a) => {
          calls.push("listOrganizationCompanyIds");
          return store.listOrganizationCompanyIds(...a);
        },
        listLeases: async (...a) => {
          calls.push("listLeases");
          return store.listLeases(...a);
        },
        platformDefaultEnv: async (...a) => {
          calls.push("platformDefaultEnv");
          return store.platformDefaultEnv(...a);
        },
        listRecords: async (...a) => {
          calls.push("listRecords");
          return store.listRecords(...a);
        },
        currentKeyGeneration: async (...a) => {
          calls.push("currentKeyGeneration");
          return store.currentKeyGeneration(...a);
        },
      },
    });
    await preflight.check({ organizationId: ORG });
    expect(calls).not.toContain("casClaimPaused");
    expect(calls).not.toContain("insertRecordIfAbsent");
    expect(new Set(calls)).toEqual(
      new Set(["listOrganizationCompanyIds", "listLeases", "platformDefaultEnv", "listRecords", "currentKeyGeneration"]),
    );
  });
});

// CLI-007 (E7-F001) — the preflight is where the canary's Company mint authority is
// ESTABLISHED. It already verifies the Company holds provider-control authority
// (`currentKeyGeneration !== null`); on `ok` it now EMITS the ownership class the mint
// rides. A refusal emits none — the authority cannot be established, so nothing
// downstream can mint (fail-closed by SHAPE, not by a flag a caller could ignore).
describe("CLI-007 — the preflight establishes the canary's Company mint authority", () => {
  it("emits `credentialAuthority: company_api_key` on OK, after the provider-control-authority check passes", async () => {
    const preflight = createCanaryPreflight({ store: cleanStore() });
    const result = await preflight.check({ organizationId: ORG });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.credentialAuthority).toBe(CANARY_CREDENTIAL_AUTHORITY);
    expect(result.credentialAuthority).toBe("company_api_key");
  });

  // Fail-closed by shape: the authority the mint reads only ever exists on an OK
  // result, so a Company whose provider-control authority has NOT moved cannot leak a
  // usable authority into the mint.
  it("emits NO credentialAuthority when the gate refuses (provider-control authority not moved)", async () => {
    const preflight = createCanaryPreflight({
      store: withStore({ currentKeyGeneration: async () => null }),
    });
    const result = await preflight.check({ organizationId: ORG });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("credential_authority_not_moved");
    expect((result as { credentialAuthority?: unknown }).credentialAuthority).toBeUndefined();
  });
});
