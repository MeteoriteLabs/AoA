import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test-environment.js";
import { CLAUDE_MODELS, listClaudeModels } from "./models.js";

export const claudeApiAdapter: ServerAdapterModule = {
  type: "claude_api",
  execute,
  testEnvironment,
  models: CLAUDE_MODELS,
  listModels: listClaudeModels,
  supportsLocalAgentJwt: false,
  agentConfigurationDoc: `# Claude API Configuration

This adapter calls the Anthropic Claude API directly. No local CLI installation required.

## Setup
1. Go to **Settings > LLM Providers** and add your Anthropic API key
2. Select a model (default: claude-sonnet-4-6)

## Config
- **model** — Claude model to use (e.g., claude-sonnet-4-6, claude-haiku-4-5-20251001)
`,
};
