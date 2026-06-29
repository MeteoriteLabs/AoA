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

  // ── Query ───────────────────────────────────────────────────────────────────

  return { emit, sourceUniqueKey, resolveOwner, query };

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
}
