import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test-environment.js";
import { GEMINI_MODELS, listGeminiModels } from "./models.js";

export const geminiApiAdapter: ServerAdapterModule = {
  type: "gemini_api",
  execute,
  testEnvironment,
  models: GEMINI_MODELS,
  listModels: listGeminiModels,
  supportsLocalAgentJwt: false,
  agentConfigurationDoc: `# Gemini API Configuration

This adapter calls the Google Gemini API directly. No local CLI installation required.

## Setup
1. Go to **Settings > LLM Providers** and add your Google API key
2. Select a model (default: gemini-2.0-flash)

## Config
- **model** — Gemini model to use (e.g., gemini-2.0-flash, gemini-2.5-pro)
`,
};
