// server/src/services/internal-agent/tools/memory-tools.ts
import type { AgentTool } from "../types.js";

export function createMemoryTools(): AgentTool[] {
  return [
    {
      name: "query_memory",
      description: "Search memory items with optional layer and text filters.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for" },
          layer: { type: "string", enum: ["identity", "domain", "active_context", "working"], description: "Filter by memory layer" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
      category: "memory",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { query, layer, limit } = (params ?? {}) as Record<string, unknown>;
        const maxResults = (limit as number) ?? 20;

        // If query text provided, use semantic search; otherwise use list with filters
        if (query) {
          const items = await ctx.services.memory.searchSemantic(ctx.companyId, query as string, {
            ...(layer ? { layer: layer as string } : {}),
            limit: maxResults,
          });
          const count = Array.isArray(items) ? items.length : 0;
          return { success: true, data: items, summary: `Found ${count} memory item(s)` };
        }

        const items = await ctx.services.memory.list(ctx.companyId, {
          ...(layer ? { layer: layer as string } : {}),
        });
        const limited = Array.isArray(items) ? items.slice(0, maxResults) : items;
        const count = Array.isArray(limited) ? limited.length : 0;
        return { success: true, data: limited, summary: `Found ${count} memory item(s)` };
      },
    },
    {
      name: "create_memory",
      description: "Create a new memory item. Requires founder or team lead approval.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Memory item title (required)" },
          content: { type: "string", description: "Memory content (required)" },
          layer: { type: "string", enum: ["identity", "domain", "active_context", "working"], description: "Memory layer (required)" },
          category: { type: "string", description: "Category (decision, reference, context, insight, preference)" },
          sourceArtifactId: { type: "string", description: "Source artifact ID if derived from an artifact" },
        },
        required: ["title", "content", "layer"],
      },
      category: "memory",
      requiredRole: "team_lead",
      requiresConfirmation: true,
      execute: async (params: unknown, ctx) => {
        const { title, content, layer, category, sourceArtifactId } = (params ?? {}) as Record<string, unknown>;
        const item = await ctx.services.memory.create(ctx.companyId, {
          title: title as string,
          content: content as string,
          layer: layer as string,
          category: (category as string) ?? "reference",
          source: "agent",
          createdBy: ctx.userId,
          sourceContext: `Created via internal agent tool by user ${ctx.userId}`,
          ...(sourceArtifactId ? { sourceArtifactId: sourceArtifactId as string } : {}),
          status: "pending",
        });
        return { success: true, data: item, summary: `Created memory item "${title}" (pending approval)` };
      },
    },
    {
      name: "update_memory",
      description: "Update an existing memory item's content or layer.",
      parameters: {
        type: "object",
        properties: {
          memoryId: { type: "string", description: "Memory item ID (required)" },
          content: { type: "string", description: "Updated content" },
          layer: { type: "string", enum: ["identity", "domain", "active_context", "working"], description: "Updated layer" },
        },
        required: ["memoryId"],
      },
      category: "memory",
      requiredRole: "team_lead",
      requiresConfirmation: true,
      execute: async (params: unknown, ctx) => {
        const { memoryId, ...updates } = (params ?? {}) as Record<string, unknown>;
        const item = await ctx.services.memory.update(ctx.companyId, memoryId as string, updates);
        return { success: true, data: item, summary: `Updated memory item ${memoryId}` };
      },
    },
    {
      name: "find_similar_memory",
      description: "Find semantically similar memory items using vector search.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to find similar items for (required)" },
          layer: { type: "string", enum: ["identity", "domain", "active_context", "working"], description: "Filter by layer" },
          limit: { type: "number", description: "Max results (default 5)" },
        },
        required: ["query"],
      },
      category: "memory",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { query, layer, limit } = (params ?? {}) as Record<string, unknown>;
        const items = await ctx.services.memory.searchSemantic(ctx.companyId, query as string, {
          ...(layer ? { layer: layer as string } : {}),
          limit: (limit as number) ?? 5,
        });
        const count = Array.isArray(items) ? items.length : 0;
        return { success: true, data: items, summary: `Found ${count} similar memory item(s)` };
      },
    },
    {
      name: "detect_conflicts",
      description: "Check if proposed memory content conflicts with existing items.",
      parameters: {
        type: "object",
        properties: {
          proposedTitle: { type: "string", description: "Title of proposed memory item (required)" },
          proposedContent: { type: "string", description: "Content to check for conflicts (required)" },
        },
        required: ["proposedTitle", "proposedContent"],
      },
      category: "memory",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { proposedContent } = (params ?? {}) as Record<string, unknown>;
        const similar = await ctx.services.memory.findSimilarItems(proposedContent as string, {
          companyId: ctx.companyId,
        });
        const conflicts = Array.isArray(similar) ? similar.filter((s: any) => s.similarity > 0.85) : [];
        return {
          success: true,
          data: { conflicts },
          summary: conflicts.length > 0
            ? `Found ${conflicts.length} potential conflict(s)`
            : "No conflicts detected",
        };
      },
    },
  ];
}
