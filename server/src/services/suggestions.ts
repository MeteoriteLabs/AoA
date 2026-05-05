import { and, desc, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companies,
  goals,
  issues,
  memoryFeedbackPatterns,
  memoryItems,
  projects,
  suggestions,
} from "@paperclipai/db";
import {
  MEMORY_ITEM_CATEGORIES,
  MEMORY_ITEM_LAYERS,
  SUGGESTION_CATEGORIES,
  SUGGESTION_STATUSES,
  type SuggestionCategory,
} from "@paperclipai/shared";
import { z } from "zod";
import { badRequest, notFound } from "../errors.js";
import { issueService } from "./issues.js";
import { memoryFeedbackService } from "./memory-feedback.js";
import { memoryService } from "./memory.js";

const SUGGESTION_TTL_DAYS = 30;
const BLOCKED_TASK_DAYS = 3;
const STALE_MEMORY_DAYS = 90;
const RECURRING_WORK_THRESHOLD = 3;
const OVERLOADED_AGENT_TASKS = 5;
const WORKLOAD_IMBALANCE_THRESHOLD = 3;
const STALLED_GOAL_DAYS = 14;

type SuggestionInsert = Omit<typeof suggestions.$inferInsert, "companyId" | "status" | "createdAt" | "updatedAt">;
type SuggestionRecord = typeof suggestions.$inferSelect;
type SuggestionFilters = {
  category?: string;
  status?: string;
};
type SuggestionExecutionResult = {
  actionType: string;
  entityType?: string;
  entityId?: string;
  note?: string;
};

const createTaskActionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  assigneeAgentId: z.string().uuid().optional().nullable(),
  assigneeUserId: z.string().optional().nullable(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  status: z.enum(["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"]).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  source: z.enum(["manual", "brief", "agent_proposal", "mcp"]).optional().nullable(),
  labelIds: z.array(z.string().uuid()).optional(),
});

const flagRiskActionSchema = z.object({
  goalId: z.string().uuid(),
});

const suggestMemoryActionSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.enum(MEMORY_ITEM_CATEGORIES),
  layer: z.enum(MEMORY_ITEM_LAYERS).optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  taskId: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).optional(),
  priority: z.number().int().optional(),
  visibility: z.enum(["scoped", "shared"]).optional(),
  sourceContext: z.string().optional().nullable(),
});

const archiveMemoryActionSchema = z.object({
  memoryItemId: z.string().uuid(),
});

const mergeMemoryActionSchema = z.object({
  memoryItemIds: z.array(z.string().uuid()).min(2),
});

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeTaskTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\b\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMemoryTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function daysBetween(earlier: Date | null | undefined, later: Date): number {
  if (!earlier) return 0;
  return Math.floor((later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000));
}

function buildPatternSuggestionTitle(patternType: string, occurrenceCount: number, agentName: string | null) {
  const agent = agentName ?? "an agent";
  switch (patternType) {
    case "tone_correction":
      return `You've corrected ${agent}'s tone ${occurrenceCount} times — create a preference item?`;
    case "format_change":
      return `${agent}'s format has been adjusted ${occurrenceCount} times — create a template memory item?`;
    case "content_addition":
      return `${agent} missed required content ${occurrenceCount} times — create a checklist item?`;
    case "terminology_change":
      return `${agent}'s terminology has been corrected ${occurrenceCount} times — create a glossary entry?`;
    default:
      return `Recurring feedback pattern detected for ${agent} — create a memory item?`;
  }
}

function buildPatternSuggestedContent(patternType: string) {
  switch (patternType) {
    case "tone_correction":
      return "Use the founder's preferred tone consistently in outward-facing communication.";
    case "format_change":
      return "Follow the founder's preferred response structure and formatting pattern.";
    case "content_addition":
      return "Include the content the founder repeatedly adds during review before sending final work.";
    case "terminology_change":
      return "Use the founder's preferred terminology and naming consistently.";
    default:
      return "Capture the recurring review correction as a reusable preference.";
  }
}

function rankByPriority() {
  return sql`
    case
      when ${suggestions.category} = 'risk_flag' then 1
      when ${suggestions.category} = 'pipeline_bottleneck' then 2
      when ${suggestions.category} = 'goal_gap' then 3
      when ${suggestions.category} = 'memory_gap' then 4
      when ${suggestions.category} = 'budget_optimization' then 5
      when ${suggestions.category} = 'workload_balance' then 6
      when ${suggestions.category} = 'recurring_work' then 7
      when ${suggestions.category} = 'pattern_detected' then 8
      else 9
    end
  `;
}

