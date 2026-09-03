// server/src/services/task-run-sandbox-invocation.ts
//
// CLI-008 Unit D — THE INVOCATION SHAPE, once the prompt stops being an argv positional.
//
// Unit B built the inbound channel (control plane → object storage → download grant →
// `transport.writeFiles`) and nothing rode it. This module is the thing that rides it: it
// decides, for one canary task run, WHICH files must exist inside the sandbox and WHAT argv
// reads them. Those two answers are produced together, by one function, because a path in the
// argv that no staged file writes is a run that fails at exec — and a staged file no argv
// reads is a byte nobody consumes. `task-run-sandbox-invocation.test.ts` asserts the
// agreement structurally rather than by example: every absolute path in the argv must appear
// in the staged set.
//
// ★ LANE. This targets the **E2B / desktop lane**. The networked/container lane has no
// `stage_files` route (E7-F011) — its boot root ships inert (`docker/worker/Dockerfile:196`
// enters the local daemon bin, and `checkWorkersEnterTheDaemonBin` actively rejects a
// `command:` override that would enter the networked one), so nothing here can reach it. When
// that lane is entered, `ProviderWireDriver.fileStagingMode` is `"none"` and `stageFiles`
// throws `UnsupportedProviderOperation`, which the supervisor turns into a FAILED attempt.
// That is the correct direction — a refusal, not a context-free success — but it is a refusal,
// and this module does not fix it.
//
// ★★ WHY `sh -c` AND NOT THE BINARY DIRECTLY. The sandbox's only execution channel is
// `createSpecFor` → `ExecuteInput{command, args}` → `transport.runCommand`, and the real E2B
// transport `shellJoin`s the whole argv into ONE quoted command string. Quoting is what makes
// argv boundaries survive that collapse — and it is also what makes a bare `<` or `|` in the
// argv a LITERAL, never a redirection. So a redirection must live INSIDE a script that a shell
// is asked to interpret, which is exactly `sh -c "<script>" …`. `ExecuteInput` still has no
// stdin field (E7-F003 row 2 is untouched); the stdin the CLI reads is a redirect the sandbox's
// own shell performs on a file this run staged.
//
// ★★★ NOTHING IS INTERPOLATED INTO THE SCRIPT. The script is a fixed literal per (adapter,
// has-instructions) pair; the binary and both paths ride as SEPARATE argv elements and are
// read back as `$0`, `$1`, `$2`. A founder-supplied `adapterConfig.command` therefore cannot
// close a quote and append a command, no matter what it contains — the property is structural,
// not a sanitizer, and `refuses to interpolate a hostile binary into the script` pins it.

/** The in-sandbox directory this run's control-plane-authored files are staged into.
 *
 * `/home/user` is E2B's default user home — the account `files.write` writes as and
 * `commands.run` executes as — and is the same root the repo's other in-sandbox paths use
 * (`/home/user/aoa-workspace`, the E2B environment runner's cwd). A `/aoa`-style root would
 * need a writable directory at `/` that the template does not create. */
export const STAGED_INPUT_DIR = "/home/user/.aoa-run";

/** The assembled task markdown. Was an argv positional until Unit D; that positional is what
 * `FROZEN_MAX_ARG_CHARS` refused above 8,192 characters (E7-F008). */
export const STAGED_PROMPT_PATH = `${STAGED_INPUT_DIR}/prompt.md`;

/** The agent's instructions bundle entry file — the same bytes the legacy adapters hand to
 * `--append-system-prompt-file` (claude) or prepend to stdin (codex). */
export const STAGED_INSTRUCTIONS_PATH = `${STAGED_INPUT_DIR}/instructions.md`;

/**
 * The exit code the in-sandbox guard uses when a staged file it needs is not readable.
 *
 * ★ WHY A GUARD AT ALL, AND WHY THIS CODE. The staged-input pointer rides `extensions[]` as
 * `critical: false` (Unit B's decision, deliberately unchanged here): a worker that does not
 * understand the namespace ignores it and stages NOTHING. Before Unit D that was harmless —
 * nothing rode the channel. Now the argv depends on it, so such a worker would run
 * `sh -c '… < /home/user/.aoa-run/prompt.md'` against a file that is not there.
 *
 * `sh`'s own diagnostic for that is a redirection failure with exit 2 — indistinguishable from
 * a hundred other shell errors, and for the `cat |` shape not even that (the pipeline's status
 * is the CLI's). 78 is `EX_CONFIG` from `sysexits.h`: no CLI in scope returns it, so it names
 * this cause and only this cause, on stderr, before the agent starts. Fail closed and SAY WHY.
 */
