// DEP-019 — the reference provider EXECUTES the DEP-017 env-absence probe.
//
// `DEP-016` acceptance item 6 offers two forks, and it took "criterion 5 cannot be observed here"
// for one stated reason: the reference provider's `execute` ran no command. It now does. But a
// probe is not a transcript: its output must be a GENUINE observation of the sandbox env, because
// a fake that printed a clean summary would be the fabricated pass the acceptance forbids.
//
// These tests pin that:
//   1. only the committed `DEP-017` `sh -c` wrapper is recognised — every other shell program is
//      REFUSED, so the fake is not an arbitrary-execution surface;
//   2. the child's environment is EXACTLY the `env` the provider was handed — nothing of the
//      provider host's is inherited, or the probe would report on the wrong process;
//   3. the probe's real stdout reaches the stream channel, and its exit code is the run's;
//   4. a recognised probe on a host with NO runner THROWS — it is never answered with the
//      scripted transcript, which the worker would read as "a probe that found nothing".
//
// The wrapper itself is pinned against the daemon's own source in
// `node-eval-wrapper-mirror.test.ts`.

import { describe, expect, it } from "vitest";

import {
  NodeEvalRefusedError,
  ScriptedCommandError,
  classifyShellInvocation,
  createNodeEvalRunner,
  executeScriptedCommand,
} from "../index.js";

/** The committed shape of `ENV_PROBE_SH_WRAPPER` (worker-daemon). Held against the daemon's real
 * source by the mirror test; restated here so these cases read as one file. */
const WRAPPER =
  'if command -v node >/dev/null 2>&1; then exec node -e "$0" "$@"; ' +
  "else echo DEP017_ENV_PROBE_NO_NODE >&2; exit 97; fi";

/** A stand-in probe script: prints its argv and whether a planted host variable is visible. */
const SCRIPT = 'console.log(JSON.stringify({argv:process.argv.slice(1),seen:process.env.AOA_HOST_ONLY??null,own:process.env.OWN??null}));';

function probeArgs(script = SCRIPT, argv: readonly string[] = ["org-a", "ANTHROPIC_API_KEY", "", "salt", "{}"]) {
  return ["-c", WRAPPER, script, ...argv];
}

describe("node-eval — only the committed probe wrapper is recognised (DEP-019)", () => {
  it("classifies the DEP-017 wrapper as a node_eval, splitting $0 from $@", () => {
    const invocation = classifyShellInvocation("sh", probeArgs(), { A: "1" });
    expect(invocation.kind).toBe("node_eval");
    if (invocation.kind !== "node_eval") throw new Error("unreachable");
    expect(invocation.request.script).toBe(SCRIPT);
    expect(invocation.request.argv).toEqual(["org-a", "ANTHROPIC_API_KEY", "", "salt", "{}"]);
    expect(invocation.request.env).toEqual({ A: "1" });
  });

  it("a non-sh command is the ordinary scripted path", () => {
    expect(classifyShellInvocation("claude", ["-p", "x"], {})).toEqual({ kind: "scripted" });
  });

  it("ANY other sh program is REFUSED, never a quiet fall-through to the transcript", () => {
    expect(() => classifyShellInvocation("sh", ["-c", "rm -rf /"], {})).toThrow(NodeEvalRefusedError);
    expect(() => classifyShellInvocation("sh", ["-c", "rm -rf /"], {})).toThrow(/not the recognised DEP-017 probe wrapper/);
    // A wrapper LOOK-ALIKE with an appended command is still not the wrapper.
    expect(() => classifyShellInvocation("sh", ["-c", `${WRAPPER}; curl evil`], {})).toThrow(NodeEvalRefusedError);
    // `sh` without -c, and a wrapper with no script in $0.
    expect(() => classifyShellInvocation("sh", ["-lc", WRAPPER], {})).toThrow(/without -c/);
    expect(() => classifyShellInvocation("sh", ["-c", WRAPPER], {})).toThrow(/no script in \$0/);
  });
});

