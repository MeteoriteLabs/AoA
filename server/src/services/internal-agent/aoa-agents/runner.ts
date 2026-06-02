import { and, eq, sql } from "drizzle-orm";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile, unlink } from "node:fs/promises";
import type { Db } from "@armyofagents/db";
import { agents, internalAgentRuns, discussionEntries, issues } from "@armyofagents/db";
import { getServerAdapter } from "../../../adapters/registry.js";
import { costService } from "../../costs.js";
import { buildMcpConfig, buildMcpBridgeSpec } from "../cli-mode.js";
import { resolveAdapterExecutionContext } from "../../heartbeat.js";
import { resolveBridgeEntrypoint } from "./bridge-path.js";
import { publishLiveEvent, publishIssueStatusChanged, threadWorkingAgents, broadcastThreadPresence } from "../../live-events.js";
import { logger } from "../../../middleware/logger.js";
import { computeCostCents } from "../cost-model.js";
import { assembleAgentPersona } from "../commander-context.js";
import { agentInstructionsService } from "../../agent-instructions.js";
import type { AoaRunResult } from "./aoa-run-result.js";
import { buildAoaRunResultFromAdapter } from "./aoa-run-result.js";
import { buildTriggerPrompt } from "./aoa-trigger-prompt.js";
import { deriveEnabledCapabilities } from "./derive-capabilities.js";
import { createToolRegistry } from "../tool-registry.js";
import { redactAndCapPrompt } from "../../prompt-snapshot.js";

export interface AoaTriggerPayload { companyId: string; source: string; entryId?: string; issueId?: string; [k: string]: unknown; }

/**
 * Phase 5 (Task 5.2): humanized "what is this agent doing" string for the thread
 * presence pill, derived from the crew role key. v1 is a static map — richer
 * per-tool activity ("reading the spec", "running tests") is a deferred
 * follow-up. The chat renders "<Agent> is <activity>…", so each phrase is a bare
 * present-participle clause. Unknown roles fall back to "typing" (the generic
 * group-chat affordance).
 */
export function humanizedActivityForRole(roleKey: string): string {
  switch (roleKey) {
    case "scout":
      return "researching";
    case "planner":
      return "writing the plan";
    case "engineer":
      return "creating an artifact";
    case "adjutant":
      return "reviewing the thread";
    default:
      return "typing";
  }
}

type RunnerAgentShape = { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null };

/**
 * P1 (ii): resolve the instruction text a crew run uses. Prefer the assembled
 * 4-file bundle (founder edits take effect live); fall back to the legacy
 * runtimeConfig.aoa.instruction string. Never throws — assembly failure falls back.
 */
export async function resolveAoaInstruction(args: {
  agent: RunnerAgentShape;
  fallbackInstruction: string;
  assemble?: (a: { agent: RunnerAgentShape; service: ReturnType<typeof agentInstructionsService> }) => Promise<string | null>;
}): Promise<string> {
  const assemble = args.assemble ?? assembleAgentPersona;
  try {
    const persona = await assemble({ agent: args.agent, service: agentInstructionsService() });
    if (persona && persona.trim().length > 0) return persona;
  } catch {
    /* fall through to the legacy string */
  }
  return args.fallbackInstruction;
}

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

// T1.3 (eng-review D4) — Per-agent capability derivation REPLACES this constant
// in the mcpParams construction below. Kept exported (legacy const) for any
// external callers that may still reference it, but the runner itself now
// computes capabilities from the agent's toolAllowlist via
// `deriveEnabledCapabilities`. Before T1.3: every crew agent was capped at
// "discussion_processing", causing CAPABILITY_DISABLED on create_artifact
// (Maker), advance_phase (Adjutant), create_task (Dispatcher),
// suggest_memory (Memory Keeper). See derive-capabilities.ts header for
// the full rationale.
/** @deprecated v1.0 — use `deriveEnabledCapabilities(toolAllowlist, registry)` instead. */
const SUBAGENT_ENABLED_CAPABILITIES = ["discussion_processing"]; // verified: gates category "discussion"
// Suppress "declared but never used" — the constant is intentionally kept for
// back-compat / documentation of the prior behavior; downstream may import it.
void SUBAGENT_ENABLED_CAPABILITIES;

