/**
 * U13.0 — resolveCompanyProviderCredential is a thin adapter over the one
 * unified `resolveProviderCredential`. This suite injects a spy for
 * `resolveProviderCredential` (keeping the REAL `ProviderUnavailableError`
 * class via importOriginal, so instanceof/reference checks hold across the
 * mock boundary) plus a fake `internal_agent_config` model row, and asserts:
 *   - cliTool -> provider mapping (claude -> anthropic, codex -> openai)
 *   - resolveProviderCredential is called with actorKind:"crew",
 *     currentEnv:{} (NEVER the host env), companyId, and the right
 *     provider/adapterType
 *   - envName/value come from envVarForProvider + envPatch, for both the
 *     "connection" and "legacy" credential sources
 *   - a thrown ProviderUnavailableError propagates UNCHANGED (never
 *     wrapped/renamed) — the sink-level mapCloudProviderKeyError (U12) is the
 *     only place that re-labels it
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveProviderCredentialMock = vi.hoisted(() => vi.fn());
const buildResolveDepsMock = vi.hoisted(() => vi.fn());
const resolveCliAuthTopologyMock = vi.hoisted(() => vi.fn(() => ({ trustBoundary: "multi_tenant" })));
const loadConfigMock = vi.hoisted(() =>
  vi.fn(() => ({ deploymentMode: "cloud_auth", deploymentExposure: "public" })),
);

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _tag: "eq", a, b })),
}));

vi.mock("@armyofagents/db", () => ({
  internalAgentConfig: { companyId: Symbol("internalAgentConfig.companyId"), model: Symbol("internalAgentConfig.model") },
}));

vi.mock("../services/provider-resolution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/provider-resolution.js")>();
  return { ...actual, resolveProviderCredential: resolveProviderCredentialMock };
});

vi.mock("../services/provider-resolution-deps.js", () => ({
  buildResolveDeps: buildResolveDepsMock,
}));

vi.mock("../services/cli-auth-topology.js", () => ({
  resolveCliAuthTopology: resolveCliAuthTopologyMock,
}));

vi.mock("../config.js", () => ({ loadConfig: loadConfigMock }));

import { resolveCompanyProviderCredential } from "../services/one-shot-provider-credential.js";
import { ProviderUnavailableError } from "../services/provider-resolution.js";

const COMPANY_ID = "co-1";

const ENV_VAR_FOR_PROVIDER: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** Fake db: `.select({model}).from(internalAgentConfig).where(eq(...))` resolves
 *  to a single-row (or empty) array, mirroring the real drizzle awaitable chain. */
function fakeDb(modelRow: { model: string | null } | null) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(modelRow ? [modelRow] : [])),
      })),
    })),
  } as never;
}

describe("resolveCompanyProviderCredential (U13.0)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCliAuthTopologyMock.mockReturnValue({ trustBoundary: "multi_tenant" });
    loadConfigMock.mockReturnValue({ deploymentMode: "cloud_auth", deploymentExposure: "public" });
    buildResolveDepsMock.mockReturnValue({
      envVarForProvider: (provider: string) => ENV_VAR_FOR_PROVIDER[provider] ?? "ANTHROPIC_API_KEY",
    });
  });

  it("maps cliTool 'claude' -> provider 'anthropic' and calls resolveProviderCredential with actorKind:crew, currentEnv:{}, companyId", async () => {
    resolveProviderCredentialMock.mockResolvedValue({
      source: "connection",
      envPatch: { ANTHROPIC_API_KEY: "sk-co" },
    });
    const db = fakeDb({ model: "claude-sonnet-4-6" });

    await resolveCompanyProviderCredential(db, COMPANY_ID, { cliTool: "claude" });

    expect(resolveProviderCredentialMock).toHaveBeenCalledTimes(1);
    const [, args] = resolveProviderCredentialMock.mock.calls[0];
    expect(args).toMatchObject({
      organizationId: null,
      companyId: COMPANY_ID,
      agentId: null,
      actorKind: "crew",
      adapterType: "claude_local",
      provider: "anthropic",
      executionTargetId: "control-plane",
      currentEnv: {},
    });
  });

  it("returns {envName, value, provider, model} from a 'connection' source, using envVarForProvider + envPatch", async () => {
    resolveProviderCredentialMock.mockResolvedValue({
      source: "connection",
      envPatch: { ANTHROPIC_API_KEY: "sk-co" },
    });
    const db = fakeDb({ model: "claude-opus-4-9" });

    const result = await resolveCompanyProviderCredential(db, COMPANY_ID, { cliTool: "claude" });

    expect(result).toEqual({
      envName: "ANTHROPIC_API_KEY",
      value: "sk-co",
      provider: "anthropic",
      model: "claude-opus-4-9",
    });
  });

  it("returns the same shape from a 'legacy' source carrying the company key", async () => {
    resolveProviderCredentialMock.mockResolvedValue({
      source: "legacy",
      envPatch: { ANTHROPIC_API_KEY: "sk-legacy-co" },
    });
    const db = fakeDb({ model: "claude-sonnet-4-6" });

    const result = await resolveCompanyProviderCredential(db, COMPANY_ID, { cliTool: "claude" });

    expect(result).toEqual({
      envName: "ANTHROPIC_API_KEY",
      value: "sk-legacy-co",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });

  it("propagates a thrown ProviderUnavailableError UNCHANGED (never wrapped/renamed)", async () => {
    const thrown = new ProviderUnavailableError("anthropic", "no_assignment", null);
    resolveProviderCredentialMock.mockRejectedValue(thrown);
    const db = fakeDb({ model: "claude-sonnet-4-6" });

    await expect(resolveCompanyProviderCredential(db, COMPANY_ID, { cliTool: "claude" })).rejects.toBe(
      thrown,
    );
  });

  it("maps cliTool 'codex' -> provider 'openai', adapterType 'codex_local'", async () => {
    resolveProviderCredentialMock.mockResolvedValue({
      source: "connection",
      envPatch: { OPENAI_API_KEY: "sk-oai-co" },
    });
    const db = fakeDb({ model: "gpt-5.5" });

    const result = await resolveCompanyProviderCredential(db, COMPANY_ID, { cliTool: "codex" });

    const [, args] = resolveProviderCredentialMock.mock.calls[0];
    expect(args).toMatchObject({ provider: "openai", adapterType: "codex_local" });
    expect(result).toEqual({
      envName: "OPENAI_API_KEY",
      value: "sk-oai-co",
      provider: "openai",
      model: "gpt-5.5",
    });
  });

  it("throws ProviderUnavailableError('empty_credential') when the resolved credential has no value for envVarForProvider", async () => {
    resolveProviderCredentialMock.mockResolvedValue({ source: "host_login_fallback" });
    const db = fakeDb({ model: "claude-sonnet-4-6" });

    await expect(
      resolveCompanyProviderCredential(db, COMPANY_ID, { cliTool: "claude" }),
    ).rejects.toMatchObject({ name: "ProviderUnavailableError", reason: "empty_credential" });
  });
});
