---
Feature: v2_5_discussions_and_agent
Doc type: decisions
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: both (brainstorm session)
Depends on: CLAUDE.md, ui_overhaul_decisions.md
---

# V2.5 Discussions & Internal Agent — Decisions

All design and architectural decisions for v2.5. Each decision is locked unless explicitly reopened by the founder.

---

## Decision DA-1: Product Positioning

**Context:** AoA needs a clear identity. Is it an "AI agent manager" or something broader?

**Options Considered:**
- **A: AI Agent Manager** — focused on managing AI agents. Value only kicks in with multiple agents.
- **B: Hybrid Workforce OS** — a work OS where AI agents happen to be some of the workers. Value is immediate.

**Decision: Option B — Hybrid Workforce OS**

**Rationale:** "AoA is where a solo founder runs their company — with AI agents doing most of the work and humans filling the gaps." This positions AoA against "Linear + Notion + AI tools duct-taped together," not against Claude Code or Cursor directly. AI tools are workers in AoA, not competitors to it.

**Consequences:**
- All UX decisions prioritize the "company operating system" feel over "agent configuration panel"
- Discussions (external conversations) become the primary input channel, not agent config
- The internal agent is the system's intelligence, not a chatbot feature

---

## Decision DA-2: Three-Tier Agent Architecture

**Context:** How should agent orchestration be structured?

**Options Considered:**
- **A: Flat** — all agents are equal, founder manages each directly
- **B: Two-tier** — one orchestrator + worker agents
- **C: Three-tier** — master orchestrator → department lead personas → worker agents

**Decision: Option C — Three-Tier Architecture**

