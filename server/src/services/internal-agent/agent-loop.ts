import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { internalAgentConfig } from "@armyofagents/db";
import type { ToolResult } from "./types.js";
import { conversationService } from "./conversation.js";
import { cliModeService } from "./cli-mode.js";

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

        // 4. Dispatch to CLI mode (the only execution path post-Sprint-2A)
        yield* cliService.chat(params, config);
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
