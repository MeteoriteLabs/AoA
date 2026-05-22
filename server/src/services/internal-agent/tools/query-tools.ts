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
        const goals = await ctx.services.goals.list(ctx.companyId);
        const filtered = Array.isArray(goals) && status
          ? goals.filter((g: any) => g.status === status)
          : goals;
        const limited = Array.isArray(filtered) ? filtered.slice(0, (limit as number) ?? 20) : filtered;
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
        const { departmentId, limit } = (params ?? {}) as Record<string, unknown>;
        const agents = await ctx.services.agents.list(ctx.companyId);
        const filtered = Array.isArray(agents) && departmentId
          ? agents.filter((a: any) => a.projectId === departmentId)
          : agents;
        const limited = Array.isArray(filtered) ? filtered.slice(0, (limit as number) ?? 20) : filtered;
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
    {
      name: "query_company",
      description:
        "Get the current company's identity: name, vision, mission, issue prefix, and stage. Call this whenever you need to know who you are working for.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      category: "query",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (_params: unknown, ctx) => {
        const company = await ctx.services.companies.get(ctx.companyId);
        if (!company) {
          return { success: false, error: "Company not found", data: null, summary: "Company not found" };
        }
        return {
          success: true,
          data: {
            name: company.name ?? null,
            vision: company.vision ?? null,
            mission: company.mission ?? null,
            issuePrefix: company.issuePrefix ?? null,
            stage: company.stage ?? null,
          },
          summary: `Company: ${company.name ?? "unnamed"}`,
        };
      },
    },
  ];
}
