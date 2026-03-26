import type { Db } from "@paperclipai/db";
import { secretService } from "../../secrets.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

export type { LLMProvider, ChatParams, ChatStreamChunk, ProviderToolDef, ChatMessage } from "./types.js";

/** Secret name convention per provider */
const PROVIDER_SECRET_NAMES: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_AI_API_KEY",
};

/** Env var fallback per provider */
const PROVIDER_ENV_KEYS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_AI_API_KEY",
};

/**
 * Resolve an API key for a provider.
 *
 * Checks company_secrets first (encrypted, versioned), then falls back
 * to environment variables for backward compatibility during transition.
 */
export async function getProviderApiKey(
  db: Db,
  companyId: string,
  provider: string,
): Promise<string> {
  const secretName = PROVIDER_SECRET_NAMES[provider];
  if (secretName) {
    const svc = secretService(db);
    const secret = await svc.getByName(companyId, secretName);
    if (secret) {
      return svc.resolveSecretValue(companyId, secret.id, "latest");
    }
  }

  // Fallback to env var
  const envKey = PROVIDER_ENV_KEYS[provider] ?? `${provider.toUpperCase()}_API_KEY`;
  return process.env[envKey] ?? "";
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
