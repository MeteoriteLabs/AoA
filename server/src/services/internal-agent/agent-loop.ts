import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { internalAgentConfig, agents } from "@armyofagents/db";
import type { CommanderContextScope, CommanderOutputRef } from "@armyofagents/shared";
import type { ToolResult } from "./types.js";
import {
  commanderTurnKey,
  releaseCommanderTurn,
  tryClaimCommanderTurn,
} from "./commander-turn-registry.js";
import { conversationService } from "./conversation.js";
import { cliModeService } from "./cli-mode.js";
import { agentInstructionsService } from "../agent-instructions.js";
import { contextAssemblyService } from "./context-assembly.js";
import { assembleAgentPersona } from "./commander-context.js";
import { ensureCommanderAgent } from "./aoa-agents/ensure-commander.js";
import { summarizeViaCli } from "./cli-summarizer.js";
import { buildCompactSkillList } from "./commander-skills.js";
import { companySkillService } from "../company-skills.js";
import {
  commanderMemoryRecallService,
  normalizeCommanderMemoryRecallPolicy,
} from "./memory-recall.js";
import {
  normalizeCommanderContextScope,
  type NormalizedCommanderContextScope,
} from "./context-scope.js";
import { collectChunkRefs, mergeOutputRefs } from "./output-refs.js";
import { humanToolSummary } from "./tool-summary.js";
import { assetService } from "../assets.js";
import {
  resolveRuntimeAttachments,
  formatRuntimeAttachmentBlock,
  createRuntimeAttachmentDeps,
} from "./runtime-attachments.js";
import type { Readable } from "node:stream";

/** Minimal storage surface needed to read attachment bytes for runtime delivery. */
export interface RuntimeAttachmentStorage {
  getObject: (companyId: string, objectKey: string) => Promise<{ stream: Readable }>;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface RunSummary {
  runId: string;
  toolsCalled: string[];
  durationMs: number;
  costCents: number;
  tokenUsage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  /** Model/provider actually used, when the adapter reports it (cost estimate input). */
  model?: string | null;
  provider?: string | null;
}

export type AgentStreamChunk =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id?: string; name: string; result: ToolResult; refs?: CommanderOutputRef[] }
  | { type: "action_confirmation"; toolName: string; params: unknown; runId: string }
  | { type: "options_prompt"; question: string; options: string[]; promptId: string }
  | { type: "error"; message: string }
  | { type: "done"; summary: RunSummary };

export interface ChatInput {
  companyId: string;
  userId: string;
  userRole: string;
  // Threaded through to the MCP bridge so tools can be capability-gated.
  // Looked up by the chat route from internal_agent_config. (C13)
  enabledCapabilities: readonly string[];
  content: string;
  /**
   * System-level context (persona + skills + conversation history) assembled
   * by agent-loop. When set, cli-mode passes this via --system so the model
   * sees it as its system prompt rather than as user-message content.
   * This prevents the user's global ~/.claude/CLAUDE.md (e.g. gstack routing
   * rules) from being triggered by what would otherwise look like instruction
   * text inside a user message. Undefined = fallback (full assembled content
   * stuffed into -p — pre-Sprint-1 behaviour, kept for codex stdin path).
   */
  systemContext?: string;
  /**
   * The raw, unassembled user-typed message. When systemContext is present,
   * cli-mode passes this via -p (the user turn) instead of the full assembled
   * content string. Undefined = use content (backward compat / codex).
   */
  rawContent?: string;
  pageContext?: string;
  departmentContext?: string;
  conversationId?: string;
  contextScope?: CommanderContextScope | NormalizedCommanderContextScope | null;
  /** Client idempotency key; a repeat replays the original turn (see chat()). */
  clientSubmissionId?: string;
  /** Composer attachment asset IDs; text-readable content is delivered to the turn. */
  attachmentAssetIds?: string[];
}

/**
 * Reconstruct the stream chunks for a persisted assistant reply so an idempotent
 * retry REPLAYS the original turn instead of re-running the CLI (PR #291 review).
 *
 * A completed turn may legitimately have EMPTY content when it was tool-calls
 * only — the persistence gate saves such rows (toolCalls present). Gating replay
 * on non-empty content would misclassify a completed tool-only turn as
 * "unfinished → re-run" and double-execute its tools. The existence of the
 * linked assistant row is therefore sufficient for replay; here we stream its
 * reasoning, tool calls/results, and content back as the original run would.
 */
