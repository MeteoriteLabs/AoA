import type { ServerAdapterModule } from "./types.js";
import {
  execute as claudeExecute,
  listClaudeSkills,
  syncClaudeSkills,
  testEnvironment as claudeTestEnvironment,
  sessionCodec as claudeSessionCodec,
} from "@armyofagents/adapter-claude-local/server";
import { agentConfigurationDoc as claudeAgentConfigurationDoc, models as claudeModels } from "@armyofagents/adapter-claude-local";
import {
  execute as codexExecute,
  listCodexSkills,
  syncCodexSkills,
  testEnvironment as codexTestEnvironment,
  sessionCodec as codexSessionCodec,
} from "@armyofagents/adapter-codex-local/server";
import { agentConfigurationDoc as codexAgentConfigurationDoc, models as codexModels } from "@armyofagents/adapter-codex-local";
import {
  execute as cursorExecute,
  listCursorSkills,
  syncCursorSkills,
  testEnvironment as cursorTestEnvironment,
  sessionCodec as cursorSessionCodec,
} from "@armyofagents/adapter-cursor-local/server";
import { agentConfigurationDoc as cursorAgentConfigurationDoc, models as cursorModels } from "@armyofagents/adapter-cursor-local";
import {
  execute as openCodeExecute,
  listOpenCodeSkills,
  syncOpenCodeSkills,
  testEnvironment as openCodeTestEnvironment,
  sessionCodec as openCodeSessionCodec,
  listOpenCodeModels,
} from "@armyofagents/adapter-opencode-local/server";
import {
  agentConfigurationDoc as openCodeAgentConfigurationDoc,
} from "@armyofagents/adapter-opencode-local";
import {
  execute as openclawExecute,
  testEnvironment as openclawTestEnvironment,
  onHireApproved as openclawOnHireApproved,
} from "@armyofagents/adapter-openclaw/server";
import {
  agentConfigurationDoc as openclawAgentConfigurationDoc,
  models as openclawModels,
} from "@armyofagents/adapter-openclaw";
import { listCodexModels } from "./codex-models.js";
import { listCursorModels } from "./cursor-models.js";
import {
  execute as geminiExecute,
  listGeminiSkills,
  syncGeminiSkills,
  testEnvironment as geminiTestEnvironment,
  sessionCodec as geminiSessionCodec,
} from "@armyofagents/adapter-gemini-local/server";
import { agentConfigurationDoc as geminiAgentConfigurationDoc, models as geminiModels } from "@armyofagents/adapter-gemini-local";
import {
  execute as hermesExecute,
  testEnvironment as hermesTestEnvironment,
  sessionCodec as hermesSessionCodec,
} from "hermes-paperclip-adapter/server";
import {
  agentConfigurationDoc as hermesAgentConfigurationDoc,
  models as hermesModels,
} from "hermes-paperclip-adapter";
import {
  parseObject,
  asString,
} from "@armyofagents/adapter-utils/server-utils";
import { processAdapter } from "./process/index.js";
import { httpAdapter } from "./http/index.js";
import { BUILTIN_ADAPTER_TYPES } from "./builtin-adapter-types.js";
import { getDisabledAdapterTypes, isAdapterDisabled } from "../services/adapter-plugin-store.js";

const claudeLocalAdapter: ServerAdapterModule = {
  type: "claude_local",
  execute: claudeExecute,
  testEnvironment: claudeTestEnvironment,
  listSkills: listClaudeSkills,
  syncSkills: syncClaudeSkills,
  sessionCodec: claudeSessionCodec,
  models: claudeModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: claudeAgentConfigurationDoc,
};

const codexLocalAdapter: ServerAdapterModule = {
  type: "codex_local",
  execute: codexExecute,
  testEnvironment: codexTestEnvironment,
  listSkills: listCodexSkills,
  syncSkills: syncCodexSkills,
  sessionCodec: codexSessionCodec,
  models: codexModels,
  listModels: listCodexModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: codexAgentConfigurationDoc,
};

