# Commander Phase 0 — Rounded-Panel Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Commander page's panels (sessions, chat, viewer) render as rounded "cards" with consistent gaps + a muted backdrop, matching Memory / Discussions / Workspace.

**Architecture:** Commander is already full-bleed at the `Layout` level (`shouldUseFullBleedMain` returns true for `commander` — do NOT change that; Workspace is full-bleed too). The card chrome is added *inside the page*, mirroring `WorkspaceLayout`: a `gap-2 p-2 bg-muted/30` wrapper around the panel row, and `rounded-xl border border-border bg-background shadow-sm` on each panel. Because the panels span two files (sessions in `Commander.tsx`; chat + viewer in `AgentPanelContent`), the gap is applied at two nested flex levels with matching `gap-2` so spacing reads uniformly.

**Tech Stack:** React + Tailwind v4. Verification is **visual-first** (chrome is presentational; a full-render unit test of `AgentPanelContent` would need ~6 context providers and be brittle — the skilled call here is a visual checklist + the existing e2e harness, not a brittle render test). One lightweight structural assertion is included where it's cheap.

**Relationship to Phase 1:** Phase 1 (composition) restructures this same layout into a `react-resizable-panels` group. The card *classes* added here carry forward unchanged (Phase 1 changes how panels are *sized*, not their card styling), so this is not throwaway work.

**Verified anchors (read before editing):**
- `ui/src/components/Layout.tsx:29-47` — `shouldUseFullBleedMain` (commander at :42). **Leave unchanged.**
- `ui/src/pages/Commander.tsx:56` root `flex flex-col h-full min-h-0`; `:67` panel row `flex flex-1 min-h-0 overflow-hidden`; `:69-75` `<SessionsSidebar>` (desktop); `:77` chat container `flex-1 min-w-0 overflow-hidden bg-bg`.
- `ui/src/components/InternalAgentPanel.tsx` `AgentPanelContent` return (~:1343) `<div className="flex h-full min-h-0 flex-row overflow-hidden">` wrapping `{chatColumn}` + `<CommanderViewerPanel/>`; `chatColumn` (~:922) `<div className="flex h-full min-w-0 flex-1 flex-col">`.
- `ui/src/components/commander/viewer/CommanderViewerPanel.tsx` — expanded panel container (`relative flex h-full shrink-0 flex-col border-l border-border bg-card`) and collapsed rail (`flex h-full w-9 shrink-0 flex-col ... border-l border-border bg-card`).
- Reference for the exact recipe: `ui/src/components/workspace/WorkspaceLayout.tsx:426` (`flex flex-1 min-h-0 gap-2 overflow-hidden bg-muted/30 p-2`) + its panels (`:430` `rounded-xl border border-border bg-background shadow-sm`).

**Chrome constant (single source of truth):** define once and reuse so every panel matches and Phase 1 inherits it.

---

## Task 1: Define the shared card-chrome class + apply the row wrapper and sessions card

**Files:**
- Create: `ui/src/components/commander/commanderChrome.ts`
- Modify: `ui/src/pages/Commander.tsx` (row `:67`, sessions `:69-75`, chat container `:77`)

- [ ] **Step 1: Create the chrome constant**

```ts
// ui/src/components/commander/commanderChrome.ts
// Single source of truth for Commander panel chrome (Phase 0). Mirrors the
// Workspace/Memory/Discussions recipe (design-system §5.1 radius, §6 shadow).
// Phase 1 (resizable composition) reuses this unchanged.
export const COMMANDER_PANEL_CARD =
  "rounded-xl border border-border bg-background shadow-sm overflow-hidden";

/** The row that holds the panels: gap + padding + muted backdrop. */
export const COMMANDER_PANEL_ROW = "gap-2 p-2 bg-muted/30";
```

- [ ] **Step 2: Apply the wrapper + sessions card in `Commander.tsx`**

Import the constants at the top:
```ts
import { COMMANDER_PANEL_CARD, COMMANDER_PANEL_ROW } from "../components/commander/commanderChrome";
```

