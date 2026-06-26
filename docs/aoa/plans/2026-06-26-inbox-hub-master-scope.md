# Inbox & Approvals Hub — Master Scope

**Status:** Reviewed — scope locked; per-workstream design begins with W1
**Date:** 2026-06-26
**Type:** Master scope / decomposition (not a per-workstream design)
**Interactive prototype:** `docs/aoa/inbox-hub-prototype.html`
**Related (landed):** `docs/aoa/plans/2026-06-25-toast-unification-design.md` (Toast unification = Layer 1, merged in PR #234)

> This document is the **map and the locked decisions** for the Inbox/Approvals
> hub initiative. It decomposes the work into workstreams and phases. Each
> workstream gets its **own** detailed design → plan → implementation after this
> scope is approved. It is deliberately not the deep design of any single piece.

---

## 1. Context & problem

Today "things that need the founder" are **fragmented and partly unreachable**:

- **Approvals is fully built but has no sidebar entry.** A real list page
  (`/approvals/pending|all`), a detail page with comments, and the full decision
  state machine (approve / reject / request-revision / resubmit, trust-score
  integration, 10 MCP tools) all exist — but there is **no nav entry**
  (`ui/src/components/Sidebar.tsx`). It's reachable only by typing the URL,
  clicking an Inbox row, or via the Commander cockpit. This is the user's
  "can't even go to Approvals through the UI."
- **The Inbox is an overwhelming flat aggregator.** Eight hand-assembled
  sections (`ui/src/pages/Inbox.tsx`) pulled from ~6 data sources, all at equal
  visual weight, and **not driven off the notifications table**.
- **The same item appears in three places** (Inbox section, the hidden Approvals
  page, the Commander cockpit), while other "needs-me" items live elsewhere
  again (suggestions on Home, agent `pending_approval` hires on Team, memory
  approvals in Memory).
- **No coherent mental model** for "what needs me," and nothing is
  registry-driven, so every new event type is bespoke plumbing.
- **Agent decisions are stranded in workspaces.** When org agents run (CLI
  runtimes, heartbeat-driven, often many in parallel), their mid-run permission
  prompts and questions surface *inside each agent's own workspace/terminal* —
  not in any shared place. There is no single queue where a founder answers what
  ten agents are blocked on. (See §10.)

The goal is a single, coherent **attention & decision hub** that scales for an
AI-first, multi-human workforce — including the agents' own mid-run decisions.

## 2. Goals / non-goals

**Goals**
- One merged hub that is the single front door for "what needs me," with clear
  UX/UI differentiation between deciding, awareness, and opportunities.
- Make Approvals reachable and first-class (it becomes the hub's decision lane +
  in-hub detail viewer; the standalone page stays as a deep-link target).
- A polymorphic, registry-driven item model so new types are one entry, not a
  rewrite.
- Lifecycle mechanics that make daily triage usable (read/unread, snooze,
  resolve/dismiss/archive, history, undo, bulk, SLA, search).
- Multi-human correctness (RBAC scoping, claiming, live concurrency).
- AI-first behaviors: grouping, an autonomy layer, real-time, explainability, a
  dedicated inbox crew agent, and **routing agents' mid-run decisions into the
  hub** (§10).

**Non-goals (this initiative)**
- **Mail/email integration** (connectors, triage, read/reply) — deferred to its
  own session. The IA **reserves a "Mail" rail lane** so it slots in later
  without re-cutting the layout.
- **Toast unification** — shipped as Layer 1 (PR #234); we only *consume* its API.
- **Cross-company global hub** (a Lobby-level "what needs me across all
  companies") — parked, not in scope.
- Agent-persona outbound email (agents emailing *as themselves*).
- The **Activity Log** stays a separate forensic surface — it is not merged in.
- **W5 per-adapter permission bridges** may land as a follow-up session (§10) —
  this initiative at minimum *reserves the item type* for it.

## 3. Mental model & lanes

**One merged hub, differentiated by lanes.** The differentiation is the rail's
lanes, not separate pages.

- **Home** — overview / "your day" (default landing is configurable).
- **Waiting on you** — decisions/gates: work is *blocked on you* (approvals,
  agent-needs-input, review requests, approve-to-send, **agent runtime
  decisions** §10). *(Name locked as "Waiting on you.")*
- **Notifications** — awareness: things that happened, relevant to you, no action
  required.
- **Suggestions** — opportunities: Commander/Triage "you could do X" (folds in
  the suggestions today orphaned on Home).
- **Mail** *(lane reserved, deferred)* — a channel, grouped separately in the
  rail; built in the Mail session.

**Explicitly out of the hub:** the **Activity Log** (forensic firehose, stays
separate) and **"My recent tasks"** (that's "my work" → Tasks page, removed from
the hub).

## 4. Information architecture & layout

Three-pane master-detail, consistent with the Agent page / Workspace family.
See the interactive prototype for the canonical behavior.

- **Pane 1 — Rail (nav only).** Home · Waiting on you · Notifications ·
  Suggestions · `[divider]` · Mail (reserved). The rail never holds the item
  list. Filters do **not** live here.
- **Pane 2 — Center.** Either the **list** for the selected lane, or the **Home
  overview** when Home is selected.
  - List header carries the **Mine / Team / All** scope filter (founder defaults
    to All / sees everything), **Sort**, and **Select** (bulk).
  - **Home** keeps the three-pane shell — the viewer stays mounted on the right.
    The autopilot control sits **top-right of the center panel** (Discussions
    pattern), above metric cards + pinned shortcuts + "Needs you most."
- **Pane 3 — Viewer (tabbed, collapsible).** Opening an item opens a **tab**;
  multiple items can be open at once; tabs are closeable; the panel is
  collapsible to give the list room. Has a default empty state.

**Header bell** = a lightweight peek available from any page; it reads from the
notifications system and deep-links into the hub. It is **not** a second store.

**Deep-linking & routing.** URLs per lane / item / filter
(`/inbox/waiting`, `/inbox/item/:id`, …); items are shareable links; back/forward
behaves sanely with tabs. Detailed in W1.

**Settings.** A hub settings surface for default landing lane, lane visibility,
the Autopilot level, and the entry point to notification preferences (the latter
coordinating with the notifications session).

**Performance.** The feed paginates / virtualizes; counts and badges use cheap
queries. Required at agent-volume.

**Mobile / a11y / keyboard.** Panes collapse (rail → drawer, list ↔ viewer
stacked); keyboard triage (j/k, act keys); screen-reader/focus handling for the
three panes. Detailed in W1.

## 5. Item model & registry

Every hub item shares one **envelope** and differs only in body + actions:

```
envelope:  icon · title · status · who · when
body:      type-specific VIEWER (composed from existing viewers)
actions:   type-specific primary/secondary + Snooze/Dismiss + "Open full →"
```

- The **viewer composes existing viewers** rather than rebuilding them: review
  request → artifact viewer; approval → ApprovalDetail body; agent-needs-input →
  thread/conversation viewer + reply; task notification → TaskSlideOver summary.
  Each offers an **"Open full →"** escape to the canonical page.
- Items work at **three depths**: glance (row) → viewer (detail) → act (inline
  quick-actions + in-viewer).
- A **type registry** maps `type → { icon, title, render/viewer, lane, link
  resolver, default surface, actions }`. Adding a type = one registry entry. This
  is the UI face of the notifications Layer-2 registry (§11) — the two share the
  type definitions.

**Unified item model (key architecture decision, design in W1).** Items live in
6+ tables today (approvals, notifications, discussions, heartbeat_runs,
join_requests, issues, suggestions) — plus runtime decisions (§10). The hub
must present them as one feed. Decision to make: **query-and-merge at read time**
vs. a **unified hub-item index** every source writes into. Sorting, paging,
counts, claiming, and realtime all depend on this choice.

**Action layer.** Each item type's actions execute against the *source's*
existing API (Approve → approvals API, Retry → heartbeats, Reply → thread/run,
etc.). The registry needs an **action layer**, not just a render layer.

**Existing 8 sections remap into the lanes (nothing lost):**

| Today | New lane |
|------|----------|
| Discussions pending, approvals, join requests, scope-proposals, human-input | Waiting on you |
| Failed runs, alerts (agent errors, budget), crew-failed, mentions, run-complete | Notifications |
| Stale work, spinoff-suggested | Suggestions |
| My recent tasks | *removed (→ Tasks page)* |

New sources to fold in: **routine** outcomes, **PR/CI** events, **goal
went-at-risk**, and **agent runtime decisions** (§10).

## 6. Lifecycle & mechanics

- **Read / unread** — first-class state (not just dismiss).
- **Snooze + return** — item leaves and comes back at the chosen time. *(Return
  mechanics/UI: design in W1.)*
- **Resolve ≠ dismiss ≠ archive** — three distinct terminal states with distinct
  "after" behaviors (decided / read / filed).
- **History** — resolved items go to a History view ("what did I approve last
  week").
- **Undo** — short window after an action, surfaced as a button timer/animation.
- **Bulk actions** — multi-select + act together.
- **SLA / escalation** — an item ignored too long re-notifies or escalates.
- **Search** — across the hub and history.

## 7. Multi-human, RBAC & claiming

- **RBAC scoping** — every lane/item is permission-filtered (a hire approval is
  founder/board; a team_lead sees their department's items). **Founder sees
  everything** (with filters to narrow).
- **Claiming** (design in W1; resolves the "no creator user-id" problem):
  - Items default to **unassigned**; any RBAC-eligible member can **claim** one →
    it shows "Sam is handling this"; founder can reassign; **auto-unclaim** if it
    goes stale.
  - Items with a **natural owner** (a mention of you, your own run) auto-route to
    you.
  - **Approvals** are a shared board pool any eligible member can claim + decide.
- **Concurrency / auto-resolve** — when an item is handled (by another member, or
  the agent resolves its own question), it **self-clears live** in everyone's
  view; no stale action buttons. (Depends on real-time, §11 Layer 3.)

## 8. AI-first behaviors

- **Grouping + categorization** — high agent volume collapses into grouped rows
  ("Atlas · 5 runs completed", "9 routines succeeded") and categories, so the
  hub never floods. Taxonomy: design in W1/W4.
- **Autonomy layer** — a trust-gated dial (modeled on the **discussions
  autonomy** pattern) deciding **auto-handle vs. escalate** per category. The
  guiding principle: *the hub shrinks as the workforce earns autonomy.* Surfaced
  as the "Autopilot" control in Home. Governs both hub-item escalation **and**
  the runtime-decision routing in §10.
- **Real-time + auto-resolve** — the hub rides the live-event pipe instead of
  polling; items appear and self-clear instantly. This **is** Notifications
  Layer 3 (§11).
- **Explainability** — every escalation/suggestion shows "Why you're seeing
  this" (reasoning + evidence) so decisions take seconds.
- **Auto-action audit + undo (trust)** — whenever Autopilot handles something on
  your behalf, it must be **reviewable and reversible** ("Handled for you today:
  12" → see exactly what the Steward auto-approved → undo). Without this, no one
  raises the dial.
- **Gradual autonomy onboarding** — start low, earn up via the trust score; the
  "allow always" choices compound into per-agent allowlists.

## 9. Crew agents (who runs the hub)

**The hub gets its own dedicated operating agent. Existing crew are only event
*sources*, not the hub's operator.**

- **Existing crew = event sources (unchanged).** Commander (proactive scans →
  Suggestions/Notifications), Navigator (inbound routing → spinoff/human-input),
  Adjutant/Planner/Scout/Engineer (thread + task work → review/artifact/crew
  items), Memory Keeper (memory approvals), Chronicler (summaries that power
  grouping). Their normal work *emits* items the hub surfaces; none of them runs
  the hub.
- **W4 — one new dedicated crew agent ("Steward", working name; alts: Dispatcher
  / Aide / Concierge).** Owns the hub's **judgment** curation: Autopilot
  escalate-vs-handle decisions on ambiguous items, human-readable group
  summaries, explainability prose, and (with Mail) draft replies. Modeled on
  **Chronicler** — lightweight, event-driven + `sweep`, minimal tool footprint,
  mostly silent. **Autonomy-gated by the Autopilot dial** (§8).
- **Background worker (not an agent).** Deterministic curation — grouping, dedup,
  priority scoring, SLA timers, claiming/auto-unclaim. Plumbing in W1/W2; no LLM.
- **Commander extended (not new).** The conversational "operate my queue" moves
  — *"summarize what needs me," "approve the low-risk ones," "draft these three"*
  — are Commander's job from its page, by calling **hub tools** we add to its
  allowlist.
- **Mail agent** — a dedicated agent, **deferred** with the Mail session.

**Naming caution:** Navigator's "inbox" (inbound-content routing,
`thread_inbox_items`) is a *different* surface from this attention hub. The new
agent must **not** be named "Inbox-anything."

## 10. Runtime decision routing (W5 — agent permission/question bridge)

**The "one control room for N agents" capability.** When org agents run (CLI
runtimes), they hit permission prompts and ask questions mid-run, today stranded
in each agent's own workspace. W5 routes those into the hub's **Waiting on you**
lane and relays the answer back to unblock the run.

- **Build on the existing seed.** AoA already gates Commander's tool calls via
  **`internal_agent_runtime_approvals`** (`decision: allow_once|allow_always|
  deny`), surfaced as the cockpit's **`runtime_tool_trust`** approval. W5
  **generalizes this pattern from Commander to every org-agent adapter.**
- **Two flavors:**
  1. **Permission / allow-deny** ("run this command", "use this skill"). Largely
     **silenced by config / "always allow"** (which most users pick or
     pre-configure) plus the autonomy dial — so this is *not* the hub's main
     traffic. Design principle: **make this noise easy to quiet.**
  2. **Substantive work questions** (context + options — "annual or monthly
     default?"). **This is the high-value routing** — the agent genuinely needs a
     human call. Lands as the "agent needs input" item with options relayed back.
- **Mechanism (per-adapter "permission bridge").** Wire each runtime's
  permission/question callback (Claude Code `--permission-prompt-tool` / hooks;
  Codex approval hooks; etc.) → create a hub item → **block the run** → founder
  answers (allow once / allow always / deny, or picks an option) → **relay back**
  → run continues. **Poll-first** (robust everywhere), **push** (event bus) as
  the upgrade. **Watchdog** (`heartbeat_run_watchdog_decisions`) expires/auto-
  denies stale prompts; concurrency clamp bounds how many runs block at once.
- **Autonomy-gated.** The Autopilot dial decides which prompts auto-approve vs.
  escalate; "allow always" grows a **per-agent allowlist** → fewer prompts → the
  hub shrinks as trust grows. Runtime prompts are the rawest "agent waiting on
  you."
- **Per-adapter reality = the main challenge.** Support varies; runtimes that
  can't expose an interception hook run under a fixed policy (sandbox /
  pre-declared allowlist) and we **document the limitation**. Each adapter bridge
  is its own verification effort.
- **Sensitive-data handling (high test priority).** Runtime prompts can contain
  commands, file paths, or secrets → **redact/guard** before surfacing in a hub
  item, never leak secrets, and enforce **RBAC on who can decide** a runtime
  prompt. See §17.
- **Scope split.** This initiative **reserves the runtime-decision item type in
  W1** (so the hub can host it). The **per-adapter bridges (W5)** are deep
  adapter-layer work and may land as a **follow-up session** (decision pending,
  §15).

## 11. Notifications system (Layers 2 + 3)

This workstream **continues the toast/notifications review** whose Layer 1
(toast unification) merged in PR #234. It does **not** invent a parallel system.

- **Layer 2 — registry-driven persistent notifications.** A type registry
  (`type → icon/title/render/surface/link`), a **single emit path**, and removal
  of the **dead types** (e.g. `discussion.extraction_complete/failed`, which are
  declared but never created). The hub's item registry (§5) shares these type
  definitions.
- **Layer 3 — realtime + bridge + preferences.** Replace polling with realtime
  delivery (the `LiveEvents` bus); an optional **rule bridging** selected
  notifications to **toasts** via the landed L1 API (`pushToast` /
  `updateToast(id, patch)` / sticky `loading` tone / `meta.ref`); and **per-user
  preferences** (per-category interrupt / digest / silent) for anti-spam, plus
  digests.

**Seam to L1 (already shipped):** the bridge calls the unified `pushToast` /
`updateToast`; one renderer at app root; `--toast-*` tokens. No new toast system.

**Coupling to the hub:** the **Notifications lane** consumes the L2 registry; the
hub's **real-time + auto-resolve** (§7, §8) *are* L3. Sequence L2 early.

## 12. Cross-surface consistency & migration

- **Single source of truth.** The hub is the **canonical store**; the **bell**,
  the **sidebar badge**, and the **Commander cockpit** all read from it and
  deep-link into it — they are *peeks*, not separate stores. **Decision: the
  Commander cockpit stays** (it's the founder's command surface) and its
  approvals/attention cards are **wired to the hub** — same data, with actions
  routing through the hub's action layer. One source, several windows: this ends
  the "approval in 3 places" divergence instead of adding a 4th.
- **Migration / no-regression.** This *replaces* today's `Inbox.tsx` (8 sections)
  and turns `/approvals` into a deep-link target; we must preserve
  `inbox_dismissals` and the existing sidebar-badge behavior.

## 13. Dependencies & out-of-scope

- **Depends on:** Toast L1 (merged, #234) for the toast bridge primitives;
  existing viewers (artifact, TaskSlideOver, ApprovalDetail, thread) for
  composition; `LiveEvents` bus for realtime; trust-score + discussions-autonomy
  patterns for the autonomy layer; `internal_agent_runtime_approvals` +
  `runtime_tool_trust` for the W5 seed; the adapter layer (`server/src/adapters/`)
  for W5 bridges.
- **Out of scope / deferred:** Mail/email integration (own session; IA reserves
  the lane), cross-company global hub (parked), agent-persona outbound email,
  Activity Log changes, **W5 per-adapter bridges** (likely a follow-up session;
  item type reserved here).

## 14. Workstreams & phasing

**Workstreams**
- **W1 — Hub experience** (core): rail/center/viewer shell, Home overview, the
  lanes, the polymorphic registry-backed viewer (tabbed/collapsible), unified
  item model + action layer, section remap, lifecycle mechanics, RBAC + claiming,
  grouping/categorization, history, search, deep-linking, settings, performance,
  empty/onboarding, mobile, **reserving the runtime-decision item type**.
- **W2 — Notifications system**: toast-review **Layer 2** (registry + single emit
  + dead-type cleanup) and **Layer 3** (realtime + toast bridge + preferences/
  anti-spam/digests).
- **W3 — Autonomy layer**: trust-gated auto-handle vs. escalate, per category,
  Autopilot control, auto-action audit + undo.
- **W4 — Inbox "Steward" crew agent**: the dedicated `kind=aoa` member + the
  background curation worker (triage, grouping intelligence, explainability,
  drafting).
- **W5 — Runtime decision routing**: generalize `internal_agent_runtime_approvals`
  to all org-agent adapters; per-adapter permission/question bridges;
  autonomy-gated; poll-then-push relay; watchdog timeouts. *(Per-adapter bridges
  possibly a follow-up session; W1 reserves the item type.)*

**Rough phasing (parallel where noted)**
- **Phase 1 — Hub shell + registry foundation.** W1 three-pane + lanes + section
  remap + unified item model + tabbed/collapsible viewer + Home overview +
  lifecycle basics on **today's polling**; Approvals reachable in-hub (fixes the
  unreachable-page problem); item type reserved for W5. In parallel: **W2 Layer
  2** registry so the lanes are registry-driven and dead types are removed.
- **Phase 2 — Realtime + multi-human.** W2 **Layer 3** (realtime, auto-resolve,
  toast bridge, preferences/anti-spam/digests) + W1 RBAC scoping & claiming &
  live concurrency + cross-surface reconciliation (§12).
- **Phase 3 — Intelligence.** W3 autonomy layer (+ audit/undo) + W4 Steward agent
  + advanced grouping/categorization + SLA/escalation + search.
- **Phase 4 / follow-up sessions.** W5 per-adapter bridges; Mail/email
  integration; full mail client.

**Sequencing note:** W1 is the spine; W2-L2 runs alongside Phase 1 (coupled via
the shared registry); W3/W4 build on the W1 + W2 foundations; W5 builds on the
reserved item type + the autonomy layer.

## 15. Open questions / to-be-designed

- **Unified item model** — query-and-merge vs. a unified hub-item index (W1).
- Snooze mechanics & return-timing UI (W1).
- Claiming / reassign / auto-unclaim rules; natural-owner routing (W1).
- Viewer default/empty state on Home and with no item open; tab limits &
  cross-lane persistence rules (W1).
- Grouping/categorization taxonomy (W1/W4).
- **Steward crew agent name** (Steward / Dispatcher / Aide / Concierge / other).
- Steward behaviors per autopilot level — what it auto-handles vs. escalates
  (W3/W4).
- Notification preferences model (per-category interrupt/digest/silent) —
  coordinate with the toast review (W2).
- **Realtime transport** — SSE (reuse Commander's) vs. websocket (W2 L3).
- **W5 per-adapter feasibility** — which adapters expose an interception hook;
  which fall back to fixed policy; whether the bridges build in this initiative
  or a follow-up session.
- Mobile layout specifics (W1).
- Cross-company global hub — parked; revisit only if multi-company becomes a
  priority.

## 16. Success signals (by scenario)

How we know the hub works — and crucially, signals that change with the
**autonomy level**, since "good" looks different at Off vs. High.

- **Reachability** — Approvals (and every "needs-me" type) reachable in ≤1 click;
  zero "I didn't know that needed me" misses. The hub becomes the *one place*
  people check.
- **Off / Low autopilot** — every decision/question surfaces in the hub; nothing
  auto-handled; **no stranded agent prompts** (W5 routes them all); the founder
  is a clean gate.
- **Medium autopilot** — low-risk items auto-handled, high-value escalated;
  "Handled for you today" rises with **correct** auto-actions; **low undo rate**
  on auto-actions.
- **High autopilot** — "Waiting on you" stays near-empty for routine work; only
  genuinely novel/risky decisions reach you; trust score climbs.
- **Trust ramp (the thesis)** — escalations measurably **shrink over time** as
  per-agent allowlists grow — "the hub shrinks as trust grows" is observable.
- **Volume** — with N agents running, grouping/dedup keep the hub from flooding;
  time-to-clear-queue stays roughly flat as agent count grows.
- **Multi-human** — no double-work (claiming) and no stale action buttons
  (auto-resolve).
- **Decision speed** — time-to-decision drops; explainability lets most calls be
  made in seconds.
- **W5** — agents unblocked quickly (low wait on routed prompts); permission
  noise stays low (mostly pre-allowed); substantive questions answered centrally.

## 17. Security & verification

High test-priority, exercised **across autonomy levels and scenarios**:

- **RBAC everywhere** — every lane/item/action permission-filtered; no leakage
  across departments/roles; founder-sees-all is the only broad scope.
- **W5 redaction** — runtime prompts redacted/guarded; no secrets in hub items;
  only eligible principals can decide a runtime prompt (§10).
- **Auto-action audit** — every Autopilot action recorded (what / when / which
  agent / which autonomy level) and reversible (§8).
- **Concurrency safety** — claiming and auto-resolve must be race-safe (atomic),
  so two humans never double-act and no stale buttons remain.
- **W5 relay correctness** — block/answer/relay and watchdog timeouts verified
  per adapter; no run hangs forever, no decision lost.
