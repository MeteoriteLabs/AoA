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
| 20 | ~~Sub-goals limited to one level deep~~ **(SUPERSEDED 2026-05-25)** | Superseded by the multi-parent goals model — goals form a freely-nested, multi-parent DAG; integrity (cycles + child⊆parent scope) enforced on write. See `docs/superpowers/plans/2026-05-25-threads-goals-followup.md` B0. |
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

**⚠️ Superseded by Decision #91 (Sprint 2A, 2026-04-24)**

Original decision: API-based agent loop as default; CLI-based via MCP as optional power-user mode. V2.5 ships API mode only; CLI mode deferred to V3.

**What changed:** Decision #91 removed API-mode execution entirely. Every turn now routes through `cliModeService` regardless of the legacy `executionMode` column (kept dormant for rollback safety). The `executionMode` column on `internal_agent_config` is no longer read by the dispatch path. See `server/src/services/internal-agent/agent-loop.ts` for the code comment.

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

## Decision (annotation, 2026-05-25): Task Outputs are an additive output index

AoA keeps `issues.artifactId` as the primary artifact pointer for artifact-as-input, MCP document tools, and existing artifact viewer flows. The new `task_outputs` table is an additive task-level product index for artifacts, detected files, preview URLs, runtime services, branches, and PRs. PRs, preview URLs, runtime services, and branches are task outputs, not artifacts.

---

## Decision #92 — Defer Phase 6 Hermes wire-field rename to upstream coordination

**Status:** Deferred (locked 2026-04-26)

**Context:** The Paperclip → AoA rename plan (`docs/archive/sessions/2026-04-25-paperclip-to-aoa-rename.md`) defined Phase 6 as renaming `paperclip_session_key` / `paperclip_stream_transport` JSON field names in the OpenClaw / Hermes wire payload (sent during agent execution from `packages/adapters/openclaw/src/server/execute-webhook.ts` and `packages/adapters/openclaw/src/server/execute-sse.ts`). Hermes is owned by an external project; renaming our send-side without coordinating their receive-side breaks the integration for any operator running an older Hermes build.

**Decision:** Phase 6 stays deferred until either (a) the Hermes maintainer confirms readiness for a coordinated rename, or (b) a Hermes adapter version ships that accepts both old and new names (one-release migration window), the minimum-required Hermes version in `package.json` is bumped to that release, and the old field names are removed from the execute files.

**Consequences:**
- Existing Hermes wire fields keep `paperclip_session_key` / `paperclip_stream_transport` names. Documented as wire-compat surface #8 in `docs/architecture/wire-compat.md`.
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

**Reference:** Plan `docs/archive/sessions/2026-04-26-upstream-paperclip-resync.md` (Tier 5 / D1 skipped).

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

**Reference:** Plan `docs/archive/sessions/2026-04-26-upstream-paperclip-resync.md` (Tier 5 / D5 skipped).

---

## Decision #95 — Defer memory access model (Phase 6.2d) until team-under-Commander work has a concrete consumer

**Status:** Deferred (locked 2026-05-04)

**Context:** Phase 6.2 of the memory page redesign sketched (in `docs/archive/sessions/2026-05-03-memory-layer-first-redesign-design.md` §11) a `MemoryAccessService` with `ActorContext` + `MemoryScope` enforcement — three caller classes (external MCP, Commander, worker agents) with permission ceilings, a unified scope filter type, and worker-default restrictions (Identity + own-dept Domain + own-task Working + tagged-shared). Phases 6.2a / 6.2b / 6.2c / 6.2e / 6.2f shipped the user-facing redesign; 6.2d (the access model implementation) was scoped as the final architectural slice.

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

**Reference:** Spec `docs/archive/sessions/2026-05-03-memory-layer-first-redesign-design.md` §11 (sketch + open questions). Brainstorm conversation logged 2026-05-04. Phase 6.2 shipped a/b/c/e/f without 6.2d.

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

**Reference:** `server/src/services/derivePackages.ts`, `packages/shared/src/marketplace.ts` (`MarketplacePackageSchema`), 21 unit tests in `server/src/services/__tests__/derivePackages.test.ts` (synthesis threshold, explicit override, collision resolution, deterministic ordering, verified math, skill-only constraint, mixed-type via explicit override, whitespace trimming, empty-string fallthrough).

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

