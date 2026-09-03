// server/src/services/task-run-instructions-bundle.ts
//
// CLI-008 Unit D — read the agent's instructions bundle entry file off the HOST, so it can be
// staged into the sandbox.
//
// The legacy adapters read this file in process and hand it to the CLI: claude writes a
// combined temp file and passes `--append-system-prompt-file`
// (`claude-local/src/server/execute.ts:626-633, :766-769`); codex prepends it to the stdin
// prompt (`codex-local/src/server/execute.ts:498-518`). The distributed path has no host
// filesystem to point at, so the control plane reads the same bytes here and Unit B's channel
// puts them inside the sandbox.
//
// ★★★ THE WHOLE VALUE OF THIS MODULE IS THE THREE-WAY DISTINCTION IT REFUSES TO COLLAPSE.
//
//   | outcome | meaning | what the canary does |
//   |---|---|---|
//   | `configured: false` | this agent has no bundle | run without one — legal and common |
//   | `ok`                | bytes in hand            | stage them |
//   | `unreadable`        | a bundle IS configured and we could not read it | STAY LEGACY |
//
// A two-way shape (`string | null`) would fold the third row into the first, and the result is
// the exact failure this ticket exists to eliminate: a canary agent runs in a sandbox WITHOUT
// its identity, produces something plausible, terminalizes cleanly, and satisfies every clause
// the acceptance verifier asserts. Nothing downstream can tell that run from a good one.
//
// ★ THIS DIVERGES FROM THE LEGACY CODEX ADAPTER ON PURPOSE. That adapter logs a warning on an
// unreadable bundle and continues (`execute.ts:512-521`), which is defensible on the legacy
// path: a human is watching the run's log stream. On the canary path nobody is, and the run is
// being used as EVIDENCE that distributed execution works. Refusing sends the run to the
// legacy executor, where it behaves exactly as it does today.
//
// ★★ PATH RESOLUTION MIRRORS THE ADAPTERS EXACTLY, INCLUDING WHAT THEY DO NOT DO. Absolute
// paths are used as-is; a relative path resolves against `adapterConfig.cwd` when that is
// absolute (the legacy contract stated in `agent-instructions.ts:165-174`) and is otherwise a
// refusal. There is deliberately NO `~` expansion and no managed-root fallback, because the
// point is that the distributed path reads the SAME FILE the legacy path would. A resolver
// that were cleverer than the adapters would stage bytes no legacy run has ever used.

import path from "node:path";

/** The `adapterConfig` key both v1 adapters read. Not re-derived here — read verbatim. */
export const INSTRUCTIONS_FILE_PATH_KEY = "instructionsFilePath";

export type TaskRunInstructionsRefusal =
  /** `instructionsFilePath` is relative and `adapterConfig.cwd` is missing or not absolute. */
  | "unresolvable_path"
  /** The file is configured but could not be read (absent, permissions, a directory, …). */
  | "unreadable";

export type TaskRunInstructionsBundle =
  /** No bundle is configured for this agent. Legal: the invocation omits the bundle flag. */
  | { readonly ok: true; readonly configured: false }
  /** A bundle is configured and its bytes are in hand. */
  | { readonly ok: true; readonly configured: true; readonly hostPath: string; readonly content: string }
  /** A bundle is configured and could NOT be produced. The run must stay legacy. */
  | { readonly ok: false; readonly reason: TaskRunInstructionsRefusal; readonly detail: string };

export interface ResolveTaskRunInstructionsBundleInput {
  /** The run-scoped adapter config (`runScopedConfig`) — the same object the adapter reads. */
  readonly adapterConfig: Record<string, unknown> | null | undefined;
  /** Injected so this is testable without a filesystem. Defaults to `fs.readFile(…,"utf8")`. */
  readonly readFile?: (absolutePath: string) => Promise<string>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the instructions bundle entry file for one canary task run.
 *
 * Never throws: every failure direction is an explicit outcome, because the caller's job is to
 * choose between "stage this" and "stay legacy" and an exception would make that choice by
 * accident somewhere up the stack.
 */
export async function resolveTaskRunInstructionsBundle(
  input: ResolveTaskRunInstructionsBundleInput,
): Promise<TaskRunInstructionsBundle> {
  const config = input.adapterConfig ?? {};
  const configured = asNonEmptyString(config[INSTRUCTIONS_FILE_PATH_KEY]);
  if (configured === null) return { ok: true, configured: false };

  let hostPath: string;
  if (path.isAbsolute(configured)) {
    hostPath = configured;
  } else {
    const cwd = asNonEmptyString(config.cwd);
    if (!cwd || !path.isAbsolute(cwd)) {
      return {
        ok: false,
        reason: "unresolvable_path",
        detail: `relative instructionsFilePath "${configured}" needs an absolute adapterConfig.cwd`,
      };
    }
    hostPath = path.resolve(cwd, configured);
  }

  const readFile =
    input.readFile ??
    (async (absolutePath: string) => {
      const fs = await import("node:fs/promises");
      return fs.readFile(absolutePath, "utf8");
    });

  try {
    const content = await readFile(hostPath);
    return { ok: true, configured: true, hostPath, content };
  } catch (error) {
    return {
      ok: false,
      reason: "unreadable",
      // The PATH, never the bytes: this string reaches a log line and the legacy-owner
      // `detail` field, and a bundle can carry operating context a founder would not expect
      // to find in an aggregated log.
      detail: `${hostPath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
