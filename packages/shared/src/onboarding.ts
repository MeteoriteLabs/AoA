// Post-auth journey + onboarding shared contracts.
//
// Authority: revC > revB > revA > stage docs. revB §1.4 adds `pendingInvitations`
// so a *returning* user who also has open invites still sees them (surfaced in
// the Lobby, not auto-routed).

export type OnboardingJourney = "founder" | "invited";

/** An open invitation the authenticated user is eligible to accept. */
export type PendingInvitation = {
  companyId: string;
  companyName: string;
  /** The join_request (or invite) id backing this invitation. */
  inviteId: string;
  /** The role the invite grants (founder | team_lead | team_member). */
  role: string;
  createdAt: string;
};

/**
 * The result of the post-auth router. `journey` decides the destination:
 * - `returning` — has ≥1 membership; land in the Lobby (with `pendingInvitations`).
 * - `invited`   — no membership but an open, verified-email-matched invite/join_request.
 * - `founder`   — brand new, no membership and no invite.
 *
 * The invite token is NEVER returned here — it lives in a server-side handoff
 * record consumed at accept time (revC RC3). `inviteToken` stays for shape
 * compatibility and is always null.
 */
export type PostAuthJourneyResult = {
  journey: OnboardingJourney | "returning";
  targetCompanyId: string | null;
  pendingInvitations: PendingInvitation[];
  inviteToken?: string | null;
};
