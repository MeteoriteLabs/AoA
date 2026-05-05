---
Feature: v2_5_discussions_and_agent
Doc type: integration
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_architecture.md, v2_5_discussions_and_agent_api_contract.md
---

# V2.5 Discussions & Internal Agent — Integration

LLM provider integration, MCP changes, transcription hooks, and third-party service wiring.

---

## LLM Provider Integration

### Provider Architecture

The internal agent needs direct LLM API access for multi-turn tool-use conversations. This is separate from the existing adapter system (which handles worker agent heartbeat runs). The internal agent uses a provider abstraction layer in `server/src/services/internal-agent/providers/`.

### Supported Providers

| Provider | API | Model Default | Tool Format | Streaming |
|----------|-----|---------------|-------------|-----------|
| Anthropic | Messages API (`/v1/messages`) | `claude-sonnet-4-20250514` | `tool_use` content blocks | SSE via `stream: true` |
| OpenAI | Chat Completions (`/v1/chat/completions`) | `gpt-4o` | `tools` parameter with `function` type | SSE via `stream: true` |
| Google | Generative Language (`/v1beta/models/:model:generateContent`) | `gemini-1.5-pro` | `functionDeclarations` in `tools` | SSE via `alt=sse` |

### API Key Management

Reuse the existing `company_secrets` + `company_secret_versions` tables (encrypted secret management system). The internal agent reads its provider + model from `internal_agent_config`, then resolves the API key from `company_secrets` using a well-known naming convention.

```typescript
// Key lookup flow — uses existing secretService
async function getProviderApiKey(
  db: Db, companyId: string, provider: string
): Promise<string> {
  const svc = secretService(db);

  // Convention: secret named "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_AI_API_KEY"
  const secretName = PROVIDER_SECRET_NAMES[provider];
  // e.g., { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GOOGLE_AI_API_KEY' }

  const secret = await svc.getByName(companyId, secretName);
  if (!secret) {
    throw badRequest(
      `No ${provider} API key configured. Add a secret named "${secretName}" in Settings → Secrets.`
    );
  }

  // Resolve the latest version's decrypted value
  const value = await svc.resolveSecretValue(companyId, secret.id, secret.latestVersion);
  if (!value) throw badRequest(`Secret "${secretName}" has no valid version`);
  return value;
}
```

**Key storage:** Uses existing `company_secrets` infrastructure — versioned, encrypted (local_encrypted provider by default), with support for external vaults (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault). The Settings → Secrets page already exists for managing these. Worker agents already use this system for API key resolution via `runtimeConfig.envBindings`.

**Fallback for extraction service:** The current extraction service reads `process.env.ANTHROPIC_API_KEY` directly. V2.5 migrates this to use `company_secrets` since the internal agent handles extraction. If no company secret exists, falls back to env var for backward compatibility during transition.

### Tool Schema Translation

Tools are defined once in AoA's internal format and translated per provider at call time:

```typescript
// AoA internal format
interface AgentToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required: string[];
  };
}

// Translation happens in each provider
// Anthropic: { name, description, input_schema: parameters }
// OpenAI: { type: 'function', function: { name, description, parameters } }
// Google: { functionDeclarations: [{ name, description, parameters }] }
```

Each provider module (`anthropic.ts`, `openai.ts`, `gemini.ts`) implements `translateTool(tool: AgentToolSchema): ProviderToolFormat` and `parseToolCall(chunk: ProviderStreamChunk): ToolCallParsed`.

### Streaming Response Mapping

Each provider emits different SSE event shapes. The provider adapter normalizes them to a common `ProviderStreamEvent`:

```typescript
type ProviderStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; input_json_delta: string }
  | { type: 'tool_use_end'; id: string }
  | { type: 'message_end'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; error: string };
```

The agent loop consumes these normalized events, executes tools, and emits AoA SSE events (`thinking`, `tool_call`, `tool_result`, `content`, `done`) to the frontend.

### Provider-Specific Notes

**Anthropic:**
- Uses `anthropic` npm package (already a dependency for `claude_api` adapter)
- Beta header for tool streaming: `anthropic-beta: messages-2024-12-19-tool-streaming`
- Token counting: `usage.input_tokens` + `usage.output_tokens` from response
- Max tokens per turn: 4096 (configurable via `internal_agent_config.maxResponseTokens`)