---

## Decision #99 — Sub-Agent #1 (discussion extraction): durable poll, atomic claim, linked-run orphan recovery

**Status:** Locked 2026-05-17.

**Context:** Decision #95 deferred the team-under-Commander memory-access model until "a concrete consumer exists ... designs alongside the actual consumer." Sub-Agent #1 — the discussion-extraction consumer — is that first concrete consumer. It implements DA-17 (internal agent handles extraction, not a separate pipeline) as a durable background sub-agent, tracked via DA-27's `internal_agent_runs` (`triggerType='sub_agent'`, `triggerSource='discussion_entry'`).

**Rule:**

1. **Durable poll, NOT an event listener.** Sub-Agent #1's PRIMARY trigger is a durable sweep over `discussion_entries.extraction_status='pending'` (transactional-outbox pattern), registered on the server worker loop (`server/src/index.ts`, 45s interval, module-level in-flight guard). The committed `pending` row IS the work item — the in-memory LiveEvents bus is a lossy *secondary* nicety, never the correctness path. An entry committed while no listener is attached, or during a crash/restart, is still drained on the next tick.

2. **Atomic `pending→processing` claim.** `extractFromDiscussionEntry` claims via a single guarded `UPDATE ... SET extraction_status='processing' WHERE id=? AND extraction_status='pending' RETURNING` (replaced a non-atomic read-then-check). Guarantees at-most-once extraction even under concurrent pickup (sweeper tick racing the reprocess direct-call path). This also fixes a pre-existing reprocess race that predates the sub-agent.

3. **Linked-run orphan recovery.** The consumer links `discussion_entries.extraction_run_id` to its current `internal_agent_runs` row at run **creation — before** the atomic claim. The sweeper's orphan signal is: entry `processing` **AND** its LINKED run is `running` **AND** `created_at < staleCutoff`. Reclaim is atomic and guarded: terminalize that linked run → `failed` (so it can never re-trigger reclaim — no zombie `running` rows) **AND** reset the entry → `pending`, `extraction_run_id=null`. There is deliberately **NO** `extraction_run_id IS NULL` orphan branch: the only producer of (`processing`, `run_id` NULL) is the untouched reprocess direct-call path, which is *healthy in-flight* work — a NULL branch would false-reclaim it and cause double extraction. Reprocess-crash recovery is a tracked deferred follow-up, not in scope.

4. **Reserved per-company platform agent.** Sub-agent runs are attributed to a real but **non-dispatchable** `agents` row, `kind='platform'` ("Commander Team"). It is excluded from every user-facing enumeration (`agentService.list` / `orgForCompany` / `getByUrlKey` / dashboard / home / companies / issues — kind='org' filter applied only at user-facing sites; by-id / cost / budget / heartbeat paths are NOT filtered) and is structurally non-dispatchable (`runtimeConfig.heartbeat={enabled:false,intervalSec:0}` → heartbeat `tickTimers()` skips it via the existing `intervalSec<=0` gate). It is a real row because `cost_events.agentId` is a FK. It owns an **inactive** `budget_policies` row (unlimited-until-configured) so Commander-team spend reuses the existing budget system per DA-25.

5. **Trigger/executor-agnostic consumer + hard error boundary.** `runExtractionConsumer(db, companyId, entryId, platformAgentId)` does not know how it was triggered or where it runs. Any failure is caught and recorded (run → `failed` via a nested try/catch — Drizzle builders are thenables without `.catch`) and **never rethrown**, so extraction can never slow or break `addEntry` / chat / the sweep tick. Per Decision #95 this is a *minimal concrete consumer*, NOT a speculative sub-agent framework.

6. **v1 cost is zeroed (budget PATH proven, not amounts).** The consumer emits a platform-agent-scoped `cost_event` through the existing `costService.createEvent → budgetService.evaluateCostEvent` path. v1 amounts are zeroed (`callLLM` surfaces no token usage yet); the platform agent's inactive policy makes enforcement a structural no-op. This proves the budget path end-to-end without billing real money. Accurate per-extraction token/cost accounting is deferred.

