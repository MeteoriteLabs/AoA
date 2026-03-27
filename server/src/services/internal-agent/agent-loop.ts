import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  internalAgentConfig,
  internalAgentRuns,
} from "@paperclipai/db";
import type { ToolResult, ToolContext } from "./types.js";
import type { ChatMessage } from "./providers/types.js";
import { getProviderApiKey, createProvider } from "./providers/index.js";
import {
  createToolRegistry,
  getToolsForMessage,
  executeTool,
} from "./tool-registry.js";
import { contextAssemblyService } from "./context-assembly.js";
import { conversationService } from "./conversation.js";
import { createServiceContainer } from "./service-container.js";
import { publishLiveEvent } from "../live-events.js";
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

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 10;

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 300, output: 1500 },
  "claude-haiku-4-5-20251001": { input: 80, output: 400 },
  "gpt-4o": { input: 250, output: 1000 },
  "gpt-4o-mini": { input: 15, output: 60 },
  "gemini-2.0-flash": { input: 10, output: 40 },
};

// Default to most expensive tier for unknown models
const DEFAULT_PRICING = { input: 300, output: 1500 };

// Provider max context windows (tokens) for Gotcha 2.4
const PROVIDER_MAX_CONTEXT: Record<string, number> = {
  anthropic: 200_000,
  openai: 128_000,
  google: 1_000_000,
};
const CONTEXT_SAFETY_RATIO = 0.8;

function estimateMessageTokens(messages: ChatMessage[], systemPrompt: string, toolCount: number): number {
  let total = Math.ceil(systemPrompt.length / 4);
  for (const msg of messages) {
    total += Math.ceil((msg.content?.length ?? 0) / 4);
    if (msg.toolCalls) total += Math.ceil(JSON.stringify(msg.toolCalls).length / 4);
    if (msg.toolResults) total += Math.ceil(JSON.stringify(msg.toolResults).length / 4);
  }
  total += toolCount * 100; // ~100 tokens per tool definition
  return total;
}

function calculateCostCents(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return Math.ceil(
    (usage.inputTokens * pricing.input + usage.outputTokens * pricing.output) /
      1_000_000,
  );
}

// ── Pending Actions Store ────────────────────────────────────────────────────

