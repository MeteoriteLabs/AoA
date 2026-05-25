import { and, eq, sql } from "drizzle-orm";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile, unlink } from "node:fs/promises";
import type { Db } from "@armyofagents/db";
import { agents, internalAgentRuns, discussionEntries } from "@armyofagents/db";
import { getServerAdapter } from "../../../adapters/registry.js";
import { costService } from "../../costs.js";
import { buildMcpConfig, buildMcpBridgeSpec } from "../cli-mode.js";
import { resolveAdapterExecutionContext } from "../../heartbeat.js";
import { resolveBridgeEntrypoint } from "./bridge-path.js";
import { publishLiveEvent } from "../../live-events.js";
import { logger } from "../../../middleware/logger.js";
import { computeCostCents } from "../cost-model.js";

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
  // FX1/B1: id of the discussion entry this run atomically CLAIMED
  // (pending→processing). Stays null on the not-claimable early-return so the
  // catch terminalizer never touches an entry this run does not own.
  let claimedEntryId: string | null = null;
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
      // Claim succeeded — this run now OWNS the entry. Record it so a later
      // failure can terminalize it (FX1/B1).
      claimedEntryId = payload.entryId;
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
    // MX2: the bridge params are identical for both the claude {mcpServers}
    // envelope and the provider-neutral spec — build them once.
    const mcpParams = {
      companyId: payload.companyId,
      userId: SUBAGENT_SESSION_USER_ID,
      userRole: SUBAGENT_SESSION_USER_ROLE,
      enabledCapabilities: SUBAGENT_ENABLED_CAPABILITIES,
      bridgeEntrypoint: resolveBridgeEntrypoint(),
      agentKind: "aoa",
      toolAllowlist: toolAllowlistFromConfig,
    };
    // MX2: the claude {mcpServers} JSON temp file is still written
    // UNCONDITIONALLY (and unlinked in `finally` for every run) so the
    // tmp-file cleanup contract is adapter-agnostic. For non-claude adapters
    // the file is simply never referenced (harmless, unused) — only
    // claude-family gets `--mcp-config <file>` injected into config.args.
    // The write happens BEFORE buildMcpBridgeSpec so `cfgPath` is always set
    // by the time any later step can fail — the `finally` unlink invariant
    // ("if we created the temp file we always remove it") holds regardless of
    // where a downstream error occurs.
    const mcp = buildMcpConfig(mcpParams);
    cfgPath = join(tmpdir(), `aoa-mcp-${agentId}-${runId ?? "x"}.json`);
    await writeFile(cfgPath, JSON.stringify(mcp, null, 2));
    // MX2: provider-neutral bridge spec handed to EVERY adapter via
    // ctx.mcpBridge. Non-claude adapters (codex/opencode/...) consume this in
    // a later milestone (MX3); claude keeps its own --mcp-config delivery
    // below. Building it unconditionally is cheap and keeps the contract
    // uniform across adapters.
    const bridgeSpec = buildMcpBridgeSpec(mcpParams);

    const adapter = getServerAdapter(agent.adapterType);
    const baseConfig = { ...(agent.adapterConfig ?? {}) } as Record<string, unknown>;
    const prevArgs = Array.isArray(baseConfig.args) ? (baseConfig.args as string[]) : [];
    // MX2: only claude-family CLIs understand `--mcp-config <file>`. Injecting
    // it for codex/opencode/etc. leaked an invalid flag into their argv (the
    // reason codex AoA agents got zero MCP tools). claude_local is the ONLY
    // claude CLI adapter (registry.ts) — do not broaden. claude-family path is
    // kept BYTE-IDENTICAL to pre-MX2: ["--mcp-config", cfgPath, ...prevArgs].
    const isClaudeFamily = agent.adapterType === "claude_local";
    const config = isClaudeFamily
      ? { ...baseConfig, args: ["--mcp-config", cfgPath, ...prevArgs] }
      : { ...baseConfig };
    const { executionTarget, runtimeCommandSpec } = resolveAdapterExecutionContext(config, adapter);

    await adapter.execute({
      runId: runId ?? `aoa-${agentId}`,
      agent,
      runtime: agent.runtimeConfig ?? {},
      config,
      context: { aoaInstruction: instruction, payload },
      executionTarget, runtimeCommandSpec,
      mcpBridge: bridgeSpec,
      onLog: async () => {}, onMeta: async () => {},
      authToken: undefined, onSpawn: () => {},
    });

    // Silent-failure guard: a CLI agent can finish its run WITHOUT calling
    // submit_extracted_items (codex/opencode have no MCP-bridge wiring yet — see
    // buildMcpConfig/--mcp-config above, claude-only; the claude CLI submit
    // handshake can also hang). The adapter then returns "successfully" but the
    // claimed entry is never terminalized → stuck 'processing' forever (silent
    // loss). If we claimed an entry and it is STILL 'processing' after execute
    // returned, the agent did not submit — throw so the catch terminalizer below
    // marks both the entry and the run 'failed' with a clear error instead of
    // leaving it silently stuck.
    if (claimedEntryId) {
      const stillProcessing = await db
        .select({ status: discussionEntries.extractionStatus })
        .from(discussionEntries)
        .where(eq(discussionEntries.id, claimedEntryId))
        .then((r: Array<{ status: string }>) => r[0]?.status === "processing");
      if (stillProcessing) {
        throw new Error(
          "extraction agent run completed without submitting results",
        );
      }
    }

    if (runId) {
      await db.update(internalAgentRuns)
        .set({ status: "completed", durationMs: Date.now() - startedAt, completedAt: new Date() })
        .where(eq(internalAgentRuns.id, runId));
    }
    // Plan 3 Task 6: real cost accounting. CLI subscription runs report 0
    // tokens (no per-token billing); SDK-mode runs will populate usage once
    // providers/index.ts is extended (DONE_WITH_CONCERNS: providers/index.ts
    // does not currently return token usage from SDK calls — it returns the
    // provider instance, not a response object. Cost accounting for SDK-mode
    // crew runs is deferred pending provider response shape extension.)
    await costService(db).createEvent(payload.companyId, {
      agentId, provider: "anthropic",
      model: process.env.EXTRACTION_MODEL || "claude-sonnet-4-20250514",
      inputTokens: 0, outputTokens: 0,
      // CLI subscription: no per-token billing → always $0. If/when the
      // adapter begins returning token usage, replace with:
      //   computeCostCents(provider, model, usage.inputTokens, usage.outputTokens)
      costCents: computeCostCents("anthropic", process.env.EXTRACTION_MODEL || "claude-sonnet-4-20250514", 0, 0),
      occurredAt: new Date(),
    });
  } catch (err) {
    log.error({ err }, "aoa run failed (isolated)");
    const errMessage = err instanceof Error ? err.message : String(err);
    if (runId) {
      try {
        await db.update(internalAgentRuns)
          .set({ status: "failed", errorMessage: String((err as Error)?.message ?? err), durationMs: Date.now() - startedAt, completedAt: new Date() })
          .where(eq(internalAgentRuns.id, runId));
      } catch { /* swallow */ }
    }
    // FX1/B1: a failed extraction RUN must terminalize the entry it claimed —
    // otherwise the entry is stuck 'processing' forever (silent permanent
    // loss). Mirrors extraction.ts:639-659's failure branch VERBATIM (status
    // 'failed' + sourceInfo.extractionError + the discussion.extraction.failed
    // LiveEvent; NO notification — extraction.ts writes none). Guarded on
    // extractionStatus='processing' AND extractionRunId=runId: extraction.ts
    // guards by id only because it owns the lifecycle linearly; the runner is
    // concurrent, so it must not clobber an entry a *different* run owns or
    // one already terminalized. Entirely best-effort — the catch must never
    // throw (consistent with the file's existing swallow style). `runId` is
    // necessarily a non-null string whenever claimedEntryId is set (the atomic
    // claim that set it also linked extractionRunId=runId); the `&& runId`
    // guard makes that invariant explicit (and narrows the type for eq()).
    if (claimedEntryId && runId) {
      const claimedRunId = runId;
      try {
        let discussionId: string | null = null;
        try {
          const drow = await db
            .select({ discussionId: discussionEntries.discussionId })
            .from(discussionEntries)
            .where(eq(discussionEntries.id, claimedEntryId));
          discussionId = drow[0]?.discussionId ?? null;
        } catch { /* swallow — terminalize on best-effort below */ }

        await db
          .update(discussionEntries)
          .set({
            extractionStatus: "failed",
            sourceInfo: sql`jsonb_set(COALESCE(${discussionEntries.sourceInfo}, '{}'::jsonb), '{extractionError}', ${JSON.stringify(errMessage)}::jsonb)`,
          })
          .where(
            and(
              eq(discussionEntries.id, claimedEntryId),
              eq(discussionEntries.extractionStatus, "processing"),
              eq(discussionEntries.extractionRunId, claimedRunId),
            ),
          )
          .catch((updateErr: unknown) => {
            log.error({ err: updateErr }, "Failed to update entry status after extraction failure");
          });

        if (discussionId) {
          publishLiveEvent({
            companyId: payload.companyId,
            type: "discussion.extraction.failed",
            payload: { discussionId, entryId: claimedEntryId, error: errMessage },
          });
        }
      } catch { /* terminalizer is best-effort; never escape the run boundary */ }
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
