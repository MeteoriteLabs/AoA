import type { Db } from "@armyofagents/db";
import { secretService } from "../../secrets.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

export type { LLMProvider, ChatParams, ChatStreamChunk, ProviderToolDef, ChatMessage } from "./types.js";

/** Env var key per provider */
const PROVIDER_ENV_KEYS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_AI_API_KEY",
};

/** Secret names used by the UI's LLM Providers settings */
const PROVIDER_SECRET_NAMES: Record<string, string[]> = {
  anthropic: ["llm:anthropic", "ANTHROPIC_API_KEY"],
  openai: ["llm:openai", "OPENAI_API_KEY"],
  google: ["llm:google", "GOOGLE_AI_API_KEY"],
};

/**
 * Resolve an API key for a provider.
 *
 * Checks company_secrets first (both "llm:" prefixed names from the UI and
 * legacy env-style names), then falls back to environment variables.
 * Throws if no key is found anywhere.
 */
export async function getProviderApiKey(
  db: Db,
  companyId: string,
  provider: string,
): Promise<string> {
  const secretNames = PROVIDER_SECRET_NAMES[provider] ?? [];

  // Try company_secrets first — check all known secret name variants
  const svc = secretService(db);
  for (const name of secretNames) {
    try {
      return await svc.resolveByName(companyId, name, {
        consumerType: "system",
        consumerId: `llm-provider:${provider}`,
        actorType: "system",
        configPath: `provider.${provider}`,
      });
    } catch {
      // Secret not found under this name — try next
    }
  }

  // Fallback to env var
  const envKey = PROVIDER_ENV_KEYS[provider] ?? `${provider.toUpperCase()}_API_KEY`;
  const envValue = process.env[envKey];
  if (!envValue) {
    throw new Error(
      `No API key configured for provider "${provider}". ` +
      `Set it in Settings → LLM Providers or as the ${envKey} environment variable.`,
    );
  }
  return envValue;
}

/** Create an LLMProvider instance for the given provider name and API key */
export function createProvider(provider: string, apiKey: string): LLMProvider {
  switch (provider) {
    case "anthropic":
      return createAnthropicProvider(apiKey);
    case "openai":
      return createOpenAIProvider(apiKey);
    case "google":
      return createGeminiProvider(apiKey);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
