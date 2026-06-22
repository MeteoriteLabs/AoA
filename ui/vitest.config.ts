import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Ensure zod resolves for workspace packages during tests
      zod: path.dirname(require.resolve("zod/package.json")),
    },
  },
  test: {
    environment: "jsdom",
    hookTimeout: 30_000,
    setupFiles: ["./src/__tests__/setup.ts"],
    globals: true,
    testTimeout: 30_000,
    server: {
      deps: {
        inline: [/@armyofagents\//],
      },
    },
  },
});
