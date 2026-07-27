import { describe, expect, it } from "vitest";
import {
  ProviderCredentialBindingError,
  chooseGovernedSubscriptionBinding,
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
});
