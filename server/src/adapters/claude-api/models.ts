import type { AdapterModel } from "../types.js";

export const CLAUDE_MODELS: AdapterModel[] = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export async function listClaudeModels(): Promise<AdapterModel[]> {
  return CLAUDE_MODELS;
}
