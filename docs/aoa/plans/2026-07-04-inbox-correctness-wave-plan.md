# Inbox Correctness Wave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task's full fix design (root cause, exact code, edge cases) lives in `docs/aoa/qa/inbox-hub-2026-07-03/ROOT-CAUSE-INVESTIGATION.md` — read your task's section there FIRST; this plan sequences and scopes, the investigation doc carries the code.

**Goal:** Implement the founder-locked decisions from the 2026-07-04 root-cause investigation: waiting-lane mirror semantics, Approvals nav removal, zombie-run teardown, work_question safety, crew-dispatch autonomy exemption, hub polish fixes, and the dead-type build/prune package.

**Founder decisions (2026-07-04, all locked):**
1. **Approvals nav:** remove the nav item, KEEP all `/approvals` routes (8 deep-link producers), pair with the dismiss-visibility fix.
2. **Lane model = MIRROR:** resolve/archive on a still-pending decision item (approval_request, join_request, agent_runtime_decision) is server-rejected; items leave only when the source is decided. Dismiss/snooze stay allowed (personal), with a lane affordance to reveal hidden items.
3. **Dead types package:** build extraction_failed + routine_outcome(failure-only) now; prune human_input_needed + scope_proposal; defer reminder + proactive to 1.1 (fix the CLAUDE.md proactive overstatement now); keep legacy_other internal-only (hide from settings).
4. **Crew gate:** the company crew-autonomy dial gates agent-INITIATED work only; explicit founder authorization (crew_dispatch approve, manual assignment) always dispatches. `crewPaused` remains the kill-switch.

**Defaults taken (flagged, vetoable):** dead-run work_question answer → 409-and-cancel (honest error); budget_alert closes symmetric (<80%); fixed extraction auto-archives its failure item; "Needs you most" = waiting-lane-only fetch; routine SUCCESS never notifies; Manual-mode scope drafts stay thread-only for launch.

**Branch:** `feat/inbox-hub-tabbed` (same PR, next part). **Verification:** suites per task + one live pass at the end (Task 12).

---

## Sub-wave 1 — Decision-surface correctness

### Task 1 — Mirror model: per-type manual-lifecycle guard (R3 + H1)
**Investigation sections:** `R3-runtime-decision-hub-actions-not-server-blocked`, `H1-archive-hides-pending-approval`.
**Files:** `packages/shared/src/hub.ts` (legality map), `server/src/services/hub-items.ts` (recordLifecycleAction guard + delete the unreachable recordAndAct tail ~:1253-1347), `ui/src/components/hub/HubViewer.tsx` (hide Resolve/Archive for the blocked types — runtime_decision already hides; extend to approval_request/join_request), tests: `hub-items-lifecycle.test.ts`, `hub-items-routes.test.ts`, `HubShell.test.tsx`.
- [ ] Failing tests: POST action resolve/archive on an OPEN approval_request/join_request/agent_runtime_decision item whose source is still pending → 409 with actionable message ("Decide it in the approval/decision itself"); same action once the source is settled (but row still open pre-reconcile) → allowed. Dismiss/snooze/claim/release unaffected.
- [ ] Implement: `HUB_SOURCE_MIRRORED_TYPES` in shared hub.ts; guard in `recordLifecycleAction` after the open-status check — source-pending lookup via the existing per-source snapshot helpers (approvals/join/runtime-decision), fail-open if the source row is gone (treat as settled). Remove the dead recordAndAct tail (verify nothing imports it first).
- [ ] UI: hide Resolve/Archive buttons for mirrored types while open (HubViewer `showLifecycleActions` extension). Commit.

### Task 2 — Dismissed-visibility affordance (the dismiss hole)
**Files:** `ui/src/components/hub/HubShell.tsx` + `HubList.tsx` + `ui/src/pages/InboxHub.tsx`; the query API already supports `includeDismissed`/`includeSnoozed` (server `query()` opts).
- [ ] Waiting lane header gains a subtle "N hidden" chip when the lane has dismissed/snoozed OPEN items for this user (needs a cheap count: extend the list response or a second small query — prefer extending the existing counts endpoint with `hiddenOpen` for the lane). Clicking toggles `includeDismissed+includeSnoozed` on the list query; hidden rows render with a muted "dismissed" badge + an Undismiss action (undismiss/unsnooze routes exist).
- [ ] Tests: chip appears only when hidden>0; toggle includes rows; undismiss restores. Commit.

