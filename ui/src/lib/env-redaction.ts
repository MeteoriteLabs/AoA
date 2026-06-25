import { asRecord } from "./run-metrics";

export const REDACTED_ENV_VALUE = "***REDACTED***";

// Mirrors the server's redactEnvForLogs (packages/adapter-utils/src/server-utils.ts)
// so the Run-detail env display can't render a credential the server already treats
// as sensitive (the UI receives the raw adapter.invoke env, not the log-redacted copy).
// Over-redacting a displayed value is safe; leaking one is not. Keep in sync with that
// source if its patterns change.
const SECRET_ENV_KEY_RE =
  /(key|token|secret|password|passwd|auth|cookie|credential|bearer|signing|webhook|npm|private|connection)/i;
const SECRET_ENV_VALUE_PATTERNS: RegExp[] = [
  // Connection strings / DSNs (postgres://user:pass@host, mongodb+srv://, redis://, …)
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|kafka|nats|mssql|sqlserver):\/\/[^\s<>'")]+/i,
  // Anthropic / OpenAI-style provider keys (sk-… / sk-ant-…)
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}\b/,
  // Stripe-style keys (sk_live_…, pk_test_…, rk_live_…)
  /\b[sprSPR]k_(?:live|test)_[A-Za-z0-9]{8,}\b/,
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  // AWS access key id
  /\bAKIA[0-9A-Z]{16}\b/,
  // Slack tokens (xoxb-, xoxp-, …)
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  // Generic "<prefix>_<long-random>" tokens (whsec_…, npm_…, vendor keys)
  /\b[A-Za-z][A-Za-z0-9]{1,}_[A-Za-z0-9]{20,}\b/,
  // JWTs (three base64url segments)
  /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  // PEM private-key blocks
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/,
];

export function shouldRedactSecretValue(key: string, value: unknown): boolean {
  if (SECRET_ENV_KEY_RE.test(key)) return true;
  if (typeof value !== "string") return false;
  return SECRET_ENV_VALUE_PATTERNS.some((re) => re.test(value));
}

export function redactEnvValue(key: string, value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "secret_ref"
  ) {
    return "***SECRET_REF***";
  }
  if (shouldRedactSecretValue(key, value)) return REDACTED_ENV_VALUE;
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatEnvForDisplay(envValue: unknown): string {
  const env = asRecord(envValue);
  if (!env) return "<unable-to-parse>";

  const keys = Object.keys(env);
  if (keys.length === 0) return "<empty>";

  return keys
    .sort()
    .map((key) => `${key}=${redactEnvValue(key, env[key])}`)
    .join("\n");
}
