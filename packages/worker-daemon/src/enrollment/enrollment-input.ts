// packages/worker-daemon/src/enrollment/enrollment-input.ts
//
// DSK-001 — the reader for `config.enrollmentCodeSource`.
//
// The config parser retains the SOURCE (a file path or an env-var name) and
// deliberately never the code itself. Nothing read that source until now: it is
// parsed at startup and has zero consumers. This closes that.
//
// Three properties here are security properties, not ergonomics.
//
// **The returned field is `enrollmentCode`, never `code`.** The daemon logger
// redacts by substring against `SENSITIVE_SUBSTRINGS`, which contains
// `"enrollmentcode"` and does NOT contain `"code"`
// (`packages/worker-daemon/src/logging/logger.ts:37-49`). So the same value
// prints in full under a `code` key and `[redacted]` under an `enrollmentCode`
// key. The NAME is the mitigation, which is exactly the kind of thing that gets
// "tidied" later by someone shortening a field — hence this note.
//
// **A path source must be LOCAL, and that is checked BEFORE the read.**
// `parseEnrollmentCodeSource` validates only non-emptiness and mutual exclusion;
// it performs no locality check. Reading a UNC path is an authenticated SMB round
// trip to a host somebody else chose: it leaks the fact and timing of an
// enrolment, and it invites a hostile file. Rejecting after the read would be
// pointless — the round trip has already happened.
//
// **No failure ever echoes what was read.** A malformed ticket file must not put
// its bytes into an exception that then lands in a log or a crash report. The
// ticket codec holds the same rule; this layer must not undo it.

import { decodeEnrollmentTicket } from "./ticket.js";

/** Mirrors the shape `parseEnrollmentCodeSource` produces. */
export type EnrollmentCodeSource =
  | { readonly kind: "env"; readonly envVar: string }
  | { readonly kind: "path"; readonly path: string };

export interface EnrollmentInput {
  readonly targetId: string;
  /** Named so the daemon logger redacts it. See the note above. */
  readonly enrollmentCode: string;
}

export class EnrollmentInputError extends Error {
  constructor(message: string) {
    super(`enrollment input rejected: ${message}`);
    this.name = "EnrollmentInputError";
  }
}

/**
 * Reject anything that is not a plain local absolute path.
 *
 * Deliberately an allowlist of one shape rather than a denylist of hostile ones:
 * a denylist over Windows path syntax is a losing game (`\\?\UNC\`, `//`,
 * `\\.\`, mapped drives, `\??\`), and the legitimate case is narrow enough to
 * state positively.
 */
function assertLocalAbsolutePath(path: string): void {
  if (path.length === 0) throw new EnrollmentInputError("path is empty");
  const normalized = path.replace(/\//g, "\\");
  if (normalized.startsWith("\\\\")) {
    // Covers UNC (`\\host\share`), the long-path UNC form (`\\?\UNC\...`), and
    // the device namespace (`\\.\pipe\...`).
    throw new EnrollmentInputError("path is not local (UNC or device namespace)");
  }
  // A drive-letter absolute path is the only accepted shape. A relative path
  // resolves against whatever cwd the host happened to start in, which is not
  // something an enrolment should depend on.
  if (!/^[A-Za-z]:\\/.test(normalized)) {
    throw new EnrollmentInputError("path is not an absolute local path");
  }
}

/** Strip exactly one trailing newline, as every text editor appends. */
function trimOneTrailingNewline(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  if (text.endsWith("\n")) return text.slice(0, -1);
  return text;
}

/**
 * Resolve the enrollment ticket to its two fields.
 *
 * `readFileText` is injected so the locality check is provable without a
 * filesystem — and so a test can assert the read NEVER HAPPENED for a hostile
 * path, which is the property that actually matters.
 */
export function readEnrollmentInput(
  source: EnrollmentCodeSource,
  env: Record<string, string | undefined>,
  readFileText: (path: string) => string,
): EnrollmentInput {
  let raw: string;
  if (source.kind === "env") {
    const value = env[source.envVar];
    if (value === undefined || value.trim() === "") {
      // Names the VARIABLE, never its contents.
      throw new EnrollmentInputError(`environment variable ${source.envVar} is not set`);
    }
    raw = value;
  } else {
    // BEFORE the read. A rejection afterwards has already leaked the attempt.
    assertLocalAbsolutePath(source.path);
    try {
      raw = readFileText(source.path);
    } catch {
      // Deliberately does not include the underlying error, which on some
      // platforms embeds the path or a partial read.
      throw new EnrollmentInputError("enrollment ticket file could not be read");
    }
  }

  let ticket;
  try {
    ticket = decodeEnrollmentTicket(trimOneTrailingNewline(raw.trim()));
  } catch (err) {
    // Re-wrapped so no layer can accidentally widen the message to include the
    // input. The codec's own errors already name only the failing constraint;
    // this preserves that without trusting a future edit to it.
    const constraint = err instanceof Error ? err.message : "unknown constraint";
    throw new EnrollmentInputError(constraint.replace(/^enrollment ticket rejected: /, ""));
  }

  return { targetId: ticket.targetId, enrollmentCode: ticket.code };
}
