import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    execArgv: ["--unhandled-rejections=warn"],
    hookTimeout: 30_000,
    setupFiles: ["src/__tests__/test-setup.ts"],
    testTimeout: 30_000,
  },
});
