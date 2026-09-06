import { describe, expect, it } from "vitest";

// -----------------------------------------------------------------------------
// W7U1 — THE OUTPUT PROBE PACK. ONE KEYED RUN, THREE PROBES, THREE-STATE ANSWERS.
//
// A 26-agent decision wave concluded: build no output mechanism, MEASURE FIRST. The
// founder authorised ONE keyed E2B run. This file is what that run executes. It
// BUILDS NOTHING, MUTATES NO GATE, COUNTER OR REGISTER, and touches no database — it
// creates short-TTL sandboxes, writes and reads files inside them, and prints a
// verdict.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE DECISIVE UNKNOWN, AND WHY IT IS IN DOUBT
// ─────────────────────────────────────────────────────────────────────────────
// Can a real `claude` / `codex`, invoked under the EXACT PRODUCTION ARGV, write a
// file inside the sandbox AT ALL?
//
// VERIFIED AT `31d33a3b0`, not inherited from the brief:
//   * `task-run-sandbox-invocation.ts:181-206` holds FOUR script literals and none
//     carries a permission posture — no `--dangerously-skip-permissions`, no
//     `--settings`, no `--allowedTools`, no `--dangerously-bypass-approvals-and-sandbox`.
//     `scripts/lib/__tests__/w7u1-agent-output-probe.test.mjs` pins that in the
//     required `policy` job, so if the premise ever collapses the pack says so
//     without a key.
//   * The shipped product treats the flag as REQUIRED for an unattended run
//     (`claude-local/src/server/execute.ts:745`, `internal-agent/cli-mode.ts:598`,
//     `codex-local/src/server/execute.ts:555`).
//   * And its absence has a UAT-MEASURED consequence on record: without it a
//     `--print` crew run "silently no-op[s] on every MCP tool call (permission gate
//     hangs)" — `resolve-crew-adapter.ts:147-151`.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE INHERITS FROM THE EXISTING KEYED LANE, AND WHAT IT CHANGES
// ─────────────────────────────────────────────────────────────────────────────
// It follows `keyed-cli-008-unit-d-invocation.test.ts` exactly: `describeKeyed` on
// `E2B_API_KEY`, a dynamic `real-transport` import so the no-key run never loads the
// SDK, `withSandbox` teardown in `finally`, and a STATIC import of the production
// emitter so no script literal is duplicated (a pasted copy would be a test of the
// copy).
//
// It changes ONE thing, deliberately: Unit D's lane has no CLI binary in the sandbox
// on purpose — its subject is the invocation SHAPE, and installing an agent would
// have made it an agent-execution test. This lane's subject IS agent execution, so it
// installs the real binary and says so. Everything between `buildSandboxInvocation`
// and the binary's `main` was Unit D's; everything after `main` is this pack's, and
// the two do not overlap.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW TO READ THE RESULT — and why a NO keeps this lane GREEN
// ─────────────────────────────────────────────────────────────────────────────
// Every probe reports yes / no / inconclusive-because-<reason>. A `no` is a RESULT
// and the lane stays green for it: if the only green outcome were "the agent wrote a
// file", then "the agent cannot write" would arrive as a red build, indistinguishable
// from a bad key, a template change or an outage — and the one authorised run would
// have bought an ambiguity instead of an answer. `inconclusive` is the only state
// that reds, because it is the only one that means "run me again".
//
// Without `E2B_API_KEY` this file SKIPS cleanly and claims nothing. The workflow's own
// positive-control step is what stops that skip from reading as success.
//
// SECRETS: the model-provider key is read from the workflow's repo secret, passed to
// the sandbox as a per-command env var, and NEVER printed — every string this file
// emits goes through `redactSecrets`.
// -----------------------------------------------------------------------------

import {
  STAGED_INPUT_DIR,
  buildSandboxInvocation,
} from "../../../../server/src/services/task-run-sandbox-invocation.js";
import {
  classifyProbeAArm,
  formatVerdict,
  isListingUsable,
  packDisposition,
  redactSecrets,
  verdictProbeA,
  verdictProbeB,
  verdictProbeC,
  withPermissionPosture,
} from "../../../../scripts/lib/w7u1-agent-output-probe.mjs";
import { E2bTransportNotFoundError } from "../transport.js";
import type { E2bStagedFile, E2bTransport } from "../transport.js";

