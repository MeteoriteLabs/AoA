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

5. **Pinned card** — **NEW table `user_entity_pins`** (`userId, companyId, entityType, entityId, pinnedAt`; Drizzle migration) + pin/unpin affordances on cockpit rows + the card (live status of pinned tasks/artifacts/goals). The only net-new persistence remaining.
6. **Opt-in cards** (off by default; query existing data via `/cockpit`, gated by `useCommanderCockpitPrefs`): **Goals at risk** (`goals.status='at_risk'`), **Budget pulse** (`/budgets/overview`; founder/lead-gated), **Done today** (`issues.completedAt` + `artifact_versions` + `activity_log`), **Proactive findings** (`internal_agent_runs.triggerType='proactive'` + notifications), **Teammates' activity** (`activity_log`; needs a privacy/scoping decision), **Quick capture** (one-line jot → task/discussion).
7. **"In this conversation" zone** — session-scoped cockpit zone (this chat's `outputRefs` + Commander-touched entities, live; same source as the viewer's "Recent from this conversation"), per design §3. Persists per conversation.

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
