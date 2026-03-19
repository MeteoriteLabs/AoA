import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Ensure zod resolves for workspace packages during tests
      zod: path.resolve(__dirname, "../node_modules/.pnpm/zod@3.25.76/node_modules/zod"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    globals: true,
    server: {
      deps: {
        inline: [/@paperclipai\//],
      },
    },
  },
});