const HAS_KEY = typeof process.env.E2B_API_KEY === "string" && process.env.E2B_API_KEY.length > 0;
const describeKeyed = HAS_KEY ? describe : describe.skip;
const TEMPLATE = process.env.E2B_TEMPLATE && process.env.E2B_TEMPLATE.length > 0 ? process.env.E2B_TEMPLATE : "base";

const DEC = new TextDecoder();

/** Every secret value in scope, so nothing this file prints can carry one. */
const SECRETS: string[] = [process.env.E2B_API_KEY, process.env.ANTHROPIC_API_KEY, process.env.OPENAI_API_KEY].filter(
  (v): v is string => typeof v === "string" && v.length > 0,
);
const safe = (text: unknown, max = 1200): string => redactSecrets(String(text ?? ""), SECRETS).slice(0, max);

/** One nonce per RUN, so a file left by an earlier run can never pass an arm. */
const RUN_NONCE = `W7U1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.toUpperCase();

/** The candidate output paths probe B reads BEFORE any exec. */
const CANDIDATE_OUTPUT_PATHS = [
  // The redirect candidate costed in CLI-008-unit-f-design §3.2/§3.4.
  `${STAGED_INPUT_DIR}/.aoa-run-output.jsonl`,
  // Unit D's own staged inputs. If the TEMPLATE pre-fills these, staging is not their
  // only author and the guard at `readableGuard` can pass on bytes nobody staged.
  `${STAGED_INPUT_DIR}/.aoa-run-prompt.md`,
  `${STAGED_INPUT_DIR}/.aoa-run-instructions.md`,
  // Paths this repository's other in-sandbox code names.
  `${STAGED_INPUT_DIR}/output.txt`,
  `${STAGED_INPUT_DIR}/outputs.json`,
  `${STAGED_INPUT_DIR}/aoa-workspace/.aoa-run-output.jsonl`,
  `${STAGED_INPUT_DIR}/.aoa/context.md`,
];

/** The directories probe B enumerates, so "what IS there" is answered, not "is X there". */
const CANDIDATE_DIRS = [STAGED_INPUT_DIR, `${STAGED_INPUT_DIR}/aoa-workspace`, `${STAGED_INPUT_DIR}/.aoa`];

interface AdapterArm {
  readonly adapterType: "claude_local" | "codex_local";
  readonly npmPackage: string;
  readonly binName: string;
  readonly keyEnvVar: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY";
}

const ADAPTER_ARMS: readonly AdapterArm[] = [
  {
    adapterType: "claude_local",
    npmPackage: "@anthropic-ai/claude-code",
    binName: "claude",
    keyEnvVar: "ANTHROPIC_API_KEY",
  },
  { adapterType: "codex_local", npmPackage: "@openai/codex", binName: "codex", keyEnvVar: "OPENAI_API_KEY" },
];

/** Budgets. Deliberately explicit so the operator can price the run (see the runbook).
 *
 * ★ THE TTL IS SIZED PER SANDBOX, AND IT HAS TO BE. Probe A's sandbox must outlive
 * `INSTALL_TIMEOUT_MS + 3 x AGENT_TIMEOUT_MS` = 960 s of in-sandbox work; a single shared
 * 900 s TTL would have expired the sandbox mid-run and reported the expiry as the agent's
 * answer. Probes B and C need seconds, and a generous TTL there would only widen the blast
 * radius of a leak. */
const PROBE_SANDBOX_TTL_MS = 300_000;
const AGENT_SANDBOX_TTL_MS = 1_800_000;
const SHELL_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 420_000;
/** An agent arm's wall clock. A permission-gate stall must TIME OUT, not run to the job cap. */
const AGENT_TIMEOUT_MS = 180_000;

type Channel = "returned" | "timedOut" | "threw" | "not-run" | "binary-missing";

interface Execution {
  readonly channel: Channel;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly detail: string;
}

async function realTransport(): Promise<E2bTransport> {
  // Dynamic so the no-key run neither loads the `e2b` SDK nor requires a key.
  const { RealE2bTransport } = await import("../real-transport.js");
  return new RealE2bTransport({});
}

async function withSandbox<T>(
  lane: string,
  ttlMs: number,
  fn: (t: E2bTransport, sandboxId: string) => Promise<T>,
): Promise<T> {
  const t = await realTransport();
  const { sandboxId } = await t.create({
    templateId: TEMPLATE,
    timeoutMs: ttlMs,
    metadata: { aoa_lane: `w7u1-output-probe-${lane}` },
    envVars: {},
  });
  // eslint-disable-next-line no-console
  console.log(`[w7u1/${lane}] sandboxId = ${sandboxId} (template=${TEMPLATE})`);
  try {
    return await fn(t, sandboxId);
  } finally {
    await t.terminate(sandboxId).catch(() => undefined);
  }
}

/**
 * Run one command and NEVER throw.
 *
 * E7-F014: against real E2B a non-zero exit is converted back to a result by the
 * transport, but a genuine fault still throws — and for a probe a thrown fault is DATA
 * (it names an inconclusive arm), not an error. Recording the channel separately from
 * the exit code is what keeps "no file", "hung" and "exited 127" three different
 * answers instead of one boolean.
 */
async function run(
  t: E2bTransport,
  sandboxId: string,
  command: string,
  args: readonly string[],
  opts: { timeoutMs: number; envVars?: Record<string, string> },
): Promise<Execution> {
  let stdout = "";
  let stderr = "";
  try {
    const res = await t.runCommand(
      { sandboxId, command, args: [...args], envVars: opts.envVars ?? {}, timeoutMs: opts.timeoutMs },
      {
        onStdout: (c) => {
          stdout += c;
        },
        onStderr: (c) => {
          stderr += c;
        },
      },
    );
    return {
      channel: res.timedOut ? "timedOut" : "returned",
      exitCode: res.exitCode,
      stdout,
      stderr,
      detail: `timedOut=${String(res.timedOut)} crashed=${String(res.crashed)}`,
    };
  } catch (err) {
    const e = err as { name?: unknown; message?: unknown };
    const name = typeof e.name === "string" ? e.name : "Error";
    const message = typeof e.message === "string" ? e.message : String(err);
    const timedOut = `${name} ${message}`.toLowerCase().includes("timeout");
    return {
      channel: timedOut ? "timedOut" : "threw",
      exitCode: null,
      stdout,
      stderr,
      detail: `${name}: ${message}`,
    };
  }
}

/** How a read terminated. See READ_ERROR_KINDS in the pure core. */
type ReadErrorKind = "not-found" | "faulted";

interface ReadBack {
  readonly found: boolean;
  readonly content: string | null;
  readonly bytes: number;
  readonly detail: string;
  /** `null` when the read SUCCEEDED. */
  readonly errorKind: ReadErrorKind | null;
}

/**
 * ★★★ THE READ CHANNEL IS CLASSIFIED, NOT FLATTENED.
 *
 * This function used to catch EVERY error and answer `found:false`, which made a
 * transport fault during the readback indistinguishable from "the agent wrote nothing".
 * That is not hypothetical: a reviewer reproduced a transport read fault reporting as
 * `NO — a1-did-not-write-and-the-posture-is-the-cause`, disposition `measured` — an
 * apparatus failure delivered to the operator as a capability answer, on the one
 * authorised run that is supposed to settle the question.
 *
 * The exec-side controls do not cover it. A0 proves the write+read path at the moment A0
 * ran; A1's readback is LATER, not concurrent, and a fault that first appears there is
 * outside A0's scope entirely. So the read gets its own channel.
 *
 * `real-transport.ts:238-249` already draws the line: `readFile` raises
 * `E2bTransportNotFoundError` for a genuine missing sandbox-or-path and rethrows every
 * other error verbatim (`mock-transport.ts:203` raises the same class). So the key is
 * `err instanceof E2bTransportNotFoundError` — nothing is inferred from a message.
 */
function classifyReadError(err: unknown): ReadErrorKind {
  return err instanceof E2bTransportNotFoundError ? "not-found" : "faulted";
}

/** Read a path back. Never throws; a failure is REPORTED with its kind. */
async function readBack(t: E2bTransport, sandboxId: string, path: string): Promise<ReadBack> {
  try {
    const data = await t.readFile(sandboxId, path);
    return { found: true, content: DEC.decode(data), bytes: data.byteLength, detail: "", errorKind: null };
  } catch (err) {
    const e = err as { name?: unknown; message?: unknown };
    return {
      found: false,
      content: null,
      bytes: 0,
      detail: `${typeof e.name === "string" ? e.name : "Error"}: ${typeof e.message === "string" ? e.message : String(err)}`,
      errorKind: classifyReadError(err),
    };
  }
}

function toE2bFiles(files: readonly { path: string; bytes: Uint8Array }[]): E2bStagedFile[] {
  return files.map((f) => ({ path: f.path, bytes: f.bytes }));
}

type Verdict = { probe: string; state: string; reason: string; detail: string };

const inconclusive = (probe: string, reason: string, detail: string): Verdict => ({
  probe,
  state: "inconclusive",
  reason,
  detail,
});

// ─────────────────────────────────────────────────────────────────────────────
// PROBE B — is the TEMPLATE already satisfying a location convention?
// ─────────────────────────────────────────────────────────────────────────────

async function probeB(): Promise<Verdict> {
  return withSandbox("probe-b", PROBE_SANDBOX_TTL_MS, async (t, sandboxId) => {
    // ★ THE CANDIDATE READS HAPPEN FIRST AND USE NO EXEC AT ALL. `readFile` is the
    // E2B files API, not a command, so "before any exec" is literal here. The
    // directory enumeration below IS the sandbox's first command, and is reported as
    // context rather than as the load-bearing observation.
    // ★ EACH CANDIDATE CARRIES ITS READ CHANNEL. A path whose read FAULTED is not a path
    // that is absent, and counting it as absent would feed `template-prefills-nothing`
    // with a path nobody actually looked at. `verdictProbeB` refuses the NO when any
    // candidate read faulted.
    const candidates: {
      path: string;
      exists: boolean;
      bytes: number;
      errorKind: ReadErrorKind | null;
      detail: string;
    }[] = [];
    for (const path of CANDIDATE_OUTPUT_PATHS) {
      const r = await readBack(t, sandboxId, path);
      candidates.push({ path, exists: r.found, bytes: r.bytes, errorKind: r.errorKind, detail: safe(r.detail, 160) });
      // eslint-disable-next-line no-console
      console.log(
        `[w7u1/probe-b] PRE-EXEC ${path}: ` +
          (r.found
            ? `EXISTS (${r.bytes} bytes)`
            : `${r.errorKind === "faulted" ? "READ FAULTED" : "absent"} (${safe(r.detail, 160)})`),
      );
    }

    const entries: string[] = [];
    let listingOk = true;
    let detail = "";
    for (const dir of CANDIDATE_DIRS) {
      const res = await run(t, sandboxId, "sh", ["-c", 'ls -A "$1" 2>&1 || true', "sh", dir], {
        timeoutMs: SHELL_TIMEOUT_MS,
      });
      // ★ A LISTING THAT DID NOT RETURN IS NOT AN EMPTY DIRECTORY. `threw` was handled
      // here before; `timedOut` (and `not-run` / `binary-missing`) fell through and left
      // `listingOk` true, so probe B could report `template-prefills-nothing` on the
      // strength of a command that never finished. Only `returned` is evidence — see
      // `isListingUsable`.
      if (!isListingUsable(res.channel)) {
        listingOk = false;
        detail += `${dir}: channel=${res.channel} ${safe(res.detail, 200)}; `;
        continue;
      }
      const names = res.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const n of names) entries.push(`${dir}/${n}`);
      // eslint-disable-next-line no-console
      console.log(`[w7u1/probe-b] LISTING ${dir} -> ${names.join(" ") || "(empty or missing)"}`);
    }
    return verdictProbeB({ listingOk, entries, candidates, detail }) as Verdict;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE C — does the stream handler deliver from real E2B?
// ─────────────────────────────────────────────────────────────────────────────

async function probeC(): Promise<Verdict> {
  const OUT = "W7U1-STREAM-OUT";
  const ERR = "W7U1-STREAM-ERR";
  return withSandbox("probe-c", PROBE_SANDBOX_TTL_MS, async (t, sandboxId) => {
    const res = await run(
      t,
      sandboxId,
      "sh",
      ["-c", `printf '${OUT}\\n'; printf '${ERR}\\n' 1>&2`],
      { timeoutMs: SHELL_TIMEOUT_MS },
    );
    // eslint-disable-next-line no-console
    console.log(
      `[w7u1/probe-c] channel=${res.channel} exit=${String(res.exitCode)} ` +
        `stdout=${JSON.stringify(safe(res.stdout, 200))} stderr=${JSON.stringify(safe(res.stderr, 200))}`,
    );
    return verdictProbeC({
      ran: res.channel === "returned",
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      stdoutMarker: OUT,
      stderrMarker: ERR,
      detail: res.detail,
    }) as Verdict;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE A — CAN IT WRITE?
// ─────────────────────────────────────────────────────────────────────────────

/** The prompt that asks for a write, and the one that forbids it. */
function writePrompt(target: string, nonce: string): string {
  return [
    "# Task",
    "",
    `Create the file at the absolute path ${target}.`,
    "Its entire contents must be exactly this one line:",
    "",
    nonce,
    "",
    "Use whatever file-writing or shell tool you have. Do not create any other file.",
    "Do not ask any questions. Once the file exists, stop.",
    "",
  ].join("\n");
}

function noWritePrompt(target: string): string {
  return [
    "# Task",
    "",
    "Do NOT create, write, modify or delete any file, anywhere.",
    `In particular, do NOT create ${target}.`,
    "Do not run any shell command.",
    "Reply with the single word OK and stop.",
    "",
  ].join("\n");
}

interface ArmSpec {
  readonly label: "A0" | "A1" | "A2" | "A3";
  readonly what: string;
}

async function probeA(spec: AdapterArm): Promise<Verdict> {
  const probeId = `A/${spec.adapterType}`;
  const key = process.env[spec.keyEnvVar];
  if (typeof key !== "string" || key.length === 0) {
    return inconclusive(
      probeId,
      "no-model-provider-key",
      `${spec.keyEnvVar} is not set, so ${spec.binName} could not be authenticated and the decisive question was not ` +
        "reached. Add it as a repository secret and re-run; see the W7U1 runbook.",
    );
  }

  return withSandbox(`probe-a-${spec.adapterType}`, AGENT_SANDBOX_TTL_MS, async (t, sandboxId) => {
    // ── 0. Is there a runtime to install into? ────────────────────────────────
    //
    // ★ IT REPORTS WHAT IS THERE, NOT ONLY WHAT IS MISSING. If this run comes back
    // `template-has-no-node-runtime`, the operator's one authorised run has bought an
    // inconclusive verdict — and the least it can do is make the NEXT dispatch informed
    // rather than guessed. So the versions and the neighbouring tools are printed too;
    // it costs one extra shell command and nothing else.
    const probe = await run(
      t,
      sandboxId,
      "sh",
      [
        "-c",
        "command -v node || echo NO_NODE; command -v npm || echo NO_NPM; " +
          'echo "node=$(node -v 2>&1 | head -1) npm=$(npm -v 2>&1 | head -1) ' +
          'curl=$(command -v curl || echo none) python3=$(command -v python3 || echo none) ' +
          'os=$(uname -sr 2>&1)"',
      ],
      { timeoutMs: SHELL_TIMEOUT_MS },
    );
    // eslint-disable-next-line no-console
    console.log(`[w7u1/${probeId}] runtime: ${JSON.stringify(safe(probe.stdout, 300))}`);
    if (probe.stdout.includes("NO_NODE") || probe.stdout.includes("NO_NPM")) {
      return inconclusive(
        probeId,
        "template-has-no-node-runtime",
        `template "${TEMPLATE}" has no node/npm, so the agent CLI cannot be installed and probe A never ran. ` +
          `What the template DOES carry: ${safe(probe.stdout, 300).replace(/\s+/g, " ").trim()}. ` +
          "Re-dispatch with an `e2b_template` that carries a node runtime.",
      );
    }

    // ── 1. Install the REAL binary. ───────────────────────────────────────────
    // Plain install first; `sudo` only as a fallback, and the log says which worked.
    const install = await run(
      t,
      sandboxId,
      "sh",
      [
        "-c",
        'npm install -g --no-fund --no-audit "$1" >/dev/null 2>&1 && echo INSTALL_PLAIN && exit 0; ' +
          'sudo npm install -g --no-fund --no-audit "$1" >/dev/null 2>&1 && echo INSTALL_SUDO && exit 0; ' +
          'echo INSTALL_FAILED; npm install -g --no-fund --no-audit "$1" 2>&1 | tail -20; exit 0',
        "sh",
        spec.npmPackage,
      ],
      { timeoutMs: INSTALL_TIMEOUT_MS },
    );
    // eslint-disable-next-line no-console
    console.log(`[w7u1/${probeId}] install: ${JSON.stringify(safe(install.stdout, 800))}`);
    if (install.channel !== "returned" || install.stdout.includes("INSTALL_FAILED")) {
      return inconclusive(
        probeId,
        "cli-install-failed",
        `installing ${spec.npmPackage} did not succeed (channel=${install.channel}): ${safe(install.stdout, 400)}`,
      );
    }

    const which = await run(t, sandboxId, "sh", ["-c", 'command -v "$1" || echo NO_BIN', "sh", spec.binName], {
      timeoutMs: SHELL_TIMEOUT_MS,
    });
    const binary = which.stdout.trim().split("\n").pop() ?? "";
    if (binary.length === 0 || binary.includes("NO_BIN")) {
      return inconclusive(
        probeId,
        "cli-binary-not-on-path",
        `${spec.npmPackage} installed but \`${spec.binName}\` is not on PATH: ${safe(which.stdout, 200)}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(`[w7u1/${probeId}] binary = ${binary}`);

    // ── 2. The four arms. ─────────────────────────────────────────────────────
    const target = (label: string) => `${STAGED_INPUT_DIR}/aoa-w7u1-${spec.adapterType}-${label}.txt`;
    const nonceFor = (label: string) => `${RUN_NONCE}-${label}`;

    /** Every arm asserts its OWN path is absent before it runs. */
    async function preCheck(path: string): Promise<boolean> {
      const r = await readBack(t, sandboxId, path);
      return r.found;
    }

    async function agentArm(label: "A1" | "A2" | "A3", prompt: string, applyPosture: boolean) {
      const path = target(label);
      const nonce = nonceFor(label);
      const preExisted = await preCheck(path);

      const inv = buildSandboxInvocation({
        adapterType: spec.adapterType,
        binary,
        prompt,
        // No bundle: the instructions-bundle branch adds a second staged file and a
        // flag, and neither is the variable under test. Fewer moving parts, same argv
        // shape for the part that matters.
        instructions: null,
      });
      if (inv === null) throw new Error(`buildSandboxInvocation returned null for ${spec.adapterType}`);

      // ★ A2 IS THE ONLY ARM THAT VARIES THE INVOCATION, AND IT VARIES IT HERE — INSIDE THE
      // PROBE. `task-run-sandbox-invocation.ts` is not touched. `withPermissionPosture`
      // THROWS rather than returning the script unchanged, so A2 can never silently
      // become a second copy of A1.
      const args = [...inv.args];
      if (applyPosture) args[1] = withPermissionPosture(String(args[1]), spec.adapterType);

      await t.writeFiles(sandboxId, toE2bFiles(inv.stagedFiles));
      const exec = await run(t, sandboxId, inv.command, args, {
        timeoutMs: AGENT_TIMEOUT_MS,
        envVars: { [spec.keyEnvVar]: key },
      });
      const file = await readBack(t, sandboxId, path);
      // eslint-disable-next-line no-console
      console.log(
        `[w7u1/${probeId}] ${label} posture=${String(applyPosture)} channel=${exec.channel} ` +
          `exit=${String(exec.exitCode)} preExisted=${String(preExisted)} file=${String(file.found)} ` +
          `readErrorKind=${String(file.errorKind)} ` +
          `stdout=${JSON.stringify(safe(exec.stdout, 900))} stderr=${JSON.stringify(safe(exec.stderr, 600))}`,
      );
      return classifyProbeAArm({
        label,
        nonce,
        targetPreExisted: preExisted,
        execution: { channel: exec.channel, exitCode: exec.exitCode, detail: safe(exec.detail, 200) },
        file: { found: file.found, content: file.content, errorKind: file.errorKind, detail: safe(file.detail, 200) },
      });
    }

    // A0 — HARNESS CONTROL. The same shape of file at the same shape of path in the
    // same directory, written by PLAIN SHELL and read back through the SAME transport
    // call. It cannot share A1's exact path without poisoning it (a file A0 left
    // behind would read back as A1's success), so the arms are separated by name and
    // every one of them additionally proves its own path was absent beforehand.
    const a0Path = target("A0");
    const a0Nonce = nonceFor("A0");
    const a0Pre = await preCheck(a0Path);
    const a0Exec = await run(t, sandboxId, "sh", ["-c", 'printf "%s\\n" "$1" > "$2"', "sh", a0Nonce, a0Path], {
      timeoutMs: SHELL_TIMEOUT_MS,
    });
    const a0File = await readBack(t, sandboxId, a0Path);
    // eslint-disable-next-line no-console
    console.log(
      `[w7u1/${probeId}] A0 channel=${a0Exec.channel} exit=${String(a0Exec.exitCode)} ` +
        `preExisted=${String(a0Pre)} file=${String(a0File.found)}`,
    );
    const a0 = classifyProbeAArm({
      label: "A0",
      nonce: a0Nonce,
      targetPreExisted: a0Pre,
      execution: { channel: a0Exec.channel, exitCode: a0Exec.exitCode, detail: safe(a0Exec.detail, 200) },
      file: {
        found: a0File.found,
        content: a0File.content,
        errorKind: a0File.errorKind,
        detail: safe(a0File.detail, 200),
      },
    });

    const a1 = await agentArm("A1", writePrompt(target("A1"), nonceFor("A1")), false);
    const a2 = await agentArm("A2", writePrompt(target("A2"), nonceFor("A2")), true);
    // A3 names its own path in the prompt and forbids writing it. If a file appears
    // there anyway, the agent is not the author of what we are reading and probe A can
    // attribute nothing (E7-F020's class).
    //
    // ★★ A3 CARRIES THE PERMISSION POSTURE — it mirrors A2, not A1, and that is what
    // makes it a control rather than a formality. Under A1's conditions a stalled agent
    // writes nothing no matter what it was asked, so "A3 wrote nothing" would be
    // satisfied by the stall and would prove nothing about attribution. Run under the
    // arm MOST able to write, "asked not to, and did not" is a real statement.
    const a3 = await agentArm("A3", noWritePrompt(target("A3")), true);

    const v = verdictProbeA({ a0, a1, a2, a3 }) as Verdict;
    return { ...v, probe: probeId };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PACK
// ─────────────────────────────────────────────────────────────────────────────

const ARM_SPECS: ArmSpec[] = [
  { label: "A0", what: "HARNESS CONTROL — plain shell writes the file; we read it back" },
  { label: "A1", what: "THE QUESTION — the exact production argv, no permission posture" },
  {
    label: "A2",
    what:
      "THE DIFFERENTIAL — permission posture ADDED inside the probe. The same prompt TEMPLATE as A1, " +
      "differing only in the two lines naming this arm's own target path and nonce (arm separation, as A0 needs)",
  },
  { label: "A3", what: "NEGATIVE CONTROL — a prompt that forbids writing; a file here kills attribution" },
];

function report(verdicts: Verdict[]): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("================ W7U1 OUTPUT PROBE PACK — RESULT ================");
  lines.push(`run nonce: ${RUN_NONCE}   template: ${TEMPLATE}`);
  lines.push("");
  lines.push("Probe A arms:");
  for (const a of ARM_SPECS) lines.push(`  ${a.label}  ${a.what}`);
  lines.push("");
  for (const v of verdicts) lines.push(formatVerdict(v));
  const d = packDisposition(verdicts);
  lines.push("");
  lines.push(`DISPOSITION: ${d.disposition} — ${d.detail}`);
  lines.push("A `no` is a RESULT and this lane stays green for it. Only `inconclusive` reds.");
  lines.push("================================================================");
  lines.push("");
  return lines.join("\n");
}

describeKeyed("W7U1 — the output probe pack, against REAL E2B", () => {
  it(
    "measures whether a real agent under the production argv can write a file, and reports three-state verdicts",
    async () => {
      const verdicts: Verdict[] = [];

      const guarded = async (probe: string, fn: () => Promise<Verdict>): Promise<Verdict> => {
        try {
          return await fn();
        } catch (err) {
          const e = err as { name?: unknown; message?: unknown };
          return inconclusive(
            probe,
            "probe-threw",
            `${typeof e.name === "string" ? e.name : "Error"}: ${safe(typeof e.message === "string" ? e.message : String(err), 400)}`,
          );
        }
      };

      verdicts.push(await guarded("B", probeB));
      verdicts.push(await guarded("C", probeC));
      for (const spec of ADAPTER_ARMS) {
        verdicts.push(await guarded(`A/${spec.adapterType}`, () => probeA(spec)));
      }

      const text = report(verdicts);
      // eslint-disable-next-line no-console
      console.log(text);
      const summaryPath = process.env.GITHUB_STEP_SUMMARY;
      if (typeof summaryPath === "string" && summaryPath.length > 0) {
        const { appendFileSync } = await import("node:fs");
        appendFileSync(summaryPath, `\n\`\`\`\n${text}\n\`\`\`\n`, "utf8");
      }

      const d = packDisposition(verdicts);
      // The measurement itself never fails this assertion — only an apparatus that
      // could not answer does. See the header.
      expect(d.disposition, d.detail).toBe("measured");
    },
    // Two agent sandboxes (install + four arms each) plus two cheap ones. The workflow
    // caps the job at 60 minutes; this budget sits inside it.
    50 * 60 * 1000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// THE READ CHANNEL, PROVEN WITHOUT A KEY
