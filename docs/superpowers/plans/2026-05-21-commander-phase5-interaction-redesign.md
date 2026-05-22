# Commander Phase 5 — Interaction Redesign (LOCKED SCOPE)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Scope locked 2026-05-21** (revised after the /autoplan review + a follow-up scope pass). This is mostly a **visual redesign**, with two pieces of real functionality: session **Pin** (founder will use it) and a functional **`/skill` picker** (slash command + `+` add-button menu over the existing `companySkillsApi` + `use_skill` pipeline). The chat input box's **Attach / @mention / Voice** buttons stay disabled placeholders with "Coming soon" tooltips. The **autonomy pill is removed entirely** (no UI). Full review findings are preserved at the bottom of this file.

**Goal:** Bring the Commander page in line with the locked Phase 5 mockup at `.claude/commander-mockups/variant-B1.html`, scalable across mobile / tablet / desktop / wide.

**Success criterion (the one sentence the reviewers demanded):** *Founders can find and resume any past Commander session quickly (sessions sidebar with pin/search), and the chat reads as a focused operator tool (no wasted chrome, warm dark tokens) — measured by the redesign shipping with zero new console errors and the existing Phase 1-4 confirmation/streaming behavior intact.*

**Tech stack:** React + TanStack Query + Tailwind v4 + AoA design tokens (`ui/src/index.css` `@theme inline`).

---

## Locked decisions (what's in / out)

### BUILD — functional
- Kill the page topbar; chat workspace starts at the top edge
- Chat-pane caption strip: session title + `time · N msgs · 41k ctx · $0.26` (cost shown to ALL roles)
- Sessions header: full-width primary "New chat" + full-width ghost "Search" (inline filter, no modal) + small status row
- Single-line session rows: `○` outline (inactive) / `●` filled brand (active) circle; `📌`→Lucide Pin icon for pinned; edge-to-edge active highlight (bg + top/bottom border, NO inset margin so indicators align)
- Session `⋮` overflow menu (hover-revealed): Pin / Rename / Archive / Delete (Delete in `--error`)
- **Pin — real backend**: `pinned` boolean column on `internal_agent_conversations`, Drizzle migration, pin/unpin/rename routes, `commanderConversationsApi` methods, optimistic cache updates, PINNED group above TODAY (cap 5)
- Collapsed sessions: Slack-style icon strip (active = brand indicator bar, hover tooltip, `+` + search at top) — desktop only
- Empty state: greeting + 4 example-prompt chips + 1-2 recent chats to resume (NO proactive findings yet)
- Input box RESTYLE: new layout/hierarchy, primary `+` and send circles, ghost everything else. **No autonomy pill** (removed)
- **Skills picker — real (functional)**: typing `/` in the textarea opens a skill popover; the `+` add-button menu also has a "Use a skill" item. Both list the company's skills via the existing `companySkillsApi.list` (`GET /companies/:cid/skills`). Selecting a skill inserts its invocation directive into the message; on send, Commander acts on it through the **existing** `use_skill` MCP tool + skill-list prompt injection (`commander-skills.ts`). No new backend — this is wiring an ergonomic picker over a pipeline that already works end-to-end.
- Message hover: **Copy only** (assistant + user)
- Confirmation card polish: pulse-glow border while pending (respects `prefers-reduced-motion`, stops after 60s), mono params, "This will update **<entity>**" line (plain JSX, no dangerouslySetInnerHTML, truncate 80 chars)
- Responsive: mobile (<640) / tablet (640-1023) / desktop (1024-1535) / wide (≥1536). Mobile + tablet use a slide-in-from-left sessions drawer (shadcn Sheet, built-in focus trap + Escape)
- Touch targets: `(pointer: coarse)` media query bumps ghost icons 28px→40px, overflow ⋮ 22px→40px (desktop keeps dense sizing)
- Emoji → Lucide icons everywhere (design-system §1 bans emoji)

### DISABLED PLACEHOLDERS — styled, "Coming soon" tooltip, no functionality
- `@mention` and `🎤` Voice (input controls row)
- "Attach file" item inside the `+` add-button menu (the menu itself is functional for skills; the attach item is disabled)

