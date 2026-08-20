/**
 * Minimal structured pino logger with a redaction guard (WRK-001).
 *
 * Structured logs may carry opaque IDs (`workerId`, `targetId`,
 * `deviceGeneration`, `correlationId`, `leaseId`, `sandboxId`, provider op IDs)
 * but NEVER a private key, session token, raw enrollment code, or any
 * secret/credential. `createWorkerLogger` wraps pino and deep-redacts any field
 * whose (separator-stripped, lowercased) name matches the canary set before the
 * record reaches pino.
 */

import pino from "pino";

export interface Logger {
  info(message: string): void;
  info(bindings: Record<string, unknown>, message: string): void;
  warn(message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: { readonly err: unknown } | Record<string, unknown>, message: string): void;
  flush(): Promise<void>;
}

export interface WorkerLoggerOptions {
  readonly level?: string;
  /** Injectable destination for tests; defaults to stdout. */
  readonly destination?: pino.DestinationStream;
  readonly base?: Record<string, unknown>;
}

/**
 * Substrings (separator-stripped, lowercased) that mark a field as sensitive.
 * A field whose normalized name CONTAINS any of these is redacted. Chosen to
 * catch private keys, session tokens, raw enrollment codes, bearer/authorization
 * headers, and generic secrets/credentials/signatures — while leaving opaque
 * IDs (`workerId`, `deviceGeneration`, `correlationId`, `leaseId`, …) visible.
 */
const SENSITIVE_SUBSTRINGS = [
  "password",
  "secret",
  "token",
  "authorization",
  "bearer",
  "credential",
  "privatekey",
  "session",
  "enrollmentcode",
  "signature",
  "apikey",
];

const REDACTED = "[redacted]";

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return SENSITIVE_SUBSTRINGS.some((needle) => normalized.includes(needle));
}

/**
 * Deep-copy `value`, replacing any sensitive-keyed field with `[redacted]`.
 * Errors are passed through untouched so pino's `err` serializer can render
 * them (their messages are author-controlled and carry no secret).
 */
function redactBindings(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) return value;
  // DSK-001 (D7). Raw bytes are masked by TYPE, because this redactor is
  // otherwise name-based and a device private key is a Uint8Array. Under a key
  // the list does not match — `blob`, `der`, `payload` — it serializes to an
  // object of numeric indices and prints in full as a list of digits. No amount
  // of naming discipline at future call sites closes that; the type check does.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return "[bytes]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactBindings(item, seen));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactBindings(val, seen);
  }
  return out;
}

export function createWorkerLogger(opts: WorkerLoggerOptions = {}): Logger {
  const instance = pino(
    {
      level: opts.level ?? "info",
      base: opts.base,
      serializers: { err: pino.stdSerializers.err },
    },
    opts.destination ?? pino.destination(1),
  );

  const logger: Logger = {
    info(a: string | Record<string, unknown>, b?: string): void {
      if (typeof a === "string") instance.info(a);
      else instance.info(redactBindings(a) as object, b);
    },
    warn(a: string | Record<string, unknown>, b?: string): void {
      if (typeof a === "string") instance.warn(a);
      else instance.warn(redactBindings(a) as object, b);
    },
    error(a: Record<string, unknown>, b?: string): void {
      instance.error(redactBindings(a) as object, b);
    },
    flush: () =>
      new Promise<void>((resolve) => {
        instance.flush(() => resolve());
      }),
  };
  return logger;
}
