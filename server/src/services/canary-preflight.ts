// server/src/services/canary-preflight.ts
//
// CLI-006 (D2) — the MIG-008 preflight that gates the FIRST live transfer of
// execution ownership for a canary Organization.
//
// Acceptance (program-design.md:794): "MIG-008 has reconciled legacy environment
// leases/resources and moved provider-control authority before the rollout flag can
// transfer the first live execution."
//
// Two facts about MIG-008 shape this module (design §2.7-8):
//
//  1. **Closure is computed, not stored.** MIG-008 persists append-only crosswalk
//     RECORDS; `assertClosure` is a pure function over inventory + records, and
//     `reconcileCompanyLegacyResources` computes closure over the records it builds
//     during a MUTATING pass (it CAS-claims paused rows and inserts). A gate cannot
//     reuse that pass. So this module RE-DERIVES closure read-only, reusing MIG-008's
//     own `assertClosure` authority rather than defining a second notion of
//     "reconciled". That also makes the gate self-healing in the safe direction: a
//     legacy lease appearing after reconciliation re-closes it.
//
//  2. **Closure is Company-scoped; the canary flag is Organization-scoped.** One
//     Organization may hold many Companies (`companies.organizationId`). Checking
//     only the run's Company would let an Organization be canaried while a sibling
//     Company's legacy leases/resources stay unreconciled — a fail-open against the
//     acceptance clause. This gate enumerates EVERY Company under the Organization
//     and requires all of them to close.
//
// Everything that is not a clean, current, complete reconciliation REFUSES, and a
// refusal is never an exception: `check` resolves to a reason the caller folds into
// the single ownership decision (`resolveRunExecutionOwner`), whose fail-safe
// direction is always "legacy executes" (Invariant 2).
//
// Deliberately NOT cached. Canary volume is low by definition, and a cache whose
// stale `true` outlived a newly-unreconciled resource would reintroduce exactly the
// fail-open this module exists to close.

import {
  assertClosure,
  resourceKeyForLease,
  resourceKeyForPlatformDefaultEnv,
  type LegacyLeaseInput,
  type ReconciliationRecord,
} from "./legacy-resource-reconciliation.js";
import { CANARY_CREDENTIAL_AUTHORITY } from "./canary-mint-authority.js";

/**
 * The READ-ONLY slice of MIG-008 state this gate needs. It deliberately excludes
 * `casClaimPaused` / `insertRecordIfAbsent` — the mutating half of
 * `LegacyReconciliationStore` — so the gate structurally cannot reconcile as a
 * side effect of being consulted.
 */
export interface CanaryPreflightStore {
  /** Every Company under the Organization (the org-wide scope, design §2.8). */
  listOrganizationCompanyIds(organizationId: string): Promise<readonly string[]>;
  /** All `environment_leases` rows for the Company. */
  listLeases(companyId: string): Promise<readonly LegacyLeaseInput[]>;
  /** The materialized platform-default env row id, or null when none exists. */
  platformDefaultEnv(companyId: string): Promise<{ environmentId: string } | null>;
  /** The PERSISTED crosswalk records for the Company (MIG-008's durable evidence). */
  listRecords(companyId: string): Promise<readonly ReconciliationRecord[]>;
  /** The current per-Company key generation (MIG-008 D3 attribution tag), or null. */
  currentKeyGeneration(companyId: string): Promise<string | null>;
}

export type CanaryPreflightRefusalReason =
  /** The Organization resolves to no Companies — nothing was ever reconciled. */
  | "no_companies"
  /** A Company has an unmapped, duplicated, or unattributable legacy resource. */
  | "reconciliation_incomplete"
  /** Provider-control authority has not moved, or a record predates the move. */
  | "credential_authority_not_moved"
  /** The gate could not read its own evidence. Fail closed, never assume. */
  | "preflight_error";

