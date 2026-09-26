import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  RUN_OUTPUT_PROBE_TAG,
  ScriptedCommandError,
  executeScriptedCommand,
  parseScriptedCommand,
} from "../scripted-command.js";

// -----------------------------------------------------------------------------
// DEP-023 — `--aoa-fake-echo-env=<NAME>`: the PLANTED LEAK the E5 audit matrix's clause 5 needs.
//
// Nothing on the reference-provider lane ever emitted a run's redeemed credential, so the
// clause-5 case's "clean stream" was VACUOUS: `scrubEventStrings` had nothing to substitute and
// its marker never appeared. This flag is the leak; the worker's two capture scrubbers are what
// catch it. Fail-closed, like every other scripting flag — an echo that did not happen is never
// silently reported as one.
// -----------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

function runScript(args: readonly string[], env: Record<string, string> = {}) {
  const chunks: string[] = [];
  const result = executeScriptedCommand(
    { sandboxId: "sbx-1", command: "claude", args, env, onStdout: (c) => chunks.push(c) },
    { deadlineMs: 60_000, providerOpId: "op-1" },
  );
  return { result, stdout: chunks.join(""), chunks };
}

describe("--aoa-fake-echo-env (DEP-023)", () => {
  it("DEP-027 emits an intrinsic nonce on planted and truly unseeded probe lines", () => {
    const planted = runScript(
      ["--aoa-fake-probe-nonce=graded-0123456789abcdef", "--aoa-fake-echo-env=ANTHROPIC_API_KEY"],
      { ANTHROPIC_API_KEY: "planted-canary-value" },
    );
    expect(planted.chunks[0]).toBe(
      `${RUN_OUTPUT_PROBE_TAG} arm=graded-0123456789abcdef ANTHROPIC_API_KEY=planted-canary-value\n`,
    );

    const unseeded = runScript([
      "--aoa-fake-probe-nonce=withheld-0123456789abcdef",
      "--aoa-fake-control-canary=inert-0123456789abcdef",
    ], {});
    expect(unseeded.chunks[0]).toBe(
      `${RUN_OUTPUT_PROBE_TAG} arm=withheld-0123456789abcdef control=inert-0123456789abcdef\n`,
    );
  });

  it("DEP-027 refuses missing, malformed and repeated probe nonces", () => {
    expect(() => parseScriptedCommand(["--aoa-fake-echo-env=ANTHROPIC_API_KEY"])).toThrow(ScriptedCommandError);
    expect(() => parseScriptedCommand(["--aoa-fake-probe-nonce=spaces are unsafe"])).toThrow(ScriptedCommandError);
    expect(() => parseScriptedCommand(["--aoa-fake-probe-nonce=short"])).toThrow(ScriptedCommandError);
    expect(() =>
      parseScriptedCommand([
        "--aoa-fake-probe-nonce=graded-0123456789abcdef",
        "--aoa-fake-probe-nonce=other-0123456789abcdef",
      ]),
    ).toThrow(ScriptedCommandError);
  });

  it("echoes the named variable's value on a TAGGED line, FIRST, before the transcript", () => {
    const { stdout, chunks } = runScript(["--aoa-fake-probe-nonce=graded-0123456789abcdef", "--aoa-fake-echo-env=ANTHROPIC_API_KEY"], {
      ANTHROPIC_API_KEY: "planted-canary-value",
    });
    expect(chunks[0]).toBe(`${RUN_OUTPUT_PROBE_TAG} arm=graded-0123456789abcdef ANTHROPIC_API_KEY=planted-canary-value\n`);
    // ★ FIRST, not last, and this is load-bearing: `parseClaudeStreamJsonUsage` reads the FINAL
    // non-empty line and nothing else, so an echo written last would silently suppress usage.
    const lines = stdout.split("\n").filter((l) => l.length > 0);
    expect(JSON.parse(lines[lines.length - 1]!).type).toBe("result");
  });

  it("is ABSENT by default — a transcript byte-identical to the pre-DEP-023 one", () => {
    const { stdout } = runScript([], { ANTHROPIC_API_KEY: "planted-canary-value" });
    expect(stdout).not.toContain(RUN_OUTPUT_PROBE_TAG);
    expect(stdout).not.toContain("planted-canary-value");
    expect(parseScriptedCommand([]).echoEnvName).toBeUndefined();
  });

  it("FAILS CLOSED when the named variable is not in the sandbox env", () => {
    // A silently-skipped echo would make the clause-5 case pass over a stream that never carried
    // the value — the vacuous pass the case exists to prevent.
    const args = ["--aoa-fake-probe-nonce=graded-0123456789abcdef", "--aoa-fake-echo-env=ANTHROPIC_API_KEY"];
    expect(() => runScript(args, {})).toThrow(ScriptedCommandError);
    expect(() => runScript(args, { ANTHROPIC_API_KEY: "" })).toThrow(
      ScriptedCommandError,
    );
  });

  it("FAILS CLOSED when the caller supplies NO stdout channel (Codex P2, PR #602)", () => {
    // The channel is the echo's ONLY delivery. Validating inside a `if (onStdout !== undefined)`
    // guard would skip both this refusal and the missing-variable one, and the provider would
    // return a SUCCESS for a plant that never happened — a silently vacuous control.
    expect(() =>
      executeScriptedCommand(
        { sandboxId: "sbx-1", command: "claude", args: ["--aoa-fake-probe-nonce=graded-0123456789abcdef", "--aoa-fake-echo-env=ANTHROPIC_API_KEY"], env: { ANTHROPIC_API_KEY: "v" } },
        { deadlineMs: 60_000, providerOpId: "op-1" },
      ),
    ).toThrow(ScriptedCommandError);
    // …and a no-channel caller WITHOUT the flag is still perfectly valid, unchanged.
    expect(
      executeScriptedCommand(
        { sandboxId: "sbx-1", command: "claude", args: [], env: {} },
        { deadlineMs: 60_000, providerOpId: "op-1" },
      ).exitCode,
    ).toBe(0);
  });

  it("refuses a malformed, repeated or valueless flag", () => {
    expect(() => parseScriptedCommand(["--aoa-fake-echo-env"])).toThrow(ScriptedCommandError);
    expect(() => parseScriptedCommand(["--aoa-fake-echo-env="])).toThrow(ScriptedCommandError);
    expect(() => parseScriptedCommand(["--aoa-fake-echo-env=A", "--aoa-fake-echo-env=B"])).toThrow(
      ScriptedCommandError,
    );
    // Not an env NAME: a permissive value would let a job envelope write arbitrary bytes onto the
    // run's stdout under the probe tag.
    expect(() => parseScriptedCommand(["--aoa-fake-echo-env=a b"])).toThrow(ScriptedCommandError);
    expect(() => parseScriptedCommand(["--aoa-fake-echo-env=1BAD"])).toThrow(ScriptedCommandError);
  });

  it("★ the mirrored tag is IDENTICAL to the worker-daemon's own constant", () => {
    // This package takes no dependency on the worker-daemon (the same reason `ScriptedExecuteInput`
    // mirrors the port), so the tag is a copy — and a copy that drifts makes the D1 clause-5 case
    // select nothing while every unit test here still passes.
    const source = readFileSync(
      path.join(repoRoot, "packages/worker-daemon/src/supervisor/run-output-probe.ts"),
      "utf8",
    );
    const match = /export const RUN_OUTPUT_PROBE_TAG = "([^"]+)";/.exec(source);
    expect(match?.[1]).toBe(RUN_OUTPUT_PROBE_TAG);
  });
});
