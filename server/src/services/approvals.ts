import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { approvalComments, approvals, issues } from "@armyofagents/db";
import { notFound, unprocessable } from "../errors.js";
import { loadConfig } from "../config.js";
import { agentService } from "./agents.js";
import { preflightCrewDispatch } from "./crew-budget.js";
import { dispatchCreatedCrewTasks } from "./crew-task-service.js";
import { logActivity } from "./activity-log.js";
import { mcpConnectorService } from "./mcp-connectors-crud.js";
import { resolveConnectorStatus } from "./mcp-connector-status.js";

/**
 * The slice of `mcpConnectorService` the two helpers below need. Structural, so
 * the truth table can be unit-tested with plain object stubs and no DB.
 */
export type ConnectorApprovalTarget = {
  getById: (id: string) => Promise<
    | {
      companyId: string;
      status: string;
      requiresSecret?: boolean | null;
      secretRef?: string | null;
    }
    | null
  >;
  update: (id: string, patch: { status: string }) => Promise<unknown>;
  updateIfStatus: (
    id: string,
    expectedStatus: string,
    patch: { status: string },
  ) => Promise<unknown>;
};

/**
 * C2 — approving a connector must NOT unconditionally activate it.
 *
 * Governance (approved?) and credentials (secret required? bound?) are
 * ORTHOGONAL axes. The previous implementation collapsed them: it flipped ANY
 * non-active connector straight to `active`, so approving a connector that
 * requires a secret it does not have activated it UNCREDENTIALED — the one thing
 * the design forbids. This delegates the decision to `resolveConnectorStatus`,
 * which is unconditionally incapable of returning "active" while
 * `requiresSecret && !hasSecret`, so nothing here decides `active` on its own.
 *
 * `deploymentMode` is passed through rather than assumed. With `approved: true`
 * the resolver's governance branch is already satisfied for every mode, so today
 * this argument cannot change the outcome — it is threaded anyway so this call
 * stays correct-by-construction if the resolver ever grows a mode-specific rule
 * (e.g. a `cloud_auth` tier), instead of silently hard-coding an assumption.
 *
 * SAFETY PROPERTIES (preserved from the inline block this replaces — approve()
 * is called by the MCP approval tool with NO wrapping transaction, so a throw
 * after the approval status flip would strand the approval as "approved" with no
 * activation):
 *  - null-tolerant: connector deleted between create and approve → no-op
 *  - company-scoped: `update` keys on id ALONE, so tenancy is checked here
 *  - idempotent: no write when the status is already the resolved one
 *  - no new throw paths
 */
export async function applyConnectorApproval(
  svc: ConnectorApprovalTarget,
  companyId: string,
  connectorId: string,
  deploymentMode: string,
): Promise<void> {
  const connector = await svc.getById(connectorId);
  if (!connector || connector.companyId !== companyId) return;

  // `disabled` is TERMINAL here — approving must never resurrect it. Reachable in
  // `authenticated`: create → `pending_approval` + an approval row → the founder
  // PATCHes `{status:"disabled"}` (allowed; the C2 gate only blocks *non*-disabled)
  // → the board later approves the still-open approval. Without this line the
  // resolver answers `active` and a connector the founder switched off starts
  // being delivered to agents again.
  //
  // The founder's explicit disable is a LATER and more specific signal than a
  // pending install request, so it wins. This also mirrors the credential-binding
  // route, which short-circuits `disabled` for the same reason, and is symmetric
  // with `applyConnectorRejection` deliberately not touching an `active` connector.
  if (connector.status === "disabled") return;

  const next = resolveConnectorStatus({
    deploymentMode,
    approved: true,
    // `!== false` (not `=== true`) fails CLOSED: anything that is not explicitly
    // false is treated as "needs a secret", so a malformed value cannot activate an
    // uncredentialed connector. The column is `notNull().default(false)`, so this is
    // defensive only — but the failure it prevents is silent activation.
    requiresSecret: connector.requiresSecret !== false,
    // An empty-string secretRef names no secret, so it is NOT a bound credential;
    // `!= null` alone would read "" as bound and activate an unusable connector.
    hasSecret: Boolean(connector.secretRef),
  });

  if (connector.status !== next) {
    // Guarded on the status we READ (Codex #267 P2 pattern, as the crew_dispatch
    // block below): `next` was derived from that snapshot, so if the row moved in
    // between — a concurrent credential bind, or a founder disabling it — this
    // matches 0 rows and we do nothing rather than overwrite the newer state with
    // a stale derivation. Failing closed (no activation) is the safe direction.
    await svc.updateIfStatus(connectorId, connector.status, { status: next });
  }

  // NO activity-log entry here, deliberately. This runs AFTER the approval status
  // flip, and approve() is called by the MCP approval tool with no wrapping
  // transaction — a logging failure would throw and strand the approval as
  // "approved" with no activation. The approval row itself is the audit record.
}

