import type { DeploymentMode, Environment } from "@armyofagents/shared";

// Cosmetic label only — never exported, never looked up via environments.get().
// The precedence stack (task > agent > company > platform) resolves this branch
// synthetically in-memory; there is no routable sentinel id for it.
const PLATFORM_DEFAULT_ENVIRONMENT_ID = "platform-default-e2b";

function read(env: Record<string, string | undefined>, key: string): string | null {
  const v = env[key]?.trim();
  return v && v.length > 0 ? v : null;
}

/**
 * Synthesizes the PLATFORM layer of the environment precedence stack: an
 * AoA-Cloud-hosted E2B sandbox environment used when a task/agent/company
 * environment override is absent. Only active on cloud_auth deployments and
 * only when the operator has configured E2B_API_KEY — otherwise null (host
 * execution / environment_not_found stays the caller's fallback).
 *
 * The operator API key itself is deliberately NOT placed in the returned
 * config — the E2B driver resolves it from env at acquire time (see
 * sandbox-provider-runtime.ts resolveE2bApiKey), keeping the secret out of
 * any persisted/serialized Environment.
 */
export function resolvePlatformDefaultEnvironment(input: {
  companyId: string;
  deploymentMode: DeploymentMode;
  env?: Record<string, string | undefined>;
}): Environment | null {
  if (input.deploymentMode !== "cloud_auth") return null;

  const env = input.env ?? process.env;
  if (!read(env, "E2B_API_KEY")) return null;

  const now = new Date(0).toISOString();
  const domain = read(env, "E2B_DOMAIN");
  const timeoutRaw = Number(read(env, "E2B_TIMEOUT_MS") ?? "");
  const timeoutMs = Number.isInteger(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 3_600_000;

  return {
    id: PLATFORM_DEFAULT_ENVIRONMENT_ID,
    companyId: input.companyId,
    name: "Platform default (E2B)",
    description: null,
    driver: "sandbox",
    status: "active",
    config: {
      provider: "e2b",
      template: read(env, "E2B_TEMPLATE") ?? "base",
      timeoutMs,
      reuseLease: false,
      ...(domain ? { domain } : {}),
    },
    metadata: { platformDefault: true },
    envVars: {},
    connectionTarget: null,
    target: null,
    executionTargetId: null,
    createdAt: now,
    updatedAt: now,
  };
}
