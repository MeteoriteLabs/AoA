import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "../server/execute.js";
import type {
  AdapterExecutionContext,
  AdapterProviderSandboxRunInput,
} from "@armyofagents/adapter-utils";

/**
 * D9 — ambient Claude-config isolation, asserted at the SPAWN.
 *
 * A unit test of the env builder cannot prove the spawned child actually got
 * the isolated env, so these tests run a real `claude` stand-in that dumps its
 * OWN `process.env` and assert on that file.
 *
 * Both halves matter:
 *   - crew (`isolateAmbientConfig: true`) — the host's `~/.claude` and the
 *     server's ANTHROPIC_* never reach the child, but PATH/HOME/USERPROFILE do;
 *   - org / heartbeat (flag unset) — ambient env is inherited UNCHANGED. The
 *     opt-in is crew-only; a later task decides whether to expand it.
 */

const AMBIENT_CONFIG_DIR = path.join(os.tmpdir(), "operator-dot-claude");
const AMBIENT_API_KEY = "sk-ant-ambient-server-key";
/** Not enumerated anywhere in the strip list — proves the PREFIX class works. */
const AMBIENT_FUTURE_KNOB = "operator-hooks-and-plugins";
const AMBIENT_HOME = path.join(os.tmpdir(), "operator-home");

interface EnvCapture {
  env: Record<string, string | undefined>;
}

/**
 * A `claude` stand-in that emits just enough stream-json for the adapter to
 * parse a clean result, and writes its full inherited env to the capture file.
 * Mirrors execute-target.test.ts' shim (same "agent.js" + .cmd layout).
 */
