import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { internalAgentConfig, agents } from "@armyofagents/db";
import type { ToolResult } from "./types.js";
import { conversationService } from "./conversation.js";
import { cliModeService } from "./cli-mode.js";
import { agentInstructionsService } from "../agent-instructions.js";
import { contextAssemblyService } from "./context-assembly.js";
import { loadCommanderPersona } from "./commander-context.js";
import { ensureCommanderAgent } from "./aoa-agents/ensure-commander.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface RunSummary {
  runId: string;
  toolsCalled: string[];
  durationMs: number;
  costCents: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
}

export type AgentStreamChunk =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; name: string; result: ToolResult }
  | { type: "action_confirmation"; toolName: string; params: unknown; runId: string }
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
  pageContext?: string;
  departmentContext?: string;
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
 * - Conversation summarization — `conversation.ts::summarizeIfNeeded` is
 *   now orphaned. Long Commander conversations will grow unbounded until
 *   summarization is re-wired (needs a provider reference we no longer
 *   hold here). Flagged as dead-code but left in place until replaced.
 * These features existed only in the API-mode loop and will come back when
 * the team-under-Commander architecture lands; see Decision #91.
 */
export function agentLoopService(db: Db) {
  const convService = conversationService(db);
  const cliService = cliModeService(db);

  return {
    async *chat(params: ChatInput): AsyncGenerator<AgentStreamChunk> {
      try {
        // 1. Get/create active conversation
        const conversation = await convService.getOrCreateActive(
          params.companyId,
          params.userId,
        );

        // 2. Persist the user message
        await convService.appendMessage(conversation.id, {
          role: "user",
          content: params.content,
          pageContext: params.pageContext ?? null,
          departmentContext: params.departmentContext ?? null,
        });

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
        try {
          const commanderAgentId = await ensureCommanderAgent(db, params.companyId);
          const agentRow = await db
            .select({ id: agents.id, companyId: agents.companyId, name: agents.name, adapterConfig: agents.adapterConfig })
            .from(agents)
            .where(eq(agents.id, commanderAgentId))
            .then((r: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null }[]) => r[0] ?? null);
          const persona = agentRow
            ? await loadCommanderPersona({ agent: agentRow, service: agentInstructionsService() })
            : null;
          const assembled = await contextAssemblyService(db).assembleContext(params.companyId, {
            ...(persona ? { systemInstructions: persona } : {}),
            ...(params.pageContext ? { pageContext: params.pageContext } : {}),
            ...(params.departmentContext ? { departmentContext: params.departmentContext } : {}),
            contextTokenBudget: (config as { contextTokenBudget?: number }).contextTokenBudget,
          });
          assembledContent = `${assembled.systemPrompt}\n\n## User Message\n${params.content}`;
        } catch {
          // Any assembly failure → send the raw message (never hard-fail).
          assembledContent = params.content;
        }

        const cliParams = { ...params, content: assembledContent };

        let accumulatedAssistant = "";
        for await (const chunk of cliService.chat(cliParams, config)) {
          if (chunk.type === "text") accumulatedAssistant += chunk.delta;
          yield chunk;
        }

        if (accumulatedAssistant.trim()) {
          // Assistant replies have no originating page / department-persona
          // context (those describe where the USER was), so we omit them —
          // appendMessage defaults the optional fields to null, matching the
          // internal_agent_messages schema. role:"assistant" is a valid role
          // per the schema's role enum.
          await convService.appendMessage(conversation.id, {
            role: "assistant",
            content: accumulatedAssistant,
          });
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
      }
    },
  };
}
