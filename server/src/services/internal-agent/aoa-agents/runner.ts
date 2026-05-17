import { and, eq } from "drizzle-orm";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile, unlink } from "node:fs/promises";
import type { Db } from "@armyofagents/db";
import { agents, internalAgentRuns, discussionEntries } from "@armyofagents/db";
import { getServerAdapter } from "../../../adapters/registry.js";
import { costService } from "../../costs.js";
import { buildMcpConfig } from "../cli-mode.js";
import { resolveAdapterExecutionContext } from "../../heartbeat.js";
import { resolveBridgeEntrypoint } from "./bridge-path.js";
import { logger } from "../../../middleware/logger.js";

export interface AoaTriggerPayload { companyId: string; source: string; entryId?: string; [k: string]: unknown; }

// From Step 1 (authorize-tool.ts + tools/submit-extracted-items.ts): the system
// session identity an AoA sub-agent run uses so the internal-agent bridge
// accepts `submit_extracted_items`. These are NOT placeholders — they are the
// exact values the authorize path requires:
//
//  - submit-extracted-items.ts:66 sets the tool's `requiredRole = "founder"`.
//    authorize-tool.ts ROLE_RANK = { team_member:0, team_lead:1, founder:2 }
//    and the gate is `userRank >= ROLE_RANK[tool.requiredRole]`. requiredRole
//    "founder" => rank 2, so ONLY the literal "founder" satisfies it. Any
//    lower/unknown role fails closed (FORBIDDEN_ROLE).
//  - submit-extracted-items.ts:65 sets the tool's `category = "discussion"`.
//    authorize-tool.ts CAPABILITY_TO_CATEGORY maps `discussion_processing ->
//    "discussion"`, so the session's enabledCapabilities MUST include
//    "discussion_processing" or the call fails (CAPABILITY_DISABLED). No other
//    capability gates this category.
const SUBAGENT_SESSION_USER_ID = "aoa-subagent";
const SUBAGENT_SESSION_USER_ROLE = "founder"; // verified: submit_extracted_items requiredRole === "founder" (rank 2)
const SUBAGENT_ENABLED_CAPABILITIES = ["discussion_processing"]; // verified: gates category "discussion"

export async function runAoaAgent(db: Db, agentId: string, payload: AoaTriggerPayload): Promise<void> {
  const log = logger.child({ svc: "aoa-runner", agentId, companyId: payload.companyId });
  const startedAt = Date.now();
  let runId: string | null = null;
  let cfgPath: string | null = null;
  try {
    const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((r: any[]) => r[0] ?? null);
    if (!agent) { log.warn("aoa agent missing; skip"); return; }

    const inserted = await db.insert(internalAgentRuns).values({
      companyId: payload.companyId, agentId, // Finding R1: per-agent attribution
      triggerType: "sub_agent", triggerSource: payload.source,
      status: "running", relatedEntityType: payload.entryId ? "discussion" : null,
      relatedEntityId: payload.entryId ?? null, userId: null,
    }).returning();
    runId = inserted[0]?.id ?? null;

    // M2/#99 atomic claim: flip pending→processing AND link extraction_run_id
    // in ONE statement. Empty RETURNING ⇒ already claimed ⇒ abort (mirrors
    // extraction.ts:389-402). Without this the dispatcher re-runs the same
    // pending entry every tick.
    if (payload.entryId) {
      const claimed = await db.update(discussionEntries)
        .set({ extractionStatus: "processing", extractionRunId: runId })
        .where(and(
          eq(discussionEntries.id, payload.entryId),
          eq(discussionEntries.extractionStatus, "pending"),
        ))
        .returning();
      if (claimed.length === 0) {
        if (runId) {
          await db.update(internalAgentRuns)
            .set({ status: "failed", errorMessage: "not claimable (concurrent)", completedAt: new Date() })
            .where(eq(internalAgentRuns.id, runId));
        }
        log.info("entry not claimable (already processing/terminal) — skipping");
        return;
      }
    }

    const rc = (agent.runtimeConfig ?? {}) as Record<string, unknown>;
    const aoaCfg = (rc.aoa ?? {}) as Record<string, unknown>;
    const instruction = typeof aoaCfg.instruction === "string" ? aoaCfg.instruction : "";

    // D2: read per-agent toolAllowlist from runtimeConfig.aoa.toolAllowlist.
    // The runner always sets agentKind='aoa' so the bridge activates
    // default-deny. toolAllowlist is pulled from the agent's runtimeConfig
    // so the seed values (ensureExtractionAgent / ensureCommanderAgent) govern
    // what each agent is allowed to call — no separate config required.
    const toolAllowlistFromConfig = Array.isArray(aoaCfg.toolAllowlist)
      ? (aoaCfg.toolAllowlist as string[])
      : [];
    const mcp = buildMcpConfig({
      companyId: payload.companyId,
      userId: SUBAGENT_SESSION_USER_ID,
      userRole: SUBAGENT_SESSION_USER_ROLE,
      enabledCapabilities: SUBAGENT_ENABLED_CAPABILITIES,
      bridgeEntrypoint: resolveBridgeEntrypoint(),
      agentKind: "aoa",
      toolAllowlist: toolAllowlistFromConfig,
    });
    cfgPath = join(tmpdir(), `aoa-mcp-${agentId}-${runId ?? "x"}.json`);
    await writeFile(cfgPath, JSON.stringify(mcp, null, 2));

    const adapter = getServerAdapter(agent.adapterType);
    const baseConfig = { ...(agent.adapterConfig ?? {}) } as Record<string, unknown>;
    const prevArgs = Array.isArray(baseConfig.args) ? (baseConfig.args as string[]) : [];
    const config = { ...baseConfig, args: ["--mcp-config", cfgPath, ...prevArgs] };
    const { executionTarget, runtimeCommandSpec } = resolveAdapterExecutionContext(config, adapter);

    await adapter.execute({
      runId: runId ?? `aoa-${agentId}`,
      agent,
      runtime: agent.runtimeConfig ?? {},
      config,
      context: { aoaInstruction: instruction, payload },
      executionTarget, runtimeCommandSpec,
      onLog: async () => {}, onMeta: async () => {},
      authToken: undefined, onSpawn: () => {},
    });

    if (runId) {
      await db.update(internalAgentRuns)
        .set({ status: "completed", durationMs: Date.now() - startedAt, completedAt: new Date() })
        .where(eq(internalAgentRuns.id, runId));
    }
    await costService(db).createEvent(payload.companyId, {
      agentId, provider: "anthropic",
      model: process.env.EXTRACTION_MODEL || "claude-sonnet-4-20250514",
      inputTokens: 0, outputTokens: 0, costCents: 0, occurredAt: new Date(),
    });
  } catch (err) {
    log.error({ err }, "aoa run failed (isolated)");
    if (runId) {
      try {
        await db.update(internalAgentRuns)
          .set({ status: "failed", errorMessage: String((err as Error)?.message ?? err), durationMs: Date.now() - startedAt, completedAt: new Date() })
          .where(eq(internalAgentRuns.id, runId));
      } catch { /* swallow */ }
    }
  } finally {
    if (cfgPath) {
      try {
        await unlink(cfgPath).catch(() => {
          /* best-effort cleanup; never break the run or its hard-error boundary */
        });
      } catch {
        /* unlink itself unavailable/threw synchronously — still must not escape */
      }
    }
  }
}