/**
 * C2 — rejection must cover `needs_credentials` too.
 *
 * The previous guard matched only `pending_approval`. Once approval became
 * credential-aware, an approved-but-uncredentialed connector sits in
 * `needs_credentials`, and rejecting it was a SILENT NO-OP: the connector stayed
 * on a path that reaches `active` the moment a secret is bound.
 *
 * `active` is deliberately NOT covered: reject closes an *install* request, it is
 * not a kill switch for a connector already in service (PATCH → disabled is that).
 * Rejected connectors are disabled rather than deleted so the audit trail — and
 * the founder-visible "this was rejected" state — survives.
 *
 * Same safety properties as `applyConnectorApproval`: null-tolerant,
 * company-scoped, idempotent, and it never throws after the status flip.
 */
export async function applyConnectorRejection(
  svc: ConnectorApprovalTarget,
  companyId: string,
  connectorId: string,
): Promise<void> {
  const connector = await svc.getById(connectorId);
  if (!connector || connector.companyId !== companyId) return;

  if (connector.status === "pending_approval" || connector.status === "needs_credentials") {
    await svc.update(connectorId, { status: "disabled" });
  }
}

export function approvalService(db: Db) {
  const agentsSvc = agentService(db);
  const mcpConnectorSvc = mcpConnectorService(db);
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
      // Same reasoning, Plan 3a Task 7: resolve the deployment mode BEFORE the flip.
      // `loadConfig()` reads the config file and can throw on a malformed env
      // (parseTrustProxy / parseOptionalPortEnv), and the connector side-effect runs
      // AFTER the flip where a throw would strand the approval as "approved" with no
      // activation. `type` is immutable across the flip — the crew_dispatch block above
      // already relies on that — so reading it from `existing` is equivalent.
      const connectorDeploymentMode =
        existing.type === "install_mcp_connector" ? loadConfig().deploymentMode : null;

      let crewDispatchCandidates: Array<{
        id: string;
        assigneeAgentId: string | null;
        workMode: string | null;
        status: string | null;
      }> = [];
      if (existing.type === "crew_dispatch") {
        const payload = existing.payload as Record<string, unknown>;
        const crewDispatchThreadId = typeof payload.threadId === "string" ? payload.threadId : null;
        const crewDispatchTaskIds = Array.isArray(payload.taskIds)
          ? payload.taskIds.filter((x): x is string => typeof x === "string")
          : [];
        if (crewDispatchThreadId && crewDispatchTaskIds.length > 0) {
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
          // Only tasks still parked in their created state (planning + todo) are dispatch
          // candidates — anything the founder already flipped/moved is left alone
          // (Codex #267 P2; the guarded UPDATE below is the authoritative re-check).
          crewDispatchCandidates = tasks.filter(
            (t) => t.workMode === "planning" && t.status === "todo",
          );
          // Codex #267 P2: skip the preflight when nothing remains dispatchable —
          // approving a stale approval is then a pure no-op close, and a paused thread
          // or budget hard-stop must not leave it stuck pending.
          if (crewDispatchCandidates.length > 0) {
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
      // regardless of whether the caller wraps approve() in a txn), and the candidate set
      // (payload tasks still parked as planning + todo) was computed there too. Here we
      // flip the candidates to 'standard' and dispatch them. Eng-review finding A: only
      // the tasks THIS approval flips are dispatched — anything the founder already
      // flipped/moved is skipped, so approving never enqueues a duplicate wakeup.
      if (updated.type === "crew_dispatch" && crewDispatchCandidates.length > 0) {
        const toDispatch: Array<{ id: string; assigneeAgentId: string | null; workMode: string | null }> = [];
        for (const t of crewDispatchCandidates) {
          // Guard the flip on the CURRENT row state (TOCTOU, Codex #267 P2): the WHERE
          // re-checks planning+todo, so a concurrent founder move between the SELECT and
          // this UPDATE misses (0 rows) and the task is neither flipped nor dispatched.
          // Raw update (no issueService.update wake side-effect) — dispatch is explicit below.
          const flipped = (await db
            .update(issues)
            .set({ workMode: "standard", updatedAt: new Date() })
            .where(
              and(
                eq(issues.id, t.id),
                eq(issues.companyId, companyId),
                eq(issues.workMode, "planning"),
                eq(issues.status, "todo"),
              ),
            )
            .returning({ id: issues.id, assigneeAgentId: issues.assigneeAgentId })) as Array<{
            id: string;
            assigneeAgentId: string | null;
          }>;
          if (flipped.length === 0) continue; // moved concurrently — do not dispatch
          // Codex #267 P2: dispatch to the CURRENT assignee returned by the guarded UPDATE,
          // not the (possibly stale) SELECT snapshot — a founder may have reassigned the task
          // between the SELECT and this UPDATE, and we must wake the agent it belongs to now.
          const assigneeAgentId = flipped[0].assigneeAgentId;
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
              assigneeAgentId,
            },
          });
          toDispatch.push({ id: t.id, assigneeAgentId, workMode: "standard" });
        }

        await dispatchCreatedCrewTasks(db, companyId, toDispatch);
      }

      // Plan 2 Task 4 / Plan 3a Task 7: install_mcp_connector approval side-effect — this
      // is the SOLE activation path in `authenticated` mode (PATCH→active is blocked there,
      // Plan 1 amendment C2). Runs AFTER the guarded status flip (like
      // hire_agent/crew_dispatch), so a concurrent double-approve only runs the side-effect
      // for the winner (whose `updated` is truthy). The decision itself — including all the
      // null/tenancy/idempotence guards that keep it from throwing after the flip — lives in
      // `applyConnectorApproval`, which routes through the single status resolver so an
      // approval can never activate an uncredentialed connector.
      if (updated.type === "install_mcp_connector") {
        const payload = updated.payload as Record<string, unknown>;
        const connectorId = typeof payload.connectorId === "string" ? payload.connectorId : null;
        // `connectorDeploymentMode !== null` is true by construction (resolved above
        // under this same `type` check). It is written as a guard rather than a `!`
        // so that if the invariant ever breaks the result is a silent skip, not a
        // throw after the flip.
        if (connectorId && connectorDeploymentMode !== null) {
          await applyConnectorApproval(
            mcpConnectorSvc,
            companyId,
            connectorId,
            connectorDeploymentMode,
          );
        }
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

      // Plan 2 Task 4 / Plan 3a Task 7: rejecting an install_mcp_connector approval sets the
      // connector `disabled` (NOT deleted — keeps an audit trail; a rejected connector should
      // be visibly rejected, not vanish). `applyConnectorRejection` owns which statuses are
      // in scope — pending_approval AND needs_credentials, the latter being the one the old
      // inline guard silently skipped — plus the same null/tenancy guards as approve(), so it
      // never throws after the flip.
      if (updated.type === "install_mcp_connector") {
        const payload = updated.payload as Record<string, unknown>;
        const connectorId = typeof payload.connectorId === "string" ? payload.connectorId : null;
        if (connectorId) {
          await applyConnectorRejection(mcpConnectorSvc, companyId, connectorId);
        }
      }

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
