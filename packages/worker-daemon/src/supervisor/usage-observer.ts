/**
 * WRK-018 — the usage producer: the `observeRun` the dispatch runtime composes.
 *
 * It turns the run's scrubbed stdout tail (the optional provider stream channel, captured by
 * `run-output.ts`) into ONE `UsagePayloadV1`, built from what the agent itself reported.
 *
 * ★ E4-D13 — a daemon-LOCAL port of the `claude_local` stream-json usage format, not an import.
 * The daemon may not import `@armyofagents/adapters` (E4-D01), and injecting the server parser
 * from a composition root would make the worker image carry the adapters package for four
 * integers. The port mirrors `parseClaudeStreamJson`
 * (`packages/adapters/claude-local/src/server/parse.ts`) exactly where it matters:
 *   - the result event is the stream's LAST line (the server keeps the last result line; this
 *     port reads ONLY the final non-empty line - see `parseClaudeStreamJsonUsage` for why);
 *   - `usage.input_tokens -> inputTokens`, `usage.output_tokens -> outputTokens`,
 *     `usage.cache_read_input_tokens -> cachedInputTokens`;
 *   - a missing numeric FIELD is 0 (the server's `asNumber(…, 0)`).
 * and deliberately differs where the frozen protocol forces it:
 *   - a result line with NO `usage` object is NO usage (the server would record zeros; a
 *     zero-token usage event would tell JOB-016 a run was free when it was merely unreported);
 *   - a non-integer or negative count is NO usage (`usagePayloadV1Schema` admits only
 *     non-negative integers; emitting one would throw inside the sequencer).
 * The conformance test reads the REAL captured claude transcript the server suite pins.
 *
 * ★ `runtimeMillis` comes from the SUPERVISOR's clock (measured around `execute`), never from
 * the agent's own `duration_ms`: the worker reports the time it observed.
 *
 * Best-effort, per the ticket's failure behaviour: a parse miss is SILENT here (no usage event,
 * one counter tick) and LOUD at the control plane, where JOB-016's terminal-without-usage
 * signal fires. It never throws and never fails a run.
 *
 * Runtime imports: the frozen worker protocol (types) and relative modules — E4-D01.
 */

import type { UsagePayloadV1 } from "@armyofagents/worker-protocol";

import type { Logger } from "../logging/logger.js";
import type { Metrics } from "../metrics/metrics.js";
import { REDACTION_MARKER } from "./redaction.js";
import { RUN_OUTPUT_PROBE_LOG_MESSAGE, selectRunOutputProbeLines } from "./run-output-probe.js";
import type { RunObservation, SupervisorDeps } from "./supervisor.js";

/** Counter: runs whose output carried no parseable usage (no labels — no content, no id). */
export const RUN_USAGE_MISSING_METRIC = "run_usage_missing_total";

