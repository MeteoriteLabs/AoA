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
import { logger } from "../middleware/logger.js";
import { selectConnectorRowsForAgent, type ResolvedConnectorRow } from "./mcp-connectors.js";
import { secretService, type SecretConsumerContext } from "./secrets.js";

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

  const selected = selectConnectorRowsForAgent({ connectors, enabledConnectorIds, isCommander });
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
