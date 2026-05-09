# AoA — Locked Decisions

Decisions made during product design and development. Do not relitigate unless explicitly reopened.

**Numbering systems:**
- `#N` — Core product decisions (V1 through V3)
- `DA-N` — V2.5 Discussions & Internal Agent specific decisions

> **V2.5 note:** Some V1/V2 decisions were superseded or extended in V2.5. Where applicable, an `[Updated V2.5]` note is added.

---

## Naming

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Issue → Task (UI only, DB stays `issues`) | "Issue" implies problems. "Task" is universal. Avoids massive DB migration. |
| 2 | Dashboard → Home | Home is a starting point, not a data dashboard. |
| 3 | Costs → Budget | Budget implies planning + control, not just tracking. |
| 4 | Actor/Org → Team | Team naturally covers humans + agents. |
| 5 | Review Pack → Brief | Brief is a structured review object. Clean, professional. **[Updated V2.5: Brief replaced by inline Discussion review — see DA-3, DA-9]** |
| 6 | (new) Debrief | The action of capturing content. Pairs with Brief. **[Updated V2.5: Debrief replaced by Discussions — see DA-3]** |
| 7 | (new) Memory | Company knowledge store. More intuitive than "Knowledge Base." |
| 8 | Goals stays Goals | No rename needed. Well understood. |
| 9 | Projects stays Projects | Tried renaming, decided to keep alongside Departments. |
| 10 | Agents stays Agents | Clear and accurate. |

---

## Architecture

