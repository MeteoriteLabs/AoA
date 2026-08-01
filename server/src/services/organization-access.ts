// Mirrors accessService shape (server/src/services/access.ts:42).
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { operatorBreakGlassGrants, organizationMemberships } from "@armyofagents/db";
import type { OrganizationRole } from "@armyofagents/shared";

export type OrgCapability =
  | "company:create" | "company:delete"
  | "org:member:manage" | "org:role:set" | "org:transfer" | "org:dissolve"
  | "billing:manage"
  | "company:list:all" | "company:list:scoped" | "company:list:metadata"
  // Phase 5: fleet inventory (execution_targets) management + read-only spend
  // visibility. Fleet management is an infra/admin concern (owner+admin);
  // spend is financial visibility, so it also reaches the billing role.
  | "execution_target:manage" | "org:spend:view";

const MATRIX: Record<OrganizationRole, ReadonlySet<OrgCapability>> = {
  owner: new Set<OrgCapability>([
    "company:create", "company:delete", "org:member:manage", "org:role:set",
    "org:transfer", "org:dissolve", "billing:manage", "company:list:all",
    "execution_target:manage", "org:spend:view",
  ]),
  admin: new Set<OrgCapability>([
    "company:create", "company:delete", "org:member:manage", "org:role:set", "company:list:all",
    "execution_target:manage", "org:spend:view",
  ]),
  member: new Set<OrgCapability>(["company:list:scoped"]),
  billing: new Set<OrgCapability>(["billing:manage", "company:list:metadata", "org:spend:view"]),
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
    // Break-glass provenance gate: a break-glass materialized membership writes a
    // plain org `owner` row (createdByBreakGlass=true) purely so the operator
    // passes assertTenantMembership. The org CAPABILITY plane must NOT confer
    // owner caps straight from that row — authorization is decided at CHECK TIME
    // against the live grant, mirroring hasActiveBreakGlass on the data plane.
    if (m.createdByBreakGlass === true) {
      // Bound by the materialized role too, so a future non-owner materialization
      // can never over-grant beyond what its org role allows.
      if (!orgRoleCan(m.role as OrganizationRole, cap)) return false;
      // Confer org-wide capabilities ONLY when a LIVE, ORG-WIDE grant exists
      // (companyId IS NULL, not revoked, not expired). A company-scoped grant
      // (companyId set) confers ZERO org-wide caps — that access is enforced
      // separately by assertCompanyAccess + hasActiveBreakGlass on the data plane.
      const liveOrgWide = await db
        .select({ id: operatorBreakGlassGrants.id })
        .from(operatorBreakGlassGrants)
        .where(and(
          eq(operatorBreakGlassGrants.organizationId, organizationId),
          eq(operatorBreakGlassGrants.operatorUserId, userId),
          isNull(operatorBreakGlassGrants.companyId),
          isNull(operatorBreakGlassGrants.revokedAt),
          gt(operatorBreakGlassGrants.expiresAt, new Date()),
        ));
      return liveOrgWide.length > 0;
    }
    return orgRoleCan(m.role as OrganizationRole, cap);
  }

  async function ensureOrgMembership(
    organizationId: string, userId: string, role: OrganizationRole = "member", status = "active",
  ) {
    // Race-safe + idempotent: P1's 0188 backfill and access.ensureRealOperator
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
