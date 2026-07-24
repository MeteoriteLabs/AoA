import { Router } from "express";
import { z } from "zod";
import type { Db } from "@armyofagents/db";
import { validate } from "../middleware/validate.js";
import {
  approvalService,
  logActivity,
  mcpConnectorService,
  secretService,
} from "../services/index.js";
import { badRequest, conflict, forbidden } from "../errors.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { assertRole } from "../middleware/rbac.js";
import { loadConfig } from "../config.js";

/**
 * Founder-facing CRUD for external MCP connectors. This is the WRITE PATH —
 * the first point where untrusted founder input enters the connector system —
 * so the validation below is load-bearing for security properties proven in
 * earlier tasks, NOT hygiene:
 *
 *  - serverName charset `/^[a-z0-9-]+$/` (A21): `envVarNameFor` maps every
 *    non-alphanumeric char to `_` and uppercases, so permitting `_` or
 *    uppercase would make that mapping non-injective and let two connectors
 *    collide on ONE secret env var — the wrong credential reaching the wrong
 *    server. The charset also structurally excludes `__proto__` (has `_`).
 *  - transport/url/command coherence (A20).
 *  - args/headerTemplate/envTemplate structural shape (A26): the runtime
 *    `buildConnectorSpecs` only guarantees "won't throw", not "well-formed".
 *  - secretRef must reference an existing company secret (A19/A20) so the
 *    dangling-ref state is hard to create.
 *
 * The DB deliberately enforces none of these (a CHECK on transport would be an
 * enum in disguise, A2), so THIS route is the single enforcement point.
 *
 * GOVERNANCE (close the stdio→host-exec chain on a multi-tenant host):
 *  - D7/C1 (`assertTransportAllowed`): a `stdio` connector runs a command on the
 *    AoA host, so it is refused in `authenticated` mode for founder (BYO) input.
 *  - C2 (PATCH): in `authenticated` mode PATCH may only set status to
 *    "disabled" — activation must flow through connector approval, never PATCH
 *    (which would otherwise be a one- or two-hop activation bypass).
 *  - C3: client-supplied `source` is stripped; every connector created here is
 *    forced to "byo", so the D7 catalog exemption is unreachable from this route.
 *
 * RBAC (A20/D6): create/update/delete/agent-assignment are founder-only — team
 * leads may not add external network access unilaterally. List is any board
 * member.
 */

// LOAD-BEARING: lowercase letters, digits, hyphen only. Do not widen.
const SERVER_NAME_RE = /^[a-z0-9-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const templateRecord = z.record(z.string(), z.string());

/**
 * D7 stdio governance gate. A `stdio` connector's `command` executes on the AoA
 * HOST when the loader serves it — in a multi-tenant/`authenticated` deployment
 * that is remote code execution. So stdio is admissible ONLY when the host is
 * the founder's own machine (`local_trusted`) or the entry is a catalog install
 * whose trust tier is `verified`. `http` is always fine — it makes a network
 * request, never a local exec.
 *
 * THIS IS AN AUTHORIZATION GATE. It answers "is this principal permitted to make
 * this host execute a command at all?" and it is the last line of defence before
 * a write. The install-time CONSENT TOKEN (a separate, later mechanism) is a UX
 * gate: it proves the founder actually saw the exact command they are installing.
 * Consent is NOT a substitute for this check and must never be accepted in its
 * place — a founder can consent to a command they are not authorized to run on a
 * shared host, and an unverified catalog entry's command is untrusted regardless
 * of how clearly it was displayed. Both gates run; neither subsumes the other.
 *
 * C4 — TIER AWARENESS: the catalog exemption requires `trustTier === "verified"`.
 * The gate previously keyed on `source` alone while its comment claimed
 * "verified"; that was safe only for as long as no route could construct a
 * `catalog` source. The catalog install route does exactly that, and the catalog
 * schema admits `community`/`unverified` tiers, so source alone would let an
 * unverified third-party `npx` command spawn a process on a shared host.
 * `trustTier` is optional and FAIL-CLOSED: an omitted or unrecognised tier is
 * never treated as verified.
 *
 * Exported so its full truth table is unit-tested directly.
 */
export function assertTransportAllowed(
  transport: string,
  deploymentMode: string,
  source: string,
  trustTier?: string,
): void {
  if (transport !== "stdio") return; // http is always fine
  if (deploymentMode === "local_trusted") return; // host is the founder's own machine
  if (source === "catalog" && trustTier === "verified") return; // verified catalog entries only (C4)
  throw badRequest(
    "Only remote HTTP connectors can be added in this deployment. stdio connectors run a " +
      "command on the AoA host and are restricted to verified catalog entries.",
  );
}

// C3: `source` is DELIBERATELY absent from the schema and stripped from the body
// before validation, so a client can never set it (a spoofed `source:"catalog"`
// would otherwise walk past the D7 catalog exemption). Every connector created
// here is forced to `"byo"` server-side. Other unknown keys are still rejected
// by `.strict()`.
const stripClientSource = (val: unknown): unknown => {
  if (val && typeof val === "object" && !Array.isArray(val) && "source" in val) {
    const { source: _source, ...rest } = val as Record<string, unknown>;
    return rest;
  }
  return val;
};

const createConnectorSchema = z.preprocess(
  stripClientSource,
  z
    .object({
      serverName: z.string().regex(SERVER_NAME_RE, {
        message: "serverName must match /^[a-z0-9-]+$/ (lowercase letters, digits, hyphen)",
      }),
      displayName: z.string().min(1).max(200),
      transport: z.enum(["http", "stdio"]),
      url: z.string().url().optional(),
      command: z.string().min(1).optional(),
      args: z.array(z.string()).optional().default([]),
      headerTemplate: templateRecord.optional().default({}),
      envTemplate: templateRecord.optional().default({}),
      secretRef: z.string().min(1).optional(),
    })
    .strict()
    .superRefine((val, ctx) => {
      if (val.transport === "http") {
        if (!val.url) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "http transport requires url" });
        }
        if (val.command !== undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["command"], message: "http transport forbids command" });
        }
      } else if (val.transport === "stdio") {
        if (!val.command) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["command"], message: "stdio transport requires command" });
        }
        if (val.url !== undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "stdio transport forbids url" });
        }
      }
    }),
);