**Reasoning:** The original event-listener design was lossy by construction (in-memory bus, no replay). Making the committed `pending` row the durable work item, plus an atomic claim, makes extraction crash-safe and exactly-once without a queue subsystem. Orphan recovery went through three TDD/review-caught bugs (never-resets → join-on-any-running zombie loop → null-branch double-extraction); the linked-run-only signal is the design that survives skeptical review. The platform agent reuses the existing budget/cost infrastructure rather than inventing a parallel one.

**Implications:**
- `packages/db/src/schema/agents.ts` gains a `kind text not null default 'org'` discriminator (migration `0098_flat_christian_walker.sql`); the default + backfill make it additive-safe for existing rows.
- Adding org-agent filters is *selective* — only user-facing enumeration sites. Cost/budget/heartbeat/by-id paths intentionally still see the platform agent.
- `staleMs` must stay conservatively larger than the longest legitimate extraction so healthy in-flight work is never reclaimed (server wires 10 min; the SQL `staleCutoff` predicate is the authority and is exercised by the Linux-CI integration test, not the Windows-runnable contract tests).
- The reprocess direct-call path (Q2-b) is untouched and remains the only (`processing`, `run_id` NULL) producer; reprocess-crash recovery is a deferred follow-up.

**Reference:** `server/src/services/internal-agent/subagents/{extraction-sweeper,extraction-consumer,platform-agent,concurrency-limiter}.ts`; `server/src/services/extraction.ts` (atomic claim); `server/src/index.ts` (sweep registration). Tests: `extraction-sweeper.test.ts`, `extraction-consumer.test.ts`, `extraction-consumer-contract.test.ts`, `extraction-atomic-claim.test.ts`, `platform-agent-seed.test.ts`, `concurrency-limiter.test.ts`, `extraction-sweeper-wiring.test.ts`, `agents-list-excludes-platform.test.ts` (+ `.integration.test.ts`, Linux-CI), `agents-kind-normalize.test.ts`, `agent-read-sites-org-filter.test.ts`. Implements DA-17; uses DA-27; cost attribution per DA-25; the concrete consumer Decision #95 / #91 (team-under-Commander) deferred for. Working spec/plan were `docs/superpowers/` material (gitignored); code is the authority per `CLAUDE.md`.

---

## Decision #100 — AoA Agents framework: Commander + sub-agents as trigger-driven first-class agents

**Status:** Locked 2026-05-17. **Amended 2026-05-25 (extraction routing).**

**Amendment (2026-05-25):** discussion-entry extraction now defaults to the
direct-provider path (`extractionService` → `resolveAvailableProvider`, Decision
A1), NOT the CLI-adapter agent runner. In practice the agent/CLI path could not
reliably submit results: codex/opencode have no MCP-bridge wiring yet
(`aoa-agents/runner.ts` injects `--mcp-config` for `claude_local` only) and the
claude CLI subprocess does not complete the `submit_extracted_items` handshake
in local / Windows dev — both finish the run but leave the entry stuck
`processing` (silent loss). The agent/CLI extraction path is now opt-in pending
hardening (bridge wiring for non-claude adapters + the claude headless submit
hang). The framework (Commander + crew + the durable dispatcher) is unchanged;
only `subagents/extraction-consumer.ts`'s execution target moved. This narrows
the "uniform CLI-adapter execution" clause below for the extraction sub-agent
only.

- **Uniform CLI-adapter execution:** every AoA agent (`kind='aoa'`: Commander + sub-agents) runs through the existing worker CLI adapter via a no-task runner; structured results persisted by the agent calling internal-agent MCP tools through the bridge (e.g. `submit-extracted-items`), not by parsing adapter stdout (`AdapterExecutionResult` returns no text). No hybrid/`structured_llm` executor. Provider-SDK stays a non-agent primitive (embeddings, transcription) — **Decision #91 honored, not superseded.**
- **Supersedes DA-27** clauses (b) no queue, (c) no atomic checkout, (d) no adapter abstraction, and the *wakeup* half of (e) — AoA agents use atomic-claim dispatch, the worker adapter, and trigger/wakeup. **Keeps** DA-27 (a) separate `internal_agent_runs` table and the *assignment/task* half of (e) (no founder-managed issue/task lifecycle).
- **Resolves Decision #95** — the deferred access model is implemented (per-agent tool allowlist, default-deny) against its now-concrete consumer.
- **Extends Decision #99** — the durable transactional-outbox trigger, atomic claim and orphan-recovery generalize framework-wide; the extraction sub-agent is the first migrated `kind='aoa'` citizen, its #99/M2 correctness preserved (the runner re-asserts the atomic `pending→processing` claim).
- **Discriminator:** `kind='aoa'` + `runtimeConfig.aoa.role` (`lead`|`member`); `agents.role` is NOT overloaded (it is special-cased: `role==='cxo'`, 0070 tiers).
- **Rationale:** a growing internal automation team needs real agentic execution + a uniform reusable model; ~70–75% is reuse of existing `agents`-keyed infrastructure. Spec: `docs/superpowers/specs/2026-05-17-aoa-agents-framework-design.md`.

