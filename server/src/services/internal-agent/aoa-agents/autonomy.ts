/**
 * Plan 3 Task 4 — autonomyLevel crew activation gate.
 *
 * D2 eng-review amendment:
 * - Core roles (scribe, memory_keeper, curator) are ALWAYS ON (min autonomy = 0).
 *   They must not be gated off — disabling extraction at L0 would break the
 *   Discussion pipeline entirely.
 * - Agentic roles (router/navigator, planner) require autonomyLevel ≥ 2.
 *   At L0/L1 these roles fire no autonomous actions.
 *   Note: dispatcher was retired in Task 2.7; ROLE_MIN_AUTONOMY retains the
 *   entry for type-safety (CrewRole union) but no live trigger seeds it.
 */

export type CrewRole =
  | "scribe"
  | "memory_keeper"
  | "curator"
  | "router"
  | "navigator"
  | "planner"
  | "dispatcher"
  | "adjutant"
  | "maker"
  | "engineer"
  | "scout"
  | "reviewer"
  | "chronicler";

/** Minimum autonomy level at which each role auto-runs. Core roles are always on (0). */
export const ROLE_MIN_AUTONOMY: Record<CrewRole, number> = {
  scribe: 0,        // core: extraction always runs
  memory_keeper: 0, // core: proposals always run
  curator: 0,       // core: proactive scan always runs
  router: 2,        // legacy alias — kept while staging DBs still carry kind='aoa' name='Router' rows
  navigator: 2,     // Phase D rename of router: cross-thread routing + spin-off
  planner: 2,
  dispatcher: 2,
  adjutant: 0,      // active at L0 for nudges; advance_phase self-gates at L2 inside the tool
  maker: 1,         // legacy alias — kept while staging DBs still carry kind='aoa' name='Maker' rows
  engineer: 1,      // Phase D rename of maker: artifact creation on @mention or phase-advance
  scout: 1,         // mention-driven internal-only research (Phase 1 — no browse); aligns with engineer
  reviewer: 1,      // mention-driven critique; advise-only, posts a review like scout
  chronicler: 0,    // core infrastructure: card maintenance always runs (like scribe/memory_keeper)
};

/**
 * Returns true if the role should be active at the given autonomy level.
 * Wire this into the dispatcher and trigger evaluators before invoking any role.
 */
export function isRoleActiveAtAutonomy(role: CrewRole, level: number): boolean {
  return level >= ROLE_MIN_AUTONOMY[role];
}