export type ParsedAgentUsage = Omit<UsagePayloadV1, "runtimeMillis">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A count: an ABSENT field is 0 (the server's `asNumber(v, 0)`); a present count must be a
 * non-negative safe integer (the frozen schema). Anything else PRESENT - a string, `null`, or
 * the redaction marker where a canary overlapped a count - is `undefined` ⇒ no usage at all,
 * never a silent 0 that would under-report the run (Codex P2, PR #546). */
function tokenCount(value: unknown): number | undefined {
  if (value === undefined) return 0;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Parse the agent-reported usage from `claude --output-format stream-json` output, or `null`.
 *
 * ★ Read from the FINAL non-empty line ONLY (claude writes its `type:"result"` event last).
 * The input has been scrubbed by the run's canaries, and a canary can overlap STRUCTURE - a
 * digit inside a bare count (the line no longer parses), the word `result` (valid JSON with
 * another type), or a `usage` key (a field that then reads as missing, i.e. 0). Scanning for
 * the "last result line" would let an EARLIER result stand in for a structurally redacted final
 * one (Codex P1/P2, PR #546). So: the final line must parse, be exactly `type:"result"`, and its
 * `usage` keys must carry no redaction marker; anything else is NO usage, which JOB-016's
 * terminal-without-usage signal reports. Free text in the line's string VALUES (the `result`
 * prose) may be redacted without affecting usage.
 */
export function parseClaudeStreamJsonUsage(stdout: string): ParsedAgentUsage | null {
  const lines = stdout.split(/\r?\n/);
  let last = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (trimmed) {
      last = trimmed;
      break;
    }
  }
  if (!last) return null;
  let event: unknown;
  try {
    event = JSON.parse(last);
  } catch {
    return null;
  }
  if (!isRecord(event) || event.type !== "result" || !isRecord(event.usage)) return null;
  const usage = event.usage;
  if (Object.keys(usage).some((key) => key.includes(REDACTION_MARKER))) return null;
  const inputTokens = tokenCount(usage.input_tokens);
  const outputTokens = tokenCount(usage.output_tokens);
  const cachedInputTokens = tokenCount(usage.cache_read_input_tokens);
  if (inputTokens === undefined || outputTokens === undefined || cachedInputTokens === undefined) return null;
  return { inputTokens, outputTokens, cachedInputTokens };
}

/**
 * WRK-018 1(b) — there is NO parsed-counts log helper here any more, and that absence is the
 * decision, not an omission.
 *
 * A `PARSED_USAGE_LOG_MESSAGE` + `parsedUsageLogFields` pair was built so the keyed lane could
 * compare what the worker PARSED with what the control plane accepted and stored (the stored row
 * being projected from the accepted event, that pair alone proves projection fidelity, not parser
 * correctness). It was DROPPED by the M1 planning session (F2, 2026-09-23) after five Codex P1s
 * that were all one family — field names the redactor ate, a digits-only canary equal to a count,
 * a throwing logger suppressing the usage event, the message and keys needing the same scrub as
 * the values, and finally the logger's OWN added keys (`msg`/`time`/`level`) sitting below every
 * caller-side scrubber (filed as E4-F019). Redaction wins over diagnostics.
 */

export interface UsageObserverDeps {
  readonly metrics?: Metrics;
  /**
   * DEP-023 — the run-output REDACTION PROBE, off unless the daemon was booted with
   * `AOA_WORKER_RUN_OUTPUT_PROBE=1`. When on, a single `AOA-RUN-OUTPUT-PROBE`-tagged line of the
   * run's ALREADY-SCRUBBED stdout tail is forwarded to BOTH streams the E5 clause-5 case asserts
   * on: the run's event stream (as `obs.logs`, which the supervisor turns into a `log` event) and
   * the worker's container log (through `logger`). Off, this observer is byte-identical to the
   * usage-only one — no selection, no log entry, no log line.
   */
  readonly runOutputProbe?: boolean;
  /** The worker logger, used ONLY for the probe line. Safe because the daemon's logger scrubs the
   * serialized record at the transport boundary (`logging/redacting-destination.ts`) — see the
   * `E4-F019` note in `run-output-probe.ts`. */
  readonly logger?: Pick<Logger, "info">;
}

/** The composed `observeRun`: usage, plus (opt-in) the bounded run-output redaction probe. */
export function createUsageObserver(deps: UsageObserverDeps = {}): NonNullable<SupervisorDeps["observeRun"]> {
  return (input): RunObservation => {
    // ★ The probe runs on the SAME already-scrubbed tail the parser reads, and it runs BEFORE the
    // parse's early returns: a run whose usage is unparseable (a `suppressed` transcript, a
    // structurally-redacted result line) still has a redaction story to tell, and gating the probe
    // on a successful parse would make clause 5 silently depend on usage.
    const probeLines =
      deps.runOutputProbe === true && input.output !== undefined
        ? selectRunOutputProbeLines(input.output.stdoutTail)
        : [];
    for (const line of probeLines) {
      try {
        deps.logger?.info({ probeLine: line }, RUN_OUTPUT_PROBE_LOG_MESSAGE);
      } catch {
        // Instrumentation must never fail a run (the supervisor swallows a throw here too, but the
        // event half below must still be produced if the LOG half fails).
      }
    }
    const logs = probeLines.map((message) => ({ stream: "system", level: "info", message }) as const);
    const parsed = input.output ? parseClaudeStreamJsonUsage(input.output.stdoutTail) : null;
    if (parsed === null || input.output === undefined) {
      deps.metrics?.inc(RUN_USAGE_MISSING_METRIC);
      return { ...(logs.length > 0 ? { logs } : {}), usage: null };
    }
    const runtimeMillis = Math.max(0, Math.round(input.output.runtimeMillis));
    return { ...(logs.length > 0 ? { logs } : {}), usage: { ...parsed, runtimeMillis } };
  };
}