---

## Decision #101 — Commander chat bubble + run-cost semantics (2026-06-16)

- The founder's own chat messages use a **neutral surface** (`bg-card`, `rounded-2xl`),
  NOT brand red (`bg-primary`). Brand red is reserved for primary CTAs; a filled
  brand-red bubble reads as an error. Actor is distinguished by alignment, not hue —
  mirroring the workspace timeline (`TimelineUserMessage.tsx`). Timestamps are
  hover-revealed (relative time), no avatars (1:1 chat).
- Commander **per-run cost is a list-price ESTIMATE**, always labeled "Est." CLI
  subscription runs report `total_cost_usd: 0` by design (see `cost-model.ts`); the
  estimate is `computeCostCents(model, tokens)`. Tokens are real. Cost is surfaced
  only in Settings → Run History, never in the chat. (Partially un-defers the
  per-run accounting deferral of Decision #91, for observability only.)

## Decision #102 — Thread action-commit idempotency: minimum bar ([#197]) + full outbox alignment ([#198]) (2026-06-18)

The thread-orchestration action-commit path (`thread-agent-actions.ts` / `thread-orchestration.ts`)
kept producing edge cases across three review rounds (stall → park → mixed-batch
duplicate) because "retry" meant "re-run the agent," and the agent re-proposed actions
with **run-scoped** idempotency keys (`${runId}:…`) + a **run-scoped** commit selection
(`eq(runId)`) over **non-idempotent** side-effects — the inverse of the transactional
outbox the org already locked in **Decision #99/#100** (where the stable key is the
entry id, not the run id). PR **[#197]** ships the **minimum non-flaky bar**, every part
a forward-compatible subset of the full fix:

- **Run-independent, turn-anchored keys** for the two highest-value action types
  (`post_reply`, `create_artifact_candidate`); the turn anchor is the latest human
  entry seq at run start (a same-turn retry dedups, two genuine turns stay distinct).
  The other four action types keep run-scoped keys (locked by a guard test).
- **`source_action_id`** column + partial unique index on `discussion_entries` and
  `artifacts` (migration `0145`); the commit converges on the unique violation
  (`isUniqueViolation`, which now reads the postgres-js `constraint_name`), so the same
  action can never produce two side-effects (closes the partial-crash / reaper re-commit).
- **`committed === 0` guard**: a mixed batch advances the cursor instead of re-running
  (no re-execution of already-committed actions); the failed action is dropped — not a
  duplicate, not a stall.
- **Bounded reschedule** on the adjutant-runner-throw and entries-load stall paths
  (reusing `consecutive_commit_failures`) so a deterministic failure can't park a thread.

Deferred to **[#198]** (full Decision #99 alignment): run-independent keys for all six
action types, **thread/company-scoped** commit selection (drop `eq(runId)`) + atomic
`proposed→committing` claim + a durable sweep that drains orphaned `proposed` rows, and a
real UI/Inbox surface for `lastError`. Residuals until then (all failure/edge-path only):
mixed-batch failed-action drop, possible duplicate *draft* on the deferred draft types'
retry path, and the agent-only-thread null-anchor content-dedup.

**Addendum (2026-06-19) — the SEAL: a `proposed→ready` producer-gate completes the outbox; the
relay drains `ready`, not raw `proposed`.** The #198 mechanism above shipped on PR [#203] and a
review round (Codex P1) found it re-creates the leak it set out to fix. A thread-action `proposed`
row is written MID-RUN (by a tool call in the mcp-bridge subprocess), **decoupled from run
success** — unlike #99's `pending` row, which is written in the producer's transaction and so
*means* "the producer committed." Because PR-B's thread-scoped drain selects every `proposed` row,
it commits the side-effects (reply / artifact / scope change / convene) of runs that **failed,
were cancelled, or crashed**. The fix supplies the missing producer-gate, completing the #99
alignment: a producing run, **ON SUCCESS**, promotes the actions it proposed (`proposed → ready`)
by its idempotency-key set — persisted on `internal_agent_runs.proposed_action_keys` (migration
`0147`) because the bridge subprocess and the seal site (the runner) are different processes, so an
in-memory key-set cannot cross. **The relay drains only sealed `ready` rows** (+ post-gate `failed`
retries); an unsealed `proposed` row is never committable; failed/crashed runs never seal and their
`proposed` rows are reaped by `gcOrphanedProposedActions`. This **amends** the #198 bullet: the
durable sweep drains `ready` (sealed), not raw `proposed` — same #99 intent (the committed/sealed
row IS the work item), corrected mechanism. Refs: PR [#203];
`docs/aoa/plans/2026-06-19-prb-outbox-seal-{design,implementation}.md` (adversarial review wf_65e3511f).

## Decision #103 — Plugin sandbox: scoped fs-read, but NO network-egress boundary at any trust tier (2026-06-21)

The plugin worker sandbox (`server/src/services/plugin-sandbox.ts`,
`buildSandboxExecArgv`) uses Node's `--permission` model for non-`core` trust tiers
(`untrusted` / `verified`). Two boundaries it does and does not provide:

- **Filesystem read — scoped (B-M4).** Previously `--allow-fs-read=*` granted full host
  read. It is now scoped to the plugin's package directory, its scratch dir, and the
  instance plugins root (`~/.aoa/plugins`). The plugins root is included because Node
  resolves a plugin's runtime dependencies from the hoisted
  `~/.aoa/plugins/node_modules` tree, so scoping reads to the package dir alone breaks
  module loading for npm-installed plugins. The plugins root is a strict subset of the
  host filesystem — it does not expose the host source tree, secrets, or the rest of the
  user's home directory. When the package dir cannot be resolved, fs-read falls back to
  the plugins root — never to `*`. `--allow-fs-write` stays scoped to scratch + tmp.

- **Network egress — NO boundary exists, at any trust tier.** Node's `--permission`
  model has **no** `--allow-net` flag (that is Deno). Network access from a plugin worker
  is therefore **unrestricted**: raw `node:https` / `node:net` / global `fetch` bypass the
  `http.outbound` capability check **and** the SSRF guard entirely. Those in-process
  controls only constrain the SDK `ctx.http.fetch` helper — a cooperative plugin's
  convenience path, not a security boundary. **A malicious or compromised plugin can make
  arbitrary outbound network calls regardless of its declared capabilities or trust tier.**
  Real egress control requires **OS-level isolation** (a network namespace, a seccomp /
  container sandbox, or a mandatory egress proxy) — it is not fixable with an in-process
  patch and is explicitly **out of scope** for the in-process sandbox. Tracked as separate
  infra work.

## Decision #104 — Optimistic concurrency for agent updates: optional `updatedAt` token → 409 (2026-06-25)

Agent updates (`PATCH /api/agents/:id` → `agentService.update`) were pure
last-write-wins (guarded by `id` only). Two concurrent human editors of the same
agent (two tabs / two board members) silently clobbered each other. This is
hardening, not a live fire — no MCP/automated path writes agents today — but the
fix is cheap and aligns with **Decision #45** ("founder picks winner — surface
conflicts, no auto-merge").

**Locked pattern:**
- **Token = the existing `agents.updatedAt`** (stamped on every write). No version
  column, **no DB migration**.
- **Optional / opt-in.** `updateAgentSchema` gains `expectedUpdatedAt?` (ISO
  datetime). Absent → last-write-wins (full back-compat; no caller breaks).
  Present → enforced.
- **Millisecond-precision guard (load-bearing).** `agents.updatedAt` is stored at
  Postgres **microsecond** resolution (`defaultNow()` on never-updated rows), while
  the client token is a **millisecond**-precision ISO string. A naked
  `eq(agents.updatedAt, expected)` would spuriously 409 (then loop) on the FIRST
  edit of a freshly-created agent. The guard therefore truncates **both sides to
  milliseconds**:

  ```ts
  where(and(eq(agents.id, id), sql`date_trunc('milliseconds', ${agents.updatedAt}) = ${new Date(expected)}`))
  ```

  The token does **not** round-trip losslessly — this `date_trunc` is what makes it safe.
- **Race-free atomic guard.** The check lives in the WHERE clause of the UPDATE —
  never a pre-read compare (that is TOCTOU). Zero rows matched **while the row still
  exists** → `conflict()` (HTTP **409**) with `details.currentUpdatedAt` (an **ISO
  string** — the service calls `.toISOString()`, since `errorHandler` doesn't coerce
  raw-`HttpError` `Date`s) so the client can refetch. Zero rows + row gone → `null` →
  404. Precedent: the atomic conditional UPDATE in `issues.ts` `checkout`. Proven
  against a real embedded Postgres (Linux-gated / Windows-skipped) because the
  mock-style unit tests can't evaluate the WHERE clause.
- **Scope = whole row.** The token guards the entire `agents` row (Skills vs
  Config conflicts included). False-positive 409s on non-overlapping fields are
  acceptable — a refetch resolves them. Field-level reconciliation via
  `agent_config_revisions.changedKeys` is a possible v2, not now.
- **UI opt-in (first wave):** Skills tab + Config save send `agent.updatedAt`
  from the query cache; on 409 they invalidate/refetch and toast "changed
  elsewhere — reloaded, please redo." The Skills tab advances a
  `latestExpectedUpdatedAt` ref from each successful update response (mirroring its
  `latestSkillKeys` ref) so back-to-back toggles before the refetch lands don't
  self-409 on a stale token. The transport-only token is destructured out on the
  route so it never reaches Drizzle `.set()`. Other editors can opt in later by
  passing the token.

Refs: `packages/shared/src/validators/agent.ts`, `server/src/services/agents.ts`,
`server/src/routes/agents.ts`, `ui/src/components/agent-detail/AgentSkillsTab.tsx`,
`ui/src/components/AgentConfigForm.tsx`;
`docs/aoa/plans/2026-06-25-agent-page-followups-design.md`.

[#197]: https://github.com/MeteoriteLabs/AoA/pull/197
[#198]: https://github.com/MeteoriteLabs/AoA/issues/198
[#203]: https://github.com/MeteoriteLabs/AoA/pull/203

---

## Decision #104 — Keyless-except-embeddings: selectable extraction engine + embedding resilience (2026-06-26)

**Status:** Locked 2026-06-26. **Amended 2026-06-27 (extraction is CLI-only; hosted-API fallback removed).**

**Amendment (2026-06-27):** The founder overrode the original "selectable engine"
ruling below. Discussion extraction (and every other extraction entry point —
debrief-push, file-import, the crew memory-extract tools) is now **CLI-only**: no
extraction code path ever reads a hosted provider key. The dormant `api` engine
(the `callLLM` / `callAnthropic` / `callOpenAI` direct-API path) and the
`GET …/extraction/engine-status` route + `ExtractionEngineStatusResponse` shared
type are **deleted**, not retained. `resolveExtractionEngine` now returns `"cli"`
or throws ("install a CLI and run its login"); there is no api fallback and no
key precheck. Hosted provider keys (the OpenAI `llm:openai` secret / env
`OPENAI_API_KEY`) are used **only** for embeddings. The Provider SDK utilities in
`server/src/services/internal-agent/providers/` remain for embeddings + Commander,
but are no longer reachable from any extraction path. UI: the Settings extraction
engine-status banner is removed and the "LLM providers" settings section is
renamed to **Memory** (OpenAI embeddings key only); extraction-failure copy points
at the local CLI, never at a key. See `docs/aoa/plans/2026-06-27-decouple-extraction-from-keys-spec.md`
and the matching PLAN. The original (now-superseded) selectable-engine ruling is
preserved below for history.

**Principle:** The only hosted API key AoA needs at runtime is for **embeddings** (`text-embedding-3-small` via OpenAI). Every other runtime operation — agent execution, Commander, and **discussion extraction** — runs keyless through the user's locally-installed CLI (Claude Code / Codex / Gemini CLI), authenticating against the subscription the user already has.

### Extraction: selectable engine ~~(SUPERSEDED 2026-06-27 — extraction is CLI-only, see amendment above)~~

**Rule:** `resolveExtractionEngine(db, companyId)` runs **before** the old hosted-key precheck and returns one of `cli` | `api`:

- `auto` (default): resolve `cli` when a local CLI is installed and authenticated; else resolve `api` when a hosted provider key is configured; else surface "no extraction engine available."
- Desktop installs default-resolve to `cli` — keyless extraction.
- ~~The `api` engine (the old `callLLM` direct-API path) is retained **dormant** as the fallback and as the seed for a future "per-company provider keys for crew/org adapters" initiative. It is NOT deleted.~~ **(Superseded 2026-06-27: the `api` engine, the `call*` functions, and the engine-status route/type are now DELETED. Extraction is CLI-only.)**

**Why Option B (server-side one-shot, not crew-bridge):** Decision #100 (amended 2026-05-25) shelved the crew-CLI extraction path because (a) the MCP bridge is wired for `claude_local` only — codex/opencode have no bridge wiring — and (b) the `claude` headless `submit_extracted_items` handshake hangs in local/Windows dev, leaving entries stuck `processing`. Option B invokes the CLI headless (`claude --print` / `codex exec`), captures stdout, parses the JSON array, and writes rows itself — exactly today's server-side structure, transport swapped. No MCP bridge, no handshake, no Decision #100 blockers.

**One-shot invocation:**
- claude: `claude --print --output-format text --system-prompt-file <promptfile>` — entry text on **stdin** (never argv, avoiding Windows cmd.exe mangling).
- codex: `codex exec --json -` — prompt on **stdin**, final assistant text extracted.
- ~60s timeout + grace kill. `cwd` = tmpdir (never reads the project CLAUDE.md).

**Windows prompt fix:** `cli-mode.ts` now delivers the user-content string via **stdin** for claude (not as an argv positional through cmd.exe). This fixes empty Commander turns on Windows and enables keyless claude extraction. The `--system-prompt-file` temp-file path is unchanged (already Windows-safe). No user/content string ever rides argv on Windows.

**Key files:** `server/src/services/extraction-engine.ts` (`resolveExtractionEngine`), `server/src/services/extraction-cli.ts` (one-shot invoker), `server/src/services/codex-exec.ts`, `server/src/services/internal-agent/cli-mode.ts` (Windows stdin fix).

### Embeddings: the sole hosted dependency

**Per-company key resolution:** The `createOpenAiEmbedder` chokepoint in `server/src/services/embeddings.ts` resolves the key per company — Settings secret `llm:openai` first, then env `OPENAI_API_KEY`. No other runtime code path hits the OpenAI API for anything except embeddings.

**Fake-embedder seam:** `AOA_E2E_FAKE_EMBEDDER=1` (env-gated at the `createOpenAiEmbedder` chokepoint) substitutes a deterministic hash-based embedder for CI, avoiding any OpenAI dependency in automated tests.

**Resilience model:**

| Error class | Examples | Handling |
|-------------|----------|----------|
| Transient | 429, 5xx, timeout, network | Exponential backoff + full jitter; honors `Retry-After`; `embedding_queue.next_retry_at` persisted |
| Row-permanent | Malformed / oversized input | Dead-letter fast → `failed` row |
| Systemic | No key / invalid key / `insufficient_quota` | Per-company circuit breaker: pause worker for that company, leave rows `pending` (not `failed`) so the backlog auto-drains when a valid key is added |

Claim: `SELECT … FOR UPDATE SKIP LOCKED` (per-company circuit breaker prevents burning a keyless backlog to `failed`).

**Backfill / catch-up:** On key-add and via a periodic reconciliation sweep, `reconcileNullVectors` enqueues every `memory_items` row with a null vector and no live queue row. Manual re-index endpoints for individual items and all failed items.

**New `embedding_queue` columns:** `company_id uuid` (nullable, populated on new enqueues), `next_retry_at timestamptz` (null = ready immediately).

### Memory write → RAG unification

Every memory write path — `memory.create()`, `memory.approve()`, crew `write_memory` tool, MCP `memory.write` / `memory.retain` / `suggest-memory` / `propose_memory_from_thread` — enqueues an embedding via `writeMemoryAndIndex` / `enqueueMemoryEmbedding` (status-agnostic, deduped). Closes a pre-existing gap where `memory.create()` never enqueued.

### Status model

Per-item `indexStatus` is derived (not stored): `indexed` (vector column not null), `pending` (live queue row pending/processing), `failed` (latest queue row failed), `not_indexed` / `no_key` (no vector, no live row). Surfaced as badges on memory card/row/table. A dismissible no-key banner shows on the Memory page / MemoryExplorer when `semanticAvailable` is false (deep-links to Settings → Memory). Actionable failure copy shown in DiscussionDetail on CLI errors. ~~Extraction-engine status shown in Settings.~~ **(Removed 2026-06-27 — the engine-status banner is deleted; extraction is CLI-only.)**

### New endpoints

- ~~`GET /companies/:cid/extraction/engine-status` — returns resolved engine, CLI availability, and failure details.~~ **(Deleted 2026-06-27 — extraction is CLI-only; the route + `ExtractionEngineStatusResponse` type are removed.)**
- `POST /companies/:cid/memory/:id/reindex` — enqueues a single memory item for re-embedding. Auth: `founder` | `team_lead`. Logs activity.
- `POST /companies/:cid/memory/reindex-failed` — enqueues all `failed` queue rows for this company. Auth: `founder` | `team_lead`. Logs activity.
- `POST /companies/:cid/memory/reindex-all` — enqueues every company memory item without a live queue row for re-embedding (dedup-safe; no-op without pgvector). Auth: **`founder`-only** (board + `assertRole(…, "founder")`). Logs activity. (Added 2026-06-27 — backs the Settings → Memory "Re-index all" button.)

**Reference:** `server/src/services/extraction-engine.ts`, `extraction-cli.ts`, `codex-exec.ts`, `embeddings.ts`, `embeddings-backfill.ts`, `memory-write.ts`, `server/src/routes/memory.ts`. Design: `docs/aoa/plans/2026-06-25-keyless-except-embeddings-design.md`; CLI-only amendment: `docs/aoa/plans/2026-06-27-decouple-extraction-from-keys-spec.md`.

### Embedding worker correctness + pgvector CI lane (2026-06-27 follow-up)

The embedding write path had **never executed end-to-end** — no CI lane set `AOA_E2E_PGVECTOR`, so the worker short-circuited before pgvector code. Running the real pgvector e2e locally surfaced three latent bugs (all now fixed, regression-gated):

1. **Raw-SQL timestamps are strings, not Date.** `db.execute(sql.raw(...))` with the postgres.js driver returns `timestamp`/`timestamptz` columns as **strings** (Drizzle's column type-mapping is bypassed for raw SQL). Feeding such a value into a Drizzle timestamp comparison calls `.toISOString()` on a string → throws. **Rule:** always coerce raw-claimed timestamps to `Date` before reuse (`embeddings-row-utils.ts: coerceQueueRowTimestamps`).
2. **Stale-write guard must exclude self by `id`, not by timestamp.** Coerced `Date`s are millisecond-precision while stored `timestamptz` is microsecond, so `created_at > $coerced` matches the row against itself. Use `ne(id, claimedId)` in both newer-row guards.
3. **Don't bind a `Date` into a raw `db.execute(sql\`…\`)` template** (drizzle-postgres-js execute throws `ERR_INVALID_ARG_TYPE`), and **don't write a pgvector value via a dynamic `.set({[col]: number[]})`** (bypasses the customType → array mis-binds). Write vectors as `.set({[col]: sql\`\${toVectorString(v)}::vector\`})` with a query-builder WHERE (typed `eq`/`ne`/`gt` convert `Date`+uuid correctly).

**CI:** a new required `e2e-pgvector` lane (`pgvector/pgvector:pg16` + `AOA_E2E_PGVECTOR=1`, wired into `ci-required`) now exercises the embedding **write + retrieval** path, including the first cosine-distance ranking assertion (`tests/e2e/semantic-retrieval.spec.ts`). Plan: `docs/aoa/plans/2026-06-27-embedding-pgvector-timestamp-fix-and-retrieval-tests.md`.
