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

import type { AssignmentScopeType } from "@armyofagents/shared";

export interface Candidate {
  connectionId: string;
  authMethod: AuthMethod;
  scopeType: AssignmentScopeType;
  priority: number;
  connectionUpdatedAt: number;
}

const SCOPE_RANK: Record<AssignmentScopeType, number> = {
  agent_override: 3,
  personal_execution_default: 2,
  company_default: 1,
  org_default: 0,
};

/** Deterministic precedence order: scope rank, then priority DESC, then recency DESC. */
export function orderCandidates<T extends Candidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) => {
    if (SCOPE_RANK[a.scopeType] !== SCOPE_RANK[b.scopeType]) {
      return SCOPE_RANK[b.scopeType] - SCOPE_RANK[a.scopeType];
    }
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.connectionUpdatedAt - a.connectionUpdatedAt;
  });
}

// `SharingPolicy` is already imported at the top of this file (Task 4); the plan's
// Task-6 block re-imports it, which would be a duplicate identifier — only the new
// value `isShareableAuthMethod` is imported here.
import { isShareableAuthMethod } from "@armyofagents/shared";

export type ProviderResolutionActor = "crew" | "org" | "commander";

export interface GateInput {
  authMethod: AuthMethod;
  scopeType: AssignmentScopeType;
  state: string;
  termsAttestedAt: Date | null;
  sharingPolicy: SharingPolicy;
  actorKind: ProviderResolutionActor;
  connectionCompanyId: string | null;
  requestCompanyId: string;
  connectionOwnerUserId: string | null;
  /** The acting/owner user for this run (Commander user, or the target owner). */
  requestOwnerUserId: string | null;
}

export interface GateResult {
  ok: boolean;
  reason?: string;
}

/**
 * Static (non-subscription) fail-closed gates. The personal_subscription
 * candidate ALSO runs chooseGovernedSubscriptionBinding downstream (owner-active,
 * target match, exactly-one) — this gate only enforces the rules that need no DB
 * join. A failing candidate is SKIPPED, not fatal (the caller tries the next).
 */
export function candidatePassesStaticGates(input: GateInput): GateResult {
  if (input.state !== "verified") return { ok: false, reason: "state_not_verified" };
  if (!input.termsAttestedAt) return { ok: false, reason: "terms_not_attested" };
  // org/company defaults may only route shareable methods (locked decision).
  if (
    (input.scopeType === "org_default" || input.scopeType === "company_default") &&
    !isShareableAuthMethod(input.authMethod)
  ) {
    return { ok: false, reason: "non_shareable_default" };
  }
  // Sharing policy.
  switch (input.sharingPolicy) {
    case "owner_only":
      if (!input.requestOwnerUserId || input.requestOwnerUserId !== input.connectionOwnerUserId) {
        return { ok: false, reason: "owner_only_mismatch" };
      }
      break;
    case "company_agents":
      if (input.connectionCompanyId && input.connectionCompanyId !== input.requestCompanyId) {
        return { ok: false, reason: "company_scope_mismatch" };
      }
      break;
    case "org_agents":
      // org-scope enforced by the assignment query (organization_id filter); allow here.
      break;
  }
  return { ok: true };
}
