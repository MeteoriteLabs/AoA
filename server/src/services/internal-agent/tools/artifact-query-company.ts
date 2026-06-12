// server/src/services/internal-agent/tools/artifact-query-company.ts
//
// Design 2026-06-11 v2 §3f — Commander previously had NO company-wide artifact
// listing (query_artifacts is thread-scoped). category `query` confers no
// capability (see authorize-tool.ts CAPABILITY_TO_CATEGORY), matching the
// other read tools. Company scoping comes from ctx.companyId — never params.
import type { AgentTool, ToolResult } from "../types.js";

const VALID_TYPES = new Set(["document", "presentation", "code", "design", "report", "other"]);
const VALID_STATUSES = new Set(["draft", "active", "archived"]);

export const queryCompanyArtifactsTool: AgentTool = {
  name: "query_company_artifacts",
  description:
    "List the company's recent artifacts (deliverables) across all threads and tasks, newest first. Optional filters: type (document|presentation|code|design|report|other), status (draft|active|archived), limit (default 20, max 50). Use when asked what artifacts/documents/deliverables exist.",
  parameters: {
    type: "object",
    properties: {
      type: { type: "string", description: "Filter by artifact type" },
      status: { type: "string", description: "Filter by artifact status" },
      limit: { type: "number", description: "Max rows (default 20, max 50)" },
    },
    required: [],
  },
  category: "query",
  requiredRole: "team_member",
  requiresConfirmation: false,
  async execute(params, ctx): Promise<ToolResult> {
    const { type, status, limit } = (params ?? {}) as {
      type?: unknown;
      status?: unknown;
      limit?: unknown;
    };
    const typeFilter = typeof type === "string" && VALID_TYPES.has(type) ? type : null;
    const statusFilter = typeof status === "string" && VALID_STATUSES.has(status) ? status : null;
    const cap = Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 50);

    const rows = await ctx.services.artifacts.list(ctx.companyId);
    const list = (Array.isArray(rows) ? rows : [])
      .filter((a: any) => (typeFilter ? a.type === typeFilter : true))
      .filter((a: any) => (statusFilter ? a.status === statusFilter : true))
      .slice(0, cap)
      .map((a: any) => ({
        artifactId: a.id,
        title: a.title,
        type: a.type,
        currentVersionId: a.currentVersionId ?? null,
        status: a.status,
        updatedAt: a.updatedAt,
      }));

    return {
      success: true,
      data: list,
      summary: `Found ${list.length} artifact${list.length === 1 ? "" : "s"} in the company`,
    };
  },
};
