---
Feature: v2_5_discussions_and_agent
Doc type: prd
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_decisions.md, v2_5_discussions_and_agent_tasks.md
---

# V2.5 Discussions & Internal Agent — PRD

## Goal

**Problem:** Solo founders running AoA manage their company's information through disconnected channels — meeting transcripts live in Otter, LLM conversations vanish when the terminal closes, voice memos are one-shot extractions with no thread context, and the founder manually bridges all of it. The current Debrief → Brief pipeline is stateless (each submission is isolated), dumb (one-shot LLM extraction with no system awareness), and friction-heavy (separate review page for every submission).

Meanwhile, the founder is the sole coordinator — manually assigning tasks, checking blocked work, monitoring budgets, maintaining organizational memory, and catching contradictions between decisions. There's no intelligence layer that understands the company and helps run it.

**Solution:** Two interconnected features:

1. **Discussions** — Replace the Debrief/Brief pipeline with a threaded, context-aware system. Discussions are records of real-world conversations (transcribed meetings, LLM sessions via MCP, voice memos) that accumulate over time. Each entry is processed with full thread context and system state awareness. Review happens inline, not on a separate page.

2. **Internal Agent** — An always-available AI agent that lives in a right-side panel. It processes Discussions, answers organizational queries, takes actions on the system, detects conflicts, manages memory, discovers workflows, and proactively surfaces issues. It is the founder's COO — the intelligence layer of AoA.

**For whom:** Solo founders using AoA as their hybrid workforce OS.

**Why now:** V1 and V2 built the foundation (tasks, agents, memory, artifacts, trust scores, suggestions). V2.5 adds the intelligence and input layers that make AoA feel like a company operating system rather than an agent management tool.

---

## Scope

### In Scope

**Discussions:**
- Threaded discussion model replacing Debrief + Brief
- Four input modes: paste, write, voice, MCP
- Inline review of extracted items within discussion thread
- Annotations on discussion entries
- Discussion scoping to projects/departments/goals
- Auto-tagging and thread connection suggestions
- Quick capture modal (evolved from DebriefModal)
- Discussions tab on Project/Department pages
- Data migration from existing debriefs/briefs
- Sidebar: Discussions replaces Briefs (first under WORK)

**Internal Agent:**
- Right collapsible panel (global, always available)
- Dual execution mode: API-based agent loop (default) + CLI via MCP (optional)
- 30 core tools across 8 categories
- Conversation persistence with summarization
- 12 capabilities: discussion processing, proactive suggestions, organizational queries, system actions, context briefing, memory management, conflict detection, budget awareness, workflow coaching, workflow discovery/SOP, cross-department coordination, department lead personas
- Run tracking system (internal agent heartbeat) with extensible triggers
- Separate budget line and cost attribution
- Settings page for configuration
- Mobile: full-screen sheet, replaces Create in bottom nav

**Workflow/SOP:**
- Workflow template creation and storage
- Template instantiation (create tasks with dependencies from template)
- Internal agent interview-based workflow discovery

### Out of Scope (Deferred)

- Onboarding conversation (conversational company setup) → V3
- Autonomy levels 1-3 (V2.5 ships with Level 0 only) → V3
- Transcription tool integrations (Otter, Fireflies, Recall.ai) → V3 connectors
- Live real-time transcription → V3
- Artifact tools for internal agent (query/versioning) → post-v2.5
- Agent pause/resume tools → post-v2.5
- Advanced analysis tools → post-v2.5
- Multi-user concurrent agent panel sessions → post-v2.5
- Internal agent appearing on Agents page → never (per DA-2)

---

## User Stories

### Discussions

**US-1: Quick capture from anywhere**
As a founder, I want to quickly dump a meeting transcript or voice memo without leaving my current page, so that information enters the system with minimal friction.
- Acceptance: Quick capture modal opens from Home page, Cmd+K, keyboard shortcut. Supports paste, write, voice. Option to add to existing discussion or create new. Processing is async (no blocking spinner). Inbox notification when extraction is ready.

**US-2: Threaded discussions**
As a founder, I want multiple inputs about the same topic to live in one thread, so that the system understands the full context when extracting tasks and memory.
- Acceptance: Discussion detail page shows entries chronologically. New entries can be added to existing threads. Entries show raw content + extracted items inline. Thread context is used during extraction (not just the single entry).

**US-3: Inline review**
As a founder, I want to review and approve extracted items directly in the discussion thread, so that I don't have to navigate to a separate review page.
- Acceptance: Pending items shown below each entry with approve/reject/edit controls. "Confirm All" for fast approval. "Review individually" expands full controls (priority, department, memory layer, dedup). Approved items create tasks and memory items atomically.

