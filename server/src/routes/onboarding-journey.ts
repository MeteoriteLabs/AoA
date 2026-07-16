import { Router, type Request, type Response } from "express";
import type { Db } from "@armyofagents/db";
import { authUsers, companyMemberships, joinRequests, invites, companies } from "@armyofagents/db";
import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { PostAuthJourneyResult, PendingInvitation } from "@armyofagents/shared";
import { resolvePostAuthJourney } from "../services/post-auth-journey.js";

const TEAM_INVITE_KEY = "teamInvite";

function roleFromInviteDefaults(defaults: Record<string, unknown> | null | undefined): string {
  const team = (defaults?.[TEAM_INVITE_KEY] ?? {}) as Record<string, unknown>;
  const role = team.role;
  return typeof role === "string" && role.length > 0 ? role : "team_member";
}

/**
 * Resolve the post-auth journey for a user (A5 + RB7/RB9).
 *
 * - `returning` if the user has any active company membership, or if an
 *   instance admin can see an existing company through the global admin bypass.
 * - `invited` if the user has an open, non-rejected human join_request they made
 *   (or, only when their email is verified, one snapshotting their email), OR —
 *   tokenless entry — an OPEN company-join invite matching their verified email
 *   (the user signed in without ever clicking the invite link, so no
 *   join_request exists yet; finalize claims it).
 * - `founder` otherwise.
 *
 * Verified-email gating reads `authUsers.emailVerified` directly (the session
 * result does not expose it — RC4). Rejected/approved requests are excluded by
 * the `status = 'pending_approval'` filter (RB9). The full invite-token deep-link
 * handoff (RC3) is wired in Stage D; `deepLinkCompanyId` is accepted here.
 */
export async function getJourneyForUser(
  db: Db,
  args: {
    userId: string;
    deepLinkCompanyId?: string | null;
    isInstanceAdmin?: boolean;
  },
): Promise<PostAuthJourneyResult> {
  const [user] = await db
    .select({ email: authUsers.email, emailVerified: authUsers.emailVerified })
    .from(authUsers)
    .where(eq(authUsers.id, args.userId))
    .limit(1);

  const email = user?.email ?? null;
  const emailVerified = Boolean(user?.emailVerified);

  const memberships = await db
    .select({ companyId: companyMemberships.companyId })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, args.userId),
        eq(companyMemberships.status, "active"),
      ),
    );

  // Match the user's own pending human requests, plus (verified email only) any
  // pending human request snapshotting their verified email.
  const emailMatch =
    emailVerified && email
      ? sql`lower(${joinRequests.requestEmailSnapshot}) = lower(${email})`
      : sql`false`;

  const pendingRows = await db
    .select({
      inviteId: joinRequests.inviteId,
      companyId: joinRequests.companyId,
      companyName: companies.name,
      createdAt: joinRequests.createdAt,
      defaults: invites.defaultsPayload,
    })
    .from(joinRequests)
    .innerJoin(companies, eq(companies.id, joinRequests.companyId))
    .innerJoin(invites, eq(invites.id, joinRequests.inviteId))
    .where(
      and(
        eq(joinRequests.requestType, "human"),
        eq(joinRequests.status, "pending_approval"),
        or(eq(joinRequests.requestingUserId, args.userId), emailMatch),
      ),
    );

  const pendingInvitations: PendingInvitation[] = pendingRows.map((r) => ({
    companyId: r.companyId,
    companyName: r.companyName ?? "",
    inviteId: r.inviteId,
    role: roleFromInviteDefaults(r.defaults),
    createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as string)).toISOString(),
  }));

  // Tokenless invited entry: ALSO detect OPEN company-join invites matching the
  // caller's VERIFIED email — pre-accept, so no join_request exists yet. Expiry
  // MUST gate detection here (nothing was accepted yet), unlike filed requests
  // whose validity was established at token-accept.
  const openInviteRows =
    emailVerified && email
      ? await db
          .select({
            companyId: invites.companyId,
            companyName: companies.name,
            inviteId: invites.id,
            createdAt: invites.createdAt,
            defaults: invites.defaultsPayload,
          })
          .from(invites)
          .innerJoin(companies, eq(companies.id, invites.companyId))
          .where(
            and(
              isNull(invites.acceptedAt),
              isNull(invites.revokedAt),
              gt(invites.expiresAt, new Date()),
              eq(invites.inviteType, "company_join"),
              inArray(invites.allowedJoinTypes, ["human", "both"]),
              isNotNull(invites.companyId),
              sql`lower(${invites.defaultsPayload} -> 'teamInvite' ->> 'email') = lower(${email})`,
            ),
          )
          .orderBy(invites.createdAt, invites.companyId)
      : [];

  // Merge open invites that don't already have a filed request (dedupe by
  // company — the filed join_request wins). For these entries `inviteId` is the
  // INVITE id, not a join_request id (PendingInvitation's field covers both).
  for (const r of openInviteRows) {
    if (!r.companyId) continue;
    if (pendingInvitations.some((p) => p.companyId === r.companyId)) continue;
    pendingInvitations.push({
      companyId: r.companyId,
      companyName: r.companyName ?? "",
      inviteId: r.inviteId,
      role: roleFromInviteDefaults(r.defaults),
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as string)).toISOString(),
    });
  }

  // Deterministic ordering when multiple invitations match.
  pendingInvitations.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.companyId.localeCompare(b.companyId),
  );

  let returningCompanyIds = memberships.map((membership) => membership.companyId);
  if (returningCompanyIds.length === 0 && args.isInstanceAdmin) {
    const adminVisibleCompanies = await db
      .select({ companyId: companies.id })
      .from(companies)
      .limit(1);
    returningCompanyIds = adminVisibleCompanies.map((company) => company.companyId);
  }

  return resolvePostAuthJourney({
    memberships: returningCompanyIds,
    pendingInvitations,
    deepLinkCompanyId: args.deepLinkCompanyId ?? null,
  });
}

/** GET /api/onboarding/journey — board-scoped, self-only. */
export function onboardingJourneyRoutes(db: Db): Router {
  const router = Router();
  router.get("/onboarding/journey", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const result = await getJourneyForUser(db, {
      userId: actor.userId,
      isInstanceAdmin: actor.isInstanceAdmin === true,
    });
    res.json(result);
  });
  return router;
}
