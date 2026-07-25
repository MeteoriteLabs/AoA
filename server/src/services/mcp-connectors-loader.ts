/**
 * DB loader for MCP connectors: reads a company's connector rows, applies the
 * per-agent selection rule, and resolves each surviving connector's secret into
 * the shape `buildConnectorSpecs` consumes.
 *
 * Deliberately split from `mcp-connectors.ts` (amendment A24): that module stays
 * pure — no `drizzle-orm`, no `@armyofagents/db` — so the spec-building and
 * selection logic is testable with plain objects and carries zero runtime
 * dependencies. All I/O lives here.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { companyMcpConnectorAgents, companyMcpConnectors } from "@armyofagents/db";
import type { McpServerSpec } from "@armyofagents/adapter-utils";
import { logger } from "../middleware/logger.js";
import {
  adapterSupportsConnectors,
  buildConnectorSpecs,
  parseConnectorServerName,
  selectConnectorRowsForAgent,
  type ResolvedConnectorRow,
} from "./mcp-connectors.js";
import { secretService, type SecretConsumerContext } from "./secrets.js";
import { loadConfig } from "../config.js";

export interface LoadEnabledConnectorRowsOptions {
  companyId: string;
  /**
   * The agent this run belongs to, or `null` for Commander. Commander is not
   * represented in `company_mcp_connector_agents` and receives every ACTIVE
   * company connector (D3).
   */
  agentId: string | null;
}

/**
 * Consumer identity for connector secret reads. `consumerType: "system"` is
 * load-bearing: `shouldEnforceSecretBinding` exempts system consumers from
 * requiring a `company_secret_bindings` row (secrets.ts), matching how the
 * GitHub PAT and provider keys resolve. The access is still audited, and
 * `configPath` names the individual connector so the audit trail distinguishes
 * them.
 */
function consumerContextFor(serverName: string): SecretConsumerContext {
  return {
    consumerType: "system",
    consumerId: "mcp-connectors",
    actorType: "system",
    configPath: `mcp.connector.${serverName}`,
  };
}

/**
 * Load the connectors an agent run should receive, with secrets resolved.
 *
 * FAILURE ISOLATION (amendment A19): `resolveByName` THROWS when the referenced
 * secret is missing, soft-deleted, or inactive — a state trivially reached by
 * deleting a secret while a connector still points at it. Letting that
 * propagate would abort the whole load and hand the run NO connectors,
 * including every healthy one, with no visible cause. So each secret read is
 * isolated: a failure drops that ONE connector and logs a warning naming it.
 * One broken connector must degrade to "that connector is unavailable", never
 * "no connectors at all".
 */
export async function loadEnabledConnectorRows(
  db: Db,
  { companyId, agentId }: LoadEnabledConnectorRowsOptions,
): Promise<ResolvedConnectorRow[]> {
  // Fetch ALL of the company's connectors and let the pure selector apply the
  // status rule. Pre-filtering `status = 'active'` in SQL would put a
  // security-relevant predicate in two places, and the SQL copy is the one no
  // unit test covers.
  const connectors = await db
    .select()
    .from(companyMcpConnectors)
    .where(eq(companyMcpConnectors.companyId, companyId));

  const isCommander = agentId === null;

  // Commander is exempt from the per-agent opt-in, so the join table holds no
  // rows for it and querying it would be a pointless round-trip.
  let enabledConnectorIds = new Set<string>();
  if (agentId !== null) {
    const links = await db
      .select()
      .from(companyMcpConnectorAgents)
      .where(
        and(
          eq(companyMcpConnectorAgents.companyId, companyId),
          eq(companyMcpConnectorAgents.agentId, agentId),
        ),
      );
    enabledConnectorIds = new Set(links.map((link) => link.connectorId));
  }

  // FU-19: re-assert D7 against the host's CURRENT deployment mode. A connector
  // admissible at CREATE time (e.g. stdio/byo under local_trusted) but not under
  // the mode the host runs in NOW is dropped here rather than executed on a
  // shared host. The skip is logged (never silent) so an operator can see why a
  // connector stopped being delivered after a mode conversion.
  const deploymentMode = loadConfig().deploymentMode;
  const selected = selectConnectorRowsForAgent({
    connectors,
    enabledConnectorIds,
    isCommander,
    deploymentMode,
    onSkip: (connector, reason) => {
      logger.warn(
        {
          companyId,
          connectorId: connector.id,
          serverName: connector.serverName,
          transport: connector.transport,
          source: connector.source,
          deploymentMode,
          reason,
        },
        "MCP connector skipped at delivery: no longer admissible under the current deployment mode (D7)",
      );
    },
  });
  if (selected.length === 0) return [];

  const secrets = secretService(db);
  const resolved: ResolvedConnectorRow[] = [];

  for (const connector of selected) {
    let secretValue: string | null = null;

    // A connector with no secretRef is an unauthenticated server — a legitimate
    // configuration, not a failure. Do not call the secrets service for it.
    if (connector.secretRef) {
      try {
        secretValue = await secrets.resolveByName(
          companyId,
          connector.secretRef,
          consumerContextFor(connector.serverName),
        );
      } catch (err) {
        // Never log `secretValue` here — resolution failed, but keep the habit
        // explicit so a future edit does not add it.
        logger.warn(
          {
            err,
            companyId,
            connectorId: connector.id,
            serverName: connector.serverName,
            secretRef: connector.secretRef,
          },
          "MCP connector skipped: secret could not be resolved",
        );
        continue;
      }
    }

    resolved.push({
      serverName: connector.serverName,
      transport: connector.transport,
      url: connector.url,
      command: connector.command,
      args: connector.args,
      headerTemplate: connector.headerTemplate,
      envTemplate: connector.envTemplate,
      secretValue,
    });
  }

  return resolved;
}

