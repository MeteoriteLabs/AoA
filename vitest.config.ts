import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/adapter-utils", "packages/shared", "packages/db", "packages/adapters/opencode-local", "packages/adapters/gemini-local", "packages/adapters/codex-local", "packages/adapters/claude-local", "server", "ui", "cli"],
  },
});
