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
import { badRequest, forbidden } from "../errors.js";
import { createConnector } from "../services/mcp-connector-create.js";
import { resolveConnectorStatus } from "../services/mcp-connector-status.js";
import { assertTransportAllowed } from "../services/mcp-connector-transport-gate.js";
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
 *
 * The DB deliberately enforces none of these (a CHECK on transport would be an
 * enum in disguise, A2), so THIS route is the single enforcement point for the
 * SHAPE of founder input.
 *
 * WHAT IS NOT HERE (I2): everything downstream of shape — the
 * (companyId, serverName) 409, the secretRef-existence check (A19/A20), status
 * derivation, the `install_mcp_connector` approval, and the activity log — lives
 * in the shared `createConnector` service (services/mcp-connector-create.ts).
 * That extraction is deliberate: the catalog install route creates connectors
 * too, and a second inline copy of that governance would drift, with the
 * marketplace copy being the untested one.
 *
 * GOVERNANCE (close the stdio→host-exec chain on a multi-tenant host):
 *  - D7/C1 (`assertTransportAllowed`, services/mcp-connector-transport-gate.ts):
 *    a `stdio` connector runs a command on the AoA host, so it is refused in
 *    `authenticated` mode for founder (BYO) input.
 *  - C2 (PATCH): in `authenticated` mode PATCH may only set status to
 *    "disabled" — activation must flow through connector approval, never PATCH
 *    (which would otherwise be a one- or two-hop activation bypass).
 *  - C3: client-supplied `source` is stripped; every connector created here is
 *    forced to "byo", so the D7 catalog exemption is unreachable from this route.
 *  - C3 (POST …/:id/credentials): binding a secret re-derives the status through
 *    `resolveConnectorStatus` instead of accepting one. It cannot activate a
 *    connector still awaiting approval and cannot resurrect a disabled one, so it
 *    is not a second activation surface.
 *
 * RBAC (A20/D6): create/update/delete/agent-assignment are founder-only — team
 * leads may not add external network access unilaterally. List is any board
 * member.
 */

// LOAD-BEARING: lowercase letters, digits, hyphen only. Do not widen.
const SERVER_NAME_RE = /^[a-z0-9-]+$/;

const templateRecord = z.record(z.string(), z.string());

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
// `secretRef` is NOT here on purpose, even though `ConnectorPatch` now carries it:
// changing the bound credential without re-deriving `status` in the same write is
// how a connector ends up `active` pointing at a dangling ref. Binding goes
// through POST …/:id/credentials, which validates the secret and re-derives.
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

// C3 — the secret-binding body. `secretRef` and NOTHING else.
//
// The resulting status is DERIVED from `resolveConnectorStatus`, never accepted
// from the caller. `.strict()` (rather than quietly dropping unknown keys) is the
// load-bearing part: a request carrying `status: "active"` must be a 400. If it
// were silently ignored the caller would believe they had activated the
// connector, and the endpoint would read as a second activation surface next to
// the PATCH one the handler above works to close.
export const bindCredentialsSchema = z
  .object({ secretRef: z.string().min(1) })
  .strict();

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

      const actor = getActorInfo(req);

      // Everything past the D7 gate — the (companyId, serverName) 409, the
      // secretRef-existence check, status derivation, the approval, and the
      // activity log — lives in the SHARED create service so the catalog install
      // route cannot fork it into an untested copy.
      const { connector: created, approvalId } = await createConnector(
        { svc, secretsSvc, approvalsSvc, logActivity: (entry) => logActivity(db, entry) },
        {
          companyId,
          serverName: body.serverName,
          displayName: body.displayName,
          transport: body.transport,
          url: body.url ?? null,
          command: body.command ?? null,
          args: body.args,
          headerTemplate: body.headerTemplate,
          envTemplate: body.envTemplate,
          secretRef: body.secretRef ?? null,
          // BYO: the founder supplies every credential up front, so a BYO
          // connector is never in the "installed but uncredentialed" state that
          // `requiresSecret` exists to describe.
          requiresSecret: false,
          source,
          deploymentMode,
          actor,
        },
      );

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

  // Bind a company secret to a connector, then RE-DERIVE its status — founder only.
  //
  // C3: this is the missing middle of the central journey. A catalog connector is
  // installed unconfigured (`needs_credentials`) and must never reach an agent
  // until a credential is bound; before this route there was no way to set
  // `secretRef` after create, so `needs_credentials → active` was unreachable.
  router.post(
    "/companies/:companyId/mcp-connectors/:id/credentials",
    validate(bindCredentialsSchema),
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

      const { secretRef } = req.body as z.infer<typeof bindCredentialsSchema>;

      // Same A19/A20 rule as create: a secretRef must name an EXISTING company
      // secret. Rejecting the dangling ref here beats letting the delivery path
      // silently drop the connector at run time. Scoped to this company, so a
      // founder cannot bind another tenant's secret.
      const secret = await secretsSvc.getByName(companyId, secretRef);
      if (!secret) {
        throw badRequest(`secretRef "${secretRef}" does not reference an existing secret`);
      }

      // HOW `approved` IS INFERRED, and why the current status is a sound signal.
      //
      // There is no approval pointer on the connector row, so the status itself is
      // the only governance evidence available. It is sufficient because status is
      // the OUTPUT of the governance axis, and only two writers produce it:
      //   - create  (mcp-connector-create.ts): in a non-local_trusted deployment a
      //     new connector is ALWAYS `pending_approval`, whatever its credentials.
      //   - approve/reject (applyConnectorApproval / applyConnectorRejection).
      // So in a shared deployment a connector can reach `needs_credentials` or
      // `active` ONLY by having been approved, and `pending_approval` means it has
      // not been. That makes the mapping below a reading of governance state, not a
      // guess:
      //   pending_approval → not yet approved  → binding leaves it pending (no bypass)
      //   disabled         → rejected/deactivated
      //   needs_credentials / active → governance already satisfied
      //
      // `disabled` is short-circuited rather than fed to the resolver: with
      // approved=true the resolver would answer `active`, i.e. binding a secret
      // would RESURRECT a connector the board rejected. Re-enabling is PATCH's job
      // (and in a shared deployment, a fresh approval's).
      //
      // Nothing here decides `active` on its own — `resolveConnectorStatus` does,
      // and it is unconditionally incapable of returning `active` while the
      // connector requires a secret it does not have.
      const approved = existing.status !== "pending_approval" && existing.status !== "disabled";
      const nextStatus =
        existing.status === "disabled"
          ? "disabled"
          : resolveConnectorStatus({
            deploymentMode: loadConfig().deploymentMode,
            approved,
            requiresSecret: existing.requiresSecret === true,
            // A non-empty secretRef was just validated to exist, so it IS bound.
            hasSecret: true,
          });

      const updated = await svc.update(id, { secretRef, status: nextStatus });
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
        action: "mcp_connector.credentials_bound",
        entityType: "mcp_connector",
        entityId: id,
        // `secretRef` is a secret NAME, never a secret value — safe to log, and it
        // is what makes a later "which credential was bound?" audit answerable.
        details: { secretRef, status: nextStatus },
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