interface PendingAction {
  resolve: (confirmed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  toolName: string;
  params: unknown;
  companyId: string;
  userId: string;
}

const pendingActions = new Map<string, PendingAction>();

// ── Service ──────────────────────────────────────────────────────────────────

export function agentLoopService(db: Db) {
  const convService = conversationService(db);
  const ctxService = contextAssemblyService(db);
  const allTools = createToolRegistry();
  const services = createServiceContainer(db);
  const cliService = cliModeService(db);

  return {
    async *chat(params: ChatInput): AsyncGenerator<AgentStreamChunk> {
      const startTime = Date.now();
      const toolsCalled: Array<{ name: string; input: unknown; output: unknown; durationMs: number; success: boolean }> = [];
      let totalUsage = { inputTokens: 0, outputTokens: 0 };
      let runId = "";
      let accumulatedText = "";

      try {
        // 1. Get/create active conversation
        const conversation = await convService.getOrCreateActive(
          params.companyId,
          params.userId,
        );

        // 2. Append user message
        const userMsg = await convService.appendMessage(conversation.id, {
          role: "user",
          content: params.content,
          pageContext: params.pageContext ?? null,
          departmentContext: params.departmentContext ?? null,
        });

        // 3. Auto-reject pending actions for this user only
        // (Gotcha 2.5: on new user message, pending actions expire)
        for (const [rid, pending] of pendingActions.entries()) {
          if (pending.companyId === params.companyId && pending.userId === params.userId) {
            clearTimeout(pending.timer);
            pending.resolve(false);
            pendingActions.delete(rid);
          }
        }

        // 4. Assemble context
        const { systemPrompt } = await ctxService.assembleContext(
          params.companyId,
          {
            pageContext: params.pageContext,
            departmentContext: params.departmentContext,
            conversationSummary: conversation.summarizedContext ?? null,
          },
        );

        // 5. Get recent messages (last 20 only — older history is in summarizedContext)
        const recentMessages = await convService.getRecentMessages(
          conversation.id,
          20,
        );
        const messages = buildMessagesForProvider(
          recentMessages,
          conversation.summarizedContext,
        );

        // 6. Get config, resolve provider + API key
        const config = await db
          .select()
          .from(internalAgentConfig)
          .where(eq(internalAgentConfig.companyId, params.companyId))
          .then((rows: any[]) => rows[0] ?? null);

        if (!config) {
          yield { type: "error", message: "Internal agent not configured. Go to Settings to set up." };
          return;
        }

        // CLI mode delegation (DA-5)
        if (config.executionMode === "cli") {
          yield* cliService.chat(params, config);
          return;
        }

        const providerName = config.provider ?? "anthropic";
        const model = config.model ?? "claude-sonnet-4-6";
        const apiKey = await getProviderApiKey(db, params.companyId, providerName);
        const provider = createProvider(providerName, apiKey);

        // 7. Select tools (fixed for all iterations)
        const tools = getToolsForMessage(params.content, allTools);
        const providerTools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }));

        // 8. Create run record
        const run = await db
          .insert(internalAgentRuns)
          .values({
            companyId: params.companyId,
            triggerType: "conversation",
            triggerSource: "user_message",
            status: "running",
            userId: params.userId,
            conversationMessageId: userMsg.id,
            provider: providerName,
            model,
            departmentContext: params.departmentContext ?? null,
          })
          .returning()
          .then((rows: any[]) => rows[0]);

        runId = run.id;

        publishLiveEvent({
          companyId: params.companyId,
          type: "internal_agent.run.status",
          payload: { runId, status: "running" },
        });

        // 9. Budget check
        if (
          config.budgetMonthlyCents != null &&
          config.spentMonthlyCents >= config.budgetMonthlyCents
        ) {
          yield {
            type: "error",
            message: "Monthly budget exceeded. Increase your budget in Settings to continue.",
          };

          await db
            .update(internalAgentRuns)
            .set({
              status: "failed",
              errorMessage: "Budget exceeded",
              completedAt: new Date(),
              durationMs: Date.now() - startTime,
            })
            .where(eq(internalAgentRuns.id, runId));

          yield {
            type: "done",
            summary: {
              runId,
              toolsCalled: [],
              durationMs: Date.now() - startTime,
              costCents: 0,
              tokenUsage: totalUsage,
            },
          };
          return;
        }

        // 10. The loop (max iterations)
        let iteration = 0;
        let currentMessages = [...messages];

        while (iteration < MAX_TOOL_ROUNDS) {
          iteration++;

          // Total token guard (Gotcha 2.4)
          const maxContext = PROVIDER_MAX_CONTEXT[providerName] ?? 200_000;
          const estimatedTotal = estimateMessageTokens(currentMessages, systemPrompt, providerTools.length);
          if (estimatedTotal > maxContext * CONTEXT_SAFETY_RATIO) {
            // Synchronous summarization to free up context space
            await convService.summarizeIfNeeded(conversation.id, provider, { model });
            const refreshed = await convService.getOrCreateActive(params.companyId, params.userId);
            const freshMessages = await convService.getRecentMessages(conversation.id, 20);
            currentMessages = buildMessagesForProvider(freshMessages, refreshed.summarizedContext);
          }

          // Call LLM
          let hasToolCall = false;
          let pendingToolCalls: Array<{ id: string; name: string; input: unknown }> = [];

          try {
            for await (const chunk of provider.chat({
              messages: currentMessages,
              tools: providerTools,
              model,
              maxTokens: 4096,
              systemPrompt,
            })) {
              if (chunk.type === "text") {
                accumulatedText += chunk.delta;
                yield { type: "text", delta: chunk.delta };
              } else if (chunk.type === "tool_call") {
                hasToolCall = true;
                pendingToolCalls.push({
                  id: chunk.id,
                  name: chunk.name,
                  input: chunk.input,
                });
                yield { type: "tool_call", id: chunk.id, name: chunk.name, input: chunk.input };
              } else if (chunk.type === "done") {
                totalUsage.inputTokens += chunk.usage.inputTokens;
                totalUsage.outputTokens += chunk.usage.outputTokens;
              }
            }
          } catch (err: any) {
            // Error handling: save partial, mark failed
            if (accumulatedText) {
              await convService.appendMessage(conversation.id, {
                role: "assistant",
                content: accumulatedText,
                runId,
              });
            }

            await db
              .update(internalAgentRuns)
              .set({
                status: "failed",
                errorMessage: err?.message ?? "Unknown provider error",
                completedAt: new Date(),
                durationMs: Date.now() - startTime,
                tokenUsage: totalUsage,
                toolsCalled,
              })
              .where(eq(internalAgentRuns.id, runId));

            publishLiveEvent({
              companyId: params.companyId,
              type: "internal_agent.run.status",
              payload: { runId, status: "failed" },
            });

            yield {
              type: "error",
              message: `Provider error: ${err?.message ?? "Unknown error"}. Your previous messages are saved.`,
            };
            yield {
              type: "done",
              summary: {
                runId,
                toolsCalled: toolsCalled.map((t) => t.name),
                durationMs: Date.now() - startTime,
                costCents: calculateCostCents(model, totalUsage),
                tokenUsage: totalUsage,
              },
            };
            return;
          }

          if (!hasToolCall) {
            // Text response — loop ends
            break;
          }

          // Execute tool calls
          for (const tc of pendingToolCalls) {
            const tool = tools.find((t) => t.name === tc.name);
            if (!tool) {
              const errorResult: ToolResult = {
                success: false,
                data: null,
                summary: `Unknown tool: ${tc.name}`,
                error: "NOT_FOUND",
              };
              yield { type: "tool_result", name: tc.name, result: errorResult };
              currentMessages.push(
                { role: "assistant", content: "", toolCalls: [tc] },
                { role: "user", content: "", toolResults: [{ toolCallId: tc.id, name: tc.name, result: JSON.stringify(errorResult) }] },
              );
              continue;
            }

            // Action confirmation check
            if (tool.requiresConfirmation && (config.autonomyLevel ?? 0) === 0) {
              yield {
                type: "action_confirmation",
                toolName: tc.name,
                params: tc.input,
                runId,
              };

              // Pause: await confirmation via Promise
              // Use runId:toolCallId as key to avoid collision with multiple tool calls
              const actionKey = `${runId}:${tc.id}`;
              const confirmed = await new Promise<boolean>((resolve) => {
                const timer = setTimeout(() => {
                  pendingActions.delete(actionKey);
                  resolve(false);
                }, 5 * 60 * 1000); // 5 minute timeout

                pendingActions.set(actionKey, {
                  resolve,
                  timer,
                  toolName: tc.name,
                  params: tc.input,
                  companyId: params.companyId,
                  userId: params.userId,
                });
              });

              if (!confirmed) {
                const cancelResult: ToolResult = {
                  success: false,
                  data: null,
                  summary: "Action cancelled by user",
                  error: "CANCELLED",
                };
                yield { type: "tool_result", name: tc.name, result: cancelResult };
                currentMessages.push(
                  { role: "assistant", content: "", toolCalls: [tc] },
                  { role: "user", content: "", toolResults: [{ toolCallId: tc.id, name: tc.name, result: JSON.stringify(cancelResult) }] },
                );
                continue;
              }
            }

            // RBAC check
            const roleHierarchy = { team_member: 0, team_lead: 1, founder: 2 };
            const userLevel = roleHierarchy[params.userRole as keyof typeof roleHierarchy] ?? 0;
            const requiredLevel = roleHierarchy[tool.requiredRole as keyof typeof roleHierarchy] ?? 0;
            if (userLevel < requiredLevel) {
              const forbiddenResult: ToolResult = {
                success: false,
                data: null,
                summary: `Permission denied: ${tool.name} requires ${tool.requiredRole} role`,
                error: "FORBIDDEN",
              };
              yield { type: "tool_result", name: tc.name, result: forbiddenResult };
              currentMessages.push(
                { role: "assistant", content: "", toolCalls: [tc] },
                { role: "user", content: "", toolResults: [{ toolCallId: tc.id, name: tc.name, result: JSON.stringify(forbiddenResult) }] },
              );
              continue;
            }

            // Execute tool
            const toolCtx: ToolContext = {
              companyId: params.companyId,
              userId: params.userId,
              userRole: params.userRole,
              db,
              services,
            };

            const toolStart = Date.now();
            const result = await executeTool(tool, tc.input, toolCtx);
            const toolDuration = Date.now() - toolStart;

            toolsCalled.push({
              name: tc.name,
              input: tc.input,
              output: result.data,
              durationMs: toolDuration,
              success: result.success,
            });

            yield { type: "tool_result", name: tc.name, result };

            // Append tool messages to history for next iteration
            currentMessages.push(
              { role: "assistant", content: "", toolCalls: [tc] },
              { role: "user", content: "", toolResults: [{ toolCallId: tc.id, name: tc.name, result: JSON.stringify(result) }] },
            );

            // Also persist to conversation
            await convService.appendMessage(conversation.id, {
              role: "tool_call",
              toolCalls: [tc],
              runId,
            });
            await convService.appendMessage(conversation.id, {
              role: "tool_result",
              content: result.summary,
              toolResults: [{ toolCallId: tc.id, name: tc.name, result: JSON.stringify(result) }],
              runId,
            });
          }
        }

        // 11. Iteration limit guard (Gotcha 2.3)
        if (iteration >= MAX_TOOL_ROUNDS) {
          // Inject system message and give one more chance
          currentMessages.push({
            role: "user",
            content: "You have reached the maximum number of tool rounds. Please provide your final response.",
          });

          try {
            for await (const chunk of provider.chat({
              messages: currentMessages,
              tools: [], // no tools — force text response
              model,
              maxTokens: 2048,
              systemPrompt,
            })) {
              if (chunk.type === "text") {
                accumulatedText += chunk.delta;
                yield { type: "text", delta: chunk.delta };
              } else if (chunk.type === "done") {
                totalUsage.inputTokens += chunk.usage.inputTokens;
                totalUsage.outputTokens += chunk.usage.outputTokens;
              }
            }
          } catch {
            if (!accumulatedText) {
              accumulatedText = "I ran into my processing limit. Here's what I found so far.";
              yield { type: "text", delta: accumulatedText };
            }
          }
        }

        // 12. Summarize if needed (fire-and-forget for next turn)
        convService
          .summarizeIfNeeded(conversation.id, provider, { model })
          .catch(() => {}); // swallow errors

        // 13. Finalize
        const costCents = calculateCostCents(model, totalUsage);
        const durationMs = Date.now() - startTime;

        // Persist assistant message
        if (accumulatedText) {
          await convService.appendMessage(conversation.id, {
            role: "assistant",
            content: accumulatedText,
            runId,
            tokenCount: Math.ceil(accumulatedText.length / 4),
          });
        }

        // Update run record
        await db
          .update(internalAgentRuns)
          .set({
            status: "completed",
            toolsCalled,
            summary: accumulatedText.slice(0, 500),
            tokenUsage: totalUsage,
            costCents,
            durationMs,
            completedAt: new Date(),
          })
          .where(eq(internalAgentRuns.id, runId));

        // Publish live events for WebSocket subscribers
        publishLiveEvent({
          companyId: params.companyId,
          type: "internal_agent.run.status",
          payload: { runId, status: "completed", durationMs, costCents },
        });
        if (accumulatedText) {
          publishLiveEvent({
            companyId: params.companyId,
            type: "internal_agent.message",
            payload: {
              runId,
              conversationId: conversation.id,
              messagePreview: accumulatedText.slice(0, 200),
            },
          });
        }

        // Update spent budget
        if (costCents > 0) {
          await db
            .update(internalAgentConfig)
            .set({
              spentMonthlyCents: sql`${internalAgentConfig.spentMonthlyCents} + ${costCents}`,
              updatedAt: new Date(),
            })
            .where(eq(internalAgentConfig.companyId, params.companyId));
        }

        yield {
          type: "done",
          summary: {
            runId,
            toolsCalled: toolsCalled.map((t) => t.name),
            durationMs,
            costCents,
            tokenUsage: totalUsage,
          },
        };
      } catch (err: any) {
        // Top-level catch for unexpected errors
        yield {
          type: "error",
          message: err?.message ?? "An unexpected error occurred.",
        };

        if (runId) {
          await db
            .update(internalAgentRuns)
            .set({
              status: "failed",
              errorMessage: err?.message ?? "Unknown error",
              completedAt: new Date(),
              durationMs: Date.now() - startTime,
            })
            .where(eq(internalAgentRuns.id, runId))
            .catch(() => {});

          publishLiveEvent({
            companyId: params.companyId,
            type: "internal_agent.run.status",
            payload: { runId, status: "failed" },
          });
        }

        yield {
          type: "done",
          summary: {
            runId,
            toolsCalled: toolsCalled.map((t) => t.name),
            durationMs: Date.now() - startTime,
            costCents: 0,
            tokenUsage: totalUsage,
          },
        };
      }
    },

    async confirmAction(
      companyId: string,
      runId: string,
      confirmed: boolean,
    ): Promise<void> {
      // Find pending action by runId prefix (key is runId:toolCallId)
      for (const [key, pending] of pendingActions.entries()) {
        if (key.startsWith(`${runId}:`) && pending.companyId === companyId) {
          clearTimeout(pending.timer);
          pending.resolve(confirmed);
          pendingActions.delete(key);
          return;
        }
      }
    },
  };
}

// ── Helpers (exported for testing) ────────────────────────────────────────────

export function buildMessagesForProvider(
  messages: Array<Record<string, unknown>>,
  summarizedContext: string | null | undefined,
): ChatMessage[] {
  const result: ChatMessage[] = [];

  // Prepend summary if exists
  if (summarizedContext) {
    result.push({
      role: "assistant",
      content: `[Previous conversation summary]: ${summarizedContext}`,
    });
  }

  for (const msg of messages) {
    const role = msg.role as string;

    if (role === "user") {
      result.push({ role: "user", content: (msg.content as string) ?? "" });
    } else if (role === "assistant") {
      result.push({ role: "assistant", content: (msg.content as string) ?? "" });
    } else if (role === "tool_call") {
      result.push({
        role: "assistant",
        content: "",
        toolCalls: (msg.toolCalls as any[]) ?? [],
      });
    } else if (role === "tool_result") {
      result.push({
        role: "user",
        content: "",
        toolResults: (msg.toolResults as any[]) ?? [],
      });
    }
    // role === "system" → skip (system context in systemPrompt param)
  }

  return result;
}
