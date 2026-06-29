import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { hubItems, hubItemUserState, hubAudit, approvals, heartbeatRuns } from "@armyofagents/db";
import type { HubItemStatus, HubLane, HubSemanticType, HubOwnerPool } from "@armyofagents/shared";
import {
  HUB_SEMANTIC_TYPES,
  HEARTBEAT_RUN_STATUSES,
  laneForSemanticType,
  authorityForSemanticType,
} from "@armyofagents/shared";
import type { UserRole } from "@armyofagents/shared";

// Heartbeat runs are non-terminal only while still queued, waiting to retry, or
// actively running — derived from the shared HEARTBEAT_RUN_STATUSES truth so the
// set can't drift from real status values. Everything else (succeeded/failed/
// cancelled/timed_out, or a missing row) is terminal → close the hub item.
const HEARTBEAT_LIVE_STATUSES: ReadonlySet<string> = new Set(
  HEARTBEAT_RUN_STATUSES.filter((s) => s === "queued" || s === "scheduled_retry" || s === "running"),
);
import { redactSecretsInString } from "../redaction.js";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { orgHierarchyService } from "./org-hierarchy.js";
import { permissionService } from "./permissions.js";

// Semantic types that resolve to a given lane (lane is derived, not a column).
function semanticTypesForLane(lane: HubLane): HubSemanticType[] {
  return HUB_SEMANTIC_TYPES.filter((t) => laneForSemanticType(t) === lane);
}

// ── Emit ────────────────────────────────────────────────────────────────────

export interface EmitArgs {
  companyId: string;
  semanticType: HubSemanticType;
  sourceType: string;
  sourceId: string;
  title: string;
  summary?: string | null;
  scopeKey?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  // Owner resolution: pass ownerUserId for NATURAL-owner items (mention → the
  // mentioned user, reminder → the user). For agent/run-sourced events, pass
  // sourceActorType/sourceActorId and emit resolves the first human ancestor.
  ownerUserId?: string | null;
  sourceActorType?: "agent" | "user" | null;
  sourceActorId?: string | null;
  ownerPool?: HubOwnerPool | null; // ADDITIONAL pool visibility; never replaces the human owner
  slaAt?: Date | null;
  sourcePermissionRevision?: string | null;
  // Emit in the SAME transaction as the source mutation (no silent drops). A
  // PgTransaction is NOT assignable to Db — callers pass `tx as unknown as Db`.
  executor?: Db;
}

