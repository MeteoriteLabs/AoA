import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { approvalComments, approvals, issues } from "@armyofagents/db";
import { notFound, unprocessable } from "../errors.js";
import { agentService } from "./agents.js";
import { preflightCrewDispatch } from "./crew-budget.js";
import { dispatchCreatedCrewTasks } from "./crew-task-service.js";
import { logActivity } from "./activity-log.js";

export function approvalService(db: Db) {
  const agentsSvc = agentService(db);
  const canResolveStatuses = new Set(["pending", "revision_requested"]);

  async function getExistingApproval(id: string) {
    const existing = await db
      .select()
      .from(approvals)
      .where(eq(approvals.id, id))
      .then((rows) => rows[0] ?? null);
    if (!existing) throw notFound("Approval not found");
    return existing;
  }

  return {
    list: (companyId: string, status?: string) => {
      const conditions = [eq(approvals.companyId, companyId)];
      if (status) conditions.push(eq(approvals.status, status));
      return db.select().from(approvals).where(and(...conditions));
    },

    getById: (id: string) =>
      db
        .select()
        .from(approvals)
        .where(eq(approvals.id, id))
        .then((rows) => rows[0] ?? null),

    create: (companyId: string, data: Omit<typeof approvals.$inferInsert, "companyId">) =>
      db
        .insert(approvals)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]),

    approve: async (
      id: string,
      companyId: string,
      decidedByUserId: string,
      decisionNote?: string | null,
    ) => {
      const existing = await getExistingApproval(id);
      if (!canResolveStatuses.has(existing.status)) {
        throw unprocessable("Only pending or revision requested approvals can be approved");
      }

      // W1c: for a crew_dispatch approval, run the budget/pause preflight BEFORE the
      // status flip. approve() is called both inside a txn (HTTP route) AND directly
      // without one (MCP approval tool — server/src/mcp/tools/approval-tools.ts). Gating
      // before the UPDATE keeps "blocked → approval stays pending, retryable" true for
      // every caller; a throw after the flip would strand the approval when there is no
      // wrapping txn (tasks stuck in planning, approval closed). Payload is immutable
      // across the status flip, so reading it from `existing` is equivalent to `updated`.
      let crewDispatchThreadId: string | null = null;
      let crewDispatchTaskIds: string[] = [];
      if (existing.type === "crew_dispatch") {
        const payload = existing.payload as Record<string, unknown>;
        crewDispatchThreadId = typeof payload.threadId === "string" ? payload.threadId : null;
        crewDispatchTaskIds = Array.isArray(payload.taskIds)
          ? payload.taskIds.filter((x): x is string => typeof x === "string")
          : [];
        if (crewDispatchThreadId && crewDispatchTaskIds.length > 0) {
          const preflight = await preflightCrewDispatch(db, {
            companyId,
            agentId: "",
            threadId: crewDispatchThreadId,
          });
          if (!preflight.allowed) {
            throw unprocessable(
              `Cannot dispatch crew work: ${preflight.reason ?? preflight.reasonCode}`,
            );
          }
        }
      }

      const now = new Date();
      const updated = await db
        .update(approvals)
        .set({
          status: "approved",
          decidedByUserId,
          decisionNote: decisionNote ?? null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(and(eq(approvals.id, id), eq(approvals.companyId, companyId), inArray(approvals.status, ["pending", "revision_requested"])))
        .returning()
        .then((rows) => rows[0]);

      // Defense-in-depth: if the WHERE didn't match (companyId mismatch), no
      // row was updated. Return null so the caller can't act on stale data.
      // The route layer already runs load+assertCompanyAccess, so this only
      // fires if a future caller forgets that gate.
      if (!updated) {
        return null;
      }

      let hireApprovedAgentId: string | null = null;
      if (updated.type === "hire_agent") {
        const payload = updated.payload as Record<string, unknown>;
        const payloadAgentId = typeof payload.agentId === "string" ? payload.agentId : null;
        if (payloadAgentId) {
          await agentsSvc.activatePendingApproval(payloadAgentId);
          hireApprovedAgentId = payloadAgentId;
        } else {
          const reportsTo = typeof payload.reportsTo === "string" ? payload.reportsTo : null;
          const parentType = typeof payload.parentType === "string"
            ? payload.parentType
            : (reportsTo ? "agent" : null);
          const parentId = typeof payload.parentId === "string"
            ? payload.parentId
            : (reportsTo ?? null);
          const created = await agentsSvc.create(updated.companyId, {
            name: String(payload.name ?? "New Agent"),
            role: String(payload.role ?? "general"),
            title: typeof payload.title === "string" ? payload.title : null,
            reportsTo,
            parentType,
            parentId,
            capabilities: typeof payload.capabilities === "string" ? payload.capabilities : null,
            adapterType: String(payload.adapterType ?? "process"),
            adapterConfig:
              typeof payload.adapterConfig === "object" && payload.adapterConfig !== null
                ? (payload.adapterConfig as Record<string, unknown>)
                : {},
            budgetMonthlyCents:
              typeof payload.budgetMonthlyCents === "number" ? payload.budgetMonthlyCents : 0,
            metadata:
              typeof payload.metadata === "object" && payload.metadata !== null
                ? (payload.metadata as Record<string, unknown>)
                : null,
            status: "idle",
            spentMonthlyCents: 0,
            permissions: undefined,
            lastHeartbeatAt: null,
          });
          hireApprovedAgentId = created?.id ?? null;
        }
        if (hireApprovedAgentId) {
          Object.defineProperty(updated, "__approvedHireAgentId", {
            value: hireApprovedAgentId,
            enumerable: false,
          });
        }
      }

      // W1c: crew-dispatch approval side-effect. The budget/pause preflight already ran
      // BEFORE the status flip above (so a blocked dispatch can never close the approval,
      // regardless of whether the caller wraps approve() in a txn). Here we only flip the
      // still-'planning' tasks to 'standard' and dispatch them.
      if (updated.type === "crew_dispatch" && crewDispatchThreadId && crewDispatchTaskIds.length > 0) {
        const tasks = (await db
          .select({
            id: issues.id,
            assigneeAgentId: issues.assigneeAgentId,
            workMode: issues.workMode,
            status: issues.status,
          })
          .from(issues)
          .where(and(eq(issues.companyId, companyId), inArray(issues.id, crewDispatchTaskIds)))) as Array<{
          id: string;
          assigneeAgentId: string | null;
          workMode: string | null;
          status: string | null;
        }>;

        // Eng-review finding A: dispatch ONLY the tasks this approval flips
        // planning→standard. A task the founder already flipped to 'standard'
        // (and thus already dispatched) is skipped, so approving never enqueues a
        // duplicate wakeup for it. This approval owns only its own parked tasks.
        const toDispatch: Array<{ id: string; assigneeAgentId: string | null; workMode: string | null }> = [];
        for (const t of tasks) {
          // Only dispatch a task the founder left parked in its created state (planning +
          // todo). If they moved it off todo before approving — backlog/in_progress/
          // in_review/blocked/done/cancelled — or already flipped it to standard, leave it
          // as-is; approving a stale approval must not resurrect parked/terminal work
          // (Codex #267 P2). dispatchCreatedCrewTasks has no status info, so gate here.
          if (t.workMode !== "planning" || t.status !== "todo") continue;
          // Raw flip (no issueService.update wake side-effect) — dispatch is explicit below.
          await db
            .update(issues)
            .set({ workMode: "standard", updatedAt: new Date() })
            .where(and(eq(issues.id, t.id), eq(issues.companyId, companyId)));
          // Codex #267 P2: this raw flip bypasses issueService's issue.updated activity, and
          // crew_dispatch approvals aren't linked via issue_approvals, so the generic
          // approval.approved log carries no task ids. Log the planning→standard dispatch
          // per task so the mutation is auditable (repo rule: mutating actions are logged).
          await logActivity(db, {
            companyId,
            actorType: "user",
            actorId: decidedByUserId,
            action: "crew_dispatch.task_dispatched",
            entityType: "issue",
            entityId: t.id,
            details: {
              approvalId: id,
              fromWorkMode: "planning",
              toWorkMode: "standard",
              assigneeAgentId: t.assigneeAgentId,
            },
          });
          toDispatch.push({ id: t.id, assigneeAgentId: t.assigneeAgentId, workMode: "standard" });
        }

        await dispatchCreatedCrewTasks(db, companyId, toDispatch);
      }

      return updated;
    },

    reject: async (
      id: string,
      companyId: string,
      decidedByUserId: string,
      decisionNote?: string | null,
    ) => {
      const existing = await getExistingApproval(id);
      if (!canResolveStatuses.has(existing.status)) {
        throw unprocessable("Only pending or revision requested approvals can be rejected");
      }

      const now = new Date();
      const updated = await db
        .update(approvals)
        .set({
          status: "rejected",
          decidedByUserId,
          decisionNote: decisionNote ?? null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(and(eq(approvals.id, id), eq(approvals.companyId, companyId), inArray(approvals.status, ["pending", "revision_requested"])))
        .returning()
        .then((rows) => rows[0]);

      // Defense-in-depth: companyId mismatch → no row updated → return null.
      if (!updated) {
        return null;
      }

      if (updated.type === "hire_agent") {
        const payload = updated.payload as Record<string, unknown>;
        const payloadAgentId = typeof payload.agentId === "string" ? payload.agentId : null;
        if (payloadAgentId) {
          await agentsSvc.terminate(payloadAgentId);
        }
      }

      // W1c: crew_dispatch reject is intentionally a NO-OP on the tasks. Auto-created
      // tasks stay on the Crew Board as 'planning' (parked) — the founder can flip them
      // to Standard or delete them later. Rejecting only closes the dispatch approval.

      return updated;
    },

    requestRevision: async (
      id: string,
      companyId: string,
      decidedByUserId: string,
      decisionNote?: string | null,
    ) => {
      const existing = await getExistingApproval(id);
      if (existing.status !== "pending") {
        throw unprocessable("Only pending approvals can request revision");
      }

      const now = new Date();
      const updated = await db
        .update(approvals)
        .set({
          status: "revision_requested",
          decidedByUserId,
          decisionNote: decisionNote ?? null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(and(eq(approvals.id, id), eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
        .returning()
        .then((rows) => rows[0]);

      // Defense-in-depth: companyId mismatch → no row updated → return null.
      return updated ?? null;
    },

    resubmit: async (id: string, companyId: string, payload?: Record<string, unknown>) => {
      const existing = await getExistingApproval(id);
      if (existing.status !== "revision_requested") {
        throw unprocessable("Only revision requested approvals can be resubmitted");
      }
      // Codex #267 P1: crew_dispatch is system-internal. Resubmit rewrites payload, so
      // allowing it would re-open the caller-controlled-taskIds dispatch vector even
      // though creation is already blocked. Only the system sets a crew_dispatch payload.
      if (existing.type === "crew_dispatch") {
        throw unprocessable("System-internal crew_dispatch approvals cannot be resubmitted");
      }

      const now = new Date();
      return db
        .update(approvals)
        .set({
          status: "pending",
          payload: payload ?? existing.payload,
          decisionNote: null,
          decidedByUserId: null,
          decidedAt: null,
          updatedAt: now,
        })
        .where(and(eq(approvals.id, id), eq(approvals.companyId, companyId), eq(approvals.status, "revision_requested")))
        .returning()
        .then((rows) => rows[0]);
    },

    listComments: async (approvalId: string) => {
      const existing = await getExistingApproval(approvalId);
      return db
        .select()
        .from(approvalComments)
        .where(
          and(
            eq(approvalComments.approvalId, approvalId),
            eq(approvalComments.companyId, existing.companyId),
          ),
        )
        .orderBy(asc(approvalComments.createdAt));
    },

    addComment: async (
      approvalId: string,
      body: string,
      actor: { agentId?: string; userId?: string },
    ) => {
      const existing = await getExistingApproval(approvalId);
      return db
        .insert(approvalComments)
        .values({
          companyId: existing.companyId,
          approvalId,
          authorAgentId: actor.agentId ?? null,
          authorUserId: actor.userId ?? null,
          body,
        })
        .returning()
        .then((rows) => rows[0]);
    },
  };
}
