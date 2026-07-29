# Home Widget Board — Plan 5: Board UX polish

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Fix the UX gaps found in live QA — empty widgets render as blank tiles, default sizes don't fit content (Suggestions' Accept/Dismiss below the fold), resize is too constrained, and Reset looks half-empty. After this, a fresh board reads as intentional (helpful empty states + CTAs), tiles fit their content, and resize has real range.

**Decisions (founder, 2026-07-29):** (1) empty widgets **always show an empty state** (never `return null`/blank); (2) the fresh-company default shows **all 8 widgets** (with empty states — doubles as a setup checklist); (3) formalize as this reviewed plan.

**Architecture:** UI-only. Two shared presentational helpers (`WidgetEmpty`, `WidgetLoading`) render inside each widget's existing `WidgetShell`. Every widget renders its shell unconditionally now — a three-way branch: loading → skeleton, loaded-empty → empty state (+ optional CTA), loaded-with-data → content. Recalibrate `HOME_BOARD_ALLOWED_SIZES` (the shared single source of truth the server validator + UI registry both read) so defaults fit content and resize has range; bump `rowHeight`; make the resize handle visible in edit mode; rework the default layout for the new sizes. Existing saved layouts reconcile automatically (`reconcileLg` clamps any now-disallowed size).

**Tech Stack:** React 19 + Vite + Tailwind, react-query, Vitest + @testing-library/react. No server/DB/migration changes (the shared sizes constant is data the validator reads; existing rows clamp on load). Builds on `dd33774f5` (the max-w-3xl full-width fix).

---

## Roadmap position (plan 5 of 5)
Plans 1–4 shipped the board + tests. **Plan 5 (this) — UX polish from live QA.** One PR at the end (`claude/home-page-widgets-a927af`).

