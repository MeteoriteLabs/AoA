/**
 * @fileoverview THE single creation path for an MCP connector.
 *
 * WHY THIS EXISTS: `mcpConnectorService.create()` is a bare INSERT — that
 * module's own header says the load-bearing validation lives in the caller. All
 * of the actual governance previously sat inline in the founder-facing POST
 * handler: the (companyId, serverName) 409, the secretRef-existence check, the
 * status derivation, the `install_mcp_connector` approval, and the activity-log
 * entry. A second caller (the catalog install route) reaching for `svc.create()`
 * would silently fork every one of those into an untested copy — D6/D7 would
 * then exist in two places and the marketplace copy would be the untested one.
 * Both callers now share this function.
 *
 * WHAT IS DELIBERATELY *NOT* HERE — the D7 transport gate
 * (`assertTransportAllowed`). It needs the CATALOG TRUST TIER, which only the
 * caller knows (a BYO connector has no tier at all), and it must run BEFORE any
 * write. So each caller asserts it itself, ahead of calling this function. There
 * is a test pinning this absence; do not "helpfully" move the gate in here.
 *
 * STATUS: on THIS PATH, `resolveConnectorStatus` is the only thing that decides
 * the status — this function does not branch on deployment mode itself, it hands
 * the axes to that resolver and persists the answer. The approve path
 * (`applyConnectorApproval`) and the credential-binding route now do the same;
 * PATCH → "active" stays deliberately open in `local_trusted` only. See the
 * SCOPE note in mcp-connector-status.ts before relying on it more broadly.
 *
 * DEPENDENCIES ARE INJECTED so the governance above is unit-testable with no DB.
 */

import { badRequest, conflict } from "../errors.js";
import { resolveConnectorStatus } from "./mcp-connector-status.js";
import type { LogActivityInput } from "./activity-log.js";
import type { ConnectorInsert } from "./mcp-connectors-crud.js";
// TYPE-ONLY, and it must stay that way: these imports are erased at build time,
// so this module pulls in neither drizzle nor a DB handle at runtime — which is
// what lets the governance above be unit-tested with plain object mocks.
import type { approvals } from "@armyofagents/db";

// Matches the founder-facing route's original check: an actorId that is not a
// UUID (e.g. the synthetic "board"/"mcp-user" ids) is NOT a foreign key into
// users, so it must be stored as null rather than corrupting provenance.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ApprovalInsert = Omit<typeof approvals.$inferInsert, "companyId">;

/** The slice of each service this function actually uses. */
export type CreateConnectorDeps = {
  svc: {
    getByName: (companyId: string, serverName: string) => Promise<unknown>;
    create: (companyId: string, input: ConnectorInsert) => Promise<any>;
  };
  secretsSvc: {
    getByName: (companyId: string, name: string) => Promise<unknown>;
  };
  approvalsSvc: {
    create: (companyId: string, data: ApprovalInsert) => Promise<{ id: string } | null | undefined>;
  };
  /**
   * Pre-bound to the caller's `db` — this module never touches a Db handle, which
   * is what keeps it unit-testable.
   */
  logActivity: (input: LogActivityInput) => Promise<void>;
};

export type CreateConnectorInput = {
  companyId: string;
  serverName: string;
  displayName: string;
  /**
   * Narrow on purpose: this is the field the D7 gate keys on, and the future
   * catalog caller is exactly who a widened `string` would fail to protect.
   */
  transport: "http" | "stdio";
  url?: string | null;
  command?: string | null;
  args?: string[];
  headerTemplate?: Record<string, string>;
  envTemplate?: Record<string, string>;
  secretRef?: string | null;
  /** Does this connector refuse to function without a bound secret? BYO = false. */
  requiresSecret: boolean;
  /** Forced by the caller, never taken from a client body. */
  source: "byo" | "catalog";
  deploymentMode: string;
  actor: { actorType: "user" | "agent"; actorId: string; agentId: string | null };
};

export async function createConnector(
  deps: CreateConnectorDeps,
  input: CreateConnectorInput,
): Promise<{ connector: any; approvalId: string | null }> {
  const { svc, secretsSvc, approvalsSvc, logActivity } = deps;
  const { companyId, actor } = input;

  // Uniqueness (companyId, serverName) — surface a clean 409 instead of a raw
  // unique-violation 500.
  const existing = await svc.getByName(companyId, input.serverName);
  if (existing) {
    throw conflict(`A connector named "${input.serverName}" already exists`);
  }

  // secretRef must point at an existing company secret (A19/A20): reject the
  // dangling-ref state at write time rather than letting the delivery path
  // silently drop the connector later.
  if (input.secretRef) {
    const secret = await secretsSvc.getByName(companyId, input.secretRef);
    if (!secret) {
      throw badRequest(`secretRef "${input.secretRef}" does not reference an existing secret`);
    }
  }

  // Governance and credential axes are orthogonal; one resolver owns both.
  // local_trusted is a loopback trust boundary, so creation there is implicitly
  // approved — everywhere else a connector starts unapproved.
  const status = resolveConnectorStatus({
    deploymentMode: input.deploymentMode,
    approved: input.deploymentMode === "local_trusted",
    requiresSecret: input.requiresSecret,
    hasSecret: Boolean(input.secretRef),
  });

  const createdByUserId = UUID_RE.test(actor.actorId) ? actor.actorId : null;

  const created = await svc.create(companyId, {
    serverName: input.serverName,
    displayName: input.displayName,
    transport: input.transport,
    url: input.url ?? null,
    command: input.command ?? null,
    args: input.args ?? [],
    headerTemplate: input.headerTemplate ?? {},
    envTemplate: input.envTemplate ?? {},
    secretRef: input.secretRef ?? null,
    requiresSecret: input.requiresSecret,
    source: input.source,
    status,
    createdByUserId,
  });

  let approvalId: string | null = null;
  if (status === "pending_approval") {
    const approval = await approvalsSvc.create(companyId, {
      type: "install_mcp_connector",
      requestedByUserId: actor.actorType === "user" ? actor.actorId : null,
      status: "pending",
      payload: { connectorId: created.id, serverName: created.serverName },
    });
    approvalId = approval?.id ?? null;
  }

  await logActivity({
    companyId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    agentId: actor.agentId,
    action: "mcp_connector.created",
    entityType: "mcp_connector",
    entityId: created.id,
    details: { serverName: created.serverName, transport: created.transport, status },
  });

  return { connector: created, approvalId };
}
