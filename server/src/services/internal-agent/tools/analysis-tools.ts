import type { AgentTool } from "../types.js";

export function createAnalysisTools(): AgentTool[] {
  return [
    {
      name: "analyze_workload",
      description: "Analyze workload distribution across agents or departments.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Analyze specific agent's workload" },
          departmentId: { type: "string", description: "Analyze specific department's workload" },
        },
      },
      category: "analysis",
      requiredRole: "team_lead",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const suggestions = await ctx.services.suggestions.list(ctx.companyId, {
          category: "workload_balance",
        });
        const count = Array.isArray(suggestions) ? suggestions.length : 0;
        return { success: true, data: suggestions, summary: `Found ${count} workload insight(s)` };
      },
    },
    {
      name: "suggest_improvements",
      description: "Generate improvement suggestions for the organization.",
      parameters: {
        type: "object",
        properties: {
          focus: { type: "string", enum: ["efficiency", "risk", "growth"], description: "Focus area for suggestions" },
        },
      },
      category: "analysis",
      requiredRole: "team_lead",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        await ctx.services.suggestions.runAllDetectors(ctx.companyId);
        const suggestions = await ctx.services.suggestions.listPending(ctx.companyId);
        const count = Array.isArray(suggestions) ? suggestions.length : 0;
        return { success: true, data: suggestions, summary: `Generated ${count} suggestion(s)` };
      },
    },
  ];
}