const cursorLocalAdapter: ServerAdapterModule = {
  type: "cursor",
  execute: cursorExecute,
  testEnvironment: cursorTestEnvironment,
  listSkills: listCursorSkills,
  syncSkills: syncCursorSkills,
  sessionCodec: cursorSessionCodec,
  models: cursorModels,
  listModels: listCursorModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  agentConfigurationDoc: cursorAgentConfigurationDoc,
};

const openclawAdapter: ServerAdapterModule = {
  type: "openclaw",
  execute: openclawExecute,
  testEnvironment: openclawTestEnvironment,
  onHireApproved: openclawOnHireApproved,
  models: openclawModels,
  supportsLocalAgentJwt: false,
  agentConfigurationDoc: openclawAgentConfigurationDoc,
};

const openCodeLocalAdapter: ServerAdapterModule = {
  type: "opencode_local",
  execute: openCodeExecute,
  testEnvironment: openCodeTestEnvironment,
  listSkills: listOpenCodeSkills,
  syncSkills: syncOpenCodeSkills,
  sessionCodec: openCodeSessionCodec,
  models: [],
  listModels: listOpenCodeModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  agentConfigurationDoc: openCodeAgentConfigurationDoc,
};

const geminiLocalAdapter: ServerAdapterModule = {
  type: "gemini_local",
  execute: geminiExecute,
  testEnvironment: geminiTestEnvironment,
  listSkills: listGeminiSkills,
  syncSkills: syncGeminiSkills,
  sessionCodec: geminiSessionCodec,
  models: geminiModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: true,
  agentConfigurationDoc: geminiAgentConfigurationDoc,
};

const hermesLocalAdapter: ServerAdapterModule = {
  type: "hermes_local",
  execute: async (ctx) => {
    // Hermes reads its config from ctx.agent.adapterConfig — build a patched
    // agent object so env injection flows through to the child process.
    // Spread to avoid mutating the original adapterConfig object.
    const agentConfig = { ...parseObject(ctx.agent?.adapterConfig) } as Record<string, unknown>;
    const env = parseObject(agentConfig.env) as Record<string, string>;

    // Always inject PAPERCLIP_RUN_ID.
    // PAPERCLIP_API_KEY and PAPERCLIP_RUN_ID are wire-protocol contracts with
    // hermes-paperclip-adapter — do NOT rename these to AOA_*.
    const nextEnv: Record<string, string> = { ...env, PAPERCLIP_RUN_ID: ctx.runId };

    // Inject PAPERCLIP_API_KEY from agent JWT only when not explicitly
    // configured — an explicit key takes precedence over the JWT.
    const explicitApiKey = asString(env.PAPERCLIP_API_KEY, "").trim();
    if (!explicitApiKey && ctx.authToken) {
      nextEnv.PAPERCLIP_API_KEY = ctx.authToken;
    }
    agentConfig.env = nextEnv;

    // Honor hermesCommand override (preferred); fall back to legacy "command"
    // field for back-compat with agents saved before this rename.
    const hermesCommand = asString(
      agentConfig.hermesCommand ?? agentConfig.command,
      "hermes",
    );
    agentConfig.hermesCommand = hermesCommand;

    const patchedAgent = { ...ctx.agent, adapterConfig: agentConfig };
    return hermesExecute({ ...ctx, agent: patchedAgent });
  },
  testEnvironment: hermesTestEnvironment,
  sessionCodec: hermesSessionCodec,
  models: hermesModels,
  supportsLocalAgentJwt: true,
  agentConfigurationDoc: hermesAgentConfigurationDoc,
};

const adaptersByType = new Map<string, ServerAdapterModule>(
  [claudeLocalAdapter, codexLocalAdapter, openCodeLocalAdapter, cursorLocalAdapter, openclawAdapter, geminiLocalAdapter, hermesLocalAdapter, processAdapter, httpAdapter].map((a) => [a.type, a]),
);

