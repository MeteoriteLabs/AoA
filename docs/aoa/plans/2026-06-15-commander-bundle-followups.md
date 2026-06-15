# Commander Page Bundle — Follow-ups Backlog

**Status:** Backlog. Everything deferred during the Commander page bundle (Phases 0 → 3c), captured per the founder's instruction ("everything else we're leaving, put as follow-ups after everything"). Tackle after the current bundle; each is independently planable via the same loop (writing-plans → Codex → subagent build → verify).

**Shipped + verified in the bundle (for context):** Phase 0 chrome · Phase 1 resizable composition + persisted geometry · Phase 2 TaskDetail / task viewer-tab · Phase 3a cockpit shell · Phase 3b cockpit data engine (`/cockpit` + `cockpitScope` + Running/Review/MyTasks/Today/Discussions + interactions) · Phase 3c Approvals card (Core-3: approvals-table + memory + discussion-items, founder-scoped, inline approve/deny).

---

## A. Cockpit — remaining approval families (extend the 3c Approvals card)

The 3c card unifies 3 founder-scoped sources via `cockpitApprovals()` in `server/src/services/cockpit.ts` + the `useCockpitApprovalAction` source-dispatcher. These extend that same shape:

1. **Join-requests family** — `join_requests` status `pending_approval`; actions `accessApi.approveJoinRequest/rejectJoinRequest` (`ui/src/api/access.ts:102`); scope = `joins:approve` perm (founder/admin). Add a `source:"join_request"` to the aggregation + dispatcher.
2. **Tool-trust / runtime family** — `internal_agent_runtime_approvals` status `pending` (+ `expires_at > now`); action = `POST /internal-agent/confirm` with `decision: allow_once|allow_always|deny` (note: a 3-way decision, not approve/reject — the dispatcher needs a variant). Scope = founder/team_lead (`getEffectiveRole`).
3. **Memory version/archive queues** — `memoryService.listPending` also returns `versions` (pending edits on approved items → `memoryApi.approveVersion/rejectVersion`) and `archives` (`{item, suggestion}` → restore). 3c used only `.items`; add these two queues.
4. **Lead/member approvals scoping** — the Approvals card is **founder-only** today. Extend per design §6: team_lead sees their departments' actionable items (esp. memory `active_context` in their depts — `assertMemoryApproval` already permits this server-side); member sees routed-to-them. Needs per-source scoping in `cockpitApprovals` (drop the `!scope.isFounder → []` short-circuit and scope each source).

## B. Cockpit — remaining cards (extend `/cockpit` + `COCKPIT_REGISTRY`)

5. ~~**Pinned card** — NEW table `user_entity_pins` + pin/unpin + the card.~~ **✅ DONE (2026-06-15)** — `user_entity_pins` table + migration (`IF NOT EXISTS`), board-only per-user pins CRUD (write-time uuid+ownership 404), `/cockpit.pinned` polymorphic company-scoped resolution, the 📌 Pinned card (open/unpin, show-only-active), and a one-way Pin button on Review/MyTasks/Today task rows. Plan: `2026-06-15-commander-pinned-card-plan.md`. **Deferred to their own follow-ups:** pin affordances for **artifacts** (from the viewer tab) and **goals** (from goal pages/cards) — schema+resolver+card already support all 3 types, only the pin-*from* control for artifact/goal is pending; and finer per-department RBAC on resolved pins (v1 is company-scoped, "pinned overrides hidden").
6. **Opt-in cards** (off by default; query existing data via `/cockpit`, gated by `useCommanderCockpitPrefs`). **✅ MECHANISM + first 3 DONE (2026-06-15)** — `prefs.enabled` (backward-compatible) + `mountableCards` optional `enabled` + the config popover's "Optional" section; **Goals at risk** (`goals.status='at_risk'`, company-scoped), **Budget pulse** (founder-only v1; limit=`company.budgetMonthlyCents`, spend=`cost_events` UTC-month sum, open incidents), **Done today** (`issues.completedAt` today; founder→company / else→own). Plan: `2026-06-15-commander-opt-in-cards-plan.md`. **✅ +2 more DONE (2026-06-15):** **Proactive findings** (per-user unread `notifications` of `internal_agent_proactive` — type queried as BOTH dot+underscore for the writer/constant mismatch) + **Teammates' activity** (option 2: founder→company / team_lead→their depts via actor `user_roles` / member→none; human actors only — `agent`/`system`/`commander` excluded; self excluded). Plan: `2026-06-15-commander-proactive-teammates-plan.md`. **Still TODO:** **Quick capture** (one-line jot → task/discussion — DEFERRED, founder unsure it's wanted); a "full transparency" toggle for teammates (members see it); done-today **artifacts** + per-dept **lead budget**; and a **pre-existing bug** to reconcile the proactive notification type (writer underscore vs constant dot — flagged as a background task).
7. ~~**"In this conversation" zone**~~ **✅ DONE (2026-06-15)** — a fixed conversation-scoped zone at the TOP of the cockpit (above the company cards), fed by the existing `conversationRefs` (the same deduped list the viewer's "Recent from this conversation" uses); rows open the artifact via the FULL ref (preserves `versionId`); null when empty; the All-clear empty-state accounts for it. Frontend-only (no `/cockpit`/schema change). Plan: `2026-06-15-commander-conversation-zone-plan.md`. **Follow-up:** non-artifact "touched entities" (tasks/goals) once `COMMANDER_OUTPUT_REF_KINDS` widens beyond `["artifact"]`.

## C. Cockpit — UX / platform

8. **Mobile tab-bar** — retrofit the Workspace-style `[Chat] [Detail] [Cockpit]` tab bar (deferred since Phase 1; the cockpit + viewer are desktop-only today). Fold the P1 viewer pill into the tab model; all panels CSS-`hidden` to preserve state (mirror `WorkspaceLayout` `workspace-mobile-tabs`).
9. **"Brief me" header button** — Commander triages the whole cockpit in chat ("2 reviews, 3 approvals, 1 blocked — I'd hit the hire first because…"). Needs a triage tool (see D11-adjacent — its own Commander-tools pass).

## D. Sibling features (own epics, per the architecture spec §1)

10. **Suggestion-engine harden** — generation quality + the Accept→execute flow (`merge_memory` stub at `server/src/services/suggestions.ts:1056`). Once trustworthy, ship the **Suggestions** cockpit card (opt-in).
11. **Google epic** — do-once foundation (per-user OAuth + token storage + multi-human privacy + sync), then 3 surfaces: **Calendar** → Today card; **Drive** → viewer tabs / artifact source; **Gmail** → discussion input + a "needs reply" card.

## E. Tidy-ups (minor)

12. **Dedupe `ACTIONABLE_APPROVAL_STATUSES`** — defined independently in `server/src/services/cockpit.ts` and `server/src/services/sidebar-badges.ts` (they agree today). Export one shared constant to prevent drift.

---

**Note:** the pre-existing cross-tenant `query_artifacts` leak is tracked separately (a background task chip), not part of this bundle.