**US-4: Smart extraction**
As a founder, I want the system to know about my existing tasks and memory when extracting from a discussion, so that it doesn't create duplicates and can update existing items instead.
- Acceptance: Extraction is context-aware (checks existing tasks, memory, thread history). Agent suggests "update existing task" when duplicate detected. Conflict detection flags contradictions with existing decisions. Annotations are included as context during extraction.

**US-5: Discussion annotations**
As a founder, I want to add my own notes to a discussion transcript, so that I can capture context the transcript doesn't convey (tone, politics, gut feelings).
- Acceptance: Click any point in an entry to add annotation. Annotations visible in the thread. Annotations used as context during extraction but not extracted themselves.

**US-6: Discussion scoping**
As a founder, I want discussions to be linked to projects or departments, so that I can see all conversations related to a piece of work in one place.
- Acceptance: Discussions can be scoped to project/department/goal at creation or later. Internal agent auto-suggests scope based on content. Project/Department detail pages have a Discussions tab showing linked discussions.

**US-7: MCP-initiated discussions**
As a founder, I want content pushed via MCP (from Claude CLI, external tools) to become discussion entries, so that LLM conversations and external inputs are captured in the system.
- Acceptance: MCP inbound creates discussion entries (per updated Decision #14). Entries can be standalone or attached to existing threads. Agent processes MCP entries in the background. Founder sees results on next login.

### Internal Agent

**US-8: Chat with AoA**
As a founder, I want to ask AoA questions and give it instructions from any page, so that I can get answers and take actions without navigating through the UI.
- Acceptance: Right panel opens from top nav button or keyboard shortcut. Chat interface with message input, streaming responses, tool execution indicators. Panel is context-aware (knows which page founder is on). Panel is collapsible and remembers state.

**US-9: Agent creates things**
As a founder, I want to tell the agent "create a marketing department" or "add a task for redesigning the dashboard" and have it done, so that I can manage my company through conversation.
- Acceptance: Agent can create tasks, departments, goals, agents, memory items, workflow templates via tools. All creations respect RBAC (uses founder's permissions). Agent confirms before creating (Level 0 autonomy).

**US-10: Morning briefing**
As a founder, I want to see a summary of what happened since I last opened AoA, so that I'm immediately aware of completed work, errors, and items needing attention.
- Acceptance: On first login of the day, agent panel shows a briefing: completed tasks, failed runs, new discussion items pending review, budget alerts, stale work. Briefing is generated by a proactive run.

**US-11: Organizational queries**
As a founder, I want to ask "what's blocked?" or "how's the engineering team doing?" and get an answer, so that I can quickly assess company state.
- Acceptance: Agent queries the system (tasks, goals, agents, budget, activity) and responds with relevant information. Responses include links to entities (click task name → opens task).

**US-12: Memory management through conversation**
As a founder, I want to tell the agent "we decided to use GraphQL" and have it create the right memory item, or ask "what do we know about pricing?" and get relevant memory items.
- Acceptance: Agent can create, update, and query memory items. Semantic search for relevant items. Conflict detection when new information contradicts existing decisions.

**US-13: Workflow discovery**
As a founder, I want to describe how my team handles a process and have the agent create a reusable workflow template, so that future work follows the same pattern automatically.
- Acceptance: Founder describes process in conversation. Agent creates workflow template with ordered steps and dependencies. Template can be instantiated: creates tasks with proper order and blocking relationships.

**US-14: Proactive alerts**
As a founder, I want the agent to proactively flag issues without me asking, so that I catch problems early.
- Acceptance: Agent detects blocked tasks, budget overruns, stale work, dependency gaps, conflict with decisions. Alerts surface in Inbox and agent panel. Proactive checks run on schedule (configurable, default 4 hours).

**US-15: Reminders**
As a founder, I want to tell the agent "remind me to follow up on the dashboard project Friday" and have it remind me, so that I don't lose track of important follow-ups.
- Acceptance: Agent creates a reminder from natural language. Reminder fires at the specified time. Notification in Inbox + agent panel greeting.

**US-16: Budget awareness**
As a founder, I want to ask "can I afford to run 3 more agents this month?" or be warned proactively when spending is high, so that I stay within budget.
- Acceptance: Agent can query budget data (spend, projections, limits). Proactive alerts at 80% budget threshold. Agent considers budget when suggesting actions.

**US-17: Content in panel routes to Discussion**
As a founder, if I paste a transcript into the agent panel chat, I want it to end up in the Discussion system, so that it's searchable and linked properly.
- Acceptance: Agent detects substantial content (not a question). Checks for related discussions. Offers to append or create new. Content always lands in Discussions, not just chat history.

### Settings & Configuration

**US-18: Configure internal agent**
As a founder, I want to choose which LLM powers the internal agent and set its budget, so that I control costs and quality.
- Acceptance: Settings page section for internal agent. Execution mode (API/CLI). Provider/model selection. Monthly budget. Token budget. Enabled capabilities toggles. Notification preferences.

**US-19: Run history visibility**
As a founder, I want to see what the internal agent has been doing, so that I can audit its actions and understand costs.
- Acceptance: Run history in Settings shows all internal agent runs. Filterable by trigger type (conversation, proactive, event). Shows: status, cost, duration, tools called, summary. Cost breakdown chart.

---

## Data Model Summary

Full details in `v2_5_discussions_and_agent_schema.md`.

**New tables:**
- `discussions` — thread container
- `discussion_entries` — individual messages in thread
- `discussion_extracted_items` — items extracted from entries (replaces brief_items)
- `discussion_annotations` — founder annotations on entries
- `internal_agent_config` — per-company agent settings
- `internal_agent_conversations` — conversation containers
- `internal_agent_messages` — conversation messages
- `internal_agent_runs` — run tracking (agent heartbeat)
- `internal_agent_reminders` — scheduled reminders
- `workflow_templates` — reusable process patterns

**Modified tables:**
- `cost_events` — new source type 'internal_agent'

**Deprecated tables (data migrated):**
- `debriefs` → migrated to `discussions` + `discussion_entries`
- `briefs` → absorbed into inline review
- `brief_items` → migrated to `discussion_extracted_items`

---

## API Summary

Full details in `v2_5_discussions_and_agent_api_contract.md`.

**New route groups:**
- `POST/GET/PATCH /companies/:companyId/discussions/...` — discussion CRUD, entries, annotations, approval
- `POST /companies/:companyId/internal-agent/chat` — send message to internal agent (SSE streaming response)
- `GET/DELETE /companies/:companyId/internal-agent/conversation` — conversation management
- `GET/PATCH /companies/:companyId/internal-agent/config` — agent configuration
- `GET /companies/:companyId/internal-agent/runs` — run history
- `POST/GET/PATCH/DELETE /companies/:companyId/workflow-templates/...` — workflow CRUD + instantiation

**Modified routes:**
- `POST /companies/:companyId/debriefs/mcp` → routes through Discussion pipeline
- Old debrief/brief routes deprecated with redirects

---

## Business Logic Summary

Full details in service implementations and architecture doc.

**Extraction pipeline change:** One-shot LLM call → internal agent with thread context + system state. Falls back to legacy extraction if internal agent not configured.

**Discussion approval:** Same atomic transaction as current brief approval — creates tasks and memory items in one transaction. Same dedup logic (create/merge/replace). Same RBAC (founder-only for identity/domain memory).

**Internal agent tool execution:** Tools call existing service functions directly. Permissions checked using the requesting user's RBAC role. All tool calls logged in run records.

**Proactive scheduling:** Configurable interval (default 4 hours) + first-login-of-day trigger. Each check is a tracked run. Results pushed via WebSocket to Inbox and agent panel.

**Event-driven triggers:** LiveEvents system routes relevant events to internal agent. Debounced at 30 seconds per event type. Background processing when founder is offline.

---

## Acceptance Criteria (Release-Level)

1. **Discussion flow works end-to-end:** Create discussion → add entry (paste/write/voice) → agent extracts items → inline review → approve → tasks and memory items created.
2. **Threading works:** Multiple entries in one discussion share context. Agent doesn't create duplicate tasks across entries in the same thread.
3. **Internal agent panel is functional:** Founder can ask questions, give instructions, and receive streaming responses with tool execution.
4. **Agent creates system entities:** Tasks, departments, goals, agents, memory items created via agent conversation match what manual creation produces.
5. **Proactive alerts fire:** Blocked tasks, budget warnings, and stale work are detected and surfaced in Inbox + agent panel.
6. **Morning digest works:** First login of the day shows a briefing of what happened.
7. **MCP input creates discussion entries:** External systems can push content that gets processed by the agent.
8. **Workflow templates work:** Create template from conversation → instantiate → tasks with dependencies created.
9. **Settings are configurable:** Execution mode, provider, model, budget, capabilities all configurable and persisted.
10. **Cost tracking is accurate:** Every agent run is tracked, costed, and attributable. Budget limits enforced.
11. **Migration is clean:** Existing debriefs and briefs are accessible as Discussions. No data loss.
12. **Old UI is removed:** No Briefs page, no BriefReview page, no DebriefModal. Sidebar shows Discussions.
13. **Mobile works:** Agent panel accessible from bottom nav. Full-screen sheet on mobile. Mutually exclusive with task slide-over.
14. **Reminders work:** Natural language reminders created and fired at the right time.

---

## Open Questions

None — all resolved in decisions document (DA-1 through DA-27).
