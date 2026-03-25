import type { AgentTool } from "../types.js";

export function createQueryTools(): AgentTool[] {
  return [
    {
      name: "query_tasks",
      description: "List and filter tasks. Returns tasks matching the given filters.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status (e.g. todo, in_progress, review, done)" },
          departmentId: { type: "string", description: "Filter by department ID" },
          limit: { type: "number", description: "Max results to return (default 20)" },
        },
      },
      category: "query",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { status, departmentId, limit } = (params ?? {}) as Record<string, unknown>;
        const tasks = await ctx.services.issues.list(ctx.companyId, {
          ...(status ? { status: status as string } : {}),
          ...(departmentId ? { projectId: departmentId as string } : {}),
        });
        const limited = Array.isArray(tasks) ? tasks.slice(0, (limit as number) ?? 20) : tasks;
        const count = Array.isArray(limited) ? limited.length : 0;
        return { success: true, data: limited, summary: `Found ${count} task(s)` };
      },
    },
    {
      name: "query_goals",
      description: "List goals with optional status filter.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status (planned, active, at_risk, achieved, cancelled)" },
          limit: { type: "number", description: "Max results to return" },
        },
      },
      category: "query",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { status, limit } = (params ?? {}) as Record<string, unknown>;
        const goals = await ctx.services.goals.list(ctx.companyId, status as string | undefined);
        const limited = Array.isArray(goals) ? goals.slice(0, (limit as number) ?? 20) : goals;
        const count = Array.isArray(limited) ? limited.length : 0;
        return { success: true, data: limited, summary: `Found ${count} goal(s)` };
      },
    },
    {
      name: "query_agents",
      description: "List agents with optional department filter.",
      parameters: {
        type: "object",
        properties: {
          departmentId: { type: "string", description: "Filter by department ID" },
          limit: { type: "number", description: "Max results to return" },
        },
      },
      category: "query",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { limit } = (params ?? {}) as Record<string, unknown>;
        const agents = await ctx.services.agents.list(ctx.companyId);
        const limited = Array.isArray(agents) ? agents.slice(0, (limit as number) ?? 20) : agents;
        const count = Array.isArray(limited) ? limited.length : 0;
        return { success: true, data: limited, summary: `Found ${count} agent(s)` };
      },
    },
    {
      name: "query_departments",
      description: "List all departments.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results to return" },
        },
      },
      category: "query",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { limit } = (params ?? {}) as Record<string, unknown>;
        const departments = await ctx.services.projects.list(ctx.companyId, { type: "department" });
        const limited = Array.isArray(departments) ? departments.slice(0, (limit as number) ?? 20) : departments;
        const count = Array.isArray(limited) ? limited.length : 0;
        return { success: true, data: limited, summary: `Found ${count} department(s)` };
      },
    },
    {
      name: "query_budget",
      description: "Get budget summary for the company.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["month", "year"], description: "Time period for budget summary" },
        },
      },
      category: "query",
      requiredRole: "team_lead",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { period } = (params ?? {}) as Record<string, unknown>;
        const range =
          period === "year"
            ? { from: new Date(new Date().getFullYear(), 0, 1), to: new Date() }
            : { from: new Date(new Date().getFullYear(), new Date().getMonth(), 1), to: new Date() };
        const summary = await ctx.services.costs.summary(ctx.companyId, range);
        return { success: true, data: summary, summary: `Budget summary retrieved` };
      },
    },
    {
      name: "query_activity",
      description: "Get recent activity log entries.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max entries to return (default 20)" },
          days: { type: "number", description: "Look back N days (default 7)" },
        },
      },
      category: "query",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { limit } = (params ?? {}) as Record<string, unknown>;
        const activities = await ctx.services.activity.list({ companyId: ctx.companyId });
        const limited = Array.isArray(activities) ? activities.slice(0, (limit as number) ?? 20) : activities;
        const count = Array.isArray(limited) ? limited.length : 0;
        return { success: true, data: limited, summary: `Found ${count} activity entries` };
      },
    },
  ];
}
