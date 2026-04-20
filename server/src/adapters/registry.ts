import type { ServerAdapterModule } from "./types.js";
import {
  execute as claudeExecute,
  testEnvironment as claudeTestEnvironment,
  sessionCodec as claudeSessionCodec,
} from "@paperclipai/adapter-claude-local/server";
import { agentConfigurationDoc as claudeAgentConfigurationDoc, models as claudeModels } from "@paperclipai/adapter-claude-local";
import {
  execute as codexExecute,
  testEnvironment as codexTestEnvironment,
  sessionCodec as codexSessionCodec,
} from "@paperclipai/adapter-codex-local/server";
import { agentConfigurationDoc as codexAgentConfigurationDoc, models as codexModels } from "@paperclipai/adapter-codex-local";
import {
  execute as cursorExecute,
  testEnvironment as cursorTestEnvironment,
  sessionCodec as cursorSessionCodec,
} from "@paperclipai/adapter-cursor-local/server";
import { agentConfigurationDoc as cursorAgentConfigurationDoc, models as cursorModels } from "@paperclipai/adapter-cursor-local";
import {
  execute as openCodeExecute,
  testEnvironment as openCodeTestEnvironment,
  sessionCodec as openCodeSessionCodec,
  listOpenCodeModels,
} from "@paperclipai/adapter-opencode-local/server";
import {
  agentConfigurationDoc as openCodeAgentConfigurationDoc,
} from "@paperclipai/adapter-opencode-local";
import {
  execute as openclawExecute,
  testEnvironment as openclawTestEnvironment,
  onHireApproved as openclawOnHireApproved,
} from "@paperclipai/adapter-openclaw/server";
import {
  agentConfigurationDoc as openclawAgentConfigurationDoc,
  models as openclawModels,
} from "@paperclipai/adapter-openclaw";
import { listCodexModels } from "./codex-models.js";
import { listCursorModels } from "./cursor-models.js";
import {
  execute as geminiExecute,
  testEnvironment as geminiTestEnvironment,
  sessionCodec as geminiSessionCodec,
} from "@paperclipai/adapter-gemini-local/server";
import { agentConfigurationDoc as geminiAgentConfigurationDoc, models as geminiModels } from "@paperclipai/adapter-gemini-local";
import {
  execute as hermesExecute,
  testEnvironment as hermesTestEnvironment,
  sessionCodec as hermesSessionCodec,
} from "hermes-paperclip-adapter/server";
import {
  agentConfigurationDoc as hermesAgentConfigurationDoc,
  models as hermesModels,
} from "hermes-paperclip-adapter";
import { processAdapter } from "./process/index.js";
import { httpAdapter } from "./http/index.js";
import { claudeApiAdapter } from "./claude-api/index.js";
import { openaiApiAdapter } from "./openai-api/index.js";
import { geminiApiAdapter } from "./gemini-api/index.js";
import { BUILTIN_ADAPTER_TYPES } from "./builtin-adapter-types.js";
import { getDisabledAdapterTypes, isAdapterDisabled } from "../services/adapter-plugin-store.js";

const claudeLocalAdapter: ServerAdapterModule = {
  type: "claude_local",
  execute: claudeExecute,
  testEnvironment: claudeTestEnvironment,
  sessionCodec: claudeSessionCodec,
  models: claudeModels,
  supportsLocalAgentJwt: true,
  agentConfigurationDoc: claudeAgentConfigurationDoc,
};

const codexLocalAdapter: ServerAdapterModule = {
  type: "codex_local",
  execute: codexExecute,
  testEnvironment: codexTestEnvironment,
  sessionCodec: codexSessionCodec,
  models: codexModels,
  listModels: listCodexModels,
  supportsLocalAgentJwt: true,
  agentConfigurationDoc: codexAgentConfigurationDoc,
};

const cursorLocalAdapter: ServerAdapterModule = {
  type: "cursor",
  execute: cursorExecute,
  testEnvironment: cursorTestEnvironment,
  sessionCodec: cursorSessionCodec,
  models: cursorModels,
  listModels: listCursorModels,
  supportsLocalAgentJwt: true,
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
  sessionCodec: openCodeSessionCodec,
  models: [],
  listModels: listOpenCodeModels,
  supportsLocalAgentJwt: true,
  agentConfigurationDoc: openCodeAgentConfigurationDoc,
};

const geminiLocalAdapter: ServerAdapterModule = {
  type: "gemini_local",
  execute: geminiExecute,
  testEnvironment: geminiTestEnvironment,
  sessionCodec: geminiSessionCodec,
  models: geminiModels,
  supportsLocalAgentJwt: true,
  agentConfigurationDoc: geminiAgentConfigurationDoc,
};

const hermesLocalAdapter: ServerAdapterModule = {
  type: "hermes_local",
  execute: hermesExecute,
  testEnvironment: hermesTestEnvironment,
  sessionCodec: hermesSessionCodec,
  models: hermesModels,
  supportsLocalAgentJwt: true,
  agentConfigurationDoc: hermesAgentConfigurationDoc,
};

const adaptersByType = new Map<string, ServerAdapterModule>(
  [claudeLocalAdapter, codexLocalAdapter, openCodeLocalAdapter, cursorLocalAdapter, openclawAdapter, geminiLocalAdapter, hermesLocalAdapter, processAdapter, httpAdapter, claudeApiAdapter, openaiApiAdapter, geminiApiAdapter].map((a) => [a.type, a]),
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
 * true if the state changed.
 */
export function setOverridePaused(type: string, paused: boolean): boolean {
  if (!BUILTIN_ADAPTER_TYPES.has(type)) return false;
  if (paused) {
    if (pausedOverrides.has(type)) return false;
    pausedOverrides.add(type);
    return true;
  }
  return pausedOverrides.delete(type);
}

// Surface disabled-state check so the route doesn't have to import the store
// directly — registry becomes the single source of truth for "is this adapter
// usable right now?".
export { isAdapterDisabled as isServerAdapterDisabled };
