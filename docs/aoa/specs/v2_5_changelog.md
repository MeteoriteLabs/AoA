# V2.5 Changelog — Discussions & Internal Agent

**Branch:** `v2.5` (from `main` after s14)
**Sessions:** s9–s21 (s9–s14 merged to main, s15–s20 on v2.5, s21 = cleanup)
**Date:** 2026-03-28

## What Shipped

### Discussion System (replaces Debrief/Brief)
- **Thread-based discussions** with polymorphic scope (department/project/goal)
- **4 input modes:** paste, write, voice (Whisper transcription), MCP inbound
- **Entry-level scope override** (Decision #61 pattern: item > entry > discussion > null)
- **Inline annotations** on discussion entries with character offset anchoring
- **Extracted items** with dedup support, conflict detection, and approval workflow
- **Discussion list page** with status/scope/source/pending-item filters
- **Discussion detail page** with threaded entry view and inline extracted items
- **Quick capture modal** (DiscussionCaptureModal) replaces DebriefModal
- **Discussions tab** on project/department detail pages
- **Data migration path:** debriefs → discussions, brief_items → discussion_extracted_items

### Internal Agent (Always-On AI Assistant)
- **30 tools across 8 categories:** discussion, query, action, memory, workflow, file, coordination, analysis
- **API execution mode:** Direct LLM calls to Anthropic/OpenAI/Google with function calling
- **CLI execution mode:** MCP bridge for Claude CLI/Codex/OpenCode (s19)
- **Agent loop:** Multi-turn tool use with budget enforcement and action confirmation
- **Context assembly:** Company identity + department persona + conversation history + page context
- **SSE streaming** for real-time response delivery to frontend
- **Conversation management:** One per user per company, auto-summarization for token control
- **Run tracking:** Every execution logged with cost, tokens, duration, tools called

### Proactive Agent
- **Scheduled background checks** (4-hour default interval)
- **6 check types:** blocked tasks, budget thresholds, stale work, dependency gaps, memory conflicts, workload imbalance
- **Event-driven triggers:** heartbeat completion, activity changes, discussion entry creation
- **Results pushed to Inbox** via notification system

### Workflow Templates
- **Reusable task chain patterns** with ordered steps and dependency modeling
- **One-click instantiation** creates tasks + task_dependencies for a goal
- **Usage tracking:** instantiationCount, lastInstantiatedAt

### Notifications
- **Unified notification system** for extraction results, reminders, proactive alerts, action results
- **Unread badge** in sidebar
- **Entity linking** for quick navigation to related items

### UI Updates
- **Agent panel** in right sidebar with chat interface and streaming
- **Action confirmation flow** for agent-proposed changes
- **Internal Agent Settings page** (provider, model, capabilities, budget, test connection)
- **Agent budget line item** in Budget section
- **Sidebar updated:** WORK section now shows Discussions, Tasks, Agents, Goals
- **Home page:** Agent greeting widget, discussion quick action
- **Inbox:** Discussion items pending review + agent alerts + reminders
- **Live events:** internal_agent.message and internal_agent.run.status for real-time UI updates

### Cleanup (s21)
- Removed deprecated `DebriefModal.tsx` and `ui/src/api/debriefs.ts`
- Removed `debriefOpen`/`openDebrief`/`closeDebrief` from DialogContext
- Updated CLAUDE.md with V2.5 architecture, tables, naming map, sidebar structure

## New Tables (11)

1. `discussions`
2. `discussion_entries`
3. `discussion_extracted_items`
4. `discussion_annotations`
5. `internal_agent_config`
6. `internal_agent_conversations`
7. `internal_agent_messages`
8. `internal_agent_runs`
9. `internal_agent_reminders`
10. `workflow_templates`
11. `notifications`

## Deprecated Tables

- `debriefs` — kept for rollback safety, marked @deprecated V2.5
- `briefs` — kept for rollback safety, marked @deprecated V2.5
- `brief_items` — replaced by `discussion_extracted_items`

## Deviations from Spec

- **CLI execution mode** (s19): Implemented as MCP bridge pattern — CLI tools spawn as MCP servers. Designed but not yet activated in production; API mode is the default.
- **Autonomy levels:** Spec defined levels 0-3. V2.5 ships with level 0 only (full approval). Higher levels deferred to V3.
- **No `cost_events` source column:** Internal agent costs tracked in `internal_agent_runs.costCents` rather than adding a source type to cost_events. Keeps cost tracking self-contained.

## Session Breakdown

| Session | PR | Focus |
|---------|-----|-------|
| s9 | #63 | Agent loop, conversation service, context assembly |
| s10 | #64 | Proactive agent, event listener, HTTP routes with SSE |
| s11 | #65 | Discussion + internal agent API clients, SSE streaming |
| s12 | #66 | Agent panel UI with chat, streaming, action confirmation |
| s13 | #67 | Discussion list/detail pages, scope filters, annotations |
| s14 | #68 | Discussions tab on project/department detail pages |
| s15 | #69 | Internal agent settings page, budget integration, test connection |
| s16 | #70 | Sidebar, routing, inbox, and home page updates |
| s17 | #71 | Extraction service integration, live events, event-driven triggers |
| s18 | #72 | Workflow template service and routes with instantiation |
| s19 | #73 | CLI execution mode (MCP bridge, session store, orchestrator) |
| s20 | #74 | V2.5 integration/edge-case test suites, shared mock helpers |
| s21 | — | Remove deprecated UI, update CLAUDE.md, changelog |