// Builtin adapters that have been replaced by an external adapter of the same
// type are stashed here so they can be restored when the override is paused or
// removed.
const builtinFallbacks = new Map<string, ServerAdapterModule>();

// Tracks which override types are currently paused. When paused,
// findActiveServerAdapter() returns the builtin fallback instead of the
// external adapter.
const pausedOverrides = new Set<string>();

export function getServerAdapter(type: string): ServerAdapterModule {
  const adapter = adaptersByType.get(type);
  if (!adapter) {
    // Fall back to process adapter for unknown types
    return processAdapter;
  }
  return adapter;
}

export async function listAdapterModels(type: string): Promise<{ id: string; label: string }[]> {
  const adapter = adaptersByType.get(type);
  if (!adapter) return [];
  if (adapter.listModels) {
    const discovered = await adapter.listModels();
    if (discovered.length > 0) return discovered;
  }
  return adapter.models ?? [];
}

export function listServerAdapters(): ServerAdapterModule[] {
  return Array.from(adaptersByType.values());
}

export function findServerAdapter(type: string): ServerAdapterModule | null {
  return adaptersByType.get(type) ?? null;
}

/**
 * Like findServerAdapter but respects paused overrides — if an external
 * adapter's override is currently paused, returns the original builtin.
 */
export function findActiveServerAdapter(type: string): ServerAdapterModule | null {
  if (pausedOverrides.has(type)) {
    return builtinFallbacks.get(type) ?? null;
  }
  return adaptersByType.get(type) ?? null;
}

/**
 * List adapters that are not currently disabled in the plugin store. Used for
 * agent-creation menus that should hide disabled adapters.
 */
export function listEnabledServerAdapters(): ServerAdapterModule[] {
  const disabled = new Set(getDisabledAdapterTypes());
  return listServerAdapters().filter((a) => !disabled.has(a.type));
}

/**
 * Register a (possibly external) adapter at runtime. If the adapter type
 * matches a builtin, the existing builtin is stashed in builtinFallbacks so
 * it can be restored when the override is paused or the external adapter is
 * unregistered.
 */
export function registerServerAdapter(adapter: ServerAdapterModule): void {
  if (BUILTIN_ADAPTER_TYPES.has(adapter.type) && !builtinFallbacks.has(adapter.type)) {
    const existing = adaptersByType.get(adapter.type);
    if (existing) {
      builtinFallbacks.set(adapter.type, existing);
    }
  }
  adaptersByType.set(adapter.type, adapter);
}

/**
 * Unregister an adapter. If it was overriding a builtin, the builtin is
 * restored. process and http adapters cannot be unregistered. Pure builtins
 * (no override) are also left in place.
 */
export function unregisterServerAdapter(type: string): void {
  if (type === processAdapter.type || type === httpAdapter.type) return;
  if (builtinFallbacks.has(type)) {
    pausedOverrides.delete(type);
    const fallback = builtinFallbacks.get(type);
    if (fallback) {
      adaptersByType.set(type, fallback);
    }
    builtinFallbacks.delete(type);
    return;
  }
  if (BUILTIN_ADAPTER_TYPES.has(type)) {
    return;
  }
  adaptersByType.delete(type);
}

export function isOverridePaused(type: string): boolean {
  return pausedOverrides.has(type);
}

/**
 * Pause or resume an external adapter's override of a builtin type. Returns
 * true if the state changed. No-op (returns false) when the type has no
 * active external override — there's nothing to pause.
 */
export function setOverridePaused(type: string, paused: boolean): boolean {
  if (!builtinFallbacks.has(type)) return false;
  const wasPaused = pausedOverrides.has(type);
  if (paused && !wasPaused) {
    pausedOverrides.add(type);
    return true;
  }
  if (!paused && wasPaused) {
    pausedOverrides.delete(type);
    return true;
  }
  return false;
}

// Surface disabled-state check so the route doesn't have to import the store
// directly — registry becomes the single source of truth for "is this adapter
// usable right now?".
export { isAdapterDisabled as isServerAdapterDisabled };
