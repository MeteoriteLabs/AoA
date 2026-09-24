// -----------------------------------------------------------------------------
// DEP-019 — the reference provider's DETERMINISTIC SCRIPTED COMMAND EXECUTION.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// `DEP-016` gave the fake CANNED USAGE, but it gave it on the CONTRACT driver's
// `invoke("execute")` result (`{kind:"executed", usage}`) — a shape only a HARNESS reads.
// A DEPLOYED worker never sees it: the authoritative per-op port's `ExecuteResult`
// (`packages/worker-daemon/src/supervisor/provider.ts`) carries
// `{providerOpId, exitCode, signal, timedOut, stdoutRef, stderrRef}` and has NO usage field
// at all. The worker derives usage from the run's STDOUT, through the optional stream
// channel (`ExecuteInput.onStdout`, WRK-018) and `createUsageObserver`
// (`packages/worker-daemon/src/supervisor/usage-observer.ts`), which parses the
// `claude --output-format stream-json` FINAL result line.
//
// So for a deployed worker to price a run on the reference provider, the fake must do the
// one thing it has never done: EXECUTE — emit a deterministic transcript on the stdout
// channel and return a real `ExecuteResult`. That is this module.
//
// ── The script is carried by the JOB, not by a control call ──────────────────
// The `DEP-016` usage mode is scripted per PROVIDER ID through the fake's control endpoint
// (`/script`). A worker-driven journey cannot use that: the provider id is minted inside the
// worker, so the harness has no id to script. The script therefore rides the TENANT COMMAND's
// own `args` — which the job envelope carries and the harness controls when it seeds the job.
// Flags are namespaced `--aoa-fake-*`; anything else is an ordinary agent argument and is
// ignored, so a real-looking command line still runs.
//
// FAIL-CLOSED: an UNRECOGNISED `--aoa-fake-*` flag, or a malformed value, THROWS. A scripted
// control that silently degraded to the default would make every positive control vacuous —
// the profile would assert "usage suppressed reds" while the provider quietly reported canned
// units.
//
// ── Determinism ──────────────────────────────────────────────────────────────
// No clock, no randomness, no filesystem: the transcript is a pure function of
// `(args, usage)`, and `providerOpId` is supplied by the caller. Two runs of the same command
// produce byte-identical stdout. `runtimeMillis` is deliberately NOT in the transcript's
// contract for the worker: the supervisor measures it around `execute` and the observer
// overrides whatever the agent claims, so this module reports the canned `duration_ms` only
// as the shape claude writes, never as an expectation.
// -----------------------------------------------------------------------------

import { FAKE_PROVIDER_CANNED_USAGE_V1, type FakeProviderUsageMode, type FakeProviderUsageV1 } from "./fake-driver.js";
import { NodeEvalRefusedError, classifyShellInvocation, type NodeEvalRunner } from "./node-eval.js";

/** The namespace every scripting flag carries. An argument outside it is an ordinary agent
 * argument and is passed over without comment. */
export const SCRIPT_FLAG_PREFIX = "--aoa-fake-";

/** Raised when the scripted command line cannot be read EXACTLY. Never a default. */
export class ScriptedCommandError extends Error {
  constructor(detail: string) {
    super(`sandbox-fake-provider: refusing to execute a scripted command — ${detail}`);
    this.name = "ScriptedCommandError";
  }
}

/** What one scripted command line asks the reference provider to do. */
export interface ScriptedCommandPlan {
  /** `canned` (default) writes the stream-json result line with the canned units;
   * `suppressed` writes NO result line at all, so a stream-json parser finds no usage. */
  readonly usageMode: FakeProviderUsageMode;
  /** The process exit code the sandbox reports. Default `0`. */
  readonly exitCode: number;
  /** When true, `execute` reports the provider's own deadline verdict: `exitCode: null`,
   * `signal: "SIGKILL"`, `timedOut: true` — the shape `E2bSandboxProvider.execute` returns on
   * an exhausted budget. Default `false`. */
  readonly timedOut: boolean;
  /**
   * How long `execute` stays IN FLIGHT before it writes its transcript, in milliseconds.
   * Default `0` — no wait, and the sync entry point stays usable.
   *
   * ★ WHY A DELAY IS A CONTROL AND NOT A CONVENIENCE. `M1-D1-SPINE`'s
   * `d1.reconcile.worker_startup_lease_probe` needs a worker restarted WHILE it holds a live
   * lease over an in-flight run, so that the restarted worker's startup probe meets a REAL
   * lease offer it can decode and refuse as fenced. A provider whose `execute` returns
   * immediately gives the harness no window to restart anything: the run is terminal before
   * the restart lands, the offer is gone, and the probe has nothing to refuse. This flag is
   * that window, and it is the reason the case can fire at all.
   */
  readonly delayMs: number;
}

