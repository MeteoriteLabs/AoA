import { and, desc, eq, gte, isNull, like, or, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { activityLog, heartbeatRuns, issues } from "@armyofagents/db";
import {
  SECURITY_DENIAL_ACTION_PREFIX,
  assertUnreservedActivityNamespace,
} from "./activity-namespace.js";

export interface ActivityFilters {
  companyId: string;
  agentId?: string;
  actorType?: "agent" | "user" | "system" | "autonomy";
  actorId?: string;
  entityType?: string;
  entityId?: string;
}

/**
 * Filters for the operator-plane `security.denied.*` reader. Every field is
 * optional: the unfiltered call is the incident-response case ("show me the most
 * recent refusals across the instance"), and the filters narrow it to one
 * crossing, one surface, one actor, one resource, or one tenant.
 *
 * `companyId` is a FILTER here, never a scope — this reader is cross-tenant by
 * construction and is gated on the operator plane, not on company membership.
 */
export interface SecurityDenialQuery {
  /** The threat-controls crossing id, read from the row's `details.crossing`. */
  crossing?: string;
  /** The denial surface slug, i.e. the `action` suffix after the reserved prefix. */
  surface?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  /** Narrow to ONE tenant's refusals. Never widens; a NULL-company row cannot match. */
  companyId?: string;
  since?: Date;
  limit?: number;
}

export const SECURITY_DENIAL_DEFAULT_LIMIT = 100;
export const SECURITY_DENIAL_MAX_LIMIT = 500;

/**
 * A page bound that cannot be turned into an unbounded scan of the whole audit
 * table by a query string. A missing, non-finite or non-positive value takes the
 * default rather than meaning "no limit".
 */
export function clampDenialLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return SECURITY_DENIAL_DEFAULT_LIMIT;
  const floored = Math.floor(limit);
  if (floored < 1) return SECURITY_DENIAL_DEFAULT_LIMIT;
  return Math.min(floored, SECURITY_DENIAL_MAX_LIMIT);
}

