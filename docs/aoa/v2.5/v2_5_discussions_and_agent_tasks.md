---
Feature: v2_5_discussions_and_agent
Doc type: tasks
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_decisions.md, CLAUDE.md
---

# V2.5 Discussions & Internal Agent — Tasks

Epic-level breakdown with subtasks, dependencies, execution order, and risk register. Tasks are prefixed: D = Document, T = Code Task, H = Handoff/Review.

Sequential build order: Schema → Backend Services → API Routes → Frontend → Integration → Testing → Polish.

---

## Epic 1: Schema & Data Model

Foundation. All other epics depend on this.

### D1 — Schema Design Document
- Produce `v2_5_discussions_and_agent_schema.md`
- Covers: new tables, modified tables, indexes, migration strategy, rollback plan
- **Depends on:** Decisions document (approved)
- **Blocks:** T1, T2

### T1 — Discussion Tables
- Create `discussions` table (thread container)
  - id, companyId, title, status, scopeType, scopeId (polymorphic link to project/dept/goal), tags (JSON), createdBy, createdAt, updatedAt
- Create `discussion_entries` table (individual messages in thread)
  - id, discussionId, inputType (paste/write/voice/mcp), rawContent, title, sourceInfo (JSON), departmentId, projectId, goalId, createdBy, createdAt
- Create `discussion_extracted_items` table (replaces brief_items)
  - id, discussionEntryId, type (decision/task/insight/context/reference/preference), title, description, suggestedPriority, suggestedDepartmentId, suggestedProjectId, suggestedLayer, layer, dedupAction, selectedMemoryId, mergedContent, status (pending/approved/rejected/edited), resultTaskId, resultMemoryId, createdAt, updatedAt
- Create `discussion_annotations` table
  - id, discussionEntryId, content, position (nullable, for inline annotations), createdBy, createdAt
- Add indexes: companyId, discussionId, status, (companyId + status)
- Run `pnpm db:generate`
- **Depends on:** D1
- **Blocks:** T5, T6, T7, T8

### T2 — Internal Agent Tables
- Create `internal_agent_config` table
  - id, companyId (unique), executionMode ('api'/'cli'), provider, model, autonomyLevel (default 0), enabledCapabilities (JSON), notificationPreference ('silent'/'digest'/'realtime'), contextTokenBudget (default 8000), budgetMonthlyCents, spentMonthlyCents, cliTool, metadata (JSON), createdAt, updatedAt
- Create `internal_agent_conversations` table
  - id, companyId, userId, status ('active'/'archived'), createdAt, updatedAt
- Create `internal_agent_messages` table
  - id, conversationId, role ('user'/'assistant'/'system'/'tool'), content (text), toolCalls (JSON, nullable), toolResults (JSON, nullable), pageContext (text, nullable — which page user was on), tokenCount (integer, nullable), createdAt
- Create `internal_agent_runs` table (per DA-27)
  - id, companyId, triggerType, triggerSource, status, toolsCalled (JSON), tokenUsage (JSON), costCents, durationMs, summary, departmentContext (uuid nullable), userId (nullable), conversationMessageId (nullable), relatedEntityType (nullable), relatedEntityId (nullable), createdAt, completedAt
- Create `internal_agent_reminders` table
  - id, companyId, userId, content, triggerAt (timestamp), status ('pending'/'fired'/'cancelled'), relatedEntityType, relatedEntityId, createdAt
- Create `workflow_templates` table
  - id, companyId, name, description, steps (JSON — ordered array of {title, description, role, assigneeType, departmentId, estimatedDuration}), dependencies (JSON — array of {fromStep, toStep}), createdBy, createdAt, updatedAt
- Create `notifications` table
  - id, companyId, userId (recipient), type (discussion.extraction_complete, internal_agent.reminder, etc.), title, message, relatedEntityType, relatedEntityId, readAt (nullable), dismissedAt (nullable), createdAt
- Add indexes for all tables
- Export new tables from `packages/db/src/schema/index.ts`
- Run `pnpm db:generate`
- **Depends on:** D1
- **Blocks:** T9, T10, T11, T12, T13

