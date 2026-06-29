import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { hubItems, hubItemUserState, hubAudit } from "@armyofagents/db";
import type { HubItemStatus, HubLane, HubSemanticType, HubOwnerPool } from "@armyofagents/shared";
import {
  HUB_SEMANTIC_TYPES,
  laneForSemanticType,
  authorityForSemanticType,
} from "@armyofagents/shared";
import type { UserRole } from "@armyofagents/shared";
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
    return { ...row, lane: laneForSemanticType(a.semanticType) };
  }

  // ── Query / Action / Reconcile ──────────────────────────────────────────────

  return { emit, sourceUniqueKey, resolveOwner, query, recordAndAct };

  // RBAC-scoped, hot-set (open by default), per-principal-state-joined query.
  // Hoisted so it can sit after the public `return` for readability — function
  // declarations are hoisted within hubItemsService's closure.
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
      .orderBy(sql`${hubItems.createdAt} DESC`);

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
      const updated = await tx
        .update(hubItems)
        .set({
          status: args.nextStatus,
          version: current.version + 1,
          resolvedAt: args.nextStatus === "resolved" ? new Date() : current.resolvedAt,
          archivedAt: args.nextStatus === "archived" ? new Date() : current.archivedAt,
        })
        .where(and(eq(hubItems.id, args.hubItemId), eq(hubItems.version, args.expectedVersion)))
        .returning()
        .then((r) => r[0] ?? null);
      if (!updated) {
        throw conflict("This item was changed by someone else. Reload and retry.", {
          currentVersion: current.version,
        });
      }
      await tx.insert(hubAudit).values({
        companyId: args.companyId,
        hubItemId: args.hubItemId,
        actorType: args.actorType,
        actorId: args.actorId,
        action: args.action,
        authorityBasis: args.authorityBasis ?? null,
        reason: args.reason ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        priorState: { status: current.status, version: current.version },
      });
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
}