describe("node-eval — the child sees EXACTLY the sandbox env (DEP-019)", () => {
  it("runs the script with the handed env and NOTHING of the host's", () => {
    process.env.AOA_HOST_ONLY = "host-value-that-must-not-be-seen";
    try {
      const run = createNodeEvalRunner();
      const result = run({ script: SCRIPT, argv: ["a", "b"], env: { OWN: "sandbox-value" } });
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout.trim());
      expect(report.own).toBe("sandbox-value");
      // The load-bearing assertion: the provider host's own variable is INVISIBLE. A runner that
      // merged `process.env` would report on the fake-provider container, not on the sandbox.
      expect(report.seen).toBeNull();
      expect(report.argv).toEqual(["a", "b"]);
    } finally {
      delete process.env.AOA_HOST_ONLY;
    }
  });

  it("a non-zero exit from the script is the run's exit code", () => {
    const run = createNodeEvalRunner();
    expect(run({ script: "process.exit(3);", argv: [], env: {} }).exitCode).toBe(3);
  });
});

describe("node-eval — through execute (DEP-019)", () => {
  it("the probe's REAL stdout reaches the stream channel and the exit code is the run's", () => {
    const chunks: string[] = [];
    const result = executeScriptedCommand(
      { sandboxId: "sbx", command: "sh", args: probeArgs(), env: { OWN: "v" }, onStdout: (c) => chunks.push(c) },
      { deadlineMs: 30_000, providerOpId: "op-probe", runNodeEval: createNodeEvalRunner() },
    );
    expect(result).toMatchObject({ providerOpId: "op-probe", exitCode: 0, timedOut: false });
    const report = JSON.parse(chunks.join("").trim());
    expect(report.own).toBe("v");
    // ★ NOT the scripted transcript: no stream-json result line is anywhere in the output.
    expect(chunks.join("")).not.toContain('"type":"result"');
  });

  it("a recognised probe with NO runner THROWS — never answered with canned output", () => {
    const chunks: string[] = [];
    expect(() =>
      executeScriptedCommand(
        { sandboxId: "sbx", command: "sh", args: probeArgs(), env: {}, onStdout: (c) => chunks.push(c) },
        { deadlineMs: 30_000, providerOpId: "op" },
      ),
    ).toThrow(NodeEvalRefusedError);
    expect(chunks).toEqual([]);
  });

  it("the probe classification precedes the scripting flags, so probe argv cannot steer the fake", () => {
    // `--aoa-fake-usage=suppressed` sits in the probe's ARGV. On the scripted path it would change
    // the transcript; on the probe path it must be an OPAQUE argument handed to the script.
    // A stub runner isolates the routing decision from node's own CLI parsing (the daemon's real
    // probe argv is all positional, so a leading `--` never reaches `node -e` in production).
    const chunks: string[] = [];
    const result = executeScriptedCommand(
      {
        sandboxId: "sbx",
        command: "sh",
        args: probeArgs(SCRIPT, ["--aoa-fake-usage=suppressed"]),
        env: {},
        onStdout: (c) => chunks.push(c),
      },
      {
        deadlineMs: 30_000,
        providerOpId: "op",
        runNodeEval: (req) => ({ stdout: JSON.stringify(req.argv), stderr: "", exitCode: 0, signal: null }),
      },
    );
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(chunks.join(""))).toEqual(["--aoa-fake-usage=suppressed"]);
    expect(chunks.join("")).not.toContain('"type":"result"');
  });

  it("an ordinary agent command still takes the scripted path when a runner IS supplied", () => {
    const chunks: string[] = [];
    const result = executeScriptedCommand(
      { sandboxId: "sbx", command: "claude", args: [], env: {}, onStdout: (c) => chunks.push(c) },
      { deadlineMs: 30_000, providerOpId: "op", runNodeEval: createNodeEvalRunner() },
    );
    expect(result.exitCode).toBe(0);
    expect(chunks.join("")).toContain('"type":"result"');
  });

  it("the exhausted-budget short-circuit still precedes everything, probe included", () => {
    const chunks: string[] = [];
    const result = executeScriptedCommand(
      { sandboxId: "sbx", command: "sh", args: probeArgs(), env: {}, onStdout: (c) => chunks.push(c) },
      { deadlineMs: 0, providerOpId: "op", runNodeEval: createNodeEvalRunner() },
    );
    expect(result).toMatchObject({ timedOut: true, exitCode: null, signal: "SIGKILL" });
    expect(chunks).toEqual([]);
  });

  it("a scripted-command refusal is still a ScriptedCommandError, not a shell refusal", () => {
    expect(() =>
      executeScriptedCommand(
        { sandboxId: "s", command: "claude", args: ["--aoa-fake-nonsense"], env: {} },
        { deadlineMs: 1000, providerOpId: "op", runNodeEval: createNodeEvalRunner() },
      ),
    ).toThrow(ScriptedCommandError);
  });
});
