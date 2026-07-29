import type {
  PostAuthJourneyResult,
  PendingInvitation,
} from "@armyofagents/shared";

export type JourneyInput = {
  /** companyIds the user is already an active member of. */
  memberships: string[];
  /**
   * Open invitations the user is eligible to accept — ALREADY filtered by the
   * caller to: not-revoked/expired, verified-email-matched, and NOT rejected
   * (rejected join_requests must never route to `invited` — RB7/RB9).
   */
  pendingInvitations: PendingInvitation[];
  /** The company a deep-linked /invite/:token resolved to, if any. */
  deepLinkCompanyId?: string | null;
  /** Whether the authenticated user may provision a company on this instance. */
  canCreateCompany: boolean;
};

/**
 * Pure post-auth journey resolver (RB7/RB9). Precedence:
 *   membership → returning (invitations still surfaced, never auto-routed)
 *   else open invitation → invited (deep-linked company preferred, else first)
 *   else founder
 * The invite token is never returned (revC RC3); it lives in a server-side
 * handoff consumed at accept time.
 */
export function resolvePostAuthJourney(
  input: JourneyInput
): PostAuthJourneyResult {
  if (input.memberships.length > 0) {
    return {
      schemaVersion: 1,
      journey: "returning",
      targetCompanyId: input.memberships[0],
      pendingInvitations: input.pendingInvitations,
      inviteToken: null,
      canCreateCompany: input.canCreateCompany,
      resumeFirstRunCompanyId: null,
    };
  }

  if (input.pendingInvitations.length > 0) {
    const target =
      input.deepLinkCompanyId &&
      input.pendingInvitations.some(
        (i) => i.companyId === input.deepLinkCompanyId
      )
        ? input.deepLinkCompanyId
        : input.pendingInvitations[0].companyId;
    return {
      schemaVersion: 1,
      journey: "invited",
      targetCompanyId: target,
      pendingInvitations: input.pendingInvitations,
      inviteToken: null,
      canCreateCompany: false,
      resumeFirstRunCompanyId: null,
    };
  }

  if (input.canCreateCompany) {
    return {
      schemaVersion: 1,
      journey: "founder",
      targetCompanyId: null,
      pendingInvitations: [],
      inviteToken: null,
      canCreateCompany: true,
      resumeFirstRunCompanyId: null,
    };
  }

  return {
    schemaVersion: 1,
    journey: "access_required",
    targetCompanyId: null,
    pendingInvitations: [],
    inviteToken: null,
    canCreateCompany: false,
    resumeFirstRunCompanyId: null,
  };
}
