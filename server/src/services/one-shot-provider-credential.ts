/**
 * U13.0 — the S3 resolver Wave 3's one-shot provider CLIs (extraction,
 * Commander compaction, readiness probes) share to get the COMPANY's own
 * model-provider key + its env var name + resolved model before spawning a
 * CLI inside an ephemeral sandbox.
 *
 * U12 built only the catch-mapper (`mapCloudProviderKeyError`,
 * require-cloud-provider-key.ts) that re-labels a thrown
 * `ProviderUnavailableError` into founder-facing copy at a sink boundary.
 * This module builds the actual VALUE: a thin adapter over the one unified
 * `resolveProviderCredential` (provider-resolution.ts). It never re-checks
 * `tenantIsolationEnforced()` and never wraps/renames the resolver's throw —
 * `resolveProviderCredential` already fails closed with
 * `ProviderUnavailableError` on multi-tenant when no company key resolves,
 * and that error propagates to the caller UNCHANGED so `mapCloudProviderKeyError`
 * can re-label it at the sink.
 */
import type { Db } from "@armyofagents/db";
import { internalAgentConfig } from "@armyofagents/db";
import { eq } from "drizzle-orm";
import { resolveProviderCredential, ProviderUnavailableError } from "./provider-resolution.js";
import { buildResolveDeps } from "./provider-resolution-deps.js";
import { resolveCliAuthTopology } from "./cli-auth-topology.js";
import { loadConfig } from "../config.js";
import { DEFAULT_CODEX_CHAT_MODEL } from "./internal-agent/codex-model.js";

export interface CompanyProviderCredential {
  envName: string;
  value: string;
  provider: string;
  model: string;
}

/**
 * Per-provider fallback model, used only when the company has no
 * `internal_agent_config` row (or its `model` column is null). No shared
 * exported "default model per provider" helper exists today (the closest,
 * `DEFAULT_MODELS` in `internal-agent/providers/index.ts`, is module-private
 * and Provider-SDK/embeddings-only per CLAUDE.md) — so this mirrors the two
 * real defaults that already exist elsewhere: the `internal_agent_config.model`
 * DB column default ("claude-sonnet-4-6", packages/db/src/schema/internal_agent.ts)
 * for anthropic, and the exported `DEFAULT_CODEX_CHAT_MODEL` ("gpt-5.5",
 * internal-agent/codex-model.ts) for openai/codex.
 */
function providerDefaultModel(provider: string): string {
  return provider === "openai" ? DEFAULT_CODEX_CHAT_MODEL : "claude-sonnet-4-6";
}

/**
 * Resolve the company's own provider credential (env var name + value),
 * provider id, and model for a one-shot CLI spawn (extraction, Commander
 * compaction, readiness probes). `currentEnv` is always `{}` — this resolver
 * never reads the host process env, so it can never trip
 * `resolveProviderCredential`'s Step-0 `agent_env_override` short-circuit
 * with an ambient operator credential, and it never leaks the host's
 * embeddings/operator keys into a sandbox.
 */
export async function resolveCompanyProviderCredential(
  db: Db,
  companyId: string,
  opts: { cliTool: string },
): Promise<CompanyProviderCredential> {
  const provider = opts.cliTool === "codex" ? "openai" : "anthropic";
  const adapterType = opts.cliTool === "codex" ? "codex_local" : "claude_local";

  const config = loadConfig();
  const topology = resolveCliAuthTopology({
    deploymentMode: config.deploymentMode,
    deploymentExposure: config.deploymentExposure,
  });
  const deps = buildResolveDeps(db, topology);

  const resolved = await resolveProviderCredential(
    db,
    {
      organizationId: null,
      companyId,
      agentId: null,
      actorKind: "crew",
      adapterType,
      provider,
      executionTargetId: "control-plane",
      currentEnv: {},
      context: {
        consumerType: "agent",
        consumerId: companyId,
        actorType: "agent",
        actorId: companyId,
      },
    },
    deps,
  );

  const envName = deps.envVarForProvider(provider);
  const value = "envPatch" in resolved ? resolved.envPatch?.[envName] : undefined;
  if (!value) {
    throw new ProviderUnavailableError(provider, "empty_credential", null);
  }

  const [row] = await db
    .select({ model: internalAgentConfig.model })
    .from(internalAgentConfig)
    .where(eq(internalAgentConfig.companyId, companyId));
  const model = row?.model ?? providerDefaultModel(provider);

  return { envName, value, provider, model };
}
