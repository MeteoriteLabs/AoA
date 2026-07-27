import { z } from "zod";

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

/**
 * Ordered founder-journey sequence Phase 1 actually drives.
 *
 * WS0c: `DEPARTMENT_CREATED`/`AGENT_ASSIGNED` were removed from this ordered
 * sequence — the founder wizard now ends at `COMMANDER_VERIFIED` (spine only)
 * and hands off to Home, which owns the persona-driven department/agent/first-
 * job tail as its own domain writes (NOT gated `OnboardingState` advances).
 * Both values stay in the `ONBOARDING_STATES` union above (still valid, e.g.
 * on pre-WS0c rows) — they're just no longer part of the monotonic advance
 * this array drives. See docs/aoa/plans/2026-07-18-ws0c-onboarding-state-machine-design.md.
 */
export const FOUNDER_PHASE1_STATES: OnboardingState[] = [
  "AUTHENTICATED",
  "PROFILE_SET",
  "ORGANIZATION_CREATED",
  "ENVIRONMENT_READY",
  "COMMANDER_SELECTED",
  "COMMANDER_VERIFIED",
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
export function orderedStatesFor(
  journey: OnboardingJourney
): OnboardingState[] {
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
type LegacyPostAuthJourneyResult = {
  journey: OnboardingJourney | "returning";
  targetCompanyId: string | null;
  pendingInvitations: PendingInvitation[];
  inviteToken?: string | null;
  /**
   * A `returning` founder whose OWN first-run isn't complete for one of their
   * member companies (spine done but the persona/in-flight tail was abandoned).
   * The index gate routes them back into `/onboarding` to finish the tail there
   * rather than stranding them on a dashboard that no longer hosts onboarding.
   * Only ever set for `journey === "returning"`; null otherwise. Because
   * `onboarding_progress` is keyed by `(userId, companyId)`, only the founder of
   * a company has a row for it — so this never mis-fires for team members or the
   * instance-admin company-visibility bypass.
   */
  resumeFirstRunCompanyId?: string | null;
};

export const pendingInvitationSchema = z.object({
  companyId: z.string().min(1),
  companyName: z.string(),
  inviteId: z.string().min(1),
  role: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  filed: z.boolean(),
});

const postAuthJourneyBaseSchema = z.object({
  schemaVersion: z.literal(1),
  pendingInvitations: z.array(pendingInvitationSchema),
  inviteToken: z.null(),
});

export const postAuthJourneyResultSchema = z.discriminatedUnion("journey", [
  postAuthJourneyBaseSchema.extend({
    journey: z.literal("founder"),
    targetCompanyId: z.null(),
    canCreateCompany: z.literal(true),
    resumeFirstRunCompanyId: z.null(),
  }),
  postAuthJourneyBaseSchema.extend({
    journey: z.literal("invited"),
    targetCompanyId: z.string().min(1),
    canCreateCompany: z.literal(false),
    resumeFirstRunCompanyId: z.null(),
  }),
  postAuthJourneyBaseSchema.extend({
    journey: z.literal("access_required"),
    targetCompanyId: z.null(),
    canCreateCompany: z.literal(false),
    resumeFirstRunCompanyId: z.null(),
  }),
  postAuthJourneyBaseSchema.extend({
    journey: z.literal("returning"),
    targetCompanyId: z.string().min(1),
    canCreateCompany: z.boolean(),
    resumeFirstRunCompanyId: z.string().min(1).nullable(),
  }),
]);

export type PostAuthJourneyResult = z.infer<typeof postAuthJourneyResultSchema>;

const legacyPostAuthJourneyResultSchema: z.ZodType<LegacyPostAuthJourneyResult> =
  z.object({
    journey: z.enum(["founder", "invited", "returning"]),
    targetCompanyId: z.string().min(1).nullable(),
    pendingInvitations: z.array(pendingInvitationSchema),
    inviteToken: z.null().optional(),
    resumeFirstRunCompanyId: z.string().min(1).nullable().optional(),
  });

/**
 * Parse the current wire contract while tolerating the immediately preceding
 * response shape during a rolling UI/server deployment.
 */
export function parsePostAuthJourneyResult(
  value: unknown
): PostAuthJourneyResult {
  const current = postAuthJourneyResultSchema.safeParse(value);
  if (current.success) return current.data;

  const legacy = legacyPostAuthJourneyResultSchema.parse(value);
  if (legacy.journey === "founder") {
    if (legacy.targetCompanyId !== null)
      throw new Error("Invalid founder journey target");
    return {
      schemaVersion: 1,
      journey: "founder",
      targetCompanyId: null,
      pendingInvitations: legacy.pendingInvitations,
      inviteToken: null,
      canCreateCompany: true,
      resumeFirstRunCompanyId: null,
    };
  }
  if (!legacy.targetCompanyId)
    throw new Error(`Invalid ${legacy.journey} journey target`);
  if (legacy.journey === "invited") {
    return {
      schemaVersion: 1,
      journey: "invited",
      targetCompanyId: legacy.targetCompanyId,
      pendingInvitations: legacy.pendingInvitations,
      inviteToken: null,
      canCreateCompany: false,
      resumeFirstRunCompanyId: null,
    };
  }
  return {
    schemaVersion: 1,
    journey: "returning",
    targetCompanyId: legacy.targetCompanyId,
    pendingInvitations: legacy.pendingInvitations,
    inviteToken: null,
    canCreateCompany: false,
    resumeFirstRunCompanyId: legacy.resumeFirstRunCompanyId ?? null,
  };
}
