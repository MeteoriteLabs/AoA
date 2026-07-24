import type { McpServerSpec } from "@armyofagents/adapter-utils";

/**
 * A connector row joined with its resolved secret value. Source table:
 * `company_mcp_connectors` (packages/db/src/schema/company_mcp_connectors.ts) —
 * keep the field names identical so drift is greppable.
 *
 * PRECONDITION: `args`/`headerTemplate`/`envTemplate` arrive non-null (the
 * columns are NOT NULL with defaults). These are jsonb, so `$type<string[]>()`
 * is a compile-time assertion with no runtime guarantee (A5) — buildConnectorSpecs
 * defends against a violation rather than trusting it.
 */
export interface ResolvedConnectorRow {
  serverName: string;
  transport: string;
  url: string | null;
  command: string | null;
  args: string[];
  headerTemplate: Record<string, string>;
  envTemplate: Record<string, string>;
  /** Real secret. NEVER placed into a spec — only into the returned env map. */
  secretValue: string | null;
}

/** Why a connector row produced no spec. */
export type ConnectorSkipReason =
  | "missing_url"
  | "missing_command"
  | "unknown_transport"
  | "malformed_row";

export interface ConnectorBuildResult {
  specs: Record<string, McpServerSpec>;
  env: Record<string, string>;
  /**
   * Connectors that were dropped, and why. A silently vanishing connector is
   * the worst failure mode for a security-adjacent feature (A8), and a pure
   * function cannot log — so it reports instead. Callers are expected to
   * surface this.
   */
  skipped: Array<{ serverName: string; reason: ConnectorSkipReason }>;
}

/**
 * Deterministic env var name for a connector's secret. The config file
 * references this name; the real value is injected into the spawned process
 * env (design decision D5, empirically verified in Task 4).
 *
 * Each non-alphanumeric character maps to ONE underscore — deliberately not
 * `[^a-zA-Z0-9]+`, which would collapse runs and lose information (`a-b` and
 * `a--b` would share an env var). This mapping is still not injective (`a-b`
 * and `a_b` both yield `A_B`), so it does NOT by itself guarantee that two
 * connectors get distinct env vars; uniqueness must come from validating
 * serverName's charset at write time.
 */
export function envVarNameFor(serverName: string): string {
  const slug = serverName.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  return `AOA_MCP_${slug}_TOKEN`;
}

/**
 * Adapter types whose runtime can actually host external MCP servers, and are
 * therefore worth a connector DB read before a run.
 *
 * SINGLE SOURCE OF TRUTH for the connector gate — both delivery call sites
 * (`heartbeat.ts` and the crew `aoa-agents/runner.ts`) import
 * `adapterSupportsConnectors` from here rather than repeating the list. Lives
 * in this pure module (no drizzle, no `@armyofagents/db`) so the two callers
 * share it without either importing the other, and so tests that mock
 * `mcp-connectors-loader.js` wholesale still get the real predicate.
 *
 * Everything NOT listed here (`process`, `http`, `cursor`, `hermes_local`, the
 * test adapters) has no MCP client at all: resolving connectors for them would
 * be wasted I/O plus a needless per-run failure surface, so they must never
 * trigger the lookup.
 */
export const CONNECTOR_CAPABLE_ADAPTERS: ReadonlySet<string> = new Set([
  "claude_local",
  "codex_local",
  "gemini_local",
  "opencode_local",
]);

/** True when `adapterType` can consume external MCP connectors. */
export function adapterSupportsConnectors(adapterType: string | null | undefined): boolean {
  return typeof adapterType === "string" && CONNECTOR_CAPABLE_ADAPTERS.has(adapterType);
}

export interface ConnectorSelectionInput<T extends { id: string; status: string }> {
  connectors: T[];
  enabledConnectorIds: Set<string>;
  /** Commander receives every ACTIVE connector, exempt from per-agent opt-in (D3). */
  isCommander: boolean;
}

/**
 * Single source of truth for which connectors an agent run receives.
 *
 * Status is checked FIRST and applies to Commander too — the D3 exemption is
 * from the per-agent opt-in ONLY, never from approval status. A
 * `pending_approval` connector has not been approved by anyone; handing it to
 * Commander would make the approval gate bypassable by asking Commander
 * instead of an agent.
 *
 * Deliberately the only place the status rule lives. The loader passes ALL of a
 * company's connector rows through here rather than pre-filtering by status in
 * SQL — two copies of a security predicate drift, and the SQL copy is the one
 * no unit test covers.
 */
