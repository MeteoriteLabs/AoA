/**
 * Reads `claude auth status`, which reports whether CREDENTIALS EXIST locally —
 * not whether they still work. A revoked token still yields `loggedIn: true`;
 * that mismatch is precisely the trap this exists to expose. Pair it with the
 * hello probe: status says who is signed in, the probe says whether it works.
 *
 * Parsing only. The caller owns spawning, so this stays synchronously testable.
 */

export interface ClaudeAuthStatus {
  /** Credentials are present on disk. Says nothing about validity. */
  loggedIn: boolean;
  /** Account label to show the founder ("ada@example.com"), when known. */
  account: string | null;
}

const SIGNED_OUT: ClaudeAuthStatus = { loggedIn: false, account: null };

/**
 * Never throws: an older CLI without `auth status` prints usage text, and the
 * probe must degrade to signed-out copy rather than crash mid-verification.
 */
export function parseClaudeAuthStatus(stdout: string): ClaudeAuthStatus {
  const text = (stdout ?? "").trim();
  if (!text) return { ...SIGNED_OUT };

  // The CLI may emit warnings around the JSON, so take the outermost object.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return { ...SIGNED_OUT };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ...SIGNED_OUT };
  }
  if (!parsed || typeof parsed !== "object") return { ...SIGNED_OUT };

  const obj = parsed as Record<string, unknown>;
  const loggedIn = obj.loggedIn === true;
  const email = typeof obj.email === "string" && obj.email.trim() ? obj.email.trim() : null;
  return { loggedIn, account: loggedIn ? email : null };
}

/** Argv for the status probe. Kept here so the probe and tests agree. */
export const CLAUDE_AUTH_STATUS_ARGS = ["auth", "status"] as const;
