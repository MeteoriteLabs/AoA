// Mirrors accessService shape (server/src/services/access.ts:42).
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { organizationMemberships } from "@armyofagents/db";
import type { OrganizationRole } from "@armyofagents/shared";

export type OrgCapability =
  | "company:create" | "company:delete"
  | "org:member:manage" | "org:role:set" | "org:transfer" | "org:dissolve"
  | "billing:manage"
  | "company:list:all" | "company:list:scoped" | "company:list:metadata";

const MATRIX: Record<OrganizationRole, ReadonlySet<OrgCapability>> = {
  owner: new Set<OrgCapability>([
    "company:create", "company:delete", "org:member:manage", "org:role:set",
    "org:transfer", "org:dissolve", "billing:manage", "company:list:all",
  ]),
  admin: new Set<OrgCapability>([
    "company:create", "company:delete", "org:member:manage", "org:role:set", "company:list:all",
  ]),
  member: new Set<OrgCapability>(["company:list:scoped"]),
  billing: new Set<OrgCapability>(["billing:manage", "company:list:metadata"]),
};

export function orgRoleCan(role: OrganizationRole, cap: OrgCapability): boolean {
  return MATRIX[role]?.has(cap) ?? false;
}

export function organizationAccessService(db: Db) {
  async function getMembership(organizationId: string, userId: string) {
    return db
      .select()
      .from(organizationMemberships)
      .where(and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
      ))
      .then((rows: any[]) => rows[0] ?? null);
  }

  async function canOrg(organizationId: string, userId: string | null | undefined, cap: OrgCapability): Promise<boolean> {
    if (!userId) return false;
    const m = await getMembership(organizationId, userId);
    if (!m || m.status !== "active") return false;
    return orgRoleCan(m.role as OrganizationRole, cap);
  }

  async function ensureOrgMembership(
    organizationId: string, userId: string, role: OrganizationRole = "member", status = "active",
  ) {
    // Race-safe + idempotent: P1's 0187 backfill and access.ensureRealOperator
    // (Task 10) may also insert the SAME (organizationId,userId) owner row, so the
    // insert uses onConflictDoNothing on the P1 unique index and re-reads. Never
    // downgrades an existing owner to a weaker role on conflict.
    await db.insert(organizationMemberships)
      .values({ organizationId, userId, role, status })
      .onConflictDoNothing({
        target: [organizationMemberships.organizationId, organizationMemberships.userId],
      });
    const existing = await getMembership(organizationId, userId);
    if (existing && (existing.role !== role || existing.status !== status)) {
      // Only promote (never clobber an owner with a member write): callers pass the
      // intended role explicitly, and self-serve create always passes "owner".
      if (!(existing.role === "owner" && role !== "owner")) {
        await db.update(organizationMemberships)
          .set({ role, status, updatedAt: new Date() })
          .where(eq(organizationMemberships.id, existing.id));
      }
    }
    return existing?.id ?? (await getMembership(organizationId, userId))!.id;
  }

  async function ensureOrgOwner(organizationId: string, userId: string) {
    return ensureOrgMembership(organizationId, userId, "owner", "active");
  }

  async function listOrgMemberships(userId: string) {
    return db.select().from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "active")));
  }

  return { getMembership, canOrg, ensureOrgMembership, ensureOrgOwner, listOrgMemberships };
}
