// Execution-target registry CRUD + worker self-register/heartbeat (Phase 5,
// Task 13). Router-factory `({ db })` pattern — see
// server/src/routes/environments.ts:29 (environmentRoutes) — db is injected,
// no global getDb(). executionTargets table comes from @armyofagents/db.
import { Router, type Request, type Response, type NextFunction } from "express";
import type { Db } from "@armyofagents/db";
import { executionTargets } from "@armyofagents/db";
import {
  createExecutionTargetSchema,
  workerExecutionTargetHeartbeatSchema,
  type CreateExecutionTargetInput,
  type WorkerExecutionTargetHeartbeatInput,
  WORKER_CONTROL_HEADERS,
} from "@armyofagents/shared";
import {
  createWorkerToken,
  hashWorkerToken,
  listExecutionTargets,
  registerWorkerHeartbeat,
  revokeExecutionTargetWorkerToken,
  resolveWorkerHeartbeatAuthority,
  ratifyPlatformExecutionTargetPlacementProfile,
  ratifyTenantExecutionTargetPlacementProfile,
  rotateExecutionTargetWorkerToken,
  stripWorkerSecret,
} from "../services/execution-targets.js";
import { organizationAccessService } from "../services/organization-access.js";
import { assertBoard, assertCanManageInstanceSettings } from "./authz.js";
import { conflict, forbidden, notFound, unauthorized } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { validate } from "../middleware/validate.js";
import { isUniqueViolation } from "../services/db-errors.js";
import { z } from "zod";
import { deviceProofHeaders } from "./worker-proof-headers.js";
import {
  createWorkerSessionAuthenticator,
  registerProofBoundHeartbeat,
  revokeTenantWorkerAuthority,
  WorkerSessionError,
  type VerifiedTargetPrincipal,
} from "../middleware/worker-session-auth.js";
import { sendWorkerProtocolError } from "../services/worker-protocol-http.js";

const uuidParam = z.string().uuid();
const placementProfileBody = z.object({
  registeredProfile: z.record(z.string(), z.unknown()),
  providerConstraintProfile: z.record(z.string(), z.unknown()),
}).strict();

/**
 * Worker self-auth (Finding #3). The bearer credential is a rotatable worker
 * token minted at registration; only its SHA-256 hash is stored on the target
 * row. We hash the presented token and resolve it to exactly one target id.
 * The row id itself is NO LONGER a credential.
 */
function requireWorkerHeartbeatAuthority(db: Db, workerSession?: {
  appDb: Db;
  operatorDb: Db;
  sessionSigningKey: string;
  now?: () => Date;
}) {
  const sessionAuthenticator = workerSession
    ? createWorkerSessionAuthenticator(workerSession)
    : null;
  return async (req: Request, res: Response, next: NextFunction) => {
    if (sessionAuthenticator) res.locals.workerProtocolV1 = true;
    try {
      const header = req.header("authorization") ?? "";
      const match = /^Bearer\s+(.+)$/i.exec(header.trim());
      const token = match?.[1]?.trim();
      if (!token) {
        next(unauthorized());
        return;
      }
      const legacyAuthority = await resolveWorkerHeartbeatAuthority(db, token);
      if (legacyAuthority) {
        (req as Request & {
          workerHeartbeatAuthority?: {
            kind: "legacy"; targetId: string; organizationId: string;
          };
        }).workerHeartbeatAuthority = { kind: "legacy", ...legacyAuthority };
        next();
        return;
      }
      const proof = deviceProofHeaders(req);
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      const correlationId = req.header(WORKER_CONTROL_HEADERS.requestId);
      if (!sessionAuthenticator || !proof || !rawBody || !correlationId) {
        next(unauthorized());
        return;
      }
      const principal = await sessionAuthenticator.authenticate({
        authorization: header,
        rawBody,
        proof,
        method: req.method,
        path: req.originalUrl,
        correlationId,
      });
      (req as Request & { workerHeartbeatAuthority?: { kind: "session"; principal: VerifiedTargetPrincipal } })
        .workerHeartbeatAuthority = { kind: "session", principal };
      next();
    } catch (err) {
      next(err instanceof WorkerSessionError ? unauthorized() : err);
    }
  };
}

