// server/src/mcp/broker-tool-context.ts
//
// U2b (Cloud Execution Isolation / E2B, Wave 1) — server-side resolver that
// builds the internal-agent `ToolContext` for a sandboxed agent run FROM the
// run-JWT identity + the control-plane `db`.
//
// Why this exists: an E2B-sandboxed crew/org run executes inside a VM that
// must never hold direct DB credentials. The VM instead talks to a broker
// running on the control plane over the network (wired in U2c); the broker
// verifies the run-JWT minted for that run (U3, `agent-auth-jwt.ts` —
// `sub`=agentId, `company_id`=companyId, `run_id`=runId) and calls this
// resolver to build the SAME `ToolContext` shape the in-process crew runner
// (`aoa-agents/runner.ts`) already builds for a local (non-sandboxed) run.
//
// Security property: the ONLY inputs are the run-JWT's verified identity
// (agentId/companyId/runId) and the control-plane `db` — never a
// client-supplied companyId. `agentId`/`companyId` are compared against the
// `agents` row to assert the run cannot widen its own tenant.
import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, internalAgentConfig } from "@armyofagents/db";
import { forbidden } from "../errors.js";
import type { ToolContext } from "../services/internal-agent/types.js";
import { createServiceContainer } from "../services/internal-agent/service-container.js";
import { createToolRegistry } from "../services/internal-agent/tool-registry.js";
import { deriveEnabledCapabilities } from "../services/internal-agent/aoa-agents/derive-capabilities.js";

// Mirrors the crew subagent session identity contract in
// `aoa-agents/runner.ts` (SUBAGENT_SESSION_USER_ID / SUBAGENT_SESSION_USER_ROLE
// — verified there against `submit_extracted_items`' requiredRole==="founder",
// authorize-tool.ts ROLE_RANK). A broker-resolved ToolContext represents the
// SAME class of caller (a crew/org agent run, never a human board session), so
// it reuses the identical placeholder session identity rather than inventing
// a second one. Not exported from runner.ts, so re-declared here verbatim.
const BROKER_SESSION_USER_ID = "aoa-subagent";
const BROKER_SESSION_USER_ROLE = "founder";

// Built once at module load — the SAME call `aoa-agents/runner.ts` makes
// (`TOOL_REGISTRY_FOR_CAPABILITY_DERIVATION = createToolRegistry()`).
// `createToolRegistry()` returns `AgentTool[]` with static name+category; the
// heavy per-tool `execute` callbacks are not invoked by capability derivation,
// so this is cheap to build once and reuse across every resolver call.
const TOOL_REGISTRY_FOR_CAPABILITY_DERIVATION = createToolRegistry();

export interface ResolveBrokerToolContextInput {
  db: Db;
  companyId: string;
  agentId: string;
  runId: string;
}

/**
 * Build the internal-agent `ToolContext` for a sandboxed (E2B) agent run.
 *
 * - Loads the `agents` row for `agentId` and asserts `agent.companyId ===
 *   companyId`. A missing agent and a cross-tenant agent are treated
 *   identically (fail closed, 403) so the error never leaks whether the
 *   agent exists under a different company — mirrors the
 *   `CROSS_COMPANY_FORBIDDEN` convention in `tools/agent-dispatch.ts` and the
 *   cross-tenant backstop already in `aoa-agents/runner.ts` (`agent.companyId
 *   !== payload.companyId`).
 * - `effectiveAutonomy` reads `internal_agent_config.crewAutonomyLevel` — the
 *   D18-split AGENT-WORK dial. Deliberately NEVER `autonomyLevel` (the
 *   Commander-only dial; see CLAUDE.md D18 note and the column comments in
 *   `packages/db/src/schema/internal_agent.ts`). Falls back to `0` (Manual)
 *   when the company has no config row yet, matching the same `?? 0`
 *   fallback used by `dispatcher.ts` / `controller-adjutant-runner.ts`.
 * - `toolAllowlist` + `enabledCapabilities` reuse the EXACT derivation
 *   `runAoaAgent` (`aoa-agents/runner.ts`) feeds into `buildMcpBridgeSpec`:
 *   `toolAllowlist` comes straight off `agent.runtimeConfig.aoa.toolAllowlist`
 *   (the per-agent allowlist seeded by the `ensure-*` crew-role files), and
 *   `deriveEnabledCapabilities` (`aoa-agents/derive-capabilities.ts`) turns
 *   that allowlist into the coarse capability set against the SAME tool
 *   registry the crew path uses. `resolveCrewRole` (`resolve-crew-role.ts`)
 *   is a DIFFERENT helper — it resolves a trigger's `config.role` for the
 *   autonomy min-role gate (`autonomy.ts` ROLE_MIN_AUTONOMY) and plays no
 *   part in allowlist/capability derivation, so it is not used here.
 * - Sets `actorType:"agent"` (never `"commander"`) and leaves
 *   `commanderToolPermissions` / `runtimeApprovalsEnabled` unset —
 *   `mcp-bridge.ts` gates those fields exclusively on
 *   `actorType==="commander"`, and a broker-resolved context always
 *   represents a crew/org agent run.
 */
export async function resolveBrokerToolContext(
  input: ResolveBrokerToolContextInput,
): Promise<ToolContext> {
  const { db, companyId, agentId, runId } = input;

  const [agentRow] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agentRow || agentRow.companyId !== companyId) {
    throw forbidden("Broker run identity does not match the requesting company");
  }

  const [configRow] = await db
    .select({ crewAutonomyLevel: internalAgentConfig.crewAutonomyLevel })
    .from(internalAgentConfig)
    .where(eq(internalAgentConfig.companyId, companyId))
    .limit(1);
  const effectiveAutonomy = configRow?.crewAutonomyLevel ?? 0;

  const runtimeConfig = (agentRow.runtimeConfig ?? {}) as Record<string, unknown>;
  const aoaConfig = (runtimeConfig.aoa ?? {}) as Record<string, unknown>;
  const toolAllowlist = Array.isArray(aoaConfig.toolAllowlist)
    ? (aoaConfig.toolAllowlist as string[])
    : [];
  const enabledCapabilities = deriveEnabledCapabilities(
    toolAllowlist,
    TOOL_REGISTRY_FOR_CAPABILITY_DERIVATION,
  );

  return {
    companyId,
    userId: BROKER_SESSION_USER_ID,
    userRole: BROKER_SESSION_USER_ROLE,
    enabledCapabilities,
    agentKind: agentRow.kind,
    toolAllowlist,
    actorType: "agent",
    agentId,
    effectiveAutonomy,
    runId,
    db,
    services: createServiceContainer(db),
  };
}