### DEFERRED — not this phase
- MentionPicker (member-list data exists via `teamApi.get`, but mention *semantics* are unbuilt — defer)
- Voice (speech-to-text), file upload (storage backend)
- Retry / Edit-and-retry message actions (Copy only ships)
- Drag-and-reorder sessions
- Proactive findings in empty state
- Commander-as-whole-app-onboarding (future brainstorm)
- Cmd+K global search modal (inline filter is the v1 choice)

---

## Responsive breakpoints

| Tier | Width | Layout |
|------|-------|--------|
| Mobile | < 640px | Single column. Sessions in a slide-in-from-left drawer (Sheet). Chat fills viewport. Confirmation cards full-width (pane minus 12px margin). Touch targets ≥40px. |
| Tablet | 640-1023px | Nav rail collapses to icon strip (use existing `useSidebar` collapse). Sessions in a drawer toggled from the caption strip. Chat fills. |
| Desktop | 1024-1535px | Three columns: nav rail (200px) + sessions (220px) + chat. Sessions collapsible to 40px icon strip. Default. |
| Wide | ≥ 1536px | Same as desktop. Chat message column capped at 880px (centered) to keep line length readable. |

Reuse the existing `useSidebar` / breakpoint logic — do NOT invent a parallel `useResponsiveCommander` hook (Eng A2). If a project-wide `useBreakpoint` exists, extend it; otherwise add one at `ui/src/lib/useBreakpoint.ts`.

---

## State visuals (the reviewers' #1 ask — spec these, don't let the implementer invent)

| State | Visual |
|-------|--------|
| `no-session-selected` | Empty state: greeting + 4 prompt chips + 1-2 recent chats |
| `session-loading-history` | Skeleton: 4 bone rows (alternating widths) in the message list, gradient sweep |
| `session-loaded-idle` | Messages + caption strip. Input enabled. |
| `user-typing` | Input card border → `--brand`, `box-shadow: 0 0 0 3px var(--brand-focus-ring)` |
| `skill-picker-open` | Popover above the input (anchored left): filtered skill list, keyboard-highlighted row (`--brand`-tinted), name + dim description + mono key. Empty filter → all skills; no matches → "No skills match". Esc/click-away closes |
| `assistant-streaming-text` | Streaming text + a 2px-wide `--brand` block cursor `▌` at the tail. Send button → Stop (square, `--error`). Auto-scroll ONLY if user is at-bottom (within 50px); else show floating "↓ New messages" pill |
| `assistant-tool-call-pending` | Existing tool-call pill, `--brand` pulsing dot |
| `assistant-confirmation-pending` | Amber card, pulse-glow border (newest pending only; older pending = static muted amber). Input stays enabled |
| `assistant-confirmation-approving` | Card: "Approving…" + spinner, buttons disabled |
| `assistant-confirmation-approved` | Card: green check + "Approved", buttons → small "Done" tag, animation off |
| `assistant-confirmation-rejected` | Card: grey "Cancelled", no buttons, animation off |
| `assistant-confirmation-failed` | Card: `--error` "Failed" + error message below params, animation off |
| `network-error` | Inline error notice at chat bottom + partial assistant content preserved + "Retry" button on the last user message |
| `permission-denied` | Tool-result pill: `--error` text + `--error`-tinted border + "Permission denied" caption |