// PATCH is intentionally narrow: displayName + status only. Transport-relevant
// fields (transport/url/command/args/templates/serverName) cannot be edited —
// `.strict()` makes any such key a 400. Recreate the connector to change them.
//
// C2: the schema still accepts all three status values because `local_trusted`
// (which has no governance gate) may set any of them. The `authenticated`-mode
// restriction — status may ONLY be set to "disabled" — is enforced in the
// handler, because PATCH is currently the only activation path (the approval
// handler is deferred). Without it, `pending_approval → disabled → active`
// activates in two hops and reaches host-exec (for stdio) with no approval.
const updateConnectorSchema = z
  .object({
    displayName: z.string().min(1).max(200).optional(),
    status: z.enum(["active", "pending_approval", "disabled"]).optional(),
  })
  .strict()
  .refine((v) => v.displayName !== undefined || v.status !== undefined, {
    message: "Provide displayName and/or status",
  });

const replaceAgentsSchema = z
  .object({
    agentIds: z.array(z.string().uuid()),
  })
  .strict();

export function mcpConnectorRoutes(db: Db) {
  const router = Router();
  const svc = mcpConnectorService(db);
  const secretsSvc = secretService(db);
  const approvalsSvc = approvalService(db);

  // List — any board member with access to the company.
  router.get("/companies/:companyId/mcp-connectors", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const rows = await svc.list(companyId);
    res.json(rows);
  });

  // Create — founder only.
  router.post(
    "/companies/:companyId/mcp-connectors",
    validate(createConnectorSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const body = req.body as z.infer<typeof createConnectorSchema>;

      // C3: this route only ever creates BYO connectors. Any client `source` was
      // already stripped in the schema; the value is fixed server-side.
      const source = "byo";

      const deploymentMode = loadConfig().deploymentMode;

      // C1/D7: reject a host-executing stdio connector in a shared deployment
      // BEFORE any write. `source` is the server-forced "byo" here, so the
      // catalog exemption is unreachable from this route by construction; the
      // trust tier is passed as an explicit `undefined` because a BYO connector
      // has no catalog provenance and therefore no tier to vouch for it (C4).
      assertTransportAllowed(body.transport, deploymentMode, source, undefined);

      // Uniqueness (companyId, serverName) — surface a clean 409 instead of a
      // raw unique-violation 500.
      const existing = await svc.getByName(companyId, body.serverName);
      if (existing) {
        throw conflict(`A connector named "${body.serverName}" already exists`);
      }

      // secretRef must point at an existing company secret (A19/A20): reject the
      // dangling-ref state at write time rather than letting the delivery path
      // silently drop the connector later.
      if (body.secretRef) {
        const secret = await secretsSvc.getByName(companyId, body.secretRef);
        if (!secret) {
          throw badRequest(`secretRef "${body.secretRef}" does not reference an existing secret`);
        }
      }

      const actor = getActorInfo(req);
      const createdByUserId = UUID_RE.test(actor.actorId) ? actor.actorId : null;

      // local_trusted: loopback trust boundary → connectors go live immediately.
      // authenticated: board governance → connector is pending until approved.
      const status = deploymentMode === "local_trusted" ? "active" : "pending_approval";

      const created = await svc.create(companyId, {
        serverName: body.serverName,
        displayName: body.displayName,
        transport: body.transport,
        url: body.url ?? null,
        command: body.command ?? null,
        args: body.args,
        headerTemplate: body.headerTemplate,
        envTemplate: body.envTemplate,
        secretRef: body.secretRef ?? null,
        source,
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

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "mcp_connector.created",
        entityType: "mcp_connector",
        entityId: created.id,
        details: { serverName: created.serverName, transport: created.transport, status },
      });

      res.status(201).json({ ...created, approvalId });
    },
  );

  // Update displayName / status — founder only.
  router.patch(
    "/companies/:companyId/mcp-connectors/:id",
    validate(updateConnectorSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const existing = await svc.getById(id);
      if (!existing || existing.companyId !== companyId) {
        res.status(404).json({ error: "Connector not found" });
        return;
      }

      // C2: in a shared deployment, PATCH may only DEACTIVATE. Activation
      // (active) and re-arming for approval (pending_approval) must not be
      // reachable through PATCH — they would bypass the (deferred) approval
      // gate, including the two-hop pending→disabled→active path. Deactivation
      // is always safe. local_trusted has no governance gate, so it is
      // unrestricted.
      const deploymentMode = loadConfig().deploymentMode;
      const nextStatus = (req.body as z.infer<typeof updateConnectorSchema>).status;
      if (
        deploymentMode !== "local_trusted" &&
        nextStatus !== undefined &&
        nextStatus !== "disabled"
      ) {
        throw badRequest(
          "In this deployment a connector can only be disabled via update; activation flows " +
            "through connector approval, not this endpoint.",
        );
      }

      const updated = await svc.update(id, req.body);
      if (!updated) {
        res.status(404).json({ error: "Connector not found" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "mcp_connector.updated",
        entityType: "mcp_connector",
        entityId: id,
        details: req.body,
      });

      res.json(updated);
    },
  );

  // Delete — founder only.
  router.delete("/companies/:companyId/mcp-connectors/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    await assertRole(db, req, companyId, "founder");

    const existing = await svc.getById(id);
    if (!existing || existing.companyId !== companyId) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    const removed = await svc.remove(id);
    if (!removed) {
      res.status(404).json({ error: "Connector not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "mcp_connector.deleted",
      entityType: "mcp_connector",
      entityId: id,
      details: { serverName: removed.serverName },
    });

    res.json(removed);
  });

  // Replace the enabled-agent set — founder only.
  router.put(
    "/companies/:companyId/mcp-connectors/:id/agents",
    validate(replaceAgentsSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const id = req.params.id as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      await assertRole(db, req, companyId, "founder");

      const existing = await svc.getById(id);
      if (!existing || existing.companyId !== companyId) {
        res.status(404).json({ error: "Connector not found" });
        return;
      }

      const { agentIds } = req.body as z.infer<typeof replaceAgentsSchema>;

      // Every agent must belong to THIS company — a connector must never be
      // granted to an agent from another tenant.
      const owned = await svc.agentIdsInCompany(companyId, agentIds);
      const ownedSet = new Set(owned);
      const foreign = [...new Set(agentIds)].filter((agentId) => !ownedSet.has(agentId));
      if (foreign.length > 0) {
        throw forbidden(`Agents do not belong to this company: ${foreign.join(", ")}`);
      }

      await svc.replaceAgents(companyId, id, agentIds);

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "mcp_connector.agents_replaced",
        entityType: "mcp_connector",
        entityId: id,
        details: { agentIds: [...new Set(agentIds)] },
      });

      res.json({ connectorId: id, agentIds: [...new Set(agentIds)] });
    },
  );

  return router;
}
