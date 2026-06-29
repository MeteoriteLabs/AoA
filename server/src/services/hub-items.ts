import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { hubItems, hubItemUserState, hubAudit } from "@armyofagents/db";
import type { HubLane, HubSemanticType, HubOwnerPool } from "@armyofagents/shared";
import { laneForSemanticType, authorityForSemanticType } from "@armyofagents/shared";
import { redactSecretsInString } from "../redaction.js";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { orgHierarchyService } from "./org-hierarchy.js";
import { permissionService } from "./permissions.js";

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

  return { emit, sourceUniqueKey, resolveOwner };
}