**OpenAI:**
- Uses `openai` npm package (already a dependency for `openai_api` adapter)
- Tool calls arrive as `tool_calls` array in assistant message chunks
- Need to accumulate JSON arguments across chunks (streamed incrementally)
- Token counting: `usage.prompt_tokens` + `usage.completion_tokens`

**Google:**
- Uses `@google/generative-ai` npm package (already a dependency for `gemini_api` adapter)
- Function calls arrive as `functionCall` in candidate parts
- Tool result must be sent as `functionResponse` in next turn
- Token counting: `usageMetadata.promptTokenCount` + `usageMetadata.candidatesTokenCount`

### Cost Tracking

Each agent run creates a `cost_events` row (existing table) with:
- `source: 'internal_agent'`
- `companyId`, `userId`
- `model`, `provider`
- `inputTokens`, `outputTokens`, `costCents` (integer, in cents)
- `metadata: { runId, triggerSource }`

Cost calculation uses per-model pricing constants (same approach as existing API adapters in `server/src/adapters/`). The internal agent's budget is tracked separately via `internal_agent_config.budgetMonthlyCents` and `spentMonthlyCents`.

---

## MCP Integration Changes

### Existing MCP (V2)

V2 MCP provides bidirectional integration:
- **Inbound:** External tools push content to AoA via MCP tools (`debrief-push`, `suggest-memory`, `update-task-status`, `attach-artifact-version`)
- **Outbound:** AoA exposes MCP resources (tasks, goals, memory, artifacts) as read-only

### V2.5 MCP Changes

#### New Inbound Tool: `push-discussion`

Replaces `debrief-push` as the primary inbound content tool. The old `debrief-push` tool still works but internally redirects to the discussion pipeline.

```typescript
// MCP Tool: push-discussion
{
  name: 'push-discussion',
  description: 'Push content to AoA as a discussion entry. Can create a new discussion or add to an existing one.',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The content to process (transcript, notes, etc.)' },
      title: { type: 'string', description: 'Discussion title (optional, auto-generated if omitted)' },
      discussionId: { type: 'string', description: 'Add to existing discussion (optional, creates new if omitted)' },
      inputType: { type: 'string', enum: ['paste', 'mcp'], default: 'mcp' },
      sourceInfo: {
        type: 'object',
        properties: {
          mcpSource: { type: 'string', description: 'Source identifier (e.g., "claude-cli", "cursor")' },
          mcpClientId: { type: 'string', description: 'Client session identifier' },
        },
      },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the discussion' },
    },
    required: ['content'],
  },
}
```

#### Backward Compatibility: `debrief-push`

The existing `debrief-push` MCP tool continues to work. Internally, it maps to `push-discussion`:

```typescript
// In MCP handler
if (toolName === 'debrief-push') {
  // Translate to discussion pipeline
  return handlePushDiscussion({
    content: params.content,
    inputType: 'mcp',
    sourceInfo: params.sourceInfo,
    // No discussionId → creates new standalone discussion
  });
}
```

#### New MCP Resource: `discussions`

Expose discussions as read-only MCP resources:

```typescript
// MCP Resources (additions)
{
  name: 'discussions',
  uri: 'aoa://discussions',
  description: 'List recent discussions',
  // Returns: array of { id, title, scopeType, entryCount, lastEntryAt }
}

{
  name: 'discussion',
  uri: 'aoa://discussions/{id}',
  description: 'Get a specific discussion with entries',
  // Returns: discussion + entries + extracted items
}
```

#### New MCP Tool: `search-discussions`

```typescript
{
  name: 'search-discussions',
  description: 'Search across discussion entries',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'number', default: 10 },
    },
    required: ['query'],
  },
}
```

#### CLI Execution Mode (DA-5)

When the internal agent is configured for CLI execution mode (`executionMode: 'cli'` or `'dual'`), MCP becomes the bridge:

```
User types in AoA agent panel
  → POST /internal-agent/chat
  → Backend detects CLI mode
  → Sends message to local Claude CLI via MCP
  → Claude CLI processes, calls AoA MCP tools for data
  → Results streamed back to AoA
  → Displayed in agent panel
```

This is a power-user option. API mode is the default and does not require MCP.

---

## Transcription Integration

### Voice Recording → Transcription Pipeline

Per DA-7 (entry source types) and existing V2 voice debrief (S21).

```
Browser MediaRecorder API
  → Audio blob (webm/opus or mp4/aac)
  → POST /discussions/:id/entries (multipart: audio file + metadata)
  → Backend: save audio to assets table
  → Backend: send to Whisper API for transcription
  → Transcription result → discussion_entries.content
  → Normal extraction pipeline continues
```

