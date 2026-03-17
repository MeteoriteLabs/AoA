import { GoogleGenerativeAI } from "@google/generative-ai";
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
  const modelId = (config.model as string) || DEFAULT_MODEL;
  const maxOutputTokens = typeof config.maxTokens === "number" && config.maxTokens > 0
    ? config.maxTokens
    : undefined;

  try {
    const apiKey = await resolveApiKey(agent.companyId, "google");
    const genAI = new GoogleGenerativeAI(apiKey);

    const systemPrompt = buildSystemPrompt(context);
    const userMessage = buildUserMessage(context);

    if (onMeta) {
      await onMeta({
        adapterType: "gemini_api",
        command: "gemini.generateContent",
        commandNotes: [`model: ${modelId}`, `timeout: ${TIMEOUT_MS}ms`],
      });
    }

    const model = genAI.getGenerativeModel({
      model: modelId,
      systemInstruction: systemPrompt,
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: {
        ...(maxOutputTokens !== undefined && { maxOutputTokens }),
      },
    });

    const response = result.response;
    const responseText = response.text();
    const finishReason = response.candidates?.[0]?.finishReason ?? "unknown";

    // Check for safety blocks
    if (finishReason === "SAFETY") {
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: "Response blocked by Gemini safety filters. Try rephrasing the task.",
        errorCode: "safety_block",
        provider: "google",
        model: modelId,
      };
    }

    if (responseText) {
      await onLog("stdout", responseText);
    }

    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;
    const cachedInputTokens = (usage as any)?.cachedContentTokenCount ?? 0;
    const costUsd = estimateCostUsd("google", modelId, inputTokens, outputTokens);

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      usage: { inputTokens, outputTokens, cachedInputTokens },
      provider: "google",
      model: modelId,
      billingType: "api",
      costUsd,
      summary: responseText
        ? `Generated ${responseText.length} chars (${finishReason})`
        : "Model returned empty response",
    };
  } catch (error) {
    return mapErrorToResult(error, "google");
  }
}
