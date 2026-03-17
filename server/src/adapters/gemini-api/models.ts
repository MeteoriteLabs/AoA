import type { AdapterModel } from "../types.js";

export const GEMINI_MODELS: AdapterModel[] = [
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
];

export const DEFAULT_MODEL = "gemini-2.0-flash";

export async function listGeminiModels(): Promise<AdapterModel[]> {
  return GEMINI_MODELS;
}