async function writeEnvDumpingClaude(commandBase: string): Promise<string> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
try { fs.readFileSync(0, "utf8"); } catch { /* stdin may be closed */ }
const capturePath = process.env.AOA_TEST_CAPTURE_PATH;
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify({ env: process.env }), "utf8");
}
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  session_id: "claude-session-1",
  result: "ok",
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
  total_cost_usd: 0,
}));
`;
  await fs.writeFile(commandBase + ".js", script, "utf8");
  await fs.chmod(commandBase + ".js", 0o755);

  if (process.platform === "win32") {
    const cmdPath = commandBase + ".cmd";
    await fs.writeFile(cmdPath, `@node "%~dp0agent.js" %*\r\n`, "utf8");
    return cmdPath;
  }
  await fs.writeFile(commandBase, script, "utf8");
  await fs.chmod(commandBase, 0o755);
  return commandBase;
}

async function runClaude(opts: {
  isolateAmbientConfig?: boolean;
  /** Extra agent-configured env, folded into the overlay by buildClaudeRuntimeConfig. */
  configEnv?: Record<string, string>;
}): Promise<{
  capture: EnvCapture;
  commandNotes: string[];
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-claude-ambient-"));
  const workspace = path.join(root, "workspace");
  const capturePath = path.join(root, "capture.json");
  await fs.mkdir(workspace, { recursive: true });
  const commandPath = await writeEnvDumpingClaude(path.join(root, "agent"));

  const ctx: AdapterExecutionContext = {
    runId: "run-ambient-config",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Scout",
      adapterType: "claude_local",
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: {
      command: commandPath,
      cwd: workspace,
      env: { AOA_TEST_CAPTURE_PATH: capturePath, ...(opts.configEnv ?? {}) },
      timeoutSec: 20,
      graceSec: 1,
    },
    context: {},
    executionTarget: { type: "local" },
    runtimeCommandSpec: null,
    onLog: async () => {},
    onMeta: async (meta) => {
      commandNotes = meta.commandNotes ?? [];
    },
    ...(opts.isolateAmbientConfig !== undefined
      ? { isolateAmbientConfig: opts.isolateAmbientConfig }
      : {}),
  };

  let commandNotes: string[] = [];
  const result = await execute(ctx);
  expect(result.exitCode, "claude stand-in should exit cleanly").toBe(0);
  const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as EnvCapture;
  return { capture, commandNotes, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

describe("claude ambient-config isolation at the spawn", () => {
  const saved: Record<string, string | undefined> = {};
  const poisoned = {
    CLAUDE_CONFIG_DIR: AMBIENT_CONFIG_DIR,
    CLAUDE_CODE_OPERATOR_KNOB: AMBIENT_FUTURE_KNOB,
    ANTHROPIC_API_KEY: AMBIENT_API_KEY,
    HOME: AMBIENT_HOME,
    USERPROFILE: AMBIENT_HOME,
  };

  beforeEach(() => {
    for (const [key, value] of Object.entries(poisoned)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(poisoned)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("crew run: strips the host Claude config and pins CLAUDE_CONFIG_DIR per run", async () => {
    const { capture, cleanup } = await runClaude({ isolateAmbientConfig: true });
    try {
      expect(capture.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(capture.env.CLAUDE_CODE_OPERATOR_KNOB).toBeUndefined();
      expect(capture.env.CLAUDE_CONFIG_DIR).toBeTruthy();
      expect(capture.env.CLAUDE_CONFIG_DIR).not.toBe(AMBIENT_CONFIG_DIR);
      expect(path.basename(capture.env.CLAUDE_CONFIG_DIR!)).toMatch(/^aoa-claude-config-/);
    } finally {
      await cleanup();
    }
  });

  // Pre-T3 the pinned dir is empty, so a crew run can fail login-required while
  // Settings → Providers (which probes the HOST config) says the provider is
  // verified. The note rides onMeta next to the redacted env so the founder can
  // see WHICH config directory the run actually used.
  it("crew run: commandNotes name the isolation and the pinned directory", async () => {
    const { capture, commandNotes, cleanup } = await runClaude({ isolateAmbientConfig: true });
    try {
      const note = commandNotes.find((n) => n.includes("Ambient Claude config isolated"));
      expect(note, "isolation should be visible in onMeta").toBeTruthy();
      expect(note).toContain(capture.env.CLAUDE_CONFIG_DIR!);
    } finally {
      await cleanup();
    }
  });

  it("org/heartbeat run: no isolation note", async () => {
    const { commandNotes, cleanup } = await runClaude({});
    try {
      expect(commandNotes.some((n) => n.includes("Ambient Claude config isolated"))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("crew run: PATH, HOME and USERPROFILE survive the strip", async () => {
    const { capture, cleanup } = await runClaude({ isolateAmbientConfig: true });
    try {
      expect(capture.env.PATH ?? capture.env.Path).toBeTruthy();
      expect(capture.env.HOME).toBe(AMBIENT_HOME);
      expect(capture.env.USERPROFILE).toBe(AMBIENT_HOME);
    } finally {
      await cleanup();
    }
  });

  // The no-regression proof (D15): org/heartbeat runs never set the flag, and
  // their env must be byte-for-byte what it was before this change.
  it("org/heartbeat run: inherits ambient Claude config unchanged", async () => {
    const { capture, cleanup } = await runClaude({});
    try {
      expect(capture.env.ANTHROPIC_API_KEY).toBe(AMBIENT_API_KEY);
      expect(capture.env.CLAUDE_CONFIG_DIR).toBe(AMBIENT_CONFIG_DIR);
      expect(capture.env.CLAUDE_CODE_OPERATOR_KNOB).toBe(AMBIENT_FUTURE_KNOB);
      expect(capture.env.HOME).toBe(AMBIENT_HOME);
    } finally {
      await cleanup();
    }
  });

  // The pin exists so the CLI reads config from somewhere the operator's
  // ~/.claude cannot reach. An operator who ALREADY has a dedicated, logged-in
  // config home must be able to point crew at it — that is the only pre-T3
  // escape hatch, and every other provider-auth variable set this way survives.
  it("crew run: an agent-configured CLAUDE_CONFIG_DIR wins over the per-run pin", async () => {
    const operatorDir = path.join(os.tmpdir(), "aoa-crew-dedicated-claude-home");
    const { capture, cleanup } = await runClaude({
      isolateAmbientConfig: true,
      configEnv: { CLAUDE_CONFIG_DIR: operatorDir },
    });
    try {
      expect(capture.env.CLAUDE_CONFIG_DIR).toBe(operatorDir);
      // Still isolated: the configured dir is an OVERLAY key, so the ambient
      // CLAUDE_*/ANTHROPIC_* strip is unaffected by honoring it.
      expect(capture.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(capture.env.CLAUDE_CODE_OPERATOR_KNOB).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("crew run: the note marks an agent-configured directory as the operator's", async () => {
    const operatorDir = path.join(os.tmpdir(), "aoa-crew-dedicated-claude-home");
    const { commandNotes, cleanup } = await runClaude({
      isolateAmbientConfig: true,
      configEnv: { CLAUDE_CONFIG_DIR: operatorDir },
    });
    try {
      const note = commandNotes.find((n) => n.includes("Ambient Claude config isolated"));
      expect(note).toContain(operatorDir);
      // Without this the note reads as "AoA overrode my setting".
      expect(note).toContain("(agent-configured)");
    } finally {
      await cleanup();
    }
  });

  /**
   * Windows env names are case-insensitive, so `Claude_Config_Dir` in
   * adapterConfig.env IS `CLAUDE_CONFIG_DIR`. Missing that spelling would mint a
   * per-run dir alongside it, leaving the overlay carrying two spellings of ONE
   * variable with different values — both surviving the strip, since both are
   * overlay keys. On POSIX the two ARE distinct variables, so minting is correct
   * there; the assertion follows the platform rather than asserting one answer.
   */
  it("crew run: a differently-cased agent-configured dir is honored on Windows", async () => {
    const operatorDir = path.join(os.tmpdir(), "aoa-crew-oddcase-claude-home");
    const { capture, cleanup } = await runClaude({
      isolateAmbientConfig: true,
      configEnv: { Claude_Config_Dir: operatorDir },
    });
    try {
      const seen = Object.entries(capture.env)
        .filter(([key]) => key.toLowerCase() === "claude_config_dir")
        .map(([, value]) => value)
        .filter((value): value is string => value !== undefined);
      if (process.platform === "win32") {
        // One logical variable ⇒ exactly one value, and it is the operator's.
        expect(new Set(seen)).toEqual(new Set([operatorDir]));
      } else {
        // Distinct variables: the operator's survives AND a per-run dir is minted.
        expect(seen).toContain(operatorDir);
        expect(seen.some((v) => path.basename(v).startsWith("aoa-claude-config-"))).toBe(true);
      }
    } finally {
      await cleanup();
    }
  });

  it("org/heartbeat run: an explicit false is also inert", async () => {
    const { capture, cleanup } = await runClaude({ isolateAmbientConfig: false });
    try {
      expect(capture.env.ANTHROPIC_API_KEY).toBe(AMBIENT_API_KEY);
      expect(capture.env.CLAUDE_CONFIG_DIR).toBe(AMBIENT_CONFIG_DIR);
    } finally {
      await cleanup();
    }
  });

  /**
   * Remote targets are isolated by construction — the child runs in a container
   * or provider sandbox and never sees the host env, so the strip is moot there.
   * Pinning a HOST `os.tmpdir()` path into that child is worse than useless: on a
   * Windows host it forwards a `C:\…` path into a Linux container, and it
   * overrides the managed `HOME` (the runtime root) that is exactly how the CLI
   * would find a correct in-container `~/.claude`.
   */
  it("remote crew run: no per-run pin, and the managed HOME survives", async () => {
    const providerInputs: AdapterProviderSandboxRunInput[] = [];
    const providerRunner = {
      execute: vi.fn(async (input: AdapterProviderSandboxRunInput) => {
        providerInputs.push(input);
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          stderr: "",
          stdout: JSON.stringify({
            type: "result",
            subtype: "success",
            session_id: "claude-session-1",
            result: "ok",
            usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
            total_cost_usd: 0,
          }),
        };
      }),
    };

    const result = await execute({
      runId: "run-remote-crew",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Scout",
        adapterType: "claude_local",
        adapterConfig: {},
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command: "claude", env: {}, timeoutSec: 10, graceSec: 1 },
      context: {},
      executionTarget: {
        type: "provider-sandbox",
        provider: "e2b",
        providerLeaseId: "sandbox-1",
        remoteCwd: "/home/user/aoa-workspace",
        shell: "bash",
        runner: providerRunner,
      },
      runtimeCommandSpec: null,
      isolateAmbientConfig: true,
      onLog: async () => {},
    });

    expect(result.exitCode).toBe(0);
    const runInput = providerInputs.find((input) => input.args.includes("--print"));
    expect(runInput).toBeDefined();
    expect(runInput!.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(runInput!.env.HOME).toBe("/home/user/aoa-workspace/.aoa-runtime/claude");
  });
});
