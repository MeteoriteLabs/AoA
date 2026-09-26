// DEP-019 — the reference provider's DETERMINISTIC SCRIPTED COMMAND EXECUTION.
//
// `DEP-016`'s canned usage rides the CONTRACT driver's `invoke("execute")` result, which only a
// harness reads; the authoritative per-op `ExecuteResult` has no usage field at all. A DEPLOYED
// worker derives usage from the run's stdout, through `ExecuteInput.onStdout` and
// `parseClaudeStreamJsonUsage` (`packages/worker-daemon/src/supervisor/usage-observer.ts`).
//
// These tests pin the properties that path depends on:
//   1. the transcript's FINAL non-empty line is the stream-json `result` event, carrying claude's
//      own usage field names with the canned counts;
//   2. `--aoa-fake-usage=suppressed` removes that line ENTIRELY — the worker-driven positive
//      control, which must leave a stream-json parser with no usage;
//   3. the script rides the TENANT COMMAND's args (a worker-driven journey has no provider id to
//      script through the control endpoint), and an unrecognised or malformed scripting flag is a
//      REFUSAL, never a silent default — a degraded script makes every positive control vacuous;
//   4. an exhausted budget short-circuits BEFORE any output, exactly as
//      `E2bSandboxProvider.execute` does;
//   5. the whole thing is deterministic: same args ⇒ byte-identical stdout.
//
// ★ Property 1 is asserted with a LOCAL PORT of the worker's parser (`parseFinalResultUsage`
// below), not with a hand-read of the JSON. The point of the transcript is that the WORKER'S
// parser finds usage in it, so the test reads it the way that parser does — final non-empty line
// only, claude's field names, absent field ⇒ 0.

import { describe, expect, it } from "vitest";
import { usagePayloadV1Schema } from "@armyofagents/worker-protocol";

import {
  DEFAULT_SCRIPTED_COMMAND_PLAN,
  FAKE_PROVIDER_CANNED_USAGE_V1,
  SCRIPTED_COMMAND_MAX_DELAY_MS,
  ScriptedCommandError,
  buildScriptedStdoutChunks,
  executeScriptedCommand,
  executeScriptedCommandAsync,
  parseScriptedCommand,
} from "../index.js";

/**
 * A deliberate MIRROR of the load-bearing half of `parseClaudeStreamJsonUsage`
 * (`packages/worker-daemon/src/supervisor/usage-observer.ts`): read the FINAL non-empty line,
 * require `type:"result"`, map claude's field names, an ABSENT count is 0. It is a mirror and not
 * an import because this package imports no worker-daemon code (E4-D01 keeps the daemon's
 * dependency surface closed and this package's own deps are worker-protocol + zod).
 */
