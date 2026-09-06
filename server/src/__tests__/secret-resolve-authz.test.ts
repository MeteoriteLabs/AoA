import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  authorizeSecretResolve,
  SECRET_REF_KINDS,
  type SecretResolveAuthzInput,
} from "@armyofagents/db";

// -----------------------------------------------------------------------------
// DAT-004 — the PURE lease-scoped secret-resolve authorization decision.
//
// `authorizeSecretResolve` is the post-fence, in-tx decision the guarded
// `resolveExecutionSecret` mutator consults AFTER `guardActiveFence` has proven the
// lease/attempt/target identity. It re-checks (defense in depth) the widened handle
// row's non-secret binding against the LOCKED job owner + live target generation +
// owner membership. It NEVER sees a secret value. Every refusal is a closed internal
// reason (the service maps every non-fence refusal to a coarse, non-disclosing
// `malformed`). This is a pure function — no DB, verify lane.
// -----------------------------------------------------------------------------

const OWNER = { executorPrincipalKind: "user", executorPrincipalId: "user-owner-1" } as const;

function base(overrides: Partial<SecretResolveAuthzInput["handle"]> = {}): SecretResolveAuthzInput {
  return {
    handle: {
      status: "active",
      refKind: "company_secret",
      refId: "company-secret-abc",
      materialization: "env",
      usePolicy: "sandbox_local_only",
      destination: null,
      boundTargetGeneration: null,
      ownerPrincipalKind: null,
      ownerPrincipalId: null,
      ...overrides,
    },
    jobOwner: { ...OWNER },
    ownerMembershipActive: null,
    liveTargetGeneration: 7,
    liveTargetId: LIVE_TARGET_ID,
    // NOTE: the compiler does NOT protect this file. `server/tsconfig.json` excludes
    // `src/__tests__` and vitest erases types, so the `SecretResolveAuthzInput`
    // annotation above would have accepted a missing `deviceCredential` and passed
    // `undefined` silently. Only `job-control.ts` errors on the real signature.
    deviceCredential: null,
  };
}

/** A verified credential owned by OWNER on a target owned by OWNER. */
function verifiedCredential(over: Record<string, unknown> = {}) {
  return {
    state: "verified",
    ownerUserId: OWNER.executorPrincipalId,
    executionTargetId: LIVE_TARGET_ID,
    ...over,
  };
}

/** `ref_id` for device_local is the provider_credentials uuid PK (D12/1). */
const DEVICE_CREDENTIAL_ID = "b3f1c2d4-5e6a-4b7c-8d9e-0f1a2b3c4d5e";
/** The device the job is placed on — a device_local credential must live on it. */
const LIVE_TARGET_ID = "a3000000-0000-4000-8000-000000000003";

describe("DAT-004 authorizeSecretResolve (pure decision)", () => {
  it("admits a well-formed non-owner-bound company_secret handle", () => {
    expect(authorizeSecretResolve(base())).toBe("admit");
  });

  it("admits a fence_proxy connector_oauth handle bound to a destination", () => {
    expect(authorizeSecretResolve(base({
      refKind: "connector_oauth",
      materialization: "proxy",
      usePolicy: "fence_proxy",
      destination: "https://api.notion.com",
    }))).toBe("admit");
  });

  it("admits a device_local handle owned by the locked job executor with active membership", () => {
    const input = base({
      refKind: "device_local",
      refId: DEVICE_CREDENTIAL_ID,
      materialization: "file",
      usePolicy: "sandbox_local_only",
      ownerPrincipalKind: "user",
      ownerPrincipalId: "user-owner-1",
    });
    input.ownerMembershipActive = true;
    input.deviceCredential = verifiedCredential();
    expect(authorizeSecretResolve(input)).toBe("admit");
  });

  it("DENIES a revoked handle", () => {
    expect(authorizeSecretResolve(base({ status: "revoked" }))).toBe("handle_revoked");
  });

  it("DENIES an unknown ref_kind", () => {
    expect(authorizeSecretResolve(base({ refKind: "totally_new_store" }))).toBe("unknown_ref_kind");
    expect(authorizeSecretResolve(base({ refKind: null }))).toBe("unknown_ref_kind");
  });

  it("DENIES a half-minted handle with a ref_kind but no ref_id (broker pointer missing)", () => {
    expect(authorizeSecretResolve(base({ refId: null }))).toBe("ref_pointer_missing");
    expect(authorizeSecretResolve(base({ refId: "" }))).toBe("ref_pointer_missing");
  });

  it("DENIES proxy materialization that does not claim fence_proxy", () => {
    expect(authorizeSecretResolve(base({
      refKind: "connector_oauth", materialization: "proxy", usePolicy: "remote_server_fenced",
    }))).toBe("materialization_policy_conflict");
  });

  it("DENIES env/file materialization that claims fence_proxy", () => {
    expect(authorizeSecretResolve(base({
      materialization: "env", usePolicy: "fence_proxy",
    }))).toBe("materialization_policy_conflict");
    expect(authorizeSecretResolve(base({
      materialization: "file", usePolicy: "fence_proxy",
    }))).toBe("materialization_policy_conflict");
  });

  it("DENIES a sandbox_local_only handle that carries a network destination (no egress path)", () => {
    expect(authorizeSecretResolve(base({
      materialization: "env", usePolicy: "sandbox_local_only", destination: "https://evil.example",
    }))).toBe("sandbox_local_network_destination");
  });

  it("DENIES a target-generation mismatch (D5 handle pinning)", () => {
    expect(authorizeSecretResolve(base({ boundTargetGeneration: 6 }))).toBe("target_generation_mismatch");
  });

  it("ADMITS when bound_target_generation equals the live generation", () => {
    expect(authorizeSecretResolve(base({ boundTargetGeneration: 7 }))).toBe("admit");
  });

  it("DENIES a device_local handle with no denormalized owner (incomplete binding)", () => {
    const input = base({ refKind: "device_local", refId: DEVICE_CREDENTIAL_ID, materialization: "file", usePolicy: "sandbox_local_only" });
    input.ownerMembershipActive = true;
    expect(authorizeSecretResolve(input)).toBe("owner_binding_incomplete");
  });

  it("DENIES an owner-bound handle whose owner is NOT the locked job executor", () => {
    const input = base({
      refKind: "device_local", refId: DEVICE_CREDENTIAL_ID, materialization: "file", usePolicy: "sandbox_local_only",
      ownerPrincipalKind: "user", ownerPrincipalId: "someone-else",
    });
    input.ownerMembershipActive = true;
    expect(authorizeSecretResolve(input)).toBe("owner_binding_incomplete");
  });

  it("DENIES an owner-bound handle whose owner lost company membership (re-check at resolve)", () => {
    const input = base({
      refKind: "device_local", refId: DEVICE_CREDENTIAL_ID, materialization: "file", usePolicy: "sandbox_local_only",
      ownerPrincipalKind: "user", ownerPrincipalId: "user-owner-1",
    });
    input.ownerMembershipActive = false;
    expect(authorizeSecretResolve(input)).toBe("owner_membership_lost");
  });

  it("re-checks membership for ANY owner-bound handle, not only device_local", () => {
    const input = base({
      refKind: "company_secret", materialization: "env", usePolicy: "sandbox_local_only",
      ownerPrincipalKind: "user", ownerPrincipalId: "user-owner-1",
    });
    input.ownerMembershipActive = false;
    expect(authorizeSecretResolve(input)).toBe("owner_membership_lost");
  });

  it("pins the ref-kind set to exactly the four legacy stores", () => {
    expect([...SECRET_REF_KINDS].sort()).toEqual(
      ["company_secret", "connector_oauth", "device_local", "provider_key"],
    );
  });
});

