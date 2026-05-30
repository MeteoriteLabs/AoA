// server/src/services/inbound-routing-constants.ts
//
// Task 1.2 (Inbound Dirty-Data Routing) — routing thresholds + type definitions.
//
// Cosine distance: smaller = more similar. Tuned defaults; per-company config deferred.

/** Top-1 result must be <= this distance to be a candidate match. */
export const ATTACH_CONFIDENCE = 0.25;

/**
 * Top-1 must be at least this much closer than top-2 to avoid being
 * flagged as ambiguous (Codex #10 — near-ties must not auto-file).
 */
export const AMBIGUITY_MARGIN = 0.05;

/**
 * The 4 possible outcomes of classifyRouting.
 *
 * - attach_confident: top result is within threshold and clearly ahead of second.
 * - ambiguous: top result qualifies but near-tie with second; Navigator decides (D3).
 * - explicit_no_match: vector search returned nothing OR top distance too high.
 * - uncomputable: embedding was unavailable; fail-closed signal (D2).
 */
export type RoutingOutcome =
  | "attach_confident"
  | "ambiguous"
  | "explicit_no_match"
  | "uncomputable";

/**
 * The 5 possible actions returned by resolveRoutingAction.
 *
 * - auto_attach: silently file the item into the suggested thread.
 * - escalate_navigator: surface to Navigator for disambiguation (D3).
 * - suggest: show a match suggestion; human confirms.
 * - human: hand off to human for manual routing.
 * - auto_create: automatically create a new thread for the item (full_auto only, D2).
 */
export type RoutingAction =
  | "auto_attach"
  | "escalate_navigator"
  | "suggest"
  | "human"
  | "auto_create";