### Whisper API Integration

Reuse the existing transcription infrastructure from V2 voice debrief:

```typescript
// Existing in server/src/services/transcription.ts (V2)
async function transcribeAudio(audioBuffer: Buffer, format: string): Promise<string> {
  const response = await openai.audio.transcriptions.create({
    file: audioBuffer,
    model: 'whisper-1',
    language: 'en', // configurable
    response_format: 'text',
  });
  return response.text;
}
```

**V2.5 changes to transcription:**
- No architectural changes needed — the existing transcription service is reused
- The discussion entry creation endpoint accepts audio files (same as existing debrief endpoint)
- `inputType: 'voice'` is set on the discussion entry
- Audio asset is linked via `sourceAssetId` on the entry

### Cost Tracking for Transcription

Whisper API costs are tracked in `cost_events` with `source: 'transcription'` (existing pattern). Separate from the internal agent's budget.

---

## WebSocket Integration

### Existing WebSocket (LiveUpdatesProvider)

V2 uses WebSocket for real-time push events (task status changes, heartbeat updates, etc.). The frontend subscribes via `LiveUpdatesProvider` context.

### New WebSocket Events for V2.5

| Event Type | Payload | Trigger |
|------------|---------|---------|
| `discussion.entry.created` | `{ discussionId, entryId }` | New entry added to a discussion |
| `discussion.extraction.completed` | `{ discussionId, entryId, itemCount }` | Internal agent finishes extracting items from entry |
| `discussion.extraction.failed` | `{ discussionId, entryId, error }` | Extraction failed |
| `internal_agent.greeting` | `{ message }` | Morning digest or proactive greeting generated |
| `internal_agent.reminder` | `{ reminderId, content, relatedEntityType, relatedEntityId }` | Reminder fires |
| `internal_agent.notification` | `{ runId, message }` | Proactive run generated a notification |

### Integration Pattern

Events are published from backend services via the `publishLiveEvent()` function (from `server/src/services/live-events.ts`). New event types must be added to `LiveEventType` in `@paperclipai/shared`:

```typescript
// In DiscussionService
import { publishLiveEvent } from './live-events.js';

publishLiveEvent({
  companyId,
  type: 'discussion.extraction.completed',
  payload: { discussionId, entryId, itemCount: extractedItems.length },
});

// In ProactiveScheduler
publishLiveEvent({
  companyId,
  type: 'internal_agent.greeting',
  payload: { message: digestMessage },
});
```

Frontend handlers in `LiveUpdatesProvider`:

```typescript
// Handle new extraction results
useEffect(() => {
  liveEvents.on('discussion.extraction.completed', (data) => {
    queryClient.invalidateQueries(['discussion', data.discussionId]);
    notifications.add({
      type: 'info',
      message: `${data.itemCount} items extracted`,
      link: `/discussions/${data.discussionId}`,
    });
  });
}, []);
```

---

## SSE Integration (Agent Chat)

### Endpoint Setup

The `/companies/:companyId/internal-agent/chat` endpoint returns an SSE stream (not JSON). Express 5 supports SSE via `res.write()` + `res.flush()`:

```typescript
// In server/src/routes/internal-agent.ts
export function internalAgentRoutes(db: Db) {
  const router = Router();
  const agentSvc = internalAgentService(db);
  const secrets = secretService(db);

  router.post('/companies/:companyId/internal-agent/chat', async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const { message, pageContext } = req.body;

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Helper to write SSE events
    const writeSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
    };

    writeSSE('thinking', {});

    const result = await agentSvc.chat({
      companyId,
      userId: actor.actorId,
      userRole: actor.actorType,  // resolved from req.actor
      message,
      pageContext,
      onStream: (event) => writeSSE(event.type, event.data),
    });

    writeSSE('done', {
      runId: result.runId,
      tokenUsage: result.tokenUsage,
      costCents: result.costCents,
    });

    res.end();
  });

  return router;
}
```

### Frontend SSE Consumption

```typescript
// In ui/src/api/internal-agent.ts
export function chatWithAgent(params: {
  message: string;
  pageContext: string;
  onEvent: (event: AgentStreamEvent) => void;
}): AbortController {
  const controller = new AbortController();

  fetch('/api/internal-agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: params.message, pageContext: params.pageContext }),
    signal: controller.signal,
  }).then(async (response) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          const eventType = line.slice(7);
          // Next line is data
          continue;
        }
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          params.onEvent({ type: currentEventType, data });
        }
      }
    }
  });

  return controller;
}
```

