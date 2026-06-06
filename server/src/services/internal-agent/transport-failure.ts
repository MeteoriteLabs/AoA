// Transport-class failures only — NOT legitimate tool isError text.
//
// DELIBERATE TRADEOFF (loud-and-safe over precise): we scan the adapter's raw
// stdout/stderr, and the bare "transport closed" alternative has no error-context
// anchor — so an agent that merely DISCUSSES "transport closed" in its output can
// trip a false-positive (the run is marked failed though it succeeded). We accept
// this for now because the inverse error (a false-NEGATIVE) silently re-opens the
// exact bug this feature exists to catch: a dead bridge → every MCP call returns
// "Transport closed" → the run still reports succeeded. A false-positive is safe
// (loud); a false-negative is the original silent bug. Once real transport-failed
// runs give us the verbatim marker strings (telemetry), we can add an error-context
// anchor to the bare phrase to cut false-positives without risking a miss.
const TRANSPORT_RE =
  /transport closed|mcp [^\n]{0,120}(disconnect|connection closed|server (?:exited|closed))|connection to mcp server lost/i;

export interface TransportFailureInput {
  parsedErrorMessages: string[];
  rawStdout: string;
  rawStderr: string;
  mcpAttempted?: boolean;
  markerSupported?: boolean; // false for providers w/o a clean marker (e.g. gemini)
}
export type TransportFailureResult =
  | { failed: true; detail: string }
  | { failed: false; status?: "unknown" };

export function detectTransportFailure(input: TransportFailureInput): TransportFailureResult {
  // A caller that explicitly says no bridge was used (mcpAttempted === false —
  // claude_local uses native --mcp-config, NOT this stdio bridge) can never have
  // suffered a bridge transport failure, so a "transport closed" string in its
  // output is irrelevant. Do not force-fail it.
  if (input.mcpAttempted === false) return { failed: false };

  const hay = [...input.parsedErrorMessages, input.rawStdout, input.rawStderr].join("\n");
  const m = hay.match(TRANSPORT_RE);
  if (m) return { failed: true, detail: m[0].slice(0, 200) };
  if (input.mcpAttempted && input.markerSupported === false) return { failed: false, status: "unknown" };
  return { failed: false };
}