export function executionTargetRoutes(opts: {
  db: Db;
  workerSession?: { appDb: Db; operatorDb: Db; sessionSigningKey: string; now?: () => Date };
}) {
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
  router.post("/organizations/:orgId/execution-targets", validate(createExecutionTargetSchema), async (req, res, next) => {
    try {
      const orgId = uuidParam.parse(req.params.orgId);
      await assertOrgAdmin(req, orgId);
      const input = req.body as CreateExecutionTargetInput;
      // DSK-00 (D16/F27). This router is mounted OUTSIDE the distributed-execution flag
      // block in app.ts, so without this guard an org admin could register an ACTIVE
      // `desktop` target on a deployment where desktop does not exist — and a run pinned
      // to it used to execute on the CONTROL-PLANE host (F28, fixed separately).
      //
      // `opts.workerSession` is already exactly the flag: app.ts derives it as
      // `distributedExecutionEnabled && tenantAppDb && operatorDb && signingKey`, so
      // truthy means distributed execution is genuinely usable. No new plumbing.
      //
      // 403 rather than 400, matching the two existing refusals in this file (":265",
      // ":293"): a disabled capability is "you may not", not "your input is malformed".
      //
      // Rejecting at CREATE, never by filtering GET — D16 rejects filtering because it
      // hides an already-enabled row instead of neutralising it, which is strictly worse
      // for incident review.
      if (input.kind === "desktop" && !opts.workerSession) {
        throw forbidden(
          "Desktop execution targets require distributed execution to be enabled.",
        );
      }
      // Mint a rotatable worker credential: persist only its hash, return the
      // plaintext ONCE. The row id is no longer a credential (Finding #3).
      const workerToken = createWorkerToken();
      const scope = input.ownerUserId ? "owner" : "organization";
      const targetAuthorityKey = input.ownerUserId
        ? `owner:${orgId}:${input.ownerUserId}`
        : `organization:${orgId}`;
      const [row] = await opts.db
        .insert(executionTargets)
        .values({
          organizationId: orgId,
          ...input,
          scope,
          targetAuthorityKey,
          workerTokenHash: hashWorkerToken(workerToken),
        })
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
      if (isUniqueViolation(err, "execution_targets_org_slug_uq")) {
        next(conflict("An execution target with this slug already exists in the organization."));
        return;
      }
      next(err);
    }
  });

  router.get("/organizations/:orgId/execution-targets", async (req, res, next) => {
    try {
      const orgId = uuidParam.parse(req.params.orgId);
      await assertOrgAdmin(req, orgId);
      res.json(await listExecutionTargets(opts.db, orgId));
    } catch (err) {
      next(err);
    }
  });

  router.post("/organizations/:orgId/execution-targets/:targetId/rotate-token", async (req, res, next) => {
    try {
      const orgId = uuidParam.parse(req.params.orgId);
      const targetId = uuidParam.parse(req.params.targetId);
      await assertOrgAdmin(req, orgId);
      const rotated = await rotateExecutionTargetWorkerToken(opts.db, {
        organizationId: orgId,
        targetId,
      });
      if (!rotated) throw notFound("Execution target not found");

      const operatorUserId = req.actor.type === "board" ? (req.actor.userId ?? null) : null;
      logger.info(
        {
          action: "execution_target.worker_token.rotated",
          organizationId: orgId,
          executionTargetId: targetId,
          operatorUserId,
          scope: "org_scoped",
          reasonCode: "worker_authority_revoked",
        },
        "execution target worker token rotated",
      );
      res.json({ ...rotated.target, workerToken: rotated.workerToken });
    } catch (err) {
      next(err);
    }
  });

  router.post("/organizations/:orgId/execution-targets/:targetId/revoke", async (req, res, next) => {
    try {
      const orgId = uuidParam.parse(req.params.orgId);
      const targetId = uuidParam.parse(req.params.targetId);
      await assertOrgAdmin(req, orgId);
      const target = opts.workerSession
        ? await revokeTenantWorkerAuthority({
            appDb: opts.workerSession.appDb,
            organizationId: orgId,
            executionTargetId: targetId,
          }).then((generation) => generation === null ? null : {
            id: targetId,
            organizationId: orgId,
            status: "disabled",
            deviceGeneration: generation,
          })
        : await revokeExecutionTargetWorkerToken(opts.db, {
            organizationId: orgId,
            targetId,
          });
      if (!target) throw notFound("Execution target not found");

      const operatorUserId = req.actor.type === "board" ? (req.actor.userId ?? null) : null;
      logger.info(
        {
          action: "execution_target.worker_token.revoked",
          organizationId: orgId,
          executionTargetId: targetId,
          operatorUserId,
          scope: "org_scoped",
        },
        "execution target worker token revoked",
      );
      res.json(target);
    } catch (err) {
      next(err);
    }
  });

  router.put(
    "/organizations/:orgId/execution-targets/:targetId/placement-profile",
    validate(placementProfileBody),
    async (req, res, next) => {
      try {
        const orgId = uuidParam.parse(req.params.orgId);
        const targetId = uuidParam.parse(req.params.targetId);
        await assertOrgAdmin(req, orgId);
        if (!opts.workerSession) throw forbidden("Distributed execution registry is disabled");
        const input = req.body as z.infer<typeof placementProfileBody>;
        const target = await ratifyTenantExecutionTargetPlacementProfile({
          appDb: opts.workerSession.appDb,
          organizationId: orgId,
          executionTargetId: targetId,
          ...input,
        });
        logger.info({
          action: "execution_target.placement_profile.ratified",
          organizationId: orgId,
          executionTargetId: targetId,
          profileHash: target.registeredProfileHash,
          scope: "org_scoped",
        }, "execution target placement profile ratified");
        res.json(target);
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    "/operator/execution-targets/:targetId/placement-profile",
    validate(placementProfileBody),
    async (req, res, next) => {
      try {
        assertCanManageInstanceSettings(req);
        if (!opts.workerSession) throw forbidden("Distributed execution registry is disabled");
        const targetId = uuidParam.parse(req.params.targetId);
        const input = req.body as z.infer<typeof placementProfileBody>;
        const target = await ratifyPlatformExecutionTargetPlacementProfile({
          operatorDb: opts.workerSession.operatorDb,
          executionTargetId: targetId,
          ...input,
        });
        logger.info({
          action: "execution_target.placement_profile.ratified",
          executionTargetId: targetId,
          profileHash: target.registeredProfileHash,
          scope: "platform",
        }, "platform execution target placement profile ratified");
        res.json(target);
      } catch (err) {
        next(err);
      }
    },
  );

  // Worker self-heartbeat: the worker token is bound to ONE target id. The
  // middleware resolves req.workerTargetId; the URL carries NO slug/org so a
  // caller can never address another tenant's row. Fail closed with 404 when
  // the id no longer exists.
  router.post(
    "/execution-targets/heartbeat",
    requireWorkerHeartbeatAuthority(opts.db, opts.workerSession),
    validate(workerExecutionTargetHeartbeatSchema),
    async (req, res, next) => {
    try {
      const input = req.body as WorkerExecutionTargetHeartbeatInput;
      const authority = (req as Request & {
        workerHeartbeatAuthority?:
          | { kind: "legacy"; targetId: string; organizationId: string }
          | { kind: "session"; principal: VerifiedTargetPrincipal };
      }).workerHeartbeatAuthority!;
      const updated = authority.kind === "legacy"
        ? (await registerWorkerHeartbeat(opts.db, {
            targetId: authority.targetId,
            organizationId: authority.organizationId,
            status: input.status,
            capabilities: input.capabilities,
          })).updated
        : (await registerProofBoundHeartbeat({
            appDb: opts.workerSession!.appDb,
            operatorDb: opts.workerSession!.operatorDb,
            principal: authority.principal,
            status: input.status ?? "active",
          }) ? 1 : 0);
      if (updated === 0) {
        if (authority.kind === "session") {
          sendWorkerProtocolError(req, res, "unauthorized", opts.workerSession?.now?.() ?? new Date());
          return;
        }
        res.status(404).json({ error: "execution target not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
    },
  );

  return router;
}
