import type { IncomingMessage, Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { instanceUserRoles } from "@armyofagents/db";
import type { DeploymentMode, LiveEvent } from "@armyofagents/shared";
import type { BetterAuthSessionResult } from "../auth/better-auth.js";
import { logger } from "../middleware/logger.js";
import {
  subscribeCompanyLiveEvents,
  ThreadSubscriptionRegistry,
  filterThreadEventRecipients,
  isThreadEvent,
  threadIdOf,
} from "../services/live-events.js";
import { threadService } from "../services/threads.js";
import { permissionService } from "../services/permissions.js";
import { authorizeCompanyUpgrade, type UpgradeActorContext } from "../services/upgrade-auth.js";

interface WsSocket {
  readyState: number;
  ping(): void;
  send(data: string): void;
  terminate(): void;
  close(code?: number, reason?: string): void;
  on(event: "pong", listener: () => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "message", listener: (data: unknown) => void): void;
}

interface WsServer {
  clients: Set<WsSocket>;
  on(event: "connection", listener: (socket: WsSocket, req: IncomingMessage) => void): void;
  on(event: "close", listener: () => void): void;
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: WsSocket) => void,
  ): void;
  emit(event: "connection", ws: WsSocket, req: IncomingMessage): boolean;
}

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws") as {
  WebSocket: { OPEN: number };
  WebSocketServer: new (opts: { noServer: boolean }) => WsServer;
};

interface IncomingMessageWithContext extends IncomingMessage {
  aoaUpgradeContext?: UpgradeActorContext;
}

