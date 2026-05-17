// server/src/services/internal-agent/authorize-tool.ts
//
// Role + capability gating for Commander tool invocations.
// See finding C13 in docs/superpowers/specs/2026-05-05-sprint-1-security-fixes-design.md.

import type { AgentCapability, UserRole } from "@armyofagents/shared";
import type { AgentTool, ToolCategory } from "./types.js";

const ROLE_RANK: Record<UserRole, number> = {
  team_member: 0,
  team_lead: 1,
  founder: 2,
};

/**
 * Maps capabilities (as stored in internal_agent_config.enabledCapabilities)
 * to tool categories. A tool whose category appears here is gated on the
 * corresponding capability being enabled. Categories not listed here are
 * always allowed (core query/coordination/file/workflow surface).
 *
 * If you add a new capability that should gate a category, add it here.
 */
export const CAPABILITY_TO_CATEGORY: Partial<Record<AgentCapability, ToolCategory>> = {
  discussion_processing: "discussion",
  system_actions: "action",
  memory_management: "memory",
};

export type ToolAuthDecision =
  | { allowed: true }
  | { allowed: false; error: "FORBIDDEN_ROLE" | "CAPABILITY_DISABLED" | "NOT_IN_ALLOWLIST"; summary: string };

/**
 * D2: Per-agent tool allowlist for AoA agents (Decision #95 access model).
 *
 * When agentKind is 'aoa', the toolAllowlist is enforced with default-deny
 * semantics: absent/empty allowlist = deny all. Non-AoA agents skip this gate
 * entirely (existing behavior preserved).
 */
export function authorizeToolInvocation(
  tool: AgentTool,
  userRole: string,
  enabledCapabilities: readonly string[],
  opts?: { agentKind?: string; toolAllowlist?: readonly string[] },
): ToolAuthDecision {
  // D2: AoA-specific tool allowlist gate (default-deny for kind='aoa').
  // Checked BEFORE role/capability gates so a misconfigured allowlist fails
  // closed rather than silently falling through to the less-restrictive gates.
  if (opts?.agentKind === "aoa") {
    const allowlist = opts.toolAllowlist;
    if (!allowlist || allowlist.length === 0 || !allowlist.includes(tool.name)) {
      return {
        allowed: false,
        error: "NOT_IN_ALLOWLIST",
        summary: `AoA agent tool allowlist does not include '${tool.name}'`,
      };
    }
  }

  // Fail closed on unknown role strings (e.g., a malformed
  // AOA_SESSION_USER_ROLE env var). Unknown roles map to no rank.
  const userRank = ROLE_RANK[userRole as UserRole];
  if (userRank === undefined || userRank < ROLE_RANK[tool.requiredRole]) {
    return {
      allowed: false,
      error: "FORBIDDEN_ROLE",
      summary: `Role '${userRole}' cannot invoke '${tool.name}' (requires '${tool.requiredRole}')`,
    };
  }

  // Capability check
  for (const [cap, category] of Object.entries(CAPABILITY_TO_CATEGORY)) {
    if (tool.category !== category) continue;
    if (!enabledCapabilities.includes(cap)) {
      return {
        allowed: false,
        error: "CAPABILITY_DISABLED",
        summary: `Tool '${tool.name}' (category '${category}') requires capability '${cap}' which is not enabled for this company`,
      };
    }
  }

  return { allowed: true };
}