/**
 * The upper bound on `--aoa-fake-delay`. A scripted wait is a BOUNDED wait: an unbounded one
 * would let a single job envelope park a provider worker for as long as it liked, and the
 * supervisor's own `withDeadline` race would then be the only thing that ended it — a bound
 * enforced by the wrong half. Ten minutes is far above any D1 restart window (seconds) and far
 * below any plausible accident.
 */
export const SCRIPTED_COMMAND_MAX_DELAY_MS = 600_000;

export const DEFAULT_SCRIPTED_COMMAND_PLAN: ScriptedCommandPlan = Object.freeze({
  usageMode: "canned",
  exitCode: 0,
  timedOut: false,
  delayMs: 0,
});

function parseFlagValue(flag: string, raw: string | undefined): string {
  if (raw === undefined || raw === "") {
    throw new ScriptedCommandError(`${flag} requires a value (use ${flag}=<value>)`);
  }
  return raw;
}

/**
 * Read the scripting flags out of a tenant command line.
 *
 * Only `--aoa-fake-*` arguments are interpreted. The recognised set is CLOSED:
 *
 *   `--aoa-fake-usage=canned|suppressed`
 *   `--aoa-fake-exit=<non-negative safe integer>`
 *   `--aoa-fake-timeout`            (no value; the exhausted-budget verdict)
 *   `--aoa-fake-delay=<0..SCRIPTED_COMMAND_MAX_DELAY_MS>`  (the in-flight window)
 *
 * Every other `--aoa-fake-*` argument throws, as does a repeated flag (a repeat means two
 * callers disagree about the script and the last one would silently win).
 */
export function parseScriptedCommand(args: readonly string[]): ScriptedCommandPlan {
  let usageMode: FakeProviderUsageMode | undefined;
  let exitCode: number | undefined;
  let timedOut: boolean | undefined;
  let delayMs: number | undefined;

  for (const arg of args) {
    if (!arg.startsWith(SCRIPT_FLAG_PREFIX)) continue;
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const rawValue = eq === -1 ? undefined : arg.slice(eq + 1);

    switch (flag) {
      case `${SCRIPT_FLAG_PREFIX}usage`: {
        if (usageMode !== undefined) throw new ScriptedCommandError(`${flag} appears more than once`);
        const value = parseFlagValue(flag, rawValue);
        if (value !== "canned" && value !== "suppressed") {
          throw new ScriptedCommandError(`${flag} must be "canned" or "suppressed", got ${JSON.stringify(value)}`);
        }
        usageMode = value;
        break;
      }
      case `${SCRIPT_FLAG_PREFIX}exit`: {
        if (exitCode !== undefined) throw new ScriptedCommandError(`${flag} appears more than once`);
        const value = parseFlagValue(flag, rawValue);
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 0) {
          throw new ScriptedCommandError(`${flag} must be a non-negative safe integer, got ${JSON.stringify(value)}`);
        }
        exitCode = parsed;
        break;
      }
      case `${SCRIPT_FLAG_PREFIX}timeout`: {
        if (timedOut !== undefined) throw new ScriptedCommandError(`${flag} appears more than once`);
        if (rawValue !== undefined) throw new ScriptedCommandError(`${flag} takes no value`);
        timedOut = true;
        break;
      }
      case `${SCRIPT_FLAG_PREFIX}delay`: {
        if (delayMs !== undefined) throw new ScriptedCommandError(`${flag} appears more than once`);
        const value = parseFlagValue(flag, rawValue);
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < 0) {
          throw new ScriptedCommandError(`${flag} must be a non-negative safe integer, got ${JSON.stringify(value)}`);
        }
        if (parsed > SCRIPTED_COMMAND_MAX_DELAY_MS) {
          throw new ScriptedCommandError(
            `${flag} must be at most ${SCRIPTED_COMMAND_MAX_DELAY_MS} ms, got ${JSON.stringify(value)}`,
          );
        }
        delayMs = parsed;
        break;
      }
      default:
        throw new ScriptedCommandError(`unrecognised scripting flag ${JSON.stringify(flag)}`);
    }
  }

  return {
    usageMode: usageMode ?? DEFAULT_SCRIPTED_COMMAND_PLAN.usageMode,
    exitCode: exitCode ?? DEFAULT_SCRIPTED_COMMAND_PLAN.exitCode,
    timedOut: timedOut ?? DEFAULT_SCRIPTED_COMMAND_PLAN.timedOut,
    delayMs: delayMs ?? DEFAULT_SCRIPTED_COMMAND_PLAN.delayMs,
  };
}

