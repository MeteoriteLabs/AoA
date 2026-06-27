/**
 * Hardening helpers for the one-shot extraction CLI spawns (claude / codex).
 *
 * These spawns feed ARBITRARY untrusted discussion text into a local CLI. Even
 * with tools disabled (claude `--tools ""` + `--strict-mcp-config`; codex
 * `--sandbox read-only`), two defense-in-depth controls belong on every such
 * spawn and are single-sourced here so the claude and codex paths can't drift:
 *
 *   1. buildScrubbedCliEnv — never hand the child the AoA server's own secrets
 *      (the embeddings OPENAI_API_KEY, GITHUB_PAT, DATABASE_URL, AOA_* internals,
 *      generic *_SECRET/PASSWORD). The child needs PATH/HOME/etc. and at most its
 *      OWN vendor auth var, which the caller opts back in via `keep`.
 *
 *   2. MAX_CLI_*_BYTES + appendCapped — a prompt-injected/looping model can emit
 *      an unbounded stream; the hand-rolled spawns buffer stdout into a string
 *      for the whole timeout window, so without a cap that is a memory-exhaustion
 *      DoS. Callers stop reading (and kill the child) once the cap is hit.
 */

/** Exact env keys that are always stripped (AoA-internal / infra secrets). */
const ALWAYS_DROP_EXACT = new Set([
  "GITHUB_PAT",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "REDIS_URL",
]);

/**
 * Vendor auth env that SOME CLI may read for auth. Dropped by default so a
 * different vendor's CLI never sees it; the caller re-adds its own via `keep`
 * (claude → ANTHROPIC_API_KEY; codex → OPENAI_API_KEY).
 */
const VENDOR_AUTH_KEYS = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
]);

/**
 * Generic credential-style names (covers app/plugin/infra secrets we don't
 * enumerate by exact name). Broadened (P1, Codex re-review) to deny ALL
 * token/api-key/access-key/credential/cookie/auth names so vars like NPM_TOKEN,
 * SENTRY_AUTH_TOKEN, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, *_API_KEY never
 * reach an untrusted-prompt extraction child. Vendor auth the CLI genuinely
 * needs is re-added via `keep` (checked before this regex).
 */
const SECRETISH_RE =
  /(secret|password|passwd|passphrase|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|cookie|auth)/i;

/**
 * Build a scrubbed copy of `process.env` for an untrusted-prompt CLI child.
 *
 * Denylist (keep everything the CLI needs to run — PATH/HOME/APPDATA/TMP/… —
 * and drop only known-sensitive keys), so it cannot break normal CLI operation
 * while still withholding the server's secrets:
 *   - drop all `AOA_*` (app-internal config + secrets),
 *   - drop ALWAYS_DROP_EXACT (infra creds),
 *   - drop VENDOR_AUTH_KEYS unless the caller keeps its own,
 *   - drop generic secret-ish names (secret / password / private_key).
 *
 * @param keep vendor auth keys to preserve for THIS spawn's own CLI.
 */
export function buildScrubbedCliEnv(
  keep: Iterable<string> = [],
): NodeJS.ProcessEnv {
  const keepSet = new Set(keep);
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (keepSet.has(key)) {
      out[key] = value;
      continue;
    }
    if (key.startsWith("AOA_")) continue;
    if (ALWAYS_DROP_EXACT.has(key)) continue;
    if (VENDOR_AUTH_KEYS.has(key)) continue;
    if (SECRETISH_RE.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Hard cap on buffered model stdout (~8 MiB) — beyond this it's runaway. */
export const MAX_CLI_STDOUT_BYTES = 8 * 1024 * 1024;
/** Hard cap on buffered stderr (~256 KiB) — only needed for diagnostics. */
export const MAX_CLI_STDERR_BYTES = 256 * 1024;

export interface CappedBuffer {
  /** Accumulated text (never exceeds the cap). */
  text: string;
  /** Byte length seen so far (may exceed the cap once tripped). */
  bytes: number;
  /** True once the cap was exceeded — caller should stop/kill. */
  capped: boolean;
}

/** Create a zeroed capped-buffer accumulator. */
export function newCappedBuffer(): CappedBuffer {
  return { text: "", bytes: 0, capped: false };
}

/**
 * Append a chunk to a capped buffer. Returns true once the cap is exceeded so
 * the caller can stop appending and kill the child. After the cap trips, further
 * chunks are dropped (text stays bounded) but `bytes` keeps counting.
 */
export function appendCapped(
  buf: CappedBuffer,
  chunk: Buffer,
  cap: number,
): boolean {
  buf.bytes += chunk.length;
  if (buf.capped) return true;
  if (buf.bytes > cap) {
    buf.capped = true;
    return true;
  }
  buf.text += chunk.toString();
  return false;
}
