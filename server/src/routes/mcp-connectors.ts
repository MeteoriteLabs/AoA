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
 * RBAC (A20/D6): create/update/delete/agent-assignment are founder-only — team
 * leads may not add external network access unilaterally. List is any board
 * member.
 */

// LOAD-BEARING: lowercase letters, digits, hyphen only. Do not widen.
const SERVER_NAME_RE = /^[a-z0-9-]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const templateRecord = z.record(z.string(), z.string());

const createConnectorSchema = z
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
    source: z.enum(["byo", "catalog"]).optional().default("byo"),
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
  });

// PATCH is intentionally narrow: displayName + status only. Transport-relevant
// fields (transport/url/command/args/templates/serverName) cannot be edited —
// `.strict()` makes any such key a 400. Recreate the connector to change them.
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
      const deploymentMode = loadConfig().deploymentMode;
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
        source: body.source,
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
