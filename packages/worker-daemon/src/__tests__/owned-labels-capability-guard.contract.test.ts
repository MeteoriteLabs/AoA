// -----------------------------------------------------------------------------
// DEP-011 Slice 2a — the vendored owned-labels-capability shape-guard CONTRACT.
//
// worker-daemon runtime source may NOT import the leaf's `OwnedLabelsCapability`
// type (`check-worker-daemon-boundary` has no `import type` awareness — even a type
// import is a "forbidden runtime import"), and provider-wire's `isValidCapability`
// is module-PRIVATE. So worker-daemon VENDORS a local structural type
// (`OwnedLabelsCapabilityLike`) + a local shape-guard (`isOwnedLabelsCapabilityShape`).
//
// This contract PINS the vendored guard against the REAL minted capability (the
// `.test.ts` is excluded from the boundary scan, so it MAY import the leaf) — the
// "vendor + pin" pattern `secret-redemption.ts` already uses for the resolve request
// body. A guard that drifts from the real shape (accepts a malformed cap, or rejects
// a real one) fails here.
// -----------------------------------------------------------------------------

import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { signOwnedLabelsCapability } from "@armyofagents/provider-capability";

import { isOwnedLabelsCapabilityShape } from "../lease/owned-labels-capability.js";
import type { ResourceLabels } from "../supervisor/provider.js";

const LABELS: ResourceLabels = {
  organizationId: "org-1",
  targetId: "tgt-1",
  workerId: "wkr-1",
  jobId: "job-1",
  attempt: 3,
  leaseId: "lease-1",
  deviceGeneration: 7,
};

function realCapability() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return signOwnedLabelsCapability(
    { v: 1, audience: "adapter-manager", ownedLabels: LABELS, expiresAt: 1_000_000 },
    privateKey,
  );
}

describe("isOwnedLabelsCapabilityShape — the vendored guard pinned to the real cap", () => {
  it("ACCEPTS a real minted capability", () => {
    expect(isOwnedLabelsCapabilityShape(realCapability())).toBe(true);
  });

  it("REJECTS non-records", () => {
    expect(isOwnedLabelsCapabilityShape(null)).toBe(false);
    expect(isOwnedLabelsCapabilityShape(undefined)).toBe(false);
    expect(isOwnedLabelsCapabilityShape("x")).toBe(false);
    expect(isOwnedLabelsCapabilityShape([])).toBe(false);
  });

  it("REJECTS a capability missing or mistyping each top-level field", () => {
    const good = realCapability();
    for (const drop of ["v", "audience", "expiresAt", "sig", "ownedLabels"] as const) {
      const bad: Record<string, unknown> = { ...good };
      delete bad[drop];
      expect(isOwnedLabelsCapabilityShape(bad), `missing ${drop}`).toBe(false);
    }
    expect(isOwnedLabelsCapabilityShape({ ...good, v: "1" })).toBe(false);
    expect(isOwnedLabelsCapabilityShape({ ...good, audience: 1 })).toBe(false);
    expect(isOwnedLabelsCapabilityShape({ ...good, expiresAt: "soon" })).toBe(false);
    expect(isOwnedLabelsCapabilityShape({ ...good, sig: 1 })).toBe(false);
    expect(isOwnedLabelsCapabilityShape({ ...good, ownedLabels: "x" })).toBe(false);
  });

  it("REJECTS a capability whose ownedLabels drop or mistype any of the 7 fields", () => {
    const good = realCapability();
    for (const drop of Object.keys(LABELS) as (keyof ResourceLabels)[]) {
      const labels: Record<string, unknown> = { ...LABELS };
      delete labels[drop];
      expect(isOwnedLabelsCapabilityShape({ ...good, ownedLabels: labels }), `missing label ${drop}`).toBe(false);
    }
    // attempt/deviceGeneration are NUMBERS; a string is a forgery-adjacent drift.
    expect(isOwnedLabelsCapabilityShape({ ...good, ownedLabels: { ...LABELS, attempt: "3" } })).toBe(false);
    expect(isOwnedLabelsCapabilityShape({ ...good, ownedLabels: { ...LABELS, deviceGeneration: "7" } })).toBe(false);
    expect(isOwnedLabelsCapabilityShape({ ...good, ownedLabels: { ...LABELS, organizationId: 1 } })).toBe(false);
  });
});
