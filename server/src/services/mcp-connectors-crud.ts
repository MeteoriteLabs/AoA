/**
 * Persistence for founder-registered MCP connectors (Task 11 write path).
 *
 * Deliberately thin — the LOAD-BEARING validation (serverName charset,
 * transport/url/command coherence, template shapes, secretRef existence) lives
 * in the route's zod schema + handler, because the DB enforces none of it (a
 * CHECK on transport would be an enum in disguise, amendment A2). This module
 * only performs I/O once the route has already validated.
 *
 * Split from the pure `mcp-connectors.ts` (spec building / selection) and the
 * read-path `mcp-connectors-loader.ts` so each file carries a single concern.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, companyMcpConnectorAgents, companyMcpConnectors } from "@armyofagents/db";

export type ConnectorInsert = {
  serverName: string;
  displayName: string;
  transport: string;
  url?: string | null;
  command?: string | null;
  args?: string[];
  headerTemplate?: Record<string, string>;
  envTemplate?: Record<string, string>;
  secretRef?: string | null;
  source?: string;
  status: string;
  createdByUserId?: string | null;
};

export type ConnectorPatch = {
  displayName?: string;
  status?: string;
};

export function mcpConnectorService(db: Db) {
  return {
    list: (companyId: string) =>
      db
        .select()
        .from(companyMcpConnectors)
        .where(eq(companyMcpConnectors.companyId, companyId))
        .orderBy(desc(companyMcpConnectors.createdAt)),

    getById: (id: string) =>
      db
        .select()
        .from(companyMcpConnectors)
        .where(eq(companyMcpConnectors.id, id))
        .then((rows) => rows[0] ?? null),

    getByName: (companyId: string, serverName: string) =>
      db
        .select()
        .from(companyMcpConnectors)
        .where(
          and(
            eq(companyMcpConnectors.companyId, companyId),
            eq(companyMcpConnectors.serverName, serverName),
          ),
        )
        .then((rows) => rows[0] ?? null),

    create: (companyId: string, input: ConnectorInsert) =>
      db
        .insert(companyMcpConnectors)
        .values({
          companyId,
          serverName: input.serverName,
          displayName: input.displayName,
          transport: input.transport,
          url: input.url ?? null,
          command: input.command ?? null,
          args: input.args ?? [],
          headerTemplate: input.headerTemplate ?? {},
          envTemplate: input.envTemplate ?? {},
          secretRef: input.secretRef ?? null,
          source: input.source ?? "byo",
          status: input.status,
          createdByUserId: input.createdByUserId ?? null,
        })
        .returning()
        .then((rows) => rows[0]),

    update: (id: string, patch: ConnectorPatch) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.displayName !== undefined) set.displayName = patch.displayName;
      if (patch.status !== undefined) set.status = patch.status;
      return db
        .update(companyMcpConnectors)
        .set(set)
        .where(eq(companyMcpConnectors.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    remove: (id: string) =>
      db
        .delete(companyMcpConnectors)
        .where(eq(companyMcpConnectors.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    listAgentIds: (connectorId: string) =>
      db
        .select({ agentId: companyMcpConnectorAgents.agentId })
        .from(companyMcpConnectorAgents)
        .where(eq(companyMcpConnectorAgents.connectorId, connectorId))
        .then((rows) => rows.map((r) => r.agentId)),

    /**
     * Of the supplied agentIds, return those that actually belong to `companyId`.
     * The route rejects the request when this set is smaller than the request —
     * a connector must never be granted to an agent from another tenant.
     */
    agentIdsInCompany: async (companyId: string, agentIds: string[]): Promise<string[]> => {
      if (agentIds.length === 0) return [];
      const rows = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.companyId, companyId), inArray(agents.id, agentIds)));
      return rows.map((r) => r.id);
    },

    /**
     * Replace the enabled-agent set for a connector atomically: delete all
     * existing links, then insert the new set. Deduped so a repeated agentId in
     * the request cannot trip the (connector, agent) unique index.
     */
    replaceAgents: (companyId: string, connectorId: string, agentIds: string[]) =>
      db.transaction(async (tx) => {
        await tx
          .delete(companyMcpConnectorAgents)
          .where(eq(companyMcpConnectorAgents.connectorId, connectorId));
        const unique = [...new Set(agentIds)];
        if (unique.length > 0) {
          await tx.insert(companyMcpConnectorAgents).values(
            unique.map((agentId) => ({ companyId, connectorId, agentId })),
          );
        }
      }),
  };
}
