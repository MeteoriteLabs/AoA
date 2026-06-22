import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agentApiKeys, agents, boardApiKeys, companyMemberships, heartbeatRuns, instanceUserRoles, mcpApiKeys } from "@armyofagents/db";
import { verifyLocalAgentJwt } from "../agent-auth-jwt.js";
import type { DeploymentMode } from "@armyofagents/shared";
import type { BetterAuthSessionResult } from "../auth/better-auth.js";
import { logger } from "./logger.js";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

interface ActorMiddlewareOptions {
  deploymentMode: DeploymentMode;
  resolveSession?: (req: Request) => Promise<BetterAuthSessionResult | null>;
}

export function actorMiddleware(db: Db, opts: ActorMiddlewareOptions): RequestHandler {
  return async (req, _res, next) => {
    req.actor =
      opts.deploymentMode === "local_trusted"
        ? { type: "board", userId: "local-board", isInstanceAdmin: true, source: "local_implicit" }
        : { type: "none", source: "none" };

    const runIdHeader = req.header("x-aoa-run-id") ?? req.header("x-paperclip-run-id");

    const authHeader = req.header("authorization");
    if (!authHeader?.toLowerCase().startsWith("bearer ")) {
      if (opts.deploymentMode === "authenticated" && opts.resolveSession) {
        let session: BetterAuthSessionResult | null = null;
        try {
          session = await opts.resolveSession(req);
        } catch (err) {
          logger.warn(
            { err, method: req.method, url: req.originalUrl },
            "Failed to resolve auth session from request headers",
          );
        }
        if (session?.user?.id) {
          const userId = session.user.id;
          const [roleRow, memberships] = await Promise.all([
            db
              .select({ id: instanceUserRoles.id })
              .from(instanceUserRoles)
              .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
              .then((rows) => rows[0] ?? null),
            db
              .select({ companyId: companyMemberships.companyId })
              .from(companyMemberships)
              .where(
                and(
                  eq(companyMemberships.principalType, "user"),
                  eq(companyMemberships.principalId, userId),
                  eq(companyMemberships.status, "active"),
                ),
              ),
          ]);
          req.actor = {
            type: "board",
            userId,
            companyIds: memberships.map((row) => row.companyId),
            isInstanceAdmin: Boolean(roleRow),
            runId: runIdHeader ?? undefined,
            source: "session",
          };
          next();
          return;
        }
      }
      // In local_trusted mode, resolve the agent identity from x-aoa-run-id
      // when no Bearer token is present. This is a fallback for environments where
      // the JWT secret is not configured — without it, agent subprocesses silently
      // fall through to the local-board actor and all comments appear as "You".
      if (runIdHeader && opts.deploymentMode === "local_trusted") {
        const run = await db
          .select({ agentId: heartbeatRuns.agentId, companyId: heartbeatRuns.companyId })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, runIdHeader))
          .then((rows) => rows[0] ?? null);
        if (run) {
          req.actor = {
            type: "agent",
            agentId: run.agentId,
            companyId: run.companyId,
            runId: runIdHeader,
            source: "run_id_implicit",
          };
          next();
          return;
        }
      }

      if (runIdHeader) req.actor.runId = runIdHeader;
      next();
      return;
    }

    const token = authHeader.slice("bearer ".length).trim();
    if (!token) {
      next();
      return;
    }

    // Check board API keys first (CLI auth bearer tokens)
    const boardKeyRow = await db
      .select()
      .from(boardApiKeys)
      .where(and(eq(boardApiKeys.keyHash, hashToken(token)), isNull(boardApiKeys.revokedAt)))
      .then((rows) => rows.find((row) => !row.expiresAt || row.expiresAt.getTime() > Date.now()) ?? null);

    if (boardKeyRow) {
      const [roleRow, memberships] = await Promise.all([
        db
          .select({ id: instanceUserRoles.id })
          .from(instanceUserRoles)
          .where(and(eq(instanceUserRoles.userId, boardKeyRow.userId), eq(instanceUserRoles.role, "instance_admin")))
          .then((rows) => rows[0] ?? null),
        db
          .select({ companyId: companyMemberships.companyId })
          .from(companyMemberships)
          .where(
            and(
              eq(companyMemberships.principalType, "user"),
              eq(companyMemberships.principalId, boardKeyRow.userId),
              eq(companyMemberships.status, "active"),
            ),
          ),
      ]);
      await db.update(boardApiKeys).set({ lastUsedAt: new Date() }).where(eq(boardApiKeys.id, boardKeyRow.id));
      req.actor = {
        type: "board",
        userId: boardKeyRow.userId,
        companyIds: memberships.map((row) => row.companyId),
        isInstanceAdmin: Boolean(roleRow),
        keyId: boardKeyRow.id,
        runId: runIdHeader || undefined,
        source: "board_key",
      };
      next();
      return;
    }

    const tokenHash = hashToken(token);
    const key = await db
      .select()
      .from(agentApiKeys)
      .where(and(eq(agentApiKeys.keyHash, tokenHash), isNull(agentApiKeys.revokedAt)))
      .then((rows) => rows[0] ?? null);

    const mcpKey = key
      ? null
      : await db
          .select()
          .from(mcpApiKeys)
          .where(and(eq(mcpApiKeys.keyHash, tokenHash), isNull(mcpApiKeys.revokedAt)))
          .then((rows) => rows[0] ?? null);

    if (mcpKey) {
      await db
        .update(mcpApiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(mcpApiKeys.id, mcpKey.id));

      req.actor = {
        type: "mcp",
        userId: mcpKey.userId,
        companyId: mcpKey.companyId,
        keyId: mcpKey.id,
        runId: runIdHeader || undefined,
        source: "mcp_key",
      };
      next();
      return;
    }

    if (!key) {
      const claims = verifyLocalAgentJwt(token);
      if (!claims) {
        next();
        return;
      }

      const agentRecord = await db
        .select()
        .from(agents)
        .where(eq(agents.id, claims.sub))
        .then((rows) => rows[0] ?? null);

      if (!agentRecord || agentRecord.companyId !== claims.company_id) {
        next();
        return;
      }

      if (agentRecord.status === "terminated" || agentRecord.status === "pending_approval") {
        next();
        return;
      }

      req.actor = {
        type: "agent",
        agentId: claims.sub,
        companyId: claims.company_id,
        keyId: undefined,
        runId: runIdHeader || claims.run_id || undefined,
        source: "agent_jwt",
      };
      next();
      return;
    }

    await db
      .update(agentApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(agentApiKeys.id, key.id));

    const agentRecord = await db
      .select()
      .from(agents)
      .where(eq(agents.id, key.agentId))
      .then((rows) => rows[0] ?? null);

    if (!agentRecord || agentRecord.status === "terminated" || agentRecord.status === "pending_approval") {
      next();
      return;
    }

    req.actor = {
      type: "agent",
      agentId: key.agentId,
      companyId: key.companyId,
      keyId: key.id,
      runId: runIdHeader || undefined,
      source: "agent_key",
    };

    next();
  };
}

export function requireBoard(req: Express.Request) {
  return req.actor.type === "board";
}
