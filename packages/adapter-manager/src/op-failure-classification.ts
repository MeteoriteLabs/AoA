// -----------------------------------------------------------------------------
// E6-F024 — a REDACTED, bounded classification of an adapter-manager provider-op failure.
//
// The leak fence in `server.ts` ([Cred-2]) maps every unmodelled error to one fixed generic
// `WireProtocolError`. That is correct, since a raw SDK or fetch error can carry a provider key, a
// presigned URL or a grant header. But it made every failure look the same. The DEP-015 keyed run
// failed at `stage_files` because the adapter-manager could not reach the presign host. The worker
// logged "adapter-manager provider operation failed", the adapter-manager logged nothing, and the
// cause had to be found by reading source.
//
// This module restores the diagnosis WITHOUT reopening the leak. Every field it emits comes from
// a CLOSED vocabulary:
//   - `op`         the route segment, already matched by `/^[a-z_]+$/`, checked against a known set;
//   - `errorClass` the error's name, ONLY if it is in `KNOWN_ERROR_CLASSES`, else "other";
//   - `cause`      one of `FAILURE_CAUSES`, derived from codes and statuses — never from text;
//   - `code`       a Node/undici error code, ONLY if it is in `KNOWN_ERROR_CODES`;
//   - `httpStatus` a three-digit integer, 100–599.
// Nothing from an error's message is ever copied out. The message is only matched against fixed
// patterns to choose an enum value. So a URL, header, grant, key or hostname cannot appear in the
// output, whatever the error contains.
// -----------------------------------------------------------------------------

export const FAILURE_CAUSES = [
  "dns",
  "tls",
  "connect",
  "timeout",
  "http_status",
  "fetch_failed",
  "digest_mismatch",
  "size_exceeded",
  // CLI-017-B (E7-D11 section 3) — the SD-5 export refusals, as their OWN causes.
  //
  // They are derived from the error CLASS NAME, never from message text, and each names only
  // which control refused: never the path, the byte offset, the env key, the matched value or
  // the grant. Without them every secret refusal reported `cause=unclassified` and an operator
  // could not tell a file that carried a credential from a store the adapter-manager could not
  // reach — which makes E5-D07's per-file, best-effort-outward policy unreadable at the only
  // place it is observed.
  "export_secret_refused",
  "export_scanner_unavailable",
  "export_secret_set_unavailable",
  "unclassified",
] as const;
export type FailureCause = (typeof FAILURE_CAUSES)[number];

export const KNOWN_OPS: ReadonlySet<string> = new Set([
  "create",
  "execute",
  "cancel",
  "kill",
  "destroy",
  "reconcile_cleanup",
  "inspect",
  "list",
  "stage_files",
  // CLI-017-B — the artifact ops. BOTH, not just the one Codex named: `digest_artifact` reads the
  // sandbox through the same `#readArtifactBytes` and was equally unknown, so a failure there
  // reported `op=other` too. Swept as a pair rather than fixed as the one instance.
  "digest_artifact",
  "export_artifact",
]);

export const KNOWN_ERROR_CLASSES: ReadonlySet<string> = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AbortError",
  "TimeoutError",
  "DOMException",
  "SandboxError",
  "CommandExitError",
  // CLI-017-B — the SD-5 refusal classes, so `errorClass` is the real one rather than "other".
  "SandboxExportScannerUnavailableError",
  "SandboxExportScannerRefusedError",
  "SandboxExportSecretSetUnavailableError",
  "NotFoundError",
  "AuthenticationError",
  "RateLimitError",
  "TemplateError",
  "InvalidArgumentError",
  "ConnectTimeoutError",
  "SocketError",
]);

const DNS_CODES = ["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME", "EAI_FAIL"];
const TLS_CODES = [
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "EPROTO",
];
const CONNECT_CODES = [
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
];
const TIMEOUT_CODES = ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ABORT_ERR"];

export const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  ...DNS_CODES,
  ...TLS_CODES,
  ...CONNECT_CODES,
  ...TIMEOUT_CODES,
]);

export interface OpFailureClassification {
  readonly op: string;
  readonly errorClass: string;
  readonly cause: FailureCause;
  readonly code: string | null;
  readonly httpStatus: number | null;
}

function field(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** The error and its `cause` chain, bounded (a cycle or a deep chain cannot loop). */
function chain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current !== undefined && current !== null; depth += 1) {
    if (out.includes(current)) break;
    out.push(current);
    current = field(current, "cause");
  }
  return out;
}

export function classifyOpFailure(op: string, err: unknown): OpFailureClassification {
  const links = chain(err);
  const name = field(err, "name");
  const errorClass = typeof name === "string" && KNOWN_ERROR_CLASSES.has(name) ? name : "other";

  let code: string | null = null;
  for (const link of links) {
    const candidate = field(link, "code");
    if (typeof candidate === "string" && KNOWN_ERROR_CODES.has(candidate)) {
      code = candidate;
      break;
    }
  }

  // Messages are MATCHED against fixed patterns, never copied.
  const messages = links
    .map((link) => field(link, "message"))
    .filter((m): m is string => typeof m === "string");
  const statusMatch = messages.map((m) => /\bstatus (\d{3})\b/.exec(m)).find((m) => m !== null);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  const httpStatus = status !== null && status >= 100 && status <= 599 ? status : null;

  let cause: FailureCause = "unclassified";
  // CLI-017-B — the SD-5 refusals are decided FIRST and from the class NAME, never from message
  // text. First, because a refusal is a verdict about the bytes and must not be overwritten by an
  // incidental code or status further down the chain; from the name, because these classes'
  // messages are fixed vocabulary and matching them by pattern would couple the classifier to
  // wording that the wire is free to truncate.
  const refusalNames = links
    .map((link) => field(link, "name"))
    .filter((n): n is string => typeof n === "string");
  if (refusalNames.includes("SandboxExportScannerRefusedError")) cause = "export_secret_refused";
  else if (refusalNames.includes("SandboxExportSecretSetUnavailableError")) cause = "export_secret_set_unavailable";
  else if (refusalNames.includes("SandboxExportScannerUnavailableError")) cause = "export_scanner_unavailable";
  else if (code !== null && DNS_CODES.includes(code)) cause = "dns";
  else if (code !== null && TLS_CODES.includes(code)) cause = "tls";
  else if (code !== null && TIMEOUT_CODES.includes(code)) cause = "timeout";
  else if (code !== null && CONNECT_CODES.includes(code)) cause = "connect";
  else if (httpStatus !== null) cause = "http_status";
  else if (messages.some((m) => /\bhashed [0-9a-f]{64}, expected\b/.test(m))) cause = "digest_mismatch";
  else if (messages.some((m) => /\bbytes, over the granted\b/.test(m))) cause = "size_exceeded";
  else if (links.some((link) => field(link, "name") === "TimeoutError" || field(link, "name") === "AbortError")) cause = "timeout";
  else if (messages.some((m) => m === "fetch failed")) cause = "fetch_failed";

  return {
    op: KNOWN_OPS.has(op) ? op : "other",
    errorClass,
    cause,
    code,
    httpStatus,
  };
}

/** The one-line form carried in the wire message and in the log. Every token is from the closed
 * vocabulary above. */
export function formatOpFailure(c: OpFailureClassification): string {
  const parts = [`op=${c.op}`, `class=${c.errorClass}`, `cause=${c.cause}`];
  if (c.code !== null) parts.push(`code=${c.code}`);
  if (c.httpStatus !== null) parts.push(`status=${c.httpStatus}`);
  return parts.join(" ");
}
