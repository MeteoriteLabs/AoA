---
Feature: v2_5_discussions_and_agent
Doc type: architecture
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_decisions.md, v2_5_discussions_and_agent_schema.md
---

# V2.5 Discussions & Internal Agent — Architecture

System design, layers, boundaries, and conventions.

---

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                        Frontend                          │
│  ┌──────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ Left     │  │ Main Content     │  │ Agent Panel   │  │
│  │ Sidebar  │  │ (pages)          │  │ (right)       │  │
│  │ (nav)    │  │                  │  │               │  │
│  └──────────┘  └──────────────────┘  └───────────────┘  │
│         │              │                     │           │
│         └──────────────┼─────────────────────┘           │
│                        │ REST + SSE + WebSocket          │
├────────────────────────┼─────────────────────────────────┤
│                     Backend                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                   Routes Layer                       │ │
│  │  discussions.ts  internal-agent.ts  workflow.ts      │ │
│  └────────────────────────┬────────────────────────────┘ │
│                           │                              │
│  ┌────────────────────────┼────────────────────────────┐ │
│  │              Service Layer                           │ │
│  │                                                      │ │
│  │  ┌──────────────────────────────────────────────┐   │ │
│  │  │         InternalAgentService                  │   │ │
│  │  │  ┌────────────┐  ┌──────────────────────┐    │   │ │
│  │  │  │ Agent Loop │  │ Tool Registry        │    │   │ │
│  │  │  │ (multi-    │──│ (30 tools, calls     │    │   │ │
│  │  │  │  turn)     │  │  existing services)  │    │   │ │
│  │  │  └────────────┘  └──────────────────────┘    │   │ │
│  │  │  ┌────────────┐  ┌──────────────────────┐    │   │ │
│  │  │  │ Provider   │  │ Conversation Mgmt    │    │   │ │
│  │  │  │ Abstraction│  │ (history, summary)   │    │   │ │
│  │  │  └────────────┘  └──────────────────────┘    │   │ │
│  │  │  ┌────────────┐  ┌──────────────────────┐    │   │ │
│  │  │  │ Proactive  │  │ Event Listener       │    │   │ │
│  │  │  │ Scheduler  │  │ (LiveEvents → runs)  │    │   │ │
│  │  │  └────────────┘  └──────────────────────┘    │   │ │
│  │  └──────────────────────────────────────────────┘   │ │
│  │                                                      │ │
│  │  DiscussionService  MemoryService  TaskService  ... │ │
│  │  (existing services enhanced, not replaced)          │ │
│  └──────────────────────────────────────────────────────┘ │
│                           │                              │
│  ┌────────────────────────┼────────────────────────────┐ │
│  │              Data Layer (Drizzle ORM)                │ │
│  │  discussions  internal_agent_*  workflow_templates   │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## Component Architecture

### 1. Internal Agent Service (`server/src/services/internal-agent/`)

The brain of v2.5. Contains 6 sub-modules:

```
server/src/services/internal-agent/
├── index.ts              — Public API: chat(), runProactiveCheck(), etc.
├── agent-loop.ts         — Multi-turn tool-use loop
├── providers/
│   ├── types.ts          — Provider interface
│   ├── anthropic.ts      — Anthropic Messages API
│   ├── openai.ts         — OpenAI Chat Completions
│   └── gemini.ts         — Google Gemini
├── tool-registry.ts      — Tool definitions + execution
├── tools/
│   ├── discussion-tools.ts
│   ├── query-tools.ts
│   ├── action-tools.ts
│   ├── memory-tools.ts
│   ├── workflow-tools.ts
│   ├── file-tools.ts
│   └── analysis-tools.ts
├── conversation.ts       — History management + summarization
├── proactive.ts          — Scheduled checks + morning digest
├── event-listener.ts     — LiveEvents → trigger routing
├── context-assembly.ts   — Build context for agent (memory, page, dept)
└── cli-mode.ts           — CLI execution backend (MCP bridge)
```

