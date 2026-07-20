/**
 * Shared auth-failure classifier for CLI adapters.
 *
 * Every adapter previously carried its own regex, and all of them matched only
 * NEVER-SIGNED-IN phrasing ("not logged in", "please run `x login`"). The
 * expired/revoked class — which is the common case in practice, since tokens
 * expire on their own — was missed by all of them. A missed auth signal makes
 * the probe report a generic failure, which the server classifies as `failed`,
 * which leaves the founder with no recovery offer at all.
 *
 * Separating `expired` from `signed_out` is what lets the UI say "your session
 * was revoked" instead of the false "you are not signed in".
 *
 * Pure and synchronous: no process spawning, so it is exhaustively testable
 * against a table of real error strings.
 */

export type AuthFailureKind = "none" | "signed_out" | "expired" | "invalid_key";

export interface AuthFailureDetection {
  kind: AuthFailureKind;
  /** Verification URL when the CLI printed one, else null. */
  loginUrl: string | null;
}

/** Credentials are absent — the user has never signed in (or signed out). */
const SIGNED_OUT_RE =
  /(?:not\s+logged\s+in|please\s+log\s+in|log\s*in\s+required|login\s+required|requires\s+login|not\s+authenticated|please\s+authenticate|please\s+run\s+`?\w+\s+login`?|run\s+`?\w+\s+auth(?:\s+login)?`?\s+first)/i;

/**
 * Credentials exist but the server rejected them. `authentication_error` and
 * `token has been revoked` are the shapes Anthropic returns; the bare status
 * codes cover CLIs that surface only the HTTP status.
 */
const EXPIRED_RE =
  /(?:revoked|expired|authentication_error|failed\s+to\s+authenticate|\b401\b|\b403\b|unauthorized|authentication\s+required|invalid\s+credentials)/i;

/** A key was supplied and is wrong or absent. */
const INVALID_KEY_RE =
  /(?:invalid(?:\s+or\s+missing)?\s+api[_\s-]?key|api[_\s-]?key\s+(?:is\s+)?(?:required|missing|invalid)|(?:openai|anthropic)[_\s-]?api[_\s-]?key\s+(?:is\s+)?(?:not\s+set|missing|required|invalid))/i;

/**
 * Failures that contain auth-adjacent words but are NOT auth problems. Checked
 * first: "429 rate limit" must never route the founder to a sign-in screen.
 */
const NOT_AUTH_RE = /(?:\b429\b|rate\s*limit|\b5\d{2}\b|max(?:imum)?\s+turns?|timed?\s*out)/i;

const URL_RE = /(https?:\/\/[^\s'"`<>()[\]{};,!?]+[^\s'"`<>()[\]{};,!.?:]+)/i;

export function detectAuthFailure(text: string): AuthFailureDetection {
  const haystack = (text ?? "").trim();
  if (!haystack) return { kind: "none", loginUrl: null };

  const loginUrl = haystack.match(URL_RE)?.[1] ?? null;

  // Order matters. A rate limit or 500 can sit next to the word "unauthorized"
  // in a log dump; treating that as an auth failure would send the founder to a
  // sign-in screen that cannot fix it.
  if (NOT_AUTH_RE.test(haystack) && !EXPIRED_RE.test(haystack.replace(NOT_AUTH_RE, ""))) {
    return { kind: "none", loginUrl: null };
  }

  // invalid_key before signed_out: "OPENAI_API_KEY is missing" is a key problem,
  // and its remedy (set a key) differs from signing in.
  if (INVALID_KEY_RE.test(haystack)) return { kind: "invalid_key", loginUrl };

  // signed_out before expired: an explicit "not logged in" is unambiguous, and
  // such messages often also carry the word "unauthorized".
  if (SIGNED_OUT_RE.test(haystack)) return { kind: "signed_out", loginUrl };

  if (EXPIRED_RE.test(haystack)) return { kind: "expired", loginUrl };

  return { kind: "none", loginUrl: null };
}

/** True when the failure is any kind of auth problem. */
export function isAuthFailure(kind: AuthFailureKind): boolean {
  return kind !== "none";
}