### Task 3 — Remove Approvals from primary nav (founder decision 1)
**Investigation section:** Approvals track `removalPlan`.
**Files:** `ui/src/components/Sidebar.tsx` (remove the Approvals entry), keep ALL routes; fix the 2 stale e2e assertions the investigator found (`tests/e2e/inbox-hub-w1b.spec.ts:47`, `inbox-hub-operator.spec.ts` "Open full is a link") and update the operator spec that asserts the nav entry if any; grep e2e for `nav.*Approvals`.
- [ ] Remove nav item; run the affected e2e specs' assertions logic mentally (Windows skips e2e — adjust specs by reading, CI validates); update docs (CLAUDE.md sidebar structure section: remove Approvals from the nav list). Commit.

## Sub-wave 2 — Runtime lifecycle

### Task 4 — Zombie-run teardown (R1: 4 coordinated changes)
**Investigation section:** `R1-zombie-cli-survives-cancel`.
**Files:** `packages/adapter-utils/src/server-utils.ts` (win32 taskkill tree-kill in signalRunningProcess), `server/src/services/heartbeat.ts` (remove the 4 eager `runningProcesses.delete` sites so the SIGKILL grace timer works; terminal-status latch in setRunStatus — conditional UPDATE `WHERE status NOT IN (terminal)` with metadata-only fallback patch, skip live-event + terminal hub emit on guard miss), `server/src/services/agent-runtime-decisions.ts` (createPrompt run-liveness guard → conflict on terminal run), `server/src/services/runtime-hook-registry.ts` (+`deregisterRuntimeHooksForRun` called from cancelRun).
- [ ] TDD per the investigation's test list: latch unit test (cancelled + running patch → status unchanged, metadata applied, no publish); createPrompt-on-terminal-run → 409 and hook route maps to deny; win32 taskkill spawn mock test; existing cancel tests green.
- [ ] Sanity: run every heartbeat-named suite from repo root. Commit.

### Task 5 — work_question safety fixes (R2, safety only — the adapter caller stays deferred)
**Investigation section:** `R2-work-question-stall-and-no-caller`.
**Files:** `server/src/services/agent-runtime-decisions.ts` (answerPrompt liveness gate → dead run ⇒ decision cancelled + relayError "run ended before the answer could be delivered" + push-close + 409; sweeper coverage: extend `listDueForExpiry` handling so `answered`/`relay_failed` rows whose run is terminal get cancelled+closed), route error copy, tests in `agent-runtime-decisions.test.ts`.
- [ ] TDD: answer against terminal run → 409 + decision cancelled + hub item archived; sweeper closes a stranded answered-row with dead run; live-run answer path unchanged (relay <1s test untouched). Commit.

