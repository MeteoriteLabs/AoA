/**
 * DEP-023 — the TRANSPORT-BOUNDARY log scrubber: closure route 2 of `E4-F019`.
 *
 * `E4-F019` records that `createWorkerLogger` scrubs only what a CALLER hands it (values, and
 * binding names by key), while the pino SINK adds `msg`, `time` and `level` to every record
 * afterwards. A redeemed secret is accepted as any non-empty string (`synthesiseRunSecrets`), so a
 * secret equal to a structural token — or a digit run occurring inside the epoch `time` — is
 * emitted verbatim on every line the daemon writes, below any scrubber a caller can run. The
 * finding names two closure routes and calls the second one out explicitly:
 *
 *   *"Serialize and scrub at the TRANSPORT boundary — scrub the fully-serialized record inside the
 *   logger's destination, after the sink has added its keys."*
 *
 * This module is that. It wraps the destination pino writes to, so the LAST thing that touches a
 * record is the run-canary scrubber, and nothing is added below it.
 *
 * ── Fail-closed, and which direction "closed" is ─────────────────────────────
 * `scrubOutputText` returns `null` when a needle SURVIVES scrubbing (needle interplay can re-form
 * one). A log line is diagnostics; a leaked credential is not recoverable. So a record that cannot
 * be scrubbed is REFUSED — replaced by a fixed refusal line, itself run through the same scrubber,
 * and dropped entirely if even that cannot be written cleanly. An operator loses one line and is
 * told the count; nobody loses a secret.
 *
 * ── Over-redaction is accepted, deliberately ─────────────────────────────────
 * The scrub is a substring replacement over the SERIALIZED record, so a pathologically short
 * canary (`"30"`, `"msg"`) rewrites structure as well as content and can leave a line that no
 * longer parses as JSON. That is the safe direction and it is stated rather than hidden: the
 * alternative is the verbatim emission `E4-F019` describes. Such canaries are improbable
 * (`PROVIDER_AUTH_ENV_TARGETS` values are long and prefixed) and a malformed diagnostic line costs
 * a log consumer a parse, not a tenant a credential.
 *
 * ── Scope: process-wide, per-run values ──────────────────────────────────────
 * Canaries are read LIVE, from a snapshot of every lease the daemon currently holds
 * (`RunCanaryCoordinator.snapshot`). That is deliberately WIDER than one run: a log line carries no
 * run attribution, so the only sound question at this boundary is "is any live canary in these
 * bytes". Scrubbing run A's canary out of a line about run B over-redacts, which is the safe
 * direction; the narrow per-run scoping that `run-canaries.ts` insists on is for EVENTS, which do
 * carry attribution.
 *
 * Runtime imports: `pino` types plus relative modules — the E4-D01 boundary.
 */

import type { DestinationStream } from "pino";

import { scrubOutputText } from "../supervisor/run-output.js";

/** What replaces a record the scrubber refused. A CONSTANT — never derived from the record. */
export const LOG_RECORD_REFUSED_LINE =
  '{"level":50,"msg":"worker: a log record was refused by the redaction transport"}';

export interface RedactingDestinationOptions {
  /** The real destination (stdout, a file, or a test stream). */
  readonly destination: DestinationStream;
  /** The live canaries, read on EVERY write — never captured at construction. */
  readonly canaries: () => readonly string[];
  /** Told once per refused record, with no content. Never throws out of a write. */
  readonly onRefused?: () => void;
}

/**
 * Wrap `destination` so every serialized record is scrubbed with the live run canaries before it
 * is written.
 *
 * Everything other than `write` is delegated to the wrapped stream (pino calls `flush` on it, and
 * a `SonicBoom` destination is also an `EventEmitter`), so this is a scrubber and not a
 * re-implementation of the destination contract.
 */
export function createRedactingDestination(options: RedactingDestinationOptions): DestinationStream {
  const write = (chunk: string): void => {
    let canaries: readonly string[];
    try {
      canaries = options.canaries() ?? [];
    } catch {
      // ★ FAIL CLOSED ON A MISSING INPUT. A canary source that throws must not take the daemon's
      // logging down, and "I could not read the canaries" must never be treated as "there are
      // none" — that is the self-audit family-8 defect. The record is refused; the refusal line is
      // a constant that carries nothing, so it is safe to write without a scrub.
      try {
        options.onRefused?.();
      } catch {
        // Reporting a refusal must never become a failure of the write.
      }
      options.destination.write(`${LOG_RECORD_REFUSED_LINE}\n`);
      return;
    }
    if (canaries.length === 0) {
      // No live secret exists, so there is nothing to scrub and the bytes are byte-identical to
      // the unwrapped destination's.
      options.destination.write(chunk);
      return;
    }
    const scrubbed = scrubOutputText(chunk, canaries);
    if (scrubbed !== null) {
      options.destination.write(scrubbed);
      return;
    }
    try {
      options.onRefused?.();
    } catch {
      // Reporting a refusal must never become a failure of the write.
    }
    const refusal = scrubOutputText(`${LOG_RECORD_REFUSED_LINE}\n`, canaries);
    if (refusal !== null) options.destination.write(refusal);
  };

  return new Proxy(options.destination, {
    get(target, prop, receiver) {
      if (prop === "write") return write;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DestinationStream;
}
