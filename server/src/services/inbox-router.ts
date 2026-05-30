// server/src/services/inbox-router.ts
//
// Task 1.2 (Inbound Dirty-Data Routing) — pure routing gate functions.
//
// These two functions are the heart of the inbound router:
//
//   classifyRouting — converts scored similarity results into one of 4 outcomes,
//     using the top-1-vs-top-2 ambiguity gap (Codex #10) so near-ties are
//     never auto-filed as confident matches.
//
//   resolveRoutingAction — maps (outcome × company routing dial) to the action
//     to take.  Fail-closed on uncomputable (D2), Navigator-escalation on
//     ambiguous (D3), auto-create only at full_auto (D2).
//
// No I/O.  Task 1.3 wires these into the orchestrating routeInboxItem function.

import {
  ATTACH_CONFIDENCE,
  AMBIGUITY_MARGIN,
  type RoutingOutcome,
  type RoutingAction,
} from "./inbound-routing-constants.js";

// ─── classifyRouting ──────────────────────────────────────────────────────────

export interface ClassifyRoutingArgs {
  /** Whether the embedding service is available. */
  available: boolean;
  /** Scored results from findSimilarThreadsScored, ordered by distance ascending. */
  results: Array<{ threadId: string; distance: number }>;
}

export interface ClassifyRoutingResult {
  outcome: RoutingOutcome;
  /** The thread recommended for attachment (null when no candidate). */
  suggestedThreadId: string | null;
  /** 1 - top.distance, or null when there is no candidate. */
  confidence: number | null;
}

/**
 * Turn scored similarity results into one of 4 routing outcomes.
 *
 * Decision flow:
 * 1. !available → uncomputable (embedding service unavailable; fail-closed, D2).
 * 2. results.length === 0 → explicit_no_match (vector search returned nothing).
 * 3. top.distance <= ATTACH_CONFIDENCE (candidate zone):
 *    a. gap (top-2 distance − top-1 distance) >= AMBIGUITY_MARGIN → attach_confident.
 *    b. gap < AMBIGUITY_MARGIN (near-tie) → ambiguous (D3, Navigator decides).
 * 4. top.distance > ATTACH_CONFIDENCE → explicit_no_match.
 */
export function classifyRouting(args: ClassifyRoutingArgs): ClassifyRoutingResult {
  const { available, results } = args;

  // Step 1 — fail-closed: embedding unavailable.
  if (!available) {
    return { outcome: "uncomputable", suggestedThreadId: null, confidence: null };
  }

  // Step 2 — no candidates from vector search.
  if (results.length === 0) {
    return { outcome: "explicit_no_match", suggestedThreadId: null, confidence: null };
  }

  const top = results[0];
  const second = results[1];

  // Step 3 — top result is in the candidate zone.
  if (top.distance <= ATTACH_CONFIDENCE) {
    // No runner-up → gap is infinite (unambiguously the best match).
    const gap = second ? second.distance - top.distance : Infinity;

    if (gap >= AMBIGUITY_MARGIN) {
      return {
        outcome: "attach_confident",
        suggestedThreadId: top.threadId,
        confidence: 1 - top.distance,
      };
    }

    // Near-tie: Navigator must decide (Codex #10, D3).
    return {
      outcome: "ambiguous",
      suggestedThreadId: top.threadId,
      confidence: 1 - top.distance,
    };
  }

  // Step 4 — top result is outside the threshold: no usable match.
  return { outcome: "explicit_no_match", suggestedThreadId: null, confidence: null };
}

// ─── resolveRoutingAction ─────────────────────────────────────────────────────

export interface ResolveRoutingActionArgs {
  /** Company routing dial setting. */
  level: "off" | "suggest" | "auto_attach" | "full_auto";
  /** Outcome from classifyRouting. */
  outcome: RoutingOutcome;
}

/**
 * Map (outcome × routing dial level) → action.
 *
 * Decision table (rows = outcome, cols = level):
 *
 * | outcome            | off   | suggest            | auto_attach        | full_auto   |
 * |--------------------|-------|--------------------|--------------------|-------------|
 * | uncomputable       | human | human              | human              | human       |
 * | attach_confident   | human | suggest            | auto_attach        | auto_attach |
 * | ambiguous          | human | escalate_navigator | escalate_navigator | escalate_navigator |
 * | explicit_no_match  | human | human              | human              | auto_create |
 *
 * Invariants:
 * - uncomputable → always human (fail-closed, D2).
 * - ambiguous → always escalate_navigator unless off (D3 — Navigator decides).
 * - explicit_no_match + auto_create only at full_auto (D2).
 */
export function resolveRoutingAction(args: ResolveRoutingActionArgs): RoutingAction {
  const { level, outcome } = args;

  // Fail-closed: embedding was unavailable; human must route.
  if (outcome === "uncomputable") {
    return "human";
  }

  // Level "off": human handles everything.
  if (level === "off") {
    return "human";
  }

  switch (outcome) {
    case "attach_confident":
      // suggest → show suggestion, human confirms.
      // auto_attach / full_auto → silently file.
      if (level === "suggest") return "suggest";
      return "auto_attach"; // auto_attach or full_auto

    case "ambiguous":
      // Any non-off level → Navigator decides (D3).
      return "escalate_navigator";

    case "explicit_no_match":
      // Auto-create a new thread only at full_auto (D2); otherwise human.
      if (level === "full_auto") return "auto_create";
      return "human";
  }
}
