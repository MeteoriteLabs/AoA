# AoA (Army of Agents)

Hybrid Workforce Operating System for startups. Founding teams of any size — solo founders to multi-person teams — run AI agents + humans from a single control room. Agents extend your team; they don't replace it.

---

## If You Are an AI Agent

You are reading this as context for working on the AoA codebase. This applies whether you are doing feature development, bug fixes, code review, or exploration.

- **Code is always truth.** If this file conflicts with what you find in source, trust the code and flag the discrepancy.
- **Architectural decisions are locked.** Before changing how a system works, read `docs/architecture/decisions.md`. 90+ decisions are locked. Do not relitigate them.
- **AoA is not open source.** Do not add open-source license headers, public contribution guides, or community-facing copy.
- **Commander** is the name of the always-on internal AI assistant built into AoA. It has its own onboarding context (`server/src/onboarding-assets/`). You are not Commander unless explicitly told so.
- **Paperclip** is the open-source base AoA forked from. It is not mentioned in user-facing docs. For wire protocol contracts and deprecated table tracking, see `docs/paperclip-migration.md`.

---

## Critical Rules

1. **Drizzle ORM only.** Schema changes go in `packages/db/src/schema/`. Run `pnpm db:generate` for migrations. NEVER write raw SQL migration files.
2. **Follow existing patterns.** New services follow `server/src/services/goals.ts`. New routes follow `server/src/routes/goals.ts`. New schemas follow `packages/db/src/schema/goals.ts`.
3. **"Issues" = "Tasks" in UI only.** The DB table is `issues`. The API routes use `/issues`. All user-facing text says "Task" / "Tasks". Never rename the table or routes.
4. **"Projects" table serves both Departments and Projects.** Distinguished by `type` field: `'department'` | `'project'`. Same mechanics for both.
5. **MCP inbound with authenticated write permission may create tasks directly.** `debrief-push` remains for unstructured content requiring extraction. Anonymous MCP input must route through Discussion. (Decision #14, revised 2026-04-21)
6. **Agents cannot write to Memory directly.** They can suggest items (status: 'pending'), but only the founder can approve identity + domain layers. Team leads can additionally approve active_context for their departments. Working memory is auto-created. (Decisions #15, #52)
7. **Artifact versions are immutable.** Once created, never modified. Changes = new version. Founder picks winner for branching — no auto-merge. (Decisions #43, #45)
8. **Memory feedback requires ≥3 occurrences.** Don't suggest memory from one-off edits. Pattern must be consistent. (Decision #46)
9. **Discussion scope fallback: item-level > entry-level > discussion-level > null.** Founder's per-item override always wins. (Decision #61)
10. **Consult `docs/architecture/decisions.md` before making architectural choices.** 90+ locked decisions exist. Do not relitigate.
11. **The only runtime hosted API key is for embeddings.** Agents, Commander, and **all extraction** (discussion + debrief-push + file-import + crew memory-extract tools) run keyless via locally-installed CLIs. Extraction is **CLI-only** — no extraction code path reads a hosted provider key, and there is no api fallback (the `callLLM`/`callAnthropic`/`callOpenAI` path + the engine-status route were removed, amended Decision #104 on 2026-06-27). Embeddings use OpenAI `text-embedding-3-small`; per-company key = Settings secret `llm:openai` → env `OPENAI_API_KEY`, configured in **Settings → Memory**. The `createOpenAiEmbedder` chokepoint in `server/src/services/embeddings.ts` is the sole caller. Do not add new hosted-API calls outside this chokepoint, and do not re-introduce a hosted-key extraction fallback. (Decision #104, amended 2026-06-27)

---

## Paperclip Divergence Points

These are intentional AoA-specific choices that **differ from Paperclip** and must
survive future Paperclip pull syncs. Future agents: when you see a Paperclip commit
touching these areas, check against this list before porting.

### D5 — Concurrency clamp (heartbeat)

- `HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT = 1` — **permanent teaching default**.
  AoA teams opt-up per-agent as they build trust. A founding team of 3-5 people
  running a multi-agent pipeline can set each agent to 3-5, yielding 9-25 concurrent
  runs — well within the clamp.
- `HEARTBEAT_MAX_CONCURRENT_RUNS_MAX = 50` — raised from Paperclip's 10 in v1.1 (D5).
  Founding teams legitimately need > 10 concurrent runs across all agents.
- **Do NOT port** any Paperclip commit that raises the DEFAULT above 1 or the MAX
  above 50 unless there is a specific AoA team-size reason to do so.

### D6 — Hire-approval default by deployment mode (company create)

- `local_trusted` mode: `requireBoardApprovalForNewAgents = false` at create time.
  Loopback trust boundary = all users are already implicitly trusted. One-click
  approval for every agent hire is friction with no multi-human safety benefit.
- `authenticated` mode: `requireBoardApprovalForNewAgents = true` at create time.
  Multi-human board → agent hiring is a governance decision. Default on = safe.
- DB schema default (`.default(true)`) is unchanged — this is injected server-side
  in `server/src/routes/companies.ts` POST handler using `opts.deploymentMode`.
- **Do NOT port** any Paperclip commit that sets this field to `false` in
  `authenticated` mode. Multi-human board accountability is the AoA thesis.

### D8 — Planning mode dispatch gate

- `issues.work_mode` column (`"standard" | "planning"`, DB default `"standard"`).
- When `work_mode = "planning"`, the heartbeat dispatch gate in
  `server/src/routes/issues.ts` (CREATE line ≈609, UPDATE/PATCH line ≈772)
  is suppressed via `shouldDispatchIssueWakeup()` in
  `server/src/routes/issues-planning-mode-dispatch.ts`.
- UI: amber "Planning" pill on IssuesList rows, NewIssueDialog chip bar, and
  TaskSlideOver header (click to revert to Standard).
- **Do NOT port** any Paperclip commit that adds `work_mode` or a similar field
  differently — AoA's interpretation is that planning tasks are human-curated and
  must not auto-dispatch until the founder switches them to Standard.

---

## Naming Map (UI ↔ DB/API)

| UI Label | DB Table | Notes |
|----------|----------|-------|
| Task | `issues` | API routes use `/issues` |
| Home | — | Was "Dashboard" |
| Budget | `cost_events` | Was "Costs" |
| Team | — | Was "Org" |
| Discussion | `discussions` | Was "Debrief" |
| Extracted Item | `discussion_extracted_items` | Was "Brief Item" |

Goals, Agents, Company, Settings, Activity, Inbox — UI label matches DB/API name.

---

## Stack

- **Frontend:** React + Vite + TailwindCSS v4 (`ui/src/`)
- **Backend:** Express 5.x (`server/src/`)
- **Database:** PostgreSQL + Drizzle ORM (`packages/db/src/schema/`)
- **Shared types:** `packages/shared/src/`
- **Adapters:** `packages/adapters/` + `server/src/adapters/`

---

## Adapters

Registered in `server/src/adapters/registry.ts`. All agent execution is CLI-only — no direct SDK adapters.

| Type | Runtime |
|------|---------|
| `claude_local` | Claude Code CLI |
| `codex_local` | OpenAI Codex CLI |
| `cursor` | Cursor IDE |
| `opencode_local` | OpenCode CLI |
| `openclaw` | OpenClaw runtime |
| `gemini_local` | Gemini CLI |
| `hermes_local` | Hermes (uses `PAPERCLIP_RUN_ID` / `PAPERCLIP_API_KEY` wire protocol — do NOT rename to AOA_*) |
| `process` | Generic shell process |
| `http` | HTTP webhook |

API-mode adapters (`claude_api`, `openai_api`, `gemini_api`) were removed per Decision #91 and must not be re-added. The Provider SDK utilities in `server/src/services/internal-agent/providers/` remain for **embeddings + Commander only** — extraction is **CLI-only** (Decision #104, amended 2026-06-27; see Discussion Pipeline below) and no longer reaches the provider SDK. Not in the adapter registry.

---

## Architecture

### Heartbeat System

Push-based agent execution. `heartbeat.wakeup()` → HeartbeatRun → adapter executes. Agents don't pull tasks — they get told what to work on.

- **Atomic checkout:** Issues use `SELECT FOR UPDATE NO WAIT` for single-agent locking.
- **Goal status machine:** `planned → active → at_risk → achieved/cancelled` with `at_risk → active` recovery.
- **Why/What/How context:** Agents receive Vision + Mission + Goal + Memory items + Task details.
- **Agent hire approvals:** When `company.requireBoardApprovalForNewAgents` is true (default for `authenticated` mode), hires queue in Inbox. Agent created as `pending_approval`. In `local_trusted` mode new companies default to `false` (agent created `idle` directly). See `server/src/routes/agents.ts:784` and **Paperclip Divergence Points § D6** above.
- **Inbox Hub:** tab-first, no reading-pane preview. Row-click/deep-link opens and activates a dedicated tab; Home is the attention dashboard. Non-home tabs get the contextual `HubActionBar`; tabs are capped at 12 (Home + 11 closeable). `ask_founder` work questions relay on successful answer so the waiting-lane item closes. See Decision #108.
- **Concurrency clamp:** `HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT = 1` (teaching default; teams opt-up per-agent). `HEARTBEAT_MAX_CONCURRENT_RUNS_MAX = 50` (v1.1 D5 raise from 10). See **Paperclip Divergence Points § D5** above.
- **Run summary comments:** Auto-generated task comments after each heartbeat run (duration, token usage, cost, outcome, detected files). Uses `issue_comments` table. Opt-out via `runtimeConfig.autoRunSummary`. Files truncated to 10 + "+N more".

### Memory System

4-layer approval-gated memory model. Founder is sole gatekeeper for identity + domain layers.

| Layer | Scope | Lifetime |
|-------|-------|----------|
| `identity` | Company-wide | Permanent. Vision, mission, values. Sources: companies table fields + memory items with layer='identity'. |
| `domain` | Department-scoped | Semi-permanent. How we do X. |
| `active_context` | Goal/project-scoped | Temporary. `expiresAt` field. Team leads can approve for their departments. |
| `working` | Task-chain-scoped | Ephemeral. Auto-archives after 7 days (BFS chain check, max depth 50). |

**Lifecycle:** Auto-archive on goal completion, TTL-based archival (7-day working memory), expiresAt archival, 90-day staleness flagging via suggestions. Archived items can be restored. `touchAccessedAt` tracks usage.

**Memory versioning:** draft/approved/archived lifecycle. `memory_item_versions` table.

**Memory feedback:** `memory_feedback_patterns` table detects recurring founder edits on agent work. Suggests memory items after ≥3 occurrences. Grouped by agent.

**Memory write → RAG indexing:** every write path (`memory.create`, `memory.approve`, crew `write_memory`, MCP `memory.write`/`retain`/`suggest-memory`/`propose_memory_from_thread`) enqueues an embedding via `writeMemoryAndIndex` / `enqueueMemoryEmbedding` (status-agnostic, deduped). Key files: `server/src/services/memory-write.ts`. (Decision #104)

See `docs/architecture/memory.md` for UI layout, semantic retrieval configuration, and feedback detector details.

### Discussion Pipeline

Thread-based. Input modes: paste, write, voice, MCP.

Flow: Discussion entry → CLI extraction → `discussion_extracted_items` → founder approval → Tasks + Memory items.

- Polymorphic scope: department / project / goal. Entry-level scope overrides thread-level scope.
- Inline annotations on entries (anchorStart/anchorEnd character offsets).
- **Extraction engine — CLI-only (Decision #104, amended 2026-06-27):** `resolveExtractionEngine` returns `"cli"` or throws ("install a CLI and run its login"). There is no `api` engine and no hosted-key precheck — extraction never reads a provider key. The CLI engine is Option B server-side one-shot (`--print` / `exec`): no MCP bridge, no `submit_extracted_items` handshake, no Decision #100 crew-CLI blockers. Windows prompt delivery: user content is sent via **stdin** to claude (never argv), fixing empty Commander turns. The same CLI extractor serves discussion, debrief-push, file-import, and the crew memory-extract tools.
- Extraction failure: entry marked `failed`/`skipped`, founder notified via `notifications` table. Can retry or manually create. Failure type classified (`not_installed` / `not_authed` / `timeout` / `nonzero_exit` / `unparseable`) with actionable CLI-guidance copy in DiscussionDetail (never points at a key). No engine-status banner — that route + UI were removed.
- **Autonomy → dispatch (W1a/W1b/W1c):** a scope draft (`create_scope_draft`) auto-applies per thread autonomy (`thread.autonomyLevel ?? internal_agent_config.autonomyLevel`). **Manual (0)** = propose-only (founder accepts each card). **Assist (1)** = auto-create + assign the crew tasks as `planning` (non-dispatchable), then raise ONE `crew_dispatch` approval in the Inbox (`approvalService`, generic `approval_request` hub item → deep-links to `/approvals`); approving flips those tasks `planning→standard` + dispatches them, rejecting leaves them parked. **Drive (2)** = auto-create as `standard` + auto-dispatch. Every real dispatch (Drive auto + Assist-on-approve) runs `preflightCrewDispatch` (company budget hard-stop + thread pause/disable); blocked → left for manual accept (Assist approve throws + rolls back). The `crew_dispatch` approval carries only `taskIds` — memory candidates always stay founder-gated (D12). Key files: `server/src/services/thread-agent-actions.ts` (enqueue), `server/src/services/approvals.ts` (`crew_dispatch` approve/reject side-effect).

### Artifacts

Versioned deliverables: documents, presentations, code, design, reports.

- **Immutable versions.** Source-agnostic (agent/founder/MCP/teammate/external). Version numbering atomic via transactions.
- **Founder picks winner** for branching — no auto-merge. (Decisions #43, #45)
- **Agent output capture:** workspace diff → adapter hinting → founder confirmation during review. Files copied from workspace to storage, never moved. (Decision #67)
- **Artifact-as-input:** downstream tasks auto-receive artifacts from dependency tasks as context (spec→design→code→test pipelines). Content truncated at 2000 chars per artifact. (Decision #71)
- **Task Outputs:** `task_outputs` is the unified product index for artifacts, detected files, preview URLs, runtime services, branches, and PRs. It does not replace `issues.artifactId`; that field remains the primary artifact pointer for artifact-as-input and existing viewer flows.
- **Refinement loop:** review state supports adding artifact versions. Founder can refine on external LLMs and push back via MCP, upload, or paste. (Decisions #69, #70)

### Task Dependencies

`task_dependencies` table links tasks in blocking relationships. When a dependency task completes → dependent auto-unblocks. Separate from `parentId` (which is subtask hierarchy, not blocking). Tasks can be blocked from any non-terminal status: backlog, todo, in_progress.

### RBAC

Three roles: `founder`, `team_lead`, `team_member`. Department-scoped. Additive permissions from restrictive defaults.

- Team leads can approve `active_context` memory for their departments.
- Workspace authz: founder > team_lead (project-scoped) > team_member (read-only).
- `user_roles` table. `instance_user_roles` for instance-level roles. `principal_permission_grants` for fine-grained plugin grants.

### MCP (Bidirectional)

**Inbound:** `/companies/:cid/mcp` JSON-RPC endpoint. Two actor types (`server/src/mcp/server.ts:146`):
- `mcp` — caller presented a Bearer token matching an `mcp_api_keys` row
- `board` — caller has a valid board session (browser cookie in authenticated deployments, or synthetic `local-board` actor in `local_trusted` mode)

Requests with neither → 401. `local_trusted` MCP writes succeed without a Bearer token (loopback is the trust boundary). `cloud_auth` / `authenticated` deployments reject unauth'd MCP traffic.

**Outbound (AoA as MCP server) — 36 tools total, RBAC-scoped:** Read (11), Write (10), Document (5), Approval (10). Also exposes 4 MCP resources. Full tool registry: `server/src/mcp/tools/index.ts`. (Write (10) = the CRUD-write tools + `memory.write` + `ask_founder`, the blocking work_question caller; the separate `use_skill` skill tool is gated to board/commander and not counted in the RBAC-CRUD total.)

### Commander (Internal Agent)

Always-on AI assistant for coordination, proactive monitoring, and workflow management. CLI-mode execution (defaults to `claude_cli`; `codex` and `opencode` also supported). No per-company API key required. SSE streaming.

- **31 tools** across 8 categories: discussion, query, action, memory, workflow, file, coordination, analysis.
- **Per-company config** (`internal_agent_config` table): executionMode, provider, model, autonomyLevel, enabledCapabilities (12 types), budget, proactive interval.
- **Agent loop:** HTTP route → agentLoopService (conversation + user message persistence) → cliModeService (subprocess spawn + MCP bridge + stdout streaming) → SSE to UI.
- **One persistent conversation** per user per company. History summarization for token management.
- **Proactive checks:** the check functions (blocked tasks, budget thresholds, stale work, dependency gaps, memory conflicts, workload imbalance) are implemented and push to Inbox via notifications, but the periodic scheduler that runs them on an interval is **not yet wired** (the `proactiveIntervalMinutes` config exists; nothing reads it at runtime). Event-driven + chat coverage ships today; scheduled proactive scans are tracked for 1.1. (Verified 2026-07-04.)
- **Event-driven:** listens to LiveEvents (heartbeat completion, activity changes, MCP inbound, discussion entry creation) with debouncing.
- **Per-agent context mode** (`runtimeConfig.contextMode`): minimal / standard / full. Default: `standard`. Prevents token waste for simple adapters. (Decision #87)
- **Session management (UI):** multi-chat sidebar (`ui/src/components/commander/`) with pin, archive, rename, hard-delete, and **drag-to-reorder**. Manual order overrides the default date groups (TODAY/YESTERDAY/…) — the first drag collapses the non-pinned list into one flat "Arranged" list; a Reset control restores recency. Persisted via `internal_agent_conversations.sort_order` (nullable; null = recency). Routes: `PATCH …/conversations/reorder`, `DELETE …/conversations/order` — both owner-scoped (a founder viewing others' chats can't clobber their order). DnD uses dnd-kit with Mouse + Touch (long-press) + Keyboard sensors.
- **Rich input (UI):** the composer is a contenteditable (`CommanderInput.tsx`), not a textarea. `/skill` and the `+` menu insert a **colored atomic skill token** showing only the skill name; it expands to the full `use_skill` directive on send (`commanderInputModel.ts`). Hovering a token shows a details card (name + description + key). Per-kind token colors live in `--token-skill` (extensible for future @mention/file tokens).

### Workflow Templates

Backend-ready (schema + API). Ordered steps with dependencies that expand to tasks + `task_dependencies` on instantiation. Usage tracking (`instantiationCount`). Create programmatically via `POST /api/companies/:cid/workflow-templates`. UI list + step builder deferred to 1.1.

### Suggestion Engine

8 categories: goal_gap, pipeline_bottleneck, memory_gap, pattern_detected, budget_optimization, recurring_work, risk_flag, workload_balance — plus agent proposals. Runs on Home load + every 4 hours. Deduped by `actionPayload.patternId`.

### Agent Trust Score

Formula: `(approvedWithoutChanges / totalTasksCompleted) × 100`. Last 20 tasks weighted 2×. Sliding window approximation for the recent window. Auto-creates trust score row on first review. Displayed on agent cards.

### Feedback & Privacy

Thumbs-up/down on agent-authored comments (`FeedbackThumbs` in CommentThread). Routes: `POST/GET /issues/:id/feedback-votes`, `GET /issues/:id/feedback-votes/summary`, `DELETE /feedback-votes/:id`. Feedback bundles are redacted and transmitted (or written to `~/.aoa/feedback-exports/`) when `instance.feedbackDataSharingPreference === "allowed"`. See `docs/deploy/telemetry.md` for redaction pipeline, anonymization, consent settings, and plugin telemetry.

### Company Portability

Export/import full company bundles (`schemaVersion: 2`, 12 sections). Paperclip v1 bundles import compatibly (warn-and-continue for unknown sections). UI: `/export` (checkboxes + preview → JSON download) + `/import` (upload → plan → import). See `docs/api/companies.md` for the full bundle schema and section list.

### Execution Workspaces

Per-task git worktree isolation for software engineering projects. Instance-wide default: `enableIsolatedWorkspaces: true`. Gate: `functionType === "software_development"` + `executionWorkspacePolicy.defaultMode`.

- **Per-task preference:** `shared_workspace | isolated_workspace | reuse_existing` (IssueWorkspaceCard in TaskSlideOver).
- **Key files:** `ui/src/components/workspace/`, `server/src/services/workspace-runtime.ts`, `packages/db/src/schema/execution_workspaces.ts`.
- See `docs/guides/board-operator/execution-workspaces.md` for the full guide (close flow, TTL sweeper, IDE integration, Create PR).

### Marketplace

- **Catalog:** sourced from `https://meteoritelabs.github.io/aoa-marketplace-cdn/catalog.json`. Schema mirror in `packages/shared/src/marketplace.ts` — bumps require coordinated changes in both repos; AoA-side code must handle new fields being absent. Build-time snapshot fallback: `ui/src/aoa-marketplace-snapshot.json` (generated by `pnpm fetch-catalog`). (Decision #96)
- **Packages:** synthetic groupings derived server-side via `derivePackages()` in `server/src/services/derivePackages.ts`. Grouped by `owner/repo` from `source.url` (threshold ≥ 2, skill items only). `packageId` field overrides synthesis. (Decision #97)
- **Card chrome + Hub layout:** locked in `docs/architecture/design-system.md` §9.13–9.18.
- **Key files:** `ui/src/components/marketplace/`, `ui/src/lib/marketplace-constants.ts`, `ui/src/pages/Marketplace*.tsx`, `server/src/services/derivePackages.ts`, `packages/shared/src/marketplace.ts`.

### LobbyShell & Settings Chrome

`LobbyShell` (`ui/src/components/LobbyShell.tsx`): shared chrome for pre-company-selection pages (Lobby, Marketplace, Settings). Exposes a `secondarySidebar` slot rendered flush between primary sidebar and content. Auto-collapse rule: `defaultCollapsed={true}` only when a secondary sidebar is present — Settings is the only current consumer (Decision #98). Mobile sub-nav pattern: design-system §8.6. Key files: `ui/src/components/LobbyShell.tsx`, `ui/src/components/LobbySidebar.tsx`, `ui/src/components/SecondarySidebar.tsx`.

### Global Search

PostgreSQL full-text search (tsvector/tsquery). cmd+K. RBAC-scoped. Results grouped by entity type.

### Voice Input

Browser recording → Whisper API transcription → Discussion pipeline. Third input mode alongside paste and write.

### Context Packaging

"Open in [LLM]" assembles 8-section markdown context: company identity + department/project + goal + dependencies + task details + artifacts + agent config + preferences. Token estimate: `ceil(markdown.length / 4)`. 8000-token warning threshold.

### Distribution

Docker + NPM release pipeline. SemVer (0.1.0+). Multi-arch (amd64+arm64) to GHCR; `@armyofagents/*` packages to npmjs.org. Smoke-tested on each stable release. See `docs/deploy/distribution.md` for the full runbook (Changesets flow, rollback, local Docker testing).

### CI Platform Status

**Triggers (2026-06-24 redesign):**

- `pr.yml` (the gate suite) runs on **every** pull request — no base-branch
  filter — plus `push` to `main`. Required checks: `verify`, `e2e`,
  `migrations`, `policy`, `brand-check`. Cross-platform lanes stay advisory.
- **Draft PRs are gated:** each `pr.yml` job carries
  `if: ${{ github.event_name != 'pull_request' || !github.event.pull_request.draft }}`,
  and the `pull_request` trigger lists `ready_for_review`. Draft PRs show the
  gate jobs as `skipped`; marking a PR ready re-runs them for real before merge.
  (Safe despite skip-as-success: drafts can't be merged, and `ready_for_review`
  re-runs the jobs. Do NOT add `edited` to chase retarget re-runs — on a
  *mergeable* PR a title/body edit would skip the required jobs into a success
  and bypass branch protection. Retarget + `paths-ignore` need the aggregator
  gate pattern, tracked for 1.1.)
- `release.yml` / `docker.yml` run on `push` to `main` (Docker also on `v*`
  tags). The porting-era branch allow-list is gone.
- Do NOT re-introduce a `branches:` filter on `pr.yml`'s `pull_request` trigger
  (it silently ran zero checks on stacked/feature PRs), and do NOT add a
  `paths:`/`paths-ignore:` filter to `pr.yml` (a skipped required check leaves
  PRs stuck on "Expected — Waiting for status").
- **Single required check (Phase 1.1):** branch protection requires only
  `ci-required` — an always-running (`if: !cancelled()`) aggregator that computes
  pass/fail from `needs.*.result` + `changes.outputs.code`. The heavy jobs
  (`verify`/`e2e`/`migrations` + cross-platform) are non-required and **skip on
  docs-only PRs** (every changed file under `docs/` or a root-level `*.md` like
  README/CLAUDE/AGENTS), detected by the `changes` job (`--no-renames`; nested
  `*.md` such as runtime prompt assets count as code). Drafts skip all real jobs and `ci-required`
  goes red (zero CI; honest "not validated"). Do NOT make an individual job a
  required check again, and do NOT add a `paths-ignore` trigger filter — route
  conditional execution through `ci-required` (a skipped required check passes
  silently; the aggregator computes the verdict instead). Required human review
  + CODEOWNERS are deferred until a second committer with write access exists.

| Platform | Verify | E2E |
|----------|--------|-----|
| Linux | Required gate | Required gate |
| macOS | Advisory (green) | Advisory (green) |
| Windows | Advisory (4 tests skipped — Issues #113/#127) | Skipped — embedded-postgres can't start on `runneradmin` runner (Issue #114) |

Windows e2e skip is implemented at playwright config level (`tests/e2e/playwright.config.ts`).

**CDN fallback:** The required Linux `e2e` job uses a Google Chrome-for-Testing download when `cdn.playwright.dev` stalls (configured in `.github/workflows/pr.yml`). The advisory `e2e-cross-platform` macOS/Windows lanes do NOT use that fallback — they still rely on the default Playwright CDN and time out at 12 min if the CDN stalls. Generalizing the Google-storage fallback to mac/win lanes is tracked for 1.1.

---

## Database Schema

All table definitions in `packages/db/src/schema/` (93 files). Schema changes use Drizzle ORM only — never raw SQL.

### Core / Company

| Table | Purpose |
|-------|---------|
| `companies` | Company config. Key fields: `requireBoardApprovalForNewAgents`, `enableIsolatedWorkspaces`, `feedbackDataSharingPreference` |
| `company_memberships` | User ↔ company membership |
| `company_secrets` | Encrypted secrets per company. Includes `github_pat` for workspace PR creation |
| `company_secret_versions` | Secret rotation history |
| `projects` | Departments AND projects. `type`: `'department'` \| `'project'` |
| `goals` | Company goals. Status: planned → active → at_risk → achieved/cancelled |
| `issues` | Tasks. `parentId` = subtask hierarchy. `artifactId` = linked deliverable |
| `task_dependencies` | Blocking relationships between tasks |
| `issue_comments` | Task comments. Also used for heartbeat run summary comments |
| `issue_labels`, `labels` | Task labeling |
| `issue_attachments` | File attachments on tasks |
| `issue_read_states` | Per-user read state on tasks |
| `issue_approvals` | Approval linkage on tasks |
| `issue_documents` | Document linkage on tasks |
| `activity_log` | Full audit trail |
| `routines` | Scheduled/trigger-based automation |
| `sidebar_preferences` | Per-user sidebar collapse state |
| `inbox_dismissals` | Dismissed inbox items |

### Agents

| Table | Purpose |
|-------|---------|
| `agents` | Agent definitions. `adapterType`, `adapterConfig`, `runtimeConfig` (contextMode, autoRunSummary) |
| `agent_projects` | Agent ↔ project (department) assignments |
| `agent_config_revisions` | Config version history |
| `agent_runtime_state` | Current runtime state |
| `agent_task_sessions` | Per-task execution sessions |
| `agent_wakeup_requests` | Queued wakeup triggers |
| `agent_api_keys` | Per-agent API keys |
| `agent_trust_scores` | Trust score: (approvedWithoutChanges/totalCompleted)×100, last 20 tasks weighted 2× |
| `heartbeat_runs` | Heartbeat execution records |
| `heartbeat_run_events` | Per-event log within a heartbeat run |
| `heartbeat_run_watchdog_decisions` | Watchdog intervention records |

### Memory

| Table | Purpose |
|-------|---------|
| `memory_items` | Core memory store. `layer`: identity/domain/active_context/working. `expiresAt`, `goalId`, `sourceArtifactId`, `embedding` (vector 1536) |
| `memory_item_versions` | Version history. draft/approved/archived lifecycle |
| `memory_feedback_patterns` | Recurring edit patterns. `patternType`, `occurrenceCount`, `status` |
| `memory_folders` | Folder organization for memory items |
| `memory_relations` | Relationships between memory items |
| `memory_retrievals` | Retrieval history for staleness detection |
| `memory_assets` | File assets attached to memory items |
| `memory_extractions` | LLM extraction records |
| `memory_extraction_batches` | Batch extraction records |

### Discussions

| Table | Purpose |
|-------|---------|
| `discussions` | Thread container. Polymorphic scope (department/project/goal). `status`: active/archived. Denormalized `entryCount`, `pendingItemCount` |
| `discussion_entries` | Individual entries. `inputType`: paste/write/voice/mcp. `extractionStatus`. Entry-level scope override |
| `discussion_extracted_items` | Extracted items: decision/task/insight/context/reference/preference. Approval workflow. `resultTaskId`, `resultMemoryId` |
| `discussion_annotations` | Inline annotations. `anchorStart`/`anchorEnd` character offsets |
| `debriefs` | @deprecated — kept for rollback safety. New code uses `discussions` |
| `briefs` | @deprecated — kept for rollback safety. New code uses `discussions` |
| `brief_items` | @deprecated — replaced by `discussion_extracted_items` |

### Artifacts & Documents

| Table | Purpose |
|-------|---------|
| `artifacts` | `type`: document/presentation/code/design/report/other. `status`: draft/active/archived. `currentVersionId` |
| `artifact_versions` | Immutable. `versionNumber`, `source` (agent/founder/mcp/teammate/external), `parentVersionId` (branching) |
| `task_outputs` | Additive task-level output index for artifacts, detected files, preview URLs, runtime services, branches, and PRs. Does not replace `issues.artifactId` |
| `documents` | Document system (separate from artifacts; MCP document tools map here) |
| `document_revisions` | Document revision history |
| `assets` | File assets. All file types, 50MB limit |

### Workspaces

| Table | Purpose |
|-------|---------|
| `execution_workspaces` | Per-task git worktrees. `metadata.config` snapshot, `metadata.pr`. Linked to issues |
| `project_workspaces` | Project-level workspace config |
| `workspace_operations` | Workspace lifecycle operations log |
| `workspace_runtime_services` | Dev server service definitions per workspace |

### Commander (Internal Agent)

| Table | Purpose |
|-------|---------|
| `internal_agent_config` | Per-company: executionMode, provider, model, autonomyLevel, enabledCapabilities (12 types), budget, proactive interval |
| `internal_agent_conversations` | Multi-chat per user per company. `summarizedContext` for token management. `pinned` (sidebar pin), `sortOrder` (nullable manual drag-order; null = recency/date groups), `archivedAt` |
| `internal_agent_messages` | `role`: user/assistant/system/tool_call/tool_result. `toolCalls`/`toolResults` JSON. `pageContext`, `departmentContext` |
| `internal_agent_runs` | `triggerType`: conversation/proactive/event/sub_agent. `toolsCalled`, `tokenUsage`, `costCents` |
| `internal_agent_reminders` | Scheduled reminders. `triggerAt`, `status`: pending/fired/cancelled |
| `workflow_templates` | Reusable task chains. `steps` (JSON ordered array), `dependencies` (JSON fromStep/toStep), `instantiationCount` |
| `notifications` | `type`: discussion.extraction_complete/failed, internal_agent.reminder/proactive/action_result. `readAt`, `dismissedAt` |

### Teams

| Table | Purpose |
|-------|---------|
| `teams` | Team definitions. `manifest`, `slug`, `status` |
| `team_members` | Team membership |
| `team_coordinations` | Coordination records |

### Marketplace

| Table | Purpose |
|-------|---------|
| `marketplace_catalog_cache` | CDN catalog cache |
| `marketplace_company_settings` | Per-company marketplace settings |
| `marketplace_install_operations` | Installation operation records |
| `marketplace_pending_updates` | Pending catalog updates |

### Plugins

| Table | Purpose |
|-------|---------|
| `plugins` | Plugin definitions |
| `plugin_config` | Plugin configuration |
| `plugin_entities` | Plugin-owned entities |
| `plugin_state` | Plugin runtime state |
| `plugin_jobs` | Async plugin job queue |
| `plugin_logs` | Plugin execution logs |
| `plugin_webhooks` | Plugin webhook registrations |
| `plugin_version_snapshots` | Plugin version history |
| `plugin_company_settings` | Per-company plugin settings |
| `principal_permission_grants` | Fine-grained permission grants (plugin RBAC) |

### Finance & Budget

| Table | Purpose |
|-------|---------|
| `cost_events` | Per-agent/per-run cost records |
| `budget_policies` | Company/department budget limits |
| `budget_incidents` | Budget threshold breach events |
| `finance_events` | Financial events with cost-event slug linkage |
| `provider_quota_windows` | Provider API quota tracking (composite-key UPSERT + staleness warning) |

### Auth & Security

| Table | Purpose |
|-------|---------|
| `auth` | User authentication records |
| `invites` | Company invitations |
| `join_requests` | Join request workflow |
| `user_roles` | RBAC: `founder`/`team_lead`/`team_member`, department-scoped |
| `instance_user_roles` | Instance-level roles |
| `board_api_keys` | Board-level API keys |
| `mcp_api_keys` | MCP authentication keys |
| `mcp_client_connections` | MCP client connection records |
| `cli_auth_challenges` | CLI authentication challenges |

### Feedback

| Table | Purpose |
|-------|---------|
| `feedback_votes` | Thumbs up/down on agent-authored comments |
| `feedback_exports` | Exported feedback bundles (for telemetry transmission) |

### File & Import

| Table | Purpose |
|-------|---------|
| `file_import_jobs` | Background file import job tracking |
| `embedding_queue` | Write-behind outbox for pgvector embeddings. Key columns: `company_id` (per-company key resolution), `next_retry_at` (backoff persistence), `status` (pending/processing/failed). Worker uses `FOR UPDATE SKIP LOCKED`; per-company circuit breaker leaves rows `pending` on systemic key errors. `AOA_E2E_FAKE_EMBEDDER=1` substitutes a hash-based embedder at the `createOpenAiEmbedder` chokepoint for CI. |
| `approvals`, `approval_comments` | Approval workflow |
| `suggestions` | Suggestion engine output. `category` (8 types + agent_proposal), `actionPayload`, `evidence`, `status` |

---

## Workspace System

- **Route:** `/:companyPrefix/workspaces/:workspaceId` → `WorkspaceView` page
- **Layout:** `WorkspaceLayout` — 3-panel resizable (task nav | timeline+preview | context)
- **Mobile:** Tab-based navigation [Tasks][Timeline][Preview][Context] using CSS hidden (not conditional render)
- **functionType:** Project field (`software_development` | `design` | `marketing` | etc.) controls workspace tool visibility
- **executionWorkspacePolicy:** Project field (`per_task` | `shared` | `none`) controls workspace creation
- **TaskSlideOver:** Right-side Sheet — standard (task detail) and workspace (embedded timeline) modes
- **Lifecycle:** Archived workspaces shown in collapsed section
- **Key files:** `ui/src/components/workspace/`, `server/src/services/workspace-runtime.ts`, `packages/db/src/schema/execution_workspaces.ts`

---

## Test Patterns

Tests in `server/src/__tests__/`. Drizzle-orm ESM cycle workaround:

- **Pure function tests:** Import and test directly (e.g., `formatRunSummary`, `detectToneCorrections`, `computeScore`).
- **Service tests with mocks:** Mock `@armyofagents/db` and `drizzle-orm` with Proxy-based table stubs and no-op operators. Use sequence-based mock DBs (`createSequenceDb`) — each `select`/`update`/`insert` returns the next pre-configured result.
- **Contract tests:** Verify API shapes, constants, and formulas without importing drizzle internals.
- **QA suites:** `v2-memory-qa.test.ts`, `v2-artifacts-qa.test.ts`, `v2-integration-qa.test.ts`, `v2-edge-cases-qa.test.ts`, `v2-performance-qa.test.ts`.

---

## Sidebar Structure

```
+ New Task / + Discussion
Home, Inbox
WORK: Discussions, Tasks, Agents, Goals
DEPARTMENTS: [list] + New
PROJECTS: [list] + New
TEAM
COMPANY: Vision & Mission, Memory, Budget, Activity, Settings
```

---

## File Structure

```
packages/db/src/schema/    → Drizzle table definitions (93 files)
packages/shared/src/       → Types, validators, constants
server/src/services/       → Business logic (one file per domain)
server/src/routes/         → Express route handlers (65+ files)
server/src/adapters/       → Agent execution adapters + registry
server/src/mcp/            → MCP server implementation
server/src/onboarding-assets/ → Agent onboarding templates (cxo/, lead/, default/)
ui/src/components/         → React components
ui/src/pages/              → Page-level components
ui/src/api/                → API client functions
ui/src/lib/                → Shared utilities + constants
```

---

## Documentation Reference

| Location | Purpose |
|----------|---------|
| `docs/architecture/decisions.md` | **Read before making any architectural change.** 90+ locked decisions. |
| `docs/architecture/design-system.md` | Visual design system — colors, typography, component patterns |
| `docs/architecture/memory.md` | Memory UI layout, semantic retrieval config, feedback detector details |
| `docs/architecture/wire-compat.md` | Wire protocol compatibility tracking |
| `docs/architecture/workspace-decisions.md` | Workspace-specific architectural decisions |
| `docs/api/` | REST API endpoint reference (per-domain) — includes `mcp.md` (34 MCP tools + 4 resources), `discussions.md`, `workflow-templates.md` |
| `docs/adapters/` | Adapter authoring guide + per-adapter reference |
| `docs/deploy/` | Deployment modes, env vars, database, Docker, distribution, telemetry |
| `docs/guides/board-operator/` | How-tos for founders and team leads |
| `docs/guides/agent-developer/` | Heartbeat protocol, skill authoring, cost reporting |
| `docs/start/` | What is AoA, quickstart, core concepts |
| `docs/cli/` | CLI command reference |
| `docs/roadmap.md` | Planned features — NOT current behavior |
| `docs/STANDARDS.md` | Documentation lifecycle and session log extraction rules |
| `docs/paperclip-migration.md` | Paperclip→AoA tracking: wire protocol, deprecated tables, removed adapters |
| `docs/archive/` | Historical session logs, shipped plans, retired specs — not authoritative |
