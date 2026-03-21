import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  memoryItems,
  companies,
  issues,
  projects,
  goals,
  taskDependencies,
} from "@paperclipai/db";

// ── Types ───────────────────────────────────────────────────────────────

export type ContextMode = "minimal" | "standard" | "full";
export type MemoryMode = "task_context" | "sweep_context";

export interface LayeredMemoryResult {
  company: { name: string; description: string | null } | null;
  memory: Array<{ title: string; content: string; category: string; tags: string[] }>;
  layeredContext: string | null;
}

// ── Token budgets per layer by contextMode ──────────────────────────────

export const LAYER_TOKEN_BUDGETS: Record<ContextMode, Record<string, number>> = {
  minimal:  { identity: 200, domain: 300, active_context: 0, working: 0 },
  standard: { identity: 400, domain: 1000, active_context: 600, working: 500 },
  full:     { identity: 500, domain: 2000, active_context: 1500, working: 1500 },
};

// ── Pure helpers (exported for testing) ─────────────────────────────────

/** Rough token estimate: characters ÷ 4 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Format a single memory item as text */
export function formatMemoryItem(
  item: { title: string; content: string; category: string },
  annotation?: string,
): string {
  const prefix = annotation ? `${annotation} ` : "";
  return `${prefix}[${item.category}] ${item.title}: ${item.content}`;
}

/** Fill items into text until token budget is exhausted. Returns assembled text and selected item IDs. */
export function fillLayerBudget(
  items: Array<{ id: string; title: string; content: string; category: string; annotation?: string }>,
  budget: number,
): { text: string; selectedIds: string[] } {
  if (budget <= 0 || items.length === 0) return { text: "", selectedIds: [] };
  const lines: string[] = [];
  const selectedIds: string[] = [];
  let usedTokens = 0;
  for (const item of items) {
    const line = formatMemoryItem(item, item.annotation);
    const lineTokens = estimateTokens(line);
    if (usedTokens + lineTokens > budget && lines.length > 0) break;
    lines.push(line);
    selectedIds.push(item.id);
    usedTokens += lineTokens;
  }
  return { text: lines.join("\n"), selectedIds };
}

const PRECEDENCE_NOTE =
  "When context from different layers conflicts, follow the most specific layer. Working Memory > Active Context > Domain > Identity.";

// ── Service factory ─────────────────────────────────────────────────────