**Note:** The discussion extraction prompt should be based on the existing `EXTRACTION_PROMPT_TEMPLATE` in `server/src/services/extraction.ts`, which already has well-crafted item type definitions, department/project context injection, and layer heuristics. Extend it for thread-aware extraction (previous entries as context) rather than writing from scratch.

### 2. Agent Loop (`agent-loop.ts`)

Core execution engine. Handles the multi-turn conversation with tool calling.

```typescript
// Simplified interface
interface AgentLoopOptions {
  message: string;
  conversationHistory: Message[];
  systemContext: string;          // assembled company context
  tools: AgentTool[];             // relevant tool subset
  provider: LLMProvider;
  onStream: (event: StreamEvent) => void;
  userId: string;
  userRole: string;
}

interface AgentLoopResult {
  response: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: TokenUsage;
  costCents: number;
  durationMs: number;
}

async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult>
```

**Loop logic:**
1. Build messages array: system prompt + conversation history + new user message
2. Call LLM with tools
3. If response contains tool_use: execute tools, append results, go to step 2
4. If response contains text: stream to client, return result
5. Safety: max 10 tool call rounds per turn (prevent infinite loops)
6. On tool error: include error in tool result, let LLM decide how to proceed

### 3. Provider Abstraction

```typescript
interface LLMProvider {
  name: string;
  chat(params: {
    messages: ProviderMessage[];
    tools: ProviderTool[];
    maxTokens: number;
    stream: boolean;
  }): AsyncIterable<ProviderStreamEvent>;
}
```

Each provider translates between AoA's internal format and the provider's API format:
- **Anthropic**: `messages` API with `tool_use` content blocks
- **OpenAI**: `chat/completions` with `functions`/`tools` parameter
- **Google**: `generateContent` with `functionDeclarations`

Tool schemas are defined once in AoA format and translated per provider.

### 4. Tool Registry

```typescript
interface AgentTool {
  name: string;
  description: string;
  parameters: JSONSchema;
  category: ToolCategory;
  requiredRole: 'founder' | 'team_lead' | 'team_member';
  execute: (params: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

interface ToolContext {
  companyId: string;
  userId: string;
  userRole: string;
  db: Database;
  services: ServiceContainer; // access to all existing services
}

interface ToolResult {
  success: boolean;
  data: unknown;
  summary: string;       // human-readable summary for the agent
  error?: string;
}
```

**Tool selection:** Not all 30 tools are sent every request (token overhead). Selection strategy:
1. Always include: query_tasks, query_memory, query_goals (core read tools)
2. Include based on message intent: if message mentions "create" → include action tools
3. Include based on page context: on Tasks page → include task tools
4. Maximum 15 tools per request (balances capability vs. token cost)

### 5. Context Assembly

Builds the system prompt and context for each agent interaction.

```typescript
interface ContextAssemblyOptions {
  companyId: string;
  userId: string;
  pageContext: string;
  departmentId?: string;
  tokenBudget: number;
}

async function assembleContext(options: ContextAssemblyOptions): Promise<string>
```

**Assembly order (priority for token budget):**
1. System instructions (always, ~500 tokens) — agent role, capabilities, rules
2. Company identity (always, ~500 tokens) — name, vision, mission from companies table + identity memory
3. Department context (if applicable, ~1500 tokens) — department memory, goals, agents
4. Conversation summary (if exists, variable) — compressed older conversation
5. Page context (if applicable, ~500 tokens) — what the user is looking at
6. Recent activity (if space, ~500 tokens) — last few relevant events

Total fits within `contextTokenBudget` setting (default 8000).

### 6. Conversation Management

```typescript
interface ConversationManager {
  getOrCreate(companyId: string, userId: string): Promise<Conversation>;
  appendMessage(conversationId: string, message: NewMessage): Promise<Message>;
  getHistory(conversationId: string, limit: number): Promise<Message[]>;
  summarize(conversationId: string): Promise<void>;
  reset(conversationId: string): Promise<{ archived: string; created: string }>;
}
```

