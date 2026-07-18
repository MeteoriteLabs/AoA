// Post-auth journey + onboarding shared contracts.
//
// Authority: revC > revB > revA > stage docs. revB §1.4 adds `pendingInvitations`
// so a *returning* user who also has open invites still sees them (surfaced in
// the Lobby, not auto-routed).

export const ONBOARDING_JOURNEYS = ["founder", "invited"] as const;
export type OnboardingJourney = (typeof ONBOARDING_JOURNEYS)[number];

/**
 * All onboarding states. `JOIN_REQUESTED` (revC RC2) is invited-only. The
 * WALKTHROUGH_* / *_COMPLETE tail is reserved for Phase 2 and not driven in
 * Phase 1. The per-journey ORDERED sequences below are what the monotonic
 * advance validates against.
 */
export const ONBOARDING_STATES = [
  "AUTHENTICATED",
  "PROFILE_SET",
  "JOIN_REQUESTED",
  "ORGANIZATION_CREATED",
  "ENVIRONMENT_READY",
  "COMMANDER_SELECTED",
  "COMMANDER_VERIFIED",
  "DEPARTMENT_CREATED",
  "AGENT_ASSIGNED",
  "SETUP_COMPLETE",
  // Phase 2 (reserved — not implemented in Phase 1):
  "WALKTHROUGH_STARTED",
  "DISCUSSION_ANALYZED",
  "CLARIFICATIONS_RESOLVED",
  "SCOPE_CREATED",
  "SCOPE_APPROVED",
  "MEMORY_SAVED",
  "TASKS_CREATED",
  "AGENT_EXECUTION_STARTED",
  "ONBOARDING_COMPLETE",
] as const;
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

/** Ordered founder-journey sequence Phase 1 actually drives. */
export const FOUNDER_PHASE1_STATES: OnboardingState[] = [
  "AUTHENTICATED",
  "PROFILE_SET",
  "ORGANIZATION_CREATED",
  "ENVIRONMENT_READY",
  "COMMANDER_SELECTED",
  "COMMANDER_VERIFIED",
  "DEPARTMENT_CREATED",
  "AGENT_ASSIGNED",
  "SETUP_COMPLETE",
];

/** Ordered invited-journey sequence (revC RC2 — approval-gated completion). */
export const INVITED_PHASE1_STATES: OnboardingState[] = [
  "AUTHENTICATED",
  "PROFILE_SET",
  "JOIN_REQUESTED",
  "SETUP_COMPLETE",
];

/** The ordered state list for a journey (used by the monotonic advance). */
export function orderedStatesFor(journey: OnboardingJourney): OnboardingState[] {
  return journey === "invited" ? INVITED_PHASE1_STATES : FOUNDER_PHASE1_STATES;
}

/**
 * WS0b — which door the founder chose on the Map (built in WS9). Persisted on
 * `onboarding_progress.firstRunPersona` so In-flight vs Explorer resume
 * correctly across a reload.
 */
export const FIRST_RUN_PERSONAS = ["manual", "in_flight", "explorer"] as const;
export type FirstRunPersona = (typeof FIRST_RUN_PERSONAS)[number];

/** An open invitation the authenticated user is eligible to accept. */
export type PendingInvitation = {
  companyId: string;
  companyName: string;
  /** The join_request (or invite) id backing this invitation. */
  inviteId: string;
  /** The role the invite grants (founder | team_lead | team_member). */
  role: string;
  createdAt: string;
  /**
   * True when a join_request is already filed (the user accepted the invite
   * link). False = an open invite detected by verified-email match — requires
   * explicit consent before joining.
   */
  filed: boolean;
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
