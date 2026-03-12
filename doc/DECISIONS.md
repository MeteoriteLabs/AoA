# AoA — Locked Decisions

Decisions made during product design. Do not relitigate unless explicitly reopened.

---

## Naming

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Issue → Task (UI only, DB stays `issues`) | "Issue" implies problems. "Task" is universal. Avoids massive DB migration. |
| 2 | Dashboard → Home | Home is a starting point, not a data dashboard. |
| 3 | Costs → Budget | Budget implies planning + control, not just tracking. |
| 4 | Actor/Org → Team | Team naturally covers humans + agents. |
| 5 | Review Pack → Brief | Brief is a structured review object. Clean, professional. |
| 6 | (new) Debrief | The action of capturing content. Pairs with Brief. |
| 7 | (new) Memory | Company knowledge store. More intuitive than "Knowledge Base." |
| 8 | Goals stays Goals | No rename needed. Well understood. |
| 9 | Projects stays Projects | Tried renaming, decided to keep alongside Departments. |
| 10 | Agents stays Agents | Clear and accurate. |

## Architecture

| # | Decision | Rationale |
|---|----------|-----------|
| 11 | Departments + Projects coexist (same table, type field) | Departments are permanent orgs, Projects are temporary. Same mechanics, different lifespan. |
| 12 | Vision & Mission are company-level text fields | Not goals, not memory items. Strategic anchors stored on companies table. |
| 13 | Goals must belong to at least one department or project via `project_goals` join table | No floating company-level goals. Use existing many-to-many join table, NOT a new projectId column on goals. A goal CAN span multiple departments/projects. |
| 14 | MCP always routes through Debrief pipeline | Prevents dirty data from external LLM conversations. Quality gate. |
| 15 | Memory is approval-gated | Founder is sole gatekeeper. Agents suggest, founder approves. |
| 16 | Agents have read-only Memory access | Receive context at execution time, cannot write directly. |
| 17 | Tasks don't care who does them | Same task model for humans and agents. Experience adapts. |
| 18 | Agents can only self-transition: todo → in_progress → in_review | Only humans mark done/cancelled. Deliberate control point. |
| 19 | Drizzle only, no raw SQL | Matches Paperclip patterns. `pnpm db:generate` for all migrations. |
| 20 | Sub-goals limited to one level deep | Avoids complexity. Goal → sub-goals, no deeper nesting. |
| 21 | Task dependencies use a separate `task_dependencies` table, not parentId | parentId = subtasks (hierarchy). Dependencies = blocking relationships (different concept). Separate table, separate logic. |
| 22 | Cancelled dependency notifies but does NOT auto-cancel dependents | Too aggressive. Founder decides what to do with orphaned tasks. |
| 23 | All dependencies must be met before a task can be worked on | AND logic, not OR. If Task C depends on A and B, both A and B must be done. |
| 24 | Dependencies auto-unblock to `todo` status and wake the assigned agent | When all dependencies are met, the system moves the task to `todo` and fires heartbeat.wakeup() if an agent is assigned. Minimal friction. |

## UX

| # | Decision | Rationale |
|---|----------|-----------|
| 25 | Sidebar is flat, not deeply nested | Depth lives in detail pages. Sidebar stays scannable. |
| 26 | Goals not in sidebar — inside department/project detail pages | Goals belong to their parent context, not global nav. |
| 27 | Home screen is action-first, not information-first | Founder opens AoA to DO things, not LOOK at things. |
| 28 | Home screen IS the onboarding | No separate wizard. Empty state guides setup. |
| 29 | Debrief has paste/write in V1, voice in V2 | Voice recording adds complexity. Start with text input. |
| 30 | Brief pipeline: artifact-first | All content stored as raw artifact before extraction. Original never lost. |
| 31 | Department goals show activity metrics, not progress bars | Ongoing departments don't "progress" — they operate. |
| 32 | Project goals show progress bars | Projects have endpoints and measurable completion. |
| 33 | Suggestion engine: V1 has goal-gap nudges only | Full suggestion engine in V2. V1 keeps it simple. |
| 34 | V1 is solo founder only (single user, no RBAC enforcement) | Multi-user and team permissions in V2. |
| 35 | Tasks and memory items CAN exist without a department/project | Not everything fits a department (e.g., legal, personal, strategic). Unscoped items live in global views. Founder assigns a department later if one gets created. |
| 36 | LLM extraction prompt includes available departments for auto-suggestion | The extraction prompt is dynamically built with the company's department/project list. LLM suggests placement per item but sets null if no clear fit. Founder confirms during Brief review. |

## V2 Architecture

