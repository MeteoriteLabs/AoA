// BRW-002 clause (c) — "browser and child processes die on cancellation".
//
// Adversarial review found this clause had NO test at all, while the other browser test
// file's header claimed to cover it. That claim is now removed and this is the real proof.
//
// WHAT THIS LAYER CAN HONESTLY PROVE — and it is LESS than I first wrote here.
//
// The original version of this header claimed that when the runner dies, Chromium dies with
// it via the CDP pipe reaching EOF. That claim came from a review note asserting the browser
// was reaped in 0.1-0.2s. IT IS FALSE. Measured directly: the runner process confirmed dead,
// and a Chromium process still alive 15 seconds later. The first test written from that
// header failed, which is how the claim was caught.
//
// So the honest split is:
//   * GRACEFUL cancellation (SIGTERM/SIGINT) — the runtime CAN handle, and does: the driver
//     closes the context, which reaps the browser and flushes video. Proven below (POSIX).
//   * UNCATCHABLE kill (SIGKILL) — the runtime CANNOT handle, by definition. The browser is
//     orphaned. Proven below too, deliberately, because that limitation is what makes sandbox
//     `destroy` load-bearing rather than belt-and-braces.
//
// Terrain already established that `signal()` is a no-op against real E2B and only
// `destroy`/`terminate` reclaims. That is E4's mechanism and is NOT asserted here; what these
// tests do is pin exactly how much of clause (c) this layer carries, so nobody later reads
// "browser dies on cancellation" as a property of the runtime.
//
// The processes are identified by the unique `userDataDir` on their command line, so this
// counts OUR browser and never a developer's other Chrome.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { startFixtureSite, type FixtureSite } from "../fixture-site.js";

const execFileAsync = promisify(execFile);
const RUN = process.env.AOA_RUN_BROWSER_TESTS === "1";
const suite = describe.skipIf(!RUN);

let site: FixtureSite;
let base: string;

beforeAll(async () => {
  if (!RUN) return;
  site = await startFixtureSite();
  base = mkdtempSync(join(tmpdir(), "brw002-teardown-"));
});
afterAll(async () => {
  if (!RUN) return;
  await site?.close();
  if (base) rmSync(base, { recursive: true, force: true });
});

/** Count live processes whose command line mentions `marker`. */
async function processesMentioning(marker: string): Promise<number> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' } | Measure-Object).Count`,
        ],
        { timeout: 30_000 },
      );
      return Number.parseInt(stdout.trim(), 10) || 0;
    }
    const { stdout } = await execFileAsync("sh", ["-c", `ps -eo args= | grep -F -- '${marker}' | grep -v grep | wc -l`], {
      timeout: 30_000,
    });
    return Number.parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// SIGTERM/SIGINT are only deliverable as real signals on POSIX; on Windows Node maps
// child.kill() to TerminateProcess regardless of the name, so the graceful path is
// untestable there and this suite is Linux-only inside the browser lane.
const linuxOnly = describe.skipIf(!RUN || process.platform !== "linux");

linuxOnly("BRW-002 (c) — a GRACEFUL cancellation reaps the browser", () => {
  it("closes the browser when the runner receives SIGTERM", async () => {
    const dir = mkdtempSync(join(base, "sigterm-"));
    const profile = join(dir, "profile");
    const root = join(dir, "root");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(dir, "session.json"),
      JSON.stringify({
        downloadRoot: root,
        userDataDir: profile,
        downloadsStagingPath: join(dir, "staging"),
        steps: [{ action: "navigate", url: `${site.origin}/slow` }],
        launch: { headless: true, chromiumSandbox: true, args: [] },
      }),
    );

    const runnerJs = fileURLToPath(new URL("../../dist/runner.js", import.meta.url));
    const child = spawn(process.execPath, [runnerJs, join(dir, "session.json")], { stdio: "ignore" });
    try {
      const started = await waitFor(async () => (await processesMentioning(profile)) > 0, 30_000);
      expect(started, "the browser never started, so this test would prove nothing").toBe(true);

      child.kill("SIGTERM");
      const reaped = await waitFor(async () => (await processesMentioning(profile)) === 0, 30_000);
      expect(reaped, "the browser survived a graceful cancellation").toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
  }, 90_000);
});

