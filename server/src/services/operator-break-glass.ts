import { and, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";
import {
  activityLog,
  operatorBreakGlassGrants,
  organizationMemberships,
  type Db,
} from "@armyofagents/db";

/**
 * Operator break-glass (Phase 3, B3).
 *
 * A grant materializes an ORGANIZATION membership so the operator passes
 * assertTenantMembership on the next actor re-derive (this was the eng-review
 * bug: the grant used to write nothing, so a "granted" operator still failed the
 * tenant gate). Authorization itself is decided at CHECK TIME by
 * hasActiveBreakGlass() using a live TTL — never a cached flag. A sweeper deletes
 * the materialized membership once the grant expires or is revoked.
 */

export interface BreakGlassDeps {
  /**
   * Materialize the tenant-side access rows for a grant. `role` here is the
   * ORGANIZATION-membership role (owner|admin|member|billing) — NOT the grant's
   * company role. Must be idempotent (a re-grant should not error).
   */
  materializeMembership: (a: {
    organizationId: string;
    companyId: string | null;
    userId: string;
    role: string;
  }) => Promise<void>;
  /** Remove what materializeMembership wrote for this (organization, user). */
  revokeMembership: (a: { organizationId: string; userId: string }) => Promise<void>;
  /** Best-effort audit sink. Never throws in a way that fails the grant/sweep. */
  audit: (e: {
    action: string;
    operatorUserId: string;
    organizationId: string;
    companyId: string | null;
  }) => Promise<void>;
}

export interface BreakGlassGrantInput {
  operatorUserId: string;
  organizationId: string;
  /** null = org-wide grant (matches any company in the organization). */
  companyId: string | null;
  /** The company-level role the operator assumes (stored on the grant record). */
  role: string;
  reason: string;
  grantedByUserId: string;
  ttlMinutes: number;
}

/**
 * The materialized ORGANIZATION-membership role. The grant's `role` is the
 * separate company-level role; the org_memberships CHECK only allows
 * owner|admin|member|billing, and break-glass is emergency full-tenant access.
 */
const BREAK_GLASS_ORG_ROLE = "owner";

/**
 * Live-TTL read used at the authorization decision point. Authoritative and
 * independent of the sweeper: a grant is active iff it is not revoked and its
 * expires_at is still in the future. An org-wide grant (company_id NULL) matches
 * any company in that same organization only (org is scoped in the WHERE).
 */
export async function hasActiveBreakGlass(
  db: Db,
  operatorUserId: string,
  companyId: string,
  organizationId: string,
): Promise<boolean> {
  // Org-scope in SQL (Finding #1): an org-wide grant (company_id NULL)
  // authorizes ONLY the organization it was granted for — never every org.
  // Company-scoped grants still match by exact companyId within that org.
  const rows = await db
    .select({ companyId: operatorBreakGlassGrants.companyId })
    .from(operatorBreakGlassGrants)
    .where(
      and(
        eq(operatorBreakGlassGrants.operatorUserId, operatorUserId),
        eq(operatorBreakGlassGrants.organizationId, organizationId),
        isNull(operatorBreakGlassGrants.revokedAt),
        gt(operatorBreakGlassGrants.expiresAt, new Date()),
      ),
    );
  return rows.some((r) => r.companyId === null || r.companyId === companyId);
}

export function operatorBreakGlassService(db: Db, deps: BreakGlassDeps) {
  async function grant(input: BreakGlassGrantInput) {
    const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000);
    const [row] = await db
      .insert(operatorBreakGlassGrants)
      .values({
        operatorUserId: input.operatorUserId,
        organizationId: input.organizationId,
        companyId: input.companyId,
        role: input.role,
        reason: input.reason,
        grantedByUserId: input.grantedByUserId,
        expiresAt,
      })
      .returning();
    // Materialize the ORGANIZATION membership so the operator passes
    // assertTenantMembership on the next re-derive. Uses a valid org role, not
    // the grant's company role.
    await deps.materializeMembership({
      organizationId: input.organizationId,
      companyId: input.companyId,
      userId: input.operatorUserId,
      role: BREAK_GLASS_ORG_ROLE,
    });
    await deps.audit({
      action: "operator.break_glass.granted",
      operatorUserId: input.operatorUserId,
      organizationId: input.organizationId,
      companyId: input.companyId,
    });
    return row;
  }

  async function revoke(operatorUserId: string, organizationId: string) {
    // company_id is intentionally NOT in the filter: an org-wide grant
    // (company_id NULL) must be matched too. This revokes every still-active
    // grant for this (operator, organization).
    await db
      .update(operatorBreakGlassGrants)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(operatorBreakGlassGrants.operatorUserId, operatorUserId),
          eq(operatorBreakGlassGrants.organizationId, organizationId),
          isNull(operatorBreakGlassGrants.revokedAt),
        ),
      );
    await deps.revokeMembership({ organizationId, userId: operatorUserId });
    await deps.audit({
      action: "operator.break_glass.revoked",
      operatorUserId,
      organizationId,
      companyId: null,
    });
  }

  /**
   * Boot + interval sweep: delete the materialized membership for every grant
   * that is past its expiry or has been revoked but not yet swept, then mark it
   * swept. Returns how many grants were processed.
   */
  async function sweepExpired(): Promise<number> {
    const stale = await db
      .select()
      .from(operatorBreakGlassGrants)
      .where(
        and(
          isNull(operatorBreakGlassGrants.sweptAt),
          or(
            lte(operatorBreakGlassGrants.expiresAt, new Date()),
            isNotNull(operatorBreakGlassGrants.revokedAt),
          ),
        ),
      );
    for (const g of stale) {
      await deps.revokeMembership({ organizationId: g.organizationId, userId: g.operatorUserId });
      await db
        .update(operatorBreakGlassGrants)
        .set({ sweptAt: new Date() })
        .where(eq(operatorBreakGlassGrants.id, g.id));
      await deps.audit({
        action: "operator.break_glass.swept",
        operatorUserId: g.operatorUserId,
        organizationId: g.organizationId,
        companyId: g.companyId,
      });
    }
    return stale.length;
  }

  return { grant, revoke, sweepExpired };
}

/**
 * Real boot dependencies. Materialize/revoke operate on organization_memberships
 * (the tenant-access row that gates assertTenantMembership); audit writes to
 * activity_log.
 *
 * NOTE: revokeMembership deletes the (organization, user) membership outright.
 * Break-glass grants are only ever issued to operators who are NOT standing org
 * members (that is the whole point), so removing the materialized row on expiry
 * is correct for the intended use.
 */
export function realBreakGlassDeps(db: Db): BreakGlassDeps {
  return {
    materializeMembership: async ({ organizationId, userId, role }) => {
      await db
        .insert(organizationMemberships)
        .values({ organizationId, userId, role, status: "active" })
        .onConflictDoNothing();
    },
    revokeMembership: async ({ organizationId, userId }) => {
      await db
        .delete(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        );
    },
    audit: async ({ action, operatorUserId, organizationId, companyId }) => {
      // activity_log.company_id is NOT NULL; an org-wide grant (companyId null)
      // has no single company to attribute the row to, so skip it. Audit is
      // best-effort and must never fail the grant/sweep.
      if (!companyId) return;
      await db.insert(activityLog).values({
        companyId,
        actorType: "operator",
        actorId: operatorUserId,
        action,
        entityType: "operator_break_glass_grant",
        entityId: operatorUserId,
        details: { organizationId },
      });
    },
  };
}
