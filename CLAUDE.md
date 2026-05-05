# AoA (Army of Agents)

> **Version status:** v1.0.0 (stable). Sprint 4 regression closed 2026-04-24.

Hybrid Workforce Operating System for solo founders. Built on Paperclip (open-source AI agent orchestration). Founder manages AI agents + humans from a single control room.

## Stack

- **Frontend:** React + Vite + TailwindCSS (`ui/src/`)
- **Backend:** Express 5.x framework (`server/src/`)
- **Database:** PostgreSQL + Drizzle ORM (`packages/db/src/schema/`)
- **Shared types:** `packages/shared/src/`
- **Adapters:** `packages/adapters/` + `server/src/adapters/`

## Critical Rules

1. **Drizzle ORM only.** Schema changes go in `packages/db/src/schema/`. Run `pnpm db:generate` for migrations. NEVER write raw SQL migration files.
2. **Follow existing patterns.** New services follow `server/src/services/goals.ts`. New routes follow `server/src/routes/goals.ts`. New schemas follow `packages/db/src/schema/goals.ts`.
3. **"Issues" = "Tasks" in UI only.** The DB table is `issues`. The API routes use `/issues`. But all user-facing text says "Task" / "Tasks". Never rename the table or routes.
4. **"Projects" table serves both Departments and Projects.** Distinguished by `type` field: `'department'` | `'project'`. Same mechanics for both.
5. **MCP inbound with authenticated write permission may create tasks directly.** `debrief-push` remains for unstructured content requiring extraction. Anonymous MCP input must route through Discussion. (Decision #14, revised 2026-04-21)
6. **Agents cannot write to Memory directly.** They can suggest items (status: 'pending'), but only the founder can approve identity + domain layers. V2: team leads can additionally approve active_context for their departments. Working memory is auto-created. (Decisions #15, #52)
7. **Artifact versions are immutable.** Once created, never modified. Changes = new version. Founder picks winner for branching — no auto-merge. (Decisions #43, #45)
8. **Memory feedback requires ≥3 occurrences.** Don't suggest memory from one-off edits. Pattern must be consistent. (Decision #46)
9. **Discussion scope fallback: item-level > entry-level > discussion-level > null.** Founder's per-item override always wins. (Decision #61)
10. **Consult `docs/aoa/reference/decisions.md` before making architectural choices.** 90 locked decisions exist. Don't relitigate.

## Naming Map (Paperclip → AoA)

| Paperclip UI | AoA UI | DB/API unchanged |
|-------------|--------|------------------|
| Issue | Task | `issues` table |
| Dashboard | Home | routes |
| Costs | Budget | `cost_events` table |
| Org | Team | routes |
| Debrief | Discussion | `discussions` table |
| Brief Item | Extracted Item | `discussion_extracted_items` table |

Goals, Agents, Company, Settings, Activity, Inbox — unchanged.

## Key Architecture (V1)

- **Heartbeat system:** Push-based agent execution. `heartbeat.wakeup()` → HeartbeatRun → adapter executes. Agents don't pull tasks — they get told what to work on.
- **Atomic checkout:** Issues use `SELECT FOR UPDATE NO WAIT` for single-agent locking.
- **Adapters:** claude_local, opencode_local, openclaw, http, process, cursor, codex_local, hermes_local, gemini_local. Registered in `server/src/adapters/registry.ts`. Sprint 2A (Decision #91) removed the API-mode adapters (claude_api, openai_api, gemini_api) — agent execution is CLI-only.
- **Provider SDK util (`server/src/services/internal-agent/providers/`):** Internal Anthropic/OpenAI/Google SDK wrappers kept for extraction + embedding generation only. Not exposed via the adapter registry. Extraction will migrate to a sub-agent CLI task when the team-under-Commander architecture lands.
- **Discussion pipeline (V2.5):** Thread-based discussions replace Debrief/Brief. Input modes: paste, write, voice, MCP. Each entry → LLM extraction → `discussion_extracted_items` → founder approval → Tasks + Memory items. Entry-level scope overrides thread-level scope.
- **Memory (V1):** Flat company knowledge store. Categories: decision, reference, context, insight, preference. Approval-gated. Founder is sole gatekeeper.
- **Task dependencies:** `task_dependencies` table links tasks in blocking relationships. When a dependency task completes → dependent auto-unblocks. Separate from `parentId` (which is subtask hierarchy, not blocking). Tasks can be blocked from any non-terminal status (backlog, todo, in_progress).
- **Why/What/How:** Agents receive context package: Vision + Mission + Goal + Memory items + Task details.
- **Goal status machine:** `planned → active → at_risk → achieved/cancelled` with `at_risk → active` recovery.
- **Department deletion:** Blocked if tasks or goals exist. Must reassign first. Memory items become unscoped.
- **Extraction failure:** Discussion entry marked `failed`, founder notified via `notifications` table. Can retry or manually create.
- **Agent hire approvals:** When `company.requireBoardApprovalForNewAgents` is true (default), agent hires go through the approval queue — the agent is created in `pending_approval` status and a `hire_agent` approval request lands in the Inbox. Nothing is auto-approved, including in `local_trusted` mode: the synthetic `local-board` actor is the lone approver and must click through the Inbox just like a real-user cloud deployment. Set `requireBoardApprovalForNewAgents: false` on the company row to skip the gate (agent is created `idle` directly). (See `server/src/routes/agents.ts:784`.)
- **MCP inbound auth is deployment-mode-gated.** The `/companies/:cid/mcp` JSON-RPC endpoint accepts two actor types (`server/src/mcp/server.ts:146`): `mcp` (when the caller presented a Bearer token matching an `mcp_api_keys` row) and `board` (when the caller has a valid board session — i.e. the browser-board cookie in authenticated deployments, or the synthetic `local-board` actor attached automatically in `local_trusted` mode). Requests with neither are 401. This means **`local_trusted` MCP writes succeed without a Bearer token** (loopback is the trust boundary) while `cloud_auth` / `authenticated` deployments reject unauth'd MCP traffic. The MCP API keys UI is the correct call site when external clients need to authenticate — not when the host binary itself is calling.

## V2 Architecture (Implemented)

V2 adds four pillars: **Intelligence**, **Team**, **Artifacts**, **Integration**. All features below are implemented and tested.

- **Layered Memory (4 layers):** [IMPLEMENTED — S8-S10, S23-S24]
  - `identity` — permanent, always included (vision, mission, company values). Sources: companies table fields + memory items with layer='identity'.
  - `domain` — department-scoped, semi-permanent (how we do X).
  - `active_context` — goal/project-scoped, temporary with `expiresAt`. Team leads can approve for their departments.
  - `working` — task-chain-scoped, ephemeral. Auto-archives (not deletes) after 7 days.
  - Memory versioning: draft/approved/archived lifecycle with version history. `memory_item_versions` table.
  - Memory lifecycle: auto-archive on goal completion, TTL-based working memory archival (7-day BFS chain check, max depth 50), expiresAt archival, 90-day staleness flagging via suggestions.
  - Restore: archived items can be unarchived. `touchAccessedAt` tracks usage for staleness detection.
- **Semantic retrieval:** [IMPLEMENTED — S11-S12] pgvector extension, 1536-dimension embeddings (OpenAI text-embedding-3-small), cosine similarity. IVFFlat/HNSW indexes. <100ms for 10K items. Fallback to ilike text search when no API key. Similarity threshold: 0.85 (cosine), 0.6 (word overlap). Background `processEmbeddingQueue` worker with batch processing (10 items/run) and exponential backoff retry (3 attempts).
- **Artifacts:** [IMPLEMENTED — S4-S7] Versioned deliverables (documents, presentations, code). `artifacts` table + `artifact_versions` table. Versions are immutable. Source-agnostic (agent, founder, MCP, teammate, external). Founder picks winner for branching — no auto-merge. Version numbering is atomic via transactions.
- **Agent output capture:** [IMPLEMENTED] 3-step pipeline — workspace diff → adapter hinting → founder confirmation during review. Files copied from workspace to storage, never moved. (Decision #67)
- **Artifact-as-input:** [IMPLEMENTED — S20] Downstream tasks auto-receive artifacts from dependency tasks as context. Enables spec→design→code→test pipelines. Context packaging includes artifacts from current task + dependency tasks, with content truncated at 2000 chars. (Decision #71)
- **Refinement loop:** [IMPLEMENTED] Review state supports adding artifact versions (not just approve/reject). Founder can refine on external LLMs and push back via MCP, upload, or paste. (Decisions #69, #70)
- **Suggestion engine:** [IMPLEMENTED — S16-S17] 8 categories (goal_gap, pipeline_bottleneck, memory_gap, pattern_detected, budget_optimization, recurring_work, risk_flag, workload_balance) + agent proposals. Runs on Home load + every 4 hours. Suggestions deduped by actionPayload.patternId.
- **Feedback loops:** [IMPLEMENTED — S13] `memory_feedback_patterns` table detects recurring founder edits on agent work. 4 detector types: tone_correction, format_change, content_addition, terminology_change. Suggests memory items after ≥3 occurrences. Grouped by agent.
- **Agent trust score:** [IMPLEMENTED — S18-S19] `(approvedWithoutChanges / totalTasksCompleted) × 100`, last 20 tasks weighted 2x. Sliding window approximation for the recent window. Auto-creates trust score row on first review. Displayed on agent cards.
- **RBAC:** [IMPLEMENTED — S25-S27] Three roles: `founder`, `team_lead`, `team_member`. Department-scoped. Additive from restrictive defaults. Team leads can approve active_context for their departments.
- **MCP bidirectional:** V1 inbound routed to Discussion. V2 exposes full AoA-as-MCP-server. Read tools (9): me, list-agents, get-agent, list-projects, get-project, list-tasks, get-heartbeat-context, list-task-comments, get-task-comment — plus 4 read resources (tasks, goals, memory, artifacts). Write tools (7): create-task, update-task, add-task-comment, attach-artifact-version, suggest-memory, debrief-push, update-task-status. Document tools (5, mapped to artifacts): upsert-task-document, list-task-documents, get-task-document, list-task-document-revisions, restore-task-document-revision. Approval tools (10): list-approvals, get-approval, get-approval-tasks, list-approval-comments, list-task-approvals, create-approval, approval-decision, add-approval-comment, link-task-approval, unlink-task-approval. 31 tools total. RBAC-scoped per user. (Decision #14 revised — direct task creation allowed with authenticated write permission)
- **Global search:** [IMPLEMENTED — S28] PostgreSQL full-text search (tsvector/tsquery), cmd+K, RBAC-scoped, results grouped by entity type.
- **Voice input:** [IMPLEMENTED — S21] Browser recording → Whisper API transcription → enters Discussion pipeline. Third input mode alongside paste and write.
- **Context packaging:** [IMPLEMENTED — S20] "Open in [LLM]" button assembles 8-section markdown context (company identity + department/project + goal + dependencies + task details + artifacts + agent config + preferences). Token estimate: ceil(markdown.length / 4). 8000-token warning threshold.
- **Per-agent context mode:** [IMPLEMENTED — Decision #87] Three levels (minimal/standard/full) control how much context each agent receives. Stored in `runtimeConfig.contextMode`. Default: `standard`. Prevents token waste for simple adapters.
- **Run summary comments:** [IMPLEMENTED — S22, Decision #88] Auto-generated task comments after each heartbeat run showing duration, token usage, cost, outcome, and detected files. Uses existing `issue_comments` table. Opt-out via `runtimeConfig.autoRunSummary`. Files truncated to 10 shown + "+N more".
- **Company portability:** [IMPLEMENTED — Phase E.1 + E.2] Export/import full company bundles at Paperclip parity plus AoA-only extensions. Bundle `schemaVersion: 2` covers 12 sections: company, agents, projects (departments + projects), issues/tasks, skills (with file inventory + source tracking), routines (triggers + variables), envInputs, plus AoA-only `internalAgentConfig` (default ON), `budgetPolicies`, `costEvents` (high-volume opt-in with 10K warning + date-range filter), `financeEvents` (with cost-event slug linkage), `quotaWindows` (composite-key UPSERT + staleness warning). All E.2 sections default OFF except `internalAgentConfig`. `POST /:companyId/export/preview` returns counts + file list + size estimate before building. README.md generated per export. Unknown bundle sections warn-and-continue — v1 Paperclip bundles import compatibly. UI: `/export` (entity checkboxes with "Budget & Finance" grouping + inline amber volume warning on Cost Events → preview → JSON download) + `/import` (upload → preview plan + bundle-derived count grid → collision strategy → import). Deferred: D1 (memory/artifacts/workflows) → Phase E.3; goals + budget incidents + ZIP + URL/GitHub imports + date-range picker UI → Phase I.
- **Feedback + privacy:** [IMPLEMENTED — Phase F] Thumbs-up/down on agent-authored comments (`FeedbackThumbs` in CommentThread via TaskSlideOver). Vote-capture UPSERT on `UNIQUE(companyId, targetType, targetId, authorUserId)`; downvote-only reason. Routes at `/issues/:id/feedback-votes` (POST/GET) + `/issues/:id/feedback-votes/summary` + `DELETE /feedback-votes/:id`. When `instance.feedbackDataSharingPreference === "allowed"`, fire-and-forget bundle build writes to `~/.aoa/feedback-exports/<exportId>-<stamp>.json.gz` (local stub; HTTP transmission deferred to Phase I/product). Bundle envelope matches Paperclip `buildPayloadArtifacts` shape: `{schemaVersion, bundleVersion, vote, target, exportId, bundle: {primaryContent, issueContext ±3 comments, agentContext}, redactionSummary}`. Redaction service: 9 regex patterns (email / API keys / JWTs / PEM blocks / phone / GitHub tokens / DSN / etc.) + `FeedbackRedactionState`. Anonymization pure function (`{kind}_{sha256(pepper:kind:value).slice(0,16)}`) ready for transmission wire-up. Consent modal (3 options: Always allow / Don't allow / Ask each time) shown when preference is `prompt`. PrivacyTab shows last 3 bundles (exportId + timestamp + size). Plugin SDK ships `ctx.telemetry.track(event, dims)` gated by `PLUGIN_CAPABILITIES["telemetry.track"]`. Transmission destination configured via `AOA_FEEDBACK_ENDPOINT` env var + optional `AOA_FEEDBACK_API_KEY` Bearer auth; see [`docs/deploy/telemetry.md`](docs/deploy/telemetry.md). Vote bundles flow through `shareFeedbackBundle` (HTTP primary, local-fs fallback on non-2xx/network fail → votes never lost); plugin telemetry fires-and-forgets a `{kind:"plugin_telemetry",event,dims,timestamp}` envelope. Local-only fallback (prior F.3/F.4 stub) when env unset. Deferred to Phase I: per-vote "just this time" consent, thumbs on artifact versions / plugin outputs / discussion items, "view all bundles" admin page, feedback aggregation analytics.
- **Execution Workspaces:** [IMPLEMENTED — Phase I worktree] Per-task git worktree isolation for engineering projects. Enabled instance-wide by default (`enableIsolatedWorkspaces: true`). Project gate: `functionType === "software_development"` + `executionWorkspacePolicy.defaultMode`. Per-task preference: `shared_workspace | isolated_workspace | reuse_existing` selectable via IssueWorkspaceCard in TaskSlideOver. Heartbeat short-circuits `realizeExecutionWorkspace` on reuse. Persists `metadata.config` snapshot (provisionCommand/teardownCommand/cleanupCommand/workspaceRuntime) for restart continuity. Close flow uses AlertDialog with 7 close-action kinds (archive_record, stop_runtime_services, cleanup_command, teardown_command, git_worktree_remove, git_branch_delete, remove_local_directory); blocks archive on active linked issues + dirty git. Runtime service control (start/stop/restart dev servers) via ServicesSection in WorkspaceRightPanel, gated to `software_development` functionType. `restartDesiredRuntimeServicesOnStartup` auto-resumes services after server crash. TTL sweeper (`enableWorkspaceTtlSweeper`) marks workspaces with `ttlDays` past `lastUsedAt` as `cleanupEligibleAt` — does NOT auto-archive. Settings Sheet via kebab (Configuration / Runtime Logs / Linked Issues). `/workspaces` company-wide list under WORK sidebar. Open in IDE (VS Code / Cursor / Zed) + Reveal in Finder via `filesystemApi.reveal`; preference in `localStorage["aoa:workspace:preferred-editor"]`. Create PR via GitHub PAT per-company (stored in `company_secrets` as `github_pat`); GitPanel button wired to CreatePrDialog, PR persisted to `workspace.metadata.pr` + task comment posted. Role-based authz: founder > team_lead (project-scoped) > team_member (read-only). New tables: none (schema parity with Paperclip achieved in earlier phases). See [`docs/guides/board-operator/execution-workspaces.md`](docs/guides/board-operator/execution-workspaces.md) for the user-facing guide. (Decision: Phase I worktree scope 2026-04-23.)
- **Distribution:** [IMPLEMENTED — Phase H] Docker + NPM release pipeline. Versioning: SemVer (0.1.0+ pre-1.0 evolving); first release 0.1.0. Releases via Changesets (`.changeset/*.md` → Release PR → merge → npm publish via `changesets/action` → `docker.yml` multi-arch build (amd64+arm64) to `ghcr.io/${{ github.repository }}` → `release-smoke.yml` Playwright auth-onboarding smoke against freshly-published image, gated on `changesets/action` `published == 'true'`). Rollback: `pnpm release:rollback` (npm deprecate + tag delete + optional commit revert, 3-step, `--dry-run`/`--self-test` flags). Dockerfile hardened with gosu + USER_UID/USER_GID runtime remap (non-root container). `docker-onboard-smoke.sh` (303 LOC) handles auto-bootstrap (sign-up → sign-in → bootstrap-ceo invite → session verify) + `SMOKE_DETACH` + `$GITHUB_ENV` metadata for CI. Secrets: `NPM_TOKEN` (Automation type). 4 workflows: `pr.yml` / `release.yml` / `docker.yml` / `release-smoke.yml`. `embedded-postgres@18.1.0-beta.16` patched for `LC_MESSAGES=C` + `process.env` propagation in container `initdb`/`postgres` spawns. Full release runbook + decision locks + secrets setup in [`docs/deploy/distribution.md`](docs/deploy/distribution.md). Deferred to Phase I: `anthropic/aoa` rename (image destination auto-resolves via `${{ github.repository }}`), canary-on-push auto-wiring, desktop installer, expanded smoke coverage (discussions, MCP, budgets, artifacts).

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

## File Structure

```
packages/db/src/schema/    → Drizzle table definitions
packages/shared/src/       → Types, validators, constants
server/src/services/       → Business logic (one file per domain)
server/src/routes/         → Express route handlers
server/src/adapters/       → Agent execution adapters
ui/src/components/         → React components
ui/src/pages/              → Page-level components
ui/src/api/                → API client functions
```

## V2.5 Architecture (Implemented)

V2.5 replaces the Debrief/Brief pipeline with **Discussions** and adds the **Internal Agent** — an always-on AI assistant for coordination, proactive monitoring, and workflow management.

- **Discussions:** Thread-based discussions with multiple entries (paste/write/voice/MCP). Each entry is independently extracted into decisions, tasks, insights, context, references, preferences. Polymorphic scope (department/project/goal) with entry-level overrides. Inline annotations on entries. Replaces V1 Debrief → Brief flow entirely.
- **Internal Agent ("Commander"):** Always-on AI assistant with 30 tools across 8 categories (discussion, query, action, memory, workflow, file, coordination, analysis). **CLI-mode execution** (defaults to `claude_cli`; `codex` and `opencode` also supported) — no per-company API key required. SSE streaming responses. Per-company config with capability toggles, notification preferences, and context token budget. Agent loop: HTTP route → agentLoopService (conversation + user message persistence) → cliModeService (subprocess spawn + MCP bridge + stdout streaming) → SSE back to the UI. Per-turn run records / token counts / tool confirmations are deferred to the team-under-Commander architecture work (Decision #91). `executionMode` column stays on the schema as a legacy/audit field; dispatch no longer reads it.
- **Proactive checks:** Scheduled background monitoring (default 4-hour interval). Scans for blocked tasks, budget thresholds, stale work, dependency gaps, memory conflicts, workload imbalance. Results pushed to Inbox via notifications.
- **Workflow templates (backend-ready, UI in 1.1):** Backend schema + API implemented; the `/TES/workflows` UI (list + step builder + "instantiate for goal") ships in 1.1. Workflow template data can still be created via `POST /api/companies/:cid/workflow-templates` for programmatic use. Underlying shape: ordered steps with dependencies that expand to tasks + `task_dependencies` on instantiation, with usage tracking (`instantiationCount`).
- **Notifications:** Unified notification system for extraction completion/failure, agent reminders, proactive alerts, action results. Unread badge in sidebar.
- **Conversation management:** One persistent conversation per user per company. History summarization for token management. Message-run linkage for cost tracking.
- **Event-driven integration:** Listens to LiveEvents (heartbeat completion, activity changes, MCP inbound, discussion entry creation) to trigger agent actions with debouncing.

## V2.5 New Tables

- `discussions` — thread container with polymorphic scope (department/project/goal), status (active/archived), denormalized entryCount/pendingItemCount
- `discussion_entries` — individual entries within a discussion, inputType (paste/write/voice/mcp), extractionStatus, entry-level scope override
- `discussion_extracted_items` — extracted items (decision/task/insight/context/reference/preference), suggested fields, dedup support, approval workflow, resultTaskId/resultMemoryId
- `discussion_annotations` — inline annotations on entries with anchorStart/anchorEnd character offsets
- `internal_agent_config` — per-company agent config: executionMode, provider, model, autonomyLevel, enabledCapabilities (12 types), budget, proactive interval
- `internal_agent_conversations` — one per user per company, summarizedContext for token management
- `internal_agent_messages` — conversation messages: role (user/assistant/system/tool_call/tool_result), toolCalls/toolResults JSON, pageContext, departmentContext
- `internal_agent_runs` — execution records: triggerType (conversation/proactive/event/sub_agent), toolsCalled, tokenUsage, costCents, provider/model
- `internal_agent_reminders` — scheduled reminders: triggerAt, status (pending/fired/cancelled), entity linking
- `workflow_templates` — reusable task chains: steps (JSON ordered array), dependencies (JSON fromStep/toStep), instantiationCount
- `notifications` — type (discussion.extraction_complete/failed, internal_agent.reminder/proactive/action_result), readAt/dismissedAt

## V2.5 Modified Tables

- `debriefs` — @deprecated V2.5 (kept for rollback safety). New code uses `discussions`.
- `briefs` — @deprecated V2.5 (kept for rollback safety). New code uses `discussions`.
- `brief_items` — @deprecated V2.5. Replaced by `discussion_extracted_items`.

## Workspace System

- **Route:** `/:companyPrefix/workspace/:workspaceId` renders `WorkspaceView` page
- **Layout:** `WorkspaceLayout` with 3-panel resizable layout (task nav | timeline+preview | context)
- **Mobile:** Tab-based navigation [Tasks][Timeline][Preview][Context] using CSS hidden (not conditional render)
- **functionType:** Project field (`software_development` | `design` | `marketing` | etc.) controls workspace tool visibility
- **executionWorkspacePolicy:** Project field (`per_task` | `shared` | `none`) controls workspace creation
- **TaskSlideOver:** Right-side Sheet with two modes — standard (task detail) and workspace (embedded timeline)
- **Lifecycle:** Workspaces can be archived via status update. Archived workspaces shown in collapsed section.
- **Key files:** `ui/src/components/workspace/`, `server/src/services/workspace-runtime.ts`, `packages/db/src/schema/execution_workspaces.ts`

## V3 Architecture

V3 adds five pillars: **Autonomy**, **Workflows**, **Connectors**, **Blueprints**, **Hosted**.

- **Autonomy tiers:** Per-agent levels 0-3. Level 0 = full approval (V1/V2 default). Level 1 = auto-execute known patterns. Level 2 = post-review. Level 3 = full autonomy within guardrails. Trust-based upgrade recommendations. (Decisions #74, #75)
- **Pipeline templates:** Repeatable task chains (spec→design→code→test→UAT) as JSON manifests. One-click instantiation. Self-generated from existing work patterns. (Decision #76)
- **Service connectors:** Bidirectional sync with GitHub, Figma, Linear, Slack. Department-scoped. AoA = control plane, external tools = execution plane. (Decisions #77, #78)
- **Department/project blueprints:** Pre-configured templates with agents, goals, memory items, pipeline templates. Built-in + community (ClipHub). (Decision #79)
- **Hosted deployment:** Cloud execution via **CLI-in-container** (Claude CLI / codex / opencode bundled in worker images). Cloud workspaces run the CLI in isolated containers with per-tenant auth. Same upper-layer architecture as local AoA — the execution primitive is containerized CLI, not direct SDK calls. Original V3 plan used API adapters; revised as part of Decision #91. (Decisions #80, #81, #91)
- **Additional:** Meeting integration (Recall.ai → Discussion), mobile app, multi-company, advanced analytics, experiment system, version merge logic.

## V2 New Tables

- `artifacts` — type (document/presentation/code/design/report/other), status (draft/active/archived), currentVersionId
- `artifact_versions` — versionNumber, source (agent/founder/mcp/teammate/external), sourceDetail, changelog, parentVersionId (for branching). Immutable.
- `memory_feedback_patterns` — patternType (tone_correction/format_change/content_addition/etc.), occurrenceCount, status (detected/suggested/accepted/dismissed)
- `user_roles` — userId, role (founder/team_lead/team_member), projectId (department-scoped)
- `suggestions` — category (8 types + agent_proposal), actionType (create_task/flag_risk/etc.), actionPayload (JSON), evidence, status (pending/accepted/dismissed/expired)
- `agent_trust_scores` — agentId, totalCompleted, approvedWithoutChanges, recentCompleted, recentApproved, currentScore

## V2 Modified Tables

- `memory_items` — adds: layer (identity/domain/active_context/working), expiresAt, goalId, sourceArtifactId, embedding (vector 1536)
- `issues` — adds: artifactId (link to deliverable)
- `assets` — expanded: all file types, 50MB limit (was images-only, 10MB)
- `users` — adds: displayName, avatarUrl, invitedBy, invitedAt, role fields

## V3 New Tables

- `pipeline_templates` — reusable task chain patterns with step definitions (JSON manifests)
- `pipeline_instances` — instantiated pipelines linked to goals
- `connectors` — department-scoped integrations with external services (GitHub, Figma, etc.)
- `connector_sync_log` — bidirectional sync history
- `autonomy_audit_log` — all auto-executed and escalated actions
- `blueprints` — pre-configured department/project templates

## V3 Modified Tables

- `agents` — adds: autonomyLevel (0-3), autonomyConfig (per-level settings)
- `issues` — adds: pipelineInstanceId, pipelineStepOrder

## V2 Test Patterns

Tests in `server/src/__tests__/` use these patterns to work around the drizzle-orm ESM cycle issue:

- **Pure function tests:** Import and test directly (e.g., `formatRunSummary`, `detectToneCorrections`, `computeScore`).
- **Service tests with mocks:** Mock `@armyofagents/db` and `drizzle-orm` with Proxy-based table stubs and no-op operators. Use sequence-based mock DBs (`createSequenceDb`) where each `select`/`update`/`insert` returns the next pre-configured result.
- **Contract tests:** Verify API shapes, constants, and formulas without importing drizzle internals.
- **V2 QA test suites (S29):** `v2-memory-qa.test.ts`, `v2-artifacts-qa.test.ts`, `v2-integration-qa.test.ts`, `v2-edge-cases-qa.test.ts`, `v2-performance-qa.test.ts`.

## Docs

- `docs/aoa/specs/v1_spec.md` — Detailed V1 technical spec (tables, services, routes, UI)
- `docs/aoa/plans/v1_plan.md` — V1 session-by-session development plan (~35 sessions across 8 phases)
- `docs/aoa/specs/v2_spec.md` — Full V2 technical spec (intelligence, team, artifacts, integration)
- `docs/aoa/plans/v2_plan.md` — V2 session-by-session development plan (10 phases, ~51 sessions)
- `docs/aoa/specs/v2_5_changelog.md` — V2.5 changelog (discussions, internal agent, workflow templates, notifications)
- `docs/aoa/specs/v3_spec.md` — Full V3 technical spec (autonomy, workflows, connectors, blueprints, hosted)
- `docs/aoa/reference/decisions.md` — All locked decisions (#1-90). Do not relitigate unless reopened.
- `docs/aoa/reference/prd.md` — Full product requirements document (covers V1/V2/V3 roadmap)
- `docs/aoa/specs/paperclip_spec.md` — Original Paperclip specification
- `docs/aoa/reference/product.md` — Original Paperclip product definition