function parseFinalResultUsage(stdout: string): { input: number; output: number; cached: number } | null {
  const lines = stdout.split(/\r?\n/);
  let last = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (trimmed) {
      last = trimmed;
      break;
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.type !== "result") return null;
  const usage = record.usage;
  if (typeof usage !== "object" || usage === null) return null;
  const counts = usage as Record<string, unknown>;
  const read = (key: string): number | null => {
    const value = counts[key];
    if (value === undefined) return 0;
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const input = read("input_tokens");
  const output = read("output_tokens");
  const cached = read("cache_read_input_tokens");
  if (input === null || output === null || cached === null) return null;
  return { input, output, cached };
}

function runScript(args: readonly string[], deadlineMs = 60_000) {
  const chunks: string[] = [];
  const result = executeScriptedCommand(
    { sandboxId: "sbx-1", command: "claude", args, env: {}, onStdout: (c) => chunks.push(c) },
    { deadlineMs, providerOpId: "op-1" },
  );
  return { result, stdout: chunks.join(""), chunks };
}

describe("scripted command — the transcript the worker's usage observer reads (DEP-019)", () => {
  it("the FINAL line is the stream-json result event, carrying the canned units", () => {
    const { stdout } = runScript([]);
    const usage = parseFinalResultUsage(stdout);
    expect(usage).toEqual({
      input: FAKE_PROVIDER_CANNED_USAGE_V1.inputTokens,
      output: FAKE_PROVIDER_CANNED_USAGE_V1.outputTokens,
      cached: FAKE_PROVIDER_CANNED_USAGE_V1.cachedInputTokens,
    });
    // The units the observer would build still satisfy the FROZEN wire schema the control
    // plane validates the `usage` event against; `runtimeMillis` is the supervisor's own
    // measurement, so any non-negative integer stands in for it here.
    expect(
      usagePayloadV1Schema.parse({
        inputTokens: usage!.input,
        outputTokens: usage!.output,
        cachedInputTokens: usage!.cached,
        runtimeMillis: 1,
      }),
    ).toBeTruthy();
  });

  it("the transcript arrives in MORE THAN ONE chunk (a first-chunk-only consumer must not pass)", () => {
    const { chunks } = runScript([]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(parseFinalResultUsage(chunks[0]!)).toBeNull();
  });

  it("--aoa-fake-usage=suppressed removes the result LINE entirely, so a parser finds no usage", () => {
    const { stdout } = runScript(["--aoa-fake-usage=suppressed"]);
    expect(parseFinalResultUsage(stdout)).toBeNull();
    // Stronger than "a result line with no usage": there is no result event at all.
    expect(stdout).not.toContain('"type":"result"');
    // And the run still SUCCEEDS — the control isolates usage, nothing else.
    const { result } = runScript(["--aoa-fake-usage=suppressed"]);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it("is deterministic: the same args produce byte-identical stdout", () => {
    expect(runScript(["--aoa-fake-exit=0"]).stdout).toBe(runScript(["--aoa-fake-exit=0"]).stdout);
    expect(runScript([]).stdout).toBe(runScript([]).stdout);
  });

  it("ordinary agent arguments are passed over, not interpreted", () => {
    const { stdout, result } = runScript(["--output-format", "stream-json", "-p", "do the thing"]);
    expect(result.exitCode).toBe(0);
    expect(parseFinalResultUsage(stdout)).not.toBeNull();
  });
});

describe("scripted command — the script is READ EXACTLY or refused (DEP-019)", () => {
  it("the default plan is canned usage, exit 0, not timed out, no delay", () => {
    expect(parseScriptedCommand([])).toEqual(DEFAULT_SCRIPTED_COMMAND_PLAN);
    // An EXACT-shape pin, deliberately: a new plan field that defaults to something other than
    // "behave exactly as before" must be a decision, not an accident. `delayMs: 0` was added
    // by DEP-021 and this assertion is what made the addition visible.
    expect(DEFAULT_SCRIPTED_COMMAND_PLAN).toEqual({ usageMode: "canned", exitCode: 0, timedOut: false, delayMs: 0 });
  });

  it("--aoa-fake-exit sets the reported exit code", () => {
    expect(parseScriptedCommand(["--aoa-fake-exit=7"]).exitCode).toBe(7);
    expect(runScript(["--aoa-fake-exit=7"]).result.exitCode).toBe(7);
  });

  it("--aoa-fake-timeout reports the provider's timed-out verdict AFTER writing output", () => {
    const { result, stdout } = runScript(["--aoa-fake-timeout"]);
    expect(result).toMatchObject({ exitCode: null, signal: "SIGKILL", timedOut: true });
    // Distinguishable from the exhausted-budget path below: this one produced a transcript.
    expect(parseFinalResultUsage(stdout)).not.toBeNull();
  });

  it("an unrecognised --aoa-fake-* flag is a REFUSAL, never a silent default", () => {
    expect(() => parseScriptedCommand(["--aoa-fake-nonsense=1"])).toThrow(ScriptedCommandError);
    expect(() => parseScriptedCommand(["--aoa-fake-nonsense=1"])).toThrow(/unrecognised scripting flag/);
  });

  it("a malformed value is a REFUSAL (a bad script must not degrade to canned)", () => {
    expect(() => parseScriptedCommand(["--aoa-fake-usage=sometimes"])).toThrow(/canned/);
    expect(() => parseScriptedCommand(["--aoa-fake-usage"])).toThrow(/requires a value/);
    expect(() => parseScriptedCommand(["--aoa-fake-exit=-1"])).toThrow(/non-negative safe integer/);
    expect(() => parseScriptedCommand(["--aoa-fake-exit=x"])).toThrow(/non-negative safe integer/);
    expect(() => parseScriptedCommand(["--aoa-fake-timeout=1"])).toThrow(/takes no value/);
  });

  it("a REPEATED flag is a refusal (two callers disagreeing must not resolve by last-wins)", () => {
    expect(() => parseScriptedCommand(["--aoa-fake-usage=canned", "--aoa-fake-usage=suppressed"])).toThrow(
      /more than once/,
    );
    expect(() => parseScriptedCommand(["--aoa-fake-exit=1", "--aoa-fake-exit=2"])).toThrow(/more than once/);
    expect(() => parseScriptedCommand(["--aoa-fake-timeout", "--aoa-fake-timeout"])).toThrow(/more than once/);
  });

  it("a bad script throws BEFORE any output reaches the channel", () => {
    const chunks: string[] = [];
    expect(() =>
      executeScriptedCommand(
        { sandboxId: "s", command: "claude", args: ["--aoa-fake-nonsense"], env: {}, onStdout: (c) => chunks.push(c) },
        { deadlineMs: 1000, providerOpId: "op" },
      ),
    ).toThrow(ScriptedCommandError);
    expect(chunks).toEqual([]);
  });
});

describe("scripted command — the exhausted-budget short-circuit (DEP-019)", () => {
  it("deadlineMs <= 0 returns the timed-out verdict and writes NOTHING", () => {
    for (const deadlineMs of [0, -1]) {
      const chunks: string[] = [];
      const result = executeScriptedCommand(
        { sandboxId: "sbx", command: "claude", args: [], env: {}, onStdout: (c) => chunks.push(c) },
        { deadlineMs, providerOpId: "op" },
      );
      expect(result).toEqual({
        providerOpId: "op",
        exitCode: null,
        signal: "SIGKILL",
        timedOut: true,
        stdoutRef: "ref:stdout:sbx",
        stderrRef: "ref:stderr:sbx",
      });
      expect(chunks).toEqual([]);
    }
  });

  it("the short-circuit precedes the script parse (a bad script on a spent budget still times out)", () => {
    const result = executeScriptedCommand(
      { sandboxId: "sbx", command: "claude", args: ["--aoa-fake-nonsense"], env: {} },
      { deadlineMs: 0, providerOpId: "op" },
    );
    expect(result.timedOut).toBe(true);
  });
});

describe("scripted command — no channel is a valid caller (DEP-019)", () => {
  it("execute without onStdout returns the same verdict and does not throw", () => {
    const result = executeScriptedCommand(
      { sandboxId: "sbx", command: "claude", args: [], env: {} },
      { deadlineMs: 1000, providerOpId: "op" },
    );
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, signal: null });
  });

  it("buildScriptedStdoutChunks accepts overridden units", () => {
    const chunks = buildScriptedStdoutChunks(DEFAULT_SCRIPTED_COMMAND_PLAN, {
      inputTokens: 5,
      outputTokens: 6,
      cachedInputTokens: 7,
      runtimeMillis: 8,
    });
    expect(parseFinalResultUsage(chunks.join(""))).toEqual({ input: 5, output: 6, cached: 7 });
  });
});

// ==========================================================================
// DEP-021 — `--aoa-fake-delay`: the IN-FLIGHT WINDOW.
//
// `M1-D1-SPINE`'s `d1.reconcile.worker_startup_lease_probe` needs `worker-b` restarted WHILE it
// holds a live lease over an in-flight run, so the restarted daemon's startup reconciler meets a
// REAL lease offer — one that satisfies `leaseOfferV1Schema` and decodes to the lease id and
// Organization its own row is keyed by (`SqliteLeaseCandidateStore.listEntries`) — and refuses it
// as FENCED rather than pruning it as `dead`. A provider whose `execute` returns at once gives the
// harness no window at all: the run is terminal before a restart lands.
//
// ★ THE FLAG'S FAIL-CLOSED SHAPE IS THE POINT. The flag set is CLOSED and a silently-dropped
// scripting flag makes every control built on it vacuous (this module's own header). A delay is
// the first flag the SYNCHRONOUS entry point cannot honour, so that entry point REFUSES a
// non-zero delay instead of returning early. `executeScriptedCommand` going quietly fast would
// be indistinguishable, from the harness's side, from a restart that raced a finished run.
// ==========================================================================

describe("scripted command — the --aoa-fake-delay in-flight window (DEP-021)", () => {
  it("parses a delay, and the default plan has none", () => {
    expect(DEFAULT_SCRIPTED_COMMAND_PLAN.delayMs).toBe(0);
    expect(parseScriptedCommand([]).delayMs).toBe(0);
    expect(parseScriptedCommand(["--aoa-fake-delay=0"]).delayMs).toBe(0);
    expect(parseScriptedCommand(["--aoa-fake-delay=45000"]).delayMs).toBe(45_000);
    // It composes with the flags that already exist, which is how the D1 case uses it.
    const plan = parseScriptedCommand(["--aoa-fake-delay=1000", "--aoa-fake-exit=3", "--aoa-fake-usage=suppressed"]);
    expect(plan).toEqual({ usageMode: "suppressed", exitCode: 3, timedOut: false, delayMs: 1000 });
  });

  it("REFUSES a malformed, negative, non-integer or out-of-bounds delay — never a default", () => {
    expect(() => parseScriptedCommand(["--aoa-fake-delay"])).toThrow(/requires a value/);
    expect(() => parseScriptedCommand(["--aoa-fake-delay="])).toThrow(/requires a value/);
    expect(() => parseScriptedCommand(["--aoa-fake-delay=-1"])).toThrow(/non-negative safe integer/);
    expect(() => parseScriptedCommand(["--aoa-fake-delay=1.5"])).toThrow(/non-negative safe integer/);
    expect(() => parseScriptedCommand(["--aoa-fake-delay=abc"])).toThrow(/non-negative safe integer/);
    expect(() => parseScriptedCommand(["--aoa-fake-delay=Infinity"])).toThrow(/non-negative safe integer/);
    // ★ THE BOUND. A scripted wait is a BOUNDED wait: without this, one job envelope could park
    // a provider worker indefinitely and the caller's own race would be the only thing to end
    // it — a bound enforced by the wrong half.
    expect(parseScriptedCommand([`--aoa-fake-delay=${SCRIPTED_COMMAND_MAX_DELAY_MS}`]).delayMs).toBe(
      SCRIPTED_COMMAND_MAX_DELAY_MS,
    );
    expect(() => parseScriptedCommand([`--aoa-fake-delay=${SCRIPTED_COMMAND_MAX_DELAY_MS + 1}`])).toThrow(
      /must be at most 600000 ms/,
    );
    expect(() => parseScriptedCommand(["--aoa-fake-delay=1", "--aoa-fake-delay=2"])).toThrow(/more than once/);
    for (const thrown of [
      () => parseScriptedCommand(["--aoa-fake-delay=-1"]),
      () => parseScriptedCommand(["--aoa-fake-delay=x"]),
    ]) {
      expect(thrown).toThrow(ScriptedCommandError);
    }
  });

  it("the flag set stays CLOSED: a near-miss spelling still throws", () => {
    expect(() => parseScriptedCommand(["--aoa-fake-delays=1"])).toThrow(/unrecognised scripting flag/);
    expect(() => parseScriptedCommand(["--aoa-fake-sleep=1"])).toThrow(/unrecognised scripting flag/);
    // An argument outside the namespace is an ordinary agent argument, as before.
    expect(parseScriptedCommand(["--delay=1", "-p", "do the thing"]).delayMs).toBe(0);
  });

  it("★ the SYNCHRONOUS entry point REFUSES a non-zero delay rather than dropping it", () => {
    expect(() =>
      executeScriptedCommand(
        { sandboxId: "sbx", command: "claude", args: ["--aoa-fake-delay=5000"], env: {} },
        { deadlineMs: 60_000, providerOpId: "op" },
      ),
    ).toThrow(ScriptedCommandError);
    expect(() =>
      executeScriptedCommand(
        { sandboxId: "sbx", command: "claude", args: ["--aoa-fake-delay=5000"], env: {} },
        { deadlineMs: 60_000, providerOpId: "op" },
      ),
    ).toThrow(/needs the asynchronous entry point/);
    // A ZERO delay is not a refusal: it is the pre-DEP-021 behaviour, byte for byte.
    const result = executeScriptedCommand(
      { sandboxId: "sbx", command: "claude", args: ["--aoa-fake-delay=0"], env: {} },
      { deadlineMs: 60_000, providerOpId: "op" },
    );
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, signal: null });
  });

  it("★ the delay is WAITED, and it is waited BEFORE any transcript is written", async () => {
    const order: string[] = [];
    const chunks: string[] = [];
    const result = await executeScriptedCommandAsync(
      {
        sandboxId: "sbx",
        command: "claude",
        args: ["--aoa-fake-delay=1234"],
        env: {},
        onStdout: (c) => {
          order.push("stdout");
          chunks.push(c);
        },
      },
      {
        deadlineMs: 60_000,
        providerOpId: "op",
        sleep: async (ms) => {
          order.push(`sleep:${ms}`);
        },
      },
    );
    // The window the reconcile case restarts a worker inside is a window in which NOTHING has
    // been written yet: a run whose usage had already streamed is not distinguishable, to a
    // restarted worker's probe, from a finished one.
    expect(order[0]).toBe("sleep:1234");
    expect(order.slice(1).every((entry) => entry === "stdout")).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, signal: null });
  });

  it("with NO delay the async entry point does not wait at all", async () => {
    let slept = 0;
    const result = await executeScriptedCommandAsync(
      { sandboxId: "sbx", command: "claude", args: [], env: {} },
      {
        deadlineMs: 60_000,
        providerOpId: "op",
        sleep: async () => {
          slept += 1;
        },
      },
    );
    expect(slept).toBe(0);
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
  });

  it("the async entry point is otherwise IDENTICAL to the sync one, flag for flag", async () => {
    for (const args of [
      [] as string[],
      ["--aoa-fake-usage=suppressed"],
      ["--aoa-fake-exit=7"],
      ["--aoa-fake-timeout"],
      ["-p", "an ordinary agent argument"],
    ]) {
      const syncChunks: string[] = [];
      const sync = executeScriptedCommand(
        { sandboxId: "sbx", command: "claude", args, env: {}, onStdout: (c) => syncChunks.push(c) },
        { deadlineMs: 60_000, providerOpId: "op" },
      );
      const asyncChunks: string[] = [];
      const asynchronous = await executeScriptedCommandAsync(
        { sandboxId: "sbx", command: "claude", args, env: {}, onStdout: (c) => asyncChunks.push(c) },
        { deadlineMs: 60_000, providerOpId: "op" },
      );
      expect(asynchronous).toEqual(sync);
      expect(asyncChunks).toEqual(syncChunks);
    }
  });

  it("★ the exhausted-budget short-circuit still wins, and NOTHING is waited or written", async () => {
    let slept = 0;
    const chunks: string[] = [];
    const result = await executeScriptedCommandAsync(
      {
        sandboxId: "sbx",
        command: "claude",
        args: ["--aoa-fake-delay=5000"],
        env: {},
        onStdout: (c) => chunks.push(c),
      },
      {
        deadlineMs: 0,
        providerOpId: "op",
        sleep: async () => {
          slept += 1;
        },
      },
    );
    // A caller must never observe output — or a wait — from a run whose budget was already gone.
    expect(result).toMatchObject({ exitCode: null, signal: "SIGKILL", timedOut: true });
    expect(slept).toBe(0);
    expect(chunks).toEqual([]);
  });

  it("★ a BAD script still throws BEFORE the wait, so no output and no wait happen", async () => {
    let slept = 0;
    await expect(
      executeScriptedCommandAsync(
        { sandboxId: "sbx", command: "claude", args: ["--aoa-fake-delay=1000", "--aoa-fake-nonsense=1"], env: {} },
        {
          deadlineMs: 60_000,
          providerOpId: "op",
          sleep: async () => {
            slept += 1;
          },
        },
      ),
    ).rejects.toThrow(/unrecognised scripting flag/);
    expect(slept).toBe(0);
  });

  it("the default sleep really waits, and it is the one used when none is injected", async () => {
    const startedAt = Date.now();
    const result = await executeScriptedCommandAsync(
      { sandboxId: "sbx", command: "claude", args: ["--aoa-fake-delay=25"], env: {} },
      { deadlineMs: 60_000, providerOpId: "op" },
    );
    // A real wait, measured. Without this the injected-sleep cases above would all pass against
    // an implementation whose default path waited zero — the control's own control.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
  });
});
