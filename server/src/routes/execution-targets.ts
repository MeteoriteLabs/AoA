// Execution-target registry CRUD + worker self-register/heartbeat (Phase 5,
// Task 13). Router-factory `({ db })` pattern — see
// server/src/routes/environments.ts:29 (environmentRoutes) — db is injected,
// no global getDb(). executionTargets table comes from @armyofagents/db.
import { Router, type Request, type Response, type NextFunction } from "express";
import type { Db } from "@armyofagents/db";
import { executionTargets } from "@armyofagents/db";
import { createExecutionTargetSchema } from "@armyofagents/shared";
import {
  createWorkerToken,
  hashWorkerToken,
  listExecutionTargets,
  registerWorkerHeartbeat,
  resolveWorkerTargetId,
  stripWorkerSecret,
} from "../services/execution-targets.js";
import { organizationAccessService } from "../services/organization-access.js";
import { assertBoard } from "./authz.js";
import { forbidden, unauthorized } from "../errors.js";
import { logger } from "../middleware/logger.js";

/**
 * Worker self-auth (Finding #3). The bearer credential is a rotatable worker
 * token minted at registration; only its SHA-256 hash is stored on the target
 * row. We hash the presented token and resolve it to exactly one target id.
 * The row id itself is NO LONGER a credential.
 */
function requireWorkerToken(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.header("authorization") ?? "";
      const match = /^Bearer\s+(.+)$/i.exec(header.trim());
      const token = match?.[1]?.trim();
      if (!token) {
        next(unauthorized());
        return;
      }
      const targetId = await resolveWorkerTargetId(db, token);
      if (!targetId) {
        next(unauthorized());
        return;
      }
      (req as Request & { workerTargetId?: string }).workerTargetId = targetId;
      next();
    } catch (err) {
      next(err);
    }
  };
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
      // Mint a rotatable worker credential: persist only its hash, return the
      // plaintext ONCE. The row id is no longer a credential (Finding #3).
      const workerToken = createWorkerToken();
      const [row] = await opts.db
        .insert(executionTargets)
        .values({ organizationId: orgId, ...parsed.data, workerTokenHash: hashWorkerToken(workerToken) })
        .returning();
      // Audit trail: registering an execution destination is security-sensitive
      // and must be visible to incident review. activity_log is company-scoped
      // (company_id NOT NULL) and has no organization column, so this org-scoped
      // mutation cannot be a row there; emit a structured log line instead (same
      // pattern as the operator break-glass org-wide audit fix). A durable
      // org-scoped audit feed is tracked for the M6 org-scoped audit feed.
      const operatorUserId = req.actor.type === "board" ? (req.actor.userId ?? null) : null;
      logger.info(
        {
          action: "execution_target.register",
          organizationId: orgId,
          executionTargetId: row!.id,
          operatorUserId,
          scope: "org_scoped",
        },
        "execution target registered",
      );
      res.status(201).json({ ...stripWorkerSecret(row!), workerToken });
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
  router.post("/execution-targets/heartbeat", requireWorkerToken(opts.db), async (req, res, next) => {
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
