import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { authUsers, invites, joinRequests } from "@armyofagents/db";
import { parseInviteRoleMetadata } from "../services/team.js";
import {
  approveHumanJoinRequestTx,
  autoAdmitApprovalIdentity,
  buildHumanJoinApprovalServices,
} from "../services/join-approval.js";

/**
 * Invited auto-admit (spec §8): the invitation carries the approval. Fired by
 * the InvitedJoinTerminal after the profile step. Self-scoped: only finalizes
 * the CALLER's own pending human join_request. Admits iff the caller's VERIFIED
 * email matches the invited email (case-insensitive), computed fresh here —
 * else the request stays pending for founder approval. Invite validity was
 * established AT ACCEPT (10-minute TTL, consumed on accept) — expiresAt is NOT
 * re-checked; only a defensive revokedAt check remains.
 */
export function onboardingJoinRoutes(db: Db): Router {
  const router = Router();

  router.post("/onboarding/join/finalize", async (req: Request, res: Response) => {
    const actor = req.actor;
    if (actor.type !== "board" || !actor.userId) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const companyId = typeof body.companyId === "string" ? body.companyId : "";
    if (!companyId) {
      res.status(400).json({ error: "companyId is required" });
      return;
    }

    const request = await db
      .select()
      .from(joinRequests)
      .where(
        and(
          eq(joinRequests.companyId, companyId),
          eq(joinRequests.requestType, "human"),
          eq(joinRequests.requestingUserId, actor.userId),
        ),
      )
      .orderBy(desc(joinRequests.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!request) {
      res.status(404).json({ error: "no join request for this company" });
      return;
    }
    if (request.status === "approved") {
      res.json({ admitted: true, status: "approved" });
      return;
    }
    if (request.status === "rejected") {
      res.json({ admitted: false, status: "rejected" });
      return;
    }

    const invite = await db
      .select()
      .from(invites)
      .where(eq(invites.id, request.inviteId))
      .then((rows) => rows[0] ?? null);
    // Validity was established AT ACCEPT (accept enforces the 10-minute TTL and
    // consumes the invite). Do NOT re-check expiresAt here — the clock keeps
    // ticking through sign-in + the profile form and would degrade nearly every
    // real auto-admit to pending (spec §9). Keep only a defensive revokedAt check.
    if (!invite || invite.revokedAt) {
      res.json({ admitted: false, status: "invite_invalid" });
      return;
    }

    const user = await db
      .select({ email: authUsers.email, emailVerified: authUsers.emailVerified })
      .from(authUsers)
      .where(eq(authUsers.id, actor.userId))
      .then((rows) => rows[0] ?? null);
    const invitedEmail =
      parseInviteRoleMetadata(invite.defaultsPayload as Record<string, unknown> | null)?.email ?? null;
    const matched = Boolean(
      user?.emailVerified &&
        typeof user.email === "string" &&
        invitedEmail &&
        user.email.trim().toLowerCase() === invitedEmail.trim().toLowerCase(),
    );
    if (!matched) {
      res.json({ admitted: false, status: "pending" });
      return;
    }

    const approved = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      return approveHumanJoinRequestTx(txDb, buildHumanJoinApprovalServices(txDb), {
        companyId,
        requestId: request.id,
        requestingUserId: actor.userId as string,
        invite: {
          id: invite.id,
          defaultsPayload: invite.defaultsPayload as Record<string, unknown> | null,
        },
        // The preset factory keeps the three-identity contract unmisusable
        // (never impersonates the founder or the invitee).
        ...autoAdmitApprovalIdentity(),
      });
    });
    res.json(approved ? { admitted: true, status: "approved" } : { admitted: false, status: "pending" });
  });

  return router;
}