suite("BRW-002 (c) — an UNCATCHABLE kill orphans the browser, which is why sandbox destroy is required", () => {
  it("MEASURES that SIGKILL leaves Chromium alive", async () => {
    // This test asserts a LIMITATION, deliberately, because the limitation is load-bearing.
    //
    // I first wrote the opposite test — "killing the runner reaps the browser" — on the
    // strength of a review claim that Chromium died in 0.1-0.2s via pipe EOF. It failed, and
    // measuring directly showed the runner dead while a Chromium process was still alive 15
    // seconds later. So the runtime layer CANNOT deliver clause (c) on its own.
    //
    // Pinning it here means the dependency on sandbox `destroy` is a tested fact rather than
    // an assumption, and if a future Playwright or Chromium starts self-reaping on pipe EOF
    // this test fails and tells us the ground moved.
    const dir = mkdtempSync(join(base, "sigkill-"));
    const profile = join(dir, "profile");
    const root = join(dir, "root");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(dir, "session.json"),
      JSON.stringify({
        downloadRoot: root,
        userDataDir: profile,
        downloadsStagingPath: join(dir, "staging"),
        steps: [{ action: "navigate", url: `${site.origin}/slow` }],
        launch: { headless: true, chromiumSandbox: true, args: [] },
      }),
    );

    const runnerJs = fileURLToPath(new URL("../../dist/runner.js", import.meta.url));
    const child = spawn(process.execPath, [runnerJs, join(dir, "session.json")], { stdio: "ignore" });
    let orphaned = 0;
    try {
      const started = await waitFor(async () => (await processesMentioning(profile)) > 0, 30_000);
      expect(started, "the browser never started, so this test would prove nothing").toBe(true);

      child.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 5_000));
      orphaned = await processesMentioning(profile);
      expect(orphaned, "Chromium was reaped by SIGKILL - the ground moved, revisit clause (c)").toBeGreaterThan(0);
    } finally {
      // Do not leave the orphan running: this test creates the very condition it documents.
      if (process.platform === "win32") {
        await execFileAsync("powershell", [
          "-NoProfile",
          "-Command",
          `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ]).catch(() => undefined);
      } else {
        await execFileAsync("sh", ["-c", `pkill -f -- '${profile}' || true`]).catch(() => undefined);
      }
    }
  }, 90_000);
});

suite("BRW-002 (c) — the runner reports failure rather than exiting silently", () => {
  it("emits a typed failure event and a non-zero exit for an unreadable config", async () => {
    // An exit code alone loses the reason; an event alone lets a failed session look
    // successful to a caller that only checks the code. Both are asserted.
    const runnerJs = fileURLToPath(new URL("../../dist/runner.js", import.meta.url));
    const { code, out } = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, [runnerJs, join(base, "does-not-exist.json")], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      child.stdout.on("data", (d) => (out += String(d)));
      child.on("close", (code) => resolve({ code, out }));
    });

    expect(code).not.toBe(0);
    const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.some((e) => e.type === "session_failed" && e.reason === "config_unreadable")).toBe(true);
  }, 30_000);

  it("refuses an unsafe launch through the REAL entrypoint, not just the library", async () => {
    // The boot-root proof for the guard: a config asking for a debugging port must be
    // refused by the process the sandbox actually executes.
    const dir = mkdtempSync(join(base, "unsafe-"));
    const root = join(dir, "root");
    mkdirSync(root, { recursive: true });
    const configPath = join(dir, "session.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        downloadRoot: root,
        userDataDir: join(dir, "profile"),
        downloadsStagingPath: join(dir, "staging"),
        steps: [],
        // The single-dash spelling that was REPRODUCIBLY BYPASSED before the allow-list.
        launch: { headless: true, chromiumSandbox: true, args: ["-remote-debugging-port=9333"] },
      }),
    );

    const runnerJs = fileURLToPath(new URL("../../dist/runner.js", import.meta.url));
    const { code, out } = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, [runnerJs, configPath], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      child.stdout.on("data", (d) => (out += String(d)));
      child.on("close", (code) => resolve({ code, out }));
    });

    expect(code).not.toBe(0);
    expect(out).toContain("remote_debugging_arg");
  }, 60_000);
});