### T3 — Data Migration: Debriefs → Discussions
- Write migration script (Drizzle, not raw SQL)
- For each existing debrief:
  - Create a `discussions` row (title from debrief.title, scopeType/scopeId from departmentId/projectId/goalId)
  - Create a `discussion_entries` row (rawContent, inputType, sourceInfo from debrief)
- For each existing brief + brief_items:
  - Map brief_items to `discussion_extracted_items` linked to the discussion_entry
  - Preserve approval status (pending/approved/rejected)
  - Preserve resultTaskId and resultMemoryId links
- Verify data integrity: count debriefs = count discussions, count brief_items = count extracted_items
- **Depends on:** T1
- **Blocks:** T7 (frontend needs migrated data)

### T4 — Schema Shared Types
- Add Discussion types to `packages/shared/src/`
  - Constants: `DISCUSSION_STATUSES`, `DISCUSSION_ENTRY_INPUT_TYPES`, `EXTRACTION_ITEM_TYPES`, `EXTRACTION_ITEM_STATUSES`, `AGENT_CAPABILITIES`, `TRIGGER_TYPES`, `TRIGGER_SOURCES`, `NOTIFICATION_TYPES`
  - Types: DiscussionStatus, DiscussionEntryInputType, ExtractedItemType, ExtractedItemStatus, InternalAgentConfig, ConversationMessage, AgentRun, WorkflowTemplate, WorkflowStep, NotificationType
  - Add `LiveEventType` union additions: `'discussion.entry.created'`, `'discussion.extraction.completed'`, `'discussion.extraction.failed'`, `'internal_agent.greeting'`, `'internal_agent.reminder'`, `'internal_agent.notification'`
- Add validators (zod schemas) for all new types:
  - `createDiscussionSchema`, `updateDiscussionSchema`, `createDiscussionEntrySchema`
  - `updateInternalAgentConfigSchema`, `chatMessageSchema`
  - `createWorkflowTemplateSchema`, `updateWorkflowTemplateSchema`
  - `approveItemsSchema`, `createAnnotationSchema`
- Export all from `packages/shared/src/index.ts`
- **Depends on:** T1, T2
- **Blocks:** T5, T6, T7, T8, T9

---

## Epic 2: Internal Agent Backend (Core)

The brain. This is the most complex epic.

### D2 — Architecture Document
- Produce `v2_5_discussions_and_agent_architecture.md`
- Covers: agent loop design, tool registry, provider abstraction, context assembly, streaming
- **Depends on:** Decisions document
- **Blocks:** T5, T9

### D3 — API Contract Document
- Produce `v2_5_discussions_and_agent_api_contract.md`
- All new/changed endpoints with request/response/error shapes
- **Depends on:** D1, D2
- **Blocks:** T6, T7, T8

### T5 — Tool Registry
- Create `server/src/services/internal-agent/tool-registry.ts`
- Define tool interface:
  ```typescript
  interface AgentTool {
    name: string;
    description: string;
    parameters: JSONSchema;
    category: 'discussion' | 'query' | 'action' | 'memory' | 'workflow' | 'file' | 'coordination' | 'analysis';
    execute: (params: unknown, context: ToolExecutionContext) => Promise<ToolResult>;
  }
  ```
- Implement all 30 core tools as thin wrappers around existing services:
  - Discussion tools (3): extract_from_content, search_discussions, link_discussion_to_project
  - Query tools (6): query_tasks, query_goals, query_agents, query_departments, query_budget, query_activity
  - Action tools (8): create_task, update_task, create_department, create_goal, create_agent, update_agent, assign_task, wakeup_agent
  - Memory tools (5): query_memory, create_memory, update_memory, find_similar_memory, detect_conflicts
  - Workflow tools (3): create_workflow_template, instantiate_workflow, add_task_dependency
  - File tools (2): read_file, write_file
  - Coordination tools (1): query_dependency_chain
  - Analysis tools (2): analyze_workload, suggest_improvements
- Tool selection layer: given a user message, return relevant tool subset
- Export tools in both internal format and MCP-compatible format
- **Depends on:** T1, T2, T4, D2
- **Blocks:** T9, T10

