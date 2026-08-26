// server/src/services/canary-credential-binding.ts
//
// CLI-006 (Task 1) — the credential binding a canary attempt presents to placement.
//
// DECISION: this resolver asserts NOTHING about which provider credential the run
// uses at PLACEMENT. It returns the same constant for every Organization, Company,
// job and source kind. That is not a placeholder and not a degraded fallback — the
// binding is the sole credential input to the placement REPLAY digest and to target
// ROUTING, and it must stay a stable, routing-neutral constant for three reasons:
//
//   1. THE CREDENTIAL IS DELIVERED OUT OF BAND, NOT THROUGH THE BINDING (CLI-007,
//      E7-F001). A canary now DOES mint a Company `provider_key` handle: the Company
//      ownership authority the mint needs ("company_api_key") is established by the
//      MIG-008 preflight and threaded to the DAT-008 mint via
//      `PlaceJobAttemptInput.mintCredentialAuthority` (see canary-mint-authority.ts),
//      AFTER the digest is computed and the replay early-return has fired. So the
//      binding never has to name a credential: naming one here would change the digest
//      and re-open routing, and the mint authority reaches the mint another way.
//      (Historic note: before CLI-007 the four-null binding's `credentialKind: null`
//      tripped the mint's owner-authority gate → owner_authority_disagreement → no
//      handle; that WAS E7-F001, and it is what CLI-007 fixed without touching this
//      constant.)
//   2. THE INPUTS DO NOT EXIST YET. The only functions that can authorize a
//      credential (`resolveProviderCredential`, `resolveAgentSubscriptionEnvironment`)
//      need `provider`, `adapterType`, `agentId`, `executionTargetId`, `currentEnv`
//      and a `SecretConsumerContext`. At this seam none of them is in scope: the
//      heartbeat computes `resolvedEnv` at heartbeat.ts:3378 and `hbProviderId` at
//      heartbeat.ts:3430 — 140+ and 190+ lines AFTER the convert/place seam at
//      heartbeat.ts:3231-3258 that reaches this resolver.
//   3. PLACEMENT CANNOT CHECK A CREDENTIAL CLAIM. `credentialOwnerId` is read off
//      the ROUTED TARGET's profile (job-placement.ts:279-281), and
//      `requiredOwnerPrincipalId` off the SAME profile (job-placement.ts:289), so
//      the owner comparison in `candidateFits` (job-placement.ts:548-555) is
//      tautological. A richer binding would be accepted without ever being verified.
//
// WHY THE CONSTANT IS SAFE BY CONSTRUCTION (not by predicate):
// every job created through `submitJob` hardcodes `requestedTarget: null`
// (job-submission.ts:134-138). With all four fields null, the pin at
// job-placement-transaction.ts:151 is `null ?? null` = null, so
// `chooseExecutionTargetRow` takes neither the pin branch
// (execution-target-resolver.ts:180) nor the personal_subscription branch (:188)
// and falls to `active.find(t => t.kind === "pooled_gvisor")` (:195). A
// `pooled_gvisor` row can ONLY normalize as `targetClass: "managed_cloud"`
// (execution-target-resolver.ts:53 + the kind/class check at :138). There is
// therefore NO reachable path from this binding to an `owner_desktop` target —
// the DE-29 owner-misrouting class is structurally excluded, not merely checked.
//
// DO NOT "enrich" this without re-deriving that argument. Adding a non-null
// `pinnedTargetId` or `credentialKind: "personal_subscription"` re-opens owner
// routing, and adding any rotating value (a key generation, a freshly-read
// credential row) breaks placement replay: the binding is hashed into
// `placementInputDigest`/`placementPolicyDigest` (job-placement.ts:315 → :333-335),
// and a changed digest on retry throws `placement_already_decided`
// (job-placement-transaction.ts:211-217) → `transfer_error` → permanent legacy
// fallback for that run. The canary's Company mint authority does NOT belong here for
// that reason — it rides the out-of-band `mintCredentialAuthority` channel (CLI-007),
// established by the preflight, which already owns credential-generation freshness
// (canary-preflight.ts). Even a routing-neutral constant such as `"company_api_key"`
// belongs there, not here: on the binding it would change the digest value and make
// the mint's owner-authority cross-check assert Company authority WITHOUT the preflight
// having verified it.

import type { JobPlacementCredentialBinding } from "./job-placement.js";

/**
 * The canary binding: four explicit nulls.
 *
 * All four keys are written out even though every value is null. The binding is
 * canonicalized by key set (canonical-json.ts serializes `Object.keys`), so an
 * omitted key is a DIFFERENT digest, not an equivalent one. Freezing the object
 * keeps the key set stable for every attempt this composition ever places.
 */
export const CANARY_CREDENTIAL_BINDING: Readonly<JobPlacementCredentialBinding> = Object.freeze({
  credentialId: null,
  credentialKind: null,
  executionTargetSlug: null,
  pinnedTargetId: null,
});

/**
 * `resolveCredentialBinding` for the production composition root.
 *
 * Deliberately ignores its inputs. It takes no `db` handle and performs no read,
 * so it has no failure mode to degrade from — the constant IS the contract, never
 * a fallback that masks a failed lookup.
 */
export function resolveCanaryCredentialBinding(): JobPlacementCredentialBinding {
  return { ...CANARY_CREDENTIAL_BINDING };
}
