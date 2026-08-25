// WRK-008 slice 2 — the dispatch-composition decision.
//
// This is the function that answers "is this daemon going to take work, and if not, why
// not". It is a DECISION WITH A REASON rather than a boolean for the same reason
// `isSweepEligible` is: the reason is the operator-facing answer to "why is my worker
// idle", and a boolean throws it away at exactly the moment someone needs it.
//
// ★ The row that matters most is `provider present + flag off`. Absence of a provider
// already makes dispatch impossible by construction (see the design §1-2), so a flag
// tested only against the shipped binary would be a guard that can never fire — this
// programme's signature defect. These tests reach the flag by injection, which is the
// only way it is currently reachable at all.

import { describe, expect, it } from "vitest";

import {
  decideDispatchComposition,
  shouldComposeSession,
  DISPATCH_REFUSAL_MESSAGES,
  type DispatchRefusalReason,
} from "../lifecycle/compose-dispatch.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";

const PROVIDER = createFakeSandboxProvider({});
// The decision never reads the self-model's contents — only whether one was obtained.
// Typed through `unknown` so this suite does not have to build a branded profile to
// test a presence check; the assembly path is covered by its own suite.
const SELF = {} as never;

describe("WRK-008 slice 2 — decideDispatchComposition", () => {
  it("composes when a provider, the flag and a self-model are all present", () => {
    expect(
      decideDispatchComposition({ provider: PROVIDER, dispatchEnabled: true, hasSelfModelReader: true, selfModel: SELF }),
    ).toEqual({ compose: true });
  });

  it("★ refuses when the flag is off EVEN THOUGH a provider is present", () => {
    // The non-vacuous row. Without it the flag would only ever be observed in the state
    // where the provider is absent — where the answer is already no.
    expect(
      decideDispatchComposition({ provider: PROVIDER, dispatchEnabled: false, hasSelfModelReader: true, selfModel: SELF }),
    ).toEqual({ compose: false, reason: "dispatch_disabled" });
  });

  it("★ refuses when no provider is injected, whatever the flag says", () => {
    // Dispatch cannot be turned on by environment alone. This is the shipped binary.
    expect(
      decideDispatchComposition({ provider: undefined, dispatchEnabled: true, hasSelfModelReader: true, selfModel: SELF }),
    ).toEqual({ compose: false, reason: "no_provider" });
    expect(
      decideDispatchComposition({ provider: undefined, dispatchEnabled: false, hasSelfModelReader: true, selfModel: SELF }),
    ).toEqual({ compose: false, reason: "no_provider" });
  });

  it("★ refuses when the target has no self-model — enrolment alone is not enough", () => {
    // Q1, asserted on purpose: an admin must set a placement profile on the target.
    expect(
      decideDispatchComposition({ provider: PROVIDER, dispatchEnabled: true, hasSelfModelReader: true, selfModel: null }),
    ).toEqual({ compose: false, reason: "no_self_model" });
  });

  it("★ reports the DEEPEST fact first when several refusals apply at once", () => {
    // Ordering is a deliberate operator-experience decision, not an accident of writing
    // the `if`s in some order:
    //
    //   no_provider     — a BUILD fact. No amount of configuration fixes it, so naming
    //                     anything else first sends the operator to flip a flag that
    //                     cannot help.
    //   dispatch_disabled — an explicit operator choice. Reporting a missing profile for
    //                     a worker deliberately switched off would be noise.
    //   no_self_model   — an admin action on the target, and only actionable once the
    //                     worker is otherwise able and willing to dispatch.
    expect(
      decideDispatchComposition({ provider: undefined, dispatchEnabled: false, hasSelfModelReader: true, selfModel: null }),
    ).toEqual({ compose: false, reason: "no_provider" });
    expect(
      decideDispatchComposition({ provider: PROVIDER, dispatchEnabled: false, hasSelfModelReader: true, selfModel: null }),
    ).toEqual({ compose: false, reason: "dispatch_disabled" });
  });

  it("★ reports no_self_model_reader when the BUILD cannot read one — not no_self_model", () => {
    // The two are different problems with different owners. Collapsing them would send an
    // operator to ask an admin for a placement profile that may already exist, for a
    // worker whose real problem is that this build has no reader wired at all.
    expect(
      decideDispatchComposition({
        provider: PROVIDER,
        dispatchEnabled: true,
        hasSelfModelReader: false,
        selfModel: null,
      }),
    ).toEqual({ compose: false, reason: "no_self_model_reader" });
    // Even with a self-model somehow in hand, no reader means the build is not wired.
    expect(
      decideDispatchComposition({
        provider: PROVIDER,
        dispatchEnabled: true,
        hasSelfModelReader: false,
        selfModel: SELF,
      }),
    ).toEqual({ compose: false, reason: "no_self_model_reader" });
  });

  it("every refusal reason has an operator-facing message", () => {
    // A reason with no message is a reason nobody can act on.
    const reasons: DispatchRefusalReason[] = [
      "no_provider",
      "dispatch_disabled",
      "no_self_model_reader",
      "no_self_model",
    ];
    for (const reason of reasons) {
      expect(DISPATCH_REFUSAL_MESSAGES[reason]).toBeTruthy();
    }
    expect(new Set(Object.values(DISPATCH_REFUSAL_MESSAGES)).size).toBe(reasons.length);
  });

  it("distinguishes every refusal — a boolean would collapse these", () => {
    const reasons = new Set(
      [
        decideDispatchComposition({ provider: undefined, dispatchEnabled: true, hasSelfModelReader: true, selfModel: SELF }),
        decideDispatchComposition({ provider: PROVIDER, dispatchEnabled: false, hasSelfModelReader: true, selfModel: SELF }),
        decideDispatchComposition({ provider: PROVIDER, dispatchEnabled: true, hasSelfModelReader: true, selfModel: null }),
        decideDispatchComposition({ provider: PROVIDER, dispatchEnabled: true, hasSelfModelReader: false, selfModel: null }),
      ].map((d) => (d.compose ? "composed" : d.reason)),
    );
    expect(reasons.size).toBe(4);
  });
});

describe("WRK-010 slice 2 — shouldComposeSession (the weaker session-lifecycle gate)", () => {
  it("composes ONLY with a provider AND the flag on — NEVER on the shipped default (no provider)", () => {
    expect(shouldComposeSession({ provider: PROVIDER, dispatchEnabled: true })).toBe(true);
    expect(shouldComposeSession({ provider: PROVIDER, dispatchEnabled: false })).toBe(false);
    expect(shouldComposeSession({ provider: undefined, dispatchEnabled: true })).toBe(false);
    expect(shouldComposeSession({ provider: undefined, dispatchEnabled: false })).toBe(false);
  });

  it("is strictly WEAKER than decideDispatchComposition: it ignores the self-model gates", () => {
    // A session is a prerequisite to reading the self-model, so the lifecycle must compose
    // with a provider + flag even while decideDispatchComposition still refuses (no reader yet).
    expect(shouldComposeSession({ provider: PROVIDER, dispatchEnabled: true })).toBe(true);
    expect(
      decideDispatchComposition({ provider: PROVIDER, dispatchEnabled: true, hasSelfModelReader: false, selfModel: null }).compose,
    ).toBe(false);
  });
});
