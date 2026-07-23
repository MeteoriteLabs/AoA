import type { McpServerSpec } from "@armyofagents/adapter-utils";

/** A connector row joined with its resolved secret value. */
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

export interface ConnectorBuildResult {
  specs: Record<string, McpServerSpec>;
  env: Record<string, string>;
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
 * Convert connector rows into adapter specs + the env map carrying secrets.
 * Templates use the literal token `${TOKEN}`, rewritten to the connector's
 * real env var name. All three template surfaces behave alike: http `headers`,
 * stdio `env`, and stdio `args`.
 *
 * Rows that cannot form a valid spec are SKIPPED rather than emitted
 * malformed: http without url, stdio without command, and any unrecognized
 * transport.
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

  for (const row of rows) {
    const varName = envVarNameFor(row.serverName);
    const substitute = (value: string): string => value.replaceAll("${TOKEN}", `\${${varName}}`);

    if (row.transport === "http") {
      if (!row.url) continue;
      specs[row.serverName] = {
        kind: "http",
        url: row.url,
        headers: Object.fromEntries(
          Object.entries(row.headerTemplate).map(([k, v]) => [k, substitute(v)]),
        ),
      };
    } else if (row.transport === "stdio") {
      if (!row.command) continue;
      specs[row.serverName] = {
        kind: "stdio",
        command: row.command,
        // Substituted like headers/env: Task 4 proved `${VAR}` expands in
        // stdio args too, so a connector configured as `["--token", "${TOKEN}"]`
        // must get the real var name. Copying verbatim would emit a literal
        // `${TOKEN}`, which expands to nothing and authenticates as no-one.
        args: row.args.map((value) => substitute(value)),
        env: Object.fromEntries(
          Object.entries(row.envTemplate).map(([k, v]) => [k, substitute(v)]),
        ),
      };
    } else {
      // Unknown transport — skip rather than guess. `transport` is free text in
      // the schema and A2 anticipates "sse" being added later; an `else` that
      // fell through to stdio would emit a stdio spec for any such row that
      // happened to carry a command.
      continue;
    }

    if (row.secretValue) {
      env[varName] = row.secretValue;
    }
  }

  return { specs, env };
}
