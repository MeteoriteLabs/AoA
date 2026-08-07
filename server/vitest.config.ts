import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    dangerouslyIgnoreUnhandledErrors: true,
    environment: "node",
    execArgv: ["--unhandled-rejections=warn"],
    hookTimeout: 30_000,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    setupFiles: ["src/__tests__/test-setup.ts"],
    testTimeout: 30_000,
  },
});
