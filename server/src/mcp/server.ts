import { Router, type Request } from "express";
import type { Db } from "@armyofagents/db";
import { createMcpApiKeySchema, updateMcpSettingsSchema } from "@armyofagents/shared";
import { z } from "zod";
import { forbidden, unauthorized } from "../errors.js";
import {
  agentService,
  approvalService,
  artifactService,
  companyService,
  debriefService,
  extractionService,
  goalService,
  issueApprovalService,
  issueService,
  logActivity,
  mcpService,
  memoryService,
  permissionService,
  projectService,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "../routes/authz.js";
import {
  TOOL_DEFINITIONS,
  toolHandlers,
  toolAllowedActors,
  type McpUserScope,
  type ToolContext,
  type ToolServices,
} from "./tools/index.js";
import {
  canAccessProjectScopedEntity,
  filterArtifactsForScope,
  filterGoalsForScope,
  filterMemoryForScope,
  resolveScopedAgentIdsDefault,
  resolveUserRole,
  resolveUserScope,
} from "./tools/scope.js";

const JSON_RPC_VERSION = "2.0";
const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "aoa-mcp";
const SERVER_VERSION = "0.2.7";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

const initializeSchema = z.object({
  clientInfo: z
    .object({
      name: z.string().min(1),
      version: z.string().optional(),
    })
    .optional(),
});

const readResourceSchema = z.object({
  uri: z.string().min(1),
});

const callToolSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.unknown()).optional(),
});

type RateWindow = { count: number; resetAt: number };

export function createFixedWindowRateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, RateWindow>();
  return {
    check(key: string) {
      const now = Date.now();
      const existing = windows.get(key);
      if (!existing || existing.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: limit - 1 };
      }
      if (existing.count >= limit) {
        return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now };
      }
      existing.count += 1;
      return { allowed: true, remaining: limit - existing.count };
    },
  };
}

const protocolRateLimiter = createFixedWindowRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

interface McpRouteDeps {
  issuesSvc?: ReturnType<typeof issueService>;
  goalsSvc?: ReturnType<typeof goalService>;
  memorySvc?: ReturnType<typeof memoryService>;
  artifactsSvc?: ReturnType<typeof artifactService>;
  debriefsSvc?: ReturnType<typeof debriefService>;
  extractionSvc?: ReturnType<typeof extractionService>;
  companiesSvc?: ReturnType<typeof companyService>;
  mcpSvc?: ReturnType<typeof mcpService>;
  permissionsSvc?: ReturnType<typeof permissionService>;
  agentsSvc?: ReturnType<typeof agentService>;
  projectsSvc?: ReturnType<typeof projectService>;
  approvalsSvc?: ReturnType<typeof approvalService>;
  issueApprovalsSvc?: ReturnType<typeof issueApprovalService>;
  resolveScope?: (companyId: string, userId: string) => Promise<McpUserScope>;
  resolveRole?: (companyId: string, userId: string) => Promise<string>;
  resolveScopedAgentIds?: (companyId: string, scope: McpUserScope) => Promise<Set<string> | null>;
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function asJsonContent(uri: string, payload: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(payload),
      },
    ],
  };
}

function asToolContent(payload: unknown) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  };
}

/**
 * Translate the request's `req.actor` (set by the auth middleware in
 * server/src/middleware/auth.ts) into a stable ProtocolActor shape that
 * MCP routes can consume.
 *
 * The auth layer recognizes four actor types: "mcp", "board", "agent",
 * "none". This function maps the first three (a "none" actor returns
 * null and the route returns 401).
 *
 * For agent actors:
 *   - userId is synthesized from agentId so existing scope/audit code
 *     that keys on userId continues to work without branching.
 *   - companyId comes from the JWT (validated by middleware against the
 *     URL companyId in ensureProtocolAccess).
 *   - agentId and runId are passed through so per-agent tools like
 *     memory.retain can identify the caller without trusting an arg.
 *
 * "commander" is reserved for the future when Commander goes CLI.
 * Auth middleware doesn't currently emit a "commander" type — that
 * branch lights up alongside the team-under-Commander work.
 */
