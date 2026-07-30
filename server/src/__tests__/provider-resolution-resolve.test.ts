// server/src/__tests__/provider-resolution-resolve.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@armyofagents/db", () => ({
  providerConnections: {}, providerAssignments: {}, companyMemberships: {},
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ and: a }), eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  or: (...a: unknown[]) => ({ or: a }), isNull: (a: unknown) => ({ isNull: a }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
}));

import { resolveProviderCredential } from "../services/provider-resolution.js";

// Minimal deps double: no assignment rows → must fall back to the legacy path.
function makeDeps(overrides: Partial<Parameters<typeof resolveProviderCredential>[2]> = {}) {
  return {
    loadCandidateRows: vi.fn(async () => []),
    resolveSecretValueForConnection: vi.fn(async () => null),
    resolveSubscriptionEnv: vi.fn(async () => ({})),
    envVarForProvider: () => "ANTHROPIC_API_KEY",
    // legacy hooks: return a REAL env delta so a legacy company key produces a
    // non-empty patch (empty → host_login_fallback, which contradicts the "legacy"
    // assertion below — M9). Tests that want host_login_fallback override this.
    legacyResolveConfig: vi.fn(async () => ({ env: { ANTHROPIC_API_KEY: "sk-legacy" } })),
    legacySubscriptionEnv: vi.fn(async () => null),
    selfHostedSingleTenant: true,
    ...overrides,
  };
}

const args = {
  organizationId: null, companyId: "co1", agentId: "ag1", actorKind: "crew" as const,
  adapterType: "claude_local", provider: "anthropic", executionTargetId: "control-plane",
  currentEnv: {} as Record<string, string>,
  context: { consumerType: "agent" as const, consumerId: "ag1", actorType: "agent" as const, actorId: "ag1" },
};

describe("resolveProviderCredential", () => {
  it("agent already carries the api key → agent_env_override, no injection", async () => {
    const deps = makeDeps();
    const r = await resolveProviderCredential(
      {} as never,
      { ...args, currentEnv: { ANTHROPIC_API_KEY: "sk-mine" } },
      deps as never,
    );
    expect(r.source).toBe("agent_env_override");
    expect(deps.loadCandidateRows).not.toHaveBeenCalled();
  });

  it("no new-model assignment → falls back to legacy path", async () => {
    const deps = makeDeps();
    const r = await resolveProviderCredential({} as never, args, deps as never);
    expect(r.source).toBe("legacy");
    expect(deps.legacyResolveConfig).toHaveBeenCalled();
  });

  it("verified company_default api_key → connection env patch", async () => {
    const deps = makeDeps({
      loadCandidateRows: vi.fn(async () => [{
        connectionId: "conn1", authMethod: "api_key", scopeType: "company_default",
        priority: 0, connectionUpdatedAt: 1, state: "verified", termsAttestedAt: new Date(),
        sharingPolicy: "company_agents", connectionCompanyId: "co1", connectionOwnerUserId: null,
        executionTargetId: null, config: {}, secretRef: "sec1",
      }]),
      resolveSecretValueForConnection: vi.fn(async () => "sk-company"),
    });
    const r = await resolveProviderCredential({} as never, args, deps as never);
    expect(r.source).toBe("connection");
    if (r.source === "connection") expect(r.envPatch).toEqual({ ANTHROPIC_API_KEY: "sk-company" });
  });
});
