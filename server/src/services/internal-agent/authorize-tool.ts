// server/src/services/internal-agent/authorize-tool.ts
//
// Role + capability gating for Commander tool invocations.
// See finding C13 in docs/superpowers/specs/2026-05-05-sprint-1-security-fixes-design.md.

import type { AgentTool, ToolCategory } from "./types.js";

export type UserRole = "founder" | "team_lead" | "team_member";

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
 */
export const CAPABILITY_TO_CATEGORY: Record<string, ToolCategory> = {
  discussion_processing: "discussion",
  system_actions: "action",
  memory_management: "memory",
};

export type ToolAuthDecision =
  | { allowed: true }
  | { allowed: false; error: "FORBIDDEN_ROLE" | "CAPABILITY_DISABLED"; summary: string };

export function authorizeToolInvocation(
  tool: AgentTool,
  userRole: UserRole,
  enabledCapabilities: readonly string[],
): ToolAuthDecision {
  // Role check
  if (ROLE_RANK[userRole] < ROLE_RANK[tool.requiredRole]) {
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
