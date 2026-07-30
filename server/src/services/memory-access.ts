/**
 * RBAC memory-access filter (enterprise memory model, P0).
 * Pure, dependency-free. Wired into ORG + CREW run paths in P1 as a
 * pre-ranking gate so an actor never sees — nor can rank/leak — memory it
 * isn't entitled to. The db-backed actor resolvers + SQL conditions live in
 * a separate memory-access-sql.ts (P1) to keep this module drizzle-free.
 * See docs/aoa/plans/2026-07-30-memory-enterprise-overview.md.
 */
export type MemoryActor =
  | { kind: "founder" }
  | { kind: "team_lead"; userId: string; departmentIds: string[] }
  | { kind: "team_member"; userId: string; departmentIds: string[] }
  | { kind: "commander"; userId: string; departmentIds: string[] }
  | { kind: "agent"; agentId: string; departmentIds: string[] };

export interface AccessibleMemoryRow {
  layer: string | null;
  visibility: string;
  departmentId: string | null;
  projectId: string | null;
  ownerType?: string | null;
  ownerId?: string | null;
  agentId: string | null;
  invalidatedAt?: Date | null;
}

function isPrivate(item: AccessibleMemoryRow): boolean {
  return item.ownerType === "user" || item.ownerType === "agent" || item.agentId != null;
}

/** True iff `actor` is entitled to see `item` in normal retrieval. */
export function canActorSee(item: AccessibleMemoryRow, actor: MemoryActor): boolean {
  // Correction/forgetting: invalidated items never surface (history stays in the row).
  if (item.invalidatedAt != null) return false;

  if (isPrivate(item)) {
    if (actor.kind === "agent") return item.agentId === actor.agentId;
    if (actor.kind === "founder") return false; // others' private hidden in the normal path (break-glass is separate)
    return item.ownerType === "user" && item.ownerId === actor.userId;
  }

  // Non-private:
  if (item.layer === "identity") return true; // company core, everyone
  if (item.visibility === "company") return true; // explicitly company-wide
  if (actor.kind === "founder") return true; // founder sees all non-private
  // scoped → department match
  return item.departmentId != null && actor.departmentIds.includes(item.departmentId);
}

export function filterMemoryForActor<T extends AccessibleMemoryRow>(
  items: T[],
  actor: MemoryActor,
): T[] {
  return items.filter((it) => canActorSee(it, actor));
}