### T6 — Discussion Service
- Create `server/src/services/discussions.ts` (factory pattern: `export function discussionService(db: Db) { return { ... } }`)
- CRUD for discussions + entries + annotations
- Entry processing: when a new entry is added, trigger internal agent extraction
- Thread connection suggestions: semantic similarity between discussions
- Scope resolution: entry-level > discussion-level > null (mirrors Decision #61 pattern)
- Extracted item approval: atomic transaction creating tasks + memory items (mirrors current brief approval logic)
- Link/unlink entries between threads
- Add activity logging for all mutations: `discussion.created`, `discussion.entry.created`, `discussion.item.approved`, `discussion.item.rejected`
- Create notification records on extraction completion/failure
- Export from `server/src/services/index.ts`: `export { discussionService } from "./discussions.js";`
- **Depends on:** T1, T4, D3
- **Blocks:** T8

### T7 — Discussion Routes
- Create `server/src/routes/discussions.ts`
- Endpoints:
  - `GET /companies/:companyId/discussions` — list with filters (status, scope, source, has pending items)
  - `GET /companies/:companyId/discussions/:id` — get discussion with entries and extracted items
  - `POST /companies/:companyId/discussions` — create discussion (optionally with first entry)
  - `POST /companies/:companyId/discussions/:id/entries` — add entry to discussion
  - `PATCH /companies/:companyId/discussions/:id` — update discussion (title, scope, tags)
  - `POST /companies/:companyId/discussions/:id/entries/:entryId/reprocess` — re-extract with updated context
  - `PATCH /companies/:companyId/discussions/:discussionId/entries/:entryId/items/:itemId` — update extracted item
  - `POST /companies/:companyId/discussions/:id/approve` — approve extracted items (creates tasks + memory)
  - `POST /companies/:companyId/discussions/:id/entries/:entryId/annotations` — add annotation
  - `POST /companies/:companyId/discussions/link` — link entry to different thread
- MCP inbound route: update `/companies/:companyId/debriefs/mcp` → route through Discussion pipeline
- Register routes in `server/src/app.ts`: `api.use(discussionRoutes(db));`
- **Depends on:** T6, D3
- **Blocks:** T16, T17

### T8 — Deprecate Debrief/Brief Routes
- Mark old debrief routes as deprecated (keep functional during transition)
- Add redirect middleware: old brief URLs → new discussion URLs
- Update MCP inbound to create discussion entries instead of debriefs
- **Depends on:** T3, T7
- **Blocks:** T20

---

## Epic 3: Internal Agent Service

### T9 — Agent Loop Service
- Create `server/src/services/internal-agent/agent-loop.ts`
- Provider abstraction:
  - `AnthropicProvider` — Anthropic messages API with tool_use
  - `OpenAIProvider` — OpenAI chat completions with function calling
  - `GeminiProvider` — Google Gemini with function calling
- Agent loop: message → LLM call with tools → tool execution → repeat until text response
- Context assembly:
  - Company identity (from companies table + identity memory)
  - Department context (if department persona active)
  - Conversation history (recent full + summarized older)
  - Current page context (from frontend)
  - Tool definitions (relevant subset based on message)
- Streaming: SSE or WebSocket push for real-time response delivery
- Run tracking: create `internal_agent_runs` record for every execution
- Cost tracking: log to `cost_events` with source 'internal_agent'
- Error handling: graceful degradation if tool fails, retry logic, timeout
- **Depends on:** T2, T4, T5, D2
- **Blocks:** T10, T11, T14

### T10 — Conversation Management Service
- Create `server/src/services/internal-agent/conversation.ts`
- Manage conversation history: create, append, retrieve
- Summarization: when conversation exceeds token threshold, summarize older messages
- Context retrieval: pull relevant past conversation segments when agent detects need
- Reset: clear conversation while preserving summarized history
- One conversation per user per company
- **Depends on:** T2, T9
- **Blocks:** T14

### T11 — Proactive Agent Service
- Create `server/src/services/internal-agent/proactive.ts`
- Scheduled checks (configurable interval, default 4 hours):
  - Blocked task scan
  - Budget threshold alerts
  - Stale work detection
  - Dependency chain gaps
  - Memory conflict scan
  - Workload imbalance
- Morning digest: generates briefing on first login of the day
- Reminder system: check `internal_agent_reminders`, fire when due
- TTL expiry checks: memory items approaching expiration
- Each check creates an `internal_agent_runs` record
- Results pushed to Inbox + agent panel greeting
- **Depends on:** T2, T9, T5
- **Blocks:** T15

### T12 — Event Listener Service
- Create `server/src/services/internal-agent/event-listener.ts`
- Subscribe to existing LiveEvents system
- Route relevant events to internal agent triggers:
  - `heartbeat.run.status` (terminal) → trigger `task_completed` or `agent_error`
  - `activity.logged` (task status change) → trigger `task_status_change`
  - MCP inbound → trigger `mcp_inbound`
  - Discussion entry created → trigger `discussion_entry`
- Each event trigger creates an `internal_agent_runs` record
- Debounce: don't fire multiple triggers for the same event within 30 seconds
- **Depends on:** T2, T9
- **Blocks:** T15

### T13 — CLI Execution Mode
- Create `server/src/services/internal-agent/cli-mode.ts`
- When execution mode is 'cli':
  - Expose AoA tools as MCP server (extend existing V2 MCP outbound)
  - Spawn CLI process (Claude CLI / Codex) with MCP config
  - Route conversation through CLI agent loop instead of API loop
  - Capture output, stream to frontend
- MCP tool handlers: map tool calls to same service functions as API mode
- Session management: CLI session persistence between conversation turns
- Fallback: if CLI not available, show error and suggest switching to API mode
- **Depends on:** T5, T9
- **Blocks:** T15 (testing)

### T13a — Internal Agent Routes
- Create `server/src/routes/internal-agent.ts` (factory pattern: `export function internalAgentRoutes(db: Db)`)
- Endpoints:
  - `POST /companies/:companyId/internal-agent/chat` — SSE streaming chat endpoint
  - `POST /companies/:companyId/internal-agent/confirm` — confirm/reject pending action
  - `GET /companies/:companyId/internal-agent/conversation` — get current conversation history
  - `POST /companies/:companyId/internal-agent/conversation/reset` — reset conversation
  - `GET /companies/:companyId/internal-agent/config` — get agent config
  - `PATCH /companies/:companyId/internal-agent/config` — update agent config (founder-only)
  - `GET /companies/:companyId/internal-agent/runs` — get run history (founder-only)
  - `GET /companies/:companyId/internal-agent/reminders` — get active reminders
  - `DELETE /companies/:companyId/internal-agent/reminders/:id` — cancel reminder
- Register in `server/src/app.ts`: `api.use(internalAgentRoutes(db));`
- Export from `server/src/services/index.ts` as needed
- **Depends on:** T9, T10, T11, T12
- **Blocks:** T14, T15

### T13b — Workflow Template Routes
- Create `server/src/routes/workflow-templates.ts`
- Endpoints:
  - `GET /companies/:companyId/workflow-templates` — list templates
  - `GET /companies/:companyId/workflow-templates/:id` — get template
  - `POST /companies/:companyId/workflow-templates` — create template (founder-only)
  - `PATCH /companies/:companyId/workflow-templates/:id` — update template (founder-only)
  - `POST /companies/:companyId/workflow-templates/:id/instantiate` — instantiate template for a goal
  - `DELETE /companies/:companyId/workflow-templates/:id` — delete template (founder-only)
- Register in `server/src/app.ts`: `api.use(workflowTemplateRoutes(db));`
- **Depends on:** T5 (if workflow service is part of T5), T4
- **Blocks:** T20

### T13c — Notification Service & Routes
- Create `server/src/services/notifications.ts` (factory pattern)
  - `create(companyId, data)` — create notification
  - `list(companyId, userId, filters)` — list notifications for user
  - `markRead(id)` — mark as read
  - `dismiss(id)` — dismiss
  - `getUnreadCount(companyId, userId)` — for badge counts
- Create `server/src/routes/notifications.ts`
  - `GET /companies/:companyId/notifications` — list for current user
  - `PATCH /companies/:companyId/notifications/:id/read` — mark read
  - `PATCH /companies/:companyId/notifications/:id/dismiss` — dismiss
  - `GET /companies/:companyId/notifications/unread-count` — badge count
- Register in `server/src/app.ts`
- Export from `server/src/services/index.ts`
- Update `sidebarBadgeService` to include notification unread count
- **Depends on:** T2
- **Blocks:** T23

---

## Epic 4: Frontend — Discussions

### T14 — Internal Agent Panel (Right Sidebar)
- Create `ui/src/components/InternalAgentPanel.tsx`
- Collapsible right panel component (similar to task slide-over but global)
- Chat interface: message input, message list, streaming response display
- Context indicator: shows which page the user is on
- "Processing" indicator when agent is mid-run
- Tool execution display: "Checking your tasks...", "Creating department..."
- Quick action buttons in agent responses (confirm/reject inline)
- "New conversation" / reset button
- Greeting message: summary of background activity since last visit
- Expand/collapse toggle
- Create `ui/src/context/AgentPanelContext.tsx`
  - Panel open/closed state
  - Current conversation
  - Streaming state
- Update `ui/src/components/Layout.tsx`:
  - Add agent panel alongside main content area
  - Three-column layout: left sidebar + main + right panel (when open)
  - Responsive: panel collapses on smaller screens
- Update `ui/src/components/BreadcrumbBar.tsx`:
  - Add agent panel toggle button (right side, next to search)
- Update `ui/src/components/MobileBottomNav.tsx`:
  - Replace Create button with AoA agent toggle (center position)
- Mobile: agent panel as full-screen sheet (DA-23)
- **Depends on:** T9, T10, D3
- **Blocks:** T18

### T15 — Agent Panel API Client + Frontend Wiring
- Create `ui/src/api/internal-agent.ts`
- Functions:
  - `sendMessage(companyId, message, pageContext)` — sends message, returns streaming response
  - `getConversation(companyId)` — get current conversation history
  - `resetConversation(companyId)` — start fresh
  - `getAgentConfig(companyId)` — get internal agent settings
  - `updateAgentConfig(companyId, config)` — update settings
  - `getAgentRuns(companyId, filters)` — get run history
  - `getAgentReminders(companyId)` — get active reminders
- Create `ui/src/api/discussions.ts` — discussion API client functions
- SSE client for streaming responses (POST-based, not EventSource — see gotchas 5.2)
- Add new query keys to `ui/src/lib/queryKeys.ts`: `discussions`, `discussion`, `agentConversation`, `agentConfig`, `agentRuns`, `agentReminders`, `workflowTemplates`
- Add new WebSocket event handlers in `LiveUpdatesProvider` for discussion + agent events
- **Depends on:** D3
- **Blocks:** T14

### T16 — Discussions List Page
- Create `ui/src/pages/Discussions.tsx` (replaces Briefs.tsx)
- List view with filters:
  - Status: has pending items / all reviewed / all
  - Scope: by department, project, goal
  - Source: paste, write, voice, MCP
  - Date range
- Each discussion row shows: title, scope tags, entry count, unreviewed item count, last entry date, source badges
- "New Discussion" button → quick capture modal or navigation
- Sort by: most recent entry, most pending items
- Badge count in sidebar for discussions with pending items
- **Depends on:** T7, T4
- **Blocks:** T18

### T17 — Discussion Detail Page
- Create `ui/src/pages/DiscussionDetail.tsx`
- Thread view: entries displayed chronologically
- For each entry:
  - Raw content display (transcript text)
  - Source badge (paste/write/voice/MCP)
  - Timestamp
  - Extracted items shown below (inline review):
    - Pending items: checkbox + edit controls (priority, department, layer, dedup)
    - Approved items: green checkmark, read-only
    - Rejected items: greyed out
  - Annotation support: click to add annotations at any point
- "Confirm All" button for quick approval of all pending items
- "Review individually" expands full edit controls
- Bottom input bar: add new entry (paste/write/voice tabs)
- Thread info sidebar: scope, linked project/dept, tags, related discussions
- "Reprocess" button per entry (re-extract with updated context/annotations)
- **Depends on:** T7, T16
- **Blocks:** T18

### T18 — Discussion Quick Capture Modal
- Refactor `ui/src/components/DebriefModal.tsx` → `DiscussionCaptureModal.tsx`
- Same input modes: Paste, Write, Voice
- Add: "Add to existing Discussion" dropdown (recent discussions, searchable)
- Default: new standalone Discussion
- After submission: async processing, notification when ready
- No blocking spinner (unlike current debrief flow)
- Register in DialogContext: `openDiscussionCapture()`
- Update Cmd+K palette: "New Discussion" action
- Update Home page quick actions: replace "Debrief" with "Discussion"
- **Depends on:** T7, T16
- **Blocks:** T20

### T19 — Discussions Tab on Project/Department Pages
- Update `ui/src/pages/ProjectDetail.tsx`
- Add "Discussions" tab
- Shows discussions filtered by scope (tagged to this project/department)
- "New Discussion" button pre-scoped to project/department
- Reuses DiscussionsList component from T16
- **Depends on:** T16
- **Blocks:** T20

---

## Epic 5: Frontend — Settings & Configuration

### T20 — Internal Agent Settings UI
- Add new section to Settings page (or dedicated sub-page)
- Configuration fields:
  - Execution mode: API / CLI toggle
  - If API: Provider dropdown (Anthropic/OpenAI/Google), Model dropdown (dynamic), API key reference
  - If CLI: CLI tool dropdown (Claude CLI/Codex/OpenCode)
  - Autonomy level: Level 0 only in v2.5 (shown but disabled for higher levels)
  - Enabled capabilities: checkboxes for each of the 12 capabilities
  - Notification preference: Silent / Digest / Real-time
  - Context token budget: slider or dropdown (compact/standard/large)
  - Monthly budget: input field (cents)
  - Current spend: display + progress bar
- Run history section: list of recent runs with trigger type, status, cost, duration
- Environment test: "Test connection" button to verify API key / CLI availability
- **Depends on:** T2, T15
- **Blocks:** T21

### T21 — Budget Integration
- Update Budget section in Settings to show internal agent as separate line
- Aggregate view: total company spend = worker agents + internal agent
- Internal agent budget: monthly limit, current spend, % used, projected
- 80% warning / 100% pause indicators
- Historical cost chart for internal agent
- **Depends on:** T20
- **Blocks:** T22

---

## Epic 6: Integration & Wiring

### T22 — Sidebar & Navigation Updates
- Update `ui/src/components/Sidebar.tsx`:
  - Replace "Briefs" → "Discussions" (FileText icon or new icon)
  - Reorder WORK section: Discussions, Tasks, Agents, Goals
  - Badge: count of discussions with pending items
- Update routing in `ui/src/App.tsx`:
  - `/discussions` → Discussions list page
  - `/discussions/:id` → Discussion detail page
  - Redirect `/briefs` → `/discussions`
  - Redirect `/briefs/:briefId` → corresponding discussion
- Update Inbox (T23)
- **Depends on:** T16, T17, T14
- **Blocks:** T23

### T23 — Inbox Integration
- Update `ui/src/pages/Inbox.tsx`:
  - Replace "Briefs Awaiting Review" section → "Discussion Items Pending Review"
  - Each item links to the Discussion detail page (not old BriefReview)
  - Add "Agent Alerts" section: proactive notifications from internal agent
  - Add "Reminders" section: fired reminders from internal agent
- Update inbox notification counts
- **Depends on:** T22, T11
- **Blocks:** T24

### T24 — Home Page Updates
- Update `ui/src/pages/Dashboard.tsx`:
  - Replace Debrief quick action → Discussion quick action
  - Replace "Briefs" references in action groups → "Discussions"
  - Add agent panel greeting widget (or integrate with existing suggestions)
  - Morning digest display (if agent has generated one)
- **Depends on:** T22, T23
- **Blocks:** T25

### T25 — WebSocket/Live Updates Integration
- Update LiveUpdatesProvider to handle internal agent events:
  - New event types: `internal_agent.message`, `internal_agent.run.status`, `internal_agent.reminder`
  - On `internal_agent.message` → update agent panel conversation
  - On `internal_agent.run.status` → update processing indicators
  - On `internal_agent.reminder` → push notification to Inbox + panel
- Update server-side `live-events.ts` to publish internal agent events
- **Depends on:** T9, T11, T12, T14
- **Blocks:** T26

---

## Epic 7: Extraction Refactor

### T26 — Migrate Extraction to Internal Agent
- Refactor `server/src/services/extraction.ts`:
  - Move current extraction prompt logic into `extract_from_content` tool
  - Add context enrichment: thread history, existing tasks/memory, annotations
  - Agent loop handles extraction (multi-turn if needed) instead of one-shot LLM call
  - Fallback: if internal agent is not configured, use legacy one-shot extraction
- Update Discussion entry processing to use internal agent for extraction
- Dedup awareness: agent checks existing tasks/memory before creating new items
- Conflict detection: agent flags contradictions with existing decisions
- **Depends on:** T5, T9, T6
- **Blocks:** T27

---

## Epic 8: Workflow/SOP

### T27 — Workflow Template Service
- Create `server/src/services/workflow-templates.ts`
- CRUD for workflow templates
- Instantiation: given a template + goal/project, create tasks with dependencies
  - Each step → task with proper priority, department, and role-based assignee suggestion
  - Dependencies from template → `task_dependencies` rows
  - Link all tasks to the goal
- Internal agent integration: `create_workflow_template` and `instantiate_workflow` tools call this service
- **Depends on:** T2, T5
- **Blocks:** T28

### T28 — Workflow Routes
- Create `server/src/routes/workflow-templates.ts`
- Endpoints:
  - `GET /companies/:companyId/workflow-templates` — list templates
  - `GET /companies/:companyId/workflow-templates/:id` — get template
  - `POST /companies/:companyId/workflow-templates` — create template
  - `PATCH /companies/:companyId/workflow-templates/:id` — update template
  - `POST /companies/:companyId/workflow-templates/:id/instantiate` — create tasks from template
  - `DELETE /companies/:companyId/workflow-templates/:id` — delete template
- **Depends on:** T27
- **Blocks:** T29

---

## Epic 9: Documentation & Testing

### D4 — Remaining Documents
- Produce all remaining spec documents:
  - `_prd.md` — full PRD
  - `_flow.md` — user flows, state machines
  - `_permissions.md` — access control
  - `_integration.md` — LLM provider integration, MCP
  - `_testing.md` — test plan
  - `_rollout.md` — rollout strategy
  - `_dependencies.md` — library choices
  - `_gotchas.md` — traps and edge cases
  - `_security.md` — attack surface
  - `_env.md` — environment variables
- **Depends on:** D1, D2, D3
- **Blocks:** T29

### T29 — Unit Tests
- Tool registry tests: each tool returns expected shape, handles errors
- Discussion service tests: CRUD, extraction flow, approval transaction
- Agent loop tests: mock LLM responses, verify tool execution sequence
- Conversation management tests: summarization, reset, retrieval
- Proactive checks: mock system state, verify suggestions generated
- Event listener: mock events, verify trigger routing
- Workflow template tests: instantiation creates correct tasks + dependencies
- Migration tests: verify debrief → discussion data integrity
- Follow existing test patterns: pure function tests + sequence-based mock DBs
- **Depends on:** T5, T6, T9, T10, T11, T12, T27
- **Blocks:** T31

### T30 — Integration Tests
- Full discussion flow: create discussion → add entry → agent extracts → approve → tasks created
- Agent panel flow: send message → agent calls tools → response streamed
- Proactive flow: scheduled check fires → notification created → shows in inbox
- MCP inbound → discussion created → agent processes → items pending
- Workflow flow: create template → instantiate → tasks with dependencies created
- CLI mode: agent processes via CLI + MCP (if testable in CI)
- **Depends on:** T29
- **Blocks:** T31

### T31 — QA & Edge Cases
- Edge case tests (v2.5 specific):
  - Discussion with 100+ entries (performance)
  - Agent tool that returns error mid-loop (graceful degradation)
  - Concurrent conversation turns (race condition handling)
  - Budget exceeded mid-conversation (agent pauses gracefully)
  - MCP flood: 50 entries in rapid succession (debounce/queue)
  - Discussion migration: debrief with failed extraction (processing_failed status)
  - Thread merge: move entry between discussions (referential integrity)
  - Conversation summarization: verify context coherence after summary
- **Depends on:** T29, T30
- **Blocks:** H2

---

## Epic 10: Cleanup & Polish

### T32 — Remove Old Debrief/Brief UI
- Delete `ui/src/components/DebriefModal.tsx` (replaced by DiscussionCaptureModal)
- Delete `ui/src/pages/Briefs.tsx` (replaced by Discussions)
- Delete `ui/src/pages/BriefReview.tsx` (replaced by DiscussionDetail inline review)
- Delete `ui/src/api/debriefs.ts` and `ui/src/api/briefs.ts` (replaced by discussions.ts)
- Remove debrief/brief references from DialogContext
- Clean up imports across all files
- **Depends on:** T22, T23, T24
- **Blocks:** H2

### T33 — Update CLAUDE.md
- Update Critical Rule #5: "MCP inbound always routes through Discussion pipeline"
- Update Key Architecture section: add Discussions, Internal Agent
- Update Naming Map: add Discussion entries
- Update Sidebar Structure
- Add v2.5 tables to schema documentation
- Add v2.5 modified tables
- **Depends on:** T32
- **Blocks:** H2

---

## Handoffs & Reviews

### H1 — Mid-Point Review
- After Epic 4 (Frontend Discussions) is complete
- Review: Discussion UX flow, inline review experience, agent panel interaction
- Decision point: any UX adjustments before proceeding to integration
- **Depends on:** T17, T14

### H2 — Final Review
- All code complete, tests passing
- Review: full flow end-to-end, edge cases, performance
- Acceptance criteria check (from PRD)
- **Depends on:** T31, T32, T33

### H3 — Changelog
- Produce `v2_5_discussions_and_agent_changelog.md`
- Document what shipped, decisions made during implementation
- **Depends on:** H2

---

## Execution Order (Suggested Session Plan)

**Phase A — Foundation (Sessions 1-3)**
1. D1 (Schema doc) → T1 (Discussion tables) → T2 (Internal agent tables)
2. T3 (Data migration) → T4 (Shared types)

**Phase B — Internal Agent Core (Sessions 4-7)**
3. D2 (Architecture doc) → D3 (API contract doc)
4. T5 (Tool registry — all 30 tools)
5. T9 (Agent loop service) → T10 (Conversation management)
6. T11 (Proactive service) → T12 (Event listener)

**Phase C — Discussion Backend (Sessions 8-9)**
7. T6 (Discussion service) → T7 (Discussion routes)
8. T8 (Deprecate debrief/brief routes) → T26 (Extraction refactor)

**Phase D — Frontend Discussions (Sessions 10-13)**
9. T15 (Agent panel API client) → T14 (Internal agent panel)
10. T16 (Discussions list page) → T17 (Discussion detail page)
11. T18 (Quick capture modal) → T19 (Discussions tab on projects)
12. H1 (Mid-point review)

**Phase E — Settings & Integration (Sessions 14-16)**
13. T20 (Internal agent settings) → T21 (Budget integration)
14. T22 (Sidebar updates) → T23 (Inbox) → T24 (Home page)
15. T25 (WebSocket integration) → T13 (CLI execution mode)

**Phase F — Workflow & Polish (Sessions 17-18)**
16. T27 (Workflow service) → T28 (Workflow routes)
17. D4 (Remaining documents)

**Phase G — Testing & Cleanup (Sessions 19-21)**
18. T29 (Unit tests) → T30 (Integration tests) → T31 (QA)
19. T32 (Remove old UI) → T33 (Update CLAUDE.md)
20. H2 (Final review) → H3 (Changelog)

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Agent loop complexity — multi-turn tool use with streaming is hard to get right | High | High | Start with API mode only, add CLI later. Build comprehensive agent loop tests early. |
| Token budget overflows — internal agent context exceeds LLM limits | Medium | High | Aggressive summarization, tool result truncation, configurable budgets. Test with real-world conversation lengths. |
| Extraction quality regression — agent-based extraction may differ from current one-shot | Medium | Medium | Keep legacy extraction as fallback. A/B test extraction quality during development. |
| Data migration issues — debrief/brief → discussion conversion has edge cases | Low | High | Write migration verification script. Test with production-like data volume. Rollback plan in schema doc. |
| Performance — Discussion threads with many entries could be slow | Low | Medium | Pagination on entries. Lazy loading of extracted items. Index tuning. |
| CLI mode complexity — MCP integration adds significant surface area | Medium | Medium | CLI mode is lower priority. Ship API mode first, CLI mode can lag. |
| Mobile UX conflicts — right panel interactions on small screens | Low | Medium | Test on real devices during H1 mid-point review. Mutual exclusion rule (DA-23) simplifies this. |
| Scope creep — 12 capabilities + 30 tools is ambitious for one release | High | High | Strict phase ordering. Core capabilities first (discussion processing, queries, actions). Analysis and coaching can be basic. |