---

## Existing Service Integration

### Services the Internal Agent Calls

The internal agent's tools wrap calls to existing services. Services follow the factory pattern (`export function issueService(db: Db) { return { list, create, ... } }`). The internal agent creates a `ServiceContainer` at startup that holds pre-instantiated service objects:

```typescript
// In server/src/services/internal-agent/tool-registry.ts
interface ServiceContainer {
  issues: ReturnType<typeof issueService>;
  goals: ReturnType<typeof goalService>;
  agents: ReturnType<typeof agentService>;
  projects: ReturnType<typeof projectService>;
  memory: ReturnType<typeof memoryService>;
  costs: ReturnType<typeof costService>;
  activity: ReturnType<typeof activityService>;
  heartbeat: ReturnType<typeof heartbeatService>;
  suggestions: ReturnType<typeof suggestionService>;
  artifacts: ReturnType<typeof artifactService>;
  dependencies: ReturnType<typeof dependencyService>;
  discussions: ReturnType<typeof discussionService>;       // NEW
  workflows: ReturnType<typeof workflowTemplateService>;   // NEW
  secrets: ReturnType<typeof secretService>;
}

function createServiceContainer(db: Db): ServiceContainer {
  return {
    issues: issueService(db),
    goals: goalService(db),
    // ... etc
  };
}
```

**Tool → Service mapping:**

| Tool | Service Factory | Method(s) Called |
|------|----------------|-----------------|
| `query_tasks` | `issueService(db)` | `.list(companyId, filters)`, `.getById(companyId, id)` |
| `query_goals` | `goalService(db)` | `.list(companyId)`, `.getById(id)` |
| `query_agents` | `agentService(db)` | `.list(companyId)`, `.getById(id)` |
| `query_departments` | `projectService(db)` | `.list(companyId, { type: 'department' })` |
| `query_budget` | `costService(db)` | `.list(companyId, filters)` |
| `query_activity` | `activityService(db)` | `.list(companyId, filters)` |
| `query_memory` | `memoryService(db)` | `.list(companyId, filters)`, `.searchSimilar(...)` |
| `create_task` | `issueService(db)` | `.create(companyId, data)` |
| `update_task` | `issueService(db)` | `.update(id, data)` |
| `assign_task` | `issueService(db)` | `.update(id, { assigneeId })` |
| `create_goal` | `goalService(db)` | `.create(companyId, data)` |
| `create_department` | `projectService(db)` | `.create(companyId, { type: 'department', ... })` |
| `create_agent` | `agentService(db)` | `.create(companyId, data)` |
| `update_agent` | `agentService(db)` | `.update(id, data)` |
| `wakeup_agent` | `heartbeatService(db, ...)` | `.wakeup(agentId)` |
| `create_memory` | `memoryService(db)` | `.create(companyId, data)` |
| `update_memory` | `memoryService(db)` | `.update(id, data)` |
| `find_similar_memory` | `memoryService(db)` | `.searchSimilar(companyId, params)` |
| `detect_conflicts` | `memoryService(db)` | (custom logic in tool, queries existing items) |
| `search_discussions` | `discussionService(db)` (new) | `.search(companyId, query)` |
| `extract_from_content` | `discussionService(db)` (new) | `.processEntry(entryId)` |
| `link_discussion_to_project` | `discussionService(db)` (new) | `.update(id, { scopeType, scopeId })` |
| `create_workflow_template` | `workflowTemplateService(db)` (new) | `.create(companyId, data)` |
| `instantiate_workflow` | `workflowTemplateService(db)` (new) | `.instantiate(templateId, goalId)` |
| `add_task_dependency` | `dependencyService(db)` | `.create(companyId, data)` |
| `read_file` | `artifactService(db)` | `.getVersionById(versionId)` |
| `query_dependency_chain` | `dependencyService(db)` | `.getChain(issueId)` |
| `analyze_workload` | `suggestionService(db)` | `.analyze(companyId)` |
| `suggest_improvements` | `suggestionService(db)` | `.generate(companyId)` |

### RBAC Integration

Tool execution passes through existing RBAC checks. Each tool includes the user's auth context:

