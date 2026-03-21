import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, goals, issues, memoryItems, projects } from "@paperclipai/db";
import type {
  MemoryItemCategory,
  MemoryItemLayer,
  SearchEntityType,
  SearchResult,
  SearchResultsGrouped,
} from "@paperclipai/shared";

const DEFAULT_ENTITY_TYPES: SearchEntityType[] = ["tasks", "goals", "agents", "memory"];
const DEFAULT_RESULTS_PER_TYPE = 5;
const SEARCH_RESULTS_PER_TYPE = 8;

export function sanitizeSearchQuery(query: string) {
  return query.replace(/[^a-zA-Z0-9\s_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function groupSearchResults(results: SearchResult[]): SearchResultsGrouped {
  return {
    tasks: results.filter((result) => result.entityType === "tasks"),
    goals: results.filter((result) => result.entityType === "goals"),
    agents: results.filter((result) => result.entityType === "agents"),
    memory: results.filter((result) => result.entityType === "memory"),
  };
}

function buildTextRank(vector: ReturnType<typeof sql>, sanitizedQuery: string) {
  return sql<number>`ts_rank(${vector}, plainto_tsquery('english', ${sanitizedQuery}))`;
}

function buildTextMatch(vector: ReturnType<typeof sql>, sanitizedQuery: string) {
  return sql`${vector} @@ plainto_tsquery('english', ${sanitizedQuery})`;
}

function trimPreview(value: string | null, maxLength = 160) {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

export function searchService(db: Db) {
  return {
    search: async (
      companyId: string,
      query: string,
      entityTypes: SearchEntityType[] = DEFAULT_ENTITY_TYPES,
    ): Promise<SearchResult[]> => {
      const sanitizedQuery = sanitizeSearchQuery(query);
      const hasQuery = sanitizedQuery.length > 0;
      const limit = hasQuery ? SEARCH_RESULTS_PER_TYPE : DEFAULT_RESULTS_PER_TYPE;
      const requested = entityTypes.length > 0 ? entityTypes : DEFAULT_ENTITY_TYPES;
      const results: SearchResult[] = [];

      if (requested.includes("tasks")) {
        const taskVector = sql`to_tsvector('english', coalesce(${issues.title}, '') || ' ' || coalesce(${issues.description}, ''))`;
        const taskRank = buildTextRank(taskVector, sanitizedQuery);
        const taskRows = await db
          .select({
            id: issues.id,
            title: issues.title,
            subtitle: issues.description,
            identifier: issues.identifier,
            status: issues.status,
            updatedAt: issues.updatedAt,
            score: hasQuery ? taskRank.as("score") : sql<number>`1`.as("score"),
          })
          .from(issues)
          .where(
            hasQuery
              ? and(eq(issues.companyId, companyId), buildTextMatch(taskVector, sanitizedQuery))
              : eq(issues.companyId, companyId),
          )
          .orderBy(hasQuery ? sql`${taskRank} desc` : desc(issues.updatedAt), desc(issues.updatedAt))
          .limit(limit);

        results.push(
          ...taskRows.map((row) => ({
            id: row.id,
            entityType: "tasks" as const,
            title: row.title,
            subtitle: trimPreview(row.subtitle),
            score: row.score,
            identifier: row.identifier,
            status: row.status,
            role: null,
            layer: null,
            category: null,
            departmentId: null,
            departmentName: null,
            updatedAt: row.updatedAt,
          })),
        );
      }

      if (requested.includes("goals")) {
        const goalVector = sql`to_tsvector('english', coalesce(${goals.title}, '') || ' ' || coalesce(${goals.description}, ''))`;
        const goalRank = buildTextRank(goalVector, sanitizedQuery);
        const goalRows = await db
          .select({
            id: goals.id,
            title: goals.title,
            subtitle: goals.description,
            status: goals.status,
            updatedAt: goals.updatedAt,
            score: hasQuery ? goalRank.as("score") : sql<number>`1`.as("score"),
          })
          .from(goals)
          .where(
            hasQuery
              ? and(eq(goals.companyId, companyId), buildTextMatch(goalVector, sanitizedQuery))
              : eq(goals.companyId, companyId),
          )
          .orderBy(hasQuery ? sql`${goalRank} desc` : desc(goals.updatedAt), desc(goals.updatedAt))
          .limit(limit);

        results.push(
          ...goalRows.map((row) => ({
            id: row.id,
            entityType: "goals" as const,
            title: row.title,
            subtitle: trimPreview(row.subtitle),
            score: row.score,
            identifier: null,
            status: row.status,
            role: null,
            layer: null,
            category: null,
            departmentId: null,
            departmentName: null,
            updatedAt: row.updatedAt,
          })),
        );
      }

      if (requested.includes("agents")) {
        const agentVector = sql`to_tsvector('english', coalesce(${agents.name}, '') || ' ' || coalesce(${agents.role}, ''))`;
        const agentRank = buildTextRank(agentVector, sanitizedQuery);
        const agentRows = await db
          .select({
            id: agents.id,
            title: agents.name,
            role: agents.role,
            status: agents.status,
            updatedAt: agents.updatedAt,
            score: hasQuery ? agentRank.as("score") : sql<number>`1`.as("score"),
          })
          .from(agents)
          .where(
            hasQuery
              ? and(eq(agents.companyId, companyId), buildTextMatch(agentVector, sanitizedQuery))
              : eq(agents.companyId, companyId),
          )
          .orderBy(hasQuery ? sql`${agentRank} desc` : desc(agents.updatedAt), desc(agents.updatedAt))
          .limit(limit);

        results.push(
          ...agentRows.map((row) => ({
            id: row.id,
            entityType: "agents" as const,
            title: row.title,
            subtitle: row.role,
            score: row.score,
            identifier: null,
            status: row.status,
            role: row.role,
            layer: null,
            category: null,
            departmentId: null,
            departmentName: null,
            updatedAt: row.updatedAt,
          })),
        );
      }

      if (requested.includes("memory")) {
        const memoryVector = sql`to_tsvector('english', coalesce(${memoryItems.title}, '') || ' ' || coalesce(${memoryItems.content}, ''))`;
        const memoryRank = buildTextRank(memoryVector, sanitizedQuery);
        const memoryRows = await db
          .select({
            id: memoryItems.id,
            title: memoryItems.title,
            subtitle: memoryItems.content,
            status: memoryItems.status,
            layer: memoryItems.layer,
            category: memoryItems.category,
            departmentId: memoryItems.departmentId,
            departmentName: projects.name,
            updatedAt: memoryItems.updatedAt,
            score: hasQuery ? memoryRank.as("score") : sql<number>`1`.as("score"),
          })
          .from(memoryItems)
          .leftJoin(projects, eq(memoryItems.departmentId, projects.id))
          .where(
            hasQuery
              ? and(eq(memoryItems.companyId, companyId), buildTextMatch(memoryVector, sanitizedQuery))
              : eq(memoryItems.companyId, companyId),
          )
          .orderBy(
            hasQuery
              ? sql`${memoryRank} desc`
              : sql`coalesce(${memoryItems.accessedAt}, ${memoryItems.updatedAt}) desc`,
            desc(memoryItems.updatedAt),
          )
          .limit(limit);

        results.push(
          ...memoryRows.map((row) => ({
            id: row.id,
            entityType: "memory" as const,
            title: row.title,
            subtitle: trimPreview(row.subtitle),
            score: row.score,
            identifier: null,
            status: row.status,
            role: null,
            layer: row.layer as MemoryItemLayer | null,
            category: row.category as MemoryItemCategory | null,
            departmentId: row.departmentId,
            departmentName: row.departmentName,
            updatedAt: row.updatedAt,
          })),
        );
      }

      return results.sort((left, right) => {
        if (left.entityType === right.entityType) {
          if (right.score !== left.score) return right.score - left.score;
          return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
        }
        return DEFAULT_ENTITY_TYPES.indexOf(left.entityType) - DEFAULT_ENTITY_TYPES.indexOf(right.entityType);
      });
    },
  };
}
