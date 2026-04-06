// ui/src/components/workspace/adapter-utils.tsx
import { Sparkles, Brain, Gem, Terminal, Globe, Monitor, Bot } from "lucide-react";
import type { ComponentType } from "react";

type IconComponent = ComponentType<{ className?: string }>;

const ADAPTER_ICONS: Record<string, { icon: IconComponent; color: string; label: string }> = {
  claude_api: { icon: Sparkles, color: "text-purple-500", label: "Claude" },
  claude_local: { icon: Sparkles, color: "text-purple-500", label: "Claude" },
  openai_api: { icon: Brain, color: "text-green-500", label: "OpenAI" },
  gemini_api: { icon: Gem, color: "text-blue-500", label: "Gemini" },
  gemini_local: { icon: Gem, color: "text-blue-500", label: "Gemini" },
  opencode_local: { icon: Terminal, color: "text-gray-400", label: "OpenCode" },
  codex_local: { icon: Brain, color: "text-green-500", label: "Codex" },
  cursor: { icon: Monitor, color: "text-gray-400", label: "Cursor" },
  hermes_local: { icon: Terminal, color: "text-gray-400", label: "Hermes" },
  http: { icon: Globe, color: "text-gray-400", label: "HTTP" },
  process: { icon: Terminal, color: "text-gray-400", label: "Process" },
  openclaw: { icon: Bot, color: "text-gray-400", label: "OpenClaw" },
};

const API_ADAPTERS = new Set(["claude_api", "openai_api", "gemini_api"]);

export function getAdapterInfo(adapterType: string) {
  return ADAPTER_ICONS[adapterType] ?? { icon: Bot, color: "text-gray-400", label: adapterType };
}

export function isApiAdapter(adapterType: string): boolean {
  return API_ADAPTERS.has(adapterType);
}

/** Extract short model display name from full model ID. e.g. "claude-sonnet-4-20250514" → "Sonnet" */
export function shortModelName(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes("opus")) return "Opus";
  if (lower.includes("sonnet")) return "Sonnet";
  if (lower.includes("haiku")) return "Haiku";
  if (lower.includes("gpt-4o-mini")) return "GPT-4o Mini";
  if (lower.includes("gpt-4o")) return "GPT-4o";
  if (lower.includes("gpt-4")) return "GPT-4";
  if (lower.includes("o1-mini")) return "o1 Mini";
  if (lower.includes("o1")) return "o1";
  if (lower.includes("o3-mini")) return "o3 Mini";
  if (lower.includes("o3")) return "o3";
  if (lower.includes("2.5-pro")) return "2.5 Pro";
  if (lower.includes("2.5-flash")) return "2.5 Flash";
  if (lower.includes("2.0-flash")) return "2.0 Flash";
  // Fallback: return last segment or full ID
  const parts = modelId.split(/[-/]/);
  return parts[parts.length - 1] ?? modelId;
}