```typescript
// Tool execution wrapper
async function executeTool(tool: AgentTool, params: unknown, ctx: ToolContext): Promise<ToolResult> {
  try {
    // The tool calls existing service functions which already check RBAC
    const result = await tool.execute(params, ctx);
    return result;
  } catch (error) {
    if (error.statusCode === 403) {
      return {
        success: false,
        data: null,
        summary: `Permission denied: ${error.message}`,
        error: 'FORBIDDEN',
      };
    }
    throw error;
  }
}
```

The agent receives the permission error as a tool result and can respond to the user: "I can't do that with your permissions."

### Discussion Service Integration with Existing Debrief

The new `DiscussionService` replaces `DebriefService` and `BriefService` but calls some of the same extraction logic:

```
DiscussionService.addEntry()
  → InternalAgentService.processDiscussionEntry()
    → Agent loop with extract_from_content tool
    → Extracted items stored in discussion_extracted_items
    → (NOT through old debrief/brief pipeline)

DiscussionService.approveItems()
  → Creates tasks via issues.ts (same as BriefService did)
  → Creates memory items via memory.ts (same as BriefService did)
  → Applies same validation rules
```

---

## Inbox Integration

### New Inbox Notification Types

| Type | When | Message | Link |
|------|------|---------|------|
| `discussion.extraction_complete` | Extraction finishes | "3 items ready for review in 'Dashboard Redesign'" | `/discussions/:id` |
| `discussion.extraction_failed` | Extraction fails | "Failed to process entry in 'Dashboard Redesign'" | `/discussions/:id` |
| `internal_agent.reminder` | Reminder fires | "Reminder: Follow up on dashboard project" | `/discussions/:id` or related entity |
| `internal_agent.proactive` | Proactive check finds something | "2 tasks have been blocked for 24+ hours" | Agent panel or relevant page |

Uses existing `notifications` / inbox infrastructure. New notification types added to the existing type enum.

---

## Migration Integration

### Old → New Route Redirects

Frontend route changes for backward compatibility:

```typescript
// In router config
{ path: '/briefs', redirect: '/discussions' },
{ path: '/briefs/:id', redirect: '/discussions' }, // briefs don't map 1:1 to discussions
{ path: '/debriefs', redirect: '/discussions' },
```

### API Redirect Layer

```typescript
// In server/src/routes/debriefs.ts (existing, modified)
// Old endpoints redirect to new discussion endpoints
router.post('/debriefs', async (req, res) => {
  // Translate to discussion creation — 307 preserves POST method + body
  res.redirect(307, `/api/companies/${req.params.companyId}/discussions`);
});

router.get('/briefs', async (req, res) => {
  // Redirect to discussions list filtered by pending items
  res.redirect(301, `/api/companies/${req.params.companyId}/discussions?hasPendingItems=true`);
});
```

Old routes are not deleted — they redirect. This allows any MCP clients using old endpoints to continue working during transition.

---

## Search Integration

### Global Search (Cmd+K) Updates

The existing global search (V2, S28) adds a new entity type: `discussion`.

```typescript
// In search service
const SEARCHABLE_ENTITIES = [
  'task',
  'goal',
  'agent',
  'memory',
  'artifact',
  'discussion', // NEW
];

// Discussion search query
const discussionSearch = db
  .select({
    id: discussions.id,
    title: discussions.title,
    type: sql<string>`'discussion'`,
    snippet: sql<string>`ts_headline('english', discussion_entries.content, query)`,
  })
  .from(discussions)
  .innerJoin(discussionEntries, eq(discussions.id, discussionEntries.discussionId))
  .where(
    and(
      eq(discussions.companyId, companyId),
      sql`to_tsvector('english', discussion_entries.content) @@ plainto_tsquery('english', ${query})`,
    ),
  )
  .limit(5);
```

---

## External Dependencies (No New Third-Party Services)

V2.5 does not add any new external service dependencies beyond what V2 already uses:

| Dependency | Used By | Already in V2? |
|------------|---------|---------------|
| Anthropic API | Internal agent (API mode) | Yes (claude_api adapter) |
| OpenAI API | Internal agent (API mode), Whisper | Yes (openai_api adapter, voice debrief) |
| Google Gemini API | Internal agent (API mode) | Yes (gemini_api adapter) |
| PostgreSQL + pgvector | Data storage, semantic search | Yes |
| WebSocket | Real-time events | Yes (LiveUpdatesProvider) |

The internal agent is a new consumer of existing integrations, not a new integration itself.
