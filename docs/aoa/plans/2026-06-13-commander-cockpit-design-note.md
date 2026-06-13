# Commander Cockpit — Design Note (exploratory, P2)

**Date:** 2026-06-13
**Branch:** `feat/v1-commander-chat` (same line as the shipped viewer P1)
**Status:** **Exploratory design note — not yet planned or scheduled.** Captures a brainstorming discussion so it isn't lost. Open decisions are listed in §11; resolve those before this becomes a spec → plan.
**Relationship to shipped work:** This builds *on top of* the Commander Content Viewer P1 (`2026-06-11-commander-viewer-design.md`, shipped on this branch). It is a separate, larger feature.

---

## 1. What the cockpit is

A **personal mission-control panel** on the Commander page: a collapsible right-edge surface showing, at a glance, **what needs the user** and **what's moving** — and letting them act on each item without leaving the conversation.

**The defining split (the rule everything hangs on):**

- **Cockpit = STATE.** Things that need you or are in motion: have a status, wait on someone, and *clear* when handled (approvals, reviews, running agents, blocked tasks, goals at risk).
- **Detail panel (the viewer, R1) = CONTENT/DETAIL.** The thing itself: artifacts, task detail, goals, browser tabs.

The test for any cockpit card: **does this item have a to-do attached to *me*?** Yes → cockpit (disappears once handled). No, it's just there to read/browse → detail panel home tab. This is why "recent artifacts" lives in the viewer home, **never** the cockpit (decided with the user).

## 2. Why it's distinct from Home / Inbox (not a third duplicate)

- **Personal**, not company-wide: my approvals, my reviews, my agents — per-user scoped (multi-human: each person sees their own).
- **Glanceable while chatting**: its reason to live on `/commander` specifically is you don't want to leave the conversation to check.
- **Items act *into* the chat**: every row has an **Ask ↩** that delegates the item to Commander. The cockpit feeds the conversation; the conversation clears the cockpit.

## 3. Layout — two zones, both collapsible (HYBRID, decided)