**Summarization strategy:**
- Triggered when conversation exceeds 80% of `contextTokenBudget`
- Older messages (beyond last 20) are summarized by the LLM
- Summary stored in `summarizedContext` on the conversation record
- Full messages preserved in DB for retrieval if needed
- Summary updated incrementally (append new summary, don't regenerate entire history)

### 7. Proactive Scheduler

```typescript
interface ProactiveScheduler {
  start(companyId: string): void;
  stop(companyId: string): void;
  runCheck(companyId: string): Promise<ProactiveRunResult>;
  runMorningDigest(companyId: string, userId: string): Promise<DigestResult>;
  checkReminders(): Promise<void>;
}
```

**Scheduling mechanism:** Uses existing server interval/cron infrastructure or a simple setInterval per active company. Checks `internal_agent_config.proactiveIntervalMinutes` and `lastProactiveRunAt` to determine when to run.

**Morning digest trigger:** Detected via a middleware or on the first API call of the day from a user. Checks if the user's last activity was >8 hours ago.

### 8. Event Listener

```typescript
interface EventListener {
  start(companyId: string): void;
  stop(companyId: string): void;
}
```

Subscribes to existing `LiveEvents` system. Routes events to internal agent triggers:

| LiveEvent | Trigger Source | Condition |
|-----------|---------------|-----------|
| `heartbeat.run.status` (terminal) | `task_completed` or `agent_error` | Run succeeded or failed |
| `activity.logged` (issue status) | `task_status_change` | Task moves to blocked/review |
| Discussion entry created | `discussion_entry` | New entry in any discussion |

**Debounce:** Events for the same entity within 30 seconds are coalesced into one trigger.

---

## Frontend Architecture

### Agent Panel Component Tree

```
Layout.tsx
├── Sidebar (left, existing)
├── Main Content (center, existing pages)
└── InternalAgentPanel (right, new)
    ├── AgentPanelHeader
    │   ├── Context indicator (current page)
    │   ├── Expand/collapse button
    │   └── Settings link
    ├── AgentPanelMessages
    │   ├── GreetingMessage (morning digest)
    │   ├── UserMessage
    │   ├── AssistantMessage
    │   │   ├── TextContent (streamed)
    │   │   ├── ToolCallIndicator ("Checking tasks...")
    │   │   └── ActionConfirmation (approve/reject buttons)
    │   └── SystemMessage (notifications)
    └── AgentPanelInput
        ├── TextInput
        └── SendButton
```

### Agent Panel State (AgentPanelContext)

```typescript
interface AgentPanelState {
  isOpen: boolean;
  isStreaming: boolean;
  conversation: Conversation | null;
  messages: Message[];
  currentRunId: string | null;
  pageContext: string; // auto-updated on navigation
}
```

### Discussion Page Component Tree

```
DiscussionDetail.tsx
├── DiscussionHeader
│   ├── Title (editable)
│   ├── Scope badge (project/dept/goal)
│   ├── Tags
│   └── Status
├── DiscussionEntryList
│   └── DiscussionEntry (repeated)
│       ├── EntryHeader (input type badge, timestamp, source)
│       ├── EntryContent (raw text display)
│       ├── EntryAnnotations (inline margin notes)
│       ├── ExtractedItemsList
│       │   └── ExtractedItemCard (repeated)
│       │       ├── ItemHeader (type badge, status)
│       │       ├── ItemContent (title, description)
│       │       ├── ItemControls (priority, dept, layer, assignee)
│       │       ├── DedupControls (if memory type)
│       │       ├── ConflictWarning (if conflicts detected)
│       │       └── ApproveRejectButtons
│       └── ExtractionStatus (processing indicator)
├── ConfirmAllBar (sticky bottom when pending items exist)
└── AddEntryInput
    ├── InputModeTabs (paste, write, voice)
    ├── ContentArea
    └── SubmitButton
```

---

## Data Flow Patterns

### Agent Chat Flow (Request → Response)

```
Frontend                    Backend
   │                           │
   │ POST /internal-agent/chat │
   │ { message, pageContext }  │
   │ ─────────────────────────→│
   │                           │ 1. Create/get conversation
   │                           │ 2. Save user message
   │                           │ 3. Create run record (status: running)
   │                           │ 4. Assemble context
   │                           │ 5. Select relevant tools
   │                           │ 6. Start agent loop
   │                           │
   │ SSE: event: thinking      │
   │ ←─────────────────────────│
   │                           │ 7. LLM responds with tool_use
   │ SSE: event: tool_call     │
   │ ←─────────────────────────│
   │                           │ 8. Execute tool
   │ SSE: event: tool_result   │
   │ ←─────────────────────────│
   │                           │ 9. LLM responds with text
   │ SSE: event: content       │
   │ ←─────────────────────────│ (repeated for each chunk)
   │ SSE: event: content       │
   │ ←─────────────────────────│
   │                           │ 10. Save assistant message
   │                           │ 11. Update run record (completed)
   │                           │ 12. Log cost event
   │ SSE: event: done          │
   │ ←─────────────────────────│
   │                           │
```

### Discussion Extraction Flow

```
Entry created (via API)
   │
   ▼
DiscussionService.addEntry()
   │ 1. Insert discussion_entries row
   │ 2. Update discussion counts
   │ 3. Publish LiveEvent: discussion.entry.created
   │
   ▼
EventListener catches event
   │ 4. Triggers internal agent (triggerSource: 'discussion_entry')
   │
   ▼
InternalAgentService.processDiscussionEntry(entryId)
   │ 5. Create run record
   │ 6. Load thread context (all entries in discussion)
   │ 7. Load system context (existing tasks, memory)
   │ 8. Load annotations on this entry
   │ 9. Run agent loop with extract_from_content tool
   │ 10. Agent extracts items
   │ 11. Insert discussion_extracted_items rows
   │ 12. Update entry extractionStatus → 'completed'
   │ 13. Update discussion pendingItemCount
   │ 14. Complete run record
   │
   ▼
Publish LiveEvent: discussion.extraction.completed
   │
   ▼
Frontend: React Query invalidation → UI updates
Inbox: notification created
```

---

## Streaming Architecture

### SSE for Agent Chat

The agent chat endpoint uses **Server-Sent Events (SSE)** rather than WebSocket for the response stream. Reasons:
- Unidirectional (server → client) is sufficient for streaming responses
- Simpler to implement than WebSocket for request-scoped streams
- Automatic reconnection built into EventSource API
- Works through HTTP/2 and most proxies

The existing WebSocket (LiveUpdatesProvider) is used for:
- Push notifications (agent panel greeting updates, extraction completed)
- Real-time run status updates
- Reminder notifications

### Why not WebSocket for chat?

WebSocket is already used for company-wide events (shared across all clients). Agent chat is user-scoped and request-scoped — each message gets its own SSE stream. Mixing user-specific chat streams into the shared WebSocket would require multiplexing logic.

---

## Conventions

### File Naming

```
server/src/services/internal-agent/     — all internal agent services
server/src/services/discussions.ts      — discussion service (follows existing pattern)
server/src/services/workflow-templates.ts — workflow service
server/src/routes/discussions.ts        — discussion routes
server/src/routes/internal-agent.ts     — agent routes
server/src/routes/workflow-templates.ts — workflow routes
packages/db/src/schema/discussions.ts   — discussion + annotation tables
packages/db/src/schema/internal-agent.ts — agent config + conversations + runs + reminders
packages/db/src/schema/workflow-templates.ts — workflow tables
ui/src/components/InternalAgentPanel.tsx — agent panel
ui/src/pages/Discussions.tsx            — discussions list
ui/src/pages/DiscussionDetail.tsx       — discussion thread view
ui/src/components/DiscussionCaptureModal.tsx — quick capture
ui/src/api/discussions.ts               — discussion API client
ui/src/api/internal-agent.ts            — agent API client
ui/src/context/AgentPanelContext.tsx     — panel state
```

### Service Pattern

All new services follow the existing factory pattern from `server/src/services/goals.ts`:

```typescript
// Factory function takes Db, returns object with methods
export function discussionService(db: Db) {
  return {
    list: async (companyId: string, filters?: DiscussionFilters) => { ... },
    getById: async (companyId: string, id: string) => { ... },
    create: async (companyId: string, data: CreateDiscussionInput) => { ... },
    update: async (id: string, data: Partial<...>) => { ... },
  };
}
```

Key conventions:
- **Factory function** returning object literal (not class, not standalone functions)
- **`db: Db` as parameter** — passed to factory at instantiation
- **Type inference** — use `typeof table.$inferInsert` and `typeof table.$inferSelect`
- **Error throwing** — use `badRequest()`, `notFound()`, `unprocessable()`, `conflict()`, `forbidden()` from `server/src/errors.ts`
- **Transaction support** — `db.transaction(async (tx) => { ... })` for atomic operations
- **Activity logging** — call `logActivity(db, { companyId, actorType, actorId, action, entityType, entityId, details })` for every mutation

### Route Pattern

All new routes follow the existing factory pattern from `server/src/routes/goals.ts`:

```typescript
// Factory function takes Db, returns Express Router
export function discussionRoutes(db: Db) {
  const router = Router();
  const svc = discussionService(db);

  router.get('/companies/:companyId/discussions', async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);  // auth check
    const result = await svc.list(companyId, req.query as any);
    res.json(result);
  });

  router.post('/companies/:companyId/discussions', validate(createDiscussionSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);  // extracts from req.actor
    const discussion = await svc.create(companyId, { ...req.body, createdBy: actor.actorId });
    await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, ... });
    res.status(201).json(discussion);
  });

  return router;
}
```

Key conventions:
- **All routes prefixed `/companies/:companyId/`** — no exceptions
- **Auth:** `assertCompanyAccess(req, companyId)` for all routes; `assertRole(db, req, companyId, 'founder')` for founder-only routes
- **Actor extraction:** `getActorInfo(req)` returns `{ actorType, actorId, agentId, runId }` from `req.actor`
- **Validation:** `validate(zodSchema)` middleware for POST/PATCH bodies
- **Registration:** New routes registered in `server/src/app.ts` via `api.use(discussionRoutes(db))`
- **Service barrel:** New services exported from `server/src/services/index.ts`

### Auth Model

The actual auth system uses `req.actor` (set by `actorMiddleware`):

```typescript
// Actor types
interface BoardActor { type: 'board'; userId: string; companyIds?: string[]; source: string }
interface AgentActor { type: 'agent'; agentId: string; companyId: string; source: string }
interface NoneActor { type: 'none'; source: 'none' }

// Usage in routes
const actor = getActorInfo(req);
// actor.actorType = 'board' | 'agent'
// actor.actorId = userId or agentId
```

### Test Pattern

Follow existing V2 test patterns:
- Pure function tests for tool logic
- Sequence-based mock DB for service tests (Proxy-based table stubs)
- Contract tests for API shapes
- **ESM/Drizzle workaround required:** All tests must mock `drizzle-orm` and `@armyofagents/db` with vi.mock() to avoid the ESM cycle issue:

```typescript
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn(), sql: vi.fn() }));
vi.mock("@armyofagents/db", () => ({
  discussions: { id: "id", companyId: "company_id", status: "status" },
}));
```

### Shared Types Pattern

New types, validators, and constants go in `packages/shared/src/`:
- Constants: `DISCUSSION_STATUSES`, `EXTRACTION_ITEM_TYPES`, `AGENT_CAPABILITIES`, `TRIGGER_SOURCES`, `TRIGGER_TYPES`, `INTERNAL_AGENT_ROLES`
- Validators: `createDiscussionSchema`, `createDiscussionEntrySchema`, `updateInternalAgentConfigSchema`, etc. (Zod schemas)
- Types: exported from validators and constants via `typeof` / `z.infer<>`
