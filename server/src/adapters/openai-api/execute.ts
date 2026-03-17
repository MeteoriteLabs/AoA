import OpenAI from "openai";
import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";
import {
  buildSystemPrompt,
  buildUserMessage,
  resolveApiKey,
  estimateCostUsd,
  mapErrorToResult,
} from "../api-common.js";
import { DEFAULT_MODEL } from "./models.js";

const TIMEOUT_MS = 300_000;

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { config, context, agent, onLog, onMeta } = ctx;
  const model = (config.model as string) || DEFAULT_MODEL;
  const maxTokens = typeof config.maxTokens === "number" && config.maxTokens > 0
    ? config.maxTokens
    : undefined;

  try {
    const apiKey = await resolveApiKey(agent.companyId, "openai");
    const client = new OpenAI({ apiKey, timeout: TIMEOUT_MS });

    const systemPrompt = buildSystemPrompt(context);
    const userMessage = buildUserMessage(context);

    if (onMeta) {
      await onMeta({
        adapterType: "openai_api",
        command: "openai.chat.completions.create",
        commandNotes: [`model: ${model}`, `timeout: ${TIMEOUT_MS}ms`],
      });
    }

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      ...(maxTokens !== undefined && { max_tokens: maxTokens }),
    });

    const responseText = response.choices?.[0]?.message?.content ?? "";
    const finishReason = response.choices?.[0]?.finish_reason ?? "unknown";

    if (responseText) {
      await onLog("stdout", responseText);
    }

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    const cachedInputTokens =
      (response.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0;
    const costUsd = estimateCostUsd("openai", model, inputTokens, outputTokens);

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: { inputTokens, outputTokens, cachedInputTokens },
      provider: "openai",
      model,
      billingType: "api",
      costUsd,
      summary: responseText
        ? `Generated ${responseText.length} chars (${finishReason})`
        : "Model returned empty response",
    };
  } catch (error) {
    return mapErrorToResult(error, "openai");
  }
}
