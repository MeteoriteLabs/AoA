# AoA (Army of Agents)

Hybrid Workforce Operating System for solo founders. Built on Paperclip (open-source AI agent orchestration). Founder manages AI agents + humans from a single control room.

## Stack

- **Frontend:** React + Vite + TailwindCSS (`ui/src/`)
- **Backend:** Hono framework (`server/src/`)
- **Database:** PostgreSQL + Drizzle ORM (`packages/db/src/schema/`)
- **Shared types:** `packages/shared/src/`
- **Adapters:** `packages/adapters/` + `server/src/adapters/`

## Critical Rules

1. **Drizzle ORM only.** Schema changes go in `packages/db/src/schema/`. Run `pnpm db:generate` for migrations. NEVER write raw SQL migration files.
2. **Follow existing patterns.** New services follow `server/src/services/goals.ts`. New routes follow `server/src/routes/goals.ts`. New schemas follow `packages/db/src/schema/goals.ts`.
3. **"Issues" = "Tasks" in UI only.** The DB table is `issues`. The API routes use `/issues`. But all user-facing text says "Task" / "Tasks". Never rename the table or routes.
4. **"Projects" table serves both Departments and Projects.** Distinguished by `type` field: `'department'` | `'project'`. Same mechanics for both.
5. **MCP inbound always routes through Debrief pipeline.** Never create raw tasks from MCP input. (Decision #14)
6. **Agents cannot write to Memory directly.** They can suggest items (status: 'pending'), but only the founder can approve identity + domain layers. V2: team leads can additionally approve active_context for their departments. Working memory is auto-created. (Decisions #15, #52)
7. **Artifact versions are immutable.** Once created, never modified. Changes = new version. Founder picks winner for branching — no auto-merge. (Decisions #43, #45)
8. **Memory feedback requires ≥3 occurrences.** Don't suggest memory from one-off edits. Pattern must be consistent. (Decision #46)
9. **Brief department fallback: item-level > brief-level > null.** Founder's per-item override always wins. (Decision #61)
10. **Consult `docs/aoa/reference/decisions.md` before making architectural choices.** 90 locked decisions exist. Don't relitigate.

## Naming Map (Paperclip → AoA)

| Paperclip UI | AoA UI | DB/API unchanged |
|-------------|--------|------------------|
| Issue | Task | `issues` table |
| Dashboard | Home | routes |
| Costs | Budget | `cost_events` table |
| Org | Team | routes |

Goals, Agents, Company, Settings, Activity, Inbox — unchanged.

## Key Architecture (V1)

- **Heartbeat system:** Push-based agent execution. `heartbeat.wakeup()` → HeartbeatRun → adapter executes. Agents don't pull tasks — they get told what to work on.
- **Atomic checkout:** Issues use `SELECT FOR UPDATE NO WAIT` for single-agent locking.
- **Adapters:** claude_local, opencode_local, openclaw, http, process, cursor, codex_local, claude_api, openai_api, gemini_api. Registered in `server/src/adapters/registry.ts`.
- **API Adapters (claude_api, openai_api, gemini_api):** Call LLM provider APIs directly using stored API keys from LLM Providers settings. No local CLI required. Same heartbeat/cost/budget pipeline as local adapters.
- **Debrief → Brief pipeline:** Raw content → Artifact → LLM extraction → Structured Brief → Founder approval → Tasks + Memory items.
- **Memory (V1):** Flat company knowledge store. Categories: decision, reference, context, insight, preference. Approval-gated. Founder is sole gatekeeper.
- **Task dependencies:** `task_dependencies` table links tasks in blocking relationships. When a dependency task completes → dependent auto-unblocks. Separate from `parentId` (which is subtask hierarchy, not blocking). Tasks can be blocked from any non-terminal status (backlog, todo, in_progress).
- **Why/What/How:** Agents receive context package: Vision + Mission + Goal + Memory items + Task details.
- **Goal status machine:** `planned → active → at_risk → achieved/cancelled` with `at_risk → active` recovery.
- **Department deletion:** Blocked if tasks or goals exist. Must reassign first. Memory items become unscoped.
- **Extraction failure:** Debrief marked `processing_failed`, founder notified. Can retry or manually create.

## V2 Architecture

V2 adds four pillars: **Intelligence**, **Team**, **Artifacts**, **Integration**.

- **Layered Memory (4 layers):**
  - `identity` — permanent, always included (vision, mission, company values). Sources: companies table fields + memory items with layer='identity'.
  - `domain` — department-scoped, semi-permanent (how we do X).
  - `active_context` — goal/project-scoped, temporary with `expiresAt`. Team leads can approve for their departments.
  - `working` — task-chain-scoped, ephemeral. Auto-archives (not deletes) after 7 days.
- **Semantic retrieval:** pgvector extension, 1536-dimension embeddings (OpenAI text-embedding-3-small), cosine similarity. IVFFlat/HNSW indexes. <100ms for 10K items.
- **Artifacts:** Versioned deliverables (documents, presentations, code). `artifacts` table + `artifact_versions` table. Versions are immutable. Source-agnostic (agent, founder, MCP, teammate, external). Founder picks winner for branching — no auto-merge.
- **Agent output capture:** 3-step pipeline — workspace diff → adapter hinting → founder confirmation during review. Files copied from workspace to storage, never moved. (Decision #67)
- **Artifact-as-input:** Downstream tasks auto-receive artifacts from dependency tasks as context. Enables spec→design→code→test pipelines. (Decision #71)
- **Refinement loop:** Review state supports adding artifact versions (not just approve/reject). Founder can refine on external LLMs and push back via MCP, upload, or paste. (Decisions #69, #70)
- **Suggestion engine:** 8 categories (goal_gap, pipeline_bottleneck, memory_gap, pattern_detected, budget_optimization, recurring_work, risk_flag, workload_balance) + agent proposals. Runs on Home load + every 4 hours.
- **Feedback loops:** `memory_feedback_patterns` table detects recurring founder edits on agent work. Suggests memory items after ≥3 occurrences.
- **Agent trust score:** `(approvedWithoutChanges / totalTasksCompleted) × 100`, last 20 tasks weighted 2x. Displayed on agent cards.
- **RBAC:** Three roles: `founder`, `team_lead`, `team_member`. Department-scoped. Additive from restrictive defaults.
- **MCP bidirectional:** V1 inbound (external → Debrief, per Decision #14). V2 adds outbound: AoA as MCP server exposing read-only resources (tasks, goals, memory, artifacts) + limited write tools (debrief push, suggest-memory, update-task-status, attach-artifact-version).
- **Global search:** PostgreSQL full-text search (tsvector/tsquery), cmd+K, RBAC-scoped, results grouped by entity type.
- **Voice debrief:** Browser recording → Whisper API transcription → enters Debrief pipeline. Third input mode alongside paste and write.
- **Context packaging:** "Open in [LLM]" button assembles full 10-section context (identity + domain memory + goal + task + artifacts + dependencies).
- **Per-agent context mode:** Three levels (minimal/standard/full) control how much context each agent receives. Stored in `runtimeConfig.contextMode`. Default: `standard`. Prevents token waste for simple adapters. (Decision #87)
- **Run summary comments:** Auto-generated task comments after each heartbeat run showing duration, token usage, cost, outcome, and detected files. Uses existing `issue_comments` table. Opt-out via `runtimeConfig.autoRunSummary`. (Decision #88)

## Sidebar Structure

```
+ New Task / + Debrief
Home, Inbox
WORK: Tasks, Briefs
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
server/src/routes/         → Hono route handlers
server/src/adapters/       → Agent execution adapters
ui/src/components/         → React components
ui/src/pages/              → Page-level components
ui/src/api/                → API client functions
```

## V3 Architecture

V3 adds five pillars: **Autonomy**, **Workflows**, **Connectors**, **Blueprints**, **Hosted**.

- **Autonomy tiers:** Per-agent levels 0-3. Level 0 = full approval (V1/V2 default). Level 1 = auto-execute known patterns. Level 2 = post-review. Level 3 = full autonomy within guardrails. Trust-based upgrade recommendations. (Decisions #74, #75)
- **Pipeline templates:** Repeatable task chains (spec→design→code→test→UAT) as JSON manifests. One-click instantiation. Self-generated from existing work patterns. (Decision #76)
- **Service connectors:** Bidirectional sync with GitHub, Figma, Linear, Slack. Department-scoped. AoA = control plane, external tools = execution plane. (Decisions #77, #78)
- **Department/project blueprints:** Pre-configured templates with agents, goals, memory items, pipeline templates. Built-in + community (ClipHub). (Decision #79)
- **Hosted deployment:** API adapters (claude_api, openai_api, gemini_api), cloud workspaces (containers), BYOK or bundled. Same upper layers, different execution layer. (Decisions #80, #81)
- **Additional:** Meeting integration (Recall.ai → Debrief), mobile app, multi-company, advanced analytics, experiment system, version merge logic.

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

## Docs

- `docs/aoa/specs/v1_spec.md` — Detailed V1 technical spec (tables, services, routes, UI)
- `docs/aoa/plans/v1_plan.md` — V1 session-by-session development plan (~35 sessions across 8 phases)
- `docs/aoa/specs/v2_spec.md` — Full V2 technical spec (intelligence, team, artifacts, integration)
- `docs/aoa/plans/v2_plan.md` — V2 session-by-session development plan (10 phases, ~51 sessions)
- `docs/aoa/specs/v3_spec.md` — Full V3 technical spec (autonomy, workflows, connectors, blueprints, hosted)
- `docs/aoa/reference/decisions.md` — All locked decisions (#1-90). Do not relitigate unless reopened.
- `docs/aoa/reference/prd.md` — Full product requirements document (covers V1/V2/V3 roadmap)
- `docs/aoa/specs/paperclip_spec.md` — Original Paperclip specification
- `docs/aoa/reference/product.md` — Original Paperclip product definition
