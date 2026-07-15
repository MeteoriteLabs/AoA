/**
 * Streaming verification-URL detector for interactive CLI logins (Plan 3 / §6.2).
 *
 * `claude login` and `codex login` print an OAuth/device verification URL to
 * stdout (sometimes stderr) and then block waiting for the browser round-trip.
 * We spawn the CLI, tee both streams through this detector, and surface the URL
 * to the founder. Two properties matter:
 *
 *  - **Chunk-boundary safe.** A URL can be split across read chunks, so we
 *    accumulate and only emit once the URL is *terminated* by whitespace or a
 *    quote/angle/backtick — an unterminated tail is treated as "still growing".
 *  - **Idempotent.** Once a URL is found we keep returning it; later log noise
 *    (which may itself contain URLs) never overwrites the login URL.
 *
 * Pure and synchronous — the spawn/lifecycle wiring lives in `streaming-login`.
 */

// A URL is only considered complete when followed by a terminator, so a URL cut
// off at a chunk boundary won't match until the rest (and its terminator) arrive.
const URL_WITH_TERMINATOR = /(https?:\/\/[^\s"'<>`]+)(?=[\s"'<>`])/;

// Guard against unbounded growth when the process emits lots of URL-free output.
// A verification URL is short and appears early; keep only a tail large enough
// that a boundary-straddling URL survives the trim.
const MAX_BUFFER = 64 * 1024;
const TAIL_KEEP = 4 * 1024;

export interface LoginUrlDetector {
  /** Feed a stdout/stderr chunk; returns the verification URL once known, else null. */
  push(chunk: string): string | null;
  /** The URL found so far (null until detected). */
  readonly url: string | null;
}

export function createLoginUrlDetector(): LoginUrlDetector {
  let buffer = "";
  let found: string | null = null;

  return {
    push(chunk: string): string | null {
      if (found !== null) return found;
      buffer += chunk;
      const match = URL_WITH_TERMINATOR.exec(buffer);
      if (match) {
        found = match[1];
        buffer = "";
        return found;
      }
      if (buffer.length > MAX_BUFFER) {
        buffer = buffer.slice(buffer.length - TAIL_KEEP);
      }
      return null;
    },
    get url() {
      return found;
    },
  };
}
