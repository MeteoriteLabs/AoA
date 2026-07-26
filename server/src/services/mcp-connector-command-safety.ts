/**
 * @fileoverview Decision #116 clause 7 — a stdio connector command must be a
 * known LAUNCHER running an EXACT-version-pinned registry package, with no shell
 * interpolation and no code-injection flags. Enforced at the shared create
 * chokepoint (BOTH BYO + catalog, EVERY deployment mode) and re-checked at
 * delivery so legacy/imported/direct-DB rows fail closed.
 *
 * HONEST SCOPE (Codex plan review): this authorizes a package IDENTITY + shape.
 * It does NOT make stdio non-arbitrary — an approved package's entry point, build
 * backend, lifecycle scripts, and transitive deps still execute. Registry/config
 * pinning + distribution integrity + OS sandboxing are SEPARATE layers (tracked).
 * What this closes: `sh -c ...`, `node -e ...`, `npx --package/--call`,
 * `uvx --from git+...`, unpinned/`@latest` packages, and shell metacharacters.
 */

/** Thrown on an unsafe command; the caller maps it to a 400. */
export class ConnectorCommandUnsafeError extends Error {
  constructor(
    message: string,
    /** Stable machine reason for deliverability projection + skip handling. */
    readonly reason:
      | "not_a_launcher"
      | "disallowed_character"
      | "disallowed_flag"
      | "unpinned_package"
      | "no_package"
      | "missing_command",
  ) {
    super(message);
    this.name = "ConnectorCommandUnsafeError";
  }
}

// `node` is deliberately EXCLUDED — it permits `-e`/`--eval`/preload = arbitrary
// code with no package identity. Docker is deferred. Curated catalog uses npx
// (Node) + uvx (Python).
const ALLOWED_LAUNCHERS = new Set(["npx", "uvx"]);

// Per-launcher flag allowlist — every other flag is rejected (closed grammar).
const ALLOWED_FLAGS: Record<string, ReadonlySet<string>> = {
  npx: new Set(["-y", "--yes"]),
  uvx: new Set<string>(),
};

// Shell command-control characters: chaining (; & |), substitution ($ `),
// redirection (< >), and newlines. AoA spawns WITHOUT a shell, so these are never
// meaningful in a real argv token for npx/uvx — rejecting them is a guard against
// a future shell:true path or a launcher that re-enters a shell. Deliberately NOT
// rejected: spaces, backslashes (Windows paths), quotes, globs — all legitimate
// in a literal server argument and harmless without a shell.
const DISALLOWED_CHAR = /[;&|`$<>\n\r]/;

// Exact version pin: optional `@scope/`, package name, `@`, then a fully-numeric
// version (major.minor[.patch...]) + optional prerelease/build. Rejects ranges
// (^ ~ >= x *), tags (@latest, @next), URLs, git refs, and local paths.
const PINNED_PACKAGE =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@\d+(?:\.\d+)+(?:[-+][0-9A-Za-z][0-9A-Za-z.-]*)?$/i;

/**
 * Assert a stdio connector `command` + `args` are safe to persist and later
 * spawn. Throws {@link ConnectorCommandUnsafeError} on the first violation.
 * No-op-safe to call on http connectors' behalf is the caller's job — only call
 * this for `transport === "stdio"`.
 */
export function assertStdioCommandSafe(
  command: string | null | undefined,
  args: readonly string[] | null | undefined,
): void {
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new ConnectorCommandUnsafeError("stdio connector requires a command", "missing_command");
  }
  const launcher = command.trim();
  const argv = args ?? [];

  if (!ALLOWED_LAUNCHERS.has(launcher)) {
    throw new ConnectorCommandUnsafeError(
      `"${launcher}" is not an allowed connector launcher (allowed: ${[...ALLOWED_LAUNCHERS].join(", ")})`,
      "not_a_launcher",
    );
  }

  for (const tok of [command, ...argv]) {
    if (typeof tok !== "string" || DISALLOWED_CHAR.test(tok)) {
      throw new ConnectorCommandUnsafeError(
        `connector command contains a disallowed character: ${JSON.stringify(tok)}`,
        "disallowed_character",
      );
    }
  }

  const allowedFlags = ALLOWED_FLAGS[launcher];
  let sawPackage = false;
  for (const a of argv) {
    if (!sawPackage && a.startsWith("-")) {
      if (a === "--") continue; // end-of-flags marker; next positional is the package
      if (!allowedFlags.has(a)) {
        throw new ConnectorCommandUnsafeError(
          `connector command flag "${a}" is not allowed for ${launcher}`,
          "disallowed_flag",
        );
      }
      continue;
    }
    if (!sawPackage) {
      if (!PINNED_PACKAGE.test(a)) {
        throw new ConnectorCommandUnsafeError(
          `connector package "${a}" must be an exact-version-pinned registry package ` +
            `(e.g. "pkg@1.2.3") — ranges, tags (@latest), URLs, git, and local paths are rejected`,
          "unpinned_package",
        );
      }
      sawPackage = true;
      continue;
    }
    // Positionals after the package are server args — already char-checked above.
  }

  if (!sawPackage) {
    throw new ConnectorCommandUnsafeError(
      `connector command "${launcher}" has no package to run`,
      "no_package",
    );
  }
}

/** Non-throwing predicate for the deliverability projection (skip-not-throw). */
export function isStdioCommandSafe(
  command: string | null | undefined,
  args: readonly string[] | null | undefined,
): boolean {
  try {
    assertStdioCommandSafe(command, args);
    return true;
  } catch {
    return false;
  }
}