// ─────────────────────────────────────────────────────────────────────────────
//
// ★★★ THIS BLOCK IS NOT `describeKeyed`. Everything else in this file needs a real
// sandbox; the read-channel classification does not, and it is exactly the code whose
// absence turned a transport read fault into
// `NO — a1-did-not-write-and-the-posture-is-the-cause` / disposition `measured`. The
// pure core's own suite proves what a `faulted` kind DOES to a verdict; what it cannot
// reach is the WIRING — that `readBack` produces the kind at all, and keys it off the
// transport's error class rather than a message. That is proven here, on every PR, in
// the same `verify` job as the rest of this package.

describe("W7U1 — readBack classifies the read channel (no key required)", () => {
  const stub = (readFile: (sandboxId: string, path: string) => Promise<Uint8Array>): E2bTransport =>
    ({ readFile }) as unknown as E2bTransport;

  it("a genuine missing path is 'not-found' — a negative result stays admissible", async () => {
    const r = await readBack(
      stub(async () => {
        throw new E2bTransportNotFoundError("sbx-1:/home/user/x.txt");
      }),
      "sbx-1",
      "/home/user/x.txt",
    );
    expect(r.found).toBe(false);
    expect(r.errorKind).toBe("not-found");
    // POSITIVE CONTROL: a not-found read still classifies as a real negative.
    expect(classifyProbeAArm({
      label: "A1",
      nonce: "N",
      targetPreExisted: false,
      execution: { channel: "returned", exitCode: 0 },
      file: { found: r.found, content: r.content, errorKind: r.errorKind, detail: r.detail },
    }).state).toBe("did-not-write");
  });

  it("ANY other throw is 'faulted', and the arm becomes indeterminate rather than a negative", async () => {
    const r = await readBack(
      stub(async () => {
        throw new Error("ECONNRESET: the e2b files channel dropped");
      }),
      "sbx-1",
      "/home/user/x.txt",
    );
    expect(r.found).toBe(false);
    expect(r.errorKind).toBe("faulted");
    expect(r.detail).toContain("ECONNRESET");
    const arm = classifyProbeAArm({
      label: "A1",
      nonce: "N",
      targetPreExisted: false,
      execution: { channel: "returned", exitCode: 0 },
      file: { found: r.found, content: r.content, errorKind: r.errorKind, detail: r.detail },
    });
    expect(arm.state).toBe("indeterminate");
    expect(arm.cause).toBe("read-faulted");
  });

  it("a successful read carries no error kind", async () => {
    const r = await readBack(
      stub(async () => new TextEncoder().encode("W7U1-NONCE\n")),
      "sbx-1",
      "/home/user/x.txt",
    );
    expect(r.found).toBe(true);
    expect(r.errorKind).toBeNull();
    expect(r.content).toContain("W7U1-NONCE");
  });
});