export function activityService(db: Db) {
  const issueIdAsText = sql<string>`${issues.id}::text`;
  return {
    list: (filters: ActivityFilters) => {
      const conditions = [eq(activityLog.companyId, filters.companyId)];

      if (filters.agentId) {
        conditions.push(eq(activityLog.agentId, filters.agentId));
      }
      if (filters.actorType) {
        conditions.push(eq(activityLog.actorType, filters.actorType));
      }
      if (filters.actorId) {
        conditions.push(eq(activityLog.actorId, filters.actorId));
      }
      if (filters.entityType) {
        conditions.push(eq(activityLog.entityType, filters.entityType));
      }
      if (filters.entityId) {
        conditions.push(eq(activityLog.entityId, filters.entityId));
      }

      return db
        .select({ activityLog })
        .from(activityLog)
        .leftJoin(
          issues,
          and(
            eq(activityLog.entityType, sql`'issue'`),
            eq(activityLog.entityId, issueIdAsText),
          ),
        )
        .where(
          and(
            ...conditions,
            or(
              sql`${activityLog.entityType} != 'issue'`,
              isNull(issues.hiddenAt),
            ),
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .then((rows) => rows.map((r) => r.activityLog));
    },

    /**
     * One task's activity feed, scoped to the tenant that owns the task.
     *
     * ★ THE `companyId` PARAMETER IS A SECURITY FIX, NOT ERGONOMICS — E0-F013
     * Decision 2, acceptance condition (c). This reader used to filter on
     * `entityType='issue'` + `entityId` and nothing else, while its only route
     * (`GET /issues/:id/activity`) gates on THE ISSUE's company, never on the
     * ROW's. `entityType`/`entityId` are caller-supplied free text on the
     * security-denial recorder, so a denial recorded in tenant B and typed
     * `issue` against tenant A's issue id came back to a tenant-A reader. That
     * was measured LATENT rather than live — all three production denial writers
     * hard-code `memory_item` or `job_artifact` — and it is closed here because
     * the ruling that makes `company_id` NULLABLE removes the other half of what
     * was accidentally containing it.
     *
     * ★ IT IS ALSO THE DEFENCE AGAINST THE NULLABLE COLUMN, by construction: a
     * NULL `company_id` never satisfies `company_id = $1`, so a tenantless denial
     * row is invisible to this reader the moment that column lands. Nothing here
     * needs to know the column changed.
     *
     * ★ NOT A CLASS FIX, stated rather than implied. The other company-unscoped
     * `activity_log` reader (`marketplace-reconcile.ts`
     * `inspectMarketplaceReconciliation`) is untouched. It is instance-wide by
     * design — its operation spans many companies, so there is no single company
     * to scope it to — and it was measured separately to discard denial rows
     * anyway: every row it selects is then filtered by exact `action` equality
     * against three `marketplace.reconciliation_*` literals, and only surviving
     * rows reach its output. That is containment by downstream construction, not
     * by this change.
     *
     * The proving test is `e0-f013-denial-disclosure-path.integration.test.ts`,
     * which plants a real denial row through the real recorder and asserts the
     * real route does not return it. It was observed RED on exactly that arm,
     * with its three positive controls green, before this predicate existed.
     */
    forIssue: (companyId: string, issueId: string) =>
      db
        .select()
        .from(activityLog)
        .where(
          and(
            eq(activityLog.companyId, companyId),
            eq(activityLog.entityType, "issue"),
            eq(activityLog.entityId, issueId),
          ),
        )
        .orderBy(desc(activityLog.createdAt)),

    runsForIssue: (companyId: string, issueId: string) =>
      db
        .select({
          runId: heartbeatRuns.id,
          status: heartbeatRuns.status,
          agentId: heartbeatRuns.agentId,
          startedAt: heartbeatRuns.startedAt,
          finishedAt: heartbeatRuns.finishedAt,
          createdAt: heartbeatRuns.createdAt,
          invocationSource: heartbeatRuns.invocationSource,
          logStore: heartbeatRuns.logStore,
          logRef: heartbeatRuns.logRef,
          processPid: heartbeatRuns.processPid,
          processStartedAt: heartbeatRuns.processStartedAt,
          lastOutputAt: heartbeatRuns.lastOutputAt,
          activeExecutionMs: heartbeatRuns.activeExecutionMs,
          humanQuestionWaitMs: heartbeatRuns.humanQuestionWaitMs,
          runtimePermissionWaitMs: heartbeatRuns.runtimePermissionWaitMs,
          totalWallClockMs: heartbeatRuns.totalWallClockMs,
          usageJson: heartbeatRuns.usageJson,
          resultJson: heartbeatRuns.resultJson,
          detectedOutputs: heartbeatRuns.detectedOutputs,
          promptSnapshot: heartbeatRuns.promptSnapshot,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            or(
              sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
              sql`exists (
                select 1
                from ${activityLog}
                where ${activityLog.companyId} = ${companyId}
                  and ${activityLog.entityType} = 'issue'
                  and ${activityLog.entityId} = ${issueId}
                  and ${activityLog.runId} = ${heartbeatRuns.id}
              )`,
            ),
          ),
        )
        .orderBy(desc(heartbeatRuns.createdAt)),

    companyIdForRun: async (runId: string): Promise<string | null> => {
      const run = await db
        .select({ companyId: heartbeatRuns.companyId })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .then((rows) => rows[0] ?? null);
      return run?.companyId ?? null;
    },

    issuesForRun: async (runId: string) => {
      const run = await db
        .select({
          companyId: heartbeatRuns.companyId,
          contextSnapshot: heartbeatRuns.contextSnapshot,
        })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .then((rows) => rows[0] ?? null);
      if (!run) return [];

      const fromActivity = await db
        .selectDistinctOn([issueIdAsText], {
          issueId: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
        })
        .from(activityLog)
        .innerJoin(issues, eq(activityLog.entityId, issueIdAsText))
        .where(
          and(
            eq(activityLog.companyId, run.companyId),
            eq(activityLog.runId, runId),
            eq(activityLog.entityType, "issue"),
            isNull(issues.hiddenAt),
          ),
        )
        .orderBy(issueIdAsText);

      const context = run.contextSnapshot;
      const contextIssueId =
        context && typeof context === "object" && typeof (context as Record<string, unknown>).issueId === "string"
          ? ((context as Record<string, unknown>).issueId as string)
          : null;
      if (!contextIssueId) return fromActivity;
      if (fromActivity.some((issue) => issue.issueId === contextIssueId)) return fromActivity;

      const fromContext = await db
        .select({
          issueId: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, run.companyId),
            eq(issues.id, contextIssueId),
            isNull(issues.hiddenAt),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!fromContext) return fromActivity;
      return [fromContext, ...fromActivity];
    },

    /**
     * ★ THE READER FOR `security.denied.*` — E0-F013 Decision 2, acceptance
     * condition (a).
     *
     * ★ WHY IT HAD TO SHIP THIS WAVE. The decision paper measured that NO
     * production reader of the `security.denied.*` namespace existed anywhere in
     * `server/src` or `ui/src` — three writers, a namespace guard, and prose.
     * Adding a fourth writer (and, under the ruling, rows that no company-scoped
     * reader can ever match) to a store nobody queries produces evidence that is
     * present and unreachable: a claim of coverage with no observation behind it.
     * That is the exact failure class this programme exists to stop, so the
     * ruling made a reader an acceptance condition rather than a follow-up.
     *
     * ★ WHO CAN READ IT, AND WHY IT IS DELIBERATELY NOT A COMPANY SURFACE. This
     * is cross-tenant by design and is served ONLY behind the operator plane
     * (`assertCanManageInstanceSettings` — `req.actor.operator` /
     * `local_implicit`, NOT `isInstanceAdmin`, which is clamped to false in
     * cloud_auth). It is reachable from no company-scoped route.
     *
     * ★ THE DISCLOSURE QUESTION, ANSWERED BY FOLLOWING DE-06's PRECEDENT AND
     * SAYING SO. A cross-tenant denial is evidence about TWO tenants: the actor's
     * and the probed one. Both live writers already answer this the same way —
     * attribute the row to the ACTOR's own tenant, never the probed one — and
     * DE-06's proving test asserts the PROBED tenant's `activity_log` is EMPTY.
     * This reader follows that precedent: it adds NO per-company denial feed, so
     * the probed tenant still learns nothing about having been probed or by whom.
     * That question (whose log a cross-tenant probe belongs in, and whether a
     * probed tenant is entitled to know) is Decision 3's, and this deliberately
     * does not pre-empt it.
     *
     * ★ WHY AN OPERATOR QUERY AND NOT A UI. The evidence is instance-wide and its
     * audience is one operator investigating an incident; a company-scoped UI is
     * the one shape that would answer Decision 3 by accident, in the direction
     * that discloses. A narrow, documented, operator-gated surface is what can be
     * shipped without deciding that. See `docs/api/activity.md`.
     *
     * ★ FORWARD-COMPATIBLE WITH UNIT A, ON PURPOSE. `select()` projects whatever
     * columns the schema carries, so the nullable `company_id` and the new
     * `organization_id` this wave adds appear here the moment they land, with no
     * change to this file and no compile-time coupling to a column that does not
     * exist yet. Rows with a NULL `company_id` are visible ONLY here: no
     * company-scoped reader can match them.
     */
    securityDenials: (filters: SecurityDenialQuery = {}) => {
      const conditions = [
        like(activityLog.action, `${SECURITY_DENIAL_ACTION_PREFIX}%`),
      ];
      if (filters.companyId) {
        conditions.push(eq(activityLog.companyId, filters.companyId));
      }
      if (filters.surface) {
        conditions.push(
          eq(activityLog.action, `${SECURITY_DENIAL_ACTION_PREFIX}${filters.surface}`),
        );
      }
      if (filters.actorId) {
        conditions.push(eq(activityLog.actorId, filters.actorId));
      }
      if (filters.entityType) {
        conditions.push(eq(activityLog.entityType, filters.entityType));
      }
      if (filters.entityId) {
        conditions.push(eq(activityLog.entityId, filters.entityId));
      }
      if (filters.since) {
        conditions.push(gte(activityLog.createdAt, filters.since));
      }
      // `crossing` lives inside the redacted `details` jsonb rather than a
      // column, because the recorder puts it there; matching it in SQL keeps the
      // filter from being a post-fetch pass over a truncated page.
      if (filters.crossing) {
        conditions.push(sql`${activityLog.details} ->> 'crossing' = ${filters.crossing}`);
      }
      return db
        .select()
        .from(activityLog)
        .where(and(...conditions))
        .orderBy(desc(activityLog.createdAt))
        .limit(clampDenialLimit(filters.limit));
    },

    create: (data: typeof activityLog.$inferInsert) => {
      assertUnreservedActivityNamespace(data);
      return db
        .insert(activityLog)
        .values(data)
        .returning()
        .then((rows) => rows[0]);
    },
  };
}
