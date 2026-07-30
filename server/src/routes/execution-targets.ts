// Execution-target registry CRUD + worker self-register/heartbeat (Phase 5,
// Task 13). Router-factory `({ db })` pattern — see
// server/src/routes/environments.ts:29 (environmentRoutes) — db is injected,
// no global getDb(). executionTargets table comes from @armyofagents/db.
import { Router, type Request, type Response, type NextFunction } from "express";
import type { Db } from "@armyofagents/db";
import { executionTargets } from "@armyofagents/db";
import { createExecutionTargetSchema } from "@armyofagents/shared";
import { listExecutionTargets, registerWorkerHeartbeat } from "../services/execution-targets.js";
import { organizationAccessService } from "../services/organization-access.js";
import { assertBoard } from "./authz.js";
import { forbidden, unauthorized } from "../errors.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Worker self-auth (M6, "semi-manual" per the Locked Decisions section: the
 * owner pastes a slug + endpoint, the worker self-registers/heartbeats). No
 * separate worker-token table exists yet — the target's own primary key
 * (a defaultRandom() uuid returned once from the create-target response)
 * IS the bearer credential, presented as `Authorization: Bearer <targetId>`.
 * This keeps Task 13 migration-free; a dedicated rotatable token is a
 * follow-up if/when a real fleet needs credential rotation. The credential
 * only ever resolves to a single target id — `registerWorkerHeartbeat` scopes
 * its UPDATE to that id, and returns updated:0 (404 below) if the id is gone,
 * so a stale/forged id can never touch another row.
 */
function requireWorkerToken(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token || !UUID_RE.test(token)) {
    next(unauthorized());
    return;
  }
  (req as Request & { workerTargetId?: string }).workerTargetId = token;
  next();
}

export function executionTargetRoutes(opts: { db: Db }) {
  const router = Router();
  const orgAccess = organizationAccessService(opts.db);

  // Shared by both routes below. The orgAccess.canOrg check inside this same
  // helper (not the caller) is the real gate — assertBoard is just the
  // actor-type guard.
  async function assertOrgAdmin(req: Request, orgId: string): Promise<void> {
    // rbac: paired-via-helper — orgAccess.canOrg below is the gate.
    assertBoard(req);
    const userId = req.actor.type === "board" ? (req.actor.userId ?? null) : null;
    if (!userId) throw forbidden("Sign in to manage execution targets");
    const allowed = await orgAccess.canOrg(orgId, userId, "execution_target:manage");
    if (!allowed) throw forbidden("You are not an owner/admin of this organization");
  }

  // Owner registers a dedicated target (semi-manual: paste slug + endpoint).
  // RBAC: caller must be founder/org-admin of :orgId.
  router.post("/organizations/:orgId/execution-targets", async (req, res, next) => {
    try {
      const orgId = req.params.orgId as string;
      await assertOrgAdmin(req, orgId);
      const parsed = createExecutionTargetSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ error: parsed.error.issues });
        return;
      }
      const [row] = await opts.db
        .insert(executionTargets)
        .values({ organizationId: orgId, ...parsed.data })
        .returning();
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  });

  router.get("/organizations/:orgId/execution-targets", async (req, res, next) => {
    try {
      const orgId = req.params.orgId as string;
      await assertOrgAdmin(req, orgId);
      res.json(await listExecutionTargets(opts.db, orgId));
    } catch (err) {
      next(err);
    }
  });

  // Worker self-heartbeat: the worker token is bound to ONE target id. The
  // middleware resolves req.workerTargetId; the URL carries NO slug/org so a
  // caller can never address another tenant's row. Fail closed with 404 when
  // the id no longer exists.
  router.post("/execution-targets/heartbeat", requireWorkerToken, async (req, res, next) => {
    try {
      const targetId = (req as Request & { workerTargetId?: string }).workerTargetId!;
      const { updated } = await registerWorkerHeartbeat(opts.db, {
        targetId,
        status: req.body?.status,
        capabilities: req.body?.capabilities,
      });
      if (updated === 0) {
        res.status(404).json({ error: "execution target not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
