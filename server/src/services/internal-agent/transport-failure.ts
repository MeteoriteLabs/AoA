// Transport-class failures only — NOT legitimate tool isError text.
const TRANSPORT_RE =
  /transport closed|mcp .*(disconnect|connection closed|server (?:exited|closed))|connection to mcp server lost/i;

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
  const hay = [...input.parsedErrorMessages, input.rawStdout, input.rawStderr].join("\n");
  const m = hay.match(TRANSPORT_RE);
  if (m) return { failed: true, detail: m[0] };
  if (input.mcpAttempted && input.markerSupported === false) return { failed: false, status: "unknown" };
  return { failed: false };
}