export function hubItemsService(db: Db) {
  function sourceUniqueKey(a: EmitArgs): string {
    return [a.companyId, a.sourceType, a.sourceId, a.semanticType, a.scopeKey ?? ""].join(":");
  }

  // §7/§19: every item has a real human Owner. Natural owner → use it; agent/run
  // source → first human ancestor (W6); else the founder. Never null/"" (W6
  // guarantees a human-at-top, so getFounderUserId is the floor).
  async function resolveOwner(conn: Db, a: EmitArgs): Promise<string> {
    if (a.ownerUserId) return a.ownerUserId;
    const org = orgHierarchyService(conn);
    if (a.sourceActorType === "agent" && a.sourceActorId) {
      const human = await org.getFirstHumanAncestor(a.companyId, "agent", a.sourceActorId);
      if (human) return human;
    }
    const founder = await org.getFounderUserId(a.companyId);
    if (!founder) throw unprocessable("Cannot emit a hub item: company has no human owner");
    return founder;
  }

  async function emit(a: EmitArgs) {
    const conn = (a.executor ?? db) as unknown as Db; // executor may be a PgTransaction
    const ownerUserId = await resolveOwner(conn, a); // a real human; never ""
    const key = sourceUniqueKey(a);
    const safeSummary = a.summary == null ? null : redactSecretsInString(a.summary);
    const values = {
      companyId: a.companyId,
      userId: ownerUserId, // legacy NOT NULL column = the resolved human owner
      type: a.semanticType, // keep legacy `type` populated for back-compat reads
      title: a.title,
      semanticType: a.semanticType,
      sourceType: a.sourceType,
      sourceId: a.sourceId,
      scopeKey: a.scopeKey ?? null,
      sourceUniqueKey: key,
      summary: safeSummary,
      priority: a.priority ?? "normal",
      ownerUserId,
      ownerPool: a.ownerPool ?? null,
      slaAt: a.slaAt ?? null,
      sourcePermissionRevision: a.sourcePermissionRevision ?? null,
      status: "open" as const,
    };
    // Idempotent upsert, gated to STILL-OPEN rows: a re-emit refreshes the
    // denormalized fields ONLY while the item is open — it never resurrects a
    // resolved/archived item nor clobbers fields under an in-flight action.
    const inserted = await conn
      .insert(hubItems)
      .values(values)
      .onConflictDoUpdate({
        target: hubItems.sourceUniqueKey,
        setWhere: sql`${hubItems.status} = 'open'`,
        set: {
          title: values.title,
          summary: values.summary,
          priority: values.priority,
          // Keep the legacy `userId` and the hub `ownerUserId` in lockstep: a
          // re-emit that resolves a different owner must update BOTH, or the two
          // owner columns diverge (P2-3).
          userId: values.userId,
          ownerUserId: values.ownerUserId,
          ownerPool: values.ownerPool,
          slaAt: values.slaAt,
          sourcePermissionRevision: values.sourcePermissionRevision,
        },
      })
      .returning();
    // A conflict on a NON-open row updates nothing (setWhere false) → RETURNING
    // is empty; re-select the existing row so callers always get the current item.
    let row = inserted[0];
    if (!row) {
      row = await conn
        .select()
        .from(hubItems)
        .where(eq(hubItems.sourceUniqueKey, key))
        .limit(1)
        .then((r) => r[0]);
    }
    // TOCTOU guard: if the row was concurrently deleted between the gated upsert
    // (empty RETURNING) and the re-select, `row` is undefined — never return an
    // id-less `{ lane }` object to callers (P2-5).
    if (!row) throw conflict("Hub item vanished during emit; retry.");
    return { ...row, lane: laneForSemanticType(a.semanticType) };
  }

  // ── Query / Action / Reconcile ──────────────────────────────────────────────
  // NOTE: the public `return` sits at the END of this closure (after every
  // const/function declaration below) so the module-scoped reconciler consts
  // actually evaluate — a `return` before them would leave them unreachable
  // (TDZ at reconcile()-call time). Function declarations hoist; consts do not.

  // Version-guarded status transition + audit row, written in ONE transaction.
  // Shared by recordAndAct (manual) and reconcile (system) so a system transition
  // and a concurrent user action can't lost-update each other — both go through
  // the same `version`-guarded UPDATE. Throws `conflict` (409) on a version miss.
  async function applyGuardedTransition(
    tx: Db,
    item: { id: string; companyId: string; status: string; version: number; resolvedAt: Date | null; archivedAt: Date | null },
    nextStatus: "resolved" | "archived" | "snoozed",
    audit: {
      actorType: string;
      actorId: string;
      action: string;
      authorityBasis?: string | null;
      reason?: string | null;
      idempotencyKey?: string | null;
      sourceRevision?: string | null;
    },
    // The version the UPDATE is guarded on (the client's expectedVersion for a
    // manual action). Defaults to the item's own version (system/sweeper path).
    // priorState always records the item's TRUE current version, not the guard.
    guardVersion: number = item.version,
  ) {
    const updated = await tx
      .update(hubItems)
      .set({
        status: nextStatus,
        version: guardVersion + 1,
        resolvedAt: nextStatus === "resolved" ? new Date() : item.resolvedAt,
        archivedAt: nextStatus === "archived" ? new Date() : item.archivedAt,
      })
      .where(and(eq(hubItems.id, item.id), eq(hubItems.version, guardVersion)))
      .returning()
      .then((r) => r[0] ?? null);
    if (!updated) {
      throw conflict("This item was changed by someone else. Reload and retry.", {
        currentVersion: item.version,
      });
    }
    await tx.insert(hubAudit).values({
      companyId: item.companyId,
      hubItemId: item.id,
      actorType: audit.actorType,
      actorId: audit.actorId,
      action: audit.action,
      authorityBasis: audit.authorityBasis ?? null,
      reason: audit.reason ?? null,
      idempotencyKey: audit.idempotencyKey ?? null,
      sourceRevision: audit.sourceRevision ?? null,
      priorState: { status: item.status, version: item.version },
    });
    return updated;
  }

  // RBAC-scoped, hot-set (open by default), per-principal-state-joined query.
  async function query(
    companyId: string,
    opts: {
      actorUserId: string;
      role?: UserRole;
      lane?: HubLane;
      status?: HubItemStatus;
      includeDismissed?: boolean;
    },
  ) {
    const { actorUserId } = opts;
    // Resolve the effective role if not supplied by the caller (route may pass it).
    const role = opts.role ?? (await permissionService(db).getEffectiveRole(companyId, actorUserId));

    const conds = [eq(hubItems.companyId, companyId)];

    // Hot set: open items only by default (uses hub_items_open_idx).
    conds.push(eq(hubItems.status, opts.status ?? "open"));

    // RBAC scope: founder sees all; team_lead sees owned OR department-scoped;
    // team_member sees only owned. scopeKey carries the department/project scope.
    if (role !== "founder") {
      const ownedCond = eq(hubItems.ownerUserId, actorUserId);
      if (role === "team_lead") {
        const leadDepts = await permissionService(db).getTeamLeadDepartments(companyId, actorUserId);
        const scopeCond = leadDepts.length > 0 ? inArray(hubItems.scopeKey, leadDepts) : undefined;
        conds.push(scopeCond ? or(ownedCond, scopeCond)! : ownedCond);
      } else {
        // team_member (and any unknown role) → owned only.
        conds.push(ownedCond);
      }
    }

    // Lane filter (derived from semanticType — no lane column).
    if (opts.lane) {
      const types = semanticTypesForLane(opts.lane);
      conds.push(inArray(hubItems.semanticType, types));
    }

    const rows = await db
      .select({
        item: hubItems,
        readAt: hubItemUserState.readAt,
        snoozedUntil: hubItemUserState.snoozedUntil,
        dismissedAt: hubItemUserState.dismissedAt,
      })
      .from(hubItems)
      .leftJoin(
        hubItemUserState,
        and(
          eq(hubItemUserState.hubItemId, hubItems.id),
          eq(hubItemUserState.principalType, "user"),
          eq(hubItemUserState.principalId, actorUserId),
        ),
      )
      .where(and(...conds))
      // Stable order: createdAt is not unique, so add id as a deterministic
      // tiebreaker before W1b builds ordered lists / pagination (P2-6).
      .orderBy(sql`${hubItems.createdAt} DESC, ${hubItems.id} DESC`);

    return rows
      .filter((r) => opts.includeDismissed || r.dismissedAt == null)
      .map((r) => ({
        ...r.item,
        lane: r.item.semanticType
          ? laneForSemanticType(r.item.semanticType as HubSemanticType)
          : null,
        // Per-principal state attached from the sparse user-state table.
        readAt: r.readAt,
        snoozedUntil: r.snoozedUntil,
        dismissedAt: r.dismissedAt,
      }));
  }

  // Action with optimistic concurrency + audit-before-side-effect (§5/§6/§10).
  async function recordAndAct(args: {
    companyId: string;
    hubItemId: string;
    action: string;
    expectedVersion: number;
    actorType: string;
    actorId: string;
    actorIsFounder: boolean; // route resolves via permissionService (founder OR board)
    authorityBasis?: string;
    reason?: string;
    idempotencyKey?: string;
    nextStatus: "resolved" | "archived" | "snoozed";
    // EXTERNAL/irreversible source-API relay; runs AFTER commit.
    sideEffect?: () => Promise<{ irreversibleSideEffects?: unknown; relayResult?: unknown }>;
  }) {
    const current = await db
      .select()
      .from(hubItems)
      .where(and(eq(hubItems.id, args.hubItemId), eq(hubItems.companyId, args.companyId)))
      .limit(1)
      .then((r) => r[0]);
    if (!current) throw notFound("Hub item not found");

    // AUTHORITY gate (§7): gated by the item TYPE's authority, not by ownership.
    // An Owner who lacks Authority is rejected HERE (the action layer), not just
    // at render — they must Route/Escalate instead.
    if (
      authorityForSemanticType(current.semanticType as HubSemanticType) === "founder" &&
      !args.actorIsFounder
    ) {
      throw forbidden("This decision requires founder/board authority — route or escalate it.");
    }

    // Phase 1 — atomic DB transaction: idempotency + version-guarded transition +
    // immutable audit. The audit is DURABLE before any external side-effect.
    const committed = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      if (args.idempotencyKey) {
        const dup = await tx
          .select({ id: hubAudit.id })
          .from(hubAudit)
          .where(
            and(
              eq(hubAudit.companyId, args.companyId),
              eq(hubAudit.idempotencyKey, args.idempotencyKey),
            ),
          )
          .limit(1)
          .then((r) => r[0]);
        if (dup) return { item: current, replayed: true as const };
      }
      // Guard on the CLIENT's expectedVersion: a stale token (≠ current.version)
      // misses the WHERE and yields a 409 — same idiom as the agents.ts UPDATE.
      // priorState records `current` (the true prior state) regardless of guard.
      const updated = await applyGuardedTransition(
        tx,
        current,
        args.nextStatus,
        {
          actorType: args.actorType,
          actorId: args.actorId,
          action: args.action,
          authorityBasis: args.authorityBasis ?? null,
          reason: args.reason ?? null,
          idempotencyKey: args.idempotencyKey ?? null,
        },
        args.expectedVersion,
      );
      return { item: updated, replayed: false as const };
    });
    if (committed.replayed) return committed.item; // no second side-effect on replay

    // Phase 2 — EXTERNAL/irreversible source-API side-effect AFTER commit. The
    // audit row is already durable, so a relay/source failure is recoverable (the
    // sweeper reconciles), NEVER an erased decision record. DB-only effects belong
    // inside Phase 1's transaction instead.
    if (args.sideEffect) await args.sideEffect();
    return committed.item;
  }

  // ── Reconciliation sweeper (sources = truth) ────────────────────────────────

  // A per-source-type reconciler reports, for a given hub item, whether its
  // backing source is terminal/gone (→ close) and the source's current
  // denormalized snapshot (summary + permission revision) for drift healing.
  interface SourceSnapshot {
    terminal: boolean; // source row is gone OR in a terminal state → close the hub item
    summary: string | null; // current denormalized summary (PRE-redaction)
    permissionRevision: string | null; // monotonic-ish source revision for drift detection
  }
  type SourceReconciler = (companyId: string, sourceId: string) => Promise<SourceSnapshot>;

  // approvals: pending = open; anything else (or a missing row) = terminal.
  const reconcileApproval: SourceReconciler = async (companyId, sourceId) => {
    const row = await db
      .select({ status: approvals.status, decisionNote: approvals.decisionNote, updatedAt: approvals.updatedAt })
      .from(approvals)
      .where(and(eq(approvals.id, sourceId), eq(approvals.companyId, companyId)))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (!row) return { terminal: true, summary: null, permissionRevision: null };
    return {
      terminal: row.status !== "pending",
      summary: row.decisionNote ?? null,
      permissionRevision: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
  };

  // heartbeat_runs: a run that is queued / scheduled_retry / running is still
  // live (non-terminal). A finished/dead run — or a missing row — is terminal.
  // The live set is derived from the shared HEARTBEAT_RUN_STATUSES (module top).
  const reconcileHeartbeatRun: SourceReconciler = async (companyId, sourceId) => {
    const row = await db
      .select({ status: heartbeatRuns.status, error: heartbeatRuns.error, updatedAt: heartbeatRuns.updatedAt })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.id, sourceId), eq(heartbeatRuns.companyId, companyId)))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (!row) return { terminal: true, summary: null, permissionRevision: null };
    return {
      terminal: !HEARTBEAT_LIVE_STATUSES.has(row.status),
      summary: row.error ?? null,
      permissionRevision: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
  };

  const SOURCE_RECONCILERS: Record<string, SourceReconciler> = {
    approval: reconcileApproval,
    heartbeat_run: reconcileHeartbeatRun,
  };

  // Sweep open hub items of `sourceType`: close terminal/gone-source items via the
  // SAME version-guarded path (system audit row) so a concurrent user action can't
  // lost-update; heal redacted-summary / sourcePermissionRevision drift (§18).
  // Sources are truth — this is the safety net for missed same-tx emits.
  async function reconcile(
    companyId: string,
    opts: { sourceType: string },
  ): Promise<{ healed: number; closed: number; refreshed: number }> {
    const reconciler = SOURCE_RECONCILERS[opts.sourceType];
    if (!reconciler) {
      throw unprocessable(`No reconciler registered for source type "${opts.sourceType}"`);
    }

    const open = await db
      .select()
      .from(hubItems)
      .where(
        and(
          eq(hubItems.companyId, companyId),
          eq(hubItems.sourceType, opts.sourceType),
          eq(hubItems.status, "open"),
        ),
      );

    let closed = 0;
    let refreshed = 0;
    for (const item of open) {
      if (!item.sourceId) continue;
      const snap = await reconciler(companyId, item.sourceId);

      if (snap.terminal) {
        // Close via the shared version-guarded transition (system actor). A
        // concurrent user action bumps the version → this UPDATE 409s; we swallow
        // it and let the next sweep reconcile (sources stay truth).
        try {
          await db.transaction(async (txRaw) => {
            const tx = txRaw as unknown as Db;
            await applyGuardedTransition(tx, item, "archived", {
              actorType: "system",
              actorId: "reconciler",
              action: "reconcile_close",
              authorityBasis: "system_reconciliation",
              reason: `source ${opts.sourceType} is gone/terminal`,
              sourceRevision: snap.permissionRevision,
            });
          });
          closed += 1;
        } catch (err) {
          // 409 from a concurrent action → skip; anything else rethrows.
          if (!(err instanceof Error) || (err as { status?: number }).status !== 409) throw err;
        }
        continue;
      }

      // Permission-drift healing: the source is still live but its denormalized
      // snapshot moved forward. This must be a NO-OP in steady state (no write/log
      // churn) and must NEVER clobber a meaningful emit-time summary with a null
      // source field (P1-2). Two independent, conservative heals:
      //
      //  (1) Revision: drift only when the source supplies a revision that is
      //      strictly NEWER than the stored one. Revisions are UTC ISO-8601
      //      timestamps → lexicographic compare == chronological. A null source
      //      revision, an equal revision, or a null STORED baseline (nothing to be
      //      "newer than") are all NOT drift — so items emitted without a revision
      //      are never force-refreshed every sweep.
      //  (2) Summary: heal only when the source provides a NON-null value; an
      //      empty/null source field leaves the existing summary untouched. The
      //      healed value is redacted-before-persist.
      const revisionIsNewer =
        snap.permissionRevision != null &&
        item.sourcePermissionRevision != null &&
        snap.permissionRevision > item.sourcePermissionRevision;

      const patch: { summary?: string; sourcePermissionRevision?: string } = {};
      if (revisionIsNewer) patch.sourcePermissionRevision = snap.permissionRevision!;
      if (snap.summary != null && snap.summary !== "") {
        const nextSummary = redactSecretsInString(snap.summary);
        if (nextSummary !== item.summary) patch.summary = nextSummary;
      }
      if (Object.keys(patch).length > 0) {
        await db.update(hubItems).set(patch).where(eq(hubItems.id, item.id));
        refreshed += 1;
      }
    }

    const healed = closed + refreshed;
    console.log(
      `[hub.reconcile] company=${companyId} source=${opts.sourceType} healed=${healed} (closed=${closed} refreshed=${refreshed})`,
    );
    return { healed, closed, refreshed };
  }

  // Public surface (declared last so every const above has evaluated).
  return { emit, sourceUniqueKey, resolveOwner, query, recordAndAct, reconcile };
}