function* replayPersistedReply(reply: {
  content?: string | null;
  reasoning?: string | null;
  toolCalls?: unknown;
  outputRefs?: unknown;
}): Generator<AgentStreamChunk> {
  if (reply.reasoning) {
    yield { type: "reasoning", delta: reply.reasoning };
  }
  const calls = Array.isArray(reply.toolCalls)
    ? (reply.toolCalls as Array<{ id?: string; name?: string; input?: unknown; success?: boolean; summary?: string; result?: unknown }>)
    : [];
  const refs = Array.isArray(reply.outputRefs) ? (reply.outputRefs as CommanderOutputRef[]) : [];
  let refsEmitted = false;
  for (const tc of calls) {
    const name = tc.name ?? "unknown";
    yield { type: "tool_call", id: tc.id ?? "", name, input: tc.input };
    const result: ToolResult = {
      success: tc.success ?? true,
      summary: typeof tc.summary === "string" ? tc.summary : "",
      data: tc.result,
    };
    const chunk: AgentStreamChunk = { type: "tool_result", name, result };
    if (tc.id) (chunk as { id?: string }).id = tc.id;
    // Re-attach the turn's merged output refs to the first tool_result so the
    // Commander viewer re-hydrates on replay (the row stores refs turn-level).
    if (!refsEmitted && refs.length > 0) {
      (chunk as { refs?: CommanderOutputRef[] }).refs = refs;
      refsEmitted = true;
    }
    yield chunk;
  }
  if (reply.content) {
    yield { type: "text", delta: reply.content };
  }
}

/**
 * A same-key request that could not acquire/keep the turn (lost the atomic claim
 * or the DB insert race) must NOT start a second CLI run. Defer to the winner:
 * replay its reply if one has already persisted, otherwise report in-progress
 * (PR #291 review). Shared by the fresh-path claim-loss and insert-loss branches.
 */