export type CanaryPreflightResult =
  | {
      readonly ok: true;
      readonly companyIds: readonly string[];
      /**
       * CLI-007 (E7-F001) — the Company ownership authority a canary rides at the DAT-008
       * mint, EMITTED here because this is where it is verified (`currentKeyGeneration`
       * moved, below). Present ONLY on `ok`; a refusal carries none, so a canary whose
       * provider-control authority has not moved cannot present a usable authority to the
       * mint (fail-closed by shape). See `canary-mint-authority.ts`.
       */
      readonly credentialAuthority: typeof CANARY_CREDENTIAL_AUTHORITY;
    }
  | {
      readonly ok: false;
      readonly reason: CanaryPreflightRefusalReason;
      /** The Company that closed the gate, when attributable. */
      readonly companyId: string | null;
      readonly detail: string;
    };

export interface CanaryPreflight {
  check(input: { organizationId: string }): Promise<CanaryPreflightResult>;
}

function refuse(
  reason: CanaryPreflightRefusalReason,
  companyId: string | null,
  detail: string,
): CanaryPreflightResult {
  return { ok: false, reason, companyId, detail };
}

/**
 * Re-derive the inventory a MIG-008 reconcile pass would have recorded for one
 * Company, read-only. Every lease the Company currently holds is in scope: the
 * reconcile pass records a disposition for each (live rows are `mapped`, paused
 * rows are claimed and recorded, terminal rows are `terminal_cleanup`), so a lease
 * with no persisted record means the pass has not covered it.
 */
function inventoryKeysForCompany(
  leases: readonly LegacyLeaseInput[],
  platformDefault: { environmentId: string } | null,
): string[] {
  const keys = leases.map((lease) => resourceKeyForLease(lease.id));
  if (platformDefault) keys.push(resourceKeyForPlatformDefaultEnv(platformDefault.environmentId));
  return keys;
}

export function createCanaryPreflight(deps: { store: CanaryPreflightStore }): CanaryPreflight {
  const { store } = deps;

  return {
    async check({ organizationId }) {
      try {
        const companyIds = await store.listOrganizationCompanyIds(organizationId);
        if (companyIds.length === 0) {
          return refuse(
            "no_companies",
            null,
            `Organization ${organizationId} resolves to no Companies; there is no reconciliation evidence to gate on`,
          );
        }

        for (const companyId of companyIds) {
          const [leases, platformDefault, records, keyGeneration] = await Promise.all([
            store.listLeases(companyId),
            store.platformDefaultEnv(companyId),
            store.listRecords(companyId),
            store.currentKeyGeneration(companyId),
          ]);

          // (b) Provider-control authority. A Company with no current generation has
          // not had authority moved at all; a record tagged with a superseded
          // generation predates the move and is not evidence for the current one.
          if (keyGeneration === null) {
            return refuse(
              "credential_authority_not_moved",
              companyId,
              `Company ${companyId} has no current provider-control key generation`,
            );
          }
          const superseded = records.filter(
            (record) => record.keyGeneration !== null && record.keyGeneration !== keyGeneration,
          );
          if (superseded.length > 0) {
            return refuse(
              "credential_authority_not_moved",
              companyId,
              `Company ${companyId} has ${superseded.length} reconciliation record(s) tagged with a superseded key generation ` +
                `(current ${keyGeneration}); provider-control authority has not fully moved`,
            );
          }

          // (a) Reconciliation closure, recomputed with MIG-008's own authority.
          const closure = assertClosure({
            inventoryKeys: inventoryKeysForCompany(leases, platformDefault),
            records: records.map((record) => ({
              resourceKey: record.resourceKey,
              disposition: record.disposition,
            })),
          });
          if (!closure.ok) {
            return refuse(
              "reconciliation_incomplete",
              companyId,
              `Company ${companyId} legacy reconciliation is not closed ` +
                `(unmapped=${closure.unmapped.length}, duplicates=${closure.duplicates.length}, ` +
                `unattributable=${closure.unattributable.length})`,
            );
          }
        }

        // Every Company under the Organization has closed reconciliation at a current
        // provider-control key generation — so the canary rides the Company key.
        return { ok: true, companyIds, credentialAuthority: CANARY_CREDENTIAL_AUTHORITY };
      } catch (error) {
        // Fail closed on unreadability — an unreadable gate is a closed gate.
        return refuse(
          "preflight_error",
          null,
          `canary preflight could not read its evidence: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  };
}
