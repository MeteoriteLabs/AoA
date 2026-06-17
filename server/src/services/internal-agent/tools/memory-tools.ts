// server/src/services/internal-agent/tools/memory-tools.ts
import type { AgentTool } from "../types.js";
import { recordMemoryRetrievals } from "../../memory-retrieval-audit.js";
import { splitCommanderMemoryItems, type CommanderMemoryCandidate } from "../memory-policy.js";
import { commanderWorkingMemoryService } from "../working-memory.js";
import type { NormalizedCommanderContextScope } from "../context-scope.js";

type CommanderMemoryToolCandidate = CommanderMemoryCandidate & { similarity?: number | null };

function dedupeCandidates<T extends CommanderMemoryToolCandidate>(items: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

function toAuditItems(input: {
  shown: CommanderMemoryToolCandidate[];
  filtered: CommanderMemoryToolCandidate[];
}): Array<{ id: string; rank?: number; similarityScore: number | null; shownToAgent: boolean }> {
  return [...input.shown, ...input.filtered].map((item, index) => ({
    id: item.id,
    rank: index + 1,
    similarityScore: typeof item.similarity === "number" ? item.similarity : null,
    shownToAgent: input.shown.some((shown) => shown.id === item.id),
  }));
}

function filterQueryResults<T extends CommanderMemoryToolCandidate>(input: {
  items: T[];
  requestedLayer?: string | null;
  userId: string;
  userRole?: string | null;
  scope: Partial<NormalizedCommanderContextScope>;
}): { shown: T[]; filtered: T[] } {
  const layerCandidates = input.requestedLayer
    ? input.items.filter((item) => item.layer === input.requestedLayer)
    : input.items;
  const wrongLayer = input.requestedLayer
    ? input.items.filter((item) => item.layer !== input.requestedLayer)
    : [];
  const split = splitCommanderMemoryItems({
    items: layerCandidates,
    userId: input.userId,
    userRole: input.userRole,
    scope: input.scope,
    mode: "explicit_query",
  });
  return {
    shown: split.shown,
    filtered: [...wrongLayer, ...split.filtered],
  };
}

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

        // If query text provided, use multi-path search; otherwise use list with filters.
        if (query) {
          const items = await ctx.services.memory.searchMultiPath(ctx.companyId, query as string, {
            limit: maxResults,
          });
          const auditCandidates =
            typeof ctx.services.memory.searchAuditCandidates === "function"
              ? await ctx.services.memory.searchAuditCandidates(ctx.companyId, query as string, {
                limit: Math.max(maxResults, 50),
              })
              : [];
          const split = filterQueryResults({
            items: Array.isArray(items) ? items : [],
            requestedLayer: layer as string | undefined,
            userId: ctx.userId,
            userRole: ctx.userRole,
            scope: ctx.contextScope ?? {},
          });
          const auditSplit = filterQueryResults({
            items: dedupeCandidates([
              ...(Array.isArray(items) ? items : []),
              ...(Array.isArray(auditCandidates) ? auditCandidates : []),
            ]),
            requestedLayer: layer as string | undefined,
            userId: ctx.userId,
            userRole: ctx.userRole,
            scope: ctx.contextScope ?? {},
          });
          const shownIds = new Set(split.shown.map((item) => item.id));
          const auditItems = toAuditItems({
            shown: split.shown,
            filtered: [
              ...split.filtered,
              ...auditSplit.shown.filter((item) => !shownIds.has(item.id)),
              ...auditSplit.filtered.filter((item) => !shownIds.has(item.id)),
            ],
          });
          if (auditItems.length > 0) {
            await recordMemoryRetrievals(ctx.db, {
              companyId: ctx.companyId,
              agentId: ctx.agentId ?? null,
              runId: ctx.runId ?? null,
              taskId: ctx.contextScope?.taskId ?? null,
              // A3: conversationId lives in contextScope, not at top-level ctx
              conversationId: ctx.contextScope?.conversationId ?? null,
              triggeredBy: "commander_query",
              query: query as string,
              items: auditItems,
            });
          }
          const limited = split.shown.slice(0, maxResults);
          return { success: true, data: limited, summary: `Found ${limited.length} memory item(s)` };
        }

        const items = await ctx.services.memory.list(ctx.companyId, {
          ...(layer ? { layer: layer as string } : {}),
        });
        const split = filterQueryResults({
          items: Array.isArray(items) ? items : [],
          requestedLayer: layer as string | undefined,
          userId: ctx.userId,
          userRole: ctx.userRole,
          scope: ctx.contextScope ?? {},
        });
        const limited = split.shown.slice(0, maxResults);
        const limitedIds = new Set(limited.map((item) => item.id));
        const auditItems = toAuditItems({
          shown: limited,
          filtered: [
            ...split.shown.filter((item) => !limitedIds.has(item.id)),
            ...split.filtered,
          ],
        });
        if (auditItems.length > 0) {
          await recordMemoryRetrievals(ctx.db, {
            companyId: ctx.companyId,
            agentId: ctx.agentId ?? null,
            runId: ctx.runId ?? null,
            taskId: ctx.contextScope?.taskId ?? null,
            // A3: conversationId lives in contextScope, not at top-level ctx
            conversationId: ctx.contextScope?.conversationId ?? null,
            triggeredBy: "commander_query",
            query: null,
            items: auditItems,
          });
        }
        const count = Array.isArray(limited) ? limited.length : 0;
        return { success: true, data: limited, summary: `Found ${count} memory item(s)` };
      },
    },
    {
      name: "remember_working_context",
      description: "Remember temporary scoped Commander working context for the current project, goal, task, or conversation.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short working-memory label (required)" },
          content: { type: "string", description: "Temporary context to remember (required)" },
        },
        required: ["title", "content"],
      },
      category: "memory",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { title, content } = (params ?? {}) as Record<string, unknown>;
        const item = await commanderWorkingMemoryService(ctx.services.memory).remember({
          companyId: ctx.companyId,
          userId: ctx.userId,
          userRole: ctx.userRole,
          title: title as string,
          content: content as string,
          scope: ctx.contextScope ?? {},
        });
        return {
          success: true,
          data: item,
          summary: `Remembered working context "${item.title}" until ${item.expiresAt?.toISOString?.() ?? item.expiresAt}`,
        };
      },
    },
    {
      name: "update_working_context",
      description: "Update temporary scoped Commander working context.",
      parameters: {
        type: "object",
        properties: {
          memoryId: { type: "string", description: "Working memory ID (required)" },
          title: { type: "string", description: "Updated label" },
          content: { type: "string", description: "Updated temporary context" },
        },
        required: ["memoryId"],
      },
      category: "memory",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { memoryId, title, content } = (params ?? {}) as Record<string, unknown>;
        const item = await commanderWorkingMemoryService(ctx.services.memory).update({
          companyId: ctx.companyId,
          userId: ctx.userId,
          userRole: ctx.userRole,
          memoryId: memoryId as string,
          ...(typeof title === "string" ? { title } : {}),
          ...(typeof content === "string" ? { content } : {}),
          scope: ctx.contextScope ?? {},
        });
        return {
          success: true,
          data: item,
          summary: `Updated working context ${memoryId}`,
        };
      },
    },
    {
      name: "forget_working_context",
      description: "Archive temporary scoped Commander working context.",
      parameters: {
        type: "object",
        properties: {
          memoryId: { type: "string", description: "Working memory ID (required)" },
        },
        required: ["memoryId"],
      },
      category: "memory",
      requiredRole: "team_member",
      requiresConfirmation: false,
      execute: async (params: unknown, ctx) => {
        const { memoryId } = (params ?? {}) as Record<string, unknown>;
        const item = await commanderWorkingMemoryService(ctx.services.memory).forget({
          companyId: ctx.companyId,
          userId: ctx.userId,
          userRole: ctx.userRole,
          memoryId: memoryId as string,
          scope: ctx.contextScope ?? {},
        });
        return {
          success: true,
          data: item,
          summary: `Forgot working context ${memoryId}`,
        };
      },
    },
    {
      name: "suggest_memory",
      description: "Propose a new memory item for founder approval (status: pending).",
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
          source: "commander",
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
