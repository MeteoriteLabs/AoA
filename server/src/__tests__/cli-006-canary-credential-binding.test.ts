// CLI-006 (Task 1) — the canary credential binding asserts nothing, on purpose.
//
// These tests exist to stop a future edit from "enriching" the binding. Every
// field is null because that is the only claim TRUE at this seam: the lease
// envelope ships `secretHandles: []` (job-leasing.ts:349) and no production path
// mints `job_secret_handles`, so a distributed canary receives no provider
// credential at all. A binding naming one would describe a delivery that does not
// happen.
//
// The safety argument is structural, not a predicate: every job hardcodes
// `requestedTarget: null` (job-submission.ts:134-138), so with all four fields
// null the pin is null, `chooseExecutionTargetRow` falls to the `pooled_gvisor`
// branch (execution-target-resolver.ts:195), and a `pooled_gvisor` row can ONLY
// normalize as `managed_cloud` (TARGET_KIND_BY_CLASS maps `owner_desktop` to
// {desktop, local_host} only). No reachable path to an owner_desktop target.
//
// That matters because the check that would otherwise catch owner misrouting is
// tautological: `credentialOwnerId` is read off the ROUTED target's profile
// (job-placement.ts:279-281) and `requiredOwnerPrincipalId` off the SAME profile
// (:289), so `candidateFits` compares a value to itself (:548-555).

import { describe, expect, it } from "vitest";
import {
  CANARY_CREDENTIAL_BINDING,
  resolveCanaryCredentialBinding,
} from "../services/canary-credential-binding.js";

describe("CLI-006 — canary credential binding", () => {
  // Any non-null value here re-opens owner routing or breaks placement replay.
  it("asserts nothing: every field is null", () => {
    expect(resolveCanaryCredentialBinding()).toEqual({
      credentialId: null,
      credentialKind: null,
      executionTargetSlug: null,
      pinnedTargetId: null,
    });
  });

  // `credentialKind: "personal_subscription"` would take the owner-routing branch
  // at execution-target-resolver.ts:188; a non-null `pinnedTargetId` would take the
  // pin branch at :180. Both re-open the DE-29 owner-misrouting class the null
  // binding structurally excludes.
  it.each(["credentialKind", "pinnedTargetId", "executionTargetSlug"] as const)(
    "keeps `%s` null — a value there re-opens owner routing",
    (field) => {
      expect(resolveCanaryCredentialBinding()[field]).toBeNull();
    },
  );

  // The binding is hashed into placementInputDigest/placementPolicyDigest
  // (job-placement.ts:315 → :333-335). A digest that changes between the first
  // placement and a retry throws `placement_already_decided`
  // (job-placement-transaction.ts:211-217) → transfer_error → that run falls back
  // to legacy permanently. So the binding must be byte-stable across calls, which
  // is exactly why it carries no rotating value such as a key generation.
  it("is byte-stable across calls (placement replay depends on a stable digest)", () => {
    const a = JSON.stringify(resolveCanaryCredentialBinding());
    const b = JSON.stringify(resolveCanaryCredentialBinding());
    expect(a).toBe(b);
  });

  it("ignores its inputs entirely — it takes no db handle and performs no read", () => {
    const withArgs = (resolveCanaryCredentialBinding as unknown as (i: unknown) => unknown)({
      organizationId: "org-a",
      companyId: "co-a",
      jobId: "job-a",
      sourceKind: "task_run",
    });
    expect(withArgs).toEqual(resolveCanaryCredentialBinding());
    expect(resolveCanaryCredentialBinding.length).toBe(0);
  });

  // The key SET is part of the digest — canonical JSON serializes Object.keys —
  // so an omitted key is a DIFFERENT digest, not an equivalent one.
  it("always carries all four keys, so the canonical key set is stable", () => {
    expect(Object.keys(resolveCanaryCredentialBinding()).sort()).toEqual([
      "credentialId",
      "credentialKind",
      "executionTargetSlug",
      "pinnedTargetId",
    ]);
  });

  it("hands out a copy, so a caller cannot mutate the shared constant", () => {
    const first = resolveCanaryCredentialBinding() as Record<string, unknown>;
    first.credentialKind = "personal_subscription";
    expect(resolveCanaryCredentialBinding().credentialKind).toBeNull();
    expect(CANARY_CREDENTIAL_BINDING.credentialKind).toBeNull();
  });
});
