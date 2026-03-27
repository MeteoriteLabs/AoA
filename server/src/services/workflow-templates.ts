import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { workflowTemplates, issues, taskDependencies } from "@paperclipai/db";
import { notFound } from "../errors.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  order: number;
  title: string;
  description?: string;
  role?: string;
  suggestedAssigneeType?: string;
  suggestedDepartmentId?: string;
  estimatedDurationHours?: number;
  priority?: string;
}

export interface WorkflowDependency {
  fromStep: number; // order of the dependency (must complete first)
  toStep: number;   // order of the dependent (blocked until fromStep done)
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  steps: WorkflowStep[];
  dependencies?: WorkflowDependency[];
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  steps?: WorkflowStep[];
  dependencies?: WorkflowDependency[];
}

export interface InstantiateResult {
  templateId: string;
  tasksCreated: { stepOrder: number; taskId: string; title: string }[];
  dependenciesCreated: number;
}

// ── Service ──────────────────────────────────────────────────────────────────

export function workflowTemplateService(db: Db) {
  return {
    list: async (companyId: string) => {
      return db
        .select()
        .from(workflowTemplates)
        .where(eq(workflowTemplates.companyId, companyId));
    },

    getById: async (companyId: string, id: string) => {
      return db
        .select()
        .from(workflowTemplates)
        .where(
          and(
            eq(workflowTemplates.id, id),
            eq(workflowTemplates.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);
    },

    create: async (
      companyId: string,
      data: CreateWorkflowInput,
      actorId: string,
    ) => {
      const [row] = await db
        .insert(workflowTemplates)
        .values({
          companyId,
          name: data.name,
          description: data.description ?? null,
          steps: data.steps,
          dependencies: data.dependencies ?? [],
          createdBy: actorId,
        })
        .returning();
      return row;
    },

    update: async (
      companyId: string,
      id: string,
      data: UpdateWorkflowInput,
    ) => {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (data.name !== undefined) updates.name = data.name;
      if (data.description !== undefined) updates.description = data.description;
      if (data.steps !== undefined) updates.steps = data.steps;
      if (data.dependencies !== undefined) updates.dependencies = data.dependencies;

      return db
        .update(workflowTemplates)
        .set(updates)
        .where(
          and(
            eq(workflowTemplates.id, id),
            eq(workflowTemplates.companyId, companyId),
          ),
        )
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    delete: async (companyId: string, id: string) => {
      return db
        .delete(workflowTemplates)
        .where(
          and(
            eq(workflowTemplates.id, id),
            eq(workflowTemplates.companyId, companyId),
          ),
        )
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    instantiate: async (
      companyId: string,
      templateId: string,
      goalId: string,
      projectId: string,
    ): Promise<InstantiateResult> => {
      // Fetch the template
      const template = await db
        .select()
        .from(workflowTemplates)
        .where(
          and(
            eq(workflowTemplates.id, templateId),
            eq(workflowTemplates.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!template) {
        throw notFound("Workflow template not found");
      }

      const steps = template.steps as WorkflowStep[];
      const deps = template.dependencies as WorkflowDependency[];

      // Map step order → created task id
      const stepTaskMap = new Map<number, string>();
      const tasksCreated: InstantiateResult["tasksCreated"] = [];

      // Create a task for each step
      for (const step of steps) {
        const [task] = await db
          .insert(issues)
          .values({
            companyId,
            goalId,
            projectId,
            title: step.title,
            description: step.description ?? null,
            priority: step.priority ?? "medium",
            status: "backlog",
          } as typeof issues.$inferInsert)
          .returning();

        stepTaskMap.set(step.order, task.id);
        tasksCreated.push({
          stepOrder: step.order,
          taskId: task.id,
          title: task.title,
        });
      }

      // Create dependencies between tasks
      let dependenciesCreated = 0;
      for (const dep of deps) {
        const fromTaskId = stepTaskMap.get(dep.fromStep);
        const toTaskId = stepTaskMap.get(dep.toStep);
        if (fromTaskId && toTaskId) {
          await db
            .insert(taskDependencies)
            .values({
              companyId,
              dependencyIssueId: fromTaskId,  // must complete first
              dependentIssueId: toTaskId,      // blocked until dependency done
            })
            .returning();
          dependenciesCreated++;
        }
      }

      // Increment instantiation count
      await db
        .update(workflowTemplates)
        .set({
          instantiationCount: sql`${workflowTemplates.instantiationCount} + 1`,
          lastInstantiatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workflowTemplates.id, templateId))
        .returning();

      return {
        templateId,
        tasksCreated,
        dependenciesCreated,
      };
    },
  };
}
