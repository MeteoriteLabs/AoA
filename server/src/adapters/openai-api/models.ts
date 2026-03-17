import type { AdapterModel } from "../types.js";

export const OPENAI_MODELS: AdapterModel[] = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "o3", label: "o3" },
  { id: "o4-mini", label: "o4 Mini" },
];

export const DEFAULT_MODEL = "gpt-4o";

export async function listOpenAIModels(): Promise<AdapterModel[]> {
  return OPENAI_MODELS;
}