/**
 * The transcript the scripted command writes to stdout, as the chunks the stream channel
 * delivers them in.
 *
 * It is the `claude --output-format stream-json` shape, because that is the format the
 * worker's own usage observer parses (`parseClaudeStreamJsonUsage`). Three properties are
 * load-bearing and each is asserted by this module's tests:
 *
 *   1. the FINAL non-empty line is the `type:"result"` event — the observer reads that line
 *      and no other;
 *   2. its `usage` object uses claude's OWN field names (`input_tokens`, `output_tokens`,
 *      `cache_read_input_tokens`), which is what the observer maps;
 *   3. under `suppressed` the result line is ABSENT ENTIRELY — not a result line with a
 *      missing `usage`, which would be a different (and weaker) control: the observer treats
 *      both as "no usage", but only a missing line also proves the LINE is what it reads.
 *
 * More than one chunk on purpose: a single-chunk transcript would let a consumer that only
 * ever reads the first chunk pass.
 */
export function buildScriptedStdoutChunks(
  plan: ScriptedCommandPlan,
  usage: FakeProviderUsageV1 = FAKE_PROVIDER_CANNED_USAGE_V1,
): readonly string[] {
  const chunks: string[] = [
    `${JSON.stringify({ type: "system", subtype: "init", session_id: "aoa-fake-reference-session" })}\n`,
    `${JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "reference provider scripted run" }] },
    })}\n`,
  ];
  if (plan.usageMode === "canned") {
    chunks.push(
      `${JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: usage.runtimeMillis,
        result: "reference provider scripted run complete",
        usage: {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cache_read_input_tokens: usage.cachedInputTokens,
        },
      })}\n`,
    );
  }
  return Object.freeze(chunks);
}

/** The per-op port's `ExecuteInput`, mirrored structurally (this package imports no
 * worker-daemon types — see the mirror note in `per-op-provider.ts`). */
export interface ScriptedExecuteInput {
  readonly sandboxId: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly onStdout?: (chunk: string) => void;
}

/** The per-op port's `ExecuteResult`, mirrored structurally. */
export interface ScriptedExecuteResult {
  readonly providerOpId: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly stdoutRef: string;
  readonly stderrRef: string;
}

