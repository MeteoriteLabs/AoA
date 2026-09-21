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

import type { Metrics } from "../metrics/metrics.js";
import { REDACTION_MARKER } from "./redaction.js";
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

export interface UsageObserverDeps {
  readonly metrics?: Metrics;
}

/** The composed `observeRun`: usage only (stdout is never re-emitted as log events). */
export function createUsageObserver(deps: UsageObserverDeps = {}): NonNullable<SupervisorDeps["observeRun"]> {
  return (input): RunObservation => {
    const parsed = input.output ? parseClaudeStreamJsonUsage(input.output.stdoutTail) : null;
    if (parsed === null || input.output === undefined) {
      deps.metrics?.inc(RUN_USAGE_MISSING_METRIC);
      return { usage: null };
    }
    const runtimeMillis = Math.max(0, Math.round(input.output.runtimeMillis));
    return { usage: { ...parsed, runtimeMillis } };
  };
}
