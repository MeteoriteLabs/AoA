import type { Db } from "@paperclipai/db";
import { secretService } from "../../secrets.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

export type { LLMProvider, ChatParams, ChatStreamChunk, ProviderToolDef, ChatMessage } from "./types.js";

/** Secret name / env var key per provider (same convention for both) */
const PROVIDER_KEY_NAMES: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_AI_API_KEY",
};

/**
 * Resolve an API key for a provider.
 *
 * Checks company_secrets first (encrypted, versioned), then falls back
 * to environment variables for backward compatibility during transition.
 * Throws if no key is found anywhere.
 */
export async function getProviderApiKey(
  db: Db,
  companyId: string,
  provider: string,
): Promise<string> {
  const keyName = PROVIDER_KEY_NAMES[provider];

  // Try company_secrets first (uses resolveByName which does getByName + resolveSecretValue)
  if (keyName) {
    try {
      return await secretService(db).resolveByName(companyId, keyName);
    } catch {
      // Secret not found — fall through to env var
    }
  }

  // Fallback to env var
  const envKey = keyName ?? `${provider.toUpperCase()}_API_KEY`;
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
