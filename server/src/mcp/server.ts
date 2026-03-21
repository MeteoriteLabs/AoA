import { Router, type Request } from "express";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues, userRoles, projectGoals } from "@paperclipai/db";
import {
  createMcpApiKeySchema,
  ISSUE_STATUSES,
  mcpArtifactVersionSchema,
  mcpDebriefSchema,
  updateMcpSettingsSchema,
} from "@paperclipai/shared";
import { z } from "zod";
import { forbidden, unauthorized } from "../errors.js";
import {
  artifactService,
  companyService,
  debriefService,
  extractionService,
  goalService,
  issueService,
  logActivity,
  mcpService,
  memoryService,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "../routes/authz.js";

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

type McpUserScope =
  | { kind: "founder"; userId: string }
  | { kind: "scoped"; userId: string; projectIds: Set<string> };

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
  resolveScope?: (companyId: string, userId: string) => Promise<McpUserScope>;
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

function protocolAuthActor(req: Request) {
  if (req.actor.type === "mcp") {
    return {
      userId: req.actor.userId ?? "mcp-user",
      companyId: req.actor.companyId ?? null,
      keyId: req.actor.keyId ?? null,
      source: "mcp" as const,
    };
  }
  if (req.actor.type === "board") {
    return {
      userId: req.actor.userId ?? "local-board",
      companyId: null,
      keyId: null,
      source: "board" as const,
    };
  }
  return null;
}

async function resolveUserScope(db: Db, companyId: string, userId: string): Promise<McpUserScope> {
  const roles = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.companyId, companyId), eq(userRoles.userId, userId)));

  if (roles.length === 0 || roles.some((role) => role.role === "founder")) {
    return { kind: "founder", userId };
  }

  const projectIds = new Set(roles.map((role) => role.projectId).filter((id): id is string => Boolean(id)));
  return { kind: "scoped", userId, projectIds };
}

function canAccessProjectScopedEntity(scope: McpUserScope, projectId: string | null | undefined) {
  if (scope.kind === "founder") return true;
  return Boolean(projectId && scope.projectIds.has(projectId));
}

async function goalProjectMap(db: Db, goalIds: string[]) {
  if (goalIds.length === 0) return new Map<string, string[]>();
  const rows = await db
    .select({
      goalId: projectGoals.goalId,
      projectId: projectGoals.projectId,
    })
    .from(projectGoals)
    .where(inArray(projectGoals.goalId, goalIds));
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const current = map.get(row.goalId) ?? [];
    current.push(row.projectId);
    map.set(row.goalId, current);
  }
  return map;
}

async function artifactProjectMap(db: Db, artifactIds: string[]) {
  if (artifactIds.length === 0) return new Map<string, string | null>();
  const rows = await db
    .select({
      artifactId: issues.artifactId,
      projectId: issues.projectId,
    })
    .from(issues)
    .where(inArray(issues.artifactId, artifactIds));
  const map = new Map<string, string | null>();
  for (const row of rows) {
    if (row.artifactId) {
      map.set(row.artifactId, row.projectId ?? null);
    }
  }
  return map;
}

async function memoryTaskProjectMap(db: Db, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, string | null>();
  const rows = await db
    .select({
      id: issues.id,
      projectId: issues.projectId,
    })
    .from(issues)
    .where(inArray(issues.id, taskIds));
  return new Map(rows.map((row) => [row.id, row.projectId ?? null]));
}

async function filterGoalsForScope(db: Db, scope: McpUserScope, rows: Array<Record<string, any>>) {
  if (scope.kind === "founder") return rows;
  const projectMap = await goalProjectMap(db, rows.map((row) => row.id));
  return rows.filter((row) => (projectMap.get(row.id) ?? []).some((projectId) => scope.projectIds.has(projectId)));
}

