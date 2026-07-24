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
  /**
   * The ENV VAR NAME (never a value) holding this connector's token, for CLIs
   * that take a variable name rather than expanding `${VAR}` inline — e.g.
   * codex's `bearer_token_env_var`. Writers that need it read it directly;
   * never parse it back out of a `headers` string.
   *
   * SECRETS: this is a NAME. Never assign a token value here.
   */
  authTokenEnvVar?: string;
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
 * the object returned here. Copying these entries into a map of your own is
 * where a connector named `__proto__` gets lost:
 *
 *   - `Object.assign({...}, stripped)` — UNSAFE. Assign uses [[Set]], so the
 *     key hits `Object.prototype`'s `__proto__` setter: no own key is created,
 *     the destination's prototype is replaced, and every unknown server name
 *     then reads through to the attacker's connector.
 *   - `for (…) target[name] = spec` into a `{}` — UNSAFE, same [[Set]] reason.
 *   - `{...reserved, ...stripped}` — the own `__proto__` key DOES survive here
 *     (spread uses [[Define]], not [[Set]]), but it is still forbidden: the
 *     result is a normal-prototype object carrying an own `__proto__` data
 *     property, i.e. a landmine on the second hop. The next person to copy it
 *     with `Object.assign({}, result)` re-[[Set]]s that key, silently drops the
 *     server AND installs the connector as the copy's prototype. It looks
 *     correct until it is touched again.
 *
 * Callers that need to merge MUST use `mergeExternalMcpServers`. This function
 * remains useful on its own for writers that never build a destination map at
 * all — e.g. the codex TOML writer, which concatenates `[mcp_servers.<name>]`
 * sections as strings and so needs the filter without the prototype concern.
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
 * `reserved` = entries that win on collision; not required to be
 * RESERVED_MCP_SERVER_NAMES. Those two coincide in buildMcpConfig today, but a
 * caller may legitimately pass a user's pre-existing servers here to give them
 * precedence over incoming connectors. Names in RESERVED_MCP_SERVER_NAMES are
 * filtered out of `external` regardless of what `reserved` contains.
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
