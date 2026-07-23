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

/** Server names AoA owns. A connector must never shadow these. */
export const RESERVED_MCP_SERVER_NAMES = ["aoa", "playwright"] as const;

/**
 * Drop any entry whose key collides with a name AoA owns. Returns a NEW
 * null-prototype object — callers merge external connectors into a config that
 * already contains the reserved servers, so a collision here would silently
 * replace AoA's own loopback bridge or browser server.
 *
 * WARNING: this function's null prototype is NOT transitive. It protects only
 * the object returned here. If you then copy these entries into a map of your
 * own (`Object.assign({...}, stripped)`, `{...reserved, ...stripped}`, or a
 * `for` loop writing into a `{}`), a connector named `__proto__` sets your
 * destination's prototype instead of adding a key and the server silently
 * vanishes. Callers that need to merge MUST use `mergeExternalMcpServers`.
 */
export function stripReservedMcpServerNames(
  servers: Record<string, McpServerSpec>,
): Record<string, McpServerSpec> {
  const out: Record<string, McpServerSpec> = Object.create(null);
  for (const [name, spec] of Object.entries(servers)) {
    if ((RESERVED_MCP_SERVER_NAMES as readonly string[]).includes(name)) continue;
    out[name] = spec;
  }
  return out;
}

/**
 * Merge external connectors into a set of AoA-owned servers, returning a
 * null-prototype map.
 *
 * This is the ONLY supported way to build an MCP server map that contains
 * external connectors. It couples the two protections that must never be
 * separated: reserved-name filtering AND a null-prototype destination.
 * Connector names are untrusted runtime strings from DB rows — assigning one
 * named `__proto__` onto a normal object literal sets the prototype instead of
 * adding a key, and the server silently vanishes.
 *
 * Do NOT call stripReservedMcpServerNames and merge the result yourself; the
 * returned object's prototype is not transitive to your destination map.
 */
export function mergeExternalMcpServers<T>(
  reserved: Record<string, T>,
  external: Record<string, McpServerSpec>,
  toEntry: (spec: McpServerSpec) => T,
): Record<string, T> {
  const out: Record<string, T> = Object.create(null);
  for (const [name, value] of Object.entries(reserved)) out[name] = value;
  for (const [name, spec] of Object.entries(stripReservedMcpServerNames(external))) {
    if (Object.prototype.hasOwnProperty.call(out, name)) continue; // reserved wins
    out[name] = toEntry(spec);
  }
  return out;
}
