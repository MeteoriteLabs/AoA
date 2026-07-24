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
 * Why a writer dropped a connector it was handed.
 *
 * ONE classified-skip vocabulary shared by every native-config writer (codex
 * TOML, opencode JSON, gemini JSON) — deliberately mirroring the server-side
 * `ConnectorSkipReason` in `server/src/services/mcp-connectors.ts`, which
 * classifies the skips that happen EARLIER (bad DB row → no spec at all). The
 * two stages are different modules on opposite sides of the adapter boundary
 * (adapters must not import from the server) but they answer the same operator
 * question — "why is my connector not there?" — so they must not drift into two
 * different vocabularies. A writer that silently drops a connector is the worst
 * failure mode for a security-adjacent feature: the founder believes the agent
 * has the tool and it does not.
 *
 * Writers RETURN these rather than logging: they are pure-ish file writers with
 * no logger, and returning keeps them unit-testable. The `execute()` call site
 * surfaces them on the run's stderr stream.
 */
export type McpWriterSkipReason =
  /** Name collides with a name AoA owns (`aoa`, `playwright`, the bridge name). */
  | "reserved_name"
  /** Transport this CLI cannot express (or an unrecognized `kind`). */
  | "unsupported_transport"
  /** Name is not expressible in this CLI's config (e.g. not a TOML bare key). */
  | "unsafe_name"
  /**
   * The connector needs a secret, and THIS CLI has no route to deliver it —
   * see {@link stdioSpecCarriesSecretPlaceholder}. Emitting the entry anyway
   * would produce a server that silently authenticates as no-one.
   */
  | "secret_unreachable";

export interface McpWriterSkip {
  serverName: string;
  reason: McpWriterSkipReason;
}

/** What every native-config MCP writer returns. */
export interface McpWriterResult {
  /**
   * Server names this run wrote and therefore OWNS. Persisted by JSON writers
   * (see `mcp-managed-manifest.ts`) so a later run can sweep the ones that are
   * no longer active. Includes the bridge name when a bridge was written.
   */
  managedServerNames: string[];
  /** Connectors dropped, and why. Never silently swallowed. */
  skipped: McpWriterSkip[];
}

/**
 * Matches the `${AOA_MCP_<SLUG>_TOKEN}` placeholder that `buildConnectorSpecs`
 * substitutes into `args` / `env` / `headers` in place of the literal `${TOKEN}`
 * template token. The real credential never appears in a spec (D5) — only this
 * placeholder, which the target CLI is expected to expand from its process env.
 *
 * Deliberately anchored on the `AOA_MCP_` prefix: a writer that rewrote or
 * refused every `${...}`-looking string would also mangle a user's own
 * unrelated literal text.
 */
export const AOA_SECRET_PLACEHOLDER_PATTERN = /\$\{(AOA_MCP_[A-Za-z0-9_]*)\}/g;

/** True when `value` contains at least one `${AOA_MCP_*}` placeholder. */
export function containsAoaSecretPlaceholder(value: string): boolean {
  // Fresh regex per call: the exported one is /g and therefore stateful.
  return new RegExp(AOA_SECRET_PLACEHOLDER_PATTERN.source).test(value);
}

/**
 * True when a stdio spec's `args` or `env` still carry a `${AOA_MCP_*}`
 * placeholder — i.e. the connector's credential is delivered by placeholder
 * expansion rather than by an env-var-NAME indirection.
 *
 * Only codex needs this (Plan 2b B2N9, verified against the real CLIs): codex
 * expands nothing inside `args`/`env` AND scrubs its own environment before
 * spawning an MCP child, so there is NO route by which the credential can
 * reach the server. claude, opencode and gemini all expand their own syntax and
 * therefore must NOT call this — for them a placeholder is the working design.
 */
export function stdioSpecCarriesSecretPlaceholder(spec: McpStdioServerSpec): boolean {
  for (const arg of spec.args ?? []) {
    if (typeof arg === "string" && containsAoaSecretPlaceholder(arg)) return true;
  }
  for (const value of Object.values(spec.env ?? {})) {
    if (typeof value === "string" && containsAoaSecretPlaceholder(value)) return true;
  }
  return false;
}

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
 *
 * `alsoReserved` (Plan 2b B2N10 M2) adds caller-specific names to the filter.
 * The bridge's table name is CONFIGURABLE (`options.serverName`), so filtering
 * only the hardcoded list left a hole: an adapter run with a non-default bridge
 * name — say `serverName: "aoa-crew"` — plus a connector called `aoa-crew`
 * emitted two blocks with the same name. codex concatenates strings and does
 * not de-duplicate, so the connector's block (written second) would win and
 * REPLACE AoA's own loopback bridge, exactly the substitution the reserved-name
 * filter exists to prevent. Callers pass their real bridge name here.
 */
export function stripReservedMcpServerNames(
  servers: Record<string, McpServerSpec>,
  alsoReserved: readonly string[] = [],
): Record<string, McpServerSpec> {
  const reserved = new Set<string>([...RESERVED_MCP_SERVER_NAMES, ...alsoReserved]);
  const out: Record<string, McpServerSpec> = Object.create(null);
  for (const [name, spec] of Object.entries(servers)) {
    if (reserved.has(name)) continue;
    out[name] = spec;
  }
  return out;
}

/**
 * Names {@link stripReservedMcpServerNames} would drop from `servers` — the
 * complement of what it keeps. Writers use this to REPORT reserved-name
 * collisions as classified skips instead of dropping them silently.
 */
export function reservedMcpServerNameCollisions(
  servers: Record<string, McpServerSpec>,
  alsoReserved: readonly string[] = [],
): string[] {
  const reserved = new Set<string>([...RESERVED_MCP_SERVER_NAMES, ...alsoReserved]);
  return Object.keys(servers).filter((name) => reserved.has(name));
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
  alsoReserved: readonly string[] = [],
): Record<string, T> {
  const out: Record<string, T> = Object.create(null);
  for (const [name, value] of Object.entries(reserved)) out[name] = value;
  for (const [name, spec] of Object.entries(stripReservedMcpServerNames(external, alsoReserved))) {
    if (Object.prototype.hasOwnProperty.call(out, name)) continue; // reserved wins
    out[name] = toEntry(spec);
  }
  return out;
}
