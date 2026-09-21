/**
 * WRK-018 — the per-run stdout capture behind the optional provider stream channel.
 *
 * A provider that implements the channel calls `ExecuteInput.onStdout(chunk)` while the tenant
 * command runs. This module is what that callback feeds: a BOUNDED tail of the run's stdout,
 * scrubbed by the run's OWN canaries (H-04, zero tolerance) before any of it can be read out.
 *
 * ★ Why a tail and not the whole stream. The one consumer today is the usage producer, and
 * `claude --output-format stream-json` puts the usage it reports on its FINAL `type:"result"`
 * line. A coding run's stream can be many megabytes of tool output; keeping all of it per run
 * on a multi-tenant daemon would make memory proportional to the tenants' output. The tail is
 * bounded by `maxChars`; a result line longer than the bound is lost and the run reports NO
 * usage, which is honest (JOB-016's terminal-without-usage signal fires) rather than wrong.
 *
 * ★ Why scrub at READ time over whole lines, not per chunk. A canary can arrive split across
 * two chunks, and a per-chunk scrub would miss both halves. The tail therefore only ever holds
 * WHOLE lines — when it is trimmed, it is cut back to the next line boundary, and a line longer
 * than the bound is dropped with its continuation — so a single-line canary is always either
 * wholly inside the retained text (and scrubbed) or wholly outside it. A multi-line canary (a
 * PEM-shaped secret) is scrubbed segment by segment, which over-redacts rather than leaks.
 *
 * ★ FAIL CLOSED. After scrubbing, the text is re-checked for every needle; if any survives
 * (needle interplay can re-form one), the WHOLE tail is dropped and the drop is reported. A
 * chunk that arrives after `close()` is dropped and reported, never buffered.
 *
 * The canary array is read LIVE (by reference), matching `run-canaries.ts`: the supervisor
 * seeds the run's redeemed values into the same array before create, and every read sees them.
 *
 * Runtime imports: relative modules only — the E4-D01 boundary.
 */

import { REDACTION_MARKER, redactString } from "./redaction.js";

/** The default bound on the retained stdout tail, in UTF-16 code units. */
export const RUN_OUTPUT_TAIL_MAX_CHARS = 1_048_576;

/** Counter: `run_output_dropped{reason}` — output the capture refused to hold or release.
 * `reason` is one of {@link RunOutputDropReason}; a bounded token set, never content. */
export const RUN_OUTPUT_DROPPED_METRIC = "run_output_dropped";

export type RunOutputDropReason = "overflow" | "late_chunk" | "unscrubbable";

export interface RunOutputCaptureOptions {
  /** The run's canaries, read LIVE on every `close()` (never copied at construction). */
  readonly canaries: readonly string[];
  /** The tail bound; defaults to {@link RUN_OUTPUT_TAIL_MAX_CHARS}. */
  readonly maxChars?: number;
  /** Told once per drop event, with a bounded reason token. */
  readonly onDrop?: (reason: RunOutputDropReason) => void;
}

export interface RunOutputCaptureResult {
  /** The retained tail, scrubbed. Whole lines only (a trailing unterminated line is kept,
   * because the stream has ended). Empty when nothing was streamed or it was dropped. */
  readonly stdoutTail: string;
}

export interface RunOutputCapture {
  /** The callback handed to the provider as `ExecuteInput.onStdout`. Never throws. */
  readonly onStdout: (chunk: string) => void;
  /** Stop capturing and return the scrubbed tail. Idempotent. */
  close(): RunOutputCaptureResult;
}

/** Every string that must not survive: each canary, plus each non-empty line segment of a
 * multi-line canary. Longest first, so a whole canary is replaced before its segments. */
export function redactionNeedles(canaries: readonly string[]): string[] {
  const needles = new Set<string>();
  for (const canary of canaries) {
    if (typeof canary !== "string" || canary.length === 0) continue;
    needles.add(canary);
    if (/[\r\n]/.test(canary)) {
      for (const segment of canary.split(/\r?\n|\r/)) {
        if (segment.length > 0) needles.add(segment);
      }
    }
  }
  return [...needles].sort((a, b) => b.length - a.length);
}

