/**
 * Transport union for MCP servers AoA delivers to CLI adapters.
 *
 * ADDITIVE — this does NOT replace McpBridgeSpec. McpBridgeSpec remains the
 * shape of AoA's own stdio loopback bridge (the `aoa` server) and is
 * hand-duplicated in each adapter package by design. This union describes
 * EXTERNAL connectors, which may be remote HTTP.
 *
 * @packageDocumentation
 */

/** A locally-spawned MCP server (stdio transport). */
export interface McpStdioServerSpec {
  kind: "stdio";
  command: string;
  args: string[];
  /**
   * SECRETS: values carry `${VAR}` placeholders ONLY. Never a real token —
   * specs are persisted into run events. See D5.
   */
  env: Record<string, string>;
}

/** A remote MCP server reached over streamable HTTP. */
export interface McpHttpServerSpec {
  kind: "http";
  url: string;
  /**
   * SECRETS: values carry `${VAR}` placeholders ONLY. Never a real token —
   * specs are persisted into run events. See D5.
   */
  headers: Record<string, string>;
}

/**
 * `${VAR}` placeholders are intended for expansion by the target CLI from
 * process env (per-CLI; verified for claude_local in Task 4). Real secret
 * values MUST NOT be placed in `env`/`headers` — see D5 in the connectors plan.
 */
export type McpServerSpec = McpStdioServerSpec | McpHttpServerSpec;

export function isStdioServerSpec(spec: unknown): spec is McpStdioServerSpec {
  return (
    typeof spec === "object" &&
    spec !== null &&
    (spec as { kind?: unknown }).kind === "stdio" &&
    typeof (spec as { command?: unknown }).command === "string"
  );
}

export function isHttpServerSpec(spec: unknown): spec is McpHttpServerSpec {
  return (
    typeof spec === "object" &&
    spec !== null &&
    (spec as { kind?: unknown }).kind === "http" &&
    typeof (spec as { url?: unknown }).url === "string"
  );
}
