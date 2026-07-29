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
// Plan 6 Task 5 added "discussions" (2x2, both roles); Task 6 added
// "memory-review" (2x2, FOUNDER only — matches approvals/budget; member never
// gets it, per the widget's requiresFounder flag). Task 7 (2026-07-29)
// re-verified packing against buildDefaultLg with a throwaway script that
// prints the actual grid (not hand-derived) now that the widget set for this
// plan is final, and retuned BOTH orders — each via a single minimal
// relocation, not a redesign:
//
//   - FOUNDER (10 widgets: 7×2x2 + 3×1x1 stats). Naively appending
//     discussions/memory-review straight after "budget" (the Task 5/6
//     intermediate order) put budget on the same shelf as "discussions" (a
//     2x2), forcing a second interior shadow gap (3 cells: budget's own row
//     is only h:1 but its 2x2 shelf-mate is h:2) on top of the pre-existing,
//     already-accepted action-queue/approvals/agents-now shadow (2 cells).
//     Moving ONLY "budget" to the very end (nothing else reordered — action-
//     queue/approvals/agents-now keep their original Plan-5 first-row
//     positions) removes that second shadow entirely: the 7 list widgets now
//     pair up perfectly (0 waste across 3 shelves), leaving just the
//     unavoidable action-queue-shelf shadow (2 cells) + budget's own trailing
//     row, now alone with nothing left to pair against (3 cells). Result: 9
//     rows / 5 wasted cells of 36 (down from 10 rows / 9 wasted of 40 for the
//     intermediate order). This is the mathematical floor for a 7×2x2 + 3×1x1
//     mix under this next-fit packer — splitting the 3 stats differently
//     (e.g. 2 riding with the odd-one-out 2x2, 1 alone) always sums to the
//     same 5, so this is a genuine optimum, not a guess, and it's the
//     cheapest path there (one relocation, zero UX-priority tradeoff — unlike
//     the Plan-5 "stats-first" option below, action-queue/approvals stay put).
//   - MEMBER (7 widgets: 6×2x2 + 1×1x1 stat, agents-now). The Task-5
//     intermediate order sandwiched agents-now between suggestions and
//     discussions, so it rode partway onto suggestions' shelf (shadow: 2
//     cells) and then bumped discussions into its own lone shelf (trailing: 4
//     cells) = 7 wasted cells / 8 rows. Swapping the last two entries so
//     "discussions" precedes "agents-now" lets all 6 twos pair perfectly (0
//     waste) and leaves agents-now alone on a final h:1 row (3 cells
//     trailing, unavoidable — 6 is even, so no 2x2 is ever left unpaired for
//     agents-now to ride with for free). Result: 7 rows / 3 wasted cells of
//     28 (down from 8 rows / 7 wasted of 32) — also the floor for this mix.
//
// If HOME_BOARD_ALLOWED_SIZES or either role's widget SET changes again,
// re-verify with buildDefaultLg before re-deriving this reasoning from
// scratch — don't assume a naive append stays optimal.
const FOUNDER: WidgetKey[] = ["action-queue", "approvals", "agents-now", "activity-feed", "objectives", "suggestions", "my-tasks", "discussions", "memory-review", "budget"];
const MEMBER: WidgetKey[] = ["my-tasks", "action-queue", "objectives", "activity-feed", "suggestions", "discussions", "agents-now"];

// Only team_member gets the execution board; founder, team_lead, null, and
// instance-admin (null role) all get the oversight board.
export function getDefaultLayout(role: UserRole | null): WidgetKey[] {
  return role === "team_member" ? MEMBER : FOUNDER;
}
