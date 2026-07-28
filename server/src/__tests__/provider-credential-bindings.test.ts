import { describe, expect, it } from "vitest";
import {
  ProviderCredentialBindingError,
  assertCommanderSubscriptionAgent,
  chooseGovernedSubscriptionBinding,
  mayUseLegacySubscriptionHome,
} from "../services/provider-credential-bindings.js";

const base = {
  credentialId: "credential-1",
  credentialCompanyId: "company-1",
  provider: "openai",
  ownerUserId: "user-1",
  executionTargetId: "target-1",
  kind: "personal_subscription",
  state: "verified",
  approvedAt: new Date(),
  bindingRevokedAt: null,
  ownerMembershipStatus: "active",
};

const expected = {
  companyId: "company-1",
  provider: "openai" as const,
  executionTargetId: "target-1",
};

function codeOf(fn: () => unknown) {
  try {
    fn();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderCredentialBindingError);
    return (error as ProviderCredentialBindingError).code;
  }
}

describe("governed provider credential binding", () => {
  it("selects exactly one approved, verified, target-matched binding", () => {
    expect(chooseGovernedSubscriptionBinding([base], expected).credentialId).toBe("credential-1");
  });

  it("fails closed for missing, unapproved, wrong-target, inactive-owner, and ambiguous bindings", () => {
    expect(codeOf(() => chooseGovernedSubscriptionBinding([], expected))).toBe("binding_missing");
    expect(
      codeOf(() => chooseGovernedSubscriptionBinding([{ ...base, approvedAt: null }], expected)),
    ).toBe("binding_not_approved");
    expect(
      codeOf(() =>
        chooseGovernedSubscriptionBinding(
          [{ ...base, executionTargetId: "another-target" }],
          expected,
        ),
      ),
    ).toBe("credential_target_mismatch");
    expect(
      codeOf(() =>
        chooseGovernedSubscriptionBinding(
          [{ ...base, ownerMembershipStatus: "suspended" }],
          expected,
        ),
      ),
    ).toBe("credential_owner_inactive");
    expect(codeOf(() => chooseGovernedSubscriptionBinding([base, { ...base }], expected))).toBe(
      "binding_ambiguous",
    );
  });

  it("allows legacy global-home fallback only for an absent binding when enforcement is off", () => {
    const missing = new ProviderCredentialBindingError("binding_missing", "missing");
    const revoked = new ProviderCredentialBindingError("binding_not_approved", "revoked");

    expect(mayUseLegacySubscriptionHome(missing, false)).toBe(true);
    expect(mayUseLegacySubscriptionHome(missing, true)).toBe(false);
    expect(mayUseLegacySubscriptionHome(revoked, false)).toBe(false);
    expect(mayUseLegacySubscriptionHome(new Error("database unavailable"), false)).toBe(false);
  });

  it("rejects personal subscription execution for every non-Commander agent", () => {
    expect(() => assertCommanderSubscriptionAgent("agent-1", "commander-1")).toThrowError(
      expect.objectContaining({ code: "credential_not_commander" }),
    );
    expect(() => assertCommanderSubscriptionAgent("agent-1", null)).toThrowError(
      expect.objectContaining({ code: "credential_not_commander" }),
    );
    expect(() => assertCommanderSubscriptionAgent("commander-1", "commander-1")).not.toThrow();
  });
});