**Rationale:** Mirrors real company structure. The master orchestrator (AoA's internal agent) coordinates across departments. Department lead personas are the same agent with department-scoped context. Worker agents (user-created) execute tasks.

**Architecture:**
```
Internal Agent (one entity, department-scoped personas)
  ├── Engineering context (eng memory, agents, goals)
  ├── Marketing context (marketing memory, agents, goals)
  └── [other departments]
      ↓
Worker Agents (user-created, adapter-based)
  ├── Claude Code agent
  ├── Content writer agent
  └── etc.
```

**Consequences:**
- The internal agent does NOT appear in the Agents page alongside worker agents — it IS AoA
- Department lead "personas" are not separate agents; they are the internal agent operating with department-scoped context
- No separate sub-agent settings in the UI — one settings page for the internal agent
- Worker agents remain user-created and user-configured as today

---

## Decision DA-3: Discussions Replace Debrief + Brief

**Context:** The current Debrief → Brief pipeline is a linear, stateless, one-shot extraction. Information about the same topic is fragmented across isolated debriefs.

**Options Considered:**
- **A: Keep Debrief + Brief as-is** — add threading as a separate feature
- **B: Rename Debrief → Discussion, keep Brief** — cosmetic change
- **C: Replace both with Discussions** — threaded, contextual, inline review

**Decision: Option C — Discussions replace both**

**Rationale:** Discussions are threaded records of real conversations (transcribed meetings, LLM sessions via MCP, live recordings). Each entry in a thread is processed in context of the full thread. Brief as a separate staging area is redundant when review happens inline within the Discussion.

**What a Discussion is:**
- A record of real-world conversations (NOT "talking to AoA")
- Sources: transcription tools, LLM sessions via MCP, voice recording in AoA
- Threaded: multiple entries over time about the same topic
- Entries can be standalone (new thread) or attached to existing thread
- Agent or human can suggest/make connections between entries and threads

**What goes away:**
- `debriefs` table → migrated to `discussions` / `discussion_entries`
- `briefs` table → absorbed into inline review within Discussion
- `brief_items` table → becomes extracted items attached to discussion entries
- Briefs page in sidebar → replaced by Discussions page
- DebriefModal → becomes quick capture modal for new Discussion entry
- BriefReview page → review happens inline in Discussion thread view

**Consequences:**
- Critical Rule #5 in CLAUDE.md ("MCP inbound always routes through Debrief pipeline") updates to "MCP inbound always routes through Discussion pipeline"
- Existing data migrated: each debrief becomes a single-entry Discussion
- Sidebar WORK section: Discussions, Tasks, Agents, Goals (Discussions first)
- Decision #14 still holds: all external input goes through Discussions, never creates raw tasks

---

## Decision DA-4: Internal Agent Surface — Right Collapsible Panel

**Context:** Where does the founder interact with AoA's internal agent?

**Options Considered:**
- **A: Right collapsible panel** — always accessible, doesn't navigate away from current page
- **B: Dedicated page in sidebar** — full page, navigate to it
- **C: Both** — right panel for quick interactions, expandable/full page for deep sessions

**Decision: Option C — Both (right panel primary, expandable for deep sessions)**

**Rationale:** Right panel is the daily driver — always available, context-aware of current page. For longer sessions (workflow planning, deep analysis), the panel can expand (draggable width or pop-out to full width). Previously deferred as UI-9 in ui_overhaul_decisions.md.

**Consequences:**
- New global component in Layout.tsx for the right panel
- Panel is collapsible (closed by default, toggle button in top nav or keyboard shortcut)
- Panel is context-aware (knows which page the founder is viewing)
- Panel can expand wider for longer conversations
- Settings page gets a new section for internal agent configuration
- Mobile: panel overlays as a sheet/drawer from right

---

## Decision DA-5: Internal Agent Execution — Dual Mode (API + CLI)

**Context:** The internal agent needs a multi-turn tool-use loop to call AoA tools. How should this be executed?

**Options Considered:**
- **A: Custom agent loop on LLM APIs** — server-side loop using Anthropic/OpenAI/Google tool_use
- **B: CLI via MCP** — Claude CLI/Codex connects to AoA's MCP server
- **C: Extend existing adapter system** — rejected; adapters are task-execution, not conversation
- **D: Dual mode** — API loop as default, CLI as power-user option

**Decision: Option D — Dual mode execution**

**Default: API-based agent loop.** New server-side service (`InternalAgentService`) implements the tool-use loop. Calls LLM API with AoA tool definitions. Executes tools by calling existing service functions directly (no HTTP roundtrips). Streams responses to frontend via WebSocket/SSE.

**Optional: CLI-based via MCP.** Same AoA tools exposed as MCP resources. User can switch internal agent to use Claude CLI/Codex as execution engine. CLI handles the agent loop; tools route through MCP to AoA.

**Provider abstraction:**
```
InternalAgentService
  ├── AnthropicProvider (tool_use via messages API)
  ├── OpenAIProvider (function calling)
  └── GeminiProvider (function calling)
```

**Rationale:** API mode works everywhere (hosted, mobile, no local setup). CLI mode is a power-user upgrade for those with local tools. Same tool registry backs both modes.

**Settings UI:**
```
Execution Mode: [API (default)] [CLI]
If API: Provider, Model, API Key (from LLM Providers)
If CLI: CLI Tool selection, MCP auto-configured
```

**Consequences:**
- New `InternalAgentService` in `server/src/services/`
- Tool registry: shared tool definitions usable by both API loop and MCP server
- Existing MCP outbound server (V2) extended with internal agent tools
- Not an adapter in the existing sense — separate service with its own conversation management
- Cost tracking integrates with existing budget system

---

## Decision DA-6: Internal Agent Permissions — Logged-In User's Role

**Context:** The internal agent takes actions on the system (create tasks, departments, memory). What permission level does it operate at?

**Options Considered:**
- **A: Founder-level service account** — always has full permissions regardless of who's using it
- **B: Own RBAC role** — new role with granular per-capability permissions
- **C: Logged-in user's role** — inherits the current user's RBAC permissions

**Decision: Option C — Logged-in user's role**

**Rationale:** Simplest model. Solo founder → agent has founder permissions. Team lead → agent has team lead permissions. No new RBAC role to build. Autonomy levels layer on top: permissions = what the agent CAN do; autonomy = what it DOES without asking.

**Consequences:**
- Internal agent requests pass through existing RBAC middleware with user's auth context
- No new permission types or roles
- Autonomy levels (future) control proactive behavior, not access

---

## Decision DA-7: Discussion Entry Sources

**Context:** What types of input create Discussion entries?

**Decision: Four input sources (matching current Debrief, with additions)**

1. **Paste** — paste text (meeting notes, transcripts from external tools)
2. **Write** — type directly
3. **Voice** — record in AoA → Whisper transcription → editable text
4. **MCP** — external systems push content (LLM sessions, integrations)

Future additions (deferred):
- **Transcription integrations** — Otter, Fireflies, Recall.ai push transcripts directly
- **Live recording** — real-time transcription during calls (post-transcription processing only for v2.5)

**Consequences:**
- Same 4 input types as today, same infrastructure
- Transcription tool integrations built as hooks/interfaces for future connection
- Processing always happens after transcription is complete, not real-time

---

## Decision DA-8: Discussion Threading Model

**Context:** How do Discussion entries relate to threads?

**Decision: Flexible threading with manual and agent-assisted connection**

- Any entry can be standalone (new thread) or part of an existing thread
- At creation time, user can choose "New Discussion" or "Add to existing"
- After creation, entries can be attached to threads (by human or agent suggestion)
- The internal agent can suggest connections: "This looks related to Discussion X"
- MCP input follows the same model — can be standalone or attached
- MCP source-based auto-threading is a future add-on, not core v2.5

**Consequences:**
- Data model needs: `discussions` (thread container) + `discussion_entries` (individual messages)
- A standalone entry creates its own discussion thread (1 entry)
- Entries can be moved between threads
- Agent suggestion mechanism for thread connections

---

## Decision DA-9: Inline Review (No Separate Brief Page)

**Context:** Currently, extracted items are reviewed on a separate BriefReview page. With Discussions, where does review happen?

**Decision: Inline review within Discussion thread + Inbox notifications**

- Extracted items appear below each Discussion entry in the thread
- Founder confirms/edits/rejects items directly in the Discussion view
- "Confirm All" for fast path when extraction is correct
- "Review individually" expands full controls (priority, department, memory layer, dedup)
- Inbox gets a notification: "3 items pending review in Discussion X"
- Clicking Inbox notification navigates to the Discussion

**Consequences:**
- BriefReview page removed
- Briefs page removed from sidebar
- All review UI (dedup controls, dependency linking, priority selectors) moves inline
- Inbox integration for pending review notifications

---

## Decision DA-10: Sidebar Navigation Structure (v2.5)

**Context:** Sidebar structure needs updating for Discussions.

**Decision: Discussions replaces Briefs, ordered first under WORK**

```
Home (with badge)
Inbox (with badge)

WORK
├── Discussions  ← NEW (replaces Briefs, ordered first)
├── Tasks
├── Agents
└── Goals

DEPARTMENTS
├── [dynamic list]

PROJECTS
├── [dynamic list]

COMPANY
├── Vision & Mission
├── Memory
└── Team

Settings (bottom)
```

**Rationale:** Discussions first because it's the primary input channel — information enters AoA through discussions, tasks get created from them. This emphasizes the workflow: conversations → tasks → execution.

**Consequences:**
- Sidebar.tsx updated: "Briefs" entry replaced with "Discussions"
- Discussions ordered before Tasks
- No buttons in sidebar (per Decision UI-4, unchanged)
- Internal agent panel toggle is NOT in the sidebar — it's in the top nav bar or keyboard shortcut

---

## Decision DA-11: Discussions Tab on Project/Department Pages

**Context:** Should project/department detail pages show related discussions?

**Decision: Yes — add Discussions tab to ProjectDetail**

- ProjectDetail.tsx gets a new "Discussions" tab alongside Overview, Issues, Goals, Team, Budget
- Shows discussions tagged to that project/department
- Same data as global Discussions page, just filtered
- "New Discussion" action pre-scoped to the project/department

**Consequences:**
- ProjectDetail.tsx modified to add tab
- Discussions page supports filtering by project/department
- Auto-tagging by internal agent suggests project/department scope

---

## Decision DA-12: Internal Agent Conversation Persistence

**Context:** How long does the internal agent's conversation history persist?

**Decision: Persistent forever with summarization**

- All messages stored permanently in `agent_conversations` / `agent_messages` table
- One primary conversation thread per user (continuous relationship)
- Older conversations summarized to manage token window
- Agent can retrieve full historical context when a past topic resurfaces
- User can manually reset/start new conversation
- Even after reset, old context is retrievable if needed

**Consequences:**
- New tables for conversation storage
- Summarization service for older messages
- Context window management: recent messages in full + summarized history
- "New conversation" button in the panel UI

---

## Decision DA-13: Internal Agent Capabilities (v2.5 Scope)

**Context:** What can the internal agent do in v2.5?

**Decision: 12 capabilities, all IN scope**

1. **Discussion processing** — extracts tasks/memory from transcripts and inputs, context-aware
2. **Proactive suggestions** — flags issues, gaps, risks (extends existing suggestion engine)
3. **Organizational queries** — answers questions about company state
4. **System actions** — creates tasks, departments, agents, updates memory
5. **Context briefing** — morning digest, "what happened overnight"
6. **Memory management** — surfaces relevant knowledge, helps maintain it
7. **Conflict detection** — catches contradictions between new input and existing decisions
8. **Budget awareness** — proactive budget alerts, resource questions
9. **Workflow coaching** — nudges toward better system use
10. **Workflow discovery / SOP creation** — interviews founder about processes, creates pipeline templates
11. **Cross-department coordination** — catches gaps in dependency chains
12. **Department lead personas** — department-scoped context for domain-specific reasoning

**Deferred to v3:**
- Onboarding conversation (conversational company setup)
- Full autonomy tiers (Levels 1-3; v2.5 starts at Level 0 — always ask)

**Consequences:**
- 30 core tools in the tool registry
- All capabilities powered by the same internal agent (no visible sub-agents)
- Each capability is a function/tool the agent invokes, not a separate service

---

## Decision DA-14: Core Tool Set (30 Tools)

**Context:** The full tool surface is 44 tools. Which are core for v2.5?

**Decision: 30 tools ship in v2.5**

**Discussion tools (3):**
- `extract_from_content`, `search_discussions`, `link_discussion_to_project`

**Query tools (6):**
- `query_tasks`, `query_goals`, `query_agents`, `query_departments`, `query_budget`, `query_activity`

**Action tools (8):**
- `create_task`, `update_task`, `create_department`, `create_goal`, `create_agent`, `update_agent`, `assign_task`, `wakeup_agent`

**Memory tools (5):**
- `query_memory`, `create_memory`, `update_memory`, `find_similar_memory`, `detect_conflicts`

**Workflow tools (3):**
- `create_workflow_template`, `instantiate_workflow`, `add_task_dependency`

**File tools (2):**
- `read_file`, `write_file`

**Coordination tools (1):**
- `query_dependency_chain`

**Analysis tools (2):**
- `analyze_workload`, `suggest_improvements`

**Deferred tools (14):** artifact query/versioning, pause/resume agent, advanced analysis, project CRUD, etc.

**Consequences:**
- Tool registry defines all 30 with JSON schemas
- Tools call existing service functions directly (server-side)
- Same tools exposed via MCP for CLI mode
- Tool selection layer loads relevant subset per interaction to manage context window

---

## Decision DA-15: Annotations on Discussion Entries

**Context:** Should founders be able to annotate discussion transcripts?

**Decision: Yes — annotations are supported**

- Founder can add annotations at any point in a discussion entry
- Annotations serve two purposes: context for the internal agent, and personal notes for the founder
- Annotations are NOT processed as extractable items — they are metadata
- The internal agent sees annotations when processing subsequent entries (enriches context)

**Consequences:**
- UI: inline annotation capability in Discussion entry view
- Data model: annotations stored as part of discussion entry metadata
- Extraction prompt includes annotations as context, not as content to extract from

---

## Decision DA-16: Data Migration Strategy

**Context:** Existing debriefs and briefs need to work with the new Discussion model.

**Decision: Migrate existing data (Option A)**

- Each existing debrief becomes a single-entry Discussion
- Each brief's items get attached inline to that Discussion entry
- Old URLs redirect to new Discussion view
- No dual systems — old debrief/brief code replaced, not maintained alongside

**Consequences:**
- Migration script converts `debriefs` → `discussions` + `discussion_entries`
- Brief items mapped to extracted items on the discussion entry
- Approval status preserved
- Old API routes deprecated with redirect support

---

## Decision DA-17: Discussion Entry Processing

**Context:** Who handles extraction from Discussion entries — the internal agent or a separate pipeline?

**Decision: Internal agent handles extraction**

**Rationale:** The current extraction is a one-shot stateless LLM call. For Discussions, extraction needs thread context + system state awareness. That's what the internal agent already does. Having a separate extraction pipeline that's also context-aware would duplicate logic.

**Flow:**
1. New Discussion entry arrives (transcript, voice memo, MCP)
2. Internal agent processes it (with full thread history + system state)
3. Extracted items shown inline for founder review
4. If extraction is wrong, founder can talk to the agent about it in the right panel

**Consequences:**
- `extraction.ts` refactored from one-shot LLM call into a tool the internal agent invokes
- The agent's `extract_from_content` tool replaces the current extraction pipeline
- Auto-processing on entry arrival (agent extracts automatically, shows results for review)
- Manual "reprocess" option for founder to trigger re-extraction with annotations

---

## Decision DA-18: Internal Agent Settings

**Context:** What's configurable for the internal agent?

**Decision: Settings section with the following controls**

- **Execution mode** — API (default) or CLI
- **Provider/Model** — which LLM powers it (Anthropic/OpenAI/Google + model selection)
- **Autonomy level** — v2.5 ships with Level 0 only (always ask before acting)
- **Enabled capabilities** — toggle which capabilities are active
- **Notification preferences** — how proactive (silent, digest, real-time)

**Location:** New section in existing Settings page, or dedicated sub-page linked from Settings.

**Consequences:**
- New settings schema for internal agent configuration
- Settings persisted per company (not per user)
- Default configuration set during first use

---

## Decision DA-19: Quick Capture Modal

**Context:** How does the founder quickly dump a transcript or voice memo?

**Decision: Quick capture modal (evolved from DebriefModal)**

- Lightweight modal, doesn't navigate away from current page
- Same input modes: Paste, Write, Voice
- Adds: "Add to existing Discussion" option (dropdown of recent discussions)
- Default: creates new standalone Discussion
- After submission: agent processes in background, notification in Inbox when ready
- Available from: Home page quick actions, Cmd+K palette, keyboard shortcut

**Consequences:**
- DebriefModal.tsx refactored into DiscussionCaptureModal
- Adds thread selection dropdown
- Processing happens async (no blocking spinner like today)
- Notification when extraction is ready for review

---

## Decision DA-20: Workflow/SOP System

**Context:** The internal agent should be able to learn and create repeatable workflows.

**Decision: Lightweight workflow templates in v2.5**

- Internal agent interviews founder about processes: "How does your team handle a new feature?"
- Creates a workflow template: ordered task chain with dependencies and role assignments
- Templates are stored and reusable
- When starting a new project/goal, agent offers: "Should I set up the standard feature pipeline?"
- Instantiation creates tasks with proper dependencies and assignments

**Connection to V3:** V3 `pipeline_templates` table is the full version. V2.5 implements a lighter version — the internal agent creates tasks with dependencies in the right order based on conversation, stored as a reusable pattern. Formal `pipeline_templates` schema may be pulled forward or a lighter alternative used.

**Consequences:**
- New table or JSON storage for workflow templates
- `create_workflow_template` and `instantiate_workflow` tools
- Agent prompt engineering for workflow discovery conversations
- Links to existing `task_dependencies` table for blocking relationships

---

## Decision DA-21: Internal Agent Panel Toggle Location

**Context:** Where does the button to open/close the right panel live?

**Decision: Icon button in BreadcrumbBar (top right) + keyboard shortcut**

- Small icon button in the top nav bar, next to the existing Cmd+K search button
- Keyboard shortcut (Cmd+J or similar) to toggle panel
- Consistent with left sidebar having its own collapse toggle
- Panel remembers open/closed state per session

**Consequences:**
- BreadcrumbBar.tsx modified to add agent panel toggle button
- New keyboard shortcut registered in keyboard shortcuts system
- Panel state managed via context (similar to SidebarContext)

---

## Decision DA-22: Content Pasted in Agent Panel → Discussion

**Context:** When founder pastes a transcript or substantial content into the agent panel chat (not the Discussion page), what happens?

**Decision: Agent creates/appends to a Discussion, suggests related threads**

**Flow:**
1. Founder pastes substantial content in agent panel
2. Agent detects it's content to process (not a question)
3. Agent calls `search_discussions` to check for related threads
4. If related discussion found: "This looks related to your 'Dashboard Redesign' discussion. Should I add it there or create a new one?"
5. If no match: creates a new Discussion, processes it, shows extracted items in the panel
6. Either way, the content lives in Discussions (searchable, threaded, linked) — not buried in agent chat history

**Rationale:** The agent panel is conversational. Discussions are the record system. Content should always end up in Discussions for traceability. The agent is smart enough to route.

**Consequences:**
- Agent panel chat is never the permanent home for content — always routed to Discussions
- Agent uses `search_discussions` + `create_discussion` / `add_discussion_entry` tools
- Extracted items shown in agent panel for quick review, but also visible in Discussion page

---

## Decision DA-23: Agent Panel on Mobile — Mutually Exclusive Overlays

**Context:** Right panel on mobile may conflict with task slide-over, modals.

**Decision: Full-screen sheet, mutually exclusive with other overlays**

- On mobile, agent panel is a full-screen sheet (slides from right or bottom)
- If task slide-over is open, it closes when agent panel opens (and vice versa)
- Modals (like quick capture) can overlay on top of the agent panel
- One primary overlay at a time rule — simple, no conflicts

**Consequences:**
- Mobile agent panel uses the same Sheet component pattern as TaskSlideOver
- Z-index management: modals > agent panel = task slide-over
- Panel toggle button visible in MobileBottomNav or top bar

---

## Decision DA-24: Internal Agent Token Budget

**Context:** The internal agent needs company memory + conversation history + tool results. Can exceed context window limits.

**Decision: Configurable token budget with smart allocation**

- Internal agent gets its own token budget setting in Settings (separate from worker agent context modes)
- Default: 8,000 tokens for context assembly (company memory + conversation + page context)
- Tool results are additional (each tool call extends the conversation naturally)
- Conversation summarization kicks in when history exceeds a configurable threshold
- Budget allocation strategy:
  - Company identity (always included): ~500 tokens
  - Relevant department memory: ~1,500 tokens
  - Conversation history (recent full, older summarized): ~4,000 tokens
  - Current page context: ~1,000 tokens
  - Reserve for tool results: ~1,000 tokens
- Settings UI: slider or dropdown for context size (compact/standard/large)
- Founder can adjust based on their LLM model's context window

**Consequences:**
- New setting in internal agent config: `contextTokenBudget`
- Summarization service for conversation history
- Context assembly prioritizes recency and relevance
- Warning if budget is too small for effective operation

---

## Decision DA-25: Internal Agent Cost Attribution

**Context:** Internal agent API calls cost money. How are costs tracked?

**Decision: Separate budget line for internal agent**

- Internal agent has its own `budgetMonthlyCents` and `spentMonthlyCents`
- Stored in `internal_agent_config` table (not in agents table — internal agent isn't a worker agent)
- Every API call from the agent loop logs a `cost_event` with `source: 'internal_agent'`
- Budget page in Settings shows: worker agent budgets (existing) + internal agent budget (new line)
- Same 80% warning / 100% pause logic as worker agents
- Aggregate company spend = sum(all worker agents) + internal agent
- Cost per conversation turn tracked for founder visibility

**Consequences:**
- New fields in internal agent config for budget
- `cost_events` table gets a new source type
- Budget UI updated to show internal agent as separate line
- Internal agent pauses (stops responding) if over budget — shows message in panel

---

## Decision DA-26: Mobile Bottom Nav — Agent Replaces Create

**Context:** The MobileBottomNav has 5 items: Home, Tasks, Create (+), Agents, Inbox. Need to add internal agent access on mobile.

**Decision: Replace Create button with Agent panel toggle**

**New mobile bottom nav:**
```
Home | Tasks | AoA (agent) | Agents | Inbox
```

**Rationale:** The internal agent can create things for the founder (tasks, discussions, etc.) via conversation. The Cmd+K palette and Home page quick actions also provide creation entry points. Dedicating the center position to the agent emphasizes it as the primary interaction mode.

**Consequences:**
- MobileBottomNav.tsx updated: center button becomes agent panel toggle
- "Create" action accessible via agent panel, Cmd+K, Home page
- Agent button uses a distinct icon (Brain, Sparkles, or AoA brand icon)
- Active state shows when panel is open

---

## Decision DA-27: Internal Agent Run Tracking System (Internal Agent Heartbeat)

**Context:** The internal agent needs its own heartbeat-like system — separate from the worker agent `heartbeat_runs` table — for visibility, auditability, cost tracking, and extensible trigger support. This is the internal agent's heartbeat.

**Decision: Dedicated run tracking system with extensible triggers**

**New table: `internal_agent_runs`**
- `id` — uuid
- `companyId` — FK to companies
- `triggerType` — 'conversation' | 'proactive' | 'event' | 'sub_agent'
- `triggerSource` — extensible text field (see trigger catalog below)
- `status` — 'running' | 'completed' | 'failed'
- `toolsCalled` — JSON array of tool invocations with inputs/outputs
- `tokenUsage` — { inputTokens, outputTokens, cachedInputTokens }
- `costCents` — estimated cost of the run
- `durationMs` — wall-clock time
- `summary` — text description of what the agent did
- `departmentContext` — uuid (nullable, if running as department persona)
- `userId` — who triggered it (null for proactive/event)
- `conversationMessageId` — FK to the message that triggered this run (nullable)
- `relatedEntityType` — nullable ('discussion' | 'task' | 'agent' | 'goal' | 'memory')
- `relatedEntityId` — uuid (nullable, links run to the entity that triggered it)
- `createdAt`, `completedAt`

**Trigger catalog (extensible — new sources added without schema changes):**

Reactive triggers (immediate):
- `user_message` — founder types in agent panel
- `discussion_entry` — new entry added to a Discussion (paste/voice/MCP)
- `mcp_inbound` — external system pushes content via MCP
- `task_completed` — worker agent completes a task
- `task_status_change` — task moves to review, blocked, etc.
- `agent_error` — worker agent errors out
- `agent_budget_alert` — worker agent hits budget threshold

Scheduled triggers (proactive):
- `scheduled_check` — periodic scan (every 4 hours, configurable)
- `morning_digest` — first login of the day briefing
- `reminder` — founder-requested reminder ("remind me Friday")
- `ttl_expiry` — memory item or active_context approaching expiration

System event triggers (future-ready):
- `dependency_resolved` — blocking task completed, downstream unblocked
- `budget_threshold` — department or company budget threshold hit
- `connector_sync` — external service pushes update (V3 connectors)
- `trust_score_change` — agent trust score drops below threshold

**What counts as a "run":**
- Every conversation turn (user message → agent response with tool calls) = 1 run
- Every proactive check (scheduled scan, digest, reminder) = 1 run
- Every event-triggered processing (discussion entry, task completion) = 1 run
- Every future sub-agent autonomous action = 1 run

**Why separate from worker heartbeat:**
- Different execution model: conversational + event-driven vs. task-based
- No queue (agent responds immediately or processes events inline)
- No atomic checkout (no task locking)
- No adapter abstraction (direct service calls via tool registry)
- No wakeup/assignment lifecycle
- Same principles: cost tracking, status lifecycle, duration, token usage, full auditability

**Background processing model:**
- When the founder is not in the app, event triggers still fire
- Agent processes in the background (e.g., MCP pushes a discussion → agent extracts)
- Results queued as notifications → Inbox + agent panel greeting on next login
- "I processed 2 new discussions while you were away"

**Where it shows in UI:**
- Settings > Internal Agent: run history with filters by trigger type, cost breakdown
- Right panel: subtle "processing" indicator when agent is mid-run
- Right panel greeting: summary of background runs since last visit
- NOT on the Agents page (internal agent stays separate from worker agents)

**Future benefit:** When sub-agents become more autonomous (V3 autonomy tiers), this table already tracks their actions. The `triggerType: 'sub_agent'` and `departmentContext` fields enable department-scoped run history and cost attribution. New trigger sources are added as strings without schema migration.

**Consequences:**
- New `internal_agent_runs` table in schema (completely separate from `heartbeat_runs`)
- Every agent loop execution creates a run record
- Event listener service routes system events to internal agent triggers
- Proactive scheduler service handles timed triggers
- Reminder system: new `internal_agent_reminders` table or field on runs
- Settings UI gets a "Run History" section for internal agent
- Cost events link to run records for full traceability
