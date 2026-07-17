import { Router, type Request } from "express";
import type { Db } from "@armyofagents/db";
import { createCliAuthChallengeSchema, resolveCliAuthChallengeSchema } from "@armyofagents/shared";
import { badRequest, notFound, unauthorized } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { cliAuthChallengeLimiter } from "../middleware/rate-limit.js";
import { boardAuthService, logActivity } from "../services/index.js";
import { resolveInviteBaseUrl } from "./access-helpers.js";

function buildCliAuthApprovalPath(challengeId: string, token: string) {
  return `/cli-auth/${challengeId}?token=${encodeURIComponent(token)}`;
}

function isLocalImplicit(req: Request) {
  return req.actor.type === "board" && req.actor.source === "local_implicit";
}

export function cliAuthRoutes(db: Db) {
  const router = Router();
  const boardAuth = boardAuthService(db);

  // Sprint 4 S4-F: this endpoint is unauthenticated (the CLI has no token
  // yet) and creates 10-minute-TTL rows in cli_auth_challenges. Without a
  // per-IP cap, any script can flood the table. Limiter is 5/min/IP.
  router.post(
    "/cli-auth/challenges",
    cliAuthChallengeLimiter,
    validate(createCliAuthChallengeSchema),
    async (req, res) => {
      const created = await boardAuth.createCliAuthChallenge(req.body);
      const approvalPath = buildCliAuthApprovalPath(
        created.challenge.id,
        created.challengeSecret,
      );
      // The approval URL carries an auth token, so build it from a TRUSTED
      // origin — the configured public URL first, then a trust-proxy-gated /
      // real-Host fallback (same derivation as invite links). NEVER a spoofable
      // X-Forwarded-Host: host-header injection here would point the
      // token-bearing link at an attacker origin. `resolveInviteBaseUrl`
      // returns "" only when there is genuinely no configured origin AND no
      // Host header, in which case we cannot mint an absolute URL (a CLI can't
      // resolve a relative one) and fall back to `null`, matching the prior
      // "no host" behaviour.
      const baseUrl = resolveInviteBaseUrl(req);
      res.status(201).json({
        id: created.challenge.id,
        token: created.challengeSecret,
        boardApiToken: created.pendingBoardToken,
        approvalPath,
        approvalUrl: baseUrl ? `${baseUrl}${approvalPath}` : null,
        pollPath: `/cli-auth/challenges/${created.challenge.id}`,
        expiresAt: created.challenge.expiresAt.toISOString(),
        suggestedPollIntervalMs: 1000,
      });
    },
  );

  router.get("/cli-auth/challenges/:id", async (req, res) => {
    const id = (req.params.id as string).trim();
    const token =
      typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (!id || !token) throw notFound("CLI auth challenge not found");
    const challenge = await boardAuth.describeCliAuthChallenge(id, token);
    if (!challenge) throw notFound("CLI auth challenge not found");

    const isSignedInBoardUser =
      req.actor.type === "board" &&
      (req.actor.source === "session" || isLocalImplicit(req)) &&
      Boolean(req.actor.userId);
    const canApprove =
      isSignedInBoardUser &&
      (challenge.requestedAccess !== "instance_admin_required" ||
        isLocalImplicit(req) ||
        Boolean(req.actor.isInstanceAdmin));

    res.json({
      ...challenge,
      requiresSignIn: !isSignedInBoardUser,
      canApprove,
      currentUserId: req.actor.type === "board" ? req.actor.userId ?? null : null,
    });
  });

  router.post(
    "/cli-auth/challenges/:id/approve",
    validate(resolveCliAuthChallengeSchema),
    async (req, res) => {
      const id = (req.params.id as string).trim();
      if (
        req.actor.type !== "board" ||
        (!req.actor.userId && !isLocalImplicit(req))
      ) {
        throw unauthorized("Sign in before approving CLI access");
      }

      const userId = req.actor.userId ?? "local-board";
      const approved = await boardAuth.approveCliAuthChallenge(
        id,
        req.body.token,
        userId,
      );

      if (approved.status === "approved") {
        const companyIds = await boardAuth.resolveBoardActivityCompanyIds({
          userId,
          requestedCompanyId: approved.challenge.requestedCompanyId,
          boardApiKeyId: approved.challenge.boardApiKeyId,
        });
        for (const companyId of companyIds) {
          await logActivity(db, {
            companyId,
            actorType: "user",
            actorId: userId,
            action: "board_api_key.created",
            entityType: "user",
            entityId: userId,
            details: {
              boardApiKeyId: approved.challenge.boardApiKeyId,
              requestedAccess: approved.challenge.requestedAccess,
              requestedCompanyId: approved.challenge.requestedCompanyId,
              challengeId: approved.challenge.id,
            },
          });
        }
      }

      res.json({
        approved: approved.status === "approved",
        status: approved.status,
        userId,
        keyId: approved.challenge.boardApiKeyId ?? null,
        expiresAt: approved.challenge.expiresAt.toISOString(),
      });
    },
  );

  router.post(
    "/cli-auth/challenges/:id/cancel",
    validate(resolveCliAuthChallengeSchema),
    async (req, res) => {
      const id = (req.params.id as string).trim();
      const cancelled = await boardAuth.cancelCliAuthChallenge(id, req.body.token);
      res.json({
        status: cancelled.status,
        cancelled: cancelled.status === "cancelled",
      });
    },
  );

  router.get("/cli-auth/me", async (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      throw unauthorized("Board authentication required");
    }
    const accessSnapshot = await boardAuth.resolveBoardAccess(req.actor.userId);
    res.json({
      user: accessSnapshot.user,
      userId: req.actor.userId,
      isInstanceAdmin: accessSnapshot.isInstanceAdmin,
      companyIds: accessSnapshot.companyIds,
      source: req.actor.source ?? "none",
      keyId: req.actor.source === "board_key" ? req.actor.keyId ?? null : null,
    });
  });

  router.post("/cli-auth/revoke-current", async (req, res) => {
    if (req.actor.type !== "board" || req.actor.source !== "board_key") {
      throw unauthorized("Board API key authentication required");
    }
    const key = await boardAuth.assertCurrentBoardKey(
      req.actor.keyId,
      req.actor.userId,
    );
    await boardAuth.revokeBoardApiKey(key.id);
    const companyIds = await boardAuth.resolveBoardActivityCompanyIds({
      userId: key.userId,
      boardApiKeyId: key.id,
    });
    for (const companyId of companyIds) {
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: key.userId,
        action: "board_api_key.revoked",
        entityType: "user",
        entityId: key.userId,
        details: {
          boardApiKeyId: key.id,
          revokedVia: "cli_auth_logout",
        },
      });
    }
    res.json({ revoked: true, keyId: key.id });
  });

  return router;
}