export interface ScriptedExecuteOptions {
  /** The op's wall-clock budget. `<= 0` is the exhausted-budget verdict, enforced HERE and
   * BEFORE the transcript, exactly as `E2bSandboxProvider.execute` enforces it — a caller must
   * never be able to observe output from a run whose budget was already spent. */
  readonly deadlineMs: number;
  readonly providerOpId: string;
  /** Overrides the canned units (the D1 lane never does; the tests do). */
  readonly usage?: FakeProviderUsageV1;
  /**
   * DEP-019 — the runner for the `DEP-017` env-absence probe (`node-eval.ts`).
   *
   * The probe is not a transcript to be scripted: it is a PROGRAM whose output must be a
   * genuine observation of the sandbox env, so it is EXECUTED. A recognised probe invocation
   * reaching a caller that supplied no runner THROWS — returning the scripted transcript
   * instead would hand the worker a run that reads as a probe that found nothing, which is
   * the fabricated pass `DEP-016` acceptance item 6 forbids.
   */
  readonly runNodeEval?: NodeEvalRunner;
  /**
   * DEP-019 (Codex P1, PR #572) — the SHA-256 digests of the probe scripts this provider may
   * execute. Authenticating only the wrapper authenticates the wrong half: the wrapper is public
   * and `$0` comes from the job envelope. Absent or empty ⇒ every shell invocation is refused.
   */
  readonly allowedProbeScriptDigests?: ReadonlySet<string>;
  /**
   * DEP-019 (Codex P2, PR #572) — the metadata endpoint the probe may OBSERVE. The pinned script
   * `fetch`es `argv[2]`, so pinning the script alone still lets a job choose the address.
   */
  readonly allowedProbeMetadataUrl?: string;
  /**
   * The wait `--aoa-fake-delay` is performed with, injected so a test pins it instead of
   * sleeping. Default: a real (unref'd) `setTimeout`. Only ever consulted by
   * {@link executeScriptedCommandAsync}.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // A scripted wait must never be the reason a process refuses to exit: the run's verdict is
    // owned by the caller's own deadline race, not by this timer.
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      (timer as { unref: () => void }).unref();
    }
  });
}

/** What the pre-plan stages decided: either the whole verdict (budget short-circuit, probe), or
 * the plan the transcript stages still have to run. */
type ScriptedPrelude =
  | { readonly kind: "result"; readonly result: ScriptedExecuteResult }
  | { readonly kind: "plan"; readonly plan: ScriptedCommandPlan };

/**
 * Stages 1-2 of `execute`, shared by the sync and async entry points so neither can drift from
 * the other on the order that matters: the exhausted-budget short-circuit, then the probe
 * classification, then the scripting flags.
 */
function scriptedPrelude(
  input: ScriptedExecuteInput,
  options: ScriptedExecuteOptions,
  stdoutRef: string,
  stderrRef: string,
): ScriptedPrelude {
  if (options.deadlineMs <= 0) {
    return {
      kind: "result",
      result: {
        providerOpId: options.providerOpId,
        exitCode: null,
        signal: "SIGKILL",
        timedOut: true,
        stdoutRef,
        stderrRef,
      },
    };
  }

  // DEP-019 — the DEP-017 probe is EXECUTED, never scripted. Classified BEFORE the scripting
  // flags are read: the probe's argv is the daemon's, and a `--aoa-fake-*` look-alike inside it
  // must not be able to steer the fake. ★ That ordering is also what keeps `--aoa-fake-delay`
  // off the probe: the probe has its own deadline, and a scripted wait inside it would delay a
  // control the daemon times independently.
  const invocation = classifyShellInvocation(input.command, input.args, input.env, {
    allowedScriptDigests: options.allowedProbeScriptDigests,
    allowedMetadataUrl: options.allowedProbeMetadataUrl,
  });
  if (invocation.kind === "node_eval") {
    if (options.runNodeEval === undefined) {
      throw new NodeEvalRefusedError(
        "a DEP-017 probe invocation reached a provider with no node-eval runner; this provider will not answer a probe with canned output",
      );
    }
    const ran = options.runNodeEval(invocation.request);
    // The probe prints ONE line on stdout and the worker reads it from the run's capture, so
    // the channel is the only delivery. stderr is NOT relayed: the port carries an opaque
    // `stderrRef`, and the probe's own no-node marker is a stderr contract of the daemon's.
    input.onStdout?.(ran.stdout);
    return {
      kind: "result",
      result: {
        providerOpId: options.providerOpId,
        exitCode: ran.exitCode,
        signal: ran.signal,
        timedOut: false,
        stdoutRef,
        stderrRef,
      },
    };
  }

  return { kind: "plan", plan: parseScriptedCommand(input.args) };
}

/** Stages 3-4: the transcript, then the verdict. Pure once the plan is known. */
function finishScriptedCommand(
  input: ScriptedExecuteInput,
  options: ScriptedExecuteOptions,
  plan: ScriptedCommandPlan,
  stdoutRef: string,
  stderrRef: string,
): ScriptedExecuteResult {
  const onStdout = input.onStdout;
  if (onStdout !== undefined) {
    for (const chunk of buildScriptedStdoutChunks(plan, options.usage)) onStdout(chunk);
  }

  if (plan.timedOut) {
    return {
      providerOpId: options.providerOpId,
      exitCode: null,
      signal: "SIGKILL",
      timedOut: true,
      stdoutRef,
      stderrRef,
    };
  }
  return {
    providerOpId: options.providerOpId,
    exitCode: plan.exitCode,
    signal: null,
    timedOut: false,
    stdoutRef,
    stderrRef,
  };
}

/**
 * Run a scripted command deterministically, SYNCHRONOUSLY.
 *
 * Order is deliberate and mirrors the real provider:
 *   1. the zero/negative-budget short-circuit, before any output;
 *   2. the DEP-017 probe classification (executed, never scripted);
 *   3. the scripted plan is parsed (a bad script THROWS — no output, no result);
 *   4. the transcript is streamed chunk by chunk to `onStdout`, if a channel was given;
 *   5. the verdict is returned.
 *
 * ★ The transcript is written EVEN under `--aoa-fake-timeout`, after step 1's short-circuit
 * does not apply: a run that produced output and then exceeded its own command budget is a
 * real shape, and keeping it separate from "the budget was already gone" is what makes the two
 * timeout paths distinguishable. Nothing here logs, persists or forwards a chunk; the channel
 * is the only consumer, as the port requires.
 *
 * ★★★ A NON-ZERO `--aoa-fake-delay` IS REFUSED HERE, NOT IGNORED. A synchronous function
 * cannot wait, and the flag's whole purpose is the in-flight window a restart lands inside — so
 * silently returning at once would hand the caller a run that looks scripted-to-wait and did
 * not. That is exactly the FAIL-CLOSED shape this module's header demands of every scripting
 * flag: a silently-dropped flag makes every positive control built on it vacuous. Callers that
 * may see the flag use {@link executeScriptedCommandAsync}; `createFakeSandboxProviderPort` does.
 */
export function executeScriptedCommand(
  input: ScriptedExecuteInput,
  options: ScriptedExecuteOptions,
): ScriptedExecuteResult {
  const stdoutRef = `ref:stdout:${input.sandboxId}`;
  const stderrRef = `ref:stderr:${input.sandboxId}`;
  const prelude = scriptedPrelude(input, options, stdoutRef, stderrRef);
  if (prelude.kind === "result") return prelude.result;
  if (prelude.plan.delayMs > 0) {
    throw new ScriptedCommandError(
      `${SCRIPT_FLAG_PREFIX}delay=${prelude.plan.delayMs} needs the asynchronous entry point; ` +
        "executeScriptedCommand cannot wait and will not silently drop the delay",
    );
  }
  return finishScriptedCommand(input, options, prelude.plan, stdoutRef, stderrRef);
}

/**
 * Run a scripted command deterministically, honouring `--aoa-fake-delay`.
 *
 * Identical to {@link executeScriptedCommand} in every stage and in their order, with ONE
 * addition: between the plan and the transcript it waits `plan.delayMs`.
 *
 * ★ THE WAIT IS BEFORE THE TRANSCRIPT, DELIBERATELY. The window the D1 reconcile case restarts
 * a worker inside is a window in which the run is still in flight and the worker still holds
 * its lease — so nothing may have been written yet. Waiting AFTER the transcript would leave a
 * run whose usage had already been streamed, which a restarted worker's probe could not
 * distinguish from a finished one.
 *
 * ★ IT DOES NOT POLICE ITS OWN DEADLINE, and that is the correct half. `options.deadlineMs` is
 * the op budget the CALLER races (`withDeadline` in the supervisor, and the adapter-manager's
 * own op deadline); a delay that outlasts it must surface as the caller's `execute_timeout`,
 * which is a real provider-overrun shape. A second deadline here would invent a verdict the
 * port has no field for and would hide the overrun a case may want to observe. The flag's own
 * bound is `SCRIPTED_COMMAND_MAX_DELAY_MS`, enforced at parse time.
 */
export async function executeScriptedCommandAsync(
  input: ScriptedExecuteInput,
  options: ScriptedExecuteOptions,
): Promise<ScriptedExecuteResult> {
  const stdoutRef = `ref:stdout:${input.sandboxId}`;
  const stderrRef = `ref:stderr:${input.sandboxId}`;
  const prelude = scriptedPrelude(input, options, stdoutRef, stderrRef);
  if (prelude.kind === "result") return prelude.result;
  if (prelude.plan.delayMs > 0) await (options.sleep ?? defaultSleep)(prelude.plan.delayMs);
  return finishScriptedCommand(input, options, prelude.plan, stdoutRef, stderrRef);
}
