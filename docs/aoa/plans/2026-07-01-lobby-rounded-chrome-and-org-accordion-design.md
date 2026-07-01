# Lobby rounded chrome + New-organization accordion — Design

**Date:** 2026-07-01
**Branch:** `feat/lobby-ui` (off `origin/main` @ `de90427e1`)
**Status:** Approved (design), pending implementation plan
**Author:** TK + Claude

---

## Goal

Two lobby-tier UI refinements requested by the founder:

1. **Rounded chrome** — make the lobby sidebar (and the lobby-tier secondary
   sidebar) float as rounded "island" panels instead of flush full-height rails
   with a right border.
2. **New-organization accordion** — turn the single "+ New organization" CTA into
   a split control: a primary create button plus a chevron that expands an inline
   accordion revealing an "Import organization" option.

## Scope

**Lobby-tier chrome only** — the surfaces rendered through `LobbyShell`
(`ui/src/components/LobbyShell.tsx`): the Lobby (org list / empty state),
Marketplace, and Settings.

**Explicitly out of scope (follow-up):** the in-company primary `Sidebar`
(WORK / DEPARTMENTS / etc.) and the in-company consumers of `SecondarySidebar`
(`TeamLayout`, in-company `SettingsLayout`). These keep the flush-rail look for
now. A later follow-up may propagate the floating treatment app-wide for
consistency. (User decision: "lobby now, app later.")

## Design decisions (locked during brainstorm)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Aesthetic = "floating rail only"**, not "full floating panels". Only the sidebar(s) become rounded islands; main content stays flush to the window edge. | User compared both live and chose the lighter treatment. |
| D2 | **No drop shadow** on the floating rail. | design-system §7: inline UI never has shadows — reserved for floating overlays. Border + `bg-card/50` carries the float. |
| D3 | **Split button**, primary click still creates in one click (no regression). Chevron is a *separate* secondary button. | Preserves the existing one-click create; adds import without a second permanent CTA. |
| D4 | **Import via inline accordion** below the split button (not a floating dropdown menu). | Matches the founder's "accordion" mental model. Closes on navigate. |
| D5 | **Collapsed rail (56px) = create-only.** Chevron + accordion hidden; the `+` icon just creates, as today. | User: "when collapsed we don't need to show it." Import is a rarer action; no room at 56px. |
| D6 | **Secondary sidebar rounding is opt-in** via a new `floating` prop (default `false`). | `SecondarySidebar` is shared with in-company pages; a global change would leak past the agreed scope. |

## Components touched

### 1. `LobbySidebar.tsx` (primary rail)

- **Rounded island:** the non-drawer `<aside>` drops `border-r`, gains
  `my-2 ml-2 overflow-hidden rounded-2xl border border-border`, and switches
  height from `h-dvh` to `h-[calc(100dvh-1rem)]` to account for the vertical
  margin. Drawer mode (mobile Sheet) is unchanged (`w-full h-dvh`, no rounding).
- **Split-button CTA (expanded only):** primary `Button` (create →
  `onCreateCompany`) with `flex-1`, plus a secondary icon `Button` holding a
  `ChevronDown` that toggles `orgMenuOpen` state. When open, an accordion
  `<button>` row ("Import organization", `Upload` icon) renders below and
  navigates to `/import` (via the sidebar's existing `navTo`, which also fires
  `onNavigate` to close the mobile drawer). The chevron rotates 180° when open.
  `aria-expanded` reflects state; the accordion row closes itself on click.
- **Collapsed CTA:** unchanged — the icon-only `+` button that creates, wrapped
  in a tooltip. No chevron, no accordion.
- **Collapse toggle:** `SidebarCollapseToggle` gets `sidebarWidth + 8` (to sit on
  the seam after the 8px left gutter) and `top={17}` (to align with the header
  row inside the floated card).

### 2. `SecondarySidebar.tsx`

- Add `floating?: boolean` prop (default `false`).
- When `floating`, drop `border-r` and add
  `my-2 ml-2 overflow-hidden rounded-2xl border border-border` plus
  `h-[calc(100dvh-1rem)]`, mirroring the primary rail. When `false`, render
  exactly as today (protects `TeamLayout` + in-company `SettingsLayout`).

### 3. Lobby-tier call site

- `InstanceSettingsPage.tsx` (the only lobby-tier `SecondarySidebar` consumer)
  passes `floating` to its `SecondarySidebar`. In-company consumers are left
  untouched.

### 4. Docs

- `docs/architecture/design-system.md` §8 — document the lobby-tier floating-rail
  treatment (rounded island, `my-2 ml-2`, no shadow per §7, collapse-toggle seam
  offset) so future work stays consistent and knows it is lobby-scoped.

## Data flow / state

- New local state `orgMenuOpen: boolean` in `LobbySidebar` (default `false`).
  Toggled by the chevron; reset to `false` on import-navigate. No persistence —
  the accordion always starts closed on mount.
- No new props on `LobbyShell` / `LobbySidebar` for import: the sidebar already
  has `navigate`, so import is `navTo("/import")` — the same route the empty-state
  hero uses (`LobbyEmptyState.onImport`).

## Accessibility

- Chevron button: `aria-label="More organization options"`, `aria-expanded`
  bound to `orgMenuOpen`.
- Accordion import row is a real `<button type="button">` (keyboard-focusable).
- Rounded rails are cosmetic; nav semantics unchanged.

## Testing

- **`LobbySidebar` (new/updated tests):**
  - Expanded: renders the split button; chevron toggles the accordion; clicking
    "Import organization" calls navigation with `/import` and closes the
    accordion; primary button still calls `onCreateCompany`.
  - Collapsed: no chevron / no import row rendered; `+` still creates.
  - Drawer mode: still renders full-width (no rounding regressions), accordion
    import fires `onNavigate`.
- **`SecondarySidebar` (updated test):** `floating` toggles the rounded classes;
  default render is byte-for-byte the flush rail (guards in-company usage).
- Existing `SettingsPage-redesign` / `InstanceSettingsPage-signout` /
  `SecondarySidebar` tests must stay green.

## Risks / edge cases

- **Click-outside to close the accordion:** not implemented (v1). The accordion
  closes on navigate and on chevron re-click; a stray-open state is harmless.
  Noted as an optional follow-up.
- **Collapse-toggle offset is magic-number-ish** (`+8`, `top 17`). Tied to the
  `ml-2` / `my-2` gutter; if the gutter changes, the offset must change with it.
  Documented in §8 so it is not mysterious.
- **`overflow-hidden` on the rail** clips nothing important — the collapse toggle
  and tooltips are rendered outside the aside (sibling / portal), so they are not
  clipped.

## Non-goals

- No change to the empty-state hero (`LobbyEmptyState`) — its Create/Import CTAs
  stay. (The accordion is additive chrome, not a replacement.)
- No app-wide propagation of the floating look.
- No dropdown-menu variant of the org CTA.