export function memoryContextService(db: Db) {
  /**
   * Walk dependency chain backward from an issue, detecting cycles.
   * Returns task IDs in topological order (deepest dependency first).
   */
  async function walkDependencyChain(
    companyId: string,
    issueId: string,
  ): Promise<{ chainIds: string[]; hasCycle: boolean }> {
    const visited = new Set<string>();
    const ordered: string[] = [];
    let hasCycle = false;

    async function walk(currentId: string) {
      if (visited.has(currentId)) {
        hasCycle = true;
        return;
      }
      visited.add(currentId);

      const deps = await db
        .select({ dependencyIssueId: taskDependencies.dependencyIssueId })
        .from(taskDependencies)
        .where(
          and(
            eq(taskDependencies.companyId, companyId),
            eq(taskDependencies.dependentIssueId, currentId),
          ),
        );

      for (const dep of deps) {
        if (!visited.has(dep.dependencyIssueId)) {
          await walk(dep.dependencyIssueId);
        } else if (!ordered.includes(dep.dependencyIssueId)) {
          hasCycle = true;
        }
      }

      ordered.push(currentId);
    }

    await walk(issueId);
    // Remove the original issue itself; we only want its upstream chain
    const idx = ordered.indexOf(issueId);
    if (idx !== -1) ordered.splice(idx, 1);
    return { chainIds: ordered, hasCycle };
  }

  /**
   * Resolve task hierarchy: project info, department ID, goal ID.
   */
  async function resolveTaskHierarchy(companyId: string, issueId: string) {
    const issue = await db
      .select({
        projectId: issues.projectId,
        goalId: issues.goalId,
      })
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
      .then((rows) => rows[0] ?? null);

    if (!issue) return { departmentId: null, projectId: null, goalId: null, projectName: null };

    let departmentId: string | null = null;
    let projectId: string | null = null;
    let goalId: string | null = issue.goalId;
    let projectName: string | null = null;

    if (issue.projectId) {
      const proj = await db
        .select({ id: projects.id, type: projects.type, name: projects.name, goalId: projects.goalId })
        .from(projects)
        .where(eq(projects.id, issue.projectId))
        .then((rows) => rows[0] ?? null);

      if (proj) {
        projectName = proj.name;
        if (proj.type === "department") {
          departmentId = proj.id;
        } else {
          projectId = proj.id;
        }
        if (!goalId && proj.goalId) {
          goalId = proj.goalId;
        }
      }
    }

    return { departmentId, projectId, goalId, projectName };
  }

  /**
   * Fetch layered memory context for an agent task.
   */
  async function fetchMemoryContext(
    companyId: string,
    issueId: string | null,
    mode: MemoryMode = "task_context",
    contextMode: ContextMode = "standard",
  ): Promise<LayeredMemoryResult> {
    // sweep_context: stub for future implementation
    if (mode === "sweep_context") {
      // TODO: Implement sweep_context mode in a future session
      return { company: null, memory: [], layeredContext: null };
    }

    // ── Fetch company info ──────────────────────────────────────────────
    const company = await db
      .select({
        name: companies.name,
        description: companies.description,
        vision: companies.vision,
        mission: companies.mission,
        values: companies.values,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);

    if (!issueId) {
      // No task context — return company info only (identity layer if available)
      const budgets = LAYER_TOKEN_BUDGETS[contextMode];
      const identityItems = await db
        .select({
          id: memoryItems.id,
          title: memoryItems.title,
          content: memoryItems.content,
          category: memoryItems.category,
          priority: memoryItems.priority,
        })
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.companyId, companyId),
            eq(memoryItems.layer, "identity"),
            eq(memoryItems.status, "approved"),
          ),
        )
        .orderBy(desc(memoryItems.priority), desc(memoryItems.updatedAt), desc(memoryItems.createdAt));

      const { text: identityText, selectedIds } = fillLayerBudget(
        identityItems.map((i) => ({ ...i, annotation: undefined })),
        budgets.identity,
      );

      if (selectedIds.length > 0) {
        await db
          .update(memoryItems)
          .set({ accessedAt: new Date() })
          .where(inArray(memoryItems.id, selectedIds));
      }

      const sections: string[] = [];
      if (identityText) sections.push(`=== IDENTITY ===\n${identityText}`);

      return {
        company: company ? { name: company.name, description: company.description } : null,
        memory: identityItems.slice(0, 10).map((item) => ({
          title: item.title,
          content: item.content,
          category: item.category,
          tags: [] as string[],
        })),
        layeredContext: sections.length > 0
          ? sections.join("\n\n") + `\n\n${PRECEDENCE_NOTE}`
          : null,
      };
    }

    // ── Resolve task hierarchy ──────────────────────────────────────────
    const hierarchy = await resolveTaskHierarchy(companyId, issueId);

    const isUnscoped = !hierarchy.departmentId && !hierarchy.projectId;

    // ── Resolve dependency chain ────────────────────────────────────────
    const { chainIds: depChainIds, hasCycle } = await walkDependencyChain(companyId, issueId);

    // ── Fetch dependency task statuses for cancelled annotation ─────────
    let depStatusMap = new Map<string, string>();
    if (depChainIds.length > 0) {
      const depStatuses = await db
        .select({ id: issues.id, status: issues.status })
        .from(issues)
        .where(inArray(issues.id, depChainIds));
      depStatusMap = new Map(depStatuses.map((d) => [d.id, d.status]));
    }

    // ── Resolve goal name for section header ────────────────────────────
    let goalName: string | null = null;
    if (hierarchy.goalId) {
      goalName = await db
        .select({ title: goals.title })
        .from(goals)
        .where(eq(goals.id, hierarchy.goalId))
        .then((rows) => rows[0]?.title ?? null);
    }

    const budgets = LAYER_TOKEN_BUDGETS[contextMode];
    const allSelectedIds: string[] = [];

    // ── 1. Identity layer (always included) ─────────────────────────────
    const identityItems = await db
      .select({
        id: memoryItems.id,
        title: memoryItems.title,
        content: memoryItems.content,
        category: memoryItems.category,
        priority: memoryItems.priority,
      })
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.companyId, companyId),
          eq(memoryItems.layer, "identity"),
          eq(memoryItems.status, "approved"),
        ),
      )
      .orderBy(desc(memoryItems.priority), desc(memoryItems.updatedAt), desc(memoryItems.createdAt));

    const { text: identityText, selectedIds: identityIds } = fillLayerBudget(
      identityItems.map((i) => ({ ...i, annotation: undefined })),
      budgets.identity,
    );
    allSelectedIds.push(...identityIds);

    // ── 2. Domain layer (department/project scoped) ─────────────────────
    let domainText = "";
    if (budgets.domain > 0 && !isUnscoped) {
      const scopeConditions = [];
      if (hierarchy.departmentId) scopeConditions.push(eq(memoryItems.departmentId, hierarchy.departmentId));
      if (hierarchy.projectId) scopeConditions.push(eq(memoryItems.projectId, hierarchy.projectId));

      const scopedItems = await db
        .select({
          id: memoryItems.id,
          title: memoryItems.title,
          content: memoryItems.content,
          category: memoryItems.category,
          priority: memoryItems.priority,
          visibility: memoryItems.visibility,
        })
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.companyId, companyId),
            eq(memoryItems.layer, "domain"),
            eq(memoryItems.status, "approved"),
            or(...scopeConditions),
          ),
        )
        .orderBy(desc(memoryItems.priority), desc(memoryItems.updatedAt), desc(memoryItems.createdAt));

      const scopedIds = new Set(scopedItems.map((i) => i.id));

      // Shared items from other departments (lower priority)
      const sharedItems = await db
        .select({
          id: memoryItems.id,
          title: memoryItems.title,
          content: memoryItems.content,
          category: memoryItems.category,
          priority: memoryItems.priority,
          visibility: memoryItems.visibility,
        })
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.companyId, companyId),
            eq(memoryItems.layer, "domain"),
            eq(memoryItems.status, "approved"),
            eq(memoryItems.visibility, "shared"),
          ),
        )
        .orderBy(desc(memoryItems.priority), desc(memoryItems.updatedAt), desc(memoryItems.createdAt));

      // Deduplicate: prefer scoped items over shared
      const deduplicatedShared = sharedItems.filter((s) => !scopedIds.has(s.id));

      const combined = [
        ...scopedItems.map((i) => ({ ...i, annotation: undefined })),
        ...deduplicatedShared.map((i) => ({ ...i, annotation: undefined })),
      ];

      const { text, selectedIds: domainIds } = fillLayerBudget(combined, budgets.domain);
      domainText = text;
      allSelectedIds.push(...domainIds);
    }

    // ── 3. Active Context layer (goal-scoped, respects expiresAt) ───────
    let activeContextText = "";
    if (budgets.active_context > 0 && hierarchy.goalId) {
      const now = new Date();
      const activeItems = await db
        .select({
          id: memoryItems.id,
          title: memoryItems.title,
          content: memoryItems.content,
          category: memoryItems.category,
          priority: memoryItems.priority,
        })
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.companyId, companyId),
            eq(memoryItems.layer, "active_context"),
            eq(memoryItems.status, "approved"),
            eq(memoryItems.goalId, hierarchy.goalId),
            or(
              isNull(memoryItems.expiresAt),
              gt(memoryItems.expiresAt, now),
            ),
          ),
        )
        .orderBy(desc(memoryItems.priority), desc(memoryItems.updatedAt), desc(memoryItems.createdAt));

      const { text, selectedIds: activeIds } = fillLayerBudget(
        activeItems.map((i) => ({ ...i, annotation: undefined })),
        budgets.active_context,
      );
      activeContextText = text;
      allSelectedIds.push(...activeIds);
    }

    // ── 4. Working Memory layer (dependency chain scoped) ───────────────
    let workingText = "";
    if (budgets.working > 0 && depChainIds.length > 0) {
      const workingItems = await db
        .select({
          id: memoryItems.id,
          title: memoryItems.title,
          content: memoryItems.content,
          category: memoryItems.category,
          priority: memoryItems.priority,
          taskId: memoryItems.taskId,
        })
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.companyId, companyId),
            eq(memoryItems.layer, "working"),
            eq(memoryItems.status, "approved"),
            inArray(memoryItems.taskId, depChainIds),
          ),
        )
        .orderBy(desc(memoryItems.priority), desc(memoryItems.updatedAt), desc(memoryItems.createdAt));

      // Sort by dependency chain topological order, then by priority/recency within each task
      const chainOrder = new Map(depChainIds.map((id, idx) => [id, idx]));
      workingItems.sort((a, b) => {
        const orderA = chainOrder.get(a.taskId!) ?? Infinity;
        const orderB = chainOrder.get(b.taskId!) ?? Infinity;
        if (orderA !== orderB) return orderA - orderB;
        return 0;
      });

      // Annotate cancelled task working memory
      const annotated = workingItems.map((item) => ({
        ...item,
        annotation: item.taskId && depStatusMap.get(item.taskId) === "cancelled"
          ? "[from cancelled task]"
          : undefined,
      }));

      const { text, selectedIds: workingIds } = fillLayerBudget(annotated, budgets.working);
      workingText = text;
      allSelectedIds.push(...workingIds);
    }

    // ── Batch update accessedAt ─────────────────────────────────────────
    if (allSelectedIds.length > 0) {
      await db
        .update(memoryItems)
        .set({ accessedAt: new Date() })
        .where(inArray(memoryItems.id, allSelectedIds));
    }

    // ── Assemble layered context with headers ───────────────────────────
    const sections: string[] = [];
    if (identityText) sections.push(`=== IDENTITY ===\n${identityText}`);
    if (domainText) {
      const deptLabel = hierarchy.projectName ?? "Unknown";
      sections.push(`=== DOMAIN: ${deptLabel} ===\n${domainText}`);
    }
    if (activeContextText) {
      const goalLabel = goalName ?? "Unknown";
      sections.push(`=== ACTIVE CONTEXT: ${goalLabel} ===\n${activeContextText}`);
    }
    if (workingText) sections.push(`=== WORKING MEMORY ===\n${workingText}`);

    const layeredContext = sections.length > 0
      ? sections.join("\n\n") + `\n\n${PRECEDENCE_NOTE}`
      : null;

    return {
      company: company ? { name: company.name, description: company.description } : null,
      memory: identityItems.slice(0, 10).map((item) => ({
        title: item.title,
        content: item.content,
        category: item.category,
        tags: [] as string[],
      })),
      layeredContext,
    };
  }

  return {
    fetchMemoryContext,
    walkDependencyChain,
    resolveTaskHierarchy,
  };
}
