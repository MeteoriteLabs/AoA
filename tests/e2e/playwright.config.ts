import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { FAKE_CLAUDE_CONTROL_PATH, FAKE_CLAUDE_INVOCATIONS_PATH } from "./helpers/fake-claude";
import { FAKE_CODEX_CONTROL_PATH, FAKE_CODEX_INVOCATIONS_PATH } from "./helpers/fake-codex";
import { FAKE_EMBEDDER_CONTROL_PATH } from "./helpers/fake-embedder";

// Windows runner can't start embedded-postgres because GitHub's Windows
// runner is `runneradmin` (administrative) and PostgreSQL refuses to
// start as administrative. If DATABASE_URL is provided, AoA uses external
// Postgres instead, so Windows e2e can run normally.
// Linux + macOS coverage is unaffected.
//
// Escape hatch: on a real (non-runneradmin) Windows dev machine, embedded
// postgres starts fine. Set AOA_E2E_FORCE_WINDOWS=1 to run the full e2e suite
// locally on Windows with embedded postgres despite the CI-runner limitation
// (Issue #114). CI leaves this unset, so the runner still skips as before.
const WINDOWS_WITH_EMBEDDED_POSTGRES =
  process.platform === "win32" &&
  !process.env.DATABASE_URL?.trim() &&
  process.env.AOA_E2E_FORCE_WINDOWS !== "1";

// Use a dedicated port so e2e tests always start their own server in local_trusted mode,
// even when the dev server is running on :3100 in authenticated mode.
const PORT = Number(process.env.AOA_E2E_PORT ?? 3199);
const BASE_URL = `http://127.0.0.1:${PORT}`;
// Skip the temp-dir setup on unsupported Windows embedded-postgres runs so we
// don't pay setup cost when no tests will run.
const AOA_HOME = WINDOWS_WITH_EMBEDDED_POSTGRES
  ? ""
  : fs.mkdtempSync(path.join(os.tmpdir(), "aoa-e2e-home-"));

// Commander viewer e2e (commander-viewer.spec.ts): resolve `claude` to the
// deterministic fake CLI. cli-mode.ts looks the binary up via `which`/`where`
// and spawns the literal name "claude", both using the server's PATH —
// prepending the fixture dir wins the lookup without touching real installs.
const FAKE_CLAUDE_BIN_DIR = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
  "fake-claude",
);

// Commander codex e2e (commander-codex-*.spec.ts): resolve `codex` to the
// deterministic fake CLI. Same mechanism as fake-claude — prepend dir wins
// `which codex` without touching any real codex install.
const FAKE_CODEX_BIN_DIR = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
  "fake-codex",
);

export default defineConfig({
  testDir: ".",
  testMatch: WINDOWS_WITH_EMBEDDED_POSTGRES
    ? "**/windows-embedded-postgres-skip.spec.ts"
    : "**/*.spec.ts",
  // NOTE: authenticated (multi-user) deployment mode has NO e2e coverage yet.
  // The e2e suite boots only in local_trusted mode (see webServer env below).
  // Multi-user authenticated-mode e2e is tracked for 1.1.
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
          AOA_VITE_HMR_PORT: String(PORT + 10_000),
          AOA_E2E_FAKE_AWS_SECRETS_MANAGER: "1",
          AOA_E2E_FAKE_CREW_LLM: "1",
          AOA_THREAD_EVENT_DEBOUNCE_MS: "250",
          // Pin e2e marketplace data to the copied bundled fixture. The
          // service falls back to bundled data when the CDN cannot be reached.
          AOA_MARKETPLACE_CDN_URL: "http://127.0.0.1:1/catalog.json",
          // Commander viewer e2e: `claude` resolves to the deterministic
          // fake CLI (tests/e2e/fixtures/fake-claude). The control file is
          // rewritten by the spec before each send to script the next turn.
          // Commander codex e2e: `codex` resolves to the deterministic fake
          // CLI (tests/e2e/fixtures/fake-codex). workers:1 + reuseExistingServer:
          // false means the single global control/invocations files are race-free.
          PATH: `${FAKE_CLAUDE_BIN_DIR}${path.delimiter}${FAKE_CODEX_BIN_DIR}${path.delimiter}${process.env.PATH ?? ""}`,
          AOA_E2E_FAKE_CLAUDE_CONTROL: FAKE_CLAUDE_CONTROL_PATH,
          AOA_E2E_FAKE_CLAUDE_INVOCATIONS: FAKE_CLAUDE_INVOCATIONS_PATH,
          AOA_E2E_FAKE_CODEX_CONTROL: FAKE_CODEX_CONTROL_PATH,
          AOA_E2E_FAKE_CODEX_INVOCATIONS: FAKE_CODEX_INVOCATIONS_PATH,
          // Fake embedder seam (T15): makes all embedding flows deterministic
          // in CI/e2e without a real OpenAI key. The fake embedder returns a
          // fixed 1536-dim vector; forced-error scenarios are controlled via
          // FAKE_EMBEDDER_CONTROL_PATH (write JSON before the triggering action).
          AOA_E2E_FAKE_EMBEDDER: "1",
          AOA_E2E_FAKE_EMBEDDER_CONTROL: FAKE_EMBEDDER_CONTROL_PATH,
          // Embeddings: NO instance-level OPENAI_API_KEY. The fake embedder
          // (AOA_E2E_FAKE_EMBEDDER=1) supplies vectors without a real key, and
          // tests that need semantic availability add a PER-COMPANY key via
          // POST /secrets. We force this EMPTY (not just omit it) so the no-key
          // path is deterministic even if the dev shell exports a real
          // OPENAI_API_KEY — otherwise resolveSemanticAvailable's env fallback
          // would report semantic "available" for keyless companies and the
          // no-llm-key-banner tests would fail under pgvector.
          OPENAI_API_KEY: "",
        },
      },
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
});
