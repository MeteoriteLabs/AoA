import { describe, it, expect } from "vitest";
import {
  admitSessionRenewal,
  sessionRenewalRefusalWireCode,
  type SessionRenewalInput,
  type SessionRenewalRefusal,
} from "../services/worker-session-renewal-admission.js";

// WRK-010 slice 1 — the pure session-renewal admission decision.
//
// ★ THE SUITE OPENS WITH A POSITIVE CONTROL, and the reason is E1-F008: five
// placement guards were deletable with their own named tests still PASSING, because
// every fixture refused earlier for an unrelated reason and each test asserted a bare
// `toBe(false)` it got from the wrong refusal. A refusal suite with no positive control
// cannot tell "correctly refused" from "never got there". So two rules hold here, by
// construction: (1) the shared `input()` fixture is proven to ADMIT before any refusal
// case is built on it; (2) every refusal case asserts the SPECIFIC reason, never a bare
// `admit: false`.

const THUMBPRINT = "a".repeat(64);
const PROFILE_HASH = "b".repeat(64);
const WORKER_ID = "73000000-0000-4000-8000-000000000001";
const TARGET_ID = "72000000-0000-4000-8000-000000000001";
const ORG_ID = "71000000-0000-4000-8000-000000000001";

/**
 * A principal the shipped authenticator would actually produce for an
 * organization-scoped worker: a non-null org, matching worker/target scope, no
 * shared-platform authority. This ADMITS; the refusal cases override single fields.
 */
function input(overrides: Partial<SessionRenewalInput> = {}): SessionRenewalInput {
  return {
    principalOrganizationId: ORG_ID,
    principalScope: "organization",
    principalTargetScope: "organization",
    hasSharedPlatformAuthority: false,
    workerId: WORKER_ID,
    targetId: TARGET_ID,
    generation: 3,
    deviceThumbprint: THUMBPRINT,
    profileHash: PROFILE_HASH,
    ...overrides,
  };
}

describe("admitSessionRenewal — positive controls (the fixture ADMITS before any refusal is built on it)", () => {
  it("admits an organization-scope principal and stamps scope: organization", () => {
    const decision = admitSessionRenewal(input({ principalScope: "organization" }));
    expect(decision.admit).toBe(true);
    if (!decision.admit) return;
    expect(decision.identity).toEqual({
      aud: "device_session",
      sub: WORKER_ID,
      organizationId: ORG_ID,
      targetId: TARGET_ID,
      generation: 3,
      scope: "organization",
      deviceThumbprint: THUMBPRINT,
      profileHash: PROFILE_HASH,
    });
  });

  it("admits an owner-scope principal and stamps scope: owner", () => {
    const decision = admitSessionRenewal(input({ principalScope: "owner", principalTargetScope: "owner" }));
    expect(decision.admit).toBe(true);
    if (!decision.admit) return;
    expect(decision.identity.scope).toBe("owner");
  });

  it("admits a SHARED-PLATFORM TENANT worker (org-scoped worker, platform target) with authority resolved", () => {
    const decision = admitSessionRenewal(input({
      principalScope: "organization",
      principalTargetScope: "platform",
      hasSharedPlatformAuthority: true,
    }));
    expect(decision.admit).toBe(true);
    if (!decision.admit) return;
    expect(decision.identity.scope).toBe("organization");
  });
});

describe("sessionRenewalRefusalWireCode — every refusal is coarse `unauthorized` on the wire", () => {
  it("maps both refusals to unauthorized (exhaustiveness)", () => {
    const refusals: SessionRenewalRefusal[] = [
      "platform_physical_unsupported",
      "platform_authority_unresolved",
    ];
    for (const refusal of refusals) {
      expect(sessionRenewalRefusalWireCode(refusal)).toBe("unauthorized");
    }
  });
});