function protocolAuthActor(req: Request) {
  if (req.actor.type === "mcp") {
    return {
      userId: req.actor.userId ?? "mcp-user",
      companyId: req.actor.companyId ?? null,
      keyId: req.actor.keyId ?? null,
      source: "mcp" as const,
      agentId: null,
      runId: null,
    };
  }
  if (req.actor.type === "board") {
    return {
      userId: req.actor.userId ?? "local-board",
      companyId: null,
      keyId: null,
      source: "board" as const,
      agentId: null,
      runId: null,
    };
  }
  if (req.actor.type === "agent") {
    const agentId = req.actor.agentId ?? null;
    return {
      userId: agentId ?? "agent-unknown",
      companyId: req.actor.companyId ?? null,
      keyId: null,
      source: "agent" as const,
      agentId,
      runId: req.actor.runId ?? null,
    };
  }
  return null;
}

function parseResourceUri(uri: string) {
  const normalized = uri.replace(/^aoa:\/\//, "");
  const parts = normalized.split("/").filter(Boolean);
  return {
    collection: parts[0] ?? null,
    id: parts[1] ?? null,
  };
}

async function ensureProtocolAccess(
  req: Request,
  companyId: string,
  companiesSvc: ReturnType<typeof companyService>,
) {
  const actor = protocolAuthActor(req);
  if (!actor?.userId) {
    throw unauthorized();
  }
  if (actor.companyId && actor.companyId !== companyId) {
    throw forbidden("MCP key cannot access another company");
  }
  assertCompanyAccess(req, companyId);
  const company = await companiesSvc.getById(companyId);
  if (!company) {
    throw forbidden("Company not found");
  }
  // mcpEnabled gates EXTERNAL clients (mcp Bearer keys). Internal agent
  // actors authenticate via their run JWT — they need MCP access for
  // memory tools regardless of the founder's external-MCP toggle.
  // Board (founder) sessions also bypass this gate (their auth is
  // already trust-bounded). External "mcp" keys are still gated.
  if (actor.source === "mcp" && !company.mcpEnabled) {
    throw forbidden("MCP server is disabled for this company");
  }
  return {
    actor,
    company,
  };
}

export function mcpServerRoutes(db: Db, deps: McpRouteDeps = {}) {
  const router = Router();
  const issuesSvc = deps.issuesSvc ?? issueService(db);
  const goalsSvc = deps.goalsSvc ?? goalService(db);
  const memorySvc = deps.memorySvc ?? memoryService(db);
  const artifactsSvc = deps.artifactsSvc ?? artifactService(db);
  const debriefsSvc = deps.debriefsSvc ?? debriefService(db);
  const extractionSvc = deps.extractionSvc ?? extractionService(db);
  const companiesSvc = deps.companiesSvc ?? companyService(db);
  const mcpSvc = deps.mcpSvc ?? mcpService(db);
  const permissionsSvc = deps.permissionsSvc ?? permissionService(db);
  const agentsSvc = deps.agentsSvc ?? agentService(db);
  const projectsSvc = deps.projectsSvc ?? projectService(db);
  const approvalsSvc = deps.approvalsSvc ?? approvalService(db);
  const issueApprovalsSvc = deps.issueApprovalsSvc ?? issueApprovalService(db);
  const resolveRole =
    deps.resolveRole ??
    ((companyId: string, userId: string) => resolveUserRole(db, companyId, userId));
  const resolveScopedAgentIds =
    deps.resolveScopedAgentIds ??
    ((companyId: string, scope: McpUserScope) =>
      resolveScopedAgentIdsDefault(db, companyId, scope));

  const services: ToolServices = {
    issuesSvc,
    goalsSvc,
    memorySvc,
    artifactsSvc,
    debriefsSvc,
    extractionSvc,
    companiesSvc,
    mcpSvc,
    permissionsSvc,
    agentsSvc,
    projectsSvc,
    approvalsSvc,
    issueApprovalsSvc,
  };

  router.get("/companies/:companyId/mcp/status", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const [company, status] = await Promise.all([
      companiesSvc.getById(companyId),
      mcpSvc.getStatus(companyId),
    ]);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({
      ...status,
      enabled: company.mcpEnabled,
    });
  });

  router.patch("/companies/:companyId/mcp/settings", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const parsed = updateMcpSettingsSchema.parse(req.body);
    const company = await companiesSvc.update(companyId, { mcpEnabled: parsed.enabled });
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.updated",
      entityType: "company",
      entityId: companyId,
      details: { mcpEnabled: parsed.enabled },
    });
    res.json(company);
  });

  router.get("/companies/:companyId/mcp/keys", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await mcpSvc.listKeys(companyId));
  });

  router.post("/companies/:companyId/mcp/keys", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const parsed = createMcpApiKeySchema.parse(req.body);
    const created = await mcpSvc.createKey(companyId, req.actor.userId ?? "local-board", parsed.name);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "mcp.api_key_created",
      entityType: "mcp_api_key",
      entityId: created.id,
      details: { name: created.name },
    });
    res.status(201).json(created);
  });

  router.delete("/companies/:companyId/mcp/keys/:keyId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    const keyId = req.params.keyId as string;
    assertCompanyAccess(req, companyId);
    await mcpSvc.requireOwnedKey(companyId, keyId);
    const revoked = await mcpSvc.revokeKey(companyId, keyId);
    if (!revoked) {
      res.status(404).json({ error: "MCP API key not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "mcp.api_key_revoked",
      entityType: "mcp_api_key",
      entityId: keyId,
      details: { name: revoked.name },
    });
    res.json({ ok: true });
  });

  router.get("/companies/:companyId/mcp/clients", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await mcpSvc.listClients(companyId));
  });

  router.post("/companies/:companyId/mcp", async (req, res) => {
    const companyId = req.params.companyId as string;
    const requestBody = req.body as { id?: unknown; method?: unknown; params?: unknown };
    const actor = protocolAuthActor(req);

    if (!actor?.userId) {
      res.status(401).json(jsonRpcError(requestBody.id ?? null, -32001, "Unauthorized"));
      return;
    }

    const rateKey = `${companyId}:${actor.keyId ?? actor.userId}`;
    const rateResult = protocolRateLimiter.check(rateKey);
    if (!rateResult.allowed) {
      res.status(429).json(jsonRpcError(requestBody.id ?? null, -32029, "Rate limit exceeded"));
      return;
    }

    try {
      const { actor: protocolActor, company } = await ensureProtocolAccess(req, companyId, companiesSvc);
      const scope = await (deps.resolveScope
        ? deps.resolveScope(companyId, protocolActor.userId)
        : resolveUserScope(db, company.id, protocolActor.userId));
      const method = typeof requestBody.method === "string" ? requestBody.method : "";
      const clientInfo =
        initializeSchema.safeParse(requestBody.params).success
          ? initializeSchema.parse(requestBody.params).clientInfo
          : undefined;

      await mcpSvc.touchClient({
        companyId,
        userId: protocolActor.userId,
        apiKeyId: protocolActor.keyId,
        clientName: clientInfo?.name ?? (req.header("x-mcp-client-name") ?? null),
        clientVersion: clientInfo?.version ?? (req.header("x-mcp-client-version") ?? null),
        userAgent: req.header("user-agent") ?? null,
        transport: "http",
        remoteAddress: req.ip,
        lastMethod: method || null,
      });

      if (method === "initialize") {
        res.json(
          jsonRpcResult(requestBody.id ?? null, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION,
            },
            capabilities: {
              resources: {},
              tools: {},
            },
          }),
        );
        return;
      }

      if (method === "notifications/initialized") {
        res.json(jsonRpcResult(requestBody.id ?? null, {}));
        return;
      }

      if (method === "resources/list") {
        res.json(
          jsonRpcResult(requestBody.id ?? null, {
            resources: [
              { uri: "aoa://tasks", name: "tasks", description: "List and read tasks" },
              { uri: "aoa://goals", name: "goals", description: "List and read goals" },
              { uri: "aoa://memory", name: "memory", description: "List and read approved memory items" },
              { uri: "aoa://artifacts", name: "artifacts", description: "List and read artifacts with versions" },
            ],
          }),
        );
        return;
      }

      if (method === "resources/read") {
        const params = readResourceSchema.parse(requestBody.params);
        const resource = parseResourceUri(params.uri);

        if (resource.collection === "tasks") {
          if (!resource.id) {
            const rows = await issuesSvc.list(companyId);
            res.json(jsonRpcResult(requestBody.id ?? null, asJsonContent(params.uri, rows.filter((row) => canAccessProjectScopedEntity(scope, row.projectId)))));
            return;
          }
          const row = await issuesSvc.getById(resource.id);
          if (!row || row.companyId !== companyId || !canAccessProjectScopedEntity(scope, row.projectId)) {
            res.status(404).json(jsonRpcError(requestBody.id ?? null, -32004, "Task not found"));
            return;
          }
          res.json(jsonRpcResult(requestBody.id ?? null, asJsonContent(params.uri, row)));
          return;
        }

        if (resource.collection === "goals") {
          if (!resource.id) {
            const rows = await filterGoalsForScope(db, scope, await goalsSvc.list(companyId));
            res.json(jsonRpcResult(requestBody.id ?? null, asJsonContent(params.uri, rows)));
            return;
          }
          const row = await goalsSvc.getById(resource.id);
          // Tenant isolation: getById is not company-scoped, and founder scope is a
          // pass-through in filterGoalsForScope — reject cross-company ids here.
          const filtered =
            row && row.companyId === companyId ? await filterGoalsForScope(db, scope, [row]) : [];
          if (filtered.length === 0) {
            res.status(404).json(jsonRpcError(requestBody.id ?? null, -32004, "Goal not found"));
            return;
          }
          res.json(jsonRpcResult(requestBody.id ?? null, asJsonContent(params.uri, filtered[0])));
          return;
        }

        if (resource.collection === "memory") {
          if (!resource.id) {
            const rows = await filterMemoryForScope(
              db,
              scope,
              await memorySvc.list(companyId, { status: "approved" }),
            );
            res.json(jsonRpcResult(requestBody.id ?? null, asJsonContent(params.uri, rows)));
            return;
          }
          const row = await memorySvc.getById(companyId, resource.id);
          const filtered = row && row.status === "approved" ? await filterMemoryForScope(db, scope, [row]) : [];
          if (filtered.length === 0) {
            res.status(404).json(jsonRpcError(requestBody.id ?? null, -32004, "Memory item not found"));
            return;
          }
          res.json(jsonRpcResult(requestBody.id ?? null, asJsonContent(params.uri, filtered[0])));
          return;
        }

        if (resource.collection === "artifacts") {
          if (!resource.id) {
            const rows = await filterArtifactsForScope(db, scope, await artifactsSvc.list(companyId));
            res.json(jsonRpcResult(requestBody.id ?? null, asJsonContent(params.uri, rows)));
            return;
          }
          const row = await artifactsSvc.getById(resource.id);
          // Tenant isolation: getById is not company-scoped, and founder scope is a
          // pass-through in filterArtifactsForScope — reject cross-company ids here.
          const filtered =
            row && row.companyId === companyId ? await filterArtifactsForScope(db, scope, [row]) : [];
          if (filtered.length === 0) {
            res.status(404).json(jsonRpcError(requestBody.id ?? null, -32004, "Artifact not found"));
            return;
          }
          res.json(jsonRpcResult(requestBody.id ?? null, asJsonContent(params.uri, filtered[0])));
          return;
        }

        res.status(404).json(jsonRpcError(requestBody.id ?? null, -32004, "Resource not found"));
        return;
      }

      if (method === "tools/list") {
        res.json(
          jsonRpcResult(requestBody.id ?? null, { tools: TOOL_DEFINITIONS }),
        );
        return;
      }

      if (method === "tools/call") {
        const params = callToolSchema.parse(requestBody.params);
        const args = params.arguments ?? {};
        const handler = toolHandlers[params.name];
        if (!handler) {
          res.status(400).json(jsonRpcError(requestBody.id ?? null, -32601, "Tool not found"));
          return;
        }
        // V2.6: per-tool actor-type gate. Tools listed in toolAllowedActors
        // are restricted to the listed actor sources. Tools NOT in the map
        // remain open to all authenticated actors (pre-V2.6 behavior).
        const allowed = toolAllowedActors[params.name];
        if (allowed && !allowed.includes(protocolActor.source)) {
          res.status(403).json(
            jsonRpcError(
              requestBody.id ?? null,
              -32003,
              `Tool ${params.name} is not available for ${protocolActor.source} actors`,
            ),
          );
          return;
        }
        const ctx: ToolContext = {
          db,
          companyId,
          actor: protocolActor,
          scope,
          services,
          actorInfo: getActorInfo(req),
          resolveRole,
          resolveScopedAgentIds,
        };
        const result = await handler(ctx, args);
        if (result.ok) {
          res.json(jsonRpcResult(requestBody.id ?? null, asToolContent(result.data)));
        } else {
          res
            .status(result.status)
            .json(jsonRpcError(requestBody.id ?? null, result.code, result.message));
        }
        return;
      }

      res.status(400).json(jsonRpcError(requestBody.id ?? null, -32601, "Method not found"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "MCP request failed";
      const status =
        error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number"
          ? ((error as { status: number }).status)
          : 500;
      res.status(status).json(jsonRpcError(requestBody.id ?? null, -32000, message));
    }
  });

  return router;
}
