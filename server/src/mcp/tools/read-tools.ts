import { z } from "zod";
import {
  type ToolContext,
  type ToolHandler,
  type ToolResult,
  notFoundResult,
  ok,
} from "./types.js";
import { assertScopedProjectAccess, canAccessProjectScopedEntity } from "./scope.js";

async function handleMe(ctx: ToolContext): Promise<ToolResult> {
  const role = await ctx.resolveRole(ctx.companyId, ctx.actor.userId);
  return ok({
    userId: ctx.actor.userId,
    companyId: ctx.companyId,
    role,
  });
}

async function handleListAgents(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z.object({ status: z.string().optional() }).parse(args);
  const allowedIds = await ctx.resolveScopedAgentIds(ctx.companyId, ctx.scope);
  let rows = await ctx.services.agentsSvc.list(ctx.companyId, { includeTerminated: true });
  if (allowedIds !== null) {
    rows = rows.filter((row) => allowedIds.has(row.id));
  }
  if (parsed.status) {
    rows = rows.filter((row) => row.status === parsed.status);
  }
  return ok(rows);
}

async function handleGetAgent(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z.object({ agentId: z.string().min(1) }).parse(args);
  const agent = await ctx.services.agentsSvc.getById(parsed.agentId);
  if (!agent || agent.companyId !== ctx.companyId) {
    return notFoundResult("Agent not found");
  }
  const allowedIds = await ctx.resolveScopedAgentIds(ctx.companyId, ctx.scope);
  if (allowedIds !== null && !allowedIds.has(agent.id)) {
    return notFoundResult("Agent not found");
  }
  return ok(agent);
}

async function handleListProjects(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z
    .object({ type: z.enum(["department", "project"]).optional() })
    .parse(args);
  let rows = await ctx.services.projectsSvc.list(
    ctx.companyId,
    parsed.type ? { type: parsed.type } : undefined,
  );
  if (ctx.scope.kind === "scoped") {
    const scopedIds = ctx.scope.projectIds;
    rows = rows.filter((row) => scopedIds.has(row.id));
  }
  return ok(rows);
}

async function handleGetProject(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z.object({ projectId: z.string().min(1) }).parse(args);
  const project = await ctx.services.projectsSvc.getById(parsed.projectId);
  if (!project || project.companyId !== ctx.companyId) {
    return notFoundResult("Project not found");
  }
  if (!canAccessProjectScopedEntity(ctx.scope, project.id)) {
    return notFoundResult("Project not found");
  }
  return ok(project);
}

async function handleListTasks(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z
    .object({
      status: z.string().optional(),
      projectId: z.string().optional(),
      assigneeAgentId: z.string().optional(),
      assigneeUserId: z.string().optional(),
      touchedByUserId: z.string().optional(),
      unreadForUserId: z.string().optional(),
      labelId: z.string().optional(),
      q: z.string().optional(),
    })
    .parse(args);
  if (parsed.projectId) {
    assertScopedProjectAccess(ctx.scope, parsed.projectId, "Project");
  }
  const rows = await ctx.services.issuesSvc.list(ctx.companyId, parsed);
  const filtered = rows.filter((row) => canAccessProjectScopedEntity(ctx.scope, row.projectId));
  return ok(filtered);
}

async function handleGetHeartbeatContext(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z.object({ taskId: z.string().min(1) }).parse(args);
  const task = await ctx.services.issuesSvc.getById(parsed.taskId);
  if (
    !task ||
    task.companyId !== ctx.companyId ||
    !canAccessProjectScopedEntity(ctx.scope, task.projectId)
  ) {
    return notFoundResult("Task not found");
  }
  const comments = await ctx.services.issuesSvc.listComments(parsed.taskId);
  const recentComments = comments.slice(0, 10);
  return ok({ task, recentComments });
}

async function handleListTaskComments(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z.object({ taskId: z.string().min(1) }).parse(args);
  const task = await ctx.services.issuesSvc.getById(parsed.taskId);
  if (
    !task ||
    task.companyId !== ctx.companyId ||
    !canAccessProjectScopedEntity(ctx.scope, task.projectId)
  ) {
    return notFoundResult("Task not found");
  }
  const comments = await ctx.services.issuesSvc.listComments(parsed.taskId);
  return ok(comments);
}

async function handleGetTaskComment(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z.object({ commentId: z.string().min(1) }).parse(args);
  const comment = await ctx.services.issuesSvc.getComment(parsed.commentId);
  if (!comment || comment.companyId !== ctx.companyId) {
    return notFoundResult("Comment not found");
  }
  const task = await ctx.services.issuesSvc.getById(comment.issueId);
  if (
    !task ||
    task.companyId !== ctx.companyId ||
    !canAccessProjectScopedEntity(ctx.scope, task.projectId)
  ) {
    return notFoundResult("Comment not found");
  }
  return ok(comment);
}

export const readToolHandlers: Record<string, ToolHandler> = {
  "me": handleMe,
  "list-agents": handleListAgents,
  "get-agent": handleGetAgent,
  "list-projects": handleListProjects,
  "get-project": handleGetProject,
  "list-tasks": handleListTasks,
  "get-heartbeat-context": handleGetHeartbeatContext,
  "list-task-comments": handleListTaskComments,
  "get-task-comment": handleGetTaskComment,
};
