import { describe, expect, it } from "vitest";
import {
  PROVIDER_STATUS_CONTRACT_VERSION,
  providerCanonicalStatusSchema,
} from "../provider-status.js";

describe("provider canonical status contract", () => {
  it("parses three independent, versioned rows", () => {
    const parsed = providerCanonicalStatusSchema.parse({
      version: PROVIDER_STATUS_CONTRACT_VERSION,
      credential: {
        state: "verified",
        method: "subscription",
        scope: "personal",
        ownerDisplay: "User ••••1234",
        checkedAt: "2026-07-28T00:00:00.000Z",
      },
      execution: {
        state: "compatible",
        outcome: "verified",
        executionTargetId: "hetzner-qa",
        sourceFingerprint: "sha256:abc",
        testedAt: "2026-07-28T00:00:00.000Z",
        staleAt: "2026-07-28T00:05:00.000Z",
      },
      assignment: {
        state: "commander_subscription",
        intendedAgentId: "agent-1",
        intendedAgentName: "Commander",
        credentialSource: "personal_subscription",
        approvedAt: "2026-07-28T00:00:00.000Z",
        revokedAt: null,
      },
    });
    expect(parsed.version).toBe(1);
  });

  it("rejects aggregate and unversioned shapes", () => {
    expect(
      providerCanonicalStatusSchema.safeParse({ ready: true }).success,
    ).toBe(false);
  });
});