export function selectConnectorRowsForAgent<T extends { id: string; status: string }>(
  input: ConnectorSelectionInput<T>,
): T[] {
  return input.connectors.filter((c) => {
    if (c.status !== "active") return false;
    return input.isCommander || input.enabledConnectorIds.has(c.id);
  });
}

/**
 * Convert connector rows into adapter specs + the env map carrying secrets.
 * Templates use the literal token `${TOKEN}`, rewritten to the connector's
 * real env var name. All three template surfaces behave alike: http `headers`,
 * stdio `env`, and stdio `args`.
 *
 * Rows that cannot form a valid spec are SKIPPED rather than emitted
 * malformed: http without url, stdio without command, any unrecognized
 * transport, and any row whose jsonb columns are the wrong runtime shape. Each
 * skip is reported in `skipped` — never swallowed. One bad row must degrade to
 * "that connector is unavailable", never "no connectors at all" (A19).
 */
export function buildConnectorSpecs(rows: ResolvedConnectorRow[]): ConnectorBuildResult {
  // Null-prototype: serverName is an untrusted runtime string from a DB row. A
  // connector named `__proto__` assigned onto a normal object literal would set
  // the prototype instead of adding a key, and the connector would silently
  // vanish here — BEFORE buildMcpConfig's own guard could ever see it
  // (amendment A13). A charset check does not substitute: `__proto__` passes
  // /^[a-zA-Z0-9_-]+$/ (amendment A8-CORRECTION).
  const specs: Record<string, McpServerSpec> = Object.create(null);
  const env: Record<string, string> = Object.create(null);
  const skipped: ConnectorBuildResult["skipped"] = [];

  for (const row of rows) {
    const varName = envVarNameFor(row.serverName);
    const substitute = (value: string): string => value.replaceAll("${TOKEN}", `\${${varName}}`);
    const substituteValues = (template: Record<string, string>): Record<string, string> =>
      Object.fromEntries(Object.entries(template).map(([k, v]) => [k, substitute(v)]));

    // A malformed row must not take the healthy ones down with it: `args.map`
    // and `Object.entries` throw if a jsonb column holds the wrong runtime
    // shape (A5/A19). Structural validation belongs at write time (Task 11);
    // this is the defensive floor.
    try {
      if (row.transport === "http") {
        if (!row.url) {
          skipped.push({ serverName: row.serverName, reason: "missing_url" });
          continue;
        }
        specs[row.serverName] = {
          kind: "http",
          url: row.url,
          headers: substituteValues(row.headerTemplate),
          // Env-var-NAME indirection for CLIs that take a variable name rather
          // than expanding `${VAR}` inline (e.g. codex's `bearer_token_env_var`).
          // Same `varName` as the env map key below — never a secret value, and
          // never set when there is no secret to point at.
          ...(row.secretValue ? { authTokenEnvVar: varName } : {}),
        };
      } else if (row.transport === "stdio") {
        if (!row.command) {
          skipped.push({ serverName: row.serverName, reason: "missing_command" });
          continue;
        }
        specs[row.serverName] = {
          kind: "stdio",
          command: row.command,
          // Substituted like headers/env: Task 4 proved `${VAR}` expands in
          // stdio args too, so a connector configured as `["--token", "${TOKEN}"]`
          // must get the real var name. Copying verbatim would emit a literal
          // `${TOKEN}`, which expands to nothing and authenticates as no-one.
          args: row.args.map((value) => substitute(value)),
          env: substituteValues(row.envTemplate),
        };
      } else {
        // Unknown transport — skip rather than guess. `transport` is free text
        // in the schema and A2 anticipates "sse" being added later; an `else`
        // that fell through to stdio would emit a stdio spec for any such row
        // that happened to carry a command.
        skipped.push({ serverName: row.serverName, reason: "unknown_transport" });
        continue;
      }
    } catch {
      skipped.push({ serverName: row.serverName, reason: "malformed_row" });
      continue;
    }

    // MUST stay below the branch. Hoisting it above would write a live
    // credential into the spawn env for a connector that has no config entry —
    // readable by the CLI and by every other stdio connector in the run.
    if (row.secretValue) {
      env[varName] = row.secretValue;
    }
  }

  return { specs, env, skipped };
}