## The four fixes
1. **Empty states, never blank tiles** (all widgets render their shell + a purposeful empty state).
2. **Sizes that fit content** (Suggestions + list widgets default to 2×2; row height up).
3. **Resize range** (each widget gets 3 footprints; visible resize handle).
4. **Reset looks clean** (falls out of #1 + #2 — the default board is all empty-states-with-CTAs, not blanks).

---

## Task 1: `WidgetEmpty` + `WidgetLoading` shared helpers
**Files:** Create `ui/src/components/home/widgets/WidgetStates.tsx` + `ui/src/__tests__/home/WidgetStates.test.tsx`.
- [ ] Step 1 (TDD):
```tsx
import type { ComponentType } from "react";

/** Centered empty state for a widget body (inside WidgetShell). Optional CTA. */
export function WidgetEmpty({ icon: Icon, message, ctaLabel, onCta }: {
  icon: ComponentType<{ className?: string }>;
  message: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center text-muted-foreground">
      <Icon className="h-6 w-6 opacity-70" aria-hidden />
      <p className="text-sm">{message}</p>
      {ctaLabel && onCta && (
        <button type="button" onClick={onCta} className="rounded-md border border-border px-2.5 py-1 text-xs text-primary transition-colors hover:bg-accent/50">
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

/** Minimal loading placeholder for a widget body — distinct from empty so a
 *  populated widget never flashes its empty state before its data resolves. */
export function WidgetLoading() {
  return <div className="flex h-full items-center justify-center"><span className="text-xs text-muted-foreground">Loading…</span></div>;
}
```
- [ ] Step 2: Test both (WidgetEmpty renders message + icon; CTA fires onCta when clicked; WidgetLoading renders). Commit `feat(home): WidgetEmpty + WidgetLoading state helpers`.

## Task 2: Empty/loading states for the `useHomeSummary` widgets
Convert `ActionQueueWidget`, `ObjectivesWidget`, `ActivityFeedWidget`, `MyTasksWidget` from `return null`-when-empty to always render the shell with a three-way body. The CTA opens the relevant create dialog via `useDialog` (Objectives → `openNewGoal`, My tasks → `openNewIssue`).
**Files:** Modify the 4 widgets + their tests.
- [ ] Step 1: Example — `ObjectivesWidget`:
```tsx
import { Target } from "lucide-react";
import { useHomeSummary } from "../../../hooks/useHomeSummary";
import { useDialog } from "../../../context/DialogContext";
import { WidgetShell } from "./WidgetShell";
import { WidgetEmpty, WidgetLoading } from "./WidgetStates";
import type { WidgetProps } from "./types";

export function ObjectivesWidget({ companyId, editing }: WidgetProps) {
  const { data, isLoading } = useHomeSummary(companyId);
  const { openNewGoal } = useDialog();
  const goals = data?.goalProgress ?? [];
  return (
    <WidgetShell title="Objectives" icon={Target} to="/objectives" editing={editing}>
      {isLoading ? <WidgetLoading /> : goals.length === 0 ? (
        <WidgetEmpty icon={Target} message="No objectives yet" ctaLabel="+ New goal" onCta={openNewGoal} />
      ) : (
        <div className="space-y-2 overflow-auto">{/* …existing goal rows… */}</div>
      )}
    </WidgetShell>
  );
}
```
  Apply the same pattern to the other three:
  - `ActionQueueWidget` — empty: `<WidgetEmpty icon={CheckCheck} message="Nothing needs review — all clear" />` (no CTA).
  - `ActivityFeedWidget` — empty: `<WidgetEmpty icon={Activity} message="Agent activity will show up here as your crew starts working." />` (no CTA).
  - `MyTasksWidget` — empty: `<WidgetEmpty icon={ListChecks} message="No tasks assigned to you" ctaLabel="+ New task" onCta={openNewIssue} />`.
- [ ] Step 2: Update each widget's test: the empty case now asserts the empty-state message (+ CTA click calls the dialog opener) instead of `toBeNull()`/absence; add a loading-state case (isLoading → "Loading…"). Keep the with-data case.
- [ ] Step 3: Run the 4 widget tests → green. Commit `feat(home): empty + loading states for summary widgets (no more blank tiles)`.

## Task 3: Loading states for the stat widgets
`BudgetWidget` + `ApprovalsWidget` currently `return null` while their query loads → a blank tile on first paint. Render the shell + `WidgetLoading` while loading, then the value (Agents already renders `0`, no change needed).
**Files:** Modify `BudgetWidget`, `ApprovalsWidget` + tests.
- [ ] Step 1: `if (isLoading) return <WidgetShell …><WidgetLoading/></WidgetShell>;` then render the value. (Keep Approvals' both-queries-required guard, but surface it as loading, not null.) Update tests (loading case; value case unchanged). Commit `feat(home): loading states for Budget + Approvals (no blank first paint)`.

## Task 4: Sizing recalibration + row height
**Files:** Modify `packages/shared/src/home-board.ts` (`HOME_BOARD_ALLOWED_SIZES`), `ui/src/components/home/HomeBoard.tsx` (`rowHeight`), and the affected tests.
- [ ] Step 1: New footprints (first entry = default; each widget gets 3 for resize range):
```ts
export const HOME_BOARD_ALLOWED_SIZES = {
  "agents-now": [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 2 }],
  budget:       [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 2 }],
  approvals:    [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 2 }],
  "action-queue":[{ w: 2, h: 2 }, { w: 2, h: 1 }, { w: 4, h: 2 }],
  suggestions:  [{ w: 2, h: 2 }, { w: 2, h: 1 }, { w: 4, h: 2 }],
  objectives:   [{ w: 2, h: 2 }, { w: 2, h: 1 }, { w: 4, h: 2 }],
  "my-tasks":   [{ w: 2, h: 2 }, { w: 2, h: 1 }, { w: 4, h: 2 }],
  "activity-feed":[{ w: 2, h: 2 }, { w: 4, h: 2 }, { w: 2, h: 1 }],
} as const satisfies Record<HomeBoardWidgetKey, readonly { w: number; h: number }[]>;
```
  (Defaults are now: stats `1×1`; `action-queue`/`suggestions`/`objectives`/`my-tasks`/`activity-feed` all `2×2` — Suggestions' buttons now fit without scroll.)
- [ ] Step 2: `HomeBoard.tsx` `rowHeight={104}` → `rowHeight={120}`.
- [ ] Step 3: Update `registry.test.ts` (allowedSizes reference-equal + defaultSize = first, unchanged assertions still hold), the shared `home-board-layout.test.ts` (still valid layouts under the new sizes), and any test asserting a specific default size. Run shared + registry tests → green. Commit `feat(home): recalibrate tile sizes (2×2 content defaults, wider resize range) + taller rows`.

## Task 5: Visible resize handle in edit mode
`react-resizable`'s handle is easy to miss. Make it visible when editing.
**Files:** Modify `HomeBoard.tsx` (or a colocated CSS/className) — style the `.react-resizable-handle` so it shows a clear grab affordance (bottom-right corner) only while `editing`; hidden otherwise. Add a small component test or a visual note. Commit `feat(home): visible resize handle in edit mode`.

## Task 6: Default layout for the new sizes
With 2×2 list widgets, the default arrangement must pack cleanly (no gaps/overlap) across 4 cols.
**Files:** Modify `ui/src/components/home/defaultLayout.ts` (order) and confirm `gridLayout.ts buildDefaultLg` produces a valid, good-looking pack; update `gridLayout.test.ts` + `defaultLayout.test.ts` + `HomeBoard.test.tsx` (heading presence/order under new sizes).
- [ ] Step 1: Choose an order that packs well, e.g. founder: `["action-queue","approvals","agents-now","activity-feed","objectives","suggestions","my-tasks","budget"]` (a 2-wide/1-wide row, then paired 2×2s). Verify `buildDefaultLg` yields no overlaps and `x+w<=4`. Update tests. Commit `feat(home): default board layout tuned for the new tile sizes`.

## Task 7: Update the board + guardrail tests for always-rendered widgets
Widgets no longer self-hide, so tests that asserted empty widgets are ABSENT must flip to asserting their empty state is PRESENT.
**Files:** `ui/src/__tests__/home/widget-completeness.test.tsx` (empty data → titled shell + empty state, never null), `HomeBoard.test.tsx`, and `ui/src/__tests__/Dashboard.test.tsx` (its mock home-summary is empty → Objectives/Activity/etc. now render empty states; confirm the 11 suggestion/quick-action assertions still pass — they should, they don't assert absence of those widgets; adjust only if a query becomes ambiguous).
- [ ] Step 1: Update the completeness meta-test's contract from "null OR titled shell" to "always a titled shell (data, empty state, or loading)". Update HomeBoard tests. Run the full home suite + Dashboard.test → green. Commit `test(home): widgets always render (empty state) — update board/guardrail tests`.

## Final verification + live re-check
- [ ] `pnpm typecheck` → clean; `pnpm test:run` (or the ui suite via canonical root runner) → green; `pnpm build` → succeeds.
- [ ] Live: on the running instance, a fresh company's board shows all 8 tiles with helpful empty states (no blanks); Suggestions shows Accept/Dismiss without scroll; Edit → resize has range + a visible handle; Reset yields the clean default (not half-empty).

---

## Self-review notes (author)
- **UI-only.** No server/DB/migration change. `HOME_BOARD_ALLOWED_SIZES` is shared data the server validator reads — narrowing/widening it is safe (existing saved rows clamp via `reconcileLg` on load; the validator just accepts the new set).
- **Loading vs empty** is deliberately distinct so a populated widget never flashes "No objectives yet" before its query resolves.
- **CTA in edit mode:** the empty-state CTA (New goal/New task) is a normal button; in edit mode the tile is draggable but the CTA remains — acceptable (matches Suggestions' inline Accept/Dismiss which also stay). If it feels wrong in QA, gate the CTA on `!editing`.
- **Builds on** `dd33774f5` (full-width board) — that unblocked `lg`/edit; this makes the tiles themselves good.
- **Review:** Codex is out of credits until 2026-08-05, so this plan + its implementation get an independent opus reviewer instead (same as the initiative's final review).
