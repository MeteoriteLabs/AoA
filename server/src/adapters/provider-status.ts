import { readEnvBindingValue } from "@armyofagents/shared";

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

export interface ProviderStatusDeps {
  resolveManagedCodexHomeDir: (env: NodeJS.ProcessEnv, companyId: string) => string;
  readAuthJson: (homeDir: string) => Promise<Record<string, unknown> | null>;
  readSharedCodexModel: () => Promise<string | null>;
  isInstalled: (adapterType: string) => Promise<boolean>;
}

export async function getProviderStatus(
  adapterType: string,
  ctx: { companyId: string; adapterConfig: Record<string, unknown> },
  deps: ProviderStatusDeps,
): Promise<ProviderStatus> {
  if (adapterType === "codex_local") {
    const env = (ctx.adapterConfig.env ?? {}) as Record<string, unknown>;
    // Codex P2: env entries are normalized to binding objects on save, so a raw
    // string check misses a UI-configured per-agent key. readEnvBindingValue is
    // binding-aware (string / {type:"plain"} / {type:"secret_ref"}).
    const agentEnvApiKey = readEnvBindingValue(env.OPENAI_API_KEY);
    const home = deps.resolveManagedCodexHomeDir(process.env, ctx.companyId);
    const authJson = await deps.readAuthJson(home);
    const authMode = parseCodexAuthMode({ agentEnvApiKey, authJson });
    const installed = await deps.isInstalled(adapterType);
    return {
      adapterType, installed,
      authenticated: authMode !== "unknown",
      authMode,
      defaultModelResolved: await deps.readSharedCodexModel(),
    };
  }
  // claude/gemini/opencode: best-effort installed/authenticated, authMode "unknown" acceptable (Phase 1).
  const installed = await deps.isInstalled(adapterType);
  return { adapterType, installed, authenticated: installed, authMode: "unknown", defaultModelResolved: null };
}
