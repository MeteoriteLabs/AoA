# Agent Detail Page Redesign — Design

- **Date:** 2026-06-24
- **Status:** Design (approved direction; pending field/interaction review)
- **Branch:** `docs/agent-page-redesign`
- **Authors:** Founder + Claude (brainstorming session)
- **Scope:** Visual + interaction redesign of the agent detail page — the shared chrome (`AgentDetailCore`), the worker/org page (`AgentDetail.tsx`), and the Commander/AoA page (`AoaAgentDetail.tsx`). No backend/API changes required for v1; some are flagged as opportunities.

> This is a **design doc**, not an implementation plan. It defines the target UI and interaction model and inventories every existing field/action so nothing is dropped in the rebuild. The implementation plan (phasing, tasks, tests) is a follow-up via the writing-plans flow.

---

## 1. Goals & non-goals

### Goals
1. **One cohesive "hero" card** at the top carrying identity, live status, adapter/model, key metrics, and actions — replacing today's bare header row.
2. **One consistent card language** across all tabs (today each tab has a different ad-hoc layout), aligned with `docs/architecture/design-system.md`.
3. **Tame density** — turn the 7-section Overview scroll into a small set of scannable blocks; group the sprawling Config form into labelled sections.
4. **A deliberate, consistent interaction model** — define exactly how each surface edits and commits, what confirms destructive actions, and what every loading/empty/error/saving state looks like.
5. **Preserve 100% of existing capability.** Every field and action inventoried in §5–§7 must survive the redesign.

### Non-goals (v1)
- Renaming tabs or DB tables/routes.
- New backend features. (Triggers edit/delete, RBAC enforcement, and type-drift fixes are *flagged* but each is optional/independent.)
- Redesigning `NewAgentDialog` (the create flow) beyond what consistency requires.

---

## 2. Current state (grounded)

Two pages share one chrome:

| Page | File | Agents | Tabs | Header actions |
|---|---|---|---|---|
| Worker/org | `ui/src/pages/AgentDetail.tsx` (2802 lines) | `kind: org` | Overview · Instructions · Runs · Skills · Config | Assign Task, Invoke, Pause/Resume, status badge, mobile Live pill, More menu (Configure / Copy ID / Reset Sessions / Terminate) |
| Commander/AoA | `ui/src/pages/AoaAgentDetail.tsx` (591 lines) | `kind: aoa` | Overview · Instructions · Runs · Skills · Config · **Triggers** | Pause/Resume only (founder-gated); no Invoke/Terminate |

Shared chrome: `ui/src/components/agent-detail/AgentDetailCore.tsx` — renders header (icon picker + name + role/title subtitle + `headerActions` slot), a floating Save/Cancel bar (`actionBar`), the tab bar (`PageTabBar`), and the active tab via `renderTab()`.

### Problems this redesign fixes
- **Bare header row** — icon + name + a few buttons; carries no live status, adapter, model, or KPIs (all buried in Overview).
- **Overview is a 7-section vertical scroll** — 4 stat cards (7-day window) → trust score → latest run → 4 charts (14-day window) → recent tasks → budget → config summary. Dense but unscannable; stat cards duplicate data, and the config summary duplicates the Config tab.
- **Config is one long form** with collapsible sections; visually undifferentiated.
- **Skills** is a flat checkbox list with no search/grouping and (notably) **no error rollback** on a failed toggle.
- **Inconsistent surfaces** — Runs, Instructions, Skills, Config each invent their own layout.
- **Duplicated code** — run-row rendering, status-icon maps, and the entire Skills tab are duplicated between worker and AoA pages, with subtle drift.

---

## 3. Design principles

From `docs/architecture/design-system.md` (the design-guide):
- **Dense but scannable.** Whitespace separates, not pads.
- **Contextual, not modal. Inline editing over dialog boxes.** ← drives the editing architecture (§7.2).
- **One card language:** `rounded-lg`, `0.5px`/`border-border` borders, `shadow-sm` max, section titles `text-sm font-medium`/`font-semibold`, property rows label-left (`text-xs text-muted-foreground`) / value-right.
- **Status/priority via `StatusBadge`/`StatusIcon`** — never ad-hoc colors.
- **Dark theme default**, semantic tokens only.

