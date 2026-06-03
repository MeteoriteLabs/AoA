import { z } from "zod";
import {
  ISSUE_STATUSES,
  MEMORY_ITEM_LAYERS,
  mcpArtifactVersionSchema,
  mcpDebriefSchema,
} from "@armyofagents/shared";
import { logActivity } from "../../services/index.js";
import { enqueueInboxItem } from "../../services/inbox-producer.js";
import {
  type ToolContext,
  type ToolHandler,
  type ToolResult,
  forbiddenResult,
  notFoundResult,
  ok,
} from "./types.js";
import {
  artifactProjectMap,
  assertScopedGoalAccess,
  assertScopedProjectAccess,
  canAccessProjectScopedEntity,
  filterArtifactsForScope,
} from "./scope.js";

async function handleDebriefPush(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = mcpDebriefSchema.parse(args);
  assertScopedProjectAccess(ctx.scope, parsed.departmentId ?? null, "Department");
  assertScopedProjectAccess(ctx.scope, parsed.projectId ?? null, "Project");
  const debrief = await ctx.services.debriefsSvc.create(ctx.companyId, {
    title: parsed.title ?? null,
    inputType: "mcp",
    rawContent: parsed.content,
    departmentId: parsed.departmentId ?? null,
    projectId: parsed.projectId ?? null,
    sourceInfo: parsed.source ?? null,
    createdBy: ctx.actorInfo.actorId,
  });
  await logActivity(ctx.db, {
    companyId: ctx.companyId,
    actorType: ctx.actorInfo.actorType,
    actorId: ctx.actorInfo.actorId,
    agentId: ctx.actorInfo.agentId,
    runId: ctx.actorInfo.runId,
    action: "debrief.created",
    entityType: "debrief",
    entityId: debrief.id,
    details: { title: debrief.title, inputType: "mcp" },
  });
  void ctx.services.extractionSvc.extractFromDebrief(ctx.companyId, debrief.id).catch(() => {});

  // Decision #14 — dual-write to thread_inbox_items (best-effort).
  // A failure here must never break the legacy debrief consumers: the debrief
  // row is already committed above, so we silently swallow any error.
  enqueueInboxItem(ctx.db, {
    companyId: ctx.companyId,
    originMedium: "mcp",
    originSource: ctx.actorInfo.actorId,
    rawContent: parsed.content,
  }).catch((err: unknown) => {
    console.error("[debrief-push] inbox enqueue failed (best-effort):", err);
  });

  return ok({ debriefId: debrief.id, status: "processing" });
}

