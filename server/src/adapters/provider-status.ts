export type ProviderAuthMode = "subscription" | "chatgpt" | "apikey" | "unknown";

export interface ProviderStatus {
  adapterType: string;
  installed: boolean;
  authenticated: boolean;
  authMode: ProviderAuthMode;
  defaultModelResolved: string | null;
  detail?: string;
}

interface CodexAuthInputs {
  agentEnvApiKey: string | null;   // ONLY adapterConfig.env.OPENAI_API_KEY (per-agent, opt-in)
  authJson: Record<string, unknown> | null; // managed CODEX_HOME/auth.json contents
  serverEnvApiKey?: string | null; // accepted but DELIBERATELY ignored (company key guard)
}

export function parseCodexAuthMode(inputs: CodexAuthInputs): ProviderAuthMode {
  // Per-agent opt-in key wins (the adapter writes an api-key auth.json for it).
  if (inputs.agentEnvApiKey && inputs.agentEnvApiKey.trim().length > 0) return "apikey";
  const j = inputs.authJson;
  if (!j) return "unknown";
  if (typeof (j as { auth_mode?: unknown }).auth_mode === "string") {
    return ((j as { auth_mode: string }).auth_mode === "apikey") ? "apikey" : "chatgpt";
  }
  if (typeof (j as { OPENAI_API_KEY?: unknown }).OPENAI_API_KEY === "string") return "apikey";
  // serverEnvApiKey intentionally unused — company-level key must never influence auth mode.
  return "unknown";
}
