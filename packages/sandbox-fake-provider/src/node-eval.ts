// -----------------------------------------------------------------------------
// DEP-019 — running the DEP-017 env-absence probe FAITHFULLY on the reference provider.
//
// ── The question this answers ────────────────────────────────────────────────
// `DEP-016` acceptance item 6 offers two forks: make the reference provider execute the
// `DEP-017` probe command faithfully, or record that criterion 5 is observed only in the
// `DEP-015` lane. `DEP-016` took the second fork for a reason that was true then and is not
// true now — *"the reference provider's `execute` runs no command"*. `scripted-command.ts`
// removes it. This module removes the other half: the probe is not a transcript to be
// scripted, it is a PROGRAM whose output must be a genuine observation, and a fake that
// printed a clean summary would be exactly the fabricated pass the acceptance forbids.
//
// ── What "faithfully" means here, stated precisely ───────────────────────────
// The probe reads `process.env` INSIDE the sandbox and reports which credential classes are
// present (`packages/worker-daemon/src/supervisor/env-probe.ts`). A D1 reference "sandbox" is
// not an image: it has no baked environment of its own. Its environment is EXACTLY the `env`
// the provider was handed on `ExecuteInput`. So running the probe in a CHILD PROCESS whose
// environment is exactly that map, with NOTHING inherited from the provider host, is a true
// observation of the thing the probe is for — the stage-in env the control plane and the
// worker assembled.
//
// ★ AND WHAT IT CANNOT SEE, so the record cannot be misread: on this lane the probe observes
// the STAGE-IN env only. It cannot observe a template-baked credential or a provider-host
// credential, because a reference sandbox has neither. The keyed `DEP-015` lane is where
// those two classes are observed. This narrowing belongs in the profile's evidence, not in a
// comment alone.
//
// ── Fail-closed, three ways ──────────────────────────────────────────────────
//   1. NOT ARBITRARY EXECUTION. Only the committed `sh -c` wrapper `DEP-017` builds is
//      recognised, matched structurally; every other shell program is REFUSED. The fake is a
//      test double on a closed internal network, but "run whatever the job asked for" is a
//      capability, and a capability nothing needs is one nobody audits.
//   2. NO ENVIRONMENT IS INHERITED. The child's env is the request's map and nothing else —
//      never `process.env`, not even merged. A merge would make the probe report on the
//      provider host and turn a clean lane red for a reason that is not the run's.
//   3. NO SILENT SUBSTITUTE. A recognised probe invocation on a host that was not given a
//      runner THROWS. Returning the scripted transcript instead would hand the worker a run
//      that looks like a probe that found nothing — the fabricated pass, exactly.
// -----------------------------------------------------------------------------

import { spawnSync } from "node:child_process";

/** Raised when a shell invocation is not the recognised probe wrapper, or when a recognised
 * one reaches a host with no runner. Never a fallback. */
export class NodeEvalRefusedError extends Error {
  constructor(detail: string) {
    super(`sandbox-fake-provider: refusing the shell invocation — ${detail}`);
    this.name = "NodeEvalRefusedError";
  }
}

/**
 * The structural shape of `ENV_PROBE_SH_WRAPPER`
 * (`packages/worker-daemon/src/supervisor/env-probe.ts`):
 *
 *   `if command -v node >/dev/null 2>&1; then exec node -e "$0" "$@"; else echo <marker> >&2; exit <n>; fi`
 *
 * Matched by SHAPE rather than by byte equality so the marker and the exit code stay the
 * daemon's business, and pinned against the daemon's own source by
 * `__tests__/node-eval-wrapper-mirror.test.ts` — if the wrapper is ever rewritten, that test
 * fails here rather than the lane failing as an unexplained `env_probe_not_run`.
 */
export const NODE_EVAL_WRAPPER_PATTERN =
  /^if command -v node >\/dev\/null 2>&1; then exec node -e "\$0" "\$@"; else echo \S+ >&2; exit \d+; fi$/;

/** A recognised `node -e` invocation: the script is `$0` and the rest are its arguments. */
export interface NodeEvalRequest {
  readonly script: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export type ShellInvocation =
  | { readonly kind: "node_eval"; readonly request: NodeEvalRequest }
  | { readonly kind: "scripted" };

/**
 * Decide what a tenant command is.
 *
 * Anything that is not `sh -c <recognised wrapper>` is `scripted` — the deterministic
 * transcript path, which is what an ordinary agent command gets. A `sh -c` whose program is
 * NOT the recognised wrapper is a REFUSAL, never a quiet fall-through to the transcript: a
 * shell program the fake does not understand must not be answered with a success.
 */
export function classifyShellInvocation(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): ShellInvocation {
  if (command !== "sh") return { kind: "scripted" };
  if (args[0] !== "-c") {
    throw new NodeEvalRefusedError(`sh invoked without -c (args[0] = ${JSON.stringify(args[0] ?? null)})`);
  }
  const program = args[1];
  if (typeof program !== "string" || !NODE_EVAL_WRAPPER_PATTERN.test(program)) {
    throw new NodeEvalRefusedError(
      "the shell program is not the recognised DEP-017 probe wrapper; this provider runs no other shell program",
    );
  }
  const script = args[2];
  if (typeof script !== "string" || script === "") {
    throw new NodeEvalRefusedError("the probe wrapper carries no script in $0");
  }
  return { kind: "node_eval", request: { script, argv: args.slice(3).map(String), env } };
}

export interface NodeEvalResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export type NodeEvalRunner = (request: NodeEvalRequest) => NodeEvalResult;

export interface NodeEvalRunnerOptions {
  /** The Node binary. Defaults to the running one — the reference provider's own image. */
  readonly execPath?: string;
  /** Wall-clock ceiling for one probe. The probe's own metadata observation self-aborts at
   * 3s; this is the outer bound so a wedged child cannot hold the run's op budget. */
  readonly timeoutMs?: number;
  /** Bytes of stdout/stderr kept. The probe prints ONE line; a larger cap would only let a
   * misbehaving script consume the host. */
  readonly maxBufferBytes?: number;
}

/**
 * The real runner: `node -e <script> <argv…>` in a child process whose environment is EXACTLY
 * the request's map.
 *
 * `env` is passed WHOLE, never spread over `process.env` — see fail-closed rule 2. Windows
 * note: `spawnSync` on win32 still injects a handful of system variables it needs; the D1
 * reference provider runs on Linux, and the unit tests assert the absence of a planted host
 * variable rather than an exact env equality, so the assertion holds on both.
 */
export function createNodeEvalRunner(options: NodeEvalRunnerOptions = {}): NodeEvalRunner {
  const execPath = options.execPath ?? process.execPath;
  const timeout = options.timeoutMs ?? 15_000;
  const maxBuffer = options.maxBufferBytes ?? 1_000_000;
  return (request) => {
    const result = spawnSync(execPath, ["-e", request.script, ...request.argv], {
      env: { ...request.env },
      encoding: "utf8",
      timeout,
      maxBuffer,
      windowsHide: true,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status,
      signal: result.signal === undefined ? null : result.signal,
    };
  };
}
