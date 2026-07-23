/**
 * Transport union for MCP servers AoA delivers to CLI adapters.
 *
 * ADDITIVE — this does NOT replace McpBridgeSpec. McpBridgeSpec remains the
 * shape of AoA's own stdio loopback bridge (the `aoa` server) and is
 * hand-duplicated in each adapter package by design. This union describes
 * EXTERNAL connectors, which may be remote HTTP.
 *
 * SECRETS: `headers` and `env` values may contain `${VAR}` placeholders that
 * the target CLI expands from process env. Real secret values MUST NOT be
 * placed here — see D5 in the connectors plan.
 */
export interface McpStdioServerSpec {
  kind: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpHttpServerSpec {
  kind: "http";
  url: string;
  headers: Record<string, string>;
}

export type McpServerSpec = McpStdioServerSpec | McpHttpServerSpec;

export function isStdioServerSpec(spec: McpServerSpec): spec is McpStdioServerSpec {
  return spec.kind === "stdio";
}

export function isHttpServerSpec(spec: McpServerSpec): spec is McpHttpServerSpec {
  return spec.kind === "http";
}
