// packages/shared/src/hub.ts
// Shared contract for the unified hub index. Consumed by the hub service,
// the (future) notifications Layer-2 registry, and the UI registry (W1b).

export const HUB_LANES = ["waiting_on_you", "notifications", "suggestions"] as const;
export type HubLane = (typeof HUB_LANES)[number];

export const HUB_LANDING_TARGETS = ["home", ...HUB_LANES] as const;
export type HubLandingTarget = (typeof HUB_LANDING_TARGETS)[number];

export const HUB_GROUP_MODES = ["auto", "source", "scope", "type", "none"] as const;
export type HubGroupMode = (typeof HUB_GROUP_MODES)[number];

export const HUB_DENSITIES = ["comfortable", "compact"] as const;
export type HubDensity = (typeof HUB_DENSITIES)[number];

export const HUB_ITEM_STATUSES = ["open", "snoozed", "resolved", "archived"] as const;
export type HubItemStatus = (typeof HUB_ITEM_STATUSES)[number];

export const HUB_ITEM_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type HubItemPriority = (typeof HUB_ITEM_PRIORITIES)[number];

// Semantic type = WHAT the item is, independent of its source table. Adding a
// type = one entry here + one registry entry (W1b). The W5 runtime-decision type
// is RESERVED (no adapter bridge yet — see master scope §10).
// NOTE: enumerate against `SELECT DISTINCT type FROM notifications` during Task 4;
// every live legacy type must map to one of these (unknowns → "legacy_other").
export const HUB_SEMANTIC_TYPES = [
  // waiting_on_you
  "approval_request",
  "discussion_pending",
  "join_request",
  "human_input_needed",   // thread.human_input_needed
  "scope_proposal",       // thread.scope_proposal_posted
  "agent_runtime_decision", // reserved (W5)
  // notifications
  "run_failed",
  "budget_alert",         // budget.incident_created
  "agent_error",
  "mention",              // thread.mention, internal_agent.notification
  "marketplace_op",       // marketplace.*
  "run_complete",
  "reminder",             // internal_agent.reminder
  "extraction_failed",    // discussion.extraction_failed
  "routine_outcome",      // routine.tick / sweep.tick
  "legacy_other",         // catch-all sink for any un-mapped legacy type
  // suggestions
  "suggestion",
  "stale_work",
  "proactive",            // internal_agent_proactive
] as const;
export type HubSemanticType = (typeof HUB_SEMANTIC_TYPES)[number];

export const HUB_SEMANTIC_TO_LANE: Record<HubSemanticType, HubLane> = {
  approval_request: "waiting_on_you",
  discussion_pending: "waiting_on_you",
  join_request: "waiting_on_you",
  human_input_needed: "waiting_on_you",
  scope_proposal: "waiting_on_you",
  agent_runtime_decision: "waiting_on_you",
  run_failed: "notifications",
  budget_alert: "notifications",
  agent_error: "notifications",
  mention: "notifications",
  marketplace_op: "notifications",
  run_complete: "notifications",
  reminder: "notifications",
  extraction_failed: "notifications",
  routine_outcome: "notifications",
  legacy_other: "notifications",
  suggestion: "suggestions",
  stale_work: "suggestions",
  proactive: "suggestions",
};

export function laneForSemanticType(t: HubSemanticType): HubLane {
  return HUB_SEMANTIC_TO_LANE[t];
}

// Authority = who may make the FINAL decision (a property of the TYPE, §7).
// "Accountable" = the Authority-holder (ONE fixed meaning). The Owner is
// Responsible (shepherds it) and Routes/Escalates when lacking Authority.
// The action layer (Task 7/9) gates on THIS, not on ownership.
export type HubAuthority = "founder" | "owner"; // founder = founder/board only; owner = the responsible human may act
export const HUB_AUTHORITY_BY_TYPE: Record<HubSemanticType, HubAuthority> = {
  approval_request: "founder",
  join_request: "founder",
  agent_runtime_decision: "founder", // reserved; per-prompt tightening in W5
  discussion_pending: "owner", human_input_needed: "owner", scope_proposal: "owner",
  run_failed: "owner", budget_alert: "owner", agent_error: "owner", mention: "owner",
  marketplace_op: "owner", run_complete: "owner", reminder: "owner",
  extraction_failed: "owner", routine_outcome: "owner", legacy_other: "owner",
  suggestion: "owner", stale_work: "owner", proactive: "owner",
};
export function authorityForSemanticType(t: HubSemanticType): HubAuthority {
  return HUB_AUTHORITY_BY_TYPE[t];
}

export const HUB_AUTOPILOT_MODES = ["off", "assist", "drive"] as const;
export type HubAutopilotMode = (typeof HUB_AUTOPILOT_MODES)[number];

export const HUB_AUTOPILOT_ACTIONS = ["none", "resolve", "archive"] as const;
export type HubAutopilotAction = (typeof HUB_AUTOPILOT_ACTIONS)[number];

export const HUB_AUTOPILOT_FOUNDER_GATED_TYPES = [
  "approval_request",
  "join_request",
  "agent_runtime_decision",
] as const satisfies readonly HubSemanticType[];

export function isFounderGatedAutopilotType(type: HubSemanticType): boolean {
  return (HUB_AUTOPILOT_FOUNDER_GATED_TYPES as readonly string[]).includes(type);
}

// Owner pool sentinel for authority-gated items with no single natural owner.
export const HUB_OWNER_POOLS = ["board"] as const;
export type HubOwnerPool = (typeof HUB_OWNER_POOLS)[number];

// The action contract every action request carries (optimistic concurrency).
export interface HubActionEnvelope {
  action: string; // e.g. "approve" | "reject" | "retry" | "dismiss"
  expectedVersion: number; // hub_items.version the client last saw → 409 on mismatch
  idempotencyKey?: string;
  reason?: string;
}
