# Threads — v1 Implementation Plan Series (Outline)

> **For agentic workers:** this is the **roadmap** across the v1 build. Each numbered plan is written (or will be written) as its own detailed, checkbox-tracked plan document. Implement them **in order** with superpowers:subagent-driven-development or superpowers:executing-plans.

**Source of truth:** `.superpowers/brainstorm/1347-1779468972/SPEC.md` (build contract) + `DESIGN.md` (rationale). App-wide infra deferred in `INFRA-FOLLOWUP.md`.

**Goal:** Ship the Threads v1 cut — turn the existing `discussions` backbone into the unified "Threads" workspace (unstructured input → structured Scope → real tasks), with the Command Staff crew, ownership/visibility, the continuum nav, and real-time foundations.

**Architecture:** Threads is `discussions` grown up. ~70% of orchestration already exists (dispatcher/runner/wakeup, extraction pipeline, role seeding, the viewer). We **extend** the discussion tables + services rather than build parallel ones. The Command Staff = Commander roles (`agents.kind='aoa'` + skillKeys + triggers).

**Tech stack:** Drizzle ORM + PostgreSQL (`packages/db`), Express 5 (`server/src`), React + Vite + Tailwind v4 (`ui/src`), shared types/constants (`packages/shared`). Tests: Vitest (`server/src/__tests__`), contract-style.

---

## Global conventions (code-truth — verified against the codebase)

These override the spec's shorthand wherever they differ (code-truth wins):