### Task 6 — Crew dispatch: authorization overrides the dial (founder decision 4)
**Investigation section:** `crew-dispatch-skipped-autonomy-double-gate`.
**Files:** `server/src/services/issue-assignee-wakeup.ts` (stamp `dispatchClass:'task_dispatch'` in the single chokepoint's basePayload), the wakeup dispatcher gate (where `skipped_autonomy` is written — exempt task_dispatch-class wakeups from the role-autonomy gate ONLY; keep crewPaused/thread pause/budget hard-stop/run-count brakes), tests for the dispatcher gate.
- [ ] TDD: at company autonomy Manual, a crew_dispatch-approved wakeup now spawns a run (or reaches the dispatch path in the mock); an agent-INITIATED wake (no dispatchClass) still skips; crewPaused still blocks everything. Verify the W1c approve side-effect path stamps through the chokepoint. Commit + note for decisions.md (Task 11).

## Sub-wave 3 — Hub polish

### Task 7 — Producer/UI quick wins (H2 + H5)
- [ ] H2: hire-approval in-tx emit — `routes/agents.ts` after the approvalsSvc.create block (~:1153): `await emitHubItem(db, buildApprovalHubEmit(approval))` (+ import). Test: hire on a board-approval company emits immediately (mock emit spy).
- [ ] H5a: run producers gain `relatedEntityType:"agent", relatedEntityId: run.agentId` (both builders; parity test updated — key-safety verified: relatedEntity not in sourceUniqueKey). **Companion fix (required):** `hubRegistry.tsx` run-case resolveTabId must NOT use preferRelated (it would return the agent id as run id) — use rawSource(sourceId)=run.id for the runId and relatedEntityId for the agentId in `hubTabForItem`'s run branch.
- [ ] H5b: Needs-you-most — InboxHub fetches a small waiting-lane page (limit 5) when `activeLane===null` and passes it to HubShell/HubHome. Test: Home shows waiting items. Commit.

### Task 8 — budget_alert reconciler + summary heal (H3)
**Investigation section:** `H3-budget-alert-never-closes`.
- [ ] Shared `formatBudgetAlertSummary` used by producer + reconciler (byte-identical, storm-safe); `reconcileCompanyBudget` in SOURCE_RECONCILERS (terminal when utilization <80% or budget unset; heal summary in place otherwise); call it from the sidebar-badges scan + notifications-lane GET. TDD: closes when budget cleared; heals stale % in place; no ping-pong (xmin stable on identical re-emit). Commit.

### Task 9 — suggestion dedupe (H4)
**Investigation section:** `H4-suggestion-dedupe-miss`.
- [ ] Stable `patternId` per detector finding; `dedupe_key` column (Drizzle schema + `pnpm db:generate`) with partial unique index on pending; detect() upsert honors it; self-heal for existing dup pairs (close the older on next detect). TDD per investigation. Commit.

## Sub-wave 4 — Type registry package (founder decision 3)

### Task 10 — Build 2, prune 2, hide 1
- [ ] BUILD extraction_failed: `buildExtractionFailedHubEmit` + emits at extraction.ts failure sites (:431/:521 region) with classified-guidance summary; reconcile: successful reprocess auto-archives (targeted reconcile at the reprocess success path). TDD + template test.
- [ ] BUILD routine_outcome (failure-only): `buildRoutineFailedHubEmit` emitted where routine runs record failure (verify the routines run path the investigator cited; if routines genuinely never run in this build, downgrade to BLOCKED and report — do not fake it).
- [ ] PRUNE human_input_needed + scope_proposal in one commit: shared hub.ts maps (types/lanes/authority/autopilot founder-gate), notification-registry entries, hubRegistry.tsx entries + tabKind switch cases, prefs/autopilot defaults, tests. Existing DB rows: read-side falls back safely (verify decorateItem null-guard) — add a strip-unknown guard where the investigator flagged casts.
- [ ] HIDE legacy_other from the settings rules list (prefs UI filter only; sink stays functional for imports). Commit.

### Task 11 — Docs + decisions
- [ ] CLAUDE.md: remove Approvals from the sidebar list; fix the Commander proactive line ("proactive checks implemented; scheduler wiring tracked for 1.1"). decisions.md: append the four founder decisions (mirror lane model; approvals nav removal + routes kept; crew dial = initiative-only; dead-type package) as dated entries following the existing format. Commit.

### Task 12 — Regression + live verification
- [ ] Full suites: `npx vitest run` from repo root (workspace) + `pnpm --filter @armyofagents/ui typecheck` + server typecheck + adapter package suites.
- [ ] Rebuild UI, restart QA server (same env), live pass: mirror-block via API (409) + UI (buttons hidden); dismiss→chip→undismiss; nav shows no Approvals but /approvals/:id deep link still renders; cancel a claude run → process tree dead (`tasklist` check) + no zombie decisions; answer a dead-run decision → honest 409; crew_dispatch approve at Manual → run actually spawns; budget alert closes when budget cleared; extraction failure → inbox item → reprocess success archives it. Screenshots + append results to TEST-REPORT.md. Report the URL to the founder.

## Scope guard
**In scope:** exactly the tasks above. **Not in scope:** work_question adapter caller (deferred feature — needs its own design), reminder/proactive schedulers (1.1), BUG-6 codex empty-turn (separate investigation), E3 hub tab panels (deferred by founder), Approvals page deletion (kept), autopilot escalation surfacing, slaAt display, toast scope. **Do not** alter emit()'s storm guard semantics anywhere.