Animation tokens: use `--motion-fast` (140ms) for hovers/transitions, `--motion-base` (180ms) for popovers/drawers. Pulse-glow animates `border-color` only (not `box-shadow` — paint cost), wrapped in `@media (prefers-reduced-motion: no-preference)`.

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/db/src/schema/internal_agent.ts` | Modify | Add `pinned` boolean column to `internalAgentConversations` |
| `packages/db/src/migrations/` | Generate | `pnpm db:generate` for the pinned column |
| `server/src/routes/internal-agent.ts` | Modify | Add PATCH pin/unpin + PATCH rename routes for conversations |
| `ui/src/api/internal-agent.ts` | Modify | Add `pin`, `unpin`, `rename` to `commanderConversationsApi` |
| `ui/src/pages/Commander.tsx` | Modify | Kill topbar, render ChatPaneCaption, mobile/tablet drawer toggle |
| `ui/src/components/commander/` | Create dir | New home for extracted commander components |
| `ui/src/components/commander/SessionsSidebar.tsx` | Move+modify | (was CommanderSessionsSidebar.tsx) header redesign, groups, drawer |
| `ui/src/components/commander/SessionRow.tsx` | Create | Single-line row: ○/●/Pin indicator + title + ⋮ menu |
| `ui/src/components/commander/SessionOverflowMenu.tsx` | Create | shadcn DropdownMenu: Pin/Rename/Archive/Delete |
| `ui/src/components/commander/CollapsedSessionStrip.tsx` | Create | 40px icon strip (desktop only) |
| `ui/src/components/commander/ChatPaneCaption.tsx` | Create | 44px caption strip (title + meta) |
| `ui/src/components/commander/CommanderEmptyState.tsx` | Create | Greeting + prompt chips + recent chats |
| `ui/src/components/commander/SkillPicker.tsx` | Create | Skill popover (`/` slash + `+` menu trigger). Lists `companySkillsApi.list`, filters by typed query, inserts skill invocation directive into the textarea |
| `ui/src/components/commander/InputAddMenu.tsx` | Create | `+` button shadcn DropdownMenu: "Use a skill" (functional → SkillPicker) + "Attach file" (disabled, "Coming soon") |
| `server/src/mcp/tools/index.ts` | Modify | Widen `toolAllowedActors["use_skill"]` `["board"]` → `["board","commander"]` (Task 9 step 1 — fixes Commander 403) |
| `ui/src/api/companySkills.ts` | Reuse | `companySkillsApi.list` already exists — no change. `queryKeys.companySkills.list(cid)` also already exists |
| `ui/src/components/InternalAgentPanel.tsx` | Modify | Restyle input box (no autonomy pill), wire `/` slash + `+` menu to SkillPicker, Copy hover action, caption integration, confirmation polish, drop "All clear" widget |
| `ui/src/lib/useBreakpoint.ts` | Create (if absent) | Project-wide breakpoint tier hook |
| `ui/src/index.css` | Modify | Add `--row-compact: 32px` token + `commander-pulse-border` keyframes |
| `docs/superpowers/uat/2026-05-20-commander-uat.md` | Modify | Run 4 results |

**Directory note (Eng A1):** move the existing `CommanderSessionsSidebar.tsx` into `components/commander/` so the whole tree lives in one namespace. Add a barrel `components/commander/index.ts`.

---

## Tasks (dependency order)

### Task 1: Pin backend — schema + migration + routes + API
**Files:** `packages/db/src/schema/internal_agent.ts`, migration, `server/src/routes/internal-agent.ts`, `ui/src/api/internal-agent.ts`

- [ ] Add `pinned: boolean("pinned").default(false).notNull()` to `internalAgentConversations`
- [ ] `pnpm db:generate` → verify migration is `ALTER TABLE ... ADD COLUMN pinned boolean DEFAULT false NOT NULL`
- [ ] Add `PATCH /companies/:cid/internal-agent/conversations/:convId/pin` body `{pinned: boolean}` — `assertCompanyAccess` + userId ownership check (same pattern as the messages endpoint from Phase 2 Task 8)
- [ ] Add `PATCH /companies/:cid/internal-agent/conversations/:convId/rename` body `{title: string}` (z.string().min(1).max(200)) — same auth
- [ ] Add `pin(cid, convId, pinned)`, `rename(cid, convId, title)` to `commanderConversationsApi`
- [ ] Contract tests: both routes exist, both check userId ownership, pin defaults false
- [ ] Commit: `feat(commander): pin + rename backend for conversations`

### Task 2: Move sidebar into commander/ + extract SessionRow/OverflowMenu/CollapsedStrip
**Files:** `components/commander/SessionsSidebar.tsx` (moved), `SessionRow.tsx`, `SessionOverflowMenu.tsx`, `CollapsedSessionStrip.tsx`, `Commander.tsx` (import update)

- [ ] `git mv ui/src/components/CommanderSessionsSidebar.tsx ui/src/components/commander/SessionsSidebar.tsx`
- [ ] Update import in `Commander.tsx`
- [ ] Extract the three child components (empty shells first, TDD per component)
- [ ] Add `components/commander/index.ts` barrel
- [ ] TS check + commit: `refactor(commander): move sidebar into commander/ namespace + extract row components`

### Task 3: Sessions header redesign + inline search filter
**Files:** `SessionsSidebar.tsx`

- [ ] Full-width brand "New chat" button (Lucide Plus + label)
- [ ] Full-width ghost "Search sessions" button → on click morphs to an input; filters all groups (incl PINNED) by case-insensitive title substring; `useMemo` the filter + grouping (Eng P2); clearing/blank closes; new chat clears the filter (TC: Design #4)
- [ ] Small status row below: `● online` + collapse chevron
- [ ] Commit: `feat(commander): sessions header with full-width new-chat + inline search`

### Task 4: SessionRow with ○/● indicators + edge-to-edge active
**Files:** `SessionRow.tsx`, `index.css`

- [ ] Add `--row-compact: 32px` to `ui/src/index.css` with a comment ("denser than --row-data for high-frequency session lists")
- [ ] Single-line row: indicator (9px circle, `align-items:center` so it's vertically centered) + title (truncate) + hover-revealed `⋮`
- [ ] Inactive: `○` 1.5px outline `--very-dim`. Active: `●` filled `--brand`. Pinned: Lucide `Pin` 12px (render circles in a 12px box too, so pin + circle baselines align — Design C)
- [ ] Active row: edge-to-edge `bg color-mix(--card-2 80%)` + 1px top/bottom border, NO inset margin
- [ ] Commit: `feat(commander): single-line session rows with circle indicators`

### Task 5: SessionOverflowMenu wired to real backend (optimistic)
**Files:** `SessionOverflowMenu.tsx`

- [ ] shadcn DropdownMenu: Pin/Unpin (toggles via Task 1 API), Rename (inline input, NOT prompt()), Archive (existing), Delete (`--error`, confirm first)
- [ ] Pin/rename use `onMutate` optimistic cache update + `onError` rollback (Eng A4) — no flicker
- [ ] Keyboard nav (arrow + enter + escape) via shadcn defaults
- [ ] Commit: `feat(commander): session overflow menu (pin/rename/archive/delete) with optimistic updates`

### Task 6: Pinned group + collapsed icon strip
**Files:** `SessionsSidebar.tsx`, `CollapsedSessionStrip.tsx`

- [ ] PINNED group (Lucide Pin label) above TODAY, cap 5, sorted by pin time
- [ ] Collapsed strip (desktop only): `+` (brand) + search icon at top, divider, session icons (active = brand bar), hover tooltip with title, count at bottom
- [ ] Commit: `feat(commander): pinned group + collapsed sessions icon strip`

### Task 7: Kill topbar + ChatPaneCaption + empty state
**Files:** `Commander.tsx`, `ChatPaneCaption.tsx`, `CommanderEmptyState.tsx`, `InternalAgentPanel.tsx`

- [ ] Drop the breadcrumb topbar from `Commander.tsx`
- [ ] ChatPaneCaption (44px): title (0.95rem/600) + meta (`time · N msgs · 41k ctx · $cost`, mono numerics, cost shown to all). ctx/cost: lock to denormalized fields on ConversationRow OR omit if absent — do NOT N+1 getRuns per session (Eng A5). For v1, omit ctx/cost if not on the row; ship `time · N msgs`
- [ ] CommanderEmptyState: greeting + 4 prompt chips (click → sends as message) + 1-2 recent chats (click → loads). Drop the "All clear" widget
- [ ] Mobile/tablet: a "Sessions" button in the caption strip opens the drawer
- [ ] Commit: `feat(commander): kill topbar, add caption strip + empty state with prompts + recent chats`

### Task 8: Input box restyle (functional `+` menu, disabled @mention/voice, no autonomy pill)
**Files:** `InternalAgentPanel.tsx`, `commander/InputAddMenu.tsx`

- [ ] Restyle the input to the mockup layout: textarea (auto-grow, max 140px) in a bordered card; controls row below
- [ ] Controls row (left→right): `+` add-button (FUNCTIONAL — opens `InputAddMenu`), `@mention` (disabled, tooltip "Coming soon"), `🎤` voice (disabled, tooltip "Coming soon"), spacer, send circle (brand; → Stop square `--error` while streaming). **No autonomy pill.**
- [ ] `InputAddMenu` (shadcn DropdownMenu): "Use a skill" item (functional → opens SkillPicker, Task 9) + "Attach file" item (disabled, "Coming soon"). Lucide icons, no emoji.
- [ ] Keep existing Cmd+Enter send, Escape stop
- [ ] Preserve auto-scroll fix: only auto-scroll if user at-bottom (Eng E1)
- [ ] Commit: `feat(commander): restyle input box (functional + menu, no autonomy pill)`

### Task 9: Functional `/skill` picker (slash command + `+` menu)
**Files:** `server/src/mcp/tools/index.ts`, `commander/SkillPicker.tsx`, `InternalAgentPanel.tsx`

> **CRITICAL backend prerequisite (verified 2026-05-21):** Commander spawns as the `"commander"` MCP actor (`cli-mode.ts:471,574` → `AOA_ACTOR_TYPE=commander`), but `use_skill` is allowlisted to `["board"]` only (`server/src/mcp/tools/index.ts:52`). The dispatch gate (`server/src/mcp/server.ts:555-558`) therefore returns **403** when Commander calls `use_skill`. Phase 2 widened the actor but never widened this allowlist. **Without step 1 below, the picker inserts text and Commander silently fails the skill call — the exact vaporware we're avoiding.** No test currently pins the `["board"]` value, so widening it is safe.

- [ ] **Step 1 (backend, do first):** change `toolAllowedActors["use_skill"]` from `["board"]` to `["board", "commander"]` in `server/src/mcp/tools/index.ts:52`. Update the inline comment to note Commander needs skill access. Add a contract test asserting `toolAllowedActors["use_skill"]` includes both `"board"` and `"commander"`. Commit: `fix(commander): allow commander actor to call use_skill (was board-only → 403)`.
- [ ] `SkillPicker` lists `companySkillsApi.list(companyId)` (`useQuery`, key `queryKeys.companySkills.list(cid)` — already exists); render `{name, description}` with mono `key`. Empty/loading/error states. Cap visible to ~8 with scroll.
- [ ] Trigger A — slash: when the textarea value matches `/^\/(\w*)$/` at the caret (start of input or after whitespace), open the popover anchored to the input; the captured `\w*` filters the list by case-insensitive `name`/`key` substring (`useMemo`).
- [ ] Trigger B — `+` menu: "Use a skill" opens the same popover.
- [ ] Selecting a skill: replace the `/query` token with an invocation directive built from the list item — `use the "<name>" skill` (the list item has `name`, `key`, `description` but NO `triggerPhrases`; `commander-skills.ts` maps names→keys server-side). Close popover, refocus textarea, caret at end. Do NOT auto-send.
- [ ] Keyboard: ↑/↓ moves selection, Enter selects, Escape closes (do not send/stop while the picker is open — guard the existing Escape/Enter handlers so the picker wins, Eng E2 pattern).
- [ ] On send, no special frontend handling: Commander receives the skill list in its prompt (`buildCompactSkillList`) and (after step 1) can call `use_skill` — verify end-to-end in UAT (Task 12).
- [ ] Tests: allowlist contract (step 1), filter logic (slash regex + substring), directive-insertion replaces the token (not appends), keyboard selection.
- [ ] Commit: `feat(commander): functional /skill picker (slash + add-menu) over use_skill pipeline`

### Task 10: Message hover Copy + confirmation card polish
**Files:** `InternalAgentPanel.tsx`

- [ ] Hover on assistant/user message → floating Copy button (top-right). Copy writes content to clipboard. (Retry/Edit deferred — do NOT render dead buttons)
- [ ] Confirmation card: `commander-pulse-border` keyframes (border-color only, prefers-reduced-motion guard, newest-pending-only, stop after 60s), entity line (plain JSX, 80-char truncate)
- [ ] Commit: `feat(commander): message Copy action + confirmation card pulse/entity polish`

### Task 11: Responsive (mobile/tablet/desktop/wide) + touch targets + Lucide sweep
**Files:** `Commander.tsx`, `SessionsSidebar.tsx`, `useBreakpoint.ts`, all commander components

- [ ] Reuse/extend existing `useSidebar`/breakpoint logic (no parallel hook)
- [ ] Mobile/tablet: sessions in a shadcn Sheet drawer (slide from left, focus trap, Escape — scope the existing global Escape handler to not double-fire, Eng E2)
- [ ] Wide: cap chat message column at 880px centered
- [ ] `(pointer: coarse)` bumps for touch targets
- [ ] Replace all emoji with Lucide icons across components + mockup
- [ ] Commit: `feat(commander): responsive tiers + touch targets + lucide icon sweep`

### Task 12: UAT Run 4
**Files:** `docs/superpowers/uat/2026-05-20-commander-uat.md`

- [ ] Browser UAT: sidebar (new/search/pin/rename/archive/collapse), session switching still works (Phase 2), confirmation flow still works (Phase 4), empty state, responsive resize desktop→tablet→mobile, `@mention`/voice/attach show "Coming soon" tooltips, **no autonomy pill present**, no new console errors
- [ ] **Skill picker end-to-end:** type `/` → picker opens + filters; pick a skill via slash AND via `+` menu; verify the directive is inserted (not auto-sent); send → confirm Commander actually invokes `use_skill` (watch the tool-call pill / activity)
- [ ] Append Run 4 results
- [ ] Commit: `docs(uat): Run 4 — Phase 5 redesign verification`

---

## Tests
- Task 1: contract tests for pin/rename routes (ownership + shape)
- Task 4: SessionRow renders correct indicator per state (inactive/active/pinned)
- Task 5: overflow menu optimistic update + rollback on error
- Task 3: search filter includes PINNED group, clears on new chat
- Task 9: `use_skill` allowlist includes `commander` (contract); skill picker — slash regex match, substring filter, directive-insertion replaces the `/query` token, keyboard selection
- Task 11: breakpoint hook tier transitions (matchMedia mock)
- UAT Run 4: full browser pass (incl. skill picker end-to-end → `use_skill`)

Baseline: `pnpm vitest run server/src/__tests__` stays green; `pnpm --filter ui run typecheck` + `pnpm --filter @armyofagents/server run typecheck` clean.

---

## Execution
`superpowers:subagent-driven-development`, tasks in order. Task 1 (backend) first since Task 5 depends on it; Task 9 (skill picker) depends on Task 8 (input restyle). Estimated ~3-4 days at subagent pace — the functional `/skill` picker (Task 9) is cheap because no backend is needed (the `companySkillsApi` + `use_skill` pipeline already exists); autonomy-pill removal is a net deletion.

---

## /autoplan Review Pipeline — Findings (reference)

Ran 2026-05-21. CEO + Design + Eng (subagent-only voices). Scores: CEO 0/6 Yes, Design 5.3/10, Eng 0/6 Yes + 1 Partial. The locked scope above resolves the major findings:
- Pin-is-a-lie → Pin shipped for real (Task 1)
- Autonomy vaporware → **autonomy pill removed entirely** (revised 2026-05-21 — no dead UI, addresses the finding directly)
- Skills-as-dead-button → **`/skill` picker now functional** (Task 9) over the existing `companySkillsApi` + `use_skill` pipeline; only @mention/voice/attach remain disabled placeholders
- Scope 50% over → cut functional mention/voice/attach popovers + retry-edit; kept skills (cheap — pipeline exists) → ~3-4 days
- Empty-state regression → real empty state (Task 7)
- Mobile unvalidated → user confirmed mobile/tablet matter, kept (Task 11)
- Backend gaps → only Pin needs backend, now budgeted (Task 1)
- State machine aspirational → state visuals now specced (table above)
- Touch targets / emoji / row-token → addressed (Tasks 4, 11)

Full reviewer detail is in the restore point: `~/.gstack/projects/MeteoriteLabs-AoA/commander-subagent-1-autoplan-restore-20260521-003116.md` and the prior version of this file in git history.