---

## 4. Information architecture

**Keep the 5 worker tabs** (decision: Overview stays a tab; the hero carries the KPIs, the Overview tab carries the analytical dashboard). AoA keeps its 6th tab (Triggers).

```
┌──────────────────────────────────────── HERO CARD ─────────────────────────────────────┐
│ [icon]  Name  ● status     adapter · model              [Assign][Invoke][Pause][⋯]      │
│         role — title                                                                     │
│ ───────────────────────────────────────────────────────────────────────────────────── │
│ Tasks(wk) · Success(wk) · Cost(wk) · Trust · Last run        (KPI strip — read-only)    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
  Overview · Instructions · Runs · Skills · Config            (· Triggers, AoA only)
  └─ active tab content
```

The hero card lives in `AgentDetailCore` so **both pages inherit it for free**.

---

## 5. The hero card

Replaces `AgentDetailCore.tsx:62-91`. One bordered card (`rounded-lg`), two zones.

### 5.1 Identity zone (left)
| Element | Source | Editable? | Notes |
|---|---|---|---|
| Icon (48px tile) | `agent.icon` | **Inline** — `AgentIconPicker` popover (search + 40-icon grid, default `bot`) | Already inline today; keep. Immediate commit (`updateIcon`). |
| Name | `agent.name` | **Inline** (decision: hero name/title editable inline) | `text-2xl font-bold`; immediate commit via `agentsApi.update`. |
| Role — title subtitle | `roleLabels[agent.role]` + `agent.title` | Inline (title), role via Config | `text-sm text-muted-foreground`. |
| Status pill | `agent.status` (`StatusBadge`) | read-only | `active/paused/idle/running/error/pending_approval/terminated`. |
| Adapter + model badges | `agent.adapterType` + `adapterConfig.model` | read-only (edit in Config) | mono pills; model omitted if unset. |

> `pending_approval` shows the existing amber banner ("pending board approval, cannot be invoked yet") and disables Invoke/Pause/Resume.

### 5.2 KPI strip (read-only, deep-links — §7.5)
Pulled up from Overview so the hero answers "what is this agent right now?":

| KPI | Value (worker) | Window | Deep-link target |
|---|---|---|---|
| Tasks | `tasksCompletedThisWeek` | 7d | Recent tasks / Issues filtered by assignee |
| Success | `successRate%` or `—` | 7d | Overview / Runs |
| Cost | `$costThisWeek` | 7d | Budget (Overview) |
| Trust | `formatTrustScorePercent(currentScore)` | last 20 weighted 2× | Trust card (Overview) |
| Last run | `relativeTime(latestRun.createdAt)` | n/a | Runs (selected run) |

AoA variant KPI strip: Status · Role · Total runs (AoA has no tasks/cost/trust today — keep its 3-stat reality, styled as the same strip).

### 5.3 Actions zone (right) — full inventory (worker)
| Action | Icon | Behavior | Visibility / disable |
|---|---|---|---|
| Assign Task | `Plus` | `openNewIssue({ assigneeAgentId })` | always |
| Invoke | `Play` | `agentAction("invoke")` → navigates to new run | disabled when pending/`pending_approval` |
| Resume | `Play` | `agentAction("resume")` | only when `status === "paused"` |
| Pause | `Pause` | `agentAction("pause")` | when not paused |
| status badge | — | `StatusBadge` | `sm:` and up |
| Live pill | ping dot | link to live run | **mobile only**, when a `running`/`queued` run exists |
| More menu (`⋯`) | `MoreHorizontal` | Configure / Copy Agent ID / Reset Sessions / **Terminate** (destructive) | always |

AoA actions zone: **Pause/Resume only, founder-gated** (`isFounder`); no Invoke/Assign/Terminate/More menu (backend hard-blocks invoke + delete for `kind=aoa`). Keep this difference; render via the shared `headerActions` slot.

### 5.4 Mobile
Action labels collapse to icon-only (`hidden sm:inline`); the Save/Cancel bar becomes the fixed bottom bar (existing pattern); KPI strip wraps to 2 rows.

---

## 6. Per-tab redesign

