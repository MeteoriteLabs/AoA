import type { UserRole } from "@armyofagents/shared";
import type { WidgetKey } from "./widgets/types";

// Plan 2: role-aware default boards. Founder/team_lead get the full oversight
// board (incl. Budget + Approvals); members get an execution-weighted subset.
// Data stays team-visible either way (2026-07-29 decision) — this is
// arrangement-only, not data-gating.
//
// Plan 5 Task 6 (2026-07-29): re-verified this order against buildDefaultLg's
// next-fit packer after the sizing recalibration (list widgets now default to
// 2x2 instead of 2x1 — see HOME_BOARD_ALLOWED_SIZES). No reorder was applied;
// this order was measured as already-optimal, and a literal reading of the
// plan's suggested reorder (stats immediately after action-queue: [
// "action-queue","approvals","agents-now","budget","activity-feed", ...]) was
// measurably WORSE, not better:
//   - FOUNDER (this order): 7 rows total. Packs to one clean interior hole (2
//     cells, under approvals+agents-now on row 1 — action-queue's w:2 leaves
//     room for exactly 2 of the 3 w:1 stats on its shelf) plus the expected
//     trailing gap where the leftover 5th same-size 2x2 (budget doesn't count
//     here, but the 5 list widgets can't all pair evenly) sits alone.
//   - Plan's literal suggested reorder: 8 rows total (one row taller) with 5
//     interior gap cells scattered across 3 separate rows, because inserting
//     budget between the 2 front-loaded stats and activity-feed forces budget
//     onto a shelf with a taller (h:2) neighbor twice instead of once.
//   - A "stats-first" reorder (all 3 stats before action-queue) can shave the
//     interior hole from 2 cells to 1, but only by moving action-queue (the
//     most actionable widget) out of the first reading position — a UX
//     priority tradeoff outside this task's scope (packing quality), for a
//     one-grid-cell gain. Not applied.
// MEMBER's order already packs with ZERO interior gaps (verified the same
// way) — only its own unavoidable trailing gap (agents-now alone, since 5
// same-size 2x2s can't pair evenly against a single 1x1 leftover).
// If HOME_BOARD_ALLOWED_SIZES changes again, re-verify with buildDefaultLg
// before re-deriving this reasoning from scratch.
// Plan 6 Task 5 (2026-07-29): appended "discussions" to both roles' end.
// Plan 6 Task 6 (2026-07-29): appended "memory-review" to FOUNDER only
// (matching approvals/budget — member never gets it, per the widget's
// requiresFounder flag). Packing/ordering for the resulting 10-widget
// founder / 7-widget member board is re-verified against buildDefaultLg
// holistically in Task 7, now that the final widget set for this plan is
// known. Do not re-derive packing reasoning from this intermediate state.
const FOUNDER: WidgetKey[] = ["action-queue", "approvals", "agents-now", "activity-feed", "objectives", "suggestions", "my-tasks", "budget", "discussions", "memory-review"];
const MEMBER: WidgetKey[] = ["my-tasks", "action-queue", "objectives", "activity-feed", "suggestions", "agents-now", "discussions"];

// Only team_member gets the execution board; founder, team_lead, null, and
// instance-admin (null role) all get the oversight board.
export function getDefaultLayout(role: UserRole | null): WidgetKey[] {
  return role === "team_member" ? MEMBER : FOUNDER;
}
