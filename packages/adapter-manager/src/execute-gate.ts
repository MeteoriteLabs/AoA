// -----------------------------------------------------------------------------
// DEP-012 Slice 1 · Unit B1 — the server-side execute OWNERSHIP GATE.
//
// This is the security core of B1: it closes execute cross-tenant over the wire. At
// the provider, execute has NO ownership check — it is fence-only (effect-authority),
// CleanupAuthority DENIES it, and the desktop supervisor is the sole caller, always on
// its OWN just-created id. Over the wire an untrusted worker crafts the sandboxId
// itself, so an ungated execute route is BOTH an existence oracle AND a cross-tenant
// code-execution vector. This gate is the `#requireOwned`-equivalent, relocated
// server-side and fed the caller's owned labels by the signed capability.
//
// It MIRRORS `#requireOwned` (cleanup-authority.ts:154-167) FIELD-FOR-FIELD:
//   verify(capability) -> ownedLabels; provider.inspect(sandboxId) AM-LOCAL (the
//   in-process provider, NOT a wire op) -> target; labelsEqual(target, owned) &&
//   target.generation === owned.deviceGeneration -> allow; else the UNIFORM
//   ResourceNotAvailableError.
//
// The oracle collapse (cleanup-authority.ts:159,:164) is reproduced with BOTH arms and
// then some: verify-failure, missing capability, a label/generation mismatch, a
// SandboxNotFoundError from inspect, AND any other inspect throw ALL become the SAME
// uniform error — byte-identical, so a foreign-but-existing sandbox is indistinguishable
// from not-found. Fail-closed BEFORE any dispatch (provider.execute is reached ONLY on
// the allow path), so a refusal never runs a command.
//
// worker-daemon + cleanup-authority.ts are UNTOUCHED — this is new adapter-manager code
// using only exported symbols (ResourceNotAvailableError / labelsEqual). B1's execute
// gate is genuinely net-new because execute bypasses CleanupAuthority (fence-only). This
// does NOT generalize to B2's teardown ops (the cross-lane rule).
// -----------------------------------------------------------------------------

import type { KeyObject } from "node:crypto";

import type { ExecuteInput, ExecuteResult, ProviderOpContext, SandboxProvider } from "@armyofagents/worker-daemon";
import { ResourceNotAvailableError, labelsEqual } from "@armyofagents/worker-daemon";
import type { OwnedLabelsCapability } from "@armyofagents/provider-wire";

import { verifyOwnedLabelsCapability } from "./capability-verify.js";

export interface ExecuteGateDeps {
  readonly provider: SandboxProvider;
  readonly controlPlanePublicKey: KeyObject;
  /** ms-epoch clock for the capability expiry check. */
  readonly now: () => number;
}

/**
 * Gate an execute request. Returns the ExecuteResult on the allow path, or throws the
 * UNIFORM ResourceNotAvailableError on ANY refusal (absent/invalid capability, foreign
 * or not-found sandbox, or any inspect fault). Errors from `provider.execute` itself on
 * the allow path (egress denied, a mid-flight not-found) propagate as their own class —
 * only the OWNERSHIP decision collapses to the uniform error.
 */
export async function gateExecute(
  deps: ExecuteGateDeps,
  input: ExecuteInput,
  ctx: ProviderOpContext,
  capability: OwnedLabelsCapability | undefined,
): Promise<ExecuteResult> {
  const { provider, controlPlanePublicKey, now } = deps;

  // 1. Verify FIRST, before any provider call. A missing capability is refused exactly
  //    like an invalid one (NEVER dispatched on absence — the R2 fall-open). Any verify
  //    failure collapses to the uniform error, so it leaks nothing about the sandbox.
  let ownedLabels;
  try {
    if (capability === undefined) throw new ResourceNotAvailableError();
    ownedLabels = verifyOwnedLabelsCapability(capability, controlPlanePublicKey, now());
  } catch {
    throw new ResourceNotAvailableError();
  }

  // 2. Resolve the target AM-local. Collapse ALL inspect throws — SandboxNotFoundError
  //    (a foreign/absent id) and any transient/other fault — to the uniform error, so a
  //    foreign-but-existing sandbox is byte-identical to not-found.
  let detail;
  try {
    detail = await provider.inspect(input.sandboxId, ctx);
  } catch {
    throw new ResourceNotAvailableError();
  }

  // 3. Mirror #requireOwned field-for-field. A label OR generation mismatch is refused
  //    IDENTICALLY to not-found.
  if (!labelsEqual(detail.resourceLabels, ownedLabels) || detail.generation !== ownedLabels.deviceGeneration) {
    throw new ResourceNotAvailableError();
  }

  // 4. Allow — dispatch to the real provider.
  return provider.execute(input, ctx);
}
