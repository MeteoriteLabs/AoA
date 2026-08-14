import { describe, expect, it } from "vitest";
import type { AuthorizedSecretResolution } from "@armyofagents/db";
import { secretHandleRefSchema } from "@armyofagents/worker-protocol";
import {
  dispatchResolvedSecret,
  failClosedSecretBrokers,
  type SecretBrokerSet,
} from "../services/secret-broker.js";

// -----------------------------------------------------------------------------
// DAT-004 — broker dispatch seam (post-fence, post-authorization). Proves the
// no-value-to-sandbox (#1), audit-only-metadata (#4), and no-plaintext-on-wire (#3)
// invariants structurally, without a database.
// -----------------------------------------------------------------------------

const SECRET_MARKER = "SECRET-VALUE-should-never-hit-wire-or-sandbox";

function authorized(overrides: Partial<AuthorizedSecretResolution> = {}): AuthorizedSecretResolution {
  return {
    handleId: "handle-1",
    refKind: "company_secret",
    refId: "company-secret-1",
    materialization: "env",
    usePolicy: "sandbox_local_only",
    destination: null,
    ownerPrincipalKind: null,
    ownerPrincipalId: null,
    boundTargetGeneration: null,
    companyId: "company-1",
    resolveCount: 1,
    ...overrides,
  };
}

function recordingBrokers(): SecretBrokerSet & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async resolveConnectorOAuth(input) {
      calls.push(`oauth:${input.companyId}:${input.refId}`);
      return SECRET_MARKER;
    },
    async resolveProviderOrCompanySecret(input) {
      calls.push(`secret:${input.refKind}:${input.companyId}:${input.refId}`);
      return SECRET_MARKER;
    },
  };
}

describe("DAT-004 dispatchResolvedSecret", () => {
  it("resolves a connector_oauth handle to the fence_proxy seam via the OAuth broker", async () => {
    const brokers = recordingBrokers();
    const out = await dispatchResolvedSecret(authorized({
      refKind: "connector_oauth", refId: "mcp:oauth:notion", materialization: "proxy",
      usePolicy: "fence_proxy", destination: "https://api.notion.com",
    }), brokers);
    expect(out.outcome).toBe("resolved");
    if (out.outcome !== "resolved") return;
    expect(out.seam).toBe("fence_proxy");
    expect(out.material.value).toBe(SECRET_MARKER);
    expect(out.material.destination).toBe("https://api.notion.com");
    expect(brokers.calls).toEqual(["oauth:company-1:mcp:oauth:notion"]);
  });

  it("resolves provider_key / company_secret via the secret broker", async () => {
    const brokers = recordingBrokers();
    const prov = await dispatchResolvedSecret(authorized({
      refKind: "provider_key", refId: "provider:anthropic", materialization: "file",
      usePolicy: "remote_server_fenced", destination: "https://api.anthropic.com",
    }), brokers);
    expect(prov.outcome).toBe("resolved");
    if (prov.outcome !== "resolved") return;
    expect(prov.seam).toBe("remote_server_fenced");
    expect(brokers.calls).toEqual(["secret:provider_key:company-1:provider:anthropic"]);
  });

  it("returns a device_local HANDOFF DESCRIPTOR with NO value, without touching any broker", async () => {
    const brokers = recordingBrokers();
    const out = await dispatchResolvedSecret(authorized({
      refKind: "device_local", refId: "provider-credential-1", materialization: "file",
      usePolicy: "sandbox_local_only", ownerPrincipalKind: "user", ownerPrincipalId: "u1",
    }), brokers);
    expect(out.outcome).toBe("device_handoff");
    if (out.outcome !== "device_handoff") return;
    // No broker was invoked — the value never leaves the OS keystore.
    expect(brokers.calls).toEqual([]);
    // Structural no-value proof: the handoff descriptor carries NO secret bytes anywhere.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(SECRET_MARKER);
    expect(Object.keys(out.handoff)).not.toContain("value");
    expect(out.handoff.refId).toBe("provider-credential-1");
    expect(out.handoff.ownerPrincipalId).toBe("u1");
  });

  it("no-value-to-sandbox: a network-use handle delivers its value ONLY to a network seam", async () => {
    const brokers = recordingBrokers();
    const out = await dispatchResolvedSecret(authorized({
      refKind: "connector_oauth", refId: "mcp:oauth:x", materialization: "proxy",
      usePolicy: "fence_proxy", destination: "https://api.x",
    }), brokers);
    // The only value-bearing outcome is `resolved`, and its seam is a network seam
    // (fence_proxy/remote_server_fenced) — never a plain sandbox delivery of a
    // network-use handle.
    expect(out.outcome).toBe("resolved");
    if (out.outcome !== "resolved") return;
    expect(["fence_proxy", "remote_server_fenced"]).toContain(out.seam);
  });

  it("no-plaintext-on-wire: the resolved material is NOT a valid frozen SecretHandleRef", async () => {
    const brokers = recordingBrokers();
    const out = await dispatchResolvedSecret(authorized({
      refKind: "connector_oauth", refId: "mcp:oauth:x", materialization: "proxy",
      usePolicy: "fence_proxy", destination: "https://api.x",
    }), brokers);
    if (out.outcome !== "resolved") throw new Error("expected resolved");
    // The frozen wire ref is `.strict()` and forbids any token/value key — a resolved
    // material can never be serialized as a SecretHandleRef.
    expect(secretHandleRefSchema.safeParse(out.material).success).toBe(false);
    expect(secretHandleRefSchema.safeParse({
      handleId: "11111111-1111-4111-8111-111111111111",
      materialization: { kind: "proxy" },
      usePolicy: "fence_proxy",
      value: out.material.value,
    }).success).toBe(false);
  });

  it("fail-closed default brokers never yield a value for a network handle", async () => {
    await expect(dispatchResolvedSecret(authorized({
      refKind: "connector_oauth", refId: "mcp:oauth:x", materialization: "proxy",
      usePolicy: "fence_proxy", destination: "https://api.x",
    }), failClosedSecretBrokers)).rejects.toThrow();
  });
});
