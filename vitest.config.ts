import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    hookTimeout: 30_000,
    pool: "forks",
    projects: ["packages/adapter-utils", "packages/shared", "packages/db", "packages/adapters/opencode-local", "packages/adapters/gemini-local", "packages/adapters/codex-local", "packages/adapters/claude-local", "packages/adapters/grok-local", "packages/adapters/pi-local", "packages/adapters/acpx-local", "packages/adapters/cursor-local", "packages/adapters/cursor-cloud", "packages/adapters/openclaw", "packages/adapters/openclaw-gateway", "server", "ui", "cli"],
    setupFiles: ["server/src/__tests__/test-setup.ts"],
    testTimeout: 30_000,
  },
});