### 6.1 Overview (worker) — 3 scannable blocks
The hero now owns the KPIs and (formerly Overview's) Configuration Summary moves out (it duplicated the Config tab). Remaining content, reorganized:

1. **Activity** card — the 4 charts (`RunActivityChart`, `PriorityChart` w/ legend, `IssueStatusChart` w/ legend, `SuccessRateChart`), all 14-day window, in a 4-col grid inside one card. Per-chart empty states preserved ("No runs yet" / "No tasks"); zero-days render faint placeholder bars.
2. **Recent tasks** (left, ~60%) — `EntityRow` list, `slice(0,10)`, "+N more" footer, "See All →" → `/issues?assignee=`. Empty: "No assigned tasks."
3. **Budget** (right, ~40%) — aggregate tokens (input/output/cached via `formatTokens`) + total cost; per-run cost table (`slice(0,10)`: Date / Run / Input / Output / Cost). Needs a real empty state (today shows just the heading).
4. **Trust score** — keep `AgentTrustScoreCard` (header + Info tooltip, big % tone-colored, progress bar, "X of Y approved", recent-20 line, trend indicator, "No data yet" empty state). Place beside the KPI hero context or atop Overview.

**Removed from Overview:** the 4 quick-stat cards (→ hero KPI strip) and `ConfigSummary` (→ Config tab is the source of truth). `LatestRunCard` collapses into the hero's "Last run" KPI + Runs tab.

### 6.2 Instructions — one framed editor
Keep the existing engine (`ui/src/components/AgentInstructionsTab.tsx`), reframe it in the card language.

- **Layout:** toolbar (active file path + bundle-mode + save state) over a two-pane body: file rail (resizable 180–500px) + editor. Mobile = list↔editor toggle (`FolderOpen`/`✕`).
- **File operations:** select (tree + dir expand/collapse); **create** (`+`, in-memory until Save; rejects paths with `..`); **delete** (editor-header button, hidden for the entry file + virtual/deprecated files, **ConfirmDialog**); **no rename** (entry-file input changes the entry point, not file contents).
- **Bundle modes** (in an "Advanced" disclosure): **Managed** (AoA stores/serves; root path read-only) vs **External** (user path; editable root path input). Switching stashes/restores the other mode's bundle ref. Entry file input (default `AGENTS.md`).
- **Loaded Skills panel:** read-only chips of attached skills (+ amber orphan chips for missing keys, count badge, "Manage in Skills tab" link).
- **Commit:** batched — dirty raises the page Save/Cancel bar; saves bundle then file. `useBeforeUnload` guard. (See §7.1.)
- **States:** not-local guard ("Instructions bundles are only available for local adapters"); bundle skeleton; file skeleton (`PromptEditorSkeleton`); warnings banner; "New file in this bundle"; saving via Save bar.

### 6.3 Runs — master/detail (the richest tab)
Reframe; do not lose anything.

- **Run list** (left rail `w-72`; mobile list↔detail with "Back to runs"): per row — status icon (`runStatusIcons`), short id (mono), **invocation-source pill** (Timer/Assignment/On-demand/Automation), relative time, summary (60-char), metrics (`{tokens} tok`, `$cost`). Sort `createdAt` desc; desktop auto-selects latest. Empty: "No runs yet."
- **Run detail** — summary card: `StatusBadge` + inline actions **Cancel** (running/queued), **Resume** (only `process_lost` + failed), **Retry** (failed/timed_out, not resume-eligible) → all with pending labels + error lines; timing block (start→end, relative, live-ticking duration); error + errorCode; **Claude auth recovery** (login button + url + stdout/stderr when `claude_auth_required`); exit code/signal. Right: metric grid (Input/Output/Cached/Cost) when present.
- **Session row** (collapsible): Before/After IDs (`CopyText`), "(changed)" marker, **Clear session** link → **ConfirmDialog** ("Clear session for N task(s)… discarded on next run").
- **Tasks Touched** — links with `StatusBadge`. **stderr/stdout excerpts**. **Adapter output** (process adapter only).
- **Log viewer** (`LogViewer`): live via **WebSocket** (`heartbeat.run.log`/`heartbeat.run.event`, 1.5s reconnect) with 2s polling fallback; auto-follow; **invocation panel** (adapter/cwd/command/prompt/context/env — env redacted); **transcript** (per-kind colored: assistant/thinking/user/tool_call/tool_result/init/result/raw) + "Jump to live" + live ping; **failure box**; **raw events** list (level/stream colored). States: "Loading run logs…", "No log events.", inline `logError`, 404-log treated as unavailable.
- **AoA Runs** (`AoaRunsPanel`): read-only flat list off `internal_agent_runs`; **trigger-type pill** (conversation/proactive/event/sub_agent) instead of invocation-source; shows duration + tool-call count + cost (no tokens); no detail/actions/log viewer. Keep read-only but restyle to match row language.

> **Consolidation:** unify run-row rendering + `runStatusIcons` + `formatDuration` (duplicated across `AgentDetail.tsx` and `AoaRunsPanel.tsx` with drift) into one shared `RunRow`/`runStatus` module.

### 6.4 Skills — grouped toggle rows
Replace the flat read-only-checkbox list with toggle rows, grouped **Attached / Available**.

- **Surface richer fields** from `CompanySkillListItem` that today are ignored: `trustLevel`, `sourceLabel`, `attachedAgentCount`, `compatibility`, `metadata` — at minimum show name, description, key (mono), and a trust/source badge.
- **Search box** + grouping (Attached vs Available). (None exist today.)
- **Commit:** immediate per-toggle (hybrid model, §7.1) — but **add a pending state on the toggle and error rollback + toast** (today a failed PATCH silently leaves the optimistic change; this is a real bug to fix in the rebuild).
- **States:** loading skeleton; empty ("No skills available. Create or import…" → `/skills`); **add a real error state**.
- **Consolidate** `AgentSkillsTab` (worker) and `AoaSkillsTab` (AoA) — currently byte-for-byte duplicates — into one shared component.

### 6.5 Config — section cards as an in-place form
This is the field-heavy tab. The section cards **are** the live form (edit-in-place, §7.2); every change raises the shared Save/Cancel bar. Full inventory below (from `ui/src/components/AgentConfigForm.tsx`), mapped to cards. **Identity + Context + timeout/grace are edit-only; create mode (NewAgentDialog) is a subset.**

**Card: Identity** (edit-only) — Name, Title, Role (`AGENT_ROLES`), Reports-to (`ReportsToSelect` → agent/user), Monthly budget ($→cents), Default Environment (`none` + env list), Capabilities (markdown), Prompt Template (markdown, local only).

**Card: Adapter & model** — Adapter type (`AdapterTypeDropdown`, switching is **destructive**: clears adapterConfig + blanks model/effort/mode keys), Test-environment button (pass/warn/fail), Working directory (+ Browse, local only), Model (`ModelDropdown`; required for `opencode_local`; grouped-by-provider there), Thinking effort (**overloaded** — key varies by adapter: `effort`/`modelReasoningEffort`/`variant`/`mode`; options differ; for Cursor it's actually "mode").

**Card: Permissions & Configuration** (local adapters only) — Command, Bootstrap prompt (first run), Claude advanced (`ClaudeLocalAdvancedFields`: Enable Chrome, Skip permissions, Max turns/run), Model API key (`SecretBindingPicker`, when adapter has a model-key env + company selected), Extra args (comma→array), Environment variables (`EnvVarEditor`: plain/secret_ref rows, "Seal" to create secret; AOA_* auto-injected), Timeout (sec), Interrupt grace (sec).

**Card: Run policy** — Heartbeat enabled + interval; (edit adds) Wake on demand, Cooldown, Max concurrent runs, Auto run summaries, AoA app previews.

**Card: Context** (edit-only) — Inject company context (default OFF), Context depth (`minimal`/`standard`/`full`, default `standard`).

**Per-adapter dynamic fields** — adapters without bespoke components (`acpx_local`, `cursor_cloud`, `openclaw_gateway`, unknown/external) render `SchemaConfigFields` fetched from `/api/adapters/:type/config-schema` (text/textarea/number/boolean/select/secret/json/env, with `visibleWhen` conditionals). `openclaw` has bespoke edit-only fields (API URL override, transport, session strategy/key, auth headers). `process`/`http`/`pi_local`/`grok_local` each have their own field sets. **The redesign must keep the adapter-driven `ConfigFields` slot** — see the adapter table in the inventory appendix.

**Below the cards (collapsible accordions):**
- **Permissions** — "Can create new agents" toggle (worker only; an agent *capability*, not user RBAC).
- **API keys** (`KeysTab`) — list active/revoked; create (name → token shown once, with show/hide + copy + dismiss banner); revoke; no per-key reveal.
- **Configuration revisions** — list (first 10): short id · date · source · changed keys; **Restore** (rollback) per revision; "No configuration revisions yet."

**Storage destinations** (keep the existing save wiring): top-level agent columns (name/title/role/parent*/budget/capabilities/defaultEnvironmentId) vs `adapterConfig.*` vs `runtimeConfig.heartbeat.*` vs runtimeConfig-level (`autoRunSummary`/`aoaAppPreviews`/`injectCompanyContext`/`contextMode`). Edit uses the overlay dirty-tracking system; adapter-switch sends a full `adapterConfig` replacement.

**AoA Config** differs: just the form (no Permissions/API-keys/Revisions accordions). Keep that.

### 6.6 Triggers (AoA only)
Restyle `AoaTriggersTab` to the card language. Current reality (keep, but flag gaps):
- Add-trigger inline form: **Kind** (`outbox`/`manual` only — `task` is reserved/unbuilt), **Enabled** checkbox, Add/Cancel. Immediate POST.
- List: kind pill, `key=value` config preview (read-only), enable/disable checkbox (immediate PATCH). Empty: "No triggers configured yet."
- **Gaps flagged (not v1 unless prioritized):** no edit, no delete, no config editing. The card layout should leave room for these.

---

## 7. Interaction model (cross-cutting)

### 7.1 Commit model — **hybrid** (decision)
> Multi-field edit *sessions* batch behind Save/Cancel; single discrete reversible *actions* commit immediately with feedback.

| Surface | Commit | Notes |
|---|---|---|
| Config tab | **Batched** (Save/Cancel bar) | overlay dirty tracking; Cancel reverts the batch |
| Instructions | **Batched** (Save/Cancel bar) | bundle + file saved together |
| Skills toggle | **Immediate** | + pending state + **error rollback/toast** (fix) |
| Icon picker | Immediate | already |
| Hero name/title (inline) | Immediate | on blur/enter |
| Pause / Resume / Invoke / Assign | Immediate | status-driven |
| Run Retry / Cancel / Resume | Immediate | |
| Triggers create / enable-disable | Immediate | |

### 7.2 Editing architecture — **in-place** (decision)
- Config tab = the live form. Hero identity = inline. **The only modal is the create dialog** (`NewAgentDialog`), retained because creation has no page to be in-place on yet.
- This matches the design-guide ("inline over modal") and the code that already exists.

### 7.3 Destructive actions → ConfirmDialog
Terminate agent; Reset Sessions; Run Cancel; Clear session (already confirmed); Delete instructions file (already confirmed); switch bundle mode (data-stashing — at least a clear affordance). Standardize on `ConfirmDialog`.

### 7.4 State matrix (the biggest current gap)
Every surface must define **loading / empty / error / saving**. Many exist; the holes to fill: Budget empty state, Skills error state + toggle rollback, and a consistent saving indicator tied to the Save bar. Reuse `PageSkeleton`, `Skeleton`, and the design-guide empty-state pattern.

### 7.5 Clickable summaries (decision: yes)
Hero KPIs and Overview cards deep-link: Cost→Budget, Last run→Runs (selected), Trust→Trust card, task row→task, "See All"→issues. Cheap, makes the dashboard navigable.

---

## 8. RBAC

**Reality today:** the worker page has **no UI role-gating at all**; the AoA page has a **single founder gate** on the Pause/Resume header button. All other writes (config, skills, triggers, instructions, revisions, API keys) rely solely on backend authz. `useTeamAccess` exposes `role` + permission flags (`canAssignTasks`, `canEditIdentityMemory`, …) that these pages don't consult.

**Proposal (independent, can ship separately):** gate consistently at two layers, degrading gracefully —
- **Editors** (founder; team_lead scoped) see live controls + Save bar.
- **Viewers** (team_member) see the **same Config/Skills/Triggers cards rendered read-only** (controls simply don't render). Tab visibility and destructive actions gated to founder.
- This makes the two Config mockups (editor vs viewer) two states of one design.

> Flag: this is a *new* behavior, not a restyle. Keep it as a clearly-scoped phase so the visual redesign isn't blocked on authz decisions.

---

## 9. AoA / Commander variant specifics
- Inherits hero + tabs via shared chrome; adds **Triggers** (6 tabs); UUID-only routes (`/team/aoa/<uuid>`), no slug.
- Header: founder-gated Pause/Resume + status badge only.
- Overview: 3 stats (Status/Role/Total runs) + latest run + **AoA config** (today a raw `JSON.stringify` of `runtimeConfig.aoa` — **redesign: render as a formatted summary**) + instructions excerpt.
- Config: form only (no Permissions/API-keys/Revisions).
- Runs: `AoaRunsPanel` (read-only, trigger-type model).

---

## 10. Consolidation opportunities (surfaced by investigation)
1. **Run rows** — unify `runStatusIcons` + source/trigger pills + `formatDuration` (duplicated, drifting) into one shared module.
2. **Skills tab** — `AgentSkillsTab` and `AoaSkillsTab` are duplicates → one shared component.
3. **Skills toggle bug** — failed PATCH has no rollback; fix during rebuild.
4. **Type drift** — front-end `Agent` lacks `kind`, `instructions`, `templateOrigin/Version`; AoA reads them via `as any`. Consider typing these (independent cleanup).

---

## 11. Mobile
- Save/Cancel → fixed bottom bar (existing).
- Runs & Instructions → list↔detail toggle (existing).
- Hero actions → icon-only; KPI strip wraps; segmented controls (Context depth) stay tappable.

---

## 12. Out of scope / forthcoming
- **Provider switching** (`feat/provider-switching-org`) will add provider/runtime-key selection to agents — a new field group that belongs in the Config "Adapter & model" card. Design the card to accommodate it without restructuring.
- Trigger `task` kind (reserved, unbuilt) — leave room.

---

## 13. Open questions
1. Trust score / cost / success — should the AoA hero ever show these, or stay 3-stat? (Currently AoA has no task/cost/trust data.)
2. Skills: how much of `CompanySkillListItem` to surface (trust level, source, attached-agent count) without clutter?
3. RBAC: ship the read-only degrade in this redesign, or as a separate authz phase? (Recommended: separate.)
4. Triggers: add edit/delete now or keep create+toggle only for v1?

---

## 14. Implementation outline (high level — detailed plan to follow)
1. **Hero card** in `AgentDetailCore` (both pages inherit) + inline name/title + KPI strip + deep-links.
2. **Shared primitives** — `RunRow`/`runStatus`, shared `SkillsTab`, card/section wrappers.
3. **Overview** restructure (3 blocks; remove duplicated stats + config summary).
4. **Config** section cards as in-place form (preserve all fields + accordions + save wiring).
5. **Skills** grouped toggle rows + search + error rollback.
6. **Runs / Instructions** reframe to card language (logic unchanged).
7. **Triggers** restyle (AoA).
8. **States** pass (fill loading/empty/error/saving holes).
9. *(Optional, separate)* RBAC read-only degrade; type-drift cleanup; Triggers edit/delete.

Each step is independently shippable and visually verifiable.

---

## Appendix A — Config field inventory (verbatim source references)
Full per-field detail (control type, defaults, validation, file:line, per-adapter visibility, create-vs-edit deltas, adapter `ConfigFields`/`buildAdapterConfig` table) was gathered from `ui/src/components/AgentConfigForm.tsx`, `agent-config-primitives.tsx`, `agent-config-defaults.ts`, the adapter registry (`ui/src/adapters/registry.ts`), and `server/src/adapters/builtin-adapter-types.ts`. See §6.5 for the card mapping; the rebuild must reconcile against these files field-by-field before deleting the old form.