function rejectUpgrade(socket: Duplex, statusLine: string, message: string) {
  const safe = message.replace(/[\r\n]+/g, " ").trim();
  socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${safe}`);
  socket.destroy();
}

function parseCompanyId(pathname: string) {
  const match = pathname.match(/^\/api\/companies\/([^/]+)\/events\/ws$/);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
}

export function setupLiveEventsWebSocketServer(
  server: HttpServer,
  db: Db,
  opts: {
    deploymentMode: DeploymentMode;
    resolveSessionFromHeaders?: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
  },
) {
  const wss = new WebSocketServer({ noServer: true });
  const cleanupByClient = new Map<WsSocket, () => void>();
  const aliveByClient = new Map<WsSocket, boolean>();

  // Plan 7: per-thread subscription registry. A connection only receives
  // thread.* events for threads it has explicitly subscribed to (via a
  // { subscribe: threadId } client message) AND that pass envelope RBAC.
  const threadRegistry = new ThreadSubscriptionRegistry<WsSocket>();
  const tSvc = threadService(db);
  const perms = permissionService(db);

  /**
   * Resolve a board connection's effective role for envelope-RBAC checks.
   * In local_trusted mode the synthetic "board" actor is implicitly trusted
   * (loopback boundary) → treat as founder, matching buildActor's
   * local_implicit → founder rule. Instance admins are also founders.
   */
  async function resolveBoardRole(
    actorId: string,
    companyId: string,
  ): Promise<"founder" | "team_lead" | "team_member"> {
    if (opts.deploymentMode === "local_trusted") return "founder";
    const adminRow = await db
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, actorId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null);
    if (adminRow) return "founder";
    return perms.getEffectiveRole(companyId, actorId);
  }

  /**
   * Decide whether a thread.* event may be delivered to a single connection.
   * Recomputed PER EVENT — never cached (see ThreadSubscriptionRegistry doc).
   * - Connection must be subscribed to the event's thread.
   * - Agent connections: subscription is the gate (agents subscribe only to
   *   threads they are working on).
   * - Board connections: additionally must pass canViewThread, recomputed live.
   */
  async function mayReceiveThreadEvent(
    socket: WsSocket,
    context: UpgradeActorContext,
    event: LiveEvent,
  ): Promise<boolean> {
    const threadId = threadIdOf(event);
    if (!threadId) return false; // malformed thread event — fail closed
    if (!threadRegistry.isSubscribed(threadId, socket)) return false;
    if (context.actorType === "agent") return true;

    const role = await resolveBoardRole(context.actorId, context.companyId);
    const resolved = await tSvc.resolveViewerForThread(context.companyId, threadId, {
      userId: context.actorId,
      role,
    });
    if (!resolved) return false; // thread gone — fail closed
    // Reuse the same pure envelope-RBAC filter the tests exercise, so fan-out
    // and unit tests share one source of truth.
    return filterThreadEventRecipients(resolved.thread, [resolved.viewer]).length > 0;
  }

  const pingInterval = setInterval(() => {
    for (const socket of wss.clients) {
      if (!aliveByClient.get(socket)) {
        socket.terminate();
        continue;
      }
      aliveByClient.set(socket, false);
      socket.ping();
    }
  }, 30000);

  wss.on("connection", (socket: WsSocket, req: IncomingMessage) => {
    const context = (req as IncomingMessageWithContext).aoaUpgradeContext;
    if (!context) {
      socket.close(1008, "missing context");
      return;
    }

    const unsubscribe = subscribeCompanyLiveEvents(context.companyId, (event) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      // Non-thread events stay company-wide (unchanged behavior).
      if (!isThreadEvent(event)) {
        socket.send(JSON.stringify(event));
        return;
      }
      // Thread events: envelope-RBAC scoped to per-thread subscribers.
      void mayReceiveThreadEvent(socket, context, event)
        .then((ok) => {
          if (ok && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(event));
          }
        })
        .catch((err) => {
          logger.warn({ err, companyId: context.companyId }, "thread event fan-out failed");
        });
    });

    cleanupByClient.set(socket, unsubscribe);
    aliveByClient.set(socket, true);

    socket.on("pong", () => {
      aliveByClient.set(socket, true);
    });

    socket.on("message", (data: unknown) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof data === "string" ? data : String(data));
      } catch {
        return; // ignore non-JSON client frames
      }
      if (typeof parsed !== "object" || parsed === null) return;
      const msg = parsed as Record<string, unknown>;

      if (typeof msg.subscribe === "string" && msg.subscribe.length > 0) {
        threadRegistry.subscribe(msg.subscribe, socket);
        return;
      }
      if (typeof msg.unsubscribe === "string" && msg.unsubscribe.length > 0) {
        threadRegistry.unsubscribe(msg.unsubscribe, socket);
        return;
      }
    });

    socket.on("close", () => {
      const cleanup = cleanupByClient.get(socket);
      if (cleanup) cleanup();
      cleanupByClient.delete(socket);
      aliveByClient.delete(socket);
      threadRegistry.removeConnection(socket);
    });

    socket.on("error", (err: Error) => {
      logger.warn({ err, companyId: context.companyId }, "live websocket client error");
    });
  });

  wss.on("close", () => {
    clearInterval(pingInterval);
  });

  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/preview/services/")) {
      return;
    }

    if (!req.url) {
      rejectUpgrade(socket, "400 Bad Request", "missing url");
      return;
    }

    const url = new URL(req.url, "http://localhost");
    const companyId = parseCompanyId(url.pathname);
    if (!companyId) {
      socket.destroy();
      return;
    }

    void authorizeCompanyUpgrade(db, req, companyId, url, {
      deploymentMode: opts.deploymentMode,
      resolveSessionFromHeaders: opts.resolveSessionFromHeaders,
    })
      .then((context) => {
        if (!context) {
          rejectUpgrade(socket, "403 Forbidden", "forbidden");
          return;
        }

        const reqWithContext = req as IncomingMessageWithContext;
        reqWithContext.aoaUpgradeContext = context;

        wss.handleUpgrade(req, socket, head, (ws: WsSocket) => {
          wss.emit("connection", ws, reqWithContext);
        });
      })
      .catch((err) => {
        logger.error({ err, path: req.url }, "failed websocket upgrade authorization");
        rejectUpgrade(socket, "500 Internal Server Error", "upgrade failed");
      });
  });

  return wss;
}