async function* replayWinnerOrSignalInProgress(
  convService: {
    getMessageByClientSubmissionId: (conversationId: string, key: string) => Promise<{ id: string } | null>;
    getAssistantReplyForUserMessage: (
      conversationId: string,
      userMessageId: string,
    ) => Promise<{ content?: string | null; reasoning?: string | null; toolCalls?: unknown; outputRefs?: unknown } | null>;
  },
  conversationId: string,
  clientSubmissionId: string | null,
): AsyncGenerator<AgentStreamChunk> {
  if (clientSubmissionId) {
    const winner = await convService.getMessageByClientSubmissionId(conversationId, clientSubmissionId);
    if (winner) {
      const reply = await convService.getAssistantReplyForUserMessage(conversationId, winner.id);
      if (reply) {
        yield* replayPersistedReply(reply);
        return;
      }
    }
  }
  yield {
    type: "error",
    message: "This message is already being processed.",
  };
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Internal agent ("Commander") chat service.
 *
 * Sprint 2A (Decision #91) — API-mode execution was removed. Every turn
 * routes through {@link cliModeService} regardless of the legacy
 * `executionMode` column on `internal_agent_config`. The column stays for
 * rollback safety and historical data; the dispatch no longer reads it.
 *
 * Responsibilities kept in this file:
 * - Ensure an active conversation exists
 * - Persist the inbound user message (for history + audit)
 * - Fetch the company's Commander config and surface "not configured" errors
 * - Dispatch to cli-mode, forwarding its stream chunks to the caller
 * - Persist the assistant turn after a clean stream (MX-chatpersist):
 *   cli-mode streams the reply but never writes it back, so the
 *   conversation-owning layer accumulates the text chunks and appends one
 *   role:"assistant" message (skipped on empty / error-only / throw)
 *
 * Responsibilities moved to cli-mode.ts:
 * - Session management, CLI subprocess spawn + stdin piping
 * - Streaming output parsing
 *
 * Not yet implemented on the CLI path (tracked deferrals):
 * - Run record creation in `internal_agent_runs`
 * - Per-turn cost accounting / budget enforcement
 * - Tool action confirmations
 * These features existed only in the API-mode loop and will come back when
 * the team-under-Commander architecture lands; see Decision #91.
 *
 * Now wired on the CLI path:
 * - Conversation summarization — `convService.summarizeIfNeeded` is called
 *   after every clean turn via an injectable tool-less CLI summarizer
 *   (`summarizeViaCli`). Long conversations are compacted automatically;
 *   a failed compaction is swallowed so it never affects the delivered reply.
 */
export function agentLoopService(db: Db, storage?: RuntimeAttachmentStorage) {
  const convService = conversationService(db);
  const cliService = cliModeService(db);

  return {
    async *chat(params: ChatInput): AsyncGenerator<AgentStreamChunk> {
      // In-process claim held for this turn's CLI run (PR #291 review, #1). Set
      // once we commit to running; released in the finally so a concurrent
      // duplicate can distinguish "still running here" from "dead orphan".
      let claimKey: string | null = null;
      try {
        // 1. Get/create active conversation
        const conversation = params.conversationId
          ? await convService.getById(params.conversationId)
          : await convService.getOrCreateActive(params.companyId, params.userId);

        if (!conversation) {
          yield { type: "error", message: "Conversation not found." };
          return;
        }

        // Ownership guard: when a specific conversationId was requested, reject
        // if the fetched conversation belongs to a different user or company.
        // Treat as not-found to avoid leaking existence.
        if (
          params.conversationId &&
          (conversation.companyId !== params.companyId ||
            conversation.userId !== params.userId)
        ) {
          yield { type: "error", message: "Conversation not found." };
          return;
        }

        // 1b. Idempotent retry: if this exact Send was already recorded AND the
        // turn completed (a persisted assistant reply exists), replay the
        // original reply — WITHOUT persisting a duplicate user message or
        // starting a second CLI run. If the user turn persisted but no assistant
        // reply was recorded, the original send either (a) is STILL RUNNING in
        // this process or (b) died (config error, CLI crash). Those two states
        // are otherwise indistinguishable, so we consult the in-process claim
        // registry: still-running → signal in-progress (never re-run — that
        // would double-execute the turn + its tools); ended → re-run reusing the
        // existing user row (round-2 Retry-after-error recovery). The partial
        // unique index on the message is the simultaneous-insert backstop.
        let reuseExistingUserRow = false;
        // The persisted user message this turn's reply must be linked to. Set on
        // both the fresh-insert and reuse-existing paths so the assistant row we
        // persist below carries an explicit back-link (PR #291 review, C2).
        let userMessageId: string | null = null;
        if (params.clientSubmissionId) {
          const priorUser = await convService.getMessageByClientSubmissionId(
            conversation.id,
            params.clientSubmissionId,
          );
          if (priorUser) {
            // C2: replay ONLY the reply explicitly linked to this user turn, not
            // the first assistant row after its timestamp — which could belong to
            // a later, unrelated turn if this send died before it replied.
            const reply = await convService.getAssistantReplyForUserMessage(
              conversation.id,
              priorUser.id,
            );
            // #2 (round-3): ANY linked assistant row is a completed reply — a
            // tool-only turn legitimately has empty content. Replay it (stream
            // its tool events/content) rather than re-running the CLI.
            if (reply) {
              yield* replayPersistedReply(reply);
              return;
            }
            // #1 (round-3/4): no linked reply. Atomically claim the turn here at
            // the decision point — a single check-and-set with no `await` in
            // between, so two near-simultaneous retries cannot both acquire it.
            // The loser (claim already held → original still streaming HERE)
            // reports in-progress instead of re-running (which would double-run
            // the turn + its tools).
            const key = commanderTurnKey(conversation.id, params.clientSubmissionId);
            if (!tryClaimCommanderTurn(key)) {
              yield {
                type: "error",
                message: "This message is already being processed.",
              };
              return;
            }
            claimKey = key;
            reuseExistingUserRow = true;
            userMessageId = priorUser.id;
          }
        }

        // 2. Persist the user message (skipped when re-running an orphaned
        // turn whose user row already exists from the failed original send).
        if (!reuseExistingUserRow) {
          // #1 (round-5): claim BEFORE inserting. appendMessage commits the user
          // row and then AWAITS a separate conversation-counter update; a
          // duplicate that finds the committed row during that gap would
          // tryClaim + start the CLI while THIS request also runs. Claiming
          // first closes the gap (and serializes two fresh same-key sends
          // in-process — the loser never inserts; the DB unique index remains
          // the cross-process backstop). A loser must NOT start a second run.
          if (params.clientSubmissionId) {
            const key = commanderTurnKey(conversation.id, params.clientSubmissionId);
            if (!tryClaimCommanderTurn(key)) {
              yield* replayWinnerOrSignalInProgress(convService, conversation.id, params.clientSubmissionId);
              return;
            }
            claimKey = key;
          }

          const insertedUser = await convService.appendMessage(conversation.id, {
            role: "user",
            content: params.content,
            pageContext: params.pageContext ?? null,
            departmentContext: params.departmentContext ?? null,
            clientSubmissionId: params.clientSubmissionId ?? null,
          });
          // C3 (PR #291 review): a same-key request that lost the unique-index
          // race gets back an undefined insert (a duplicate inserted first,
          // cross-process or before our in-process claim on another instance).
          // Release our claim and defer to the winner — replay its reply if it
          // persisted, otherwise report in-progress. Never start a second run.
          if (!insertedUser) {
            if (claimKey) {
              releaseCommanderTurn(claimKey);
              claimKey = null;
            }
            yield* replayWinnerOrSignalInProgress(
              convService,
              conversation.id,
              params.clientSubmissionId ?? null,
            );
            return;
          }
          userMessageId = insertedUser.id;
        }

        // 2b. Runtime attachment delivery (v1 — text only). Resolve company-owned
        // attachment content server-side and fold it into the message shown to the
        // model. Best-effort: an attachment failure must never fail the turn.
        let effectiveUserMessage = params.content;
        if (storage && params.attachmentAssetIds && params.attachmentAssetIds.length > 0) {
          try {
            const deps = createRuntimeAttachmentDeps(
              (assetId) => assetService(db).getById(assetId) as any,
              storage,
            );
            const resolved = await resolveRuntimeAttachments(
              deps,
              params.companyId,
              params.attachmentAssetIds,
            );
            const block = formatRuntimeAttachmentBlock(resolved);
            if (block) effectiveUserMessage = `${params.content}\n\n${block}`;
          } catch {
            // Leave the message untouched; the file stays referenced, not read.
          }
        }

        // 3. Load Commander config
        const config = await db
          .select()
          .from(internalAgentConfig)
          .where(eq(internalAgentConfig.companyId, params.companyId))
          .then((rows: any[]) => rows[0] ?? null);

        if (!config) {
          yield {
            type: "error",
            message: "Internal agent not configured. Go to Settings to set up.",
          };
          return;
        }

        // 4. Dispatch to CLI mode (the only execution path post-Sprint-2A).
        //
        // MX-chatpersist: agent-loop OWNS the conversation, so it is the
        // correct layer to persist the assistant turn. cli-mode streams the
        // reply to the caller but never writes it back (its accumulatedText
        // was dead). We forward every chunk UNCHANGED (SSE/streaming stays
        // byte-identical for claude AND codex — we only ADD post-stream
        // persistence here; cli-mode spawn/args/parsing is untouched) and
        // separately accumulate type:"text" deltas. After a CLEAN stream
        // completion, if there is non-empty assistant text, append one
        // role:"assistant" message. Nothing is persisted on the empty,
        // error-only, or mid-stream-throw paths (the catch below handles
        // throws; a partial accumulation is intentionally discarded so a
        // failed turn never leaves a truncated assistant message — the
        // persisted user turn + the streamed error are the durable record).

        // Assemble the per-turn prompt (Option B). cli-mode is UNCHANGED:
        // it sends params.content verbatim, so substituting content here
        // keeps the spawn shape byte-identical (content-only change).
        let assembledContent = params.content;
        let systemContext: string | undefined;
        let cliContextScope: NormalizedCommanderContextScope | null = null;
        try {
          const commanderAgentId = await ensureCommanderAgent(db, params.companyId);
          const agentRow = await db
            .select({ id: agents.id, companyId: agents.companyId, name: agents.name, adapterConfig: agents.adapterConfig })
            .from(agents)
            .where(eq(agents.id, commanderAgentId))
            .then((r: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null }[]) => r[0] ?? null);
          const persona = agentRow
            ? await assembleAgentPersona({ agent: agentRow, service: agentInstructionsService() })
            : null;
          const skillsSection = await buildCompactSkillList({
            companyId: params.companyId,
            agentId: commanderAgentId,
            resolve: (cid, aid) => companySkillService(db).listCompactSkillEntries(cid, aid),
          });
          const history = await convService.getMessagesSince(
            conversation.id,
            (conversation as { summarizedUpToMessageId?: string | null }).summarizedUpToMessageId ?? null,
            50,
          );
          const historyText = history
            .map((m: { role: string; content?: string | null }) => (m.content ? `${m.role}: ${m.content}` : null))
            .filter(Boolean)
            .join("\n");
          const metadata =
            config.metadata && typeof config.metadata === "object" && !Array.isArray(config.metadata)
              ? (config.metadata as Record<string, unknown>)
              : {};
          const memoryRecallPolicy = normalizeCommanderMemoryRecallPolicy(metadata.memoryRecall);
          const contextScope = normalizeCommanderContextScope({
            contextScope: params.contextScope ?? null,
            departmentContext: params.departmentContext ?? null,
            conversationId: conversation.id,
          });
          cliContextScope = contextScope;
          const effectiveDepartmentContext = contextScope.departmentId;
          const recalledMemory = await commanderMemoryRecallService(db).recall({
            companyId: params.companyId,
            userId: params.userId,
            userRole: params.userRole,
            conversationId: conversation.id,
            agentId: commanderAgentId,
            latestUserMessage: params.content,
            policy: memoryRecallPolicy,
            scope: contextScope,
          });
          const assembled = await contextAssemblyService(db).assembleContext(params.companyId, {
            ...(persona ? { systemInstructions: persona } : {}),
            ...((conversation as { summarizedContext?: string | null }).summarizedContext
              ? { conversationSummary: (conversation as { summarizedContext?: string | null }).summarizedContext }
              : {}),
            ...(params.pageContext ? { pageContext: params.pageContext } : {}),
            ...(effectiveDepartmentContext ? { departmentContext: effectiveDepartmentContext } : {}),
            contextTokenBudget: (config as { contextTokenBudget?: number }).contextTokenBudget,
            relevanceQuery: params.content,
            memoryItems: recalledMemory.items.map((item) => ({
              title: item.title,
              content: item.content,
              layer: item.layer,
            })),
          });

          // Split assembled context from the user message (C-systemsplit).
          //
          // Problem: sending the entire assembled prompt (system instructions +
          // skills + history) as a single -p "user message" causes the global
          // ~/.claude/CLAUDE.md (which may carry gstack routing rules) to
          // interpret what looks like instruction text as user content and echo
          // skill-related text back to the user.
          //
          // Fix: pass system context via --system and raw user input via -p so
          // the model correctly interprets its Commander role from the system
          // slot, regardless of what the user's personal claude config contains.
          // For codex (stdin path) the full assembled content is still used
          // since codex does not read ~/.claude/CLAUDE.md the same way.
          systemContext =
            `${assembled.systemPrompt}` +
            (skillsSection ? `\n\n${skillsSection}` : "") +
            (historyText ? `\n\n## Conversation So Far\n${historyText}` : "");

          // Full assembled string kept for the codex stdin path (unchanged).
          assembledContent =
            systemContext +
            `\n\n## User Message\n${effectiveUserMessage}`;
        } catch {
          // Any assembly failure → send the raw message (never hard-fail).
          assembledContent = effectiveUserMessage;
          systemContext = undefined;
        }

        // For claude_cli: systemContext + rawContent enable the --system split.
        // For codex: content (full assembled) is used via stdin — unchanged.
        const cliParams = {
          ...params,
          // The caller may omit conversationId when starting a new chat. The
          // runtime provider session still needs the resolved persisted ID so
          // it cannot be shared with another Commander conversation.
          conversationId: conversation.id,
          content: assembledContent,
          contextScope: cliContextScope,
          ...(systemContext !== undefined
            ? { systemContext, rawContent: effectiveUserMessage }
            : {}),
        };

        const effectiveConfig = {
          ...config,
          cliTool: (config as { cliTool?: string | null }).cliTool ?? "claude_cli",
        };

        let accumulatedAssistant = "";
        const REASONING_CAP = 16000;
        let accumulatedReasoning = "";
        const turnRefs: CommanderOutputRef[] = [];
        const turnToolCalls: Array<{ id?: string; name: string; input?: unknown; success?: boolean; summary?: string; result?: unknown }> = [];
        for await (const chunk of cliService.chat(cliParams, effectiveConfig)) {
          if (chunk.type === "text") accumulatedAssistant += chunk.delta;
          if (chunk.type === "reasoning") {
            // F5: cap accumulation exactly — once at/over cap, stop appending and
            // skip forwarding to avoid holding a huge string in memory.
            if (accumulatedReasoning.length >= REASONING_CAP) {
              // Already at/over cap — skip yielding and accumulating.
              continue;
            }
            // Slice to cap so a large delta cannot overshoot by one chunk.
            accumulatedReasoning = (accumulatedReasoning + chunk.delta).slice(0, REASONING_CAP);
          }
          if (chunk.type === "tool_call") {
            turnToolCalls.push({ id: chunk.id, name: chunk.name, input: chunk.input });
          }
          if (chunk.type === "tool_result") {
            const enriched = {
              success: chunk.result?.success ?? true,
              summary: humanToolSummary(chunk.name, chunk.result?.summary ?? chunk.result?.data),
              result: chunk.result?.data ?? chunk.result,
            };
            const match = turnToolCalls.find((c) => (chunk.id && c.id === chunk.id) || (c.name === chunk.name && c.success === undefined));
            if (match) Object.assign(match, enriched);
            else turnToolCalls.push({ id: chunk.id, name: chunk.name, ...enriched });
          }
          collectChunkRefs(turnRefs, chunk);
          yield chunk;
        }

        if (accumulatedAssistant.trim() || turnToolCalls.length > 0 || accumulatedReasoning.trim()) {
          // Assistant replies have no originating page / department-persona
          // context (those describe where the USER was), so we omit them —
          // appendMessage defaults the optional fields to null, matching the
          // internal_agent_messages schema. role:"assistant" is a valid role
          // per the schema's role enum.
          const outputRefs = turnRefs.length > 0 ? mergeOutputRefs([], turnRefs) : undefined;
          await convService.appendMessage(conversation.id, {
            role: "assistant",
            content: accumulatedAssistant,
            // C2 (PR #291 review): back-link the reply to the user turn that
            // produced it so an idempotent retry replays THIS reply, never a
            // later turn's. Null only if assembly ran without a user row.
            ...(userMessageId ? { replyToUserMessageId: userMessageId } : {}),
            ...(outputRefs ? { outputRefs } : {}),
            ...(turnToolCalls.length > 0 ? { toolCalls: turnToolCalls } : {}),
            // F5: accumulatedReasoning is already capped during accumulation — no slice needed.
            ...(accumulatedReasoning.trim() ? { reasoning: accumulatedReasoning } : {}),
          });
        }

        // Post-turn compaction (graceful: never blocks/raises into the turn).
        try {
          await convService.summarizeIfNeeded(conversation.id, (transcript) =>
            summarizeViaCli({
              cliTool: (config as { cliTool?: string }).cliTool ?? "claude_cli",
              cheapModel: (config as { cheapModel?: string | null }).cheapModel ?? null,
              transcript,
            }),
          );
        } catch {
          // swallow — a failed compaction must never affect the delivered reply
        }
      } catch (err: any) {
        yield {
          type: "error",
          message: err?.message ?? "An unexpected error occurred.",
        };
        yield {
          type: "done",
          summary: {
            runId: "",
            toolsCalled: [],
            durationMs: 0,
            costCents: 0,
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
          },
        };
      } finally {
        // Release the in-process turn claim (#1) whether the run completed,
        // errored, or the consumer abandoned the stream early. Once released, a
        // same-key retry of a genuinely-dead turn can re-run (Retry recovery).
        if (claimKey) releaseCommanderTurn(claimKey);
      }
    },
  };
}
