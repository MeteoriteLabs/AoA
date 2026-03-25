// server/src/services/internal-agent/tools/action-tools.ts
import type { AgentTool } from "../types.js";

export function createActionTools(): AgentTool[] {
  return [
    {
      name: "create_task",
      description: "Create a new task with title, optional description, priority, department, goal, and assignee.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title (required)" },
          description: { type: "string", description: "Task description" },
          priority: { type: "string", enum: ["urgent", "high", "medium", "low"], description: "Task priority" },
          departmentId: { type: "string", description: "Department to assign task to" },
          goalId: { type: "string", description: "Goal to link task to" },
          assigneeId: { type: "string", description: "Agent or user to assign task to" },
        },
        required: ["title"],
      },
      category: "action",
      requiredRole: "team_lead",
      requiresConfirmation: true,
      execute: async (params: unknown, ctx) => {
        const { title, description, priority, departmentId, goalId, assigneeId } = (params ?? {}) as Record<string, unknown>;
        const task = await ctx.services.issues.create(ctx.companyId, {
          title: title as string,
          ...(description ? { description: description as string } : {}),
          ...(priority ? { priority: priority as string } : {}),
          ...(departmentId ? { projectId: departmentId as string } : {}),
          ...(goalId ? { goalId: goalId as string } : {}),
          ...(assigneeId ? { assigneeAgentId: assigneeId as string } : {}),
        });
        return { success: true, data: task, summary: `Created task "${title}"` };
      },
    },
    {
      name: "update_task",
      description: "Update an existing task's title, status, or priority.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "ID of the task to update (required)" },
          title: { type: "string", description: "New title" },
          status: { type: "string", description: "New status" },
          priority: { type: "string", enum: ["urgent", "high", "medium", "low"], description: "New priority" },
        },
        required: ["taskId"],
      },
      category: "action",
      requiredRole: "team_member",
      requiresConfirmation: true,
      execute: async (params: unknown, ctx) => {
        const { taskId, ...updates } = (params ?? {}) as Record<string, unknown>;
        const task = await ctx.services.issues.update(taskId as string, updates);
        return { success: true, data: task, summary: `Updated task ${taskId}` };
      },
    },
    {
      name: "create_department",
      description: "Create a new department. Founder-only.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Department name (required)" },
          description: { type: "string", description: "Department description" },
        },
        required: ["name"],
      },
      category: "action",
      requiredRole: "founder",
      requiresConfirmation: true,
      execute: async (params: unknown, ctx) => {
        const { name, description } = (params ?? {}) as Record<string, unknown>;
        const dept = await ctx.services.projects.create(ctx.companyId, {
          name: name as string,
          type: "department",
          ...(description ? { description: description as string } : {}),
        });
        return { success: true, data: dept, summary: `Created department "${name}"` };
      },
    },
    {
      name: "create_goal",
      description: "Create a new goal with optional department scope.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Goal title (required)" },
          description: { type: "string", description: "Goal description" },
          departmentId: { type: "string", description: "Department to scope goal to" },
        },
        required: ["title"],
      },
      category: "action",
      requiredRole: "team_lead",
      requiresConfirmation: true,
      execute: async (params: unknown, ctx) => {
        const { title, description, departmentId } = (params ?? {}) as Record<string, unknown>;
        const goal = await ctx.services.goals.create(ctx.companyId, {
          title: title as string,
          ...(description ? { description: description as string } : {}),
          ...(departmentId ? { projectId: departmentId as string } : {}),
        });
        return { success: true, data: goal, summary: `Created goal "${title}"` };
      },
    },
    {
      name: "create_agent",
      description: "Create a new worker agent. Founder-only.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Agent name (required)" },
          adapter: { type: "string", description: "Adapter type (required, e.g. claude_local, openai_api)" },
          context: { type: "string", description: "Agent context/instructions" },
        },
        required: ["name", "adapter"],
      },
      category: "action",
      requiredRole: "founder",
      requiresConfirmation: true,
      execute: async (params: unknown, ctx) => {
        const { name, adapter, context } = (params ?? {}) as Record<string, unknown>;
        const agent = await ctx.services.agents.create(ctx.companyId, {
          name: name as string,
          adapterType: adapter as string,
          ...(context ? { context: context as string } : {}),
        });
        return { success: true, data: agent, summary: `Created agent "${name}"` };
      },
    },
    {
      name: "update_agent",
      description: "Update agent configuration. Founder-only.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Agent ID (required)" },
          context: { type: "string", description: "Updated agent context/instructions" },
          model: { type: "string", description: "Updated model" },
        },
        required: ["agentId"],
      },
      category: "action",
      requiredRole: "founder",
      requiresConfirmation: true,
      execute: async (params: unknown, ctx) => {
        const { agentId, ...updates } = (params ?? {}) as Record<string, unknown>;
        const agent = await ctx.services.agents.update(agentId as string, updates);
        return { success: true, data: agent, summary: `Updated agent ${agentId}` };
      },
    },
    {
      name: "assign_task",
      description: "Assign a task to an agent or user.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID (required)" },
          assigneeId: { type: "string", description: "Agent or user ID to assign (required)" },
        },
        required: ["taskId", "assigneeId"],
      },
      category: "action",
      requiredRole: "team_lead",
      requiresConfirmation: true,
      execute: async (params: unknown, ctx) => {
        const { taskId, assigneeId } = (params ?? {}) as Record<string, unknown>;
        const task = await ctx.services.issues.update(taskId as string, { assigneeAgentId: assigneeId as string });
        return { success: true, data: task, summary: `Assigned task ${taskId} to ${assigneeId}` };
      },
    },
    {
      name: "wakeup_agent",
      description: "Trigger an agent's heartbeat to start working.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Agent ID to wake up (required)" },
        },
        required: ["agentId"],
      },
      category: "action",
      requiredRole: "team_lead",
      requiresConfirmation: true,
      execute: async (params: unknown, ctx) => {
        const { agentId } = (params ?? {}) as Record<string, unknown>;
        const result = await ctx.services.heartbeat.wakeup(agentId as string, {
          source: "on_demand",
          triggerDetail: "manual",
          requestedByActorType: "user",
          requestedByActorId: ctx.userId,
        });
        return { success: true, data: result, summary: `Wakeup triggered for agent ${agentId}` };
      },
    },
  ];
}
