---
Feature: v2_5_discussions_and_agent
Doc type: testing
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_tasks.md, v2_5_discussions_and_agent_api_contract.md, v2_5_discussions_and_agent_architecture.md
---

# V2.5 Discussions & Internal Agent — Testing

Comprehensive test plan: unit tests, service tests, contract tests, integration tests, QA suites, and manual test scripts.

---

## Test Strategy

All tests follow the existing V2 test patterns documented in CLAUDE.md:

1. **Pure function tests** — import and test directly (no mocking needed)
2. **Service tests with mocks** — Proxy-based table stubs, sequence-based mock DBs (`createSequenceDb`)
3. **Contract tests** — verify API shapes, constants, type compliance
4. **QA test suites** — end-to-end coverage of user flows (same pattern as `v2-*-qa.test.ts`)

Tests live in `server/src/__tests__/` alongside existing V2 tests.

### CRITICAL: ESM/Drizzle Mock Pattern

All v2.5 test files MUST mock `drizzle-orm` and `@paperclipai/db` before importing any service code to avoid the ESM cycle issue. This is the same pattern used by all existing V2 tests:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// MUST be before any service imports
vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  or: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@paperclipai/db", () => ({
  discussions: {
    id: "id", companyId: "company_id", title: "title",
    status: "status", scopeType: "scope_type", scopeId: "scope_id",
  },
  discussionEntries: {
    id: "id", discussionId: "discussion_id", inputType: "input_type",
    rawContent: "raw_content", extractionStatus: "extraction_status",
  },
  // ... stub all tables used by the service under test
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// NOW import the service
import { discussionService } from "../services/discussions.js";
```

Also mock `globalThis.fetch` for tests that call LLM APIs:
```typescript
globalThis.fetch = vi.fn();
```

---

## Unit Tests

### 1. Tool Logic Tests (`v2_5-tool-logic.test.ts`)

Pure function tests for each internal agent tool's parameter validation and result formatting.

**Test cases:**
- `query_tasks` — validates filters, returns correct shape, handles empty results
- `query_goals` — filters by status, department; returns summary strings
- `query_memory` — filters by layer, department; respects search params
- `create_task` — validates required fields (title, status), rejects invalid priority
- `create_memory` — validates layer is valid, enforces required fields per layer
- `detect_conflicts` — compares two memory items, returns conflict flag and description
- `find_similar_memory` — returns scored results with similarity threshold applied
- `extract_from_content` — parses content and returns structured items (type, title, description)
- `create_workflow_template` — validates steps array, dependency references
- `instantiate_workflow` — creates tasks with correct dependency chain
- `add_task_dependency` — validates no circular dependency creation

### 2. Provider Translation Tests (`v2_5-provider-translation.test.ts`)

Pure function tests for tool schema translation and stream event parsing per provider.

**Test cases per provider (Anthropic, OpenAI, Google):**
- `translateTool()` — AoA tool schema → provider-specific format
- `parseStreamEvent()` — provider SSE chunk → normalized `ProviderStreamEvent`
- `translateMessages()` — AoA message format → provider message format
- `translateToolResult()` — AoA tool result → provider tool result format
- Tool call accumulation — handles streamed JSON arguments correctly
- Handles `message_end` event with usage stats

### 3. Context Assembly Tests (`v2_5-context-assembly.test.ts`)

**Test cases:**
- Assembles full context within token budget (default 8000)
- Prioritizes system instructions over optional sections
- Includes department context when departmentId provided
- Includes conversation summary when conversation has summarizedContext
- Truncates recent activity to fit within budget
- Returns empty page context when none provided
- Calculates token estimate correctly (ceil(length/4))

### 4. Conversation Management Tests (`v2_5-conversation.test.ts`)

**Test cases:**
- Creates new conversation on first interaction
- Returns existing conversation for same user + company
- Appends messages with correct role and timestamp
- Triggers summarization when 80% of token budget reached
- Summarization preserves last 20 messages
- `reset()` archives old conversation, creates new one
- Archived conversations are not returned by `getOrCreate()`

### 5. Agent Loop Tests (`v2_5-agent-loop.test.ts`)

**Test cases (with mocked provider):**
- Single-turn response (no tool calls) — streams text events
- Multi-turn with one tool call — calls tool, sends result, gets final text
- Multi-turn with multiple tool calls — handles sequential tool rounds
- Respects max 10 tool rounds — stops and returns partial result
- Tool execution error — includes error in tool result, continues
- Permission denied tool error — returns permission message to user
- Streams SSE events in correct order: thinking → tool_call → tool_result → content → done
- Token usage accumulates across multi-turn
- Cost calculation is correct per model pricing
- Action confirmation — pauses and waits for user approval

### 6. Cost Calculation Tests (`v2_5-cost-tracking.test.ts`)

**Test cases:**
- Calculates cost correctly for each supported model
- Budget enforcement: rejects run when monthly budget exceeded
- Budget rollover: resets spent amount on month boundary
- Cost event created with correct metadata (runId, triggerSource)
- Internal agent costs are separate from worker agent costs

### 7. Discussion Extraction Tests (`v2_5-extraction.test.ts`)

**Test cases:**
- Extracts tasks from transcript content
- Extracts memory items (decisions, preferences) from transcript
- Sets correct suggestedPriority based on language signals
- Handles thread context — doesn't re-extract already-extracted items
- Handles empty content gracefully
- Handles extraction failure — sets extractionStatus to 'failed'
- Updates discussion.pendingItemCount on extraction completion
- Creates run record with triggerSource 'discussion_entry'

### 8. Proactive Scheduler Tests (`v2_5-proactive.test.ts`)

**Test cases:**
- Morning digest includes completed tasks since last session
- Morning digest includes failed agents
- Morning digest includes pending discussion items
- Morning digest includes budget warnings (>80% used)
- Morning digest includes stale work (untouched 24h+)
- Morning digest includes fired reminders since last session
- Proactive check runs at configured interval
- Proactive check skips if last run was within interval
- Proactive check creates run record with triggerSource 'scheduled_check'

### 9. Reminder Tests (`v2_5-reminders.test.ts`)

**Test cases:**
- Creates reminder with correct triggerAt parsed from natural language
- Fires reminder when current time >= triggerAt
- Updates reminder status to 'fired' after firing
- Cancellation sets status to 'cancelled'
- Cancelled reminders don't fire
- Already-fired reminders don't fire again
- User can only see/cancel their own reminders

---

## Service Tests (with Mocks)

### 10. Discussion Service Tests (`v2_5-discussions-service.test.ts`)

Uses sequence-based mock DB.

**Test cases:**
- `createDiscussion()` — creates discussion with correct fields, increments entryCount
- `addEntry()` — inserts entry, triggers extraction event
- `addEntry()` to existing thread — preserves thread context
- `updateDiscussion()` — updates title, scope, tags
- `archiveDiscussion()` — sets status to 'archived'
- `approveItems()` with `approveAll: true` — approves all pending items
- `approveItems()` with specific itemIds — approves only selected
- `approveItems()` — creates tasks for task-type items
- `approveItems()` — creates memory items for memory-type items
- `approveItems()` — handles dedup actions (create_separate, update_existing, replace)
- `reprocessEntry()` — resets extractionStatus to 'pending', triggers re-extraction
- `addAnnotation()` — inserts annotation with anchorStart/anchorEnd
- `linkEntry()` — creates link between entries in different discussions
- `searchDiscussions()` — full-text search across entries

### 11. Internal Agent Service Tests (`v2_5-internal-agent-service.test.ts`)

**Test cases:**
- `chat()` — creates run, calls agent loop, returns SSE stream
- `chat()` — passes user role to tool context
- `chat()` — budget check before run
- `chat()` — handles provider error gracefully
- `processDiscussionEntry()` — loads thread context, runs extraction
- `confirm()` — executes pending action when approved
- `confirm()` — cancels pending action when rejected
- `getConfig()` — returns config for company
- `updateConfig()` — validates and saves config changes
- `getRuns()` — returns run history with pagination

### 12. Workflow Template Service Tests (`v2_5-workflow-service.test.ts`)

**Test cases:**
- `createTemplate()` — validates steps structure, creates template
- `updateTemplate()` — updates steps and dependencies
- `instantiateTemplate()` — creates tasks with correct dependency chain
- `instantiateTemplate()` — links tasks to goal
- `instantiateTemplate()` — respects department scoping
- `deleteTemplate()` — only founders can delete

---

## Contract Tests

### 13. API Contract Tests (`v2_5-api-contracts.test.ts`)

Verify request/response shapes without hitting real services.

**Test cases:**
- Discussion list response matches `DiscussionListItem` type
- Discussion detail response matches `DiscussionDetail` type
- Discussion entry response includes extracted items array
- Agent chat SSE events match `AgentStreamEvent` type
- Agent config response matches `InternalAgentConfig` type
- Workflow template response matches `WorkflowTemplate` type
- Error responses include correct error codes
- Pagination params accepted on list endpoints
- All required fields enforced in POST bodies

### 14. Permission Contract Tests (`v2_5-permissions-contracts.test.ts`)

Verify role-based access without real auth.

**Test cases per role (founder, team_lead, team_member):**
- Discussion CRUD permissions match matrix
- Agent tool execution permissions match matrix
- Workflow template CRUD permissions match matrix
- Agent config access (founder-only)
- Run history access (founder-only)
- Conversation isolation (users can't see each other's conversations)

---

## QA Test Suites

### 15. Discussion QA (`v2_5-discussions-qa.test.ts`)

End-to-end user flow coverage.

**Test scenarios:**
- **Quick capture flow:** Create discussion via modal → entry created → extraction runs → items appear → approve all → tasks + memory created
- **Threaded discussion:** Create discussion → add 3 entries → all entries in thread → extraction uses thread context for later entries
- **Inline review:** Extracted items show correct types → edit item inline → change priority → approve selected → reject others
- **Conflict detection:** Entry contains info conflicting with existing memory → conflict warning shown → resolve conflict
- **Dedup handling:** Entry contains info similar to existing memory → dedup options shown → merge selected
- **Voice entry:** Audio uploaded → transcription runs → content populated → extraction runs
- **MCP entry:** External tool pushes content via MCP → discussion created → extraction runs → notification sent
- **Archive and restore:** Archive discussion → verify not in active list → unarchive → verify restored
- **Scope linking:** Create unscoped discussion → link to project → verify appears in project's discussions tab
- **Migration:** Old debrief exists → migrated to discussion → entries and items preserved

### 16. Internal Agent QA (`v2_5-internal-agent-qa.test.ts`)

**Test scenarios:**
- **Basic query:** "How many tasks are in progress?" → agent calls query_tasks → returns count
- **Multi-tool query:** "What's the status of the dashboard project?" → agent calls query_tasks + query_goals → returns combined summary
- **Action with confirmation:** "Assign the API task to Ada" → agent proposes action → user confirms → task assigned
- **Action rejection:** Agent proposes action → user rejects → no change made
- **Permission boundary:** Team member asks to create department → agent returns permission error message
- **Content to discussion:** Paste transcript in agent panel → agent detects content → creates discussion → extraction runs
- **Reminder:** "Remind me to check on deployment Friday" → reminder created → fires on Friday
- **Morning digest:** First login of day → agent generates briefing → greeting shown
- **Conversation persistence:** Send message → close panel → reopen → history preserved
- **Conversation reset:** Reset conversation → old messages archived → new conversation starts
- **Budget enforcement:** Exceed monthly budget → agent returns 402 → helpful message shown
- **Streaming:** Message sent → events stream in correct order → no dropped events

### 17. Workflow QA (`v2_5-workflow-qa.test.ts`)

**Test scenarios:**
- **Template creation via agent:** Describe process to agent → template created with correct steps and dependencies
- **Template instantiation:** Instantiate template for a goal → tasks created → dependencies set → linked to goal
- **Template listing:** Multiple templates exist → list shows all → filter by creator
- **Template edit:** Update template steps → change persisted → old instances unaffected

### 18. Integration QA (`v2_5-integration-qa.test.ts`)

Cross-feature interaction tests.

**Test scenarios:**
- Discussion extraction creates tasks → tasks appear in Tasks list → task completion triggers agent event
- Agent creates memory item → memory appears in Memory page → memory used in next agent context
- Workflow template instantiation → tasks have dependencies → dependency completion unblocks next task
- MCP push → discussion created → extraction → approve → tasks created → webhook event fired
- Discussion linked to project → project's discussions tab shows it → project deletion handled gracefully
- Agent budget tracking → cost events created → budget page shows internal agent spend

### 19. Edge Cases QA (`v2_5-edge-cases-qa.test.ts`)

**Test scenarios:**
- Empty discussion entry (whitespace only) → graceful handling
- Very large content (50K characters) → truncated or chunked for extraction
- Concurrent entries to same discussion → no race conditions on counts
- Agent tool throws unexpected error → error logged, user gets friendly message
- Provider API timeout → run marked failed, user notified
- Circular dependency attempt via agent → detected and rejected
- Discussion with 100+ entries → pagination works, extraction still uses relevant context
- Conversation with 1000+ messages → summarization handles gracefully
- Reminder in the past → fires immediately on next check
- Two users chatting with agent simultaneously → conversations isolated

### 20. Performance QA (`v2_5-performance-qa.test.ts`)

**Test scenarios:**
- Discussion list with 500 discussions → response < 200ms
- Discussion detail with 50 entries → response < 500ms
- Agent query response (single tool) → end-to-end < 3s (excluding LLM latency)
- Global search including discussions → response < 300ms
- Extraction of 2000-word transcript → completes in < 30s
- Proactive morning digest generation → completes in < 10s
- Context assembly for agent → completes in < 100ms

---

## Manual Test Scripts

### M1: Full Quick Capture Flow

```
1. Open AoA Home page
2. Click "Discussion" quick action (or Cmd+K → "New Discussion")
3. DiscussionCaptureModal opens
4. Paste a sample meeting transcript
5. Select "New thread"
6. Click Submit
7. Toast appears: "Processing your discussion..."
8. Navigate to Discussions list
9. New discussion appears
10. Open discussion
11. Entry shows with extraction status "processing" → "completed"
12. Extracted items appear inline
13. Review items — edit one, approve all
14. Check Tasks page — new tasks created
15. Check Memory page — new memory items created
```

### M2: Agent Panel Interaction

```
1. Click agent toggle in BreadcrumbBar
2. Right panel opens with greeting (if first of day)
3. Type: "What tasks are blocked?"
4. Panel shows streaming response with tool call indicator
5. Response lists blocked tasks
6. Type: "Assign the API migration to Ada"
7. Agent shows confirmation: "Assign to Ada?"
8. Click "Yes"
9. Toast: "Task assigned to Ada"
10. Close panel
11. Reopen panel — conversation history preserved
```

### M3: MCP Inbound Flow

```
1. From Claude CLI: send content via push-discussion MCP tool
2. In AoA: notification appears (if online)
3. Open Discussions → new discussion from MCP
4. Extracted items pending review
5. Approve items
6. Tasks created successfully
```

### M4: Workflow Creation & Instantiation

```
1. Open agent panel
2. Type: "I want to create a process for handling new features"
3. Agent asks about steps
4. Describe: "Spec → Design → Code → Test → Review"
5. Agent creates workflow template
6. Type: "Use it for the Dashboard Redesign goal"
7. Agent instantiates template
8. Check Tasks page — 5 tasks with dependency chain
9. Complete first task → second unblocks
```

### M5: Budget Enforcement

```
1. Set internal agent monthly budget to $0.01 in settings
2. Send a message in agent panel
3. Agent processes (uses budget)
4. Send another message
5. If budget exceeded: 402 response, helpful message
6. Reset budget → agent works again
```

---

## Test Data Fixtures

### Sample Transcript for Extraction Tests

```
"Had a call with the client today. They want us to redesign the dashboard
by April 15. The current one is too cluttered. They specifically said they
prefer a minimal design with lots of white space. Also need to add a
settings page for user preferences. The API endpoint for fetching dashboard
data needs to be updated to support the new layout. High priority on the
API work since it blocks the frontend."
```

**Expected extractions:**
- Task: "Redesign dashboard" (high priority, deadline April 15)
- Task: "Add settings page for user preferences" (medium priority)
- Task: "Update API endpoint for dashboard data" (high priority)
- Memory: "Client prefers minimal design with lots of white space" (domain, preference)
- Memory: "Dashboard deadline is April 15" (active_context)

### Sample Agent Conversations

Stored in test fixtures for conversation management tests. Include:
- Simple Q&A (1 turn, no tools)
- Multi-tool query (1 turn, 3 tool calls)
- Action with confirmation (2 turns)
- Long conversation (30+ turns, triggers summarization)

---

## Coverage Targets

| Area | Target | Measurement |
|------|--------|-------------|
| Tool logic (pure functions) | 95% | Line coverage |
| Provider translation | 90% | Line coverage |
| Agent loop | 85% | Branch coverage |
| Discussion service | 90% | Line coverage |
| Workflow service | 85% | Line coverage |
| API contracts | 100% | All endpoints covered |
| Permission matrix | 100% | All role × action combinations |
| User flows (QA) | 100% | All 8 flows from flow.md |