async function expireOldPendingSuggestions(db: Db, companyId: string) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - SUGGESTION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db
    .update(suggestions)
    .set({
      status: "expired",
      updatedAt: now,
    })
    .where(
      and(
        eq(suggestions.companyId, companyId),
        eq(suggestions.status, "pending"),
        or(
          sql`${suggestions.createdAt} < ${cutoff.toISOString()}`,
          sql`${suggestions.expiresAt} < ${now.toISOString()}`,
        ),
      ),
    );
}

export function suggestionService(db: Db) {
  const issuesSvc = issueService(db);
  const feedbackSvc = memoryFeedbackService(db);
  const memorySvc = memoryService(db);

  const service = {
    async detectGoalGaps(companyId: string): Promise<SuggestionInsert[]> {
      const [goalRows, issueRows] = await Promise.all([
        db
          .select({
            id: goals.id,
            title: goals.title,
            status: goals.status,
            updatedAt: goals.updatedAt,
          })
          .from(goals)
          .where(and(eq(goals.companyId, companyId), notInArray(goals.status, ["achieved", "cancelled"]))),
        db
          .select({
            goalId: issues.goalId,
            status: issues.status,
          })
          .from(issues)
          .where(and(eq(issues.companyId, companyId), sql`${issues.goalId} is not null`)),
      ]);

      if (goalRows.length === 0) return [];

      const counts = new Map<string, { total: number; open: number; inProgress: number }>();
      for (const row of issueRows) {
        if (!row.goalId) continue;
        const current = counts.get(row.goalId) ?? { total: 0, open: 0, inProgress: 0 };
        current.total += 1;
        if (!["done", "cancelled"].includes(row.status)) current.open += 1;
        if (row.status === "in_progress") current.inProgress += 1;
        counts.set(row.goalId, current);
      }

      const now = new Date();
      const detected: SuggestionInsert[] = [];
      for (const goal of goalRows) {
        const count = counts.get(goal.id) ?? { total: 0, open: 0, inProgress: 0 };
        if (count.total === 0) {
          detected.push({
            category: "goal_gap",
            actionType: "create_task",
            title: `Goal "${goal.title}" has no tasks yet`,
            evidence: "No tasks are linked to this active goal.",
            actionPayload: {
              title: `Kick off work for goal: ${goal.title}`,
              description: `Create the first execution task for goal "${goal.title}".`,
              goalId: goal.id,
              priority: "high",
              status: "backlog",
              source: "manual",
            },
            expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
          });
          continue;
        }

        if (goal.status === "active" && count.open > 0 && count.inProgress === 0 && daysBetween(goal.updatedAt, now) >= STALLED_GOAL_DAYS) {
          detected.push({
            category: "goal_gap",
            actionType: "create_task",
            title: `Goal "${goal.title}" looks stalled`,
            evidence: `The goal has ${count.open} open task(s) but none are in progress, and the goal has not changed for ${daysBetween(goal.updatedAt, now)} days.`,
            actionPayload: {
              title: `Unblock stalled goal: ${goal.title}`,
              description: `Review why goal "${goal.title}" is stalled and define the next concrete step.`,
              goalId: goal.id,
              priority: "high",
              status: "backlog",
              source: "manual",
            },
            expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
          });
        }
      }

      return detected;
    },

    async detectPipelineBottlenecks(companyId: string): Promise<SuggestionInsert[]> {
      const [blockedIssues, openAssignments, agentRows] = await Promise.all([
        db
          .select({
            id: issues.id,
            title: issues.title,
            goalId: issues.goalId,
            projectId: issues.projectId,
            updatedAt: issues.updatedAt,
          })
          .from(issues)
          .where(and(eq(issues.companyId, companyId), eq(issues.status, "blocked"))),
        db
          .select({
            assigneeAgentId: issues.assigneeAgentId,
            count: sql<number>`count(*)`,
          })
          .from(issues)
          .where(
            and(
              eq(issues.companyId, companyId),
              sql`${issues.assigneeAgentId} is not null`,
              notInArray(issues.status, ["done", "cancelled"]),
            ),
          )
          .groupBy(issues.assigneeAgentId),
        db
          .select({ id: agents.id, name: agents.name })
          .from(agents)
          .where(eq(agents.companyId, companyId)),
      ]);

      const now = new Date();
      const agentNameById = new Map(agentRows.map((agent) => [agent.id, agent.name]));
      const detected: SuggestionInsert[] = [];

      for (const issue of blockedIssues) {
        const blockedDays = daysBetween(issue.updatedAt, now);
        if (blockedDays < BLOCKED_TASK_DAYS) continue;
        detected.push({
          category: "pipeline_bottleneck",
          actionType: "create_task",
          title: `Task "${issue.title}" has been blocked for ${blockedDays} days`,
          evidence: `The task has stayed blocked since ${issue.updatedAt.toISOString()}.`,
          actionPayload: {
            title: `Resolve bottleneck for: ${issue.title}`,
            description: `Investigate why "${issue.title}" is blocked and define the unblock step.`,
            goalId: issue.goalId,
            projectId: issue.projectId,
            priority: "high",
            status: "backlog",
            source: "manual",
          },
          expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
        });
      }

      for (const assignment of openAssignments) {
        if (!assignment.assigneeAgentId || Number(assignment.count) < OVERLOADED_AGENT_TASKS) continue;
        const agentName = agentNameById.get(assignment.assigneeAgentId) ?? "This agent";
        detected.push({
          category: "pipeline_bottleneck",
          actionType: "create_task",
          title: `${agentName} is carrying ${Number(assignment.count)} open tasks`,
          evidence: "High active workload on one agent can slow the pipeline.",
          actionPayload: {
            title: `Rebalance ${agentName}'s task load`,
            description: `${agentName} has ${Number(assignment.count)} open tasks. Review reassignment or sequencing.`,
            priority: "medium",
            status: "backlog",
            source: "manual",
          },
          expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
        });
      }

      return detected;
    },

    async detectMemoryGaps(companyId: string): Promise<SuggestionInsert[]> {
      const staleCutoff = new Date(Date.now() - STALE_MEMORY_DAYS * 24 * 60 * 60 * 1000);
      const [departmentRows, approvedDomainRows, approvedIdentityRows, staleRows, approvedMemoryRows] = await Promise.all([
        db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(and(eq(projects.companyId, companyId), eq(projects.type, "department"), sql`${projects.archivedAt} is null`)),
        db
          .select({ departmentId: memoryItems.departmentId })
          .from(memoryItems)
          .where(
            and(
              eq(memoryItems.companyId, companyId),
              eq(memoryItems.status, "approved"),
              eq(memoryItems.layer, "domain"),
              sql`${memoryItems.departmentId} is not null`,
            ),
          ),
        db
          .select({ id: memoryItems.id })
          .from(memoryItems)
          .where(and(eq(memoryItems.companyId, companyId), eq(memoryItems.status, "approved"), eq(memoryItems.layer, "identity"))),
        db
          .select({
            id: memoryItems.id,
            title: memoryItems.title,
            layer: memoryItems.layer,
            accessedAt: memoryItems.accessedAt,
          })
          .from(memoryItems)
          .where(
            and(
              eq(memoryItems.companyId, companyId),
              eq(memoryItems.status, "approved"),
              inArray(memoryItems.layer, ["identity", "domain"]),
              or(sql`${memoryItems.accessedAt} < ${staleCutoff.toISOString()}`, isNull(memoryItems.accessedAt)),
            ),
          ),
        db
          .select({
            id: memoryItems.id,
            title: memoryItems.title,
            content: memoryItems.content,
            departmentId: memoryItems.departmentId,
          })
          .from(memoryItems)
          .where(
            and(
              eq(memoryItems.companyId, companyId),
              eq(memoryItems.status, "approved"),
              eq(memoryItems.layer, "domain"),
            ),
          ),
      ]);

      const now = new Date();
      const detected: SuggestionInsert[] = [];
      const departmentsWithDomainMemory = new Set(approvedDomainRows.map((row) => row.departmentId).filter(Boolean));

      if (approvedIdentityRows.length === 0) {
        detected.push({
          category: "memory_gap",
          actionType: "suggest_memory",
          title: "No identity memory exists yet",
          evidence: "Agents do not have durable identity guidance such as vision, mission, or company values.",
          actionPayload: {
            title: "Company identity guidelines",
            content: "Capture the core company identity guidance that every agent should receive.",
            category: "reference",
            layer: "identity",
            tags: ["identity"],
            sourceContext: "Generated from suggestion engine due to missing identity memory.",
          },
          expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
        });
      }

      for (const department of departmentRows) {
        if (departmentsWithDomainMemory.has(department.id)) continue;
        detected.push({
          category: "memory_gap",
          actionType: "suggest_memory",
          title: `No domain memory exists for ${department.name}`,
          evidence: `Department "${department.name}" has no approved domain-layer memory items.`,
          actionPayload: {
            title: `${department.name} operating guidelines`,
            content: `Document how ${department.name} should work so agents have reusable guidance.`,
            category: "reference",
            layer: "domain",
            departmentId: department.id,
            tags: ["guidelines"],
            sourceContext: `Generated because ${department.name} has no domain memory.`,
          },
          expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
        });
      }

      for (const stale of staleRows) {
        const daysUnused = stale.accessedAt ? daysBetween(stale.accessedAt, now) : STALE_MEMORY_DAYS;
        detected.push({
          category: "memory_gap",
          actionType: "archive_memory",
          title: `Memory item "${stale.title}" has not been accessed in ${daysUnused}+ days`,
          evidence: stale.accessedAt
            ? `Last accessed ${stale.accessedAt.toISOString()}.`
            : "This item has never been accessed.",
          relatedMemoryItemId: stale.id,
          actionPayload: {
            memoryItemId: stale.id,
          },
          expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
        });
      }

      const conflicts = new Map<string, { ids: string[]; contents: Set<string> }>();
      for (const item of approvedMemoryRows) {
        const key = `${item.departmentId ?? "company"}:${normalizeMemoryTitle(item.title)}`;
        const current = conflicts.get(key) ?? { ids: [], contents: new Set<string>() };
        current.ids.push(item.id);
        current.contents.add(item.content.trim());
        conflicts.set(key, current);
      }

      for (const conflict of conflicts.values()) {
        if (conflict.ids.length < 2 || conflict.contents.size < 2) continue;
        detected.push({
          category: "memory_gap",
          actionType: "merge_memory",
          title: "Two memory items may conflict and need review",
          evidence: `Potential overlap across ${conflict.ids.length} domain memory items with the same title pattern.`,
          actionPayload: {
            memoryItemIds: conflict.ids,
          },
          expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
        });
      }

      return detected;
    },

    async detectPatternDetected(companyId: string): Promise<SuggestionInsert[]> {
      const [patternRows, agentRows] = await Promise.all([
        db
          .select({
            id: memoryFeedbackPatterns.id,
            patternType: memoryFeedbackPatterns.patternType,
            occurrenceCount: memoryFeedbackPatterns.occurrenceCount,
            sourceAgentId: memoryFeedbackPatterns.sourceAgentId,
          })
          .from(memoryFeedbackPatterns)
          .where(
            and(
              eq(memoryFeedbackPatterns.companyId, companyId),
              sql`${memoryFeedbackPatterns.occurrenceCount} >= 3`,
              notInArray(memoryFeedbackPatterns.status, ["dismissed", "accepted"]),
            ),
          ),
        db
          .select({ id: agents.id, name: agents.name })
          .from(agents)
          .where(eq(agents.companyId, companyId)),
      ]);

      if (patternRows.length === 0) return [];

      const agentNameById = new Map(agentRows.map((agent) => [agent.id, agent.name]));
      const now = new Date();

      return patternRows.map((pattern) => ({
        category: "pattern_detected",
        actionType: "suggest_memory",
        title: buildPatternSuggestionTitle(
          pattern.patternType,
          pattern.occurrenceCount,
          pattern.sourceAgentId ? agentNameById.get(pattern.sourceAgentId) ?? null : null,
        ),
        evidence: `Pattern "${pattern.patternType}" occurred ${pattern.occurrenceCount} times.`,
        actionPayload: {
          title: `Preference from ${pattern.patternType.replace(/_/g, " ")}`,
          content: buildPatternSuggestedContent(pattern.patternType),
          category: "preference",
          layer: "domain",
          tags: ["feedback-pattern"],
          sourceContext: `Generated from feedback pattern ${pattern.id}.`,
          patternId: pattern.id,
          patternType: pattern.patternType,
        },
        expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
      }));
    },

    async detectBudgetOptimization(companyId: string): Promise<SuggestionInsert[]> {
      const [companyRow, agentRows] = await Promise.all([
        db
          .select({
            budgetMonthlyCents: companies.budgetMonthlyCents,
            spentMonthlyCents: companies.spentMonthlyCents,
          })
          .from(companies)
          .where(eq(companies.id, companyId))
          .then((rows) => rows[0] ?? null),
        db
          .select({
            id: agents.id,
            name: agents.name,
            budgetMonthlyCents: agents.budgetMonthlyCents,
            spentMonthlyCents: agents.spentMonthlyCents,
            lastHeartbeatAt: agents.lastHeartbeatAt,
          })
          .from(agents)
          .where(eq(agents.companyId, companyId)),
      ]);

      const now = new Date();
      const detected: SuggestionInsert[] = [];

      if (companyRow && companyRow.budgetMonthlyCents > 0 && companyRow.spentMonthlyCents >= companyRow.budgetMonthlyCents * 0.9) {
        detected.push({
          category: "budget_optimization",
          actionType: "create_task",
          title: "Monthly company budget is nearly exhausted",
          evidence: `Spend is ${companyRow.spentMonthlyCents} cents against a ${companyRow.budgetMonthlyCents}-cent monthly budget.`,
          actionPayload: {
            title: "Review monthly company budget usage",
            description: "Assess budget burn and reduce or reprioritize expensive work.",
            priority: "high",
            status: "backlog",
            source: "manual",
          },
          expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
        });
      }

      for (const agent of agentRows) {
        if (agent.budgetMonthlyCents > 0 && agent.spentMonthlyCents > agent.budgetMonthlyCents) {
          detected.push({
            category: "budget_optimization",
            actionType: "create_task",
            title: `${agent.name} is over budget`,
            evidence: `${agent.name} has spent ${agent.spentMonthlyCents} cents against a ${agent.budgetMonthlyCents}-cent budget.`,
            actionPayload: {
              title: `Review ${agent.name}'s budget`,
              description: `Adjust work allocation or budget for ${agent.name}.`,
              priority: "high",
              status: "backlog",
              source: "manual",
            },
            expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
          });
          continue;
        }

        const heartbeatAge = daysBetween(agent.lastHeartbeatAt, now);
        if (agent.budgetMonthlyCents > 0 && agent.spentMonthlyCents <= agent.budgetMonthlyCents * 0.2 && heartbeatAge >= 14) {
          detected.push({
            category: "budget_optimization",
            actionType: "create_task",
            title: `${agent.name} appears underutilized`,
            evidence: `${agent.name} has used only ${agent.spentMonthlyCents} cents of budget and has been quiet for ${heartbeatAge} days.`,
            actionPayload: {
              title: `Re-evaluate ${agent.name}'s budget allocation`,
              description: `Decide whether to shift budget away from ${agent.name} or assign more useful work.`,
              priority: "medium",
              status: "backlog",
              source: "manual",
            },
            expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
          });
        }
      }

      return detected;
    },

    async detectRecurringWork(companyId: string): Promise<SuggestionInsert[]> {
      const recentCutoff = new Date(Date.now() - SUGGESTION_TTL_DAYS * 24 * 60 * 60 * 1000);
      const recentIssues = await db
        .select({
          title: issues.title,
          projectId: issues.projectId,
          goalId: issues.goalId,
        })
        .from(issues)
        .where(and(eq(issues.companyId, companyId), sql`${issues.createdAt} >= ${recentCutoff.toISOString()}`));

      if (recentIssues.length === 0) return [];

      const grouped = new Map<string, { count: number; sample: typeof recentIssues[number] }>();
      for (const issue of recentIssues) {
        const key = normalizeTaskTitle(issue.title);
        if (!key) continue;
        const current = grouped.get(key) ?? { count: 0, sample: issue };
        current.count += 1;
        grouped.set(key, current);
      }

      const now = new Date();
      const detected: SuggestionInsert[] = [];
      for (const [key, group] of grouped) {
        if (group.count < RECURRING_WORK_THRESHOLD) continue;
        detected.push({
          category: "recurring_work",
          actionType: "create_task",
          title: `Similar task "${group.sample.title}" was created ${group.count} times recently`,
          evidence: `Repeated task signature: "${key}".`,
          actionPayload: {
            title: `Standardize recurring work: ${group.sample.title}`,
            description: `This task pattern appeared ${group.count} times in the last 30 days. Consider a checklist, memory item, or automation.`,
            goalId: group.sample.goalId,
            projectId: group.sample.projectId,
            priority: "medium",
            status: "backlog",
            source: "manual",
          },
          expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
        });
      }

      return detected;
    },

    async detectRiskFlags(companyId: string): Promise<SuggestionInsert[]> {
      const now = new Date();
      const overdueIssues = await db
        .select({
          title: issues.title,
          goalId: issues.goalId,
          projectId: issues.projectId,
          dueDate: issues.dueDate,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            notInArray(issues.status, ["done", "cancelled"]),
            sql`${issues.dueDate} is not null`,
            sql`${issues.dueDate} < ${now.toISOString()}`,
          ),
        );

      if (overdueIssues.length === 0) return [];

      const flaggedGoals = new Set<string>();
      const detected: SuggestionInsert[] = [];

      for (const issue of overdueIssues) {
        if (issue.goalId && !flaggedGoals.has(issue.goalId)) {
          flaggedGoals.add(issue.goalId);
          detected.push({
            category: "risk_flag",
            actionType: "flag_risk",
            title: `Goal linked to overdue task "${issue.title}" should be marked at risk`,
            evidence: `Task due ${issue.dueDate?.toISOString() ?? "unknown"} is overdue.`,
            actionPayload: {
              goalId: issue.goalId,
            },
            expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
          });
          continue;
        }

        detected.push({
          category: "risk_flag",
          actionType: "create_task",
          title: `Task "${issue.title}" is overdue`,
          evidence: `The due date ${issue.dueDate?.toISOString() ?? "unknown"} has passed.`,
          actionPayload: {
            title: `Review overdue task: ${issue.title}`,
            description: `The task "${issue.title}" is overdue and needs intervention.`,
            projectId: issue.projectId,
            priority: "high",
            status: "backlog",
            source: "manual",
          },
          expiresAt: addDays(now, SUGGESTION_TTL_DAYS),
        });
      }

      return detected;
    },

    async detectWorkloadBalance(companyId: string): Promise<SuggestionInsert[]> {
      const [assignmentRows, agentRows] = await Promise.all([
        db
          .select({
            assigneeAgentId: issues.assigneeAgentId,
            count: sql<number>`count(*)`,
          })
          .from(issues)
          .where(
            and(
              eq(issues.companyId, companyId),
              sql`${issues.assigneeAgentId} is not null`,
              notInArray(issues.status, ["done", "cancelled"]),
            ),
          )
          .groupBy(issues.assigneeAgentId),
        db
          .select({ id: agents.id, name: agents.name })
          .from(agents)
          .where(eq(agents.companyId, companyId)),
      ]);

      if (assignmentRows.length < 2) return [];

      const agentNameById = new Map(agentRows.map((agent) => [agent.id, agent.name]));
      const sorted = assignmentRows
        .filter((row) => row.assigneeAgentId)
        .map((row) => ({
          agentId: row.assigneeAgentId as string,
          count: Number(row.count),
        }))
        .sort((a, b) => b.count - a.count);

      if (sorted.length < 2) return [];

      const max = sorted[0];
      const min = sorted[sorted.length - 1];
      if (max.count < OVERLOADED_AGENT_TASKS || max.count - min.count < WORKLOAD_IMBALANCE_THRESHOLD) {
        return [];
      }

      return [
        {
          category: "workload_balance",
          actionType: "create_task",
          title: "Workload is uneven across agents",
          evidence: `${agentNameById.get(max.agentId) ?? "One agent"} has ${max.count} open tasks while ${agentNameById.get(min.agentId) ?? "another"} has ${min.count}.`,
          actionPayload: {
            title: "Review workload balance across agents",
            description: `Redistribute work from ${agentNameById.get(max.agentId) ?? "the busiest agent"} to underloaded teammates.`,
            priority: "medium",
            status: "backlog",
            source: "manual",
          },
          expiresAt: addDays(new Date(), SUGGESTION_TTL_DAYS),
        },
      ];
    },

    list(companyId: string, filters: SuggestionFilters = {}) {
      const conditions = [eq(suggestions.companyId, companyId)];
      if (filters.category && SUGGESTION_CATEGORIES.includes(filters.category as SuggestionCategory)) {
        conditions.push(eq(suggestions.category, filters.category));
      }
      if (filters.status && SUGGESTION_STATUSES.includes(filters.status as typeof SUGGESTION_STATUSES[number])) {
        conditions.push(eq(suggestions.status, filters.status));
      }

      return db
        .select()
        .from(suggestions)
        .where(and(...conditions))
        .orderBy(rankByPriority(), desc(suggestions.createdAt));
    },

    listPending(companyId: string) {
      return db
        .select()
        .from(suggestions)
        .where(and(eq(suggestions.companyId, companyId), eq(suggestions.status, "pending")))
        .orderBy(rankByPriority(), desc(suggestions.createdAt));
    },

    async runAllDetectors(companyId: string) {
      await expireOldPendingSuggestions(db, companyId);
      await feedbackSvc.runAllDetectors(companyId);

      const existingPending = await db
        .select({
          category: suggestions.category,
          actionPayload: suggestions.actionPayload,
        })
        .from(suggestions)
        .where(and(eq(suggestions.companyId, companyId), eq(suggestions.status, "pending")));

      const existingKeys = new Set(
        existingPending.map((suggestion) => `${suggestion.category}:${stableStringify(suggestion.actionPayload ?? null)}`),
      );

      const detectorResults = await Promise.all([
        service.detectGoalGaps(companyId),
        service.detectPipelineBottlenecks(companyId),
        service.detectMemoryGaps(companyId),
        service.detectPatternDetected(companyId),
        service.detectBudgetOptimization(companyId),
        service.detectRecurringWork(companyId),
        service.detectRiskFlags(companyId),
        service.detectWorkloadBalance(companyId),
      ]);

      const detected = detectorResults.flat();
      const toInsert = detected.filter((suggestion) => {
        const key = `${suggestion.category}:${stableStringify(suggestion.actionPayload ?? null)}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });

      if (toInsert.length > 0) {
        await db.insert(suggestions).values(
          toInsert.map((suggestion) => ({
            ...suggestion,
            companyId,
            status: "pending",
          })),
        );
      }

      return {
        detected: detected.length,
        created: toInsert.length,
      };
    },

    async accept(companyId: string, id: string) {
      return db.transaction(async (tx) => {
        const suggestion = await tx
          .select()
          .from(suggestions)
          .where(and(eq(suggestions.companyId, companyId), eq(suggestions.id, id)))
          .then((rows: Array<typeof suggestions.$inferSelect>) => rows[0] ?? null);

        if (!suggestion) {
          throw notFound("Suggestion not found");
        }
        if (suggestion.status !== "pending") {
          throw badRequest("Only pending suggestions can be accepted");
        }

        const execution = await executeAction(tx as any, companyId, suggestion);
        const updated = await tx
          .update(suggestions)
          .set({
            status: "accepted",
            updatedAt: new Date(),
          })
          .where(eq(suggestions.id, suggestion.id))
          .returning()
          .then((rows: Array<typeof suggestions.$inferSelect>) => rows[0]);

        const patternId =
          suggestion.category === "pattern_detected" &&
          suggestion.actionPayload &&
          typeof suggestion.actionPayload.patternId === "string"
            ? suggestion.actionPayload.patternId
            : null;

        if (patternId) {
          await tx
            .update(memoryFeedbackPatterns)
            .set({ status: "accepted", updatedAt: new Date() })
            .where(and(eq(memoryFeedbackPatterns.companyId, companyId), eq(memoryFeedbackPatterns.id, patternId)));
        }

        return { suggestion: updated, execution };
      });
    },

    async dismiss(companyId: string, id: string) {
      return db.transaction(async (tx) => {
        const suggestion = await tx
          .select()
          .from(suggestions)
          .where(and(eq(suggestions.companyId, companyId), eq(suggestions.id, id)))
          .then((rows: Array<typeof suggestions.$inferSelect>) => rows[0] ?? null);

        if (!suggestion) {
          throw notFound("Suggestion not found");
        }
        if (suggestion.status !== "pending") {
          throw badRequest("Only pending suggestions can be dismissed");
        }

        const updated = await tx
          .update(suggestions)
          .set({
            status: "dismissed",
            updatedAt: new Date(),
          })
          .where(eq(suggestions.id, suggestion.id))
          .returning()
          .then((rows: Array<typeof suggestions.$inferSelect>) => rows[0]);

        const patternId =
          suggestion.category === "pattern_detected" &&
          suggestion.actionPayload &&
          typeof suggestion.actionPayload.patternId === "string"
            ? suggestion.actionPayload.patternId
            : null;

        if (patternId) {
          await tx
            .update(memoryFeedbackPatterns)
            .set({ status: "dismissed", updatedAt: new Date() })
            .where(and(eq(memoryFeedbackPatterns.companyId, companyId), eq(memoryFeedbackPatterns.id, patternId)));
        }

        return updated;
      });
    },
  };

  async function executeAction(tx: any, companyId: string, suggestion: SuggestionRecord): Promise<SuggestionExecutionResult> {
    switch (suggestion.actionType) {
      case "create_task": {
        const payload = createTaskActionSchema.safeParse(suggestion.actionPayload);
        if (!payload.success) {
          throw badRequest("Invalid create_task suggestion payload", payload.error.flatten());
        }
        const created = await issuesSvc.create(
          companyId,
          {
            ...payload.data,
            dueDate: payload.data.dueDate ? new Date(payload.data.dueDate) : undefined,
          },
          tx as any,
        );
        return {
          actionType: suggestion.actionType,
          entityType: "issue",
          entityId: created.id,
        };
      }
      case "flag_risk": {
        const payload = flagRiskActionSchema.safeParse(suggestion.actionPayload);
        if (!payload.success) {
          throw badRequest("Invalid flag_risk suggestion payload", payload.error.flatten());
        }
        const updated = await tx
          .update(goals)
          .set({ status: "at_risk", updatedAt: new Date() })
          .where(and(eq(goals.companyId, companyId), eq(goals.id, payload.data.goalId)))
          .returning()
          .then((rows: Array<typeof goals.$inferSelect>) => rows[0] ?? null);
        if (!updated) {
          throw notFound("Goal not found for risk flag suggestion");
        }
        return {
          actionType: suggestion.actionType,
          entityType: "goal",
          entityId: updated.id,
        };
      }
      case "suggest_memory": {
        const payload = suggestMemoryActionSchema.safeParse(suggestion.actionPayload);
        if (!payload.success) {
          throw badRequest("Invalid suggest_memory suggestion payload", payload.error.flatten());
        }
        const created = await memorySvc.create(
          companyId,
          {
            title: payload.data.title,
            content: payload.data.content,
            category: payload.data.category,
            source: "agent",
            status: "pending",
            tags: payload.data.tags ?? [],
            departmentId: payload.data.departmentId ?? null,
            projectId: payload.data.projectId ?? null,
            createdBy: "suggestion-engine",
            layer: payload.data.layer ?? null,
            priority: payload.data.priority ?? 0,
            visibility: payload.data.visibility ?? "scoped",
            goalId: payload.data.goalId ?? null,
            taskId: payload.data.taskId ?? null,
            sourceContext: payload.data.sourceContext ?? null,
          },
          tx as any,
        );
        return {
          actionType: suggestion.actionType,
          entityType: "memory_item",
          entityId: created.id,
        };
      }
      case "archive_memory": {
        const payload = archiveMemoryActionSchema.safeParse(suggestion.actionPayload);
        if (!payload.success) {
          throw badRequest("Invalid archive_memory suggestion payload", payload.error.flatten());
        }
        const updated = await tx
          .update(memoryItems)
          .set({ status: "archived", updatedAt: new Date() })
          .where(and(eq(memoryItems.companyId, companyId), eq(memoryItems.id, payload.data.memoryItemId)))
          .returning()
          .then((rows: Array<typeof memoryItems.$inferSelect>) => rows[0] ?? null);
        if (!updated) {
          throw notFound("Memory item not found for archive suggestion");
        }
        return {
          actionType: suggestion.actionType,
          entityType: "memory_item",
          entityId: updated.id,
        };
      }
      case "merge_memory": {
        const payload = mergeMemoryActionSchema.safeParse(suggestion.actionPayload);
        if (!payload.success) {
          throw badRequest("Invalid merge_memory suggestion payload", payload.error.flatten());
        }
        return {
          actionType: suggestion.actionType,
          entityType: "memory_item",
          entityId: payload.data.memoryItemIds[0],
          note: "merge_memory is not implemented yet",
        };
      }
      default:
        throw badRequest(`Unsupported suggestion action type: ${suggestion.actionType}`);
    }
  }

  return service;
}