/**
 * Scrub `text` with `canaries`. Returns `null` when a needle SURVIVES scrubbing — the caller
 * must then drop the text (fail closed), never forward it.
 */
export function scrubOutputText(text: string, canaries: readonly string[]): string | null {
  const needles = redactionNeedles(canaries);
  if (needles.length === 0) return text;
  const scrubbed = redactString(text, needles);
  // ★ An occurrence lying WHOLLY inside a replacement marker is the marker, not a leak: a
  // canary that is a substring of «redacted» (e.g. "red") would otherwise drop every tail
  // (Codex P2, PR #546). An occurrence that overlaps text outside a marker - including one
  // re-formed by marker + neighbours - is a residual, and the whole text is refused.
  const markerSpans: Array<[number, number]> = [];
  for (let at = scrubbed.indexOf(REDACTION_MARKER); at >= 0; at = scrubbed.indexOf(REDACTION_MARKER, at + 1)) {
    markerSpans.push([at, at + REDACTION_MARKER.length]);
  }
  const insideMarker = (start: number, end: number): boolean =>
    markerSpans.some(([s, e]) => start >= s && end <= e);
  for (const needle of needles) {
    // A needle that CONTAINS the marker (or equals it) is never excused: replacing it yields
    // the marker, so "inside a marker" would be every occurrence of the secret itself (Codex
    // P2, PR #546). Any occurrence of such a needle refuses the text.
    const excusable = !needle.includes(REDACTION_MARKER);
    for (let at = scrubbed.indexOf(needle); at >= 0; at = scrubbed.indexOf(needle, at + 1)) {
      if (!excusable || !insideMarker(at, at + needle.length)) return null;
    }
  }
  return scrubbed;
}

export function createRunOutputCapture(options: RunOutputCaptureOptions): RunOutputCapture {
  const maxChars = options.maxChars ?? RUN_OUTPUT_TAIL_MAX_CHARS;
  const report = (reason: RunOutputDropReason): void => {
    try {
      options.onDrop?.(reason);
    } catch {
      // Reporting a drop must never turn into a failure of the capture.
    }
  };

  let buffer = "";
  // True while the bytes arriving belong to a line whose START was already dropped: they are
  // discarded up to and including the next newline, so no partial line is ever retained.
  let skippingLine = false;
  let closed = false;
  let result: RunOutputCaptureResult | null = null;

  function trim(): void {
    // Keep the newest `maxChars`, then cut forward to a line boundary.
    let tail = buffer.slice(buffer.length - maxChars);
    const cutAtLineStart = buffer.length - maxChars === 0 || buffer[buffer.length - maxChars - 1] === "\n";
    if (!cutAtLineStart) {
      const nl = tail.indexOf("\n");
      if (nl < 0) {
        // The whole retained window is ONE line longer than the bound: drop it and its
        // continuation.
        tail = "";
        skippingLine = true;
      } else {
        tail = tail.slice(nl + 1);
      }
    }
    buffer = tail;
    report("overflow");
  }

  return {
    onStdout(chunk: string): void {
      if (closed) {
        report("late_chunk");
        return;
      }
      if (typeof chunk !== "string" || chunk.length === 0) return;
      let text = chunk;
      if (skippingLine) {
        const nl = text.indexOf("\n");
        if (nl < 0) return; // still inside the dropped line
        skippingLine = false;
        text = text.slice(nl + 1);
      }
      buffer += text;
      // Trim at 2x so trimming (an O(n) copy) is amortised, not paid per chunk.
      if (buffer.length > maxChars * 2) trim();
    },
    close(): RunOutputCaptureResult {
      if (result !== null) return result;
      closed = true;
      if (buffer.length > maxChars) trim();
      const kept = skippingLine ? "" : buffer;
      buffer = "";
      const scrubbed = scrubOutputText(kept, options.canaries);
      if (scrubbed === null) {
        report("unscrubbable");
        result = { stdoutTail: "" };
      } else {
        result = { stdoutTail: scrubbed };
      }
      return result;
    },
  };
}

/** Re-exported so a consumer asserting on scrubbed text needs no second import. */
export { REDACTION_MARKER };
