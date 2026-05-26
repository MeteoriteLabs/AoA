/**
 * Plan 3 Task 4 — autonomyLevel crew activation gate.
 *
 * D2 eng-review amendment:
 * - Core roles (scribe, memory_keeper, curator) are ALWAYS ON (min autonomy = 0).
 *   They must not be gated off — disabling extraction at L0 would break the
 *   Discussion pipeline entirely.
 * - Agentic roles (router, planner, dispatcher) require autonomyLevel ≥ 2.
 *   At L0/L1 these roles fire no autonomous actions.
 */

export type CrewRole = "scribe" | "memory_keeper" | "curator" | "router" | "planner" | "dispatcher" | "adjutant" | "maker";

/** Minimum autonomy level at which each role auto-runs. Core roles are always on (0). */
const ROLE_MIN_AUTONOMY: Record<CrewRole, number> = {
  scribe: 0,        // core: extraction always runs
  memory_keeper: 0, // core: proposals always run
  curator: 0,       // core: proactive scan always runs
  router: 2,
  planner: 2,
  dispatcher: 2,
  adjutant: 0,      // active at L0 for nudges; advance_phase self-gates at L2 inside the tool
  maker: 1,         // active at L1 for mention-driven artifact generation; phase-advance routing requires L2
};

/**
 * Returns true if the role should be active at the given autonomy level.
 * Wire this into the dispatcher and trigger evaluators before invoking any role.
 */
export function isRoleActiveAtAutonomy(role: CrewRole, level: number): boolean {
  return level >= ROLE_MIN_AUTONOMY[role];
}