export interface ConnectorToolAutoAllowInput {
  companyId: string;
  /** Trusted run agent id, or `null` for Commander (all-active, D3). */
  agentId: string | null;
  /** The run's adapter type — only connector-capable adapters can host MCP servers. */
  adapterType: string | null | undefined;
  /** The raw PreToolUse tool name, expected shape `mcp__<serverName>__<tool>`. */
  toolName: string | null | undefined;
}

/**
 * FU-25: decide whether a runtime PreToolUse permission request is for a tool
 * that belongs to a connector THIS run is allowed to use — and may therefore be
 * auto-allowed without a human. Returns `true` ONLY when every scoping rule
 * holds:
 *
 *  1. The tool name parses to a non-reserved connector serverName
 *     (`parseConnectorServerName` — reserved `aoa`/`playwright` and malformed
 *     names return null → false here). Only the connector's OWN tools qualify.
 *  2. The adapter is connector-capable (a non-MCP adapter has no connector tools;
 *     a query would be wasted and the answer is trivially no).
 *  3. There is a company connector with that exact serverName that survives the
 *     SAME delivery selector `selectConnectorRowsForAgent` — status === "active"
 *     AND (assigned to this agent via `company_mcp_connector_agents`, OR
 *     Commander) AND admissible under the host's CURRENT deployment mode (D7).
 *
 * This is intentionally a THIN wrapper over the exact query + selector the
 * delivery path uses (`loadEnabledConnectorRows`), minus secret resolution: a
 * broken secret is a delivery failure, not an authorization one, and the
 * permission grant is still correctly scoped to an active, assigned connector.
 * Reusing `selectConnectorRowsForAgent` keeps the security predicate in ONE
 * place — it cannot drift from what actually gets delivered.
 *
 * Company + agent scope come from the run's VERIFIED context (the caller passes
 * the broker's own companyId/agentId), never from the hook request body.
 */
export async function isConnectorToolAutoAllowed(
  db: Db,
  input: ConnectorToolAutoAllowInput,
): Promise<boolean> {
  const serverName = parseConnectorServerName(input.toolName);
  if (serverName === null) return false;
  if (!adapterSupportsConnectors(input.adapterType)) return false;

  const isCommander = input.agentId === null;

  const connectors = await db
    .select()
    .from(companyMcpConnectors)
    .where(eq(companyMcpConnectors.companyId, input.companyId));

  let enabledConnectorIds = new Set<string>();
  if (input.agentId !== null) {
    const links = await db
      .select()
      .from(companyMcpConnectorAgents)
      .where(
        and(
          eq(companyMcpConnectorAgents.companyId, input.companyId),
          eq(companyMcpConnectorAgents.agentId, input.agentId),
        ),
      );
    enabledConnectorIds = new Set(links.map((link) => link.connectorId));
  }

  const deploymentMode = loadConfig().deploymentMode;
  const selected = selectConnectorRowsForAgent({
    connectors,
    enabledConnectorIds,
    isCommander,
    deploymentMode,
  });

  return selected.some((connector) => connector.serverName === serverName);
}

/** Minimal logger surface `resolveAgentConnectors` needs — matches pino's `.warn(meta, msg)` shape. */
export interface ConnectorLogger {
  warn: (meta: Record<string, unknown>, msg: string) => void;
}

export interface ResolveAgentConnectorsInput {
  companyId: string;
  /** Real agent id for per-agent opt-in (D4); null for Commander/all-active (D3). */
  agentId: string | null;
  runId?: string;
  logger?: ConnectorLogger;
}

export interface ResolveAgentConnectorsResult {
  extraMcpServers: Record<string, McpServerSpec>;
  connectorEnv: Record<string, string>;
}

/**
 * Single place all three delivery paths (heartbeat, crew, Commander) resolve a
 * company's enabled connectors into `{ extraMcpServers, connectorEnv }`.
 *
 * Lives here (not in the pure `mcp-connectors.ts`) deliberately: it needs BOTH
 * `loadEnabledConnectorRows` (this file, DB I/O) and `buildConnectorSpecs` (the
 * pure module, which this file already imports one-way). Putting this in the
 * pure module and importing the loader back would create a
 * `mcp-connectors.ts ⇄ mcp-connectors-loader.ts` cycle.
 *
 * Skipped connectors are logged HERE (a silently vanishing connector is the
 * worst failure mode — A8/A19) rather than left for callers to remember, so
 * the skip-log has one unit-testable seam instead of three call-site copies.
 */
export async function resolveAgentConnectors(
  db: Db,
  input: ResolveAgentConnectorsInput,
): Promise<ResolveAgentConnectorsResult> {
  const rows = await loadEnabledConnectorRows(db, {
    companyId: input.companyId,
    agentId: input.agentId,
  });
  const { specs, env, skipped } = buildConnectorSpecs(rows);
  if (skipped.length > 0 && input.logger) {
    input.logger.warn(
      {
        companyId: input.companyId,
        agentId: input.agentId,
        runId: input.runId,
        skipped,
      },
      "mcp connectors skipped for agent run",
    );
  }
  return { extraMcpServers: specs, connectorEnv: env };
}