async function handleSuggestMemory(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
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

  assertScopedProjectAccess(ctx.scope, parsed.departmentId ?? null, "Department");
  assertScopedProjectAccess(ctx.scope, parsed.projectId ?? null, "Project");
  await assertScopedGoalAccess(ctx.db, ctx.scope, parsed.goalId ?? null);

  let linkedTask: Awaited<ReturnType<typeof ctx.services.issuesSvc.getById>> | null = null;
  if (parsed.taskId) {
    linkedTask = await ctx.services.issuesSvc.getById(parsed.taskId);
    if (!linkedTask || linkedTask.companyId !== ctx.companyId) {
      return notFoundResult("Task not found");
    }
    assertScopedProjectAccess(ctx.scope, linkedTask.projectId, "Task");
  }

  const memoryDepartmentId =
    parsed.departmentId ?? parsed.projectId ?? linkedTask?.projectId ?? null;
  const canCreateMemory = await ctx.services.permissionsSvc.canAccessMemory(
    ctx.companyId,
    ctx.actor.userId,
    "create",
    {
      layer: parsed.layer ?? null,
      departmentId: memoryDepartmentId,
      visibility: "scoped",
    },
  );
  if (!canCreateMemory) {
    return forbiddenResult("Insufficient permissions for memory create");
  }

  const item = await ctx.services.memorySvc.create(ctx.companyId, {
    ...parsed,
    source: "mcp",
    createdBy: ctx.actor.userId,
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
  await logActivity(ctx.db, {
    companyId: ctx.companyId,
    actorType: "user",
    actorId: ctx.actor.userId,
    action: "memory.created",
    entityType: "memory_item",
    entityId: item.id,
    details: { title: item.title, source: item.source, status: item.status },
  });
  return ok({ id: item.id, status: item.status });
}

async function handleUpdateTaskStatus(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z
    .object({ taskId: z.string(), status: z.enum(ISSUE_STATUSES) })
    .parse(args);
  const issue = await ctx.services.issuesSvc.getById(parsed.taskId);
  if (
    !issue ||
    issue.companyId !== ctx.companyId ||
    !canAccessProjectScopedEntity(ctx.scope, issue.projectId)
  ) {
    return notFoundResult("Task not found");
  }
  const canUpdateTask = await ctx.services.permissionsSvc.canAccessEntity(
    ctx.companyId,
    ctx.actor.userId,
    "task",
    "update",
    {
      departmentId: issue.projectId ?? null,
      assigneeUserId: issue.assigneeUserId ?? null,
    },
  );
  if (!canUpdateTask) {
    return forbiddenResult("Insufficient permissions for task update");
  }
  const updated = await ctx.services.issuesSvc.update(parsed.taskId, { status: parsed.status });
  await logActivity(ctx.db, {
    companyId: ctx.companyId,
    actorType: "user",
    actorId: ctx.actor.userId,
    action: "issue.updated",
    entityType: "issue",
    entityId: parsed.taskId,
    details: { status: parsed.status, source: "mcp" },
  });
  return ok(updated);
}

async function handleCreateTask(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z
    .object({
      title: z.string().min(1),
      description: z.string().nullable().optional(),
      projectId: z.string().min(1).nullable().optional(),
      goalId: z.string().min(1).nullable().optional(),
      parentId: z.string().min(1).nullable().optional(),
      status: z.enum(ISSUE_STATUSES).optional(),
      priority: z.string().optional(),
      assigneeAgentId: z.string().min(1).nullable().optional(),
      assigneeUserId: z.string().min(1).nullable().optional(),
      labelIds: z.array(z.string().min(1)).optional(),
    })
    .parse(args);

  if (parsed.projectId) {
    const project = await ctx.services.projectsSvc.getById(parsed.projectId);
    if (!project || project.companyId !== ctx.companyId) {
      return notFoundResult("Project not found");
    }
    assertScopedProjectAccess(ctx.scope, parsed.projectId, "Project");
  }
  const canCreate = await ctx.services.permissionsSvc.canAccessEntity(
    ctx.companyId,
    ctx.actor.userId,
    "task",
    "create",
    { departmentId: parsed.projectId ?? null },
  );
  if (!canCreate) {
    return forbiddenResult("Insufficient permissions for task create");
  }
  const created = await ctx.services.issuesSvc.create(ctx.companyId, {
    ...parsed,
    createdByUserId: ctx.actorInfo.actorType === "user" ? ctx.actorInfo.actorId : null,
    createdByAgentId: ctx.actorInfo.agentId ?? null,
  } as any);
  await logActivity(ctx.db, {
    companyId: ctx.companyId,
    actorType: ctx.actorInfo.actorType,
    actorId: ctx.actorInfo.actorId,
    agentId: ctx.actorInfo.agentId,
    runId: ctx.actorInfo.runId,
    action: "issue.created",
    entityType: "issue",
    entityId: created.id,
    details: { title: created.title, source: "mcp" },
  });
  return ok(created);
}

async function handleUpdateTask(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z
    .object({
      taskId: z.string().min(1),
      title: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      projectId: z.string().min(1).nullable().optional(),
      goalId: z.string().min(1).nullable().optional(),
      status: z.enum(ISSUE_STATUSES).optional(),
      priority: z.string().optional(),
      assigneeAgentId: z.string().min(1).nullable().optional(),
      assigneeUserId: z.string().min(1).nullable().optional(),
      labelIds: z.array(z.string().min(1)).optional(),
    })
    .parse(args);

  const existing = await ctx.services.issuesSvc.getById(parsed.taskId);
  if (
    !existing ||
    existing.companyId !== ctx.companyId ||
    !canAccessProjectScopedEntity(ctx.scope, existing.projectId)
  ) {
    return notFoundResult("Task not found");
  }
  if (parsed.projectId) {
    assertScopedProjectAccess(ctx.scope, parsed.projectId, "Project");
  }
  const canUpdate = await ctx.services.permissionsSvc.canAccessEntity(
    ctx.companyId,
    ctx.actor.userId,
    "task",
    "update",
    {
      departmentId: existing.projectId ?? null,
      assigneeUserId: existing.assigneeUserId ?? null,
    },
  );
  if (!canUpdate) {
    return forbiddenResult("Insufficient permissions for task update");
  }
  const { taskId, ...patch } = parsed;
  const updated = await ctx.services.issuesSvc.update(taskId, patch as any);
  await logActivity(ctx.db, {
    companyId: ctx.companyId,
    actorType: "user",
    actorId: ctx.actor.userId,
    action: "issue.updated",
    entityType: "issue",
    entityId: taskId,
    details: { fields: Object.keys(patch), source: "mcp" },
  });
  return ok(updated);
}

async function handleAddTaskComment(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z
    .object({
      taskId: z.string().min(1),
      body: z.string().min(1),
    })
    .parse(args);

  const task = await ctx.services.issuesSvc.getById(parsed.taskId);
  if (
    !task ||
    task.companyId !== ctx.companyId ||
    !canAccessProjectScopedEntity(ctx.scope, task.projectId)
  ) {
    return notFoundResult("Task not found");
  }
  const comment = await ctx.services.issuesSvc.addComment(parsed.taskId, parsed.body, {
    userId: ctx.actorInfo.actorType === "user" ? ctx.actorInfo.actorId : undefined,
    agentId: ctx.actorInfo.agentId ?? undefined,
  });
  await logActivity(ctx.db, {
    companyId: ctx.companyId,
    actorType: ctx.actorInfo.actorType,
    actorId: ctx.actorInfo.actorId,
    agentId: ctx.actorInfo.agentId,
    runId: ctx.actorInfo.runId,
    action: "issue.commented",
    entityType: "issue",
    entityId: parsed.taskId,
    details: { commentId: comment.id, source: "mcp" },
  });
  return ok(comment);
}

async function handleAttachArtifactVersion(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
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

  const artifact = await ctx.services.artifactsSvc.getById(parsed.artifactId);
  const filtered = artifact ? await filterArtifactsForScope(ctx.db, ctx.scope, [artifact]) : [];
  if (filtered.length === 0) {
    return notFoundResult("Artifact not found");
  }
  const linkedProjectId =
    (await artifactProjectMap(ctx.db, [parsed.artifactId])).get(parsed.artifactId) ?? null;
  const canUpdateArtifact = await ctx.services.permissionsSvc.canAccessEntity(
    ctx.companyId,
    ctx.actor.userId,
    "artifact",
    "update",
    { departmentId: linkedProjectId },
  );
  if (!canUpdateArtifact) {
    return forbiddenResult("Insufficient permissions for artifact update");
  }

  const version = await ctx.services.artifactsSvc.addVersion(parsed.artifactId, {
    source: "mcp",
    sourceDetail: parsed.sourceDetail,
    changelog: parsed.changelog ?? null,
    parentVersionId: parsed.parentVersionId ?? null,
    content: parsed.content ?? null,
    fileUrl: parsed.fileUrl ?? null,
  });
  await logActivity(ctx.db, {
    companyId: ctx.companyId,
    actorType: "user",
    actorId: ctx.actor.userId,
    action: "artifact.version_added",
    entityType: "artifact",
    entityId: parsed.artifactId,
    details: {
      versionId: version.id,
      versionNumber: version.versionNumber,
      source: "mcp",
    },
  });
  return ok(version);
}

/**
 * V2.6 worker-facing memory.retain.
 *
 * Two distinct paths based on caller + scope:
 *
 *   PATH 1 — agent-personal scope (auto-approved)
 *     Conditions: actor.source === "agent" AND scopeToSelf === true
 *                 AND actor.agentId is set
 *     Behavior: creates the item, then immediately approves it. The
 *               item's agentId column is set to the caller's agentId,
 *               which scopes it to the agent's personal "notebook" —
 *               only this agent (plus founder/team_lead in scope) sees
 *               it on subsequent reads. No founder review required.
 *               This is the agent equivalent of jotting in a private
 *               diary. Critical Rule #6 is preserved because the agent
 *               can only auto-approve INTO ITS OWN BUCKET.
 *
 *   PATH 2 — org/department/project scope (pending)
 *     Conditions: any other call shape
 *     Behavior: identical to suggest-memory — creates a pending item
 *               that requires founder approval. RBAC scope check
 *               applies.
 *
 * Critical Rule #6 footnote: agents cannot write to identity / domain
 * memory directly. Auto-approve is gated on (a) the personal-scope
 * boolean and (b) actor being an agent. Founders calling memory.retain
 * (e.g., from the board) always go through the pending path because
 * they have richer authoring tools at /companies/:cid/memory.
 */
async function handleMemoryRetain(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z
    .object({
      title: z.string().min(1),
      content: z.string().min(1),
      category: z.string().min(1),
      layer: z.enum(MEMORY_ITEM_LAYERS),
      sourceContext: z.string().min(1),
      tags: z.array(z.string()).optional(),
      departmentId: z.string().uuid().nullable().optional(),
      projectId: z.string().uuid().nullable().optional(),
      goalId: z.string().uuid().nullable().optional(),
      taskId: z.string().uuid().nullable().optional(),
      scopeToSelf: z.boolean().optional(),
    })
    .parse(args);

  const callerAgentId = ctx.actor.agentId ?? null;
  const isAgentActor = ctx.actor.source === "agent";
  const isPersonalScope = parsed.scopeToSelf === true && isAgentActor && callerAgentId !== null;

  // Org/department/project scope path — re-check RBAC even though the
  // route already gates company access; the founder's permissionsSvc
  // can deny per-layer or per-department writes.
  if (!isPersonalScope) {
    assertScopedProjectAccess(ctx.scope, parsed.departmentId ?? null, "Department");
    assertScopedProjectAccess(ctx.scope, parsed.projectId ?? null, "Project");
    await assertScopedGoalAccess(ctx.db, ctx.scope, parsed.goalId ?? null);

    const memoryDepartmentId =
      parsed.departmentId ?? parsed.projectId ?? null;
    const canCreateMemory = await ctx.services.permissionsSvc.canAccessMemory(
      ctx.companyId,
      ctx.actor.userId,
      "create",
      {
        layer: parsed.layer,
        departmentId: memoryDepartmentId,
        visibility: "scoped",
      },
    );
    if (!canCreateMemory) {
      return forbiddenResult("Insufficient permissions for memory create");
    }
  }

  // memorySvc.create() forces source=agent → status=pending. We use
  // that path for both routes, then immediately approve when
  // isPersonalScope (preserving the rule that agents create pending
  // items, but allowing the agent to flip its own personal bucket to
  // approved as a follow-up step).
  const item = await ctx.services.memorySvc.create(ctx.companyId, {
    title: parsed.title,
    content: parsed.content,
    category: parsed.category,
    layer: parsed.layer,
    source: isAgentActor ? "agent" : "mcp",
    sourceContext: parsed.sourceContext,
    createdBy: ctx.actor.userId,
    visibility: "scoped",
    priority: 0,
    tags: parsed.tags ?? null,
    departmentId: parsed.departmentId ?? null,
    projectId: parsed.projectId ?? null,
    goalId: parsed.goalId ?? null,
    taskId: parsed.taskId ?? null,
    agentId: isPersonalScope ? callerAgentId : null,
  });

  let finalStatus = item.status;
  if (isPersonalScope && item.status === "pending") {
    const approved = await ctx.services.memorySvc.approve(ctx.companyId, item.id);
    if (approved) finalStatus = approved.status;
  }

  await logActivity(ctx.db, {
    companyId: ctx.companyId,
    actorType: isAgentActor ? "agent" : "user",
    actorId: ctx.actor.userId,
    agentId: isAgentActor ? callerAgentId : null,
    runId: ctx.actor.runId ?? null,
    action: "memory.created",
    entityType: "memory_item",
    entityId: item.id,
    details: {
      title: item.title,
      source: item.source,
      status: finalStatus,
      scopeToSelf: isPersonalScope,
      layer: parsed.layer,
    },
  });

  return ok({ id: item.id, status: finalStatus, agentId: item.agentId });
}

export const writeToolHandlers: Record<string, ToolHandler> = {
  "debrief-push": handleDebriefPush,
  "suggest-memory": handleSuggestMemory,
  "update-task-status": handleUpdateTaskStatus,
  "create-task": handleCreateTask,
  "update-task": handleUpdateTask,
  "add-task-comment": handleAddTaskComment,
  "attach-artifact-version": handleAttachArtifactVersion,
  // V2.6
  "memory.retain": handleMemoryRetain,
};