Row `:67` — add the wrapper classes:
```tsx
<div className={cn("flex flex-1 min-h-0 overflow-hidden", COMMANDER_PANEL_ROW)}>
```
(If `cn` isn't already imported in this file, add `import { cn } from "../lib/utils";`.)

Desktop sessions `:69-75` — wrap `<SessionsSidebar>` in a card (do NOT edit SessionsSidebar internals):
```tsx
{!useDrawerSessions && (
  <div className={cn(COMMANDER_PANEL_CARD, "shrink-0")}>
    <SessionsSidebar
      activeConversationId={activeConversationId}
      onSelect={setActiveConversationId}
      onNewConversation={handleNewConversation}
    />
  </div>
)}
```

Chat container `:77` — make it a transparent passthrough (drop its `bg-bg`; the chat panel itself becomes the card in Task 2):
```tsx
<div className="flex-1 min-w-0 overflow-hidden">
  <AgentPanelContent
    conversationId={activeConversationId}
    onSelectConversation={handleSelectConversation}
    onOpenSessions={useDrawerSessions ? () => setSessionsDrawerOpen(true) : undefined}
    enableViewerPanel
  />
</div>
```

- [ ] **Step 3: Visual check (dev server)**

Run the app (or the isolated instance pattern from the e2e). Open `/<prefix>/commander`. Expected: an 8px muted-backdrop gutter around the panel row; the sessions sidebar is a rounded card with a hairline border + soft shadow. (Chat/viewer become cards in Task 2.)

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/commander/commanderChrome.ts ui/src/pages/Commander.tsx
git commit -m "feat(commander): panel-row chrome wrapper + sessions card (Phase 0)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Card the chat column and the viewer panel/rail

**Files:**
- Modify: `ui/src/components/InternalAgentPanel.tsx` (`AgentPanelContent` flex-row ~:1343 + `chatColumn` ~:922)
- Modify: `ui/src/components/commander/viewer/CommanderViewerPanel.tsx` (expanded panel + rail containers)

- [ ] **Step 1: Chat column + inner gap in `AgentPanelContent`**

Import the constant:
```ts
import { COMMANDER_PANEL_CARD } from "./commander/commanderChrome";
```

`chatColumn` (~:922) — add the card class to its outer div:
```tsx
const chatColumn = (
  <div className={cn("flex h-full min-w-0 flex-1 flex-col", COMMANDER_PANEL_CARD)}>
```
(`cn` is already imported in this file — confirm.)

The `AgentPanelContent` return flex-row (~:1343) — add `gap-2` so chat and viewer cards are spaced like the sessions↔chat gap (the `p-2 bg-muted/30` is already on the parent row from Task 1, so only `gap-2` is needed here):
```tsx
return (
  <div className="flex h-full min-h-0 flex-row gap-2 overflow-hidden">
    {chatColumn}
    {enableViewerPanel && companyId && (
      <CommanderViewerPanel /* ...unchanged props... */ />
    )}
  </div>
);
```

- [ ] **Step 2: Card the viewer panel + rail in `CommanderViewerPanel.tsx`**

Import the constant:
```ts
import { COMMANDER_PANEL_CARD } from "../commanderChrome";
```

Expanded panel container — replace its `border-l border-border bg-card` with the card class (it's now a free-floating card, not a left-bordered attachment):
```tsx
<div ref={containerRef} className={cn("relative flex h-full shrink-0 flex-col", COMMANDER_PANEL_CARD)} ...>
```

Collapsed rail container — same treatment (drop `border-l`, add the card class) so the rail is a slim rounded card:
```tsx
<div className={cn("flex h-full w-9 shrink-0 flex-col items-center ...", COMMANDER_PANEL_CARD)} data-testid="commander-viewer-rail">
```

(Keep all other classes/behaviour. The drag-divider sits at the card's left edge — verify it still grabs; if the rounded corner clips the 8px hit area, nudge the divider inwith `left-0` instead of `-left-1`.)

- [ ] **Step 3: Lightweight structural assertion (cheap, non-brittle)**

Add to `ui/src/components/commander/viewer/` a tiny test that the rail/panel carry the shared card class, so the chrome can't silently regress:
```tsx
// ui/src/components/commander/commanderChrome.test.ts
import { describe, it, expect } from "vitest";
import { COMMANDER_PANEL_CARD, COMMANDER_PANEL_ROW } from "./commanderChrome";

describe("commander chrome tokens", () => {
  it("card class carries rounded + border + shadow", () => {
    expect(COMMANDER_PANEL_CARD).toContain("rounded-xl");
    expect(COMMANDER_PANEL_CARD).toContain("border");
    expect(COMMANDER_PANEL_CARD).toContain("shadow-sm");
  });
  it("row class carries gap + padding + backdrop", () => {
    expect(COMMANDER_PANEL_ROW).toContain("gap-2");
    expect(COMMANDER_PANEL_ROW).toContain("p-2");
    expect(COMMANDER_PANEL_ROW).toContain("bg-muted/30");
  });
});
```

Run: `cd ui && pnpm vitest run src/components/commander/commanderChrome.test.ts` → PASS. (This pins the tokens; the actual rendering is verified visually in Step 4.)

- [ ] **Step 4: Visual verification checklist (the real gate)**

Run the app, open `/<prefix>/commander`, and confirm:
1. Three rounded cards — sessions, chat, viewer rail — with uniform 8px gaps + muted backdrop gutter.
2. Expand the viewer (⌂) → it's a rounded card sibling to the chat, not flush.
3. Chat input still rounds/scrolls correctly inside the chat card (no clipped/overflowing input).
4. Drag the viewer divider → still resizes (hit area not clipped by the rounded corner).
5. Existing UI tests still green: `cd ui && pnpm vitest run src/components/commander/ src/components/InternalAgentPanel.outputRefs.test.tsx src/__tests__/OutputViewerRegistry.test.ts`.
6. Mobile (narrow the window): the page doesn't break (Phase 1 reworks mobile fully; here we only confirm no regression — the drawer + viewer pill still function).

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/InternalAgentPanel.tsx ui/src/components/commander/viewer/CommanderViewerPanel.tsx ui/src/components/commander/commanderChrome.test.ts
git commit -m "feat(commander): card the chat + viewer panels to match app chrome (Phase 0)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (applied)

- **Spec coverage:** spec §2 (chrome recipe, keep full-bleed, apply internally, applies to shipped viewer) → Tasks 1-2 cover sessions/chat/viewer. The shared `commanderChrome.ts` constant satisfies "single recipe" and Phase-1 reuse.
- **No placeholders:** every step has concrete classes/commands. The one judgement call (divider hit-area at the rounded corner) has an explicit fix.
- **Type/name consistency:** `COMMANDER_PANEL_CARD` / `COMMANDER_PANEL_ROW` used identically across Commander.tsx, InternalAgentPanel.tsx, CommanderViewerPanel.tsx, and the test.
- **Testing honesty:** chrome is presentational → visual checklist is the gate; the token test prevents silent regression without a brittle full-render test. Stated deliberately, not skipped lazily.
- **Scope:** UI-only, ~3 files + 1 constant + 1 token test. No backend, no schema, no behavior change. Independent of Phases 1-3; classes carry into Phase 1.
