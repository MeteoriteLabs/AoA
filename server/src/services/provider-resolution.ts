// server/src/services/provider-resolution.ts
import type { AuthMethod, SharingPolicy } from "@armyofagents/shared";

export interface MaterializeInput {
  authMethod: AuthMethod;
  provider: string;
  /** The provider's canonical api-key env var (envVarForProvider). */
  envVar: string;
  /** Resolved secret VALUE for shareable methods; null when none. */
  secretValue: string | null;
  config: Record<string, unknown>;
  /** For personal_subscription only: the home env from resolveAgentSubscriptionEnvironment. */
  subscriptionEnv: Record<string, string> | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

// GATEWAY_TOKEN_ENV_ALLOWLIST + DEFAULT_GATEWAY_TOKEN_ENV are the SINGLE source of
// truth in @armyofagents/shared (Task 3) — imported, never re-declared, so the
// create-time validation and this materialization clamp cannot drift.
import {
  DEFAULT_GATEWAY_TOKEN_ENV,
  GATEWAY_TOKEN_ENV_ALLOWLIST,
} from "@armyofagents/shared";

/**
 * Normalize any auth method to an env patch. This is the ONE seam that hides the
 * "api-key value vs subscription auth-home" divergence behind a single shape — a
 * patch merged onto config.env by applyResolvedCredential. Empty secret ⇒ inject
 * nothing (secrets.ts:970-973). The token env var for anthropic gateway is
 * ANTHROPIC_AUTH_TOKEN (a bearer for a proxy), NOT ANTHROPIC_API_KEY.
 */
export function materializeEnvPatch(input: MaterializeInput): Record<string, string> {
  switch (input.authMethod) {
    case "api_key": {
      const v = str(input.secretValue);
      return v ? { [input.envVar]: v } : {};
    }
    case "enterprise_gateway": {
      const base = str(input.config.baseUrl);
      const patch: Record<string, string> = {};
      if (base) patch.ANTHROPIC_BASE_URL = base;
      const token = str(input.secretValue);
      if (token) {
        const requested = str(input.config.tokenEnvVar) ?? DEFAULT_GATEWAY_TOKEN_ENV;
        const tokenEnv = GATEWAY_TOKEN_ENV_ALLOWLIST.has(requested)
          ? requested
          : DEFAULT_GATEWAY_TOKEN_ENV;
        patch[tokenEnv] = token;
      }
      return patch;
    }
    case "personal_subscription": {
      return { ...(input.subscriptionEnv ?? {}) };
    }
  }
}
