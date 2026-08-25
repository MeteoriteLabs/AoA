// server/src/services/worker-hello-refresh-admission.ts
//
// WRK-011 (Sprint 2.75) — may this ALREADY-AUTHENTICATED worker replace its enrolled
// self-model snapshot with a REFRESHED hello?
//
// ★ READ THIS BEFORE ADDING A GUARD. The caller has already been through
// `createWorkerSessionAuthenticator` (worker-session-auth.ts:112-213), which proved the
// session's HMAC + expiry, the device proof's signature/skew/path/body binding, that the
// proof's key is the session's, that the proof is not a replay (it BURNS it), that the
// authority row exists and is not revoked/disabled, that the owner membership is live,
// that both generations agree with the token, and that the row's scope, org, profile
// hash, thumbprint and PUBLIC KEY match — the same nine-of-ten map WRK-010 §3.4 records.
// Re-checking any of that here would be a second authority surface that can drift out of
// agreement with the first. This function decides only the four things the authenticator
// does not know about (§4.1), and PRODUCES the canonical digest to write.
//
// PURE: no database, no clock, no request, no crypto. The `digestOf` dependency is
// INJECTED so the unit matrix drives G4 both ways without computing sha256, and so the
// production wiring — the single place `JSON.stringify` meets the zod-parsed hello — has
// exactly one call site to mutate (design §8 M11).
//
// Tenancy is deliberately absent: the route carries no identifier at all, so cross-tenant
// reach is answered by construction at the authenticator, not by a check here that could
// drift. A platform PHYSICAL worker (organizationId === null) is a §10 non-goal and is
// refused at the route by the type-forced `runInTenant` org narrow — it never reaches a
// tenant `workers` write.

import type { WorkerHelloV1 } from "@armyofagents/worker-protocol";

export type HelloRefusalReason =
  | "identity_mismatch"
  | "capability_not_granted"
  | "policy_stale"
  | "profile_unratified";

export type HelloRefreshDecision =
  | { readonly admit: true; readonly changed: false }
  | { readonly admit: true; readonly changed: true; readonly profileHash: string }
  | { readonly admit: false; readonly reason: HelloRefusalReason };

export interface HelloRefreshInput {
  readonly principal: {
    readonly workerId: string;
    readonly targetId: string;
    readonly targetGeneration: number;
  };
  /** ALREADY zod-parsed by the caller (`workerHelloV1Schema`). */
  readonly hello: WorkerHelloV1;
  /** The admin-ratified ceiling for this target, or null when none is ratified. */
  readonly ratified: { readonly capabilityCeiling: readonly string[]; readonly policyHash: string } | null;
  readonly currentProfileHash: string | null;
  /** Injected. Production = sha256(JSON.stringify(zod-parsed hello)). */
  readonly digestOf: (hello: WorkerHelloV1) => string;
}

/**
 * Every hello-refresh refusal answers `unauthorized` on the wire, coarse by design so the
 * route cannot become an oracle for target existence/configuration state (§5.3). The
 * discriminant reaches the operator LOG only. The `_r` exhaustiveness parameter makes a
 * future reason without a wire mapping a compile error — mirrors
 * `sessionRenewalRefusalWireCode` (worker-session-renewal-admission.ts:78).
 */
export function helloRefreshRefusalWireCode(_r: HelloRefusalReason): "unauthorized" {
  return "unauthorized";
}

export function admitHelloRefresh(input: HelloRefreshInput): HelloRefreshDecision {
  const profileHash = input.digestOf(input.hello);
  if (profileHash === input.currentProfileHash) return { admit: true, changed: false };
  return { admit: true, changed: true, profileHash };
}