| # | Decision | Rationale |
|---|----------|-----------|
| 40 | Memory has 4 layers: identity, domain, active_context, working | Different lifespans and scoping rules. Identity = always included. Domain = department-scoped. Active context = goal/project-scoped with expiry. Working = task-chain-scoped, ephemeral. |
| 41 | Semantic memory retrieval via pgvector, not separate vector DB | Keeps infrastructure simple. PostgreSQL extension. 1536-dimension embeddings. |
| 42 | Artifacts are separate from assets | Assets = raw files (immutable). Artifacts = versioned deliverables with metadata, status, and lineage. Artifact versions point to assets. |
| 43 | Artifact versions are immutable | Like assets — once created, never modified. Changes = new version. Full history preserved. |
| 44 | Artifact versioning is source-agnostic | Versions can come from agents, founder, team members, MCP pushes, or external uploads. AoA is the system of record, not the workshop. |
| 45 | Version branching: founder picks winner, no auto-merge | Simple conflict resolution. No git-level merge complexity. Founder decides which version becomes canonical. |
| 46 | Feedback patterns require ≥3 occurrences before suggesting memory | Prevents noise from one-off edits. Pattern must be consistent before becoming a suggestion. |
| 47 | Trust score = approval rate, weighted by recency | Simple, transparent, explainable. Not a complex AI model. Last 20 tasks count more than first 20. |
| 48 | RBAC is additive from restrictive defaults | Start locked down, founder grants permissions. Three roles: founder, team_lead, team_member. Department-scoped access. |
| 49 | AoA as MCP server: expose read-only resources + limited write tools | External agents can query Tasks, Memory, Goals, Artifacts. Write access limited to Debrief push, memory suggestions, task status updates. |
| 50 | Working memory auto-expires after 7 days | Prevents context bloat. Ephemeral by design. Founder can promote to domain layer if needed. |
| 51 | Suggestion engine runs on-demand (Home load) + periodic (every 4 hours) | Real-time suggestions when founder looks, background pattern detection in between. Not a streaming system. |
| 52 | Memory approval gate extends to team leads for V2 (extends #15) | Founder remains sole gatekeeper for identity + domain layers (per #15). Team leads can additionally approve active_context items for their departments. Working memory is auto-created (no approval needed). |

## V2 UX

| # | Decision | Rationale |
|---|----------|-----------|
| 53 | Task detail page gets "Open in [LLM]" button with context packaging | Assembles company identity + goal + task + memory into a structured prompt. Copies to clipboard or deep-links to preferred LLM. |
| 54 | Artifact version timeline is visual, not a flat list | Timeline view showing who created each version, source (agent/founder/MCP), and status transitions. Makes lineage intuitive. |
| 55 | Agent trust score displayed on agent cards and detail pages | Transparency. Founder sees trust trajectory. Builds confidence in delegation. |
| 56 | Suggestions show evidence, not just recommendations | Each suggestion explains WHY it's being made (goal at risk because X, pattern detected from Y). Founder makes informed decisions. |

## Scope

| # | Decision | Rationale |
|---|----------|-----------|
| 37 | V1 excludes: voice debrief, suggestion engine, templates, multi-user, autonomy tiers, automated workflows, analytics page, mobile | Focus on core loop: give work → execute → review → learn. |
| 38 | Department templates are V2 | Need real usage data to make good templates. |
| 39 | LLM preferences per task type are V2 | V1: founder picks one preferred LLM globally. |
| 57 | V2 excludes: autonomy tiers, automated workflows, department blueprints, service connectors, hosted deployment, external publishing, meeting integration, mobile, multi-company, experiment system, cross-agent memory propagation | V2 focuses on intelligence + team + artifacts. Autonomy, integration, and scale are V3. |
| 58 | V3 scope: 5 pillars — Autonomy (tiers, confidence, cross-agent learning), Workflows (pipeline templates, conversation-to-delivery), Connectors (GitHub/Figma/Linear/Slack bidirectional sync), Blueprints (department/project templates + ClipHub), Hosted (API adapters, cloud workspaces, BYOK/bundled). Plus: meeting integration, mobile, multi-company, analytics, experiment system | Full autonomy and scale. Founder shifts from operator to strategist. |

## Audit Additions (March 2026)

| # | Decision | Rationale |
|---|----------|-----------|
| 59 | Issues table gets `dueDate` field (nullable timestamp) | Referenced in Home screen ("tasks due today") and PRD but was missing from V1 schema. Needed for risk detection and sorting. |
| 60 | Goal status machine: planned → active → at_risk → achieved/cancelled, with at_risk → active recovery | Standardized across all docs. "planned" not "draft". "achieved" not "completed". Recovery from at_risk allowed. |
| 61 | Brief item department fallback: item-level > brief-level > null (unscoped) | Clear resolution order when creating tasks from brief approval. Founder's per-item override always wins. |
| 62 | Task can be blocked from any non-terminal status (backlog, todo, in_progress) | Dependencies can be added to tasks in any state. When unblocked, returns to previous status, not auto-promoted. |
| 63 | Department deletion blocked if it has tasks or goals | Must reassign or cancel tasks/goals first. Memory items become unscoped (departmentId → null). Prevents orphaned work. |
| 64 | Extraction failure: debrief marked 'processing_failed', founder notified | Graceful degradation. Founder can retry or manually create work. Empty extraction creates empty Brief (allowed). |
| 65 | Memory expiration: auto-archive (not delete), preserved in history | Working memory archived after 7 days. Active context archived when goal completes or expiresAt passes. "Show Archived" view available. |
| 66 | V2 includes global search (cmd+K) across tasks, memory, artifacts, goals | PostgreSQL full-text search. RBAC-scoped. Results grouped by entity type. |

## V2 Additions (March 2026 — Session 2)

| # | Decision | Rationale |
|---|----------|-----------|
| 67 | Agent output captured via 3-step pipeline: workspace diff → adapter hinting → founder confirmation | Bridges the gap between workspace (where agents work) and storage (where files are kept). Workspace untouched — files copied, not moved. |
| 68 | Artifacts can be referenced by multiple tasks (multi-task linkage) | A spec artifact is produced by task 1 but consumed by tasks 3, 4, 5. sourceIssueId tracks creator; issues.artifactId on other tasks indicates consumption. |
| 69 | Review state supports extended refinement, not just approve/reject | Founder can add artifact versions while task is in_review. Downstream tasks stay blocked until approval. Review is a workspace, not just a gate. |
| 70 | Adding artifact versions must be frictionless: drag-and-drop, paste content, MCP push | If it takes >2 clicks to push external work back to AoA, founder won't do it. AoA loses refinement history. |
| 71 | Dependency task artifacts auto-included in downstream task context | When task depends on completed tasks, those tasks' artifacts are automatically part of the agent's context package. Enables artifact-driven pipelines. |
| 72 | Department templates moved from V2 to V3 (as "Blueprints") | Needs more design work and real usage data. V3's ClipHub integration makes blueprints more powerful. |
| 73 | Debrief is the universal intake for all content entering AoA | Meetings, conversations, voice notes, agent output, and external LLM work all enter through Debrief (or as artifact versions for existing artifacts). Decision #14 reinforced. |

## V3 Architecture

| # | Decision | Rationale |
|---|----------|-----------|
| 74 | Autonomy tiers are per-agent, not global | One agent can be Level 3 while another is Level 0. Granular control per agent's proven reliability. |
| 75 | Level 3 autonomy never auto-recommended; founder must explicitly opt in | Safety guardrail. Trust score can recommend Level 0→1→2, but full autonomy is a conscious founder decision. |
| 76 | Pipeline templates are data (JSON manifests), not executable code | Stored as configuration. Instantiation creates real tasks with real dependencies. No workflow engine complexity. |
| 77 | Connectors are department-scoped, not company-wide | Engineering connects to GitHub, Marketing to HubSpot. Keeps integrations focused and avoids cross-department data leakage. |
| 78 | AoA is control plane, external tools are execution plane | AoA owns WHY (goals, priorities, memory, agents). External tools own HOW (PRs, designs, CI). Neither replaces the other. Approach C from design discussion. |
| 79 | Blueprints work offline without ClipHub | Built-in blueprints ship with AoA. ClipHub is an enhancement for community sharing, not a dependency. |
| 80 | Hosted mode changes only adapter and storage layers | Heartbeat, tasks, artifacts, memory, RBAC — all unchanged. Same upper layers, different execution layer. |
| 81 | BYOK is the default hosted tier, bundled is premium | Respects user's existing LLM investments. Non-technical founders can opt for bundled convenience. |
| 82 | Meeting integration routes through Debrief pipeline | Decision #14 preserved for meeting transcripts. No special intake path — meetings are just another debrief source. |

## V1 Implementation Fixes (March 2026)

| # | Decision | Rationale |
|---|----------|-----------|
| 83 | Windows path fix: use `fileURLToPath()` instead of `new URL().pathname` in db client | `new URL(..., import.meta.url).pathname` produces double drive letters on Windows (e.g., `/C:/C:/...`). Node's `fileURLToPath` handles cross-platform path resolution correctly. |
| 84 | Activity log "issue" → "task" replacement uses display-layer mapping, not DB changes | ACTION_VERBS/ACTION_LABELS maps in UI components translate `issue.*` entity types to "task" text. `entityType` stays `issue` in DB — renaming would break existing activity rows. Fallback regex replaces `\bissue\b` with "task" for unmapped actions. |
| 85 | Sidebar route roots must be registered for company prefix routing | `BOARD_ROUTE_ROOTS` set in `company-routes.ts` controls which paths get the company slug prefix (e.g., `/briefs` → `/SEAA/briefs`). Missing entries cause bare paths that 404. All V1 sidebar pages registered: briefs, vision, memory. |
| 86 | Goal status transitions are validated server-side | Allowed transitions enforced in `goals.update()` with a defined map (e.g., `planned → active`, `active → at_risk → active`). Invalid transitions return 400. Prevents inconsistent state from UI bugs or API misuse. |