| # | Decision | Rationale |
|---|----------|-----------|
| 11 | Departments + Projects coexist (same table, type field) | Departments are permanent orgs, Projects are temporary. Same mechanics, different lifespan. |
| 12 | Vision & Mission are company-level text fields | Not goals, not memory items. Strategic anchors stored on companies table. |
| 13 | Goals must belong to at least one department or project via `project_goals` join table | No floating company-level goals. Use existing many-to-many join table, NOT a new projectId column on goals. A goal CAN span multiple departments/projects. |
| 14 | MCP inbound with authenticated write permission may create tasks directly; `debrief-push` remains for unstructured content | RBAC + per-user keys provide the quality gate that originally lived in the Discussion pipeline. **[Revised 2026-04-21 — see "Decision #14 (revised 2026-04-21)" entry below for full wording. Original V2.5 wording: "Debrief pipeline" → "Discussion pipeline." See DA-3.]** |
| 15 | Memory is approval-gated | Founder is sole gatekeeper. Agents suggest, founder approves. **[Extended V2.5: see #52 for team lead extension]** |
| 16 | Agents have read-only Memory access | Receive context at execution time, cannot write directly. |
| 17 | Tasks don't care who does them | Same task model for humans and agents. Experience adapts. |
| 18 | Agents can only self-transition: todo → in_progress → in_review | Only humans mark done/cancelled. Deliberate control point. |
| 19 | Drizzle only, no raw SQL | Matches Paperclip patterns. `pnpm db:generate` for all migrations. |
| 20 | Sub-goals limited to one level deep | Avoids complexity. Goal → sub-goals, no deeper nesting. |
| 21 | Task dependencies use a separate `task_dependencies` table, not parentId | parentId = subtasks (hierarchy). Dependencies = blocking relationships (different concept). Separate table, separate logic. |
| 22 | Cancelled dependency notifies but does NOT auto-cancel dependents | Too aggressive. Founder decides what to do with orphaned tasks. |
| 23 | All dependencies must be met before a task can be worked on | AND logic, not OR. If Task C depends on A and B, both A and B must be done. |
| 24 | Dependencies auto-unblock to `todo` status and wake the assigned agent | When all dependencies are met, the system moves the task to `todo` and fires heartbeat.wakeup() if an agent is assigned. Minimal friction. |

---

## UX

| # | Decision | Rationale |
|---|----------|-----------|
| 25 | Sidebar is flat, not deeply nested | Depth lives in detail pages. Sidebar stays scannable. |
| 26 | Goals not in sidebar — inside department/project detail pages | Goals belong to their parent context, not global nav. |
| 27 | Home screen is action-first, not information-first | Founder opens AoA to DO things, not LOOK at things. |
| 28 | Home screen IS the onboarding | No separate wizard. Empty state guides setup. |
| 29 | Debrief has paste/write in V1, voice in V2 | Voice recording adds complexity. Start with text input. **[Updated V2.5: Voice shipped in V2.5 via Whisper API]** |
| 30 | Brief pipeline: artifact-first | All content stored as raw artifact before extraction. Original never lost. |
| 31 | Department goals show activity metrics, not progress bars | Ongoing departments don't "progress" — they operate. |
| 32 | Project goals show progress bars | Projects have endpoints and measurable completion. |
| 33 | Suggestion engine: V1 has goal-gap nudges only | Full suggestion engine in V2. V1 keeps it simple. |
| 34 | V1 is solo founder only (single user, no RBAC enforcement) | Multi-user and team permissions in V2. |
| 35 | Tasks and memory items CAN exist without a department/project | Not everything fits a department (e.g., legal, personal, strategic). Unscoped items live in global views. Founder assigns a department later if one gets created. |
| 36 | LLM extraction prompt includes available departments for auto-suggestion | The extraction prompt is dynamically built with the company's department/project list. LLM suggests placement per item but sets null if no clear fit. Founder confirms during Brief review. |

---

## Scope

| # | Decision | Rationale |
|---|----------|-----------|
| 37 | V1 excludes: voice debrief, suggestion engine, templates, multi-user, autonomy tiers, automated workflows, analytics page, mobile | Focus on core loop: give work → execute → review → learn. |
| 38 | Department templates are V2 | Need real usage data to make good templates. |
| 39 | LLM preferences per task type are V2 | V1: founder picks one preferred LLM globally. |
| 57 | V2 excludes: autonomy tiers, automated workflows, department blueprints, service connectors, hosted deployment, external publishing, meeting integration, mobile, multi-company, experiment system, cross-agent memory propagation | V2 focuses on intelligence + team + artifacts. Autonomy, integration, and scale are V3. |
| 58 | V3 scope: 5 pillars — Autonomy (tiers, confidence, cross-agent learning), Workflows (pipeline templates, conversation-to-delivery), Connectors (GitHub/Figma/Linear/Slack bidirectional sync), Blueprints (department/project templates + ClipHub), Hosted (API adapters, cloud workspaces, BYOK/bundled). Plus: meeting integration, mobile, multi-company, analytics, experiment system | Full autonomy and scale. Founder shifts from operator to strategist. |

---

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
| 49 | AoA as MCP server: expose read-only resources + limited write tools | External agents can query Tasks, Memory, Goals, Artifacts. Write access limited to Discussion push, memory suggestions, task status updates. |
| 50 | Working memory auto-expires after 7 days | Prevents context bloat. Ephemeral by design. Founder can promote to domain layer if needed. |
| 51 | Suggestion engine runs on-demand (Home load) + periodic (every 4 hours) | Real-time suggestions when founder looks, background pattern detection in between. Not a streaming system. |
| 52 | Memory approval gate extends to team leads for V2 (extends #15) | Founder remains sole gatekeeper for identity + domain layers (per #15). Team leads can additionally approve active_context items for their departments. Working memory is auto-created (no approval needed). |

---

## V2 UX

| # | Decision | Rationale |
|---|----------|-----------|
| 53 | Task detail page gets "Open in [LLM]" button with context packaging | Assembles company identity + goal + task + memory into a structured prompt. Copies to clipboard or deep-links to preferred LLM. |
| 54 | Artifact version timeline is visual, not a flat list | Timeline view showing who created each version, source (agent/founder/MCP), and status transitions. Makes lineage intuitive. |
| 55 | Agent trust score displayed on agent cards and detail pages | Transparency. Founder sees trust trajectory. Builds confidence in delegation. |
| 56 | Suggestions show evidence, not just recommendations | Each suggestion explains WHY it's being made (goal at risk because X, pattern detected from Y). Founder makes informed decisions. |

---

## Audit Additions (March 2026)

| # | Decision | Rationale |
|---|----------|-----------|
| 59 | Issues table gets `dueDate` field (nullable timestamp) | Referenced in Home screen ("tasks due today") and PRD but was missing from V1 schema. Needed for risk detection and sorting. |
| 60 | Goal status machine: planned → active → at_risk → achieved/cancelled, with at_risk → active recovery | Standardized across all docs. "planned" not "draft". "achieved" not "completed". Recovery from at_risk allowed. |
| 61 | Discussion scope fallback: item-level > entry-level > discussion-level > null | Clear resolution order when creating tasks from discussion approval. Founder's per-item override always wins. **[Updated V2.5: was "brief-level" → "entry-level" and "discussion-level" to match Discussions model]** |
| 62 | Task can be blocked from any non-terminal status (backlog, todo, in_progress) | Dependencies can be added to tasks in any state. When unblocked, returns to previous status, not auto-promoted. |
| 63 | Department deletion blocked if it has tasks or goals | Must reassign or cancel tasks/goals first. Memory items become unscoped (departmentId → null). Prevents orphaned work. |
| 64 | Extraction failure: entry marked 'processing_failed', founder notified | Graceful degradation. Founder can retry or manually create work. Empty extraction creates empty extracted items (allowed). **[Updated V2.5: was "debrief" → "entry"]** |
| 65 | Memory expiration: auto-archive (not delete), preserved in history | Working memory archived after 7 days. Active context archived when goal completes or expiresAt passes. "Show Archived" view available. |
| 66 | V2 includes global search (cmd+K) across tasks, memory, artifacts, goals | PostgreSQL full-text search. RBAC-scoped. Results grouped by entity type. |

---

## V2 Additions (March 2026 — Session 2)

| # | Decision | Rationale |
|---|----------|-----------|
| 67 | Agent output captured via 3-step pipeline: workspace diff → adapter hinting → founder confirmation | Bridges the gap between workspace (where agents work) and storage (where files are kept). Workspace untouched — files copied, not moved. |
| 68 | Artifacts can be referenced by multiple tasks (multi-task linkage) | A spec artifact is produced by task 1 but consumed by tasks 3, 4, 5. sourceIssueId tracks creator; issues.artifactId on other tasks indicates consumption. |
| 69 | Review state supports extended refinement, not just approve/reject | Founder can add artifact versions while task is in_review. Downstream tasks stay blocked until approval. Review is a workspace, not just a gate. |
| 70 | Adding artifact versions must be frictionless: drag-and-drop, paste content, MCP push | If it takes >2 clicks to push external work back to AoA, founder won't do it. AoA loses refinement history. |
| 71 | Dependency task artifacts auto-included in downstream task context | When task depends on completed tasks, those tasks' artifacts are automatically part of the agent's context package. Enables artifact-driven pipelines. |
| 72 | Department templates moved from V2 to V3 (as "Blueprints") | Needs more design work and real usage data. V3's ClipHub integration makes blueprints more powerful. |
| 73 | Discussion is the universal intake for all content entering AoA | Meetings, conversations, voice notes, agent output, and external LLM work all enter through Discussions (or as artifact versions for existing artifacts). Decision #14 reinforced. **[Updated V2.5: was "Debrief" → "Discussion"]** |

---

## V3 Architecture

| # | Decision | Rationale |
|---|----------|-----------|
| 74 | Autonomy tiers are per-agent, not global | One agent can be Level 3 while another is Level 0. Granular control per agent's proven reliability. |
| 75 | Level 3 autonomy never auto-recommended; founder must explicitly opt in | Safety guardrail. Trust score can recommend Level 0→1→2, but full autonomy is a conscious founder decision. |
| 76 | Pipeline templates are data (JSON manifests), not executable code | Stored as configuration. Instantiation creates real tasks with real dependencies. No workflow engine complexity. |
| 77 | Connectors are department-scoped, not company-wide | Engineering connects to GitHub, Marketing to HubSpot. Keeps integrations focused and avoids cross-department data leakage. |
| 78 | AoA is control plane, external tools are execution plane | AoA owns WHY (goals, priorities, memory, agents). External tools own HOW (PRs, designs, CI). Neither replaces the other. |
| 79 | Blueprints work offline without ClipHub | Built-in blueprints ship with AoA. ClipHub is an enhancement for community sharing, not a dependency. |
| 80 | Hosted mode changes only adapter and storage layers | Heartbeat, tasks, artifacts, memory, RBAC — all unchanged. Same upper layers, different execution layer. |
| 81 | BYOK is the default hosted tier, bundled is premium | Respects user's existing LLM investments. Non-technical founders can opt for bundled convenience. |
| 82 | Meeting integration routes through Discussion pipeline | Decision #14 preserved for meeting transcripts. No special intake path — meetings are just another discussion source. |

---

## V1 Implementation Fixes (March 2026)

| # | Decision | Rationale |
|---|----------|-----------|
| 83 | Windows path fix: use `fileURLToPath()` instead of `new URL().pathname` in db client | `new URL(..., import.meta.url).pathname` produces double drive letters on Windows (e.g., `/C:/C:/...`). Node's `fileURLToPath` handles cross-platform path resolution correctly. |
| 84 | Activity log "issue" → "task" replacement uses display-layer mapping, not DB changes | ACTION_VERBS/ACTION_LABELS maps in UI components translate `issue.*` entity types to "task" text. `entityType` stays `issue` in DB — renaming would break existing activity rows. Fallback regex replaces `\bissue\b` with "task" for unmapped actions. |
| 85 | Sidebar route roots must be registered for company prefix routing | `BOARD_ROUTE_ROOTS` set in `company-routes.ts` controls which paths get the company slug prefix (e.g., `/briefs` → `/SEAA/briefs`). Missing entries cause bare paths that 404. All V1 sidebar pages registered. |
| 86 | Goal status transitions are validated server-side | Allowed transitions enforced in `goals.update()` with a defined map (e.g., `planned → active`, `active → at_risk → active`). Invalid transitions return 400. Prevents inconsistent state from UI bugs or API misuse. |

---

## V2.5 Additions (March–April 2026)

| # | Decision | Rationale |
|---|----------|-----------|
| 87 | Per-agent context mode: minimal / standard / full | Three levels control how much context each agent receives. Stored in `runtimeConfig.contextMode`. Default: `standard`. Prevents token waste for simple adapters. |
| 88 | Run summary comments auto-generated after each heartbeat run | Auto-generated task comments show duration, token usage, cost, outcome, and detected files. Uses existing `issue_comments` table. Opt-out via `runtimeConfig.autoRunSummary`. Files truncated to 10 shown + "+N more". |
| 89 | _(not documented — referenced by count only)_ | — |
| 90 | _(not documented — referenced by count only)_ | — |
| 91 | AoA drops API adapters (`claude_api`, `openai_api`, `gemini_api`) in favor of CLI-only agent execution | Single-turn API adapters duplicated the multi-turn loop logic CLI adapters already handle correctly. Commander migrates to CLI default (`claude_cli` / `codex` / `opencode`) — no per-company LLM API key required. Data migration (heuristic D): `UPDATE internal_agent_config SET execution_mode='cli', cli_tool=COALESCE(cli_tool, 'claude_cli') WHERE execution_mode='api'`. `internal_agent_config.provider`/`.model` columns stay dormant for rollback safety. `server/src/services/internal-agent/providers/` is preserved as an internal SDK util for extraction + embeddings until the team-under-Commander architecture replaces it. V3 Hosted deployment revised to CLI-in-container. Per-turn run tracking / cost / token accounting / tool confirmations are deferred to the same future sprint. Sprint 2A (2026-04-24). Deferred follow-ups: (a) rehome ~14 non-API-mode tests from the deleted `v2.5-edge-cases-qa.test.ts` (discussion service, proactive checks, goal scope, reminders, approval double-protection) into domain-matching files; (b) add a behavioral agent-loop shell test to complement the import-level static guard; (c) delete or finish the orphaned `/internal-agent/confirm` stub route. |

---

## V2.5 Discussions & Internal Agent Decisions (DA series)

These decisions were made during V2.5 design and are specific to the Discussions pipeline and Internal Agent features.

---

### DA-1: Product Positioning

**Decision: Hybrid Workforce OS (not AI Agent Manager)**

AoA is where a solo founder runs their company — with AI agents doing most of the work and humans filling the gaps. Positions against "Linear + Notion + AI tools duct-taped together," not against Claude Code or Cursor directly.

**Consequences:** All UX decisions prioritize the "company operating system" feel. Discussions become the primary input channel. The internal agent is the system's intelligence, not a chatbot feature.

---

### DA-2: Three-Tier Agent Architecture

**Decision: Master orchestrator → department lead personas → worker agents**

```
Internal Agent (one entity, department-scoped personas)
  ├── Engineering context
  ├── Marketing context
  └── [other departments]
      ↓
Worker Agents (user-created, adapter-based)
```

**Consequences:** Internal agent does NOT appear in the Agents page alongside worker agents. Department lead "personas" are not separate agents — they are the internal agent with department-scoped context.

---

### DA-3: Discussions Replace Debrief + Brief

**Decision: Discussions replace both Debrief and Brief**

Discussions are threaded records of real conversations (transcribed meetings, LLM sessions via MCP, voice recordings). Each entry in a thread is processed in context of the full thread. Brief as a separate staging area is redundant when review happens inline within the Discussion.

**What goes away:** `debriefs` table (deprecated), `briefs` table (deprecated), `brief_items` table (replaced by `discussion_extracted_items`), BriefReview page, Briefs sidebar item.

**Consequences:** Decision #14 updated — MCP routes through Discussion pipeline. Each existing debrief migrated to a single-entry Discussion.

---

### DA-4: Internal Agent Surface — Right Collapsible Panel

**Decision: Right collapsible panel (primary) + expandable for deep sessions**

Right panel is the daily driver — always available, context-aware of current page. Panel can expand wider for longer sessions.

**Consequences:** New global component in Layout.tsx. Panel is collapsible (closed by default). Panel is context-aware of current page. Mobile: panel overlays as a sheet/drawer from right.

---

### DA-5: Internal Agent Execution — Dual Mode (API + CLI)

**Decision: API-based agent loop as default; CLI-based via MCP as optional power-user mode**

API mode: new server-side `InternalAgentService` calls LLM API with AoA tool definitions, executes tools by calling existing service functions directly, streams via SSE. CLI mode: same AoA tools exposed as MCP resources; CLI handles the agent loop.

**V2.5 ships API mode only.** CLI mode is deferred to V3.

---

### DA-6: Internal Agent Permissions — Logged-In User's Role

**Decision: Internal agent inherits the logged-in user's RBAC permissions**

Solo founder → agent has founder permissions. Team lead → agent has team lead permissions. No new RBAC role.

---

### DA-7: Discussion Entry Sources — Four Input Types

**Decision: paste, write, voice, MCP**

Same 4 input types as the old Debrief, with voice added. Transcription tool integrations (Otter, Fireflies, Recall.ai) and live recording deferred.

---

### DA-8: Discussion Threading Model

**Decision: Flexible threading with manual and agent-assisted connection**

Any entry can be standalone (new thread) or part of an existing thread. At creation time, user chooses "New Discussion" or "Add to existing." Entries can be attached/moved between threads. Agent can suggest connections.

---

### DA-9: Inline Review (No Separate Brief Page)

**Decision: Review happens inline within Discussion thread + Inbox notifications**

Extracted items appear below each Discussion entry. "Confirm All" for fast path. Inbox gets a notification for pending review items. BriefReview page removed.

---

### DA-10: Sidebar Navigation Structure (V2.5)

**Decision: Discussions replaces Briefs, ordered first under WORK**

```
Home | Inbox
WORK: Discussions → Tasks → Agents → Goals
DEPARTMENTS: [dynamic]
PROJECTS: [dynamic]
COMPANY: Vision & Mission, Memory, Team
Settings
```

---

### DA-11: Discussions Tab on Project/Department Pages

**Decision: Add Discussions tab to ProjectDetail**

ProjectDetail gets a "Discussions" tab alongside Overview, Issues, Goals, Team, Budget. Shows discussions scoped to that project/department. "New Discussion" action pre-scoped.

---

### DA-12: Internal Agent Conversation Persistence

**Decision: Persistent forever with summarization**

All messages stored permanently. One primary conversation thread per user. Older conversations summarized for token management. User can manually reset but old context remains retrievable.

---

### DA-13: Internal Agent Capabilities (V2.5 Scope — 12 capabilities)

Discussion processing, proactive suggestions, organizational queries, system actions, context briefing, memory management, conflict detection, budget awareness, workflow coaching, workflow discovery/SOP creation, cross-department coordination, department lead personas.

**Deferred to V3:** Onboarding conversation, full autonomy tiers (V2.5 starts at Level 0 — always ask).

---

### DA-14: Core Tool Set — 30 Tools

Discussion (3) + Query (6) + Action (8) + Memory (5) + Workflow (3) + File (2) + Coordination (1) + Analysis (2) = 30 tools. 14 tools deferred to V3. Same tool registry backs both API mode and MCP/CLI mode.

---

### DA-15: Annotations on Discussion Entries

**Decision: Annotations supported, NOT extracted — they are metadata**

Founder can annotate any point in a discussion entry. Annotations are context for the internal agent, not items to extract. Agent sees annotations when processing subsequent entries.

---

### DA-16: Data Migration Strategy

**Decision: Migrate existing debriefs → Discussions (no dual systems)**

Each existing debrief becomes a single-entry Discussion. Brief items attach as extracted items. Old URLs redirect. Old debrief/brief code replaced, not maintained alongside.

---

### DA-17: Discussion Entry Processing — Internal Agent Handles Extraction

**Decision: Internal agent handles extraction (not a separate pipeline)**

Extraction needs thread context + system state awareness — exactly what the internal agent provides. `extraction.ts` refactored from one-shot LLM call into a tool the internal agent invokes (`extract_from_content`). Auto-processing on entry arrival.

---

### DA-18: Internal Agent Settings

**Decision: Settings section with execution mode, provider/model, autonomy level (V2.5: Level 0 only), enabled capabilities, notification preferences**

Settings persisted per company, not per user.

---

### DA-19: Quick Capture Modal (evolved from DebriefModal)

**Decision: Lightweight modal — paste, write, voice, plus "Add to existing Discussion" option**

Default: creates new standalone Discussion. Processing happens async (no blocking spinner). Notification in Inbox when extraction is ready. Accessible from Home, Cmd+K, keyboard shortcut.

---

### DA-20: Workflow/SOP System — Lightweight Templates in V2.5

**Decision: Internal agent interviews founder to discover processes, creates reusable workflow templates**

Templates are stored as ordered task chains with dependencies. Instantiation creates real tasks. Connection to V3 `pipeline_templates` — V2.5 ships a lighter version that may be pulled forward.

---

### DA-21: Internal Agent Panel Toggle — BreadcrumbBar + Keyboard Shortcut

**Decision: Icon button in BreadcrumbBar (top right) + keyboard shortcut (Cmd+J)**

Panel remembers open/closed state per session.

---

### DA-22: Content Pasted in Agent Panel → Routed to Discussion

**Decision: Agent detects pasted content, routes to Discussions — agent panel is never the permanent home**

Flow: detect content → search for related discussions → offer to add to existing or create new → content lives in Discussions (searchable, threaded, linked).

---

### DA-23: Agent Panel on Mobile — Full-Screen Sheet, Mutually Exclusive

**Decision: Full-screen sheet on mobile, mutually exclusive with task slide-over**

One primary overlay at a time. Modals can overlay on top of the agent panel.

---

### DA-24: Internal Agent Token Budget — Configurable with Smart Allocation

**Decision: Configurable token budget (default 8,000 tokens for context assembly)**

Allocation: identity (~500) + department memory (~1,500) + conversation history (~4,000) + page context (~1,000) + tool results reserve (~1,000). Summarization kicks in when history exceeds threshold. Settings UI: compact/standard/large.

---

### DA-25: Internal Agent Cost Attribution — Separate Budget Line

**Decision: Internal agent has its own `budgetMonthlyCents` and `spentMonthlyCents`**

Stored in `internal_agent_config` (not in agents table). Every API call logs a `cost_event` with `source: 'internal_agent'`. Same 80% warning / 100% pause logic as worker agents. Agent pauses and shows message in panel if over budget.

---

### DA-26: Mobile Bottom Nav — Agent Replaces Create Button

**Decision: Center position → AoA (internal agent toggle), not Create (+)**

```
Home | Tasks | AoA | Agents | Inbox
```

Creation accessible via agent panel, Cmd+K, Home page.

---

### DA-27: Internal Agent Run Tracking — Dedicated `internal_agent_runs` Table

**Decision: Separate run tracking system from worker agent `heartbeat_runs`**

New table: `internal_agent_runs` with triggerType (conversation / proactive / event / sub_agent), triggerSource (extensible text), toolsCalled, tokenUsage, costCents, durationMs, relatedEntityType/Id.

**Why separate from worker heartbeat:** Different execution model (conversational + event-driven vs. task-based), no queue, no atomic checkout, no adapter abstraction, no wakeup/assignment lifecycle.

**Background processing:** Event triggers fire even when founder is not in app. Results queued as Inbox notifications. Greeting on next login: "I processed 2 new discussions while you were away."

---

## Decision #14 (revised 2026-04-21)

**Status:** Revised. Original locked version superseded.

**Rule:** MCP inbound with authenticated per-user write permission may create tasks, update tasks, and add comments directly. `debrief-push` remains the alternative tool for unstructured content that should pass through AoA's extraction pipeline (meeting notes, emails, paste-dumps). Anonymous / unauthenticated MCP input (if ever exposed) still routes through Discussion pipeline.

**Reasoning:** The original Decision #14 was locked before AoA had per-user MCP keys with RBAC. Discussion-extraction served as the quality gate for external input. With authenticated per-user keys bound to company + user role, the quality gate is now the RBAC layer plus the caller's explicit tool choice. Teammates using external MCP clients (Claude Code, Cursor, etc.) should not need a two-step extraction for tasks they know they want to create.

**What stays the same:**
- `debrief-push` continues to route through Discussion pipeline
- Extraction-approval workflow for Discussion items unchanged
- RBAC scoping (founder / team_lead / team_member) enforced on all MCP writes

**What changes:**
- `create-task`, `update-task`, `add-comment` tools become first-class MCP writes
- Callers with write-permission role can bypass Discussion for direct task creation

**Original wording (for reference):** "MCP inbound always routes through Discussion pipeline — never create raw tasks from MCP input."

---

## Decision (annotation, 2026-04-21): MCP `upsert-task-document` ≡ artifact operations

Paperclip's `paperclipUpsertIssueDocument` tool wraps a markdown body (identified by a `key`) attached to an issue, with an append-only revision history. AoA's equivalent substrate is the existing `artifacts` + `artifact_versions` subsystem, with a 1:1 link from task to artifact via `issues.artifactId`. Phase C (Task C.4) maps Paperclip's document tool surface onto AoA's artifact subsystem:

- `upsert-task-document` → if the task's artifact exists and is of type `document`, add a new immutable version; else create a new artifact of type `document` and link it via `issues.artifactId`
- `list-task-documents` → return the task's document artifact (0 or 1 item — AoA has a single artifact per task, unlike Paperclip's per-key multiplicity)
- `get-task-document` → return the artifact + its latest version (content + metadata)
- `list-task-document-revisions` → return all artifact versions ordered ascending by `versionNumber` (immutable history)
- `restore-task-document-revision` → create a **new** artifact version whose content is copied from the specified older version; the old version is **never mutated** (preserves Decisions #43 / #45 — artifact versions are immutable)

**Surface divergence from Paperclip:** AoA does not accept Paperclip's `key` parameter because its data model is 1:1 task↔artifact. If Paperclip-style per-key multiplicity is ever needed, it would require a schema change (e.g., a `task_documents` junction table), not a tool-surface change.

**RBAC:** All five tools enforce company isolation (cross-company access returns 404) and — for scoped users — project-scope membership via the task's `projectId`. Writes additionally require `permissionsSvc.canAccessEntity("artifact", "update", { departmentId: task.projectId })`.

---

## Decision #92 — Defer Phase 6 Hermes wire-field rename to upstream coordination

**Status:** Deferred (locked 2026-04-26)

**Context:** The Paperclip → AoA rename plan (`docs/superpowers/plans/2026-04-25-paperclip-to-aoa-rename.md`) defined Phase 6 as renaming `paperclip_session_key` / `paperclip_stream_transport` JSON field names in the OpenClaw / Hermes wire payload (sent during agent execution from `packages/adapters/openclaw/src/server/execute-webhook.ts` and `packages/adapters/openclaw/src/server/execute-sse.ts`). Hermes is owned by an external project; renaming our send-side without coordinating their receive-side breaks the integration for any operator running an older Hermes build.

**Decision:** Phase 6 stays deferred until either (a) the Hermes maintainer confirms readiness for a coordinated rename, or (b) a Hermes adapter version ships that accepts both old and new names (one-release migration window), the minimum-required Hermes version in `package.json` is bumped to that release, and the old field names are removed from the execute files.

**Consequences:**
- Existing Hermes wire fields keep `paperclip_session_key` / `paperclip_stream_transport` names. Documented as wire-compat surface #8 in `docs/aoa/reference/wire-compat.md`.
- Brand-check CI (currently 9 guards in `.github/workflows/pr.yml`) must continue to allow `paperclip` matches inside `packages/adapters/openclaw/**`.
- Re-open this decision when an upstream coordination window opens. Owner: whoever picks up the Hermes adapter or OpenClaw integration work next.

**Reference:** Original Phase 6 spec lives in the rename plan; do not re-litigate without reading it first. Wire-compat surface #8 in `wire-compat.md` cross-references this decision.

---

## Decision #93 — Skip standalone `@paperclipai/mcp-server` package port

**Status:** Locked (2026-04-26)

**Context:** Paperclip released `packages/mcp-server` — a stdio-based MCP server that wraps the Paperclip REST API for external MCP clients (e.g., Claude Desktop, Cursor) to call Paperclip from outside a running instance. It's a separate npm package (~1,148 LOC) that ships with its own bin entry and serves as a bridge: external MCP client → stdio → REST → Paperclip backend.

**Decision:** Do NOT port. AoA's existing in-server MCP at `server/src/mcp/server.ts` already exposes 31 RBAC-scoped, rate-limited tools directly to clients connected to the running AoA backend (read tools, write tools, document tools, approval tools — all per-user-keyed via `mcp_api_keys`). The standalone wrapper would only matter when the MCP client cannot reach AoA's HTTP endpoint — a use case AoA's local-first deployment model does not currently have.

**Reasoning:**
- AoA's deployment model assumes the client and server run on the same host or LAN. The in-server MCP serves that case directly without a stdio bridge.
- Maintaining the standalone package would mean tracking Paperclip's tool surface separately from AoA's (which has diverged — AoA has 31 tools vs. Paperclip's tool count, with different RBAC scoping and AoA-specific tools like `debrief-push` mapped to discussions).
- The performance + simplicity argument for stdio-MCP doesn't hold when AoA's MCP is already a single in-process call away.

**Revisit when:** AoA grows a multi-tenant cloud deployment where external Claude Desktop / Cursor / etc. clients on a different machine need to talk to a hosted instance. At that point, port the standalone package and rebrand: `@paperclipai/mcp-server` → `@armyofagents/mcp-server`, bin `paperclip-mcp-server` → `aoa-mcp-server`, env vars stay as wire-protocol contracts (`PAPERCLIP_API_KEY` etc.) per Decision #92's rationale.

**Reference:** Plan `docs/superpowers/plans/2026-04-26-upstream-paperclip-resync.md` (Tier 5 / D1 skipped).

---

## Decision #94 — Skip Paperclip `pi-local` skill bin/ PATH support port

**Status:** Locked (2026-04-26)

**Context:** Paperclip commit `854fa817` adds skill `bin/` directories to the child process PATH for the `pi-local` adapter so AGENTS.md-invoked skill helpers (`paperclip-get-issue`, `paperclip-add-comment`, etc.) resolve without absolute paths during agent CLI runs.

**Decision:** Do NOT port. AoA's adapter set is `claude_local | opencode_local | openclaw | http | process | cursor | codex_local | hermes_local | gemini_local`. None of these are Paperclip's `pi-local`. Skill helpers via the PATH-prepending mechanism are not part of AoA's heartbeat protocol today — agents communicate with the AoA backend via the in-server MCP, not via shelling out to skill-bundled CLI binaries.

**Reasoning:**
- The Paperclip change targets a specific adapter (`pi-local`) that AoA does not have and has no plan to add (Sprint 2A / Decision #91 removed API-mode adapters; the adapter list is curated).
- AoA's equivalent agent-tool surface is the in-server MCP exposed via per-user keys — agents call MCP tools, not bundled CLI binaries.
- Adding generic skill-bin PATH support to AoA's other adapters (claude_local, codex_local, etc.) would be feature-creep without a concrete agent workflow that needs it.

**Revisit when:** AoA introduces a similar skill-helper protocol (e.g., bundled CLI binaries that run alongside the agent) or adopts a `pi-local`-family adapter. At that point the PATH-prepending logic in the existing adapter `execute.ts` files is the porting site.

**Reference:** Plan `docs/superpowers/plans/2026-04-26-upstream-paperclip-resync.md` (Tier 5 / D5 skipped).

---

## Decision #95 — Defer memory access model (Phase 6.2d) until team-under-Commander work has a concrete consumer

**Status:** Deferred (locked 2026-05-04)

**Context:** Phase 6.2 of the memory page redesign sketched (in `docs/superpowers/specs/2026-05-03-memory-layer-first-redesign-design.md` §11) a `MemoryAccessService` with `ActorContext` + `MemoryScope` enforcement — three caller classes (external MCP, Commander, worker agents) with permission ceilings, a unified scope filter type, and worker-default restrictions (Identity + own-dept Domain + own-task Working + tagged-shared). Phases 6.2a / 6.2b / 6.2c / 6.2e / 6.2f shipped the user-facing redesign; 6.2d (the access model implementation) was scoped as the final architectural slice.

During the 6.2d brainstorm (2026-05-04), the founder pushed for a more aggressive design: **no pre-baked context for any agent class** — full MCP for everything, including worker agents. Workers would receive only their task description + memory tools (`memory.search`, `memory.list`, `memory.create_working_item`) + a default skill prompt instructing them to fetch context as needed. Commander stays tool-based (already is). External MCP stays tool-based (already is). The pre-baked heartbeat context package shrinks dramatically or disappears.

**Decision:** Defer the entire 6.2d implementation. Write only the design notes; do not build until a concrete consumer exists.

**Reasoning:**
1. **No live consumer for worker scoping today.** Worker adapters (`claude_local`, `codex_local`, `opencode_local`, `openclaw`, `cursor`, `hermes_local`, `gemini_local`, `http`, `process`) do not have memory tools wired up. They consume the heartbeat-built context package and have no way to call `memory.search` mid-task. Adding tools to each adapter is part of the team-under-Commander architecture (Decision #91), not 6.2d.
2. **Commander already works.** Commander's 30 tools include memory tools today. It uses them. Phase 6.2d would not add functionality there — at best it would refactor the existing scope filter to a unified type.
3. **External MCP already works.** Tokens authenticate, get full company access. The `folderPath` filter could be added independently as a small polish slice if the founder wants it (see Revisit options).
4. **Speculative design risk.** Building the access model without a worker consumer means we'd be guessing at usage patterns sub-agents will reveal. When team-under-Commander lands, we'd likely refactor — better to design alongside the consumer.
5. **Founder's full-MCP preference reinforces this.** The aggressive "no pre-bake" model REQUIRES adapters to have memory tools. That's the team-under-Commander work.

**What we're NOT doing yet (and why):**
- `MemoryAccessService` + `ActorContext` types — no consumer that exercises them.
- Worker scope ceiling enforcement — no worker calls memory tools today.
- `sharedWithAgentIds` / tagged-sharing — no agent-tool surface to share into.
- Read audit log — workers don't read memory directly.
- Heartbeat refactor — invisible behavior change with no immediate upside.

**What stays valid in the §11 sketch (preserved for future):**
- Three consumer classes (external MCP / Commander / worker agents) with different default ceilings.
- Worker agents get the most restricted default.
- `MemoryScope` unified type covering layer + departmentId + folderPath + goalId + taskId.
- `ActorContext` derived from auth middleware (not caller-supplied) — caller can narrow within ceiling, never escalate.
- Future: per-agent or per-role grants via `sharedWithAgentIds` for explicit cross-scope access.

**Founder's revised vision (captured for future implementation):**
- Workers: no pre-bake. Task description + memory tools only. Default skill instructs use of `memory.search`, `memory.list`, `memory.create_working_item`. Working memory items lifecycle: archive on task close (current 7-day TTL behavior — keep).
- Commander: full MCP, no pre-bake. Already operating this way.
- External MCP: full MCP, token-authed. Already operating this way.

**Open questions to resolve when this is picked back up:**
1. Worker default scope precise rules (Active Context inclusion logic — by goal lineage, or excluded until tagged?).
2. `sharedWithAgentIds` design: per-agent UUID grants vs role tags vs both.
3. Read audit log: when, what, where (Commander's run summary? Settings? Inbox?).
4. Migration path for existing MCP clients passing `{layer}` only after the unified type lands.
5. Heartbeat context builder: shrink to bare minimum (task + working memory) when adapters gain tools, or eliminate entirely?

**Revisit when:**
- Team-under-Commander work begins (Decision #91 follow-up). At that point, sub-agents will need MCP tool access and the access model designs alongside the actual consumer.
- OR: founder wants the `folderPath` filter exposed via Commander or external MCP today — that's a small standalone slice (~½ day) without the broader access-ceiling infrastructure.

**Reference:** Spec `docs/superpowers/specs/2026-05-03-memory-layer-first-redesign-design.md` §11 (sketch + open questions). Brainstorm conversation logged 2026-05-04. Phase 6.2 shipped a/b/c/e/f without 6.2d.

---

## Decision #96 — Marketplace catalog sourced from external repo (`MeteoriteLabs/aoa-marketplace-cdn`)

**Status:** Locked 2026-05-08.

**Rule:** The marketplace catalog (`/api/marketplace/catalog`) is fetched at runtime from `https://meteoritelabs.github.io/aoa-marketplace-cdn/catalog.json`, with a build-time bundled snapshot fallback (`ui/src/aoa-marketplace-snapshot.json`, gitignored, generated by `pnpm fetch-catalog`). The schema in `packages/shared/src/marketplace.ts` is a **mirror** of the catalog repo's schema — it must stay in sync.

**Reasoning:** Separating catalog content from app code lets the catalog evolve independently (new items, version bumps, curation) without redeploying AoA. CDN hosting via GitHub Pages costs nothing and gives instant invalidation on push.

**Implications:**
- Schema bumps require coordinated changes in both repos. Zod schemas use the default `.strip()` mode (unknown fields silently dropped), so **additive changes** (new optional fields) don't require version bumps.
- Adding marketplace fields (e.g., `packageId` per Decision #97) means adding to the shared schema in this repo AND to the catalog generator in `MeteoriteLabs/aoa-marketplace-cdn`. AoA-side code that depends on a new field must handle the field being missing (e.g., synthesis from existing data).
- `CatalogSyncStatus.source` differentiates `"cdn"` (fresh fetch) vs `"bundled"` (build-time snapshot fallback when CDN is unreachable). The cached catalog in `marketplaceCatalogCache` table is the working copy the API serves from.

**Reference:** `server/src/services/aoa-marketplace.ts:24` (CDN URL constant), `scripts/fetch-bundled-catalog.ts` (build snapshot script), `packages/shared/src/marketplace.ts:3-4` (mirror comment).

---

## Decision #97 — Skill packages: synthesis-with-explicit-override hybrid (skill-only after `d8dd326`)

**Status:** Locked 2026-05-08, refined 2026-05-09.

**Rule:** A "marketplace package" is a synthetic grouping of catalog items that share a GitHub source repo. Packages are derived server-side via `derivePackages()`:

1. **Explicit override** — items with a non-empty `packageId` field group under that key (threshold: 1 item). The catalog repo can populate `packageId` to force grouping (e.g., curated bundles that span multiple repos, or one repo split into multiple packages).
2. **Synthesis fallback** — items without `packageId` group by `owner/repo` extracted from `source.url`. Threshold: ≥ 2 items. Items with non-github URLs are skipped from synthesis.
3. **Skill-only constraint** — synthesized packages require **all** members to have `type === "skill"`. Explicit `packageId` overrides accept any type. Reasoning: `PackageCard`'s amber + `Sparkles` visual is skill-themed (per design-system §9.14, §9.15); synthesizing a package from plugins/agents would mis-render the visual identity.
4. **Collision rule** — when an explicit `packageId` matches a synthesizable `owner/repo` ID, the explicit package wins; the synthesized one is suppressed for that ID.

Output is deterministic: packages sorted by `id` ascending, `memberItemIds` sorted ascending. `verified` is true iff every member has `trust.tier === "verified"` (strict).

**Reasoning:** The catalog repo doesn't emit `packageId` today, but synthesis from `source.url` works against existing data (gstack 49 skills, superpowers 14 skills). When the catalog repo eventually adds `packageId`, the explicit-override path activates without an AoA-side code change. **Forward-compatible from day one.**

**Implications:**
- Adding `packageId?: string` to `MarketplaceCatalogItemSchema` is purely additive (optional, Zod strips unknowns). No catalog schema version bump.
- UI surfaces (`PackageCard` §9.15, `MarketplacePackageDetail` page, "Part of X" pill §9.17) consume the derived `MarketplacePackage` type and don't care whether the package was synthesized or explicit.
- Future curated metadata (description, cover image, author profile) would arrive via the catalog repo emitting `packageId` plus a sibling metadata block — extension point only, not implemented.
- The Marketplace hub's sectioned view (design-system §9.18) embeds the Packages strip inside the Skills section, which only makes sense because of the skill-only constraint.

**Reference:** `server/src/services/derivePackages.ts`, `packages/shared/src/marketplace.ts` (`MarketplacePackageSchema`), 14 unit tests in `server/src/services/__tests__/derivePackages.test.ts`.

---

## Decision #98 — Primary sidebar auto-collapse rule: secondary takes over

**Status:** Locked 2026-05-09.

**Rule:** A page **force-collapses the primary sidebar on every mount** if and only if it provides a secondary sidebar. Pages without a secondary sidebar respect the user's manual primary-collapse preference (stored in `localStorage["aoa.lobby.sidebar-collapsed"]`).

Implementation: pages opt in by passing `defaultCollapsed={true}` to `LobbyShell`. The `LobbySidebar` state initializer treats `defaultCollapsed === true` as a **force-override** that supersedes localStorage on every mount. The user can still manually expand within that page (the manual toggle writes localStorage). Navigating away and back re-applies the force-collapse.

**Reasoning:** During the marketplace UI overhaul (Phase A) we briefly applied auto-collapse to all marketplace pages, rationalized as "give cards more horizontal room." User feedback during Phase D: the rule felt arbitrary — *"why does primary collapse on Marketplace? There's nothing taking over."* The cleaner mental model is: **primary collapses BECAUSE secondary takes over.** If there's no secondary sidebar, primary should stay where the user left it.

**Current consumers** (as of 2026-05-09):

- `InstanceSettingsPage` — has `SecondarySidebar` with 7 settings sections → `defaultCollapsed={true}`
- All marketplace pages (Hub, Search, Detail, PackageDetail, Updates) — no secondary sidebar → `defaultCollapsed` not passed
- Lobby — no secondary sidebar → `defaultCollapsed` not passed

**Reference:** `ui/src/components/LobbySidebar.tsx` (state initializer), design-system §8.1.1.
