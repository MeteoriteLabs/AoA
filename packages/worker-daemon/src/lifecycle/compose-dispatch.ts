// WRK-008 slice 2 — should this daemon compose a dispatch loop, and if not, why not.
//
// WHY THIS IS A PURE FUNCTION IN ITS OWN FILE. The three refusals below are the whole
// operator-facing answer to "why is my worker idle", and each has a different fix in a
// different place (rebuild/repackage, edit env, ask an admin). Deciding them inline in
// `bootstrapWorkerDaemon` would make them unreachable from a test without booting a
// daemon, and would collapse them into the one shape that helps nobody: silence.
//
// ★ WHY THE FLAG IS NOT REDUNDANT WITH THE PROVIDER CHECK. Dispatch is already off by
// construction for the shipped binary: `bootstrapWorkerDaemon({env, proc})` injects no
// provider, and worker-daemon cannot construct one (E4-D01 — the only implementation,
// `E2bSandboxProvider`, lives in a package that depends on THIS one, so the dependency
// would be a cycle as well as a boundary breach). That protects today's build and
// nothing else. The moment a composition root exists outside this package, the flag is
// the only thing standing between "a host was written" and "every daemon running that
// build starts taking real leases" — which is why it gates composition GIVEN a provider
// rather than merely restating the provider check.

import type { SandboxProvider } from "../supervisor/provider.js";
import type { WorkerSelfModel } from "../poll/capacity.js";

export type DispatchRefusalReason =
  | "no_provider"
  | "dispatch_disabled"
  | "no_self_model_reader"
  | "no_self_model";

export type DispatchCompositionDecision =
  | { readonly compose: true }
  | { readonly compose: false; readonly reason: DispatchRefusalReason };

export interface DispatchCompositionInput {
  /** Injected by a composition root outside this package; `undefined` for the shipped binary. */
  readonly provider: SandboxProvider | undefined;
  /** `AOA_WORKER_DISPATCH_ENABLED`. Default OFF — see the module header. */
  readonly dispatchEnabled: boolean;
  /**
   * Whether this build can READ a self-model at all.
   *
   * ★ Distinct from `selfModel: null` on purpose. Until slice 2b threads the session
   * lifecycle through, no reader is wired — and reporting that as `no_self_model` would
   * send an operator to ask an admin for a placement profile that may already exist,
   * for a worker whose real problem is unbuilt code. A message that points at the wrong
   * person is worse than no message. This reason retires when 2b lands.
   */
  readonly hasSelfModelReader: boolean;
  /** `null` when the target has no admin-set placement profile, or the read failed. */
  readonly selfModel: WorkerSelfModel | null;
}

/**
 * ORDERING IS DELIBERATE, deepest fact first. `no_provider` is a BUILD fact that no
 * configuration can fix, so reporting anything else first sends an operator to flip a
 * flag that cannot help. `dispatch_disabled` is an explicit choice, and reporting a
 * missing profile for a worker deliberately switched off would be noise. `no_self_model`
 * needs an admin action on the target and is only actionable once the worker is
 * otherwise able and willing.
 */
export function decideDispatchComposition(
  input: DispatchCompositionInput,
): DispatchCompositionDecision {
  if (!input.provider) return { compose: false, reason: "no_provider" };
  if (!input.dispatchEnabled) return { compose: false, reason: "dispatch_disabled" };
  if (!input.hasSelfModelReader) return { compose: false, reason: "no_self_model_reader" };
  if (!input.selfModel) return { compose: false, reason: "no_self_model" };
  return { compose: true };
}

/**
 * WRK-010 slice 2 — should this daemon compose the SESSION LIFECYCLE?
 *
 * ★ DELIBERATELY WEAKER than `decideDispatchComposition`. Acquiring a session is a
 * PREREQUISITE to reading the self-model (the read needs an authenticated session), so the
 * lifecycle composes on the two hard gates — a provider and the flag — WITHOUT the
 * `hasSelfModelReader`/`selfModel` gates the full dispatch decision also needs. Gating the
 * lifecycle on `decideDispatchComposition().compose` would construct NOTHING in Sprint 2.5
 * (`hasSelfModelReader` is `false` until Sprint 3) and leave the renewal route with a
 * compile-clean but unreachable caller — the exact defect this sprint exists to close.
 *
 * Both predicates read the same `provider`/`dispatchEnabled`, so they can never disagree about
 * the first two gates. On the shipped default (no provider) this is `false`: no store, no sink,
 * no session in memory — enrolment behaves byte-identically to the pre-slice-2 tree.
 */
export function shouldComposeSession(input: {
  provider: SandboxProvider | undefined;
  dispatchEnabled: boolean;
}): boolean {
  return !!input.provider && input.dispatchEnabled;
}

/** Operator-facing text for each refusal. Kept beside the decision so a new reason
 * cannot be added without an answer to "what does the operator do about it". */
export const DISPATCH_REFUSAL_MESSAGES: Readonly<Record<DispatchRefusalReason, string>> =
  Object.freeze({
    no_provider:
      "worker-daemon: no sandbox provider injected; this build cannot dispatch work (a composition root must supply one)",
    dispatch_disabled:
      "worker-daemon: dispatch is disabled; set AOA_WORKER_DISPATCH_ENABLED=1 to enable it",
    no_self_model_reader:
      "worker-daemon: this build cannot read its own self-model yet (WRK-008 slice 2b); dispatch cannot start, and this is NOT a target-configuration problem",
    no_self_model:
      "worker-daemon: this target has no placement profile; an admin must set one before the worker can take work",
  });