The cockpit is **global** (mission control is about *you*, identical across every chat — your approvals don't change because you switched conversations), **plus** a per-session zone on top:

- **"In this conversation" zone (session-scoped):** the tasks/artifacts/goals *this chat* has touched, with live status. Fed by the same data as the viewer's "Recent from this conversation" (the conversation's outputRefs + entities Commander's tools acted on). New chat → empty; fills as you talk. Persists per conversation.
- **Mission-control zone (global):** the cards in §5. Same in every session.

**Collapse states** (mirrors the viewer rail pattern):
- **Full** — reviewing.
- **Semi (badge rail)** — thin rail showing one number, `⚡N need you` (sum of the action-queue cards), + per-card mini-badges. **Default while chatting.** New item lands while collapsed → the rail pulses (reuse the mobile-pill badge mechanism shipped in P1).
- **Hidden** — full focus mode.

Realistic default: cockpit semi-collapsed + viewer rail collapsed; both fully open only on wide screens.

## 4. Interaction model — handle it WITHOUT leaving Commander (decided: R1)

**R1 — the viewer becomes the unified detail panel.** Clicking any cockpit item opens it as a **tab in the viewer**, next to artifact tabs. Cockpit stays visible and *drives* the viewer.

| Cockpit row | Primary click → | Secondary |
|---|---|---|
| ✅ Review / artifact | opens in the **viewer** (content render) + Approve / Request-changes | **Ask ↩** "summarize changes" |
| 📋 Task (blocked / mine) | opens **task detail as a viewer tab** (TaskSlideOver's behavior, rebuilt as a tab body — interactive: status, comments, deps) | **Ask ↩** · drag status |
| ⚑ Approval | **inline-compact** in the card (one line + Approve/Deny + **details ↗** → viewer) | **Ask ↩** "what is this?" |
| ▶ Running | **inline** live detail (tools, elapsed) · Stop if authorized | **Ask ↩** "what's it doing?" |
| 🎯 Goal | opens as a **viewer tab** | **Ask ↩** "recovery plan?" |
| 💡 Suggestion | **Accept** runs its actionPayload (see §8 — gated on that feature) | Dismiss · **Ask ↩** |

**Two universal affordances on every row:** the direct action (open/approve) **and Ask ↩** (seeds the composer with a question scoped to that item and sends it). So you can *handle* it or *discuss* it, one click each. (User confirmed: yes, clicking any item lets you chat about it with Commander.)

**Inline approvals are space-constrained** (cockpit ~280px): inline shows compact summary + Approve/Deny + Ask ↩ + **details ↗**. Simple ones (hire yes/no) resolve inline; richer ones (memory item text, extracted-items batch) open in the viewer or get talked through via Ask ↩. The narrow card stays a *trigger*, never a cramped form.

**"🤖 Brief me"** (cockpit header) — asks Commander to triage the *whole* cockpit in chat: *"2 reviews, 3 approvals, 1 blocked — I'd hit the hire first because…; want me to draft the approvals?"* Turns the cockpit into one conversational triage. (New idea, well-received.)

**Principle:** never navigate off `/commander` for a cockpit action. Full-page navigation is only a rare "dig deeper" (`↗`) fallback.

## 5. The card menu

Each card: **shows / source / live**. Cards **auto-hide when empty** (show only active) — except cards the user pins to always-show.

### A · Action queue (needs your decision)
- **✅ Ready for my review** *(v1 default)* — finished agent deliverables awaiting your verdict (`VIE-9 · Dev-Agent · 📄 auth-spec.md`). Source: `issues` at review hand-back + `artifactId`/`task_outputs` + `issue_approvals`. **Live** (heartbeat completion). *The core human job in AoA.*
- **⚑ Approvals waiting on me** *(v1 default)* — unified queue across 4–6 sources (see §7). **Live.**
- **⛔ My blocked tasks** — `issues` status=blocked, `assigneeUserId`=me + `task_dependencies`.
- **🔔 Unread** *(optional)* — count from `notifications` (userId=me, unread). Likely redundant with sidebar Inbox dot.

### B · Work in motion
- **▶ Running now** *(v1 default)* — agents executing now (`🤖 Dev-Agent → VIE-9 · 4m`). Source: `heartbeat_runs` running + `internal_agent_runs` + `agent_runtime_state`. **Live.** *Trust-builder for multi-human.*
- **🎯 Goals at risk** *(v1 default)* — `goals` status=at_risk. Hidden when none → its appearance *is* the alarm.
- **💰 Budget pulse** *(optional — de-prioritized per user)* — spent/budget bar + incidents. Founder-pinnable.

### C · What's next
- **📅 Today** *(v1 default)* — Commander reminders firing today (`internal_agent_reminders`, triggerAt) + tasks due today. All native.
- **🗓 Google Calendar** *(v2 — part of the Google epic, §9)* — meetings inside the Today card.

### D · Personal worklist
- **🗂 My tasks** *(v1 default)* — tasks assigned to *me* (human, not agent), by status. **(Correction: valuable for solo founders too — they have personal tasks; not a multi-human-only card.)**
- **📌 Pinned / Watching** *(optional)* — pin any task/artifact/goal; live status. Needs a small **per-user pin store** (new).

### E · Commander's brain
- **🔍 Proactive findings** *(optional)* — latest 4-hourly scan (stale work, imbalance, dependency gaps). Source: proactive `internal_agent_runs` / `notifications` type=internal_agent.proactive. Gives the scan a home instead of rotting in Inbox.
- **💡 Suggestions** *(optional; gated — see §8)* — suggestion-engine output.

### F · Digest, capture & team
- **🎉 Done today** *(optional)* — `4 tasks · 2 artifacts shipped`. Not actionable — the reward glance; passive "what happened while I was away."
- **✏️ Quick capture** *(optional)* — one-line jot → task or Discussion note, no AI round-trip. (The composer already does this via Commander.)
- **👥 Teammates' activity** *(optional, multi-human)* — others' approvals/agent output from `activity_log`. Needs a privacy decision.

**Proposed v1 default-on set:** ✅ Review · ⚑ Approvals · ▶ Running · 📅 Today · 🗂 My tasks · 🎯 Goals. Everything else optional/pin. *(Confirm — §11.)*

## 6. Configuration (decided in principle)

- Default behavior: **show only active cards** (empty ones hide).
- Per-user override via a **⚙ settings** entry at the top of the cockpit: **show/hide** cards, **reorder** (drag), **pin-to-always-show**.
- Ships with a sensible default order; possibly role-leaning (founder→Goals/Budget, member→My-tasks/Review) but user-overridable. *(Role-based-or-not is open — §11.)*
- Reuses AoA's existing personalization plumbing (sidebar collapse prefs, Commander session drag-order). A small new per-user store.

## 7. Approvals — the two kinds (clarified with user)

1. **Chat-inline confirmations (already exist):** Commander about to do something mid-turn → "Allow once / Always / Deny" card *in the chat*. Transactional, tied to that turn.
2. **Cockpit standing approvals (new card):** the persistent queue regardless of any chat. Unifies:

| Approval | Source |
|---|---|
| Agent hire | agent `pending_approval` (board-approval mode) |
| Memory suggestions | `memory_items` status=pending |
| Discussion extracted items | `discussion_extracted_items` pending |
| Tool-trust / runtime | `internal_agent_runtime_approvals` / `internal_agent_tool_trust_rules` |
| Task/artifact approvals | `approvals` / `issue_approvals` |
| (maybe) Join requests / invites | `join_requests`, `invites` |

The value is consolidating queues that are today scattered across Inbox + pages.

## 8. Suggestions — a separate feature to harden first (per user)

The engine exists in schema (`suggestions`: 8 categories — goal_gap, pipeline_bottleneck, memory_gap, pattern_detected, budget_optimization, recurring_work, risk_flag, workload_balance + agent proposals; runs on Home-load + every 4h; deduped by `patternId`; each carries `actionPayload` = what Accept executes, and `evidence` = why). **What's not solid: generation quality + the Accept→execute flow.** Until that's trustworthy, "Accept inline" is premature. So: Suggestions is an **optional pin-if-you-want card**, and the **suggestion engine is its own sibling feature to fix properly** — not part of cockpit v1.

## 9. Google integration — its own epic (after cockpit)

Bundle **Calendar + Drive + Gmail** as one epic. The **do-once foundation** (per-user OAuth, token storage, multi-human privacy, sync) is the real work; each service is cheap on top, and they land on **different surfaces**:
- **Calendar** → the Today card (cockpit)
- **Drive** → the **detail panel/viewer** (open Drive docs as tabs; Drive as an artifact source — enriches the shipped viewer)
- **Gmail** → Discussion input (emails → discussion entries → extracted items) and/or a cockpit "needs reply" card

Cross-cutting (cockpit + viewer + discussions) — which is exactly why the auth layer is built once, then three surfaces wired.

## 10. Build-cost map

| Cheap (native data) | New build required |
|---|---|
| Review, Blocked, Unread, Running, Goals, Today, My tasks, Proactive, Done today | **Task/goal as interactive viewer tab** (R1) · **Approvals unification** (4–6 queues) · **Pin store** (Pinned card) · **Per-user cockpit config** store · **Suggestion engine** harden (§8) · **Google epic** (§9) · **Teammates privacy** rule |

## 11. Open decisions (resolve before spec → plan)

1. **v1 default card set** — confirm: ✅ Review · ⚑ Approvals · ▶ Running · 📅 Today · 🗂 My tasks · 🎯 Goals?
2. **Role-based defaults** — different default cards per role (founder vs team_member), or same-for-all + each configures?
3. **RBAC per card** — explicit rule: a card/row only renders if the viewer's role permits the underlying data (budget, certain approvals founder/lead-only).
4. **"In this conversation" zone** — confirm population source (this session's outputRefs + Commander-touched entities) + per-conversation persistence.
5. **Mobile** — cockpit as a second floating pill/sheet alongside the viewer pill, or a tab within it?
6. **Page scope** — cockpit lives only on `/commander` (like the viewer), correct?

## 12. Decided (locked in this discussion)

- Cockpit = state; detail panel (viewer) = content/detail. (§1)
- **R1**: viewer becomes the unified detail panel; cockpit drives it; task/goal/approval-detail open as viewer tabs. (§4)
- Hybrid layout: global mission-control + per-session "In this conversation" zone. (§3)
- Every row: direct action + **Ask ↩** (discuss with Commander). (§4)
- Inline approvals are compact (summary + approve/deny + details↗); not cramped forms. (§4)
- **Brief me** triage button. (§4)
- Show-only-active + ⚙ config (show/hide/reorder/pin). (§6)
- Budget de-prioritized (optional/pin); Goals kept default. (§5)
- Suggestions optional + engine is a separate feature. (§8)
- Google = separate epic, after cockpit, cross-cutting. (§9)
- No "recent/browse" lists in the cockpit — those stay in the viewer home. (§1)
