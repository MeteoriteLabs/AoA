import { buildScrubbedCliEnv } from "./cli-spawn-safety.js";

/**
 * PURE merge half, unit-testable with synthetic input.
 *
 * The scrubbed base WINS over connector vars — a connector must never be able
 * to redirect PATH (or any other base entry) and hijack executable resolution
 * for a spawned stdio server. Result is null-prototype: connector-token keys
 * come from envVarNameFor (sanitized) but the base is process.env, so defense
 * in depth against a hostile inherited key.
 */
export function mergeConnectorEnv(
  scrubbedBase: NodeJS.ProcessEnv,
  connectorEnv: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const [k, v] of Object.entries(connectorEnv)) out[k] = v;
  for (const [k, v] of Object.entries(scrubbedBase)) {
    if (v !== undefined) out[k] = v; // base wins
  }
  return out;
}

/**
 * Environment for a CLI that will talk to EXTERNAL MCP servers. Starts from the
 * scrubbed base (denylist + secret-ish heuristics; DATABASE_URL and provider
 * keys removed) and adds ONLY the connector token vars. AoA's own secrets must
 * never reach a third-party server.
 *
 * `buildScrubbedCliEnv` denies-by-exception (AOA_* prefix, an exact infra-cred
 * set, vendor auth keys, and a generic secret/token/password/etc regex) rather
 * than allow-listing, so an empty `keep` still passes through PATH/HOME/APPDATA/
 * TMP/SystemRoot/etc. — verified empirically below and in the test file.
 */
export function buildConnectorProcessEnv(
  connectorEnv: Record<string, string>,
): Record<string, string> {
  return mergeConnectorEnv(buildScrubbedCliEnv([]), connectorEnv);
}
