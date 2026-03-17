import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test-environment.js";
import { OPENAI_MODELS, listOpenAIModels } from "./models.js";

export const openaiApiAdapter: ServerAdapterModule = {
  type: "openai_api",
  execute,
  testEnvironment,
  models: OPENAI_MODELS,
  listModels: listOpenAIModels,
  supportsLocalAgentJwt: false,
  agentConfigurationDoc: `# OpenAI API Configuration

This adapter calls the OpenAI API directly. No local CLI installation required.

## Setup
1. Go to **Settings > LLM Providers** and add your OpenAI API key
2. Select a model (default: gpt-4o)

## Config
- **model** — OpenAI model to use (e.g., gpt-4o, gpt-4o-mini, o3, o4-mini)
`,
};