export const STAGED_INPUT_MISSING_EXIT_CODE = 78;

/** The command every sandbox invocation runs. The adapter's real binary is `$0` inside it. */
export const SANDBOX_INVOCATION_COMMAND = "sh";

/** Where the real binary sits in the emitted argv (`sh -c <script> <binary> …`). */
export const SANDBOX_INVOCATION_BINARY_ARG_INDEX = 2;

export interface SandboxInvocation {
  /** Always {@link SANDBOX_INVOCATION_COMMAND}. */
  readonly command: string;
  readonly args: readonly string[];
  /** The absolute in-sandbox paths this argv reads. Every one MUST be staged. */
  readonly requiredPaths: readonly string[];
}

/**
 * The readable-or-refuse preamble, over the script's positional parameters.
 *
 * Emitted for `$1 … $n` where n is the number of staged paths, so it can never check a
 * parameter the invocation does not pass (an unset `$2` would expand to an empty string and
 * `[ -r "" ]` is false — a guard that fails the run for a file it never needed).
 */
function readableGuard(pathCount: number): string {
  const params = Array.from({ length: pathCount }, (_, i) => `"$${i + 1}"`).join(" ");
  return (
    `for f in ${params}; do [ -r "$f" ] || ` +
    `{ echo "[cli-008] staged input missing: $f" >&2; exit ${STAGED_INPUT_MISSING_EXIT_CODE}; }; done`
  );
}

/**
 * Build the sandbox invocation for one adapter.
 *
 * `null` for an adapter with no shape — kept as a refusal rather than a throw so widening the
 * disposition matrix without widening this switch fails closed instead of emitting a
 * claude-shaped argv for an unrelated binary.
 *
 * ★ THE SHAPES MIRROR THE LEGACY ADAPTERS, which is the whole point of Unit D. `claude` is
 * spawned `--print -` with the prompt on stdin and the bundle on
 * `--append-system-prompt-file` (`claude-local/src/server/execute.ts:736-772, :879`); `codex`
 * is spawned `exec --json -` with the bundle PREPENDED to the stdin prompt, because codex has
 * no append-system-prompt flag (`codex-local/src/server/execute.ts:498-518, :565`). The
 * distributed path now delivers the same three things through the same two flags.
 *
 * ★★ WHAT IS DELIBERATELY NOT MIRRORED: the legacy path appends a *path directive* to the
 * instructions — "resolve any relative file references from <host dir>". That directive names
 * a HOST directory which does not exist in the sandbox, and the bundle's SIBLING files
 * (`HEARTBEAT.md`, `SOUL.md`, `TOOLS.md`) are not staged either. Emitting it would send the
 * agent hunting a directory that is not there. Staging the whole bundle directory needs
 * `--add-dir` and a multi-file staging shape; that is Unit E's workspace work, and until then
 * a relative reference inside the entry file is unresolvable in the sandbox. This is a KNOWN
 * gap of Unit D, and it is a sub-case of E7-F003 row 1 rather than a new finding.
 */
export function buildSandboxInvocation(input: {
  readonly adapterType: string;
  /** The adapter's real binary, already resolved from `runtimeCommandSpec`. */
  readonly binary: string;
  readonly hasInstructions: boolean;
}): SandboxInvocation | null {
  const paths = input.hasInstructions
    ? [STAGED_PROMPT_PATH, STAGED_INSTRUCTIONS_PATH]
    : [STAGED_PROMPT_PATH];
  const guard = readableGuard(paths.length);

  let script: string;
  switch (input.adapterType) {
    case "claude_local":
      script = input.hasInstructions
        ? `${guard}; exec "$0" --print - --output-format stream-json --verbose --append-system-prompt-file "$2" < "$1"`
        : `${guard}; exec "$0" --print - --output-format stream-json --verbose < "$1"`;
      break;
    case "codex_local":
      // No `--append-system-prompt-file` equivalent exists, so the bundle is concatenated
      // ahead of the prompt on stdin — byte-for-byte what the legacy codex adapter does in
      // process. `cat` is the last-but-one stage of a pipeline, so the invocation's exit
      // code is still codex's own.
      script = input.hasInstructions
        ? `${guard}; cat "$2" "$1" | "$0" exec --json -`
        : `${guard}; exec "$0" exec --json - < "$1"`;
      break;
    default:
      return null;
  }

  return {
    command: SANDBOX_INVOCATION_COMMAND,
    args: ["-c", script, input.binary, ...paths],
    requiredPaths: paths,
  };
}