async function filterMemoryForScope(db: Db, scope: McpUserScope, rows: Array<Record<string, any>>) {
  if (scope.kind === "founder") return rows;
  const goalIds = rows.map((row) => row.goalId).filter((id): id is string => Boolean(id));
  const taskIds = rows.map((row) => row.taskId).filter((id): id is string => Boolean(id));
  const [goalProjects, taskProjects] = await Promise.all([
    goalProjectMap(db, [...new Set(goalIds)]),
    memoryTaskProjectMap(db, [...new Set(taskIds)]),
  ]);
  return rows.filter((row) => {
    if (canAccessProjectScopedEntity(scope, row.departmentId)) return true;
    if (canAccessProjectScopedEntity(scope, row.projectId)) return true;
    if (row.goalId && (goalProjects.get(row.goalId) ?? []).some((projectId) => scope.projectIds.has(projectId))) {
      return true;
    }
    if (row.taskId && canAccessProjectScopedEntity(scope, taskProjects.get(row.taskId) ?? null)) {
      return true;
    }
    return false;
  });
}

async function filterArtifactsForScope(db: Db, scope: McpUserScope, rows: Array<Record<string, any>>) {
  if (scope.kind === "founder") return rows;
  const projectMap = await artifactProjectMap(db, rows.map((row) => row.id));
  return rows.filter((row) => canAccessProjectScopedEntity(scope, projectMap.get(row.id) ?? null));
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
  if (!company.mcpEnabled) {
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
          const filtered = row ? await filterGoalsForScope(db, scope, [row]) : [];
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
          const filtered = row ? await filterArtifactsForScope(db, scope, [row]) : [];
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
          jsonRpcResult(requestBody.id ?? null, {
            tools: [
              {
                name: "debrief-push",
                description: "Push content into the Debrief pipeline",
                inputSchema: {
                  type: "object",
                  properties: {
                    content: { type: "string" },
                    title: { type: "string" },
                    departmentId: { type: "string" },
                    projectId: { type: "string" },
                    source: { type: "object" },
                  },
                  required: ["content"],
                },
              },
              {
                name: "suggest-memory",
                description: "Create a pending memory suggestion",
                inputSchema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    content: { type: "string" },
                    category: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                    departmentId: { type: "string" },
                    projectId: { type: "string" },
                    layer: { type: "string" },
                    priority: { type: "number" },
                    goalId: { type: "string" },
                    taskId: { type: "string" },
                  },
                  required: ["title", "content", "category"],
                },
              },
              {
                name: "update-task-status",
                description: "Update a task status with permission checks",
                inputSchema: {
                  type: "object",
                  properties: {
                    taskId: { type: "string" },
                    status: { type: "string", enum: [...ISSUE_STATUSES] },
                  },
                  required: ["taskId", "status"],
                },
              },
              {
                name: "attach-artifact-version",
                description: "Add a new immutable version to an artifact",
                inputSchema: {
                  type: "object",
                  properties: {
                    artifactId: { type: "string" },
                    sourceDetail: { type: "string" },
                    changelog: { type: "string" },
                    parentVersionId: { type: "string" },
                    content: { type: "string" },
                    fileUrl: { type: "string" },
                  },
                  required: ["artifactId", "sourceDetail"],
                },
              },
            ],
          }),
        );
        return;
      }

      if (method === "tools/call") {
        const params = callToolSchema.parse(requestBody.params);
        const args = params.arguments ?? {};

        if (params.name === "debrief-push") {
          const parsed = mcpDebriefSchema.parse(args);
          const actorInfo = getActorInfo(req);
          const debrief = await debriefsSvc.create(companyId, {
            title: parsed.title ?? null,
            inputType: "mcp",
            rawContent: parsed.content,
            departmentId: parsed.departmentId ?? null,
            projectId: parsed.projectId ?? null,
            sourceInfo: parsed.source ?? null,
            createdBy: actorInfo.actorId,
          });
          await logActivity(db, {
            companyId,
            actorType: actorInfo.actorType,
            actorId: actorInfo.actorId,
            agentId: actorInfo.agentId,
            runId: actorInfo.runId,
            action: "debrief.created",
            entityType: "debrief",
            entityId: debrief.id,
            details: { title: debrief.title, inputType: "mcp" },
          });
          void extractionSvc.extractFromDebrief(companyId, debrief.id).catch(() => {});
          res.json(jsonRpcResult(requestBody.id ?? null, asToolContent({ debriefId: debrief.id, status: "processing" })));
          return;
        }

        if (params.name === "suggest-memory") {
          const parsed = z
            .object({
              title: z.string().min(1),
              content: z.string().min(1),
              category: z.string().min(1),
              tags: z.array(z.string()).optional(),
              departmentId: z.string().uuid().nullable().optional(),
              projectId: z.string().uuid().nullable().optional(),
              layer: z.string().nullable().optional(),
              priority: z.number().int().optional(),
              goalId: z.string().uuid().nullable().optional(),
              taskId: z.string().uuid().nullable().optional(),
            })
            .parse(args);

          const item = await memorySvc.create(companyId, {
            ...parsed,
            source: "mcp",
            createdBy: protocolActor.userId,
            status: "pending",
            visibility: "scoped",
            priority: parsed.priority ?? 0,
            tags: parsed.tags ?? null,
            departmentId: parsed.departmentId ?? null,
            projectId: parsed.projectId ?? null,
            layer: parsed.layer ?? null,
            goalId: parsed.goalId ?? null,
            taskId: parsed.taskId ?? null,
          });
          await logActivity(db, {
            companyId,
            actorType: "user",
            actorId: protocolActor.userId,
            action: "memory.created",
            entityType: "memory_item",
            entityId: item.id,
            details: { title: item.title, source: item.source, status: item.status },
          });
          res.json(jsonRpcResult(requestBody.id ?? null, asToolContent({ id: item.id, status: item.status })));
          return;
        }

        if (params.name === "update-task-status") {
          const parsed = z.object({ taskId: z.string(), status: z.enum(ISSUE_STATUSES) }).parse(args);
          const issue = await issuesSvc.getById(parsed.taskId);
          if (!issue || issue.companyId !== companyId || !canAccessProjectScopedEntity(scope, issue.projectId)) {
            res.status(404).json(jsonRpcError(requestBody.id ?? null, -32004, "Task not found"));
            return;
          }
          const updated = await issuesSvc.update(parsed.taskId, { status: parsed.status });
          await logActivity(db, {
            companyId,
            actorType: "user",
            actorId: protocolActor.userId,
            action: "issue.updated",
            entityType: "issue",
            entityId: parsed.taskId,
            details: { status: parsed.status, source: "mcp" },
          });
          res.json(jsonRpcResult(requestBody.id ?? null, asToolContent(updated)));
          return;
        }

        if (params.name === "attach-artifact-version") {
          const parsed = z
            .object({
              artifactId: z.string().uuid(),
              sourceDetail: mcpArtifactVersionSchema.shape.sourceDetail,
              changelog: mcpArtifactVersionSchema.shape.changelog,
              parentVersionId: mcpArtifactVersionSchema.shape.parentVersionId,
              content: mcpArtifactVersionSchema.shape.content,
              fileUrl: mcpArtifactVersionSchema.shape.fileUrl,
            })
            .parse(args);

          const artifact = await artifactsSvc.getById(parsed.artifactId);
          const filtered = artifact ? await filterArtifactsForScope(db, scope, [artifact]) : [];
          if (filtered.length === 0) {
            res.status(404).json(jsonRpcError(requestBody.id ?? null, -32004, "Artifact not found"));
            return;
          }

          const version = await artifactsSvc.addVersion(parsed.artifactId, {
            source: "mcp",
            sourceDetail: parsed.sourceDetail,
            changelog: parsed.changelog ?? null,
            parentVersionId: parsed.parentVersionId ?? null,
            content: parsed.content ?? null,
            fileUrl: parsed.fileUrl ?? null,
          });
          await logActivity(db, {
            companyId,
            actorType: "user",
            actorId: protocolActor.userId,
            action: "artifact.version_added",
            entityType: "artifact",
            entityId: parsed.artifactId,
            details: { versionId: version.id, versionNumber: version.versionNumber, source: "mcp" },
          });
          res.json(jsonRpcResult(requestBody.id ?? null, asToolContent(version)));
          return;
        }

        res.status(400).json(jsonRpcError(requestBody.id ?? null, -32601, "Tool not found"));
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
