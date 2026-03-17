import Anthropic from "@anthropic-ai/sdk";
import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import {
  buildSystemPrompt,
  buildUserMessage,
  resolveApiKey,
  estimateCostUsd,
  mapErrorToResult,
} from "../api-common.js";
import { DEFAULT_MODEL } from "./models.js";

const TIMEOUT_MS = 300_000; // 5 minutes

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { config, context, agent, onLog, onMeta } = ctx;
  const model = (config.model as string) || DEFAULT_MODEL;
  const maxTokens = typeof config.maxTokens === "number" && config.maxTokens > 0
    ? config.maxTokens
    : 4096;

  try {
    const apiKey = await resolveApiKey(agent.companyId, "anthropic");
    const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS });

    const systemPrompt = buildSystemPrompt(context);
    const userMessage = buildUserMessage(context);

    if (onMeta) {
      await onMeta({
        adapterType: "claude_api",
        command: `anthropic.messages.create`,
        commandNotes: [`model: ${model}`, `timeout: ${TIMEOUT_MS}ms`],
      });
    }

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlocks = response.content.filter((b) => b.type === "text");
    const responseText = textBlocks.map((b) => b.text).join("\n");

    if (responseText) {
      await onLog("stdout", responseText);
    }

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const cachedInputTokens = (response.usage as any)?.cache_read_input_tokens ?? 0;
    const costUsd = estimateCostUsd("anthropic", model, inputTokens, outputTokens);

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: { inputTokens, outputTokens, cachedInputTokens },
      provider: "anthropic",
      model,
      billingType: "api",
      costUsd,
      summary: responseText
        ? `Generated ${responseText.length} chars (${response.stop_reason})`
        : "Model returned empty response",
    };
  } catch (error) {
    return mapErrorToResult(error, "anthropic");
  }
}
