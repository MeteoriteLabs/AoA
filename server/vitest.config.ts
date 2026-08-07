import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 30_000,
    pool: "forks",
    setupFiles: ["src/__tests__/test-setup.ts"],
    testTimeout: 30_000,
  },
});