// -----------------------------------------------------------------------------
// DAT-004 review #D — bind the committed vectors fixture to the REAL
// `authorizeSecretResolve`. The `policy`-lane checker only runs the mirror
// `decideResolve`; without this, the mirror and the real fn can silently diverge
// (the review found a real dormant divergence on undefined handling). This asserts
// the real fn reproduces every committed vector's decision.
// -----------------------------------------------------------------------------
describe("authorizeSecretResolve — bound to the committed vectors fixture", () => {
  const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../tests/fixtures/secret-resolve/v1/vectors.json",
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    context: { jobOwner: { executorPrincipalKind: string; executorPrincipalId: string }; liveTargetGeneration: number };
    admitVectors: Array<{ name: string; handle: Record<string, unknown>; ownerMembershipActive: boolean | null }>;
    rejectVectors: Array<{ name: string; reason: string; handle: Record<string, unknown>; ownerMembershipActive: boolean | null }>;
  } & {
    admitVectors: Array<{ deviceCredential?: unknown }>;
    rejectVectors: Array<{ deviceCredential?: unknown }>;
  };
  // The DB always sends `null` (never `undefined`) for a missing column — normalize so
  // the fixture faithfully models a persisted row.
  const asInput = (
    handle: Record<string, unknown>,
    ownerMembershipActive: boolean | null,
    deviceCredential: unknown = null,
  ): SecretResolveAuthzInput => ({
    handle: {
      status: (handle.status ?? null) as never,
      refKind: (handle.refKind ?? null) as never,
      refId: (handle.refId ?? null) as never,
      materialization: (handle.materialization ?? null) as never,
      usePolicy: (handle.usePolicy ?? null) as never,
      destination: (handle.destination ?? null) as never,
      boundTargetGeneration: (handle.boundTargetGeneration ?? null) as never,
      ownerPrincipalKind: (handle.ownerPrincipalKind ?? null) as never,
      ownerPrincipalId: (handle.ownerPrincipalId ?? null) as never,
    },
    jobOwner: fixture.context.jobOwner,
    ownerMembershipActive,
    liveTargetGeneration: fixture.context.liveTargetGeneration,
    liveTargetId: (fixture.context as { liveTargetId: string }).liveTargetId,
    deviceCredential: (deviceCredential ?? null) as never,
  });

  it("admits every committed admit vector", () => {
    for (const v of fixture.admitVectors) {
      expect(authorizeSecretResolve(asInput(v.handle, v.ownerMembershipActive, v.deviceCredential))).toBe("admit");
    }
  });
  it("rejects every committed reject vector with the exact reason", () => {
    for (const v of fixture.rejectVectors) {
      expect(authorizeSecretResolve(asInput(v.handle, v.ownerMembershipActive, v.deviceCredential))).toBe(v.reason);
    }
  });
});