1. **No `pgEnum`.** Every enum-like field is a `text()` column whose allowed values live as an `as const` array in `packages/shared/src/constants.ts`. New enums = new const arrays + a `text()` column. Never add a `pgEnum`.
2. **User IDs are `text`, not `uuid` FKs.** Precedent: `issues.assigneeUserId = text("assignee_user_id")` (no FK); `discussions.createdBy = text("created_by")`. So `ownerUserId`, item `assigneeUserId`, etc. are `text`. Agent IDs **are** real `uuid` FKs to `agents.id`.
3. **Migrations:** never hand-write SQL. Run `pnpm db:generate` from the repo root (it runs `tsc` to compile `packages/db/src/schema/*.ts` → `dist/schema/*.js`, then `drizzle-kit generate`). Generated files land in `packages/db/src/migrations/` (next is `0100_*`). Schema must compile or no migration is emitted.
4. **Schema barrel:** every new table file must be re-exported from `packages/db/src/schema/index.ts` using the `.js` extension (e.g. `export { ... } from "./threads.js"`). `relations()` objects are NOT exported from the barrel.
5. **Reuse the discussions family.** `discussions` = thread container; `discussion_entries` = posts; `discussion_extracted_items` = Scope items; `discussion_annotations` = inline notes. Do **not** revive deprecated `debriefs`/`briefs`/`brief_items`.
6. **Tests:** follow the contract-test pattern at `server/src/__tests__/discussions-schema-contract.test.ts` — import real tables from `@armyofagents/db`, reflect column names with a `getColumnNames()` helper, assert shape. No DB, no drizzle internals.
7. **Locked-decision compliance (SPEC §7) applies to every plan:** Issues=Tasks (never rename `issues`/`/issues`); per-item routing founder-gated; only humans mark tasks done (#18); planning `work_mode` suppresses dispatch (D8); concurrency clamp DEFAULT=1/MAX=50 (D5); agents never write identity/domain memory (#15/#16/#52); goals one-level sub-goals (#20); artifacts immutable (#43/#45); CLI-only adapters + crew via `kind='aoa'`.

---

## Dependency graph

```
Plan 1 (Data Model)
   └─> Plan 2 (Thread Service & Lifecycle)
          ├─> Plan 3 (Command Staff + governance brakes)
          └─> Plan 4 (Threads shell UI)
                 └─> Plan 5 (Continuum nav)
                        └─> Plan 6 (Boundary model)
                               └─> Plan 7 (Real-time)
```

Plans 1→2 are hard prerequisites. Plan 3 (backend crew) and Plan 4 (UI shell) can proceed in parallel after Plan 2. Plans 5→6→7 layer on the shell. Each plan ends green (tests pass) and is independently shippable.

---

## Plan 1 — Data Model & Migrations  ·  SPEC §3

**Goal:** Add every Threads v1 schema change on the discussions backbone + the new tables, generate one migration, verify with contract tests.

**Done when:** `pnpm --filter @armyofagents/db build` compiles, `pnpm db:generate` emits a single `0100_*` migration, and new contract tests pass.

**File map**
- Modify: `packages/shared/src/constants.ts` — add Threads const arrays; extend `DISCUSSION_ENTRY_INPUT_TYPES` + `EXTRACTION_ITEM_TYPES`.
- Modify: `packages/db/src/schema/discussions.ts` — add thread-container columns to `discussions`; add `parentEntryId`/`authorAgentId` to `discussion_entries`; add committed-routing columns to `discussion_extracted_items`; fix stale priority comment.
- Modify: `packages/db/src/schema/projects.ts` — add `defaultThreadVisibility`.
- Create: `packages/db/src/schema/threads.ts` — 6 new tables (`thread_participants`, `thread_links`, `scope_item_dependencies`, `thread_plan_steps`, `thread_inbox_items`, `discussion_entry_attachments`) + relations. (`thread_channel_bindings` deferred to the v1.1 Live-integrations plan — YAGNI.)
- Modify: `packages/db/src/schema/index.ts` — register `./threads.js`.
- Create: `server/src/__tests__/threads-schema-contract.test.ts` — column-shape assertions.
- Generated: `packages/db/src/migrations/0100_*.sql` (via `pnpm db:generate`).

**Tasks**
1. Add Threads const arrays + extend existing ones (constants contract test).
2. ALTER `discussions` — thread-container columns (contract test).
3. ALTER `discussion_entries` — `parentEntryId`, `authorAgentId` (contract test).
4. ALTER `discussion_extracted_items` — committed routing + type extension + priority-comment fix (contract test).
5. ALTER `projects` — `defaultThreadVisibility` (contract test).
6. Create `threads.ts` (6 tables + relations) + barrel registration (contract test).
7. Generate the migration + verify it contains the expected columns/tables + commit.

> **Full detail:** `2026-05-24-threads-plan-1-data-model.md`.

---

## Plan 2 — Thread Service & Lifecycle  ·  SPEC §5, §5.1

**Goal:** The backend brain of a thread — phase state machine, Scribe Summary persistence, promote-to-goal, fork/merge, **ownership ("owned-by-action")**, and **visibility query-layer RBAC** (private threads never appear for non-participants). Auto-extraction on create.

**Done when:** thread CRUD + lifecycle endpoints work behind RBAC, private threads are filtered from list/detail/search for non-participants, ownership transitions follow the rules, and service + route contract tests pass.

**File map**
- Create: `server/src/services/threads.ts` — thread lifecycle service: `advancePhase()` (discuss→scope→assign→done state machine, mirror goal-status enforcement), `generateSummary()` persistence, `promoteToGoal()` (creates a `goals` row + sets `discussions.goalId` + writes `project_goals`), `forkThread()` / `mergeThreads()`, ownership: `claimThread()` / `transferOwnership()` / `addParticipant()` / `removeParticipant()` / `resolveOwnerOnAction()`, visibility: `assertCanViewThread()` + `scopeThreadQuery()` (the RBAC filter used by every list/detail/search query).
- Modify: `server/src/routes/discussions.ts` — add thread endpoints (phase, summary, promote-to-goal, fork/merge, claim/transfer, participants) OR add `server/src/routes/threads.ts` and mount it; apply `scopeThreadQuery()` to list/detail.
- Modify: `server/src/services/discussions.ts` — extend create to set thread defaults (origin, phase=discuss, visibility from `projects.defaultThreadVisibility`, owner=creator if human else null/Unclaimed).
- Modify: `server/src/services/extraction.ts` — make extraction **auto-on-create** (gate the existing durable `pending` sweep on; drop the manual "Reprocess" requirement).
- Reuse: `server/src/services/goals.ts` (promote-to-goal), `server/src/routes/goals.ts`, `project_goals`.
- Create: `server/src/__tests__/threads-service.test.ts`, `threads-visibility-rbac.test.ts`, `threads-routes-contract.test.ts`.

**Tasks**
1. Thread create defaults (origin/phase/visibility/owner) — service test.
2. Phase state machine `advancePhase()` + guards — service test.
3. Ownership: `claimThread`/`resolveOwnerOnAction`/`transferOwnership` (owned-by-action; agents never own) — service test.
4. Participants: `addParticipant`/`removeParticipant` with role enum — service test.
5. Visibility RBAC: `assertCanViewThread` + `scopeThreadQuery` (open vs private; Unclaimed visible only to Unlisted-viewers) — RBAC test.
6. Summary persistence (`summaryText`/`summaryNext`/`summaryUpdatedAt`) — service test.
7. Promote-to-goal (goal row + `goalId` + `project_goals`, carry owner) — service test.
8. Fork/merge skeleton (lineage via `thread_links`) — service test.
9. Auto-extraction-on-create gate — integration test.
10. Wire routes + apply visibility filter to list/detail — route contract test.

---

## Plan 3 — Command Staff + governance brakes  ·  SPEC §4, §4.1, §4.2

**Goal:** Stand up the crew (Command Staff) as Commander roles, build the missing trigger evaluators, and ship the **governance brakes** that must exist before L2 autonomy is safe.

**Done when:** all five roles seed idempotently, mention/phase/routine triggers fire, crew runs record **real cost**, an in-flight crew run can be **killed**, company/thread **kill-switches** work, `autonomyLevel` gates dispatch, and per-role model + extract/classify cost-caps apply. Tests cover seeding, trigger eval, cost accounting, cancellation.

**File map**
- Modify: `server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts` — extend the "Discussion Extraction" agent → **Scribe** (office-hours interrogate, task-vs-spin-off classification, per-item dept-tag, conflict + goal detection); keep idempotent D2 backfill.
- Create: `server/src/services/internal-agent/aoa-agents/ensure-router.ts`, `ensure-planner.ts`, `ensure-dispatcher.ts`, `ensure-memory-keeper.ts` — role seeders following the `ensure-commander.ts` / `ensure-extraction-agent.ts` pattern (`agents.kind='aoa'` + `runtimeConfig.aoa.role` + `toolAllowlist` + `aoaAgentTriggers` rows).
- Create: role instruction files under `server/src/onboarding-assets/` (per the `loadDefaultAgentInstructionsBundle` pattern) for each new role.
- Modify: `server/src/services/internal-agent/aoa-agents/triggers.ts` — add **mention**, **phase-advance**, **routine** evaluators (today only `outbox`).
- Modify: `server/src/services/internal-agent/aoa-agents/dispatcher.ts` — read `autonomyLevel` to gate which roles run (crew-activation); add the wakeup/mention → role dispatch.
- Modify (brakes): `server/src/services/internal-agent/aoa-agents/runner.ts:159` — replace hardcoded `costCents: 0` with **real** token/cost accounting (capture adapter token usage; also meter Provider-SDK extraction/classify spend via `providers/`).
- Modify (brakes): `server/src/services/heartbeat.ts` (`cancelActiveForAgent` ~4802, `cancelBudgetScopeWork` ~4841) — extend cancellation to reach `internal_agent_runs` + the dispatcher's running subprocesses (today only `heartbeat_runs`).
- Modify (brakes): `server/src/services/budgets.ts` — wire `getInvocationBlock` (dead code ~314-364) into the crew dispatch path **or** remove it and add an equivalent preflight; add **company- + thread-level kill-switch**.
- Modify (brakes): `server/src/services/internal-agent/providers/index.ts` + role config — **per-role model choice** + **per-call cost-caps** on extract/classify.
- Modify: `packages/shared/src/constants.ts` — embeddings v1 default note (hosted SDK + Postgres-FTS fallback) if a flag is needed.
- Tests: `server/src/__tests__/command-staff-seeding.test.ts`, `crew-triggers.test.ts`, `crew-cost-accounting.test.ts`, `crew-killswitch.test.ts`, `autonomy-gate.test.ts`.

**Tasks**
1. Extend extraction agent → Scribe (seed + instruction file) — seeding test.
2. Seed Router/Planner/Dispatcher/Memory-Keeper roles (idempotent) — seeding test.
3. Memory Keeper **proposes only** (status pending; never identity/domain) — guard test.
4. Mention trigger evaluator (@agent → wakeup → role) — trigger test.
5. Phase-advance trigger evaluator (Planner on phase change) — trigger test.
6. Routine trigger evaluator — trigger test.
7. Real cost accounting in `runner.ts` (CLI tokens + SDK extract/classify) — cost test.
8. In-flight cancellation reaches `internal_agent_runs` + subprocess — cancel test.
9. Company/thread kill-switch — kill-switch test.
10. `autonomyLevel` enforcement gate (L1/L2/L3 = which roles on duty) — autonomy test.
11. Per-role model choice + extract/classify cost-caps — config test.

---

## Plan 4 — Threads shell UI  ·  SPEC §6

**Goal:** The 3-pane focus view — origin card, Thread tab, Scope tab — over the reused viewer, plus the unified creation modal.

**Done when:** a thread opens in the focus view, the Scope tab renders Summary/Plan/Items, the viewer renders artifacts, and "New Thread" creates threads via the existing backends.

**File map**
- Create: `ui/src/pages/ThreadDetail.tsx` — 3-pane focus shell (replaces the flat `DiscussionDetail.tsx` model; keep the old page until parity).
- Create: `ui/src/components/threads/OriginCard.tsx` — type/chips/participants/@mention/phase pills/autonomy(L1–L3) crew popover.
- Create: `ui/src/components/threads/ThreadTab.tsx` — the timeline of entries (reuse `DiscussionDetail` entry rendering).
- Create: `ui/src/components/threads/ScopeTab.tsx` — Summary + Plan (interactive steps) + Items (Needs input / Confirmed / References / Artifacts) + spin-off item.
- Create: `ui/src/api/threads.ts` — client mirroring `ui/src/api/discussions.ts` (list/detail/create/update/phase/claim/participants).
- Reuse: `ui/src/components/workspace/WorkspacePreviewPanel.tsx` + `output-viewer-registry.ts` (the right-viewer renderer registry + live-port browser).
- Modify: `ui/src/context/DialogContext.tsx` — add `openNewThread(defaults)` / `newThreadOpen` / `closeNewThread()` following `openNewIssue`/`openDiscussionCapture`.
- Create: `ui/src/components/NewThreadDialog.tsx` — adaptive modal (Idea/Discussion/Goal/Transcript/Document + relate/add-to); Goal type reuses NewGoalDialog fields; branches to `discussionsApi`/`goalsApi`.
- Modify: `ui/src/components/Sidebar.tsx` — Threads nav entry in WORK.
- Tests: component tests for ScopeTab grouping + NewThreadDialog branching.

**Tasks**
1. `threads.ts` API client (typed) — type test.
2. ThreadDetail 3-pane shell + routing — render test.
3. OriginCard (chips/participants/phase pills/autonomy popover) — render test.
4. ThreadTab timeline (reuse entry rendering) — render test.
5. ScopeTab: Summary + Plan + Items grouping — render test.
6. Right viewer reuse (image/md/pdf/code/static-HTML) — render test.
7. DialogContext `openNewThread` + NewThreadDialog adaptive form — branching test.
8. Sidebar Threads nav.

---

## Plan 5 — Continuum nav  ·  SPEC §6, §10

**Goal:** The index "continuum" — List + Board (Unlisted lane + phase columns), sidebar search, and the Router/Unlisted triage surface. (Graph lens + Live lane are v1.1.)

**Done when:** threads render as a List and a Board (phase columns + Unlisted lane), search filters them, and Unlisted items can be triaged (Make thread / Add to ▾ / Dismiss).

**File map**
- Create: `ui/src/pages/ThreadsList.tsx` — the continuum index (List + Board toggle).
- Create: `ui/src/components/threads/ThreadBoard.tsx` — phase columns + pinned Unlisted lane (amber); card spec (origin icon · title · chips · owner · activity · unread).
- Create: `ui/src/components/threads/UnlistedLane.tsx` + triage actions (calls Router endpoints).
- Modify: `ui/src/components/CommandPalette.tsx` — include Threads in cmd+K results.
- Modify: `server/src/routes/discussions.ts` (or threads routes) — list filters (phase, owner, scope) + Unlisted (`thread_inbox_items`) endpoints (triage: attach/dismiss).
- Reuse: `ui/src/components/Sidebar.tsx` sidebar search affordance.
- Tests: board grouping by phase; Unlisted triage; Router confidence UI (no raw %).

**Tasks**
1. ThreadsList List view + filters — render test.
2. ThreadBoard phase columns + card spec — render test.
3. Unlisted lane + triage actions — interaction test.
4. Router/Unlisted endpoints (`thread_inbox_items`) — route test.
5. cmd+K Threads results — search test.

---

## Plan 6 — Boundary model  ·  SPEC §2, §5.1, §19

**Goal:** The cross-boundary mechanics — participants + @mention (human notify / agent invoke), ownership UI (Claim/transfer/manage), visibility UI (open/private + per-dept default), per-item department + assignee routing, spin-off threads, and cross-thread links + dependencies.

**Done when:** you can @mention humans/agents, claim/transfer/manage a thread, set visibility, route each Scope item to a dept + agent|human, spin off a child thread, and link/block across threads (graduating `scope_item_dependencies` → `task_dependencies` on Assign).

**File map**
- Modify: `server/src/services/threads.ts` — participant/@mention dispatch (reuse `delegate-to-subagent` → `agent_wakeup_requests` → dispatcher Phase 3 → `runAoaAgent`; @human = notification only), cross-thread links (`thread_links`), dependency graduation (`scope_item_dependencies` → `task_dependencies`), spin-off creation (linked child thread).
- Modify: `server/src/routes/discussions.ts`/threads routes — participant, link, dependency, spin-off endpoints.
- Reuse: `server/src/services/internal-agent/aoa-agents/dispatcher.ts` (wakeup Phase 3), `notifications` table, `task_dependencies`.
- Modify (UI): `ui/src/components/threads/OriginCard.tsx` (participants + @mention + ownership controls + visibility toggle), `ScopeTab.tsx` (per-item dept + assignee agent|human, dependency badges, spin-off item, conflict cards).
- Create (UI): `ui/src/components/threads/MentionInput.tsx`, `OwnershipMenu.tsx`, `VisibilityToggle.tsx`.
- Tests: @mention routing, ownership transitions via UI, per-item routing, dependency graduation, spin-off.

**Tasks**
1. Participant + @mention backend (human notify / agent invoke) — service test.
2. Cross-thread links (`thread_links`) endpoints — route test.
3. Scope-item dependencies + graduation to `task_dependencies` on Assign — service test.
4. Spin-off thread creation (linked child, seeded context) — service test.
5. Per-item routing (department + assignee agent|human) — service test (founder-gated).
6. OriginCard ownership + visibility + @mention UI — interaction test.
7. ScopeTab per-item routing + dependency badges + conflict cards — render test.

---

## Plan 7 — Real-time  ·  SPEC §6.2

**Goal:** Real-time foundations — thread event types, reliability (per-thread `seq`, catch-up, reconnect), **per-thread scoping + envelope RBAC** (private-thread leak-safe), and human presence/typing. Refetch-on-poke model (push deltas + Redis are v1.1/infra).

**Done when:** thread changes broadcast scoped events that only RBAC-permitted viewers receive, clients catch up after reconnect via `sinceSeq`, and presence/typing shows.

**File map**
- Modify: `server/src/services/live-events.ts` (the in-process EventEmitter bus) — add thread event types (`thread.entry.created`/`.scope.changed`/`.phase.changed`/`.summary.updated`/`.participant.changed`); add a **per-thread subscription registry** + **envelope RBAC filter at fan-out** (reuse `assertCanViewThread` from Plan 2).
- Modify: the `/events/ws` route handler — accept per-thread subscribe messages; filter by recipient RBAC.
- Add: per-thread monotonic `seq` (column on `discussion_entries` or a counter) + catch-up endpoint `GET …/threads/:id/entries?sinceSeq=N`.
- Add: ephemeral presence/typing channel (TTL, in-memory).
- Modify (UI): `ui/src/context/LiveUpdatesProvider.tsx` — handle thread events (keep refetch model), subscribe to the open thread, refetch-on-reconnect, presence indicators; reuse `agent.status`/`heartbeat.run.*` for the agent "working" indicator.
- Tests: envelope RBAC (non-participant gets no event for a private thread), catch-up `sinceSeq`, reconnect refetch.

**Tasks**
1. Thread event types on the bus — emit test.
2. Per-thread subscription registry + envelope RBAC filter — RBAC fan-out test.
3. Per-thread `seq` + catch-up endpoint — catch-up test.
4. Refetch-on-reconnect (client) — integration test.
5. Presence + typing (ephemeral) — presence test.

---

## After v1 (not in this series — for reference)

- **v1.1:** Graph lens (React Flow) · Live integrations (Slack/WhatsApp + `thread_channel_bindings`) · audio/Figma renderers · merge reconciliation · two-way Live · real-time push content deltas + payload-RBAC · Watch/Follow toggle.
- **App-wide infra (separate effort — `INFRA-FOLLOWUP.md`):** Redis/NATS pub-sub (multi-instance) · preview proxy + auth · embeddings provider strategy · LLM-at-scale batching.
- **later:** L3 autonomy · worker→thread write-back · webhook origins.

---

## Eng Review — Outputs (2026-05-24)

**What already exists (reuse, do not rebuild):** `discussions`/`discussion_entries`/`discussion_extracted_items` backbone · durable dispatcher `runAoaDispatch` + `runAoaAgent` · `extractionService` · crew seeding (`ensureCommanderAgent`/`ensureExtractionAgent`/`seedCommanderInstructionBundle`) · `publishLiveEvent` bus · `WorkspacePreviewPanel` + `output-viewer-registry` · `agent_wakeup_requests` + dispatcher Phase 3 (@mention path) · `notifications` · `task_dependencies` · `goalService` + `project_goals`.

**NOT in scope (deferred, with rationale):** Graph lens (v1.1 — a view, not core) · Live integrations + `thread_channel_bindings` (v1.1 — greenfield connector layer) · push content deltas + payload-RBAC (v1.1 — optimization over already-safe refetch) · Redis/NATS pub-sub (infra — multi-instance only) · preview proxy/auth (infra — cloud only) · embeddings provider strategy (infra — v1 default is hosted SDK + FTS fallback) · Watch/Follow toggle (v1.1) · L3 autonomy (later).

**Failure modes (post-amendment):**
- `seq` collision on concurrent posts → **fixed** (D1 atomic `entry_seq` counter + unique index).
- Extraction silently off at default autonomy → **fixed** (D2 extraction always-on).
- Runaway crew loop never auto-stops on subscription billing → **fixed** (D3 run-rate cap + kill-switch).
- `list` perf cliff → **fixed** (D4 batched to 2 queries).
- Duplicate owner rows → **fixed** (unique index + `onConflictDoNothing`).
- Existing discussions all "Unclaimed" on upgrade → **fixed** (owner backfill A3).
- **Residual (flagged, infra-phase):** the in-flight-kill subprocess registry (Plan 3 Task 7) is in-memory — a server restart mid-run orphans the child process. Acceptable for single-instance v1; revisit when the pub-sub/process-supervision infra lands. RBAC fan-out recompute is per-event (no cache) for v1 — correct but recompute-heavy on hot threads; revisit with infra.

**Parallelization lanes:**
- Lane A (backend): Plan 1 → Plan 2 → Plan 3 (sequential; shared `server/src/services`).
- Lane B (frontend): after Plan 2, Plan 4 → Plan 5 (sequential; shared `ui/src`).
- Lane A's Plan 3 and Lane B's Plan 4 run **in parallel** (different packages) after Plan 2 merges.
- Plan 6 (full-stack) and Plan 7 (full-stack) are sequential after 5, and touch both packages — run after A+B rejoin.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — (scope set in brainstorm) | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | CLEAR (applied) | 8 gaps found, all 8 folded into Plans 1/2/4/5/6 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 8 findings (4 forks decided + 4 fixes), 0 unresolved, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score 5/10 → 8/10; 3 forks decided (mobile tab pattern · full state matrix · a11y baseline) + IA/token/conflict-card fixes, folded into Plans 4-7 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **UNRESOLVED:** 0. Eng: 4 forks + 4 fixes → Plans 1/2/3/7. Design: 3 forks + IA/token/conflict fixes → Plans 4-7. Codex: 8 gaps → Plans 1/2/4/5/6.
- **CODEX:** independent pass found 8 additive gaps the same-model passes missed — RBAC-on-writes, activity logging, the **Assign loop** (confirmed-item → `issues`, founder-gated/idempotent/`work_mode`/deps), naming-IA drift, goal-as-thread, origin backfill, owner-demote-on-transfer, server-side sub-goal guard. All applied.
- **CROSS-MODEL:** no disagreement — Codex's findings were additive, not contradictory; all 8 accepted.
- **VERDICT:** ENG + DESIGN + CODEX CLEARED — ready to implement. All amendments applied across Plans 1-7.
