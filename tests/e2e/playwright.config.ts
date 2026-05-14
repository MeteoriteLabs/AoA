import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// Windows runner can't start embedded-postgres because GitHub's Windows
// runner is `runneradmin` (administrative) and PostgreSQL refuses to
// start as administrative. If DATABASE_URL is provided, AoA uses external
// Postgres instead, so Windows e2e can run normally.
// Linux + macOS coverage is unaffected.
const WINDOWS_WITH_EMBEDDED_POSTGRES =
  process.platform === "win32" && !process.env.DATABASE_URL?.trim();

// Use a dedicated port so e2e tests always start their own server in local_trusted mode,
// even when the dev server is running on :3100 in authenticated mode.
const PORT = Number(process.env.AOA_E2E_PORT ?? 3199);
const BASE_URL = `http://127.0.0.1:${PORT}`;
// Skip the temp-dir setup on unsupported Windows embedded-postgres runs so we
// don't pay setup cost when no tests will run.
const AOA_HOME = WINDOWS_WITH_EMBEDDED_POSTGRES
  ? ""
  : fs.mkdtempSync(path.join(os.tmpdir(), "aoa-e2e-home-"));

export default defineConfig({
  testDir: ".",
  testMatch: WINDOWS_WITH_EMBEDDED_POSTGRES
    ? "**/windows-embedded-postgres-skip.spec.ts"
    : "**/*.spec.ts",
  // Variant suites (multi-user auth) are deferred to Phase D.
  testIgnore: ["multi-user.spec.ts", "multi-user-authenticated.spec.ts"],
  timeout: 60_000,
  retries: 0,
  // Single worker: e2e specs share an embedded-postgres-backed instance
  // (one AOA_HOME per config run). Seed-and-cleanup helpers in helpers/
  // are not worker-safe; multiple workers race on /api/companies. Force
  // sequential execution until per-worker isolation lands.
  workers: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  // The webServer directive bootstraps a throwaway AoA instance.
  // `onboard --yes --run` works in a non-interactive temp AOA_HOME.
  // On Windows without DATABASE_URL: skip the WebServer entirely so
  // embedded-postgres never tries to start (it would fail because the runner
  // is `runneradmin`).
  webServer: WINDOWS_WITH_EMBEDDED_POSTGRES
    ? undefined
    : {
        command: `pnpm aoa onboard --yes --run`,
        url: `${BASE_URL}/api/health`,
        // Always boot a dedicated throwaway instance for e2e so browser tests
        // never attach to the developer's active AoA home/server.
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PORT: String(PORT),
          AOA_HOME,
          AOA_INSTANCE_ID: "playwright-e2e",
          AOA_BIND: "loopback",
          AOA_DEPLOYMENT_MODE: "local_trusted",
          AOA_DEPLOYMENT_EXPOSURE: "private",
          AOA_E2E_FAKE_AWS_SECRETS_MANAGER: "1",
        },
      },
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
});