// T1.3: build the registry ONCE at module load. createToolRegistry()
// returns AgentTool[] with static name+category — the heavy callbacks
// (execute, services) are not invoked here. Subsequent runner calls reuse
// this. Keeps the per-wakeup cost down to a few Map lookups.
const TOOL_REGISTRY_FOR_CAPABILITY_DERIVATION = createToolRegistry();

export async function runAoaAgent(db: Db, agentId: string, payload: AoaTriggerPayload): Promise<AoaRunResult> {
  const log = logger.child({ svc: "aoa-runner", agentId, companyId: payload.companyId });
  const startedAt = Date.now();
  let runId: string | null = null;
  let cfgPath: string | null = null;
  // Audit #27: prompt snapshot built after triggerPrompt is assembled; persisted
  // by folding into whichever run-row write fires next (completion or failure).
  // Declared at function scope so both the try body and catch block can access it.
  let promptSnapshot: string | null = null;
  // FX1/B1: id of the discussion entry this run atomically CLAIMED
  // (pending→processing). Stays null on the not-claimable early-return so the
  // catch terminalizer never touches an entry this run does not own.
  let claimedEntryId: string | null = null;
  // Phase 5 (Tasks 5.1/5.2): thread this run is "working" on (a thread/mention
  // run carries payload.threadId). Set when we add the agent to the thread
  // working-agents presence store BEFORE adapter.execute; the `finally`
  // GUARANTEES removal (even on throw) by reading these. Null for a task-only /
  // entry-only run (no thread to light a chat pill for). Mirrors the heartbeat
  // presence pattern (heartbeat.ts:2608-2616 add / :4117-4124 remove).
  let presenceThreadId: string | null = null;
  let presenceAgentName: string | null = null;
  try {
    const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((r: any[]) => r[0] ?? null);
    if (!agent) {
      log.warn("aoa agent missing; skip");
      // T1.0: even no-op early returns expose a status to the dispatcher
      // so the wakeup row reflects what happened. "agent gone" is a failed
      // run from the wakeup's perspective (something asked for an agent
      // that doesn't exist anymore — orphan wakeup).
      return { status: "failed", errorMessage: "aoa agent missing" };
    }

    const inserted = await db.insert(internalAgentRuns).values({
      companyId: payload.companyId, agentId, // Finding R1: per-agent attribution
      triggerType: "sub_agent", triggerSource: payload.source,
      // Spec B Task 5: a task wakeup stamps relatedEntityType="task" (the runs
      // column vocabulary is 'discussion'|'task'|'agent'|'goal'|'memory' — NOT
      // "issue"). issueId takes precedence over entryId (a task wakeup never
      // also carries an entry to claim).
      status: "running", relatedEntityType: payload.issueId ? "task" : payload.entryId ? "discussion" : null,
      relatedEntityId: payload.issueId ?? payload.entryId ?? null, userId: null,
    }).returning();
    runId = inserted[0]?.id ?? null;

    // M2/#99 atomic claim: flip pending→processing AND link extraction_run_id
    // in ONE statement. Empty RETURNING ⇒ already claimed ⇒ abort (mirrors
    // extraction.ts:389-402). Without this the dispatcher re-runs the same
    // pending entry every tick.
    //
    // P1-C fix: gate this claim on `payload.source === 'outbox'` so it only
    // fires for the extraction trigger (Scribe). Without the gate, mention-
    // and phase-advance-driven agents (Maker, Router, etc.) would attempt to
    // claim the entry's extraction lock, fail (because the entry is in
    // terminal state — completed/failed — for any extraction the Scribe
    // already finished), and abort before running any actual agent logic.
    // For non-outbox sources the entry is *context*, not work to claim.
    if (payload.entryId && payload.source === "outbox") {
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
        // T1.0: concurrent claim race is not a true failure (another run
        // owns this entry, will handle it). Return succeeded so the
        // dispatcher doesn't count it toward the failure-storm brake (T1.9).
        // The internal_agent_runs row is still marked failed above so the
        // operator sees the skip for this specific run attempt.
        return { status: "succeeded" };
      }
      // Claim succeeded — this run now OWNS the entry. Record it so a later
      // failure can terminalize it (FX1/B1).
      claimedEntryId = payload.entryId;
    }

    // Spec B Task 5 — TASK CHECKOUT CLAIM. A task wakeup must atomically CLAIM
    // the issue before the adapter runs: issueService.checkout flips
    // todo/backlog/in_progress → in_progress and sets executionRunId=runId
    // (single-agent lock; assertAssignableAgent enforces company scope). A
    // contended checkout THROWS conflict("Issue checkout conflict"). That is a
    // BENIGN concurrency skip (another run already owns the task), not a true
    // failure — so we mark the run ROW 'failed' (the runs enum has no
    // 'succeeded') with a clear errorMessage, then return the AoaRunResult
    // 'succeeded' so the dispatcher's failure-storm brake does not count it.
    // Mirrors the entry-claim race precedent above (the not-claimable branch).
    if (payload.issueId && runId) {
      const { issueService } = await import("../../issues.js");
      try {
        await issueService(db).checkout(payload.issueId, agentId, ["todo", "backlog", "in_progress"], runId);
      } catch (err) {
        log.info({ issueId: payload.issueId, err: (err as Error)?.message }, "task checkout conflict — another run owns it; skipping");
        await db.update(internalAgentRuns)
          .set({ status: "failed", errorMessage: "task checkout conflict (concurrent)", completedAt: new Date(), durationMs: Date.now() - startedAt })
          .where(eq(internalAgentRuns.id, runId));
        return { status: "succeeded" }; // benign concurrency skip — mirror entry-claim race
      }
    }

    const rc = (agent.runtimeConfig ?? {}) as Record<string, unknown>;
    const aoaCfg = (rc.aoa ?? {}) as Record<string, unknown>;
    const fallbackInstruction = typeof aoaCfg.instruction === "string" ? aoaCfg.instruction : "";
    const instruction = await resolveAoaInstruction({
      agent: {
        id: agent.id,
        companyId: agent.companyId,
        name: agent.name,
        adapterConfig: (agent.adapterConfig ?? null) as Record<string, unknown> | null,
      },
      fallbackInstruction,
    });

    // D2: read per-agent toolAllowlist from runtimeConfig.aoa.toolAllowlist.
    // The runner always sets agentKind='aoa' so the bridge activates
    // default-deny. toolAllowlist is pulled from the agent's runtimeConfig
    // so the seed values (ensureExtractionAgent / ensureCommanderAgent) govern
    // what each agent is allowed to call — no separate config required.
    const toolAllowlistFromConfig = Array.isArray(aoaCfg.toolAllowlist)
      ? (aoaCfg.toolAllowlist as string[])
      : [];

    // T1.3 (eng-review D4): derive enabledCapabilities PER-AGENT from the
    // agent's toolAllowlist. Pre-T1.3 every crew run got the blanket
    // ["discussion_processing"] constant — that failed-closed on
    // create_artifact (Maker), advance_phase (Adjutant), create_task
    // (Dispatcher), and suggest_memory (Memory Keeper) because those tools
    // require categories the constant didn't grant. Per-agent derivation
    // keeps the COARSE capability gate as a real second line of defense:
    // if Router's allowlist is ever broadened in a future regression, it
    // STILL won't have system_actions — its derived capability set is
    // ["discussion_processing"] only. Pure function — exhaustively unit-
    // tested in derive-capabilities.test.ts.
    const enabledCapabilities = deriveEnabledCapabilities(
      toolAllowlistFromConfig,
      TOOL_REGISTRY_FOR_CAPABILITY_DERIVATION,
    );

    // MX2: the bridge params are identical for both the claude {mcpServers}
    // envelope and the provider-neutral spec — build them once.
    const mcpParams = {
      companyId: payload.companyId,
      userId: SUBAGENT_SESSION_USER_ID,
      userRole: SUBAGENT_SESSION_USER_ROLE,
      // T1.3: per-agent capability set (was: SUBAGENT_ENABLED_CAPABILITIES).
      enabledCapabilities,
      bridgeEntrypoint: resolveBridgeEntrypoint(),
      agentKind: "aoa",
      toolAllowlist: toolAllowlistFromConfig,
      agentId,
      effectiveAutonomy: typeof payload.effectiveAutonomy === "number"
        ? payload.effectiveAutonomy
        : null,
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

    // T1.2 (codex F1): build a concrete role-aware trigger prompt so the LLM
    // has something to act on. Before this, every crew run got the adapter's
    // default 14-word placeholder ("You are agent <uuid> (<Name>). Continue
    // your AoA work.") with NO mention of the trigger, thread, inviting
    // entry, or what tool to call. Result: claude/codex ran 30s, read the
    // bundle, exited without calling any MCP tool. T1.2 puts the trigger
    // context + role action directive in the user prompt itself.
    //
    // Role lookup keys off runtimeConfig.aoa.role (the seed key like 'scribe'
    // / 'maker' / 'adjutant') NOT agent.name (codex F7 — marketplace install
    // can rename on conflict). Falls back to a slugified agent.name when the
    // role key is absent (unknown name → generic directive in the prompt).
    // aoaCfg is already defined above (line ~132) as `(rc.aoa ?? {}) as Record<string, unknown>`.
    const agentRoleKey =
      typeof aoaCfg.role === "string" && aoaCfg.role.length > 0
        ? aoaCfg.role
        : agent.name.toLowerCase().replace(/\s+/g, "_");

    // Phase 4 (Task 4.3): build the crew context bundle so the agent does NOT
    // start blind. Before this, a thread/mention run's dynamic prompt block was
    // IDs only (Thread/Inviting entry/Mention) → an @mentioned agent had to
    // fetch everything via tools and often answered "no precedent found". The
    // bundle injects the conversation + the Chronicler summary + relevant
    // memory (and, for tasks, the task body + upstream artifact) directly.
    //
    // Gated on threadId|issueId: an entry-only extraction run (Scribe/outbox)
    // has no thread or task to summarize, so there's nothing to inject and we
    // skip the work entirely. BEST-EFFORT: wrapped in try/catch exactly like
    // the redactAndCapPrompt snapshot below — a bundle failure (e.g. memory/
    // pgvector hiccup) must NEVER break a run. Empty bundle ⇒ no `## Context`
    // section (the prompt stays byte-identical to the pre-Phase-4 form).
    let contextBundle = "";
    const bundleThreadId = typeof payload.threadId === "string" ? payload.threadId : undefined;
    const bundleIssueId = typeof payload.issueId === "string" ? payload.issueId : undefined;
    if (bundleThreadId || bundleIssueId) {
      try {
        const { buildCrewContextBundle } = await import("./crew-context-bundle.js");
        contextBundle = await buildCrewContextBundle(db, {
          companyId: payload.companyId,
          threadId: bundleThreadId,
          issueId: bundleIssueId,
          agentId,
        });
      } catch (bundleErr) {
        log.warn({ err: bundleErr }, "aoa-runner: failed to build crew context bundle (best-effort, ignored)");
      }
    }

    const triggerPrompt = buildTriggerPrompt({
      instruction,
      payload,
      agentName: agent.name,
      agentRoleKey,
      contextBundle,
    });

    // MX2: only claude-family CLIs understand `--mcp-config <file>`. Injecting
    // it for codex/opencode/etc. leaked an invalid flag into their argv (the
    // reason codex AoA agents got zero MCP tools). claude_local is the ONLY
    // claude CLI adapter (registry.ts) — do not broaden. claude-family path is
    // kept BYTE-IDENTICAL to pre-MX2: ["--mcp-config", cfgPath, ...prevArgs].
    //
    // T1.2: every adapter (claude/codex/opencode/gemini) honors
    // `config.promptTemplate` via their `renderTemplate(promptTemplate, ...)`
    // call site, so passing the built trigger prompt as promptTemplate flows
    // through uniformly. The prompt has no {{...}} tokens — renderTemplate
    // returns it verbatim.
    const isClaudeFamily = agent.adapterType === "claude_local";
    const config = isClaudeFamily
      ? { ...baseConfig, promptTemplate: triggerPrompt, args: ["--mcp-config", cfgPath, ...prevArgs] }
      : { ...baseConfig, promptTemplate: triggerPrompt };
    const { executionTarget, runtimeCommandSpec } = resolveAdapterExecutionContext(config, adapter);

    // Audit follow-up #27: capture the redacted+capped prompt snapshot now so
    // it is available to fold into the next existing run-row write (either the
    // completion update below or the catch-block failure update). Building it
    // here (pure string op) keeps the snapshot close to where triggerPrompt is
    // assembled. The actual DB write is folded into the existing .set({...})
    // calls — no separate round-trip, no extra db._sets entry in tests.
    // Best-effort: redactAndCapPrompt is a pure fn that won't throw, but guard
    // defensively so a future change there can never break the run.
    // NOTE: `promptSnapshot` is declared at function scope (above the try block)
    // so the catch block can also fold it into the failure update.
    try {
      promptSnapshot = redactAndCapPrompt(triggerPrompt);
    } catch (snapErr) {
      log.warn({ err: snapErr }, "aoa-runner: failed to build prompt snapshot (best-effort, ignored)");
    }

    // Phase 5 (Tasks 5.1/5.2): a thread/mention run lights the thread presence
    // pill — "<Agent> is <activity>…" — for the duration of the run. Gated on
    // payload.threadId (only conversational runs have a chat to show presence
    // in; a task-only/entry-only run skips this entirely). The humanized
    // activity is derived from the crew role key. Added BEFORE execute and
    // REMOVED in the `finally` (guaranteed even on throw). Best-effort — a
    // presence failure must never break the run (mirrors heartbeat.ts:2610-2615).
    //
    // Source gate: ONLY light presence for CONVERSATIONAL runs. A background
    // sweep (`sweep.*` — e.g. `sweep.chronicler`, `sweep.adjutant`) carries a
    // threadId but does NOT post to the thread (the Chronicler's summary sweep
    // never posts), so a typing-presence pill for it is phantom ("Chronicler is
    // typing…" with nothing ever arriving). Skip the add for sweeps; keep it for
    // `thread.controller` / `thread.participation` / `mention` / `agent.dispatch`.
    // presenceThreadId is set ONLY when we add, so the `finally` removal below
    // stays symmetric automatically — it never clears a presence we didn't set.
    const isBackgroundSweep = String(payload.source).startsWith("sweep.");
    if (bundleThreadId && !isBackgroundSweep) {
      presenceThreadId = bundleThreadId;
      presenceAgentName = agent.name;
      try {
        const activity = humanizedActivityForRole(agentRoleKey);
        threadWorkingAgents.add(bundleThreadId, agentId, agent.name, activity);
        broadcastThreadPresence(payload.companyId, bundleThreadId, Date.now());
      } catch (presenceErr) {
        log.warn({ err: presenceErr, threadId: bundleThreadId }, "aoa-runner: failed to set working presence (best-effort, ignored)");
      }
    }

    // T1.0: capture the adapter result so we can build AoaRunResult.
    // Adapters populate `usage`, `costUsd`, `exitCode`, `errorMessage` on
    // their AdapterExecutionResult — that data was previously discarded.
    const adapterResult = await adapter.execute({
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

    // Spec B Task 5 — TASK SILENT-STUCK GUARD. Symmetric to the entry guard
    // above. A non-claude adapter (no MCP bridge) or a hung claude run can exit
    // "successfully" WITHOUT ever calling set_task_status — leaving the task we
    // checked out stuck 'in_progress' forever (silent stall). If the task is
    // still 'in_progress' AND still locked by THIS run (executionRunId===runId),
    // the agent did not move it: RELEASE it back to 'todo' (clear the execution
    // lock so the founder/heartbeat can re-dispatch it) and THROW so the run is
    // marked failed loudly via the catch below. The release is guarded on
    // executionRunId=runId so a concurrent run that legitimately re-claimed the
    // task is never clobbered.
    if (payload.issueId && runId) {
      const { issueService } = await import("../../issues.js");
      const task = await issueService(db).getById(payload.issueId);
      if (task && task.status === "in_progress" && (task as { executionRunId?: string | null }).executionRunId === runId) {
        log.warn({ issueId: payload.issueId }, "crew task run finished without set_task_status — releasing task to todo");
        await db.update(issues)
          .set({ status: "todo", executionRunId: null, checkoutRunId: null, updatedAt: new Date() })
          .where(and(eq(issues.id, payload.issueId), eq(issues.executionRunId, runId)));
        // Task 5.6: the silent-stuck release is a CREW status-MOVE
        // (in_progress → todo) that bypasses issueService.update. Publish
        // issue.status_changed (company-broadcast, R3) so the board reflects
        // the card dropping back to todo live. Best-effort — must not mask the
        // loud throw below (which terminalizes the run).
        try {
          publishIssueStatusChanged(payload.companyId, payload.issueId, "todo");
        } catch (publishErr) {
          log.warn({ err: publishErr, issueId: payload.issueId }, "issue.status_changed publish failed on silent-stuck release (best-effort, ignored)");
        }
        throw new Error("crew task run completed without moving the task (no set_task_status call)");
      }
    }

    // T1.0 + T1.1: determine status from the adapter's actual outcome.
    // buildAoaRunResultFromAdapter is the pure function that owns this logic
    // — exhaustively unit-tested in aoa-run-result.test.ts so we don't
    // duplicate the success/failure decision here AND in the catch path.
    const runResult = buildAoaRunResultFromAdapter(adapterResult);
    const adapterUsage = runResult.usage;
    const costCents = runResult.costCents;

    if (runId) {
      await db.update(internalAgentRuns)
        .set({
          status: runResult.status === "failed" ? "failed" : "completed",
          errorMessage: runResult.errorMessage ?? null,
          tokenUsage: adapterUsage ? {
            inputTokens: adapterUsage.inputTokens,
            outputTokens: adapterUsage.outputTokens,
            ...(typeof adapterUsage.cachedInputTokens === "number"
              ? { cachedInputTokens: adapterUsage.cachedInputTokens }
              : {}),
          } : null,
          costCents,
          durationMs: Date.now() - startedAt,
          completedAt: new Date(),
          // Audit #27: folded here (was a separate update pre-execute). This is
          // the natural home — one round-trip for the final run-row write.
          ...(promptSnapshot !== null ? { promptSnapshot } : {}),
        })
        .where(eq(internalAgentRuns.id, runId));
    }
    // Plan 3 Task 6 + T1.1: real cost accounting from adapter result.
    // Previously hardcoded to 0 tokens / $0 even when the adapter reported
    // real usage. Now uses the values returned in AdapterExecutionResult.
    // Providers without per-run billing (CLI subscriptions) still report
    // zero — that's correct and intentional.
    await costService(db).createEvent(payload.companyId, {
      agentId,
      provider: adapterResult.provider ?? "anthropic",
      model: adapterResult.model ?? process.env.EXTRACTION_MODEL ?? "claude-sonnet-4-20250514",
      inputTokens: adapterUsage?.inputTokens ?? 0,
      outputTokens: adapterUsage?.outputTokens ?? 0,
      // Prefer the adapter's authoritative cost. Fall back to model-based
      // computation only when the adapter doesn't report cost (e.g. legacy
      // adapter returning UsageSummary without costUsd).
      costCents: costCents ?? computeCostCents(
        adapterResult.provider ?? "anthropic",
        adapterResult.model ?? process.env.EXTRACTION_MODEL ?? "claude-sonnet-4-20250514",
        adapterUsage?.inputTokens ?? 0,
        adapterUsage?.outputTokens ?? 0,
      ),
      occurredAt: new Date(),
    });

    return runResult;
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
    // T1.0: return a failed AoaRunResult so the dispatcher sets the wakeup
    // row to status='failed'. Before T1.0 we swallowed silently and the
    // dispatcher inferred 'succeeded' from the absence of a thrown
    // exception — masking every crew failure as a successful wakeup.
    return { status: "failed", errorMessage: errMessage };
  } finally {
    // Phase 5 (Tasks 5.1/5.2): clear this agent's thread working-presence (run
    // ended — success OR failure). GUARANTEED removal even on throw: the
    // presenceThreadId is only set after the add succeeded, so this never
    // touches a thread we didn't light. Best-effort (mirrors heartbeat.ts:4117).
    if (presenceThreadId) {
      try {
        threadWorkingAgents.remove(presenceThreadId, agentId);
        broadcastThreadPresence(payload.companyId, presenceThreadId, Date.now());
      } catch (presenceErr) {
        log.warn({ err: presenceErr, threadId: presenceThreadId, agentName: presenceAgentName }, "aoa-runner: failed to clear working presence (best-effort, ignored)");
      }
    }
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
