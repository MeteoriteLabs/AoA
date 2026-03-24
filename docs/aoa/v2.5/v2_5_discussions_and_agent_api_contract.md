---
Feature: v2_5_discussions_and_agent
Doc type: api_contract
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_schema.md, v2_5_discussions_and_agent_decisions.md
---

# V2.5 Discussions & Internal Agent — API Contract

All new and changed endpoints with full request/response/error shapes. All routes are company-scoped: `/api/companies/:companyId/...`

Base URL pattern follows existing convention: `server/src/routes/{domain}.ts`

---

## 1. Discussion Routes

**File:** `server/src/routes/discussions.ts`

### 1.1 List Discussions

```
GET /api/companies/:companyId/discussions
```

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| status | string | 'active' | 'active' \| 'archived' \| 'all' |
| scopeType | string | — | Filter by 'department' \| 'project' \| 'goal' |
| scopeId | uuid | — | Filter by specific scope entity |
| hasPendingItems | boolean | — | Only discussions with pending extracted items |
| inputType | string | — | Filter by entry input type ('paste' \| 'write' \| 'voice' \| 'mcp') |
| search | string | — | Full-text search on discussion title and entry content |
| limit | number | 20 | Pagination limit (max 100) |
| offset | number | 0 | Pagination offset |
| sortBy | string | 'lastEntryAt' | 'lastEntryAt' \| 'createdAt' \| 'pendingItemCount' |
| sortOrder | string | 'desc' | 'asc' \| 'desc' |

**Response: 200 OK**
```json
{
  "discussions": [
    {
      "id": "uuid",
      "title": "Dashboard Redesign Client Call",
      "status": "active",
      "scopeType": "project",
      "scopeId": "uuid",
      "scopeName": "Dashboard Redesign",
      "tags": ["client", "design"],
      "entryCount": 3,
      "pendingItemCount": 2,
      "lastEntryAt": "2026-03-24T10:30:00Z",
      "lastEntryInputType": "voice",
      "createdBy": "user_id",
      "createdAt": "2026-03-20T09:00:00Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

**RBAC:** Any authenticated user in the company.

---

### 1.2 Get Discussion Detail

```
GET /api/companies/:companyId/discussions/:discussionId
```

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| includeEntries | boolean | true | Include entries with extracted items |
| includeAnnotations | boolean | true | Include annotations on entries |
| entryLimit | number | 50 | Max entries to return |
| entryOffset | number | 0 | Entry pagination offset |

**Response: 200 OK**
```json
{
  "id": "uuid",
  "title": "Dashboard Redesign Client Call",
  "status": "active",
  "scopeType": "project",
  "scopeId": "uuid",
  "scopeName": "Dashboard Redesign",
  "tags": ["client", "design"],
  "entryCount": 3,
  "pendingItemCount": 2,
  "createdBy": "user_id",
  "createdAt": "2026-03-20T09:00:00Z",
  "updatedAt": "2026-03-24T10:30:00Z",
  "entries": [
    {
      "id": "uuid",
      "inputType": "paste",
      "rawContent": "Meeting transcript text...",
      "title": "Client call March 20",
      "sourceInfo": { "transcriptionModel": "whisper-1" },
      "departmentId": null,
      "projectId": null,
      "goalId": null,
      "extractionStatus": "completed",
      "createdBy": "user_id",
      "createdAt": "2026-03-20T09:00:00Z",
      "extractedItems": [
        {
          "id": "uuid",
          "type": "task",
          "title": "Redesign dashboard layout",
          "description": "Client wants a cleaner layout with...",
          "suggestedPriority": "high",
          "suggestedDepartmentId": "uuid",
          "suggestedLayer": null,
          "suggestedGoalId": "uuid",
          "layer": null,
          "priority": null,
          "dedupAction": null,
          "status": "approved",
          "resultTaskId": "uuid",
          "resultMemoryId": null,
          "conflictsWith": null,
          "createdAt": "2026-03-20T09:01:00Z"
        }
      ],
      "annotations": [
        {
          "id": "uuid",
          "content": "Client sounded frustrated about timeline",
          "anchorStart": 245,
          "anchorEnd": 312,
          "createdBy": "user_id",
          "createdAt": "2026-03-20T09:15:00Z"
        }
      ]
    }
  ]
}
```

**Errors:**
- 404: Discussion not found
- 403: Not authorized for this company

---

### 1.3 Create Discussion

```
POST /api/companies/:companyId/discussions
```

**Request Body:**
```json
{
  "title": "Dashboard Redesign Client Call",
  "scopeType": "project",
  "scopeId": "uuid",
  "tags": ["client", "design"],
  "entry": {
    "inputType": "paste",
    "rawContent": "Meeting transcript text...",
    "title": "Client call March 20",
    "sourceInfo": { "transcriptionModel": "whisper-1" },
    "departmentId": "uuid",
    "projectId": "uuid",
    "goalId": "uuid"
  }
}
```

**Notes:**
- `title` is optional — auto-generated from first entry content if not provided.
- `entry` is optional — can create empty discussion thread, add entries later.
- If `entry` is provided, internal agent extraction is triggered automatically.

**Response: 201 Created**
```json
{
  "id": "uuid",
  "title": "Dashboard Redesign Client Call",
  "status": "active",
  "scopeType": "project",
  "scopeId": "uuid",
  "tags": ["client", "design"],
  "entryCount": 1,
  "pendingItemCount": 0,
  "lastEntryAt": "2026-03-20T09:00:00Z",
  "createdBy": "user_id",
  "createdAt": "2026-03-20T09:00:00Z",
  "entry": {
    "id": "uuid",
    "extractionStatus": "processing"
  }
}
```

**RBAC:** `founder` or `team_lead` role.

---

### 1.4 Update Discussion

```
PATCH /api/companies/:companyId/discussions/:discussionId
```

**Request Body (all fields optional):**
```json
{
  "title": "Updated title",
  "scopeType": "department",
  "scopeId": "uuid",
  "tags": ["client", "design", "urgent"],
  "status": "archived"
}
```

**Response: 200 OK** — Updated discussion object.

**RBAC:** `founder` or `team_lead` role.

---

### 1.5 Add Entry to Discussion

```
POST /api/companies/:companyId/discussions/:discussionId/entries
```

**Request Body:**
```json
{
  "inputType": "voice",
  "rawContent": "Transcribed voice memo text...",
  "title": "Follow-up thoughts",
  "sourceInfo": { "transcriptionModel": "whisper-1", "durationSeconds": 120 },
  "departmentId": "uuid",
  "projectId": "uuid",
  "goalId": "uuid"
}
```

**Response: 201 Created**
```json
{
  "id": "uuid",
  "discussionId": "uuid",
  "inputType": "voice",
  "rawContent": "Transcribed voice memo text...",
  "extractionStatus": "processing",
  "createdBy": "user_id",
  "createdAt": "2026-03-24T14:00:00Z"
}
```

**Side effects:**
- Internal agent extraction triggered automatically.
- Discussion `entryCount` incremented, `lastEntryAt` updated.
- Internal agent run record created.

**RBAC:** `founder` or `team_lead` role.

---

### 1.6 Reprocess Entry

```
POST /api/companies/:companyId/discussions/:discussionId/entries/:entryId/reprocess
```

Re-runs extraction on an entry with updated context (annotations, thread history).

**Request Body:** None (or optional `{ "includeAnnotations": true }`)

**Response: 200 OK**
```json
{
  "entryId": "uuid",
  "extractionStatus": "processing",
  "runId": "uuid"
}
```

**Side effects:**
- Existing pending extracted items for this entry are cleared.
- Approved/rejected items are preserved.
- New extraction run created.

**RBAC:** `founder` role only.

---

### 1.7 Update Extracted Item

```
PATCH /api/companies/:companyId/discussions/:discussionId/entries/:entryId/items/:itemId
```

**Request Body (all fields optional):**
```json
{
  "title": "Updated title",
  "description": "Updated description",
  "priority": "high",
  "layer": "domain",
  "suggestedDepartmentId": "uuid",
  "suggestedProjectId": "uuid",
  "suggestedGoalId": "uuid",
  "dedupAction": "update_existing",
  "selectedMemoryId": "uuid",
  "mergedContent": "Combined content...",
  "status": "approved"
}
```

**Response: 200 OK** — Updated item object.

**RBAC:** `founder` or `team_lead` role.

---

### 1.8 Approve Discussion Items

```
POST /api/companies/:companyId/discussions/:discussionId/approve
```

Approves all pending items (or specified items) in a discussion. Creates tasks and memory items atomically.

**Request Body:**
```json
{
  "itemIds": ["uuid", "uuid"],
  "approveAll": false
}
```

If `approveAll: true`, all pending items are approved. If `itemIds` provided, only those items.

**Response: 200 OK**
```json
{
  "approved": 5,
  "rejected": 0,
  "tasksCreated": [
    { "itemId": "uuid", "taskId": "uuid", "title": "Redesign dashboard" }
  ],
  "memoryItemsCreated": [
    { "itemId": "uuid", "memoryItemId": "uuid", "title": "Client prefers minimal design" }
  ],
  "memoryItemsUpdated": [
    { "itemId": "uuid", "memoryItemId": "uuid", "action": "update_existing" }
  ]
}
```

**Side effects:**
- Tasks created in `issues` table (status: 'todo' if assignee set, else 'backlog').
- Memory items created/updated per dedup action.
- Task dependencies created if items were linked.
- Discussion `pendingItemCount` updated.

**RBAC:** `founder` role only (same as current brief approval).

---

### 1.9 Add Annotation

```
POST /api/companies/:companyId/discussions/:discussionId/entries/:entryId/annotations
```

**Request Body:**
```json
{
  "content": "Client sounded frustrated about timeline",
  "anchorStart": 245,
  "anchorEnd": 312
}
```

**Response: 201 Created** — Annotation object.

**RBAC:** `founder` or `team_lead` role.

---

### 1.10 Link Entry to Discussion

```
POST /api/companies/:companyId/discussions/link
```

Move an entry from one discussion to another, or attach a standalone entry to an existing thread.

**Request Body:**
```json
{
  "entryId": "uuid",
  "targetDiscussionId": "uuid"
}
```

**Response: 200 OK**
```json
{
  "entryId": "uuid",
  "previousDiscussionId": "uuid",
  "newDiscussionId": "uuid"
}
```

**Side effects:**
- Source discussion counts updated.
- Target discussion counts updated.
- If source discussion has no entries left, it can be auto-archived.

**RBAC:** `founder` role only.

---

### 1.11 MCP Inbound (Updated)

```
POST /api/companies/:companyId/discussions/mcp
```

Replaces `POST /api/companies/:companyId/debriefs/mcp`. All MCP input routes through Discussion pipeline per updated Decision #14.

**Request Body:**
```json
{
  "content": "Raw content from MCP source",
  "title": "Optional title",
  "sourceInfo": {
    "mcpSource": "claude-cli",
    "mcpClientId": "session-abc123",
    "metadata": {}
  },
  "departmentId": "uuid",
  "projectId": "uuid",
  "goalId": "uuid",
  "discussionId": "uuid"
}
```

**Notes:**
- If `discussionId` provided, content added as entry to existing discussion.
- If not provided, creates a new standalone discussion.
- Internal agent processes the entry (triggers `mcp_inbound` run).

**Response: 201 Created** — Discussion + entry object.

**RBAC:** API key or MCP auth.

---

## 2. Internal Agent Routes

**File:** `server/src/routes/internal-agent.ts`

### 2.1 Send Message (Streaming)

```
POST /api/companies/:companyId/internal-agent/chat
```

Sends a message to the internal agent. Response is streamed via SSE.

**Request Body:**
```json
{
  "message": "What tasks are blocked right now?",
  "pageContext": "/issues"
}
```

**Response: 200 OK (SSE stream)**

```
event: thinking
data: {"status": "processing"}

event: tool_call
data: {"tool": "query_tasks", "input": {"status": "blocked"}}

event: tool_result
data: {"tool": "query_tasks", "summary": "Found 3 blocked tasks"}

event: content
data: {"delta": "You have 3 blocked tasks"}

event: content
data: {"delta": " right now:\n\n1. **Redesign dashboard**"}

event: content
data: {"delta": " — blocked by API migration task\n2. "}

event: done
data: {"messageId": "uuid", "runId": "uuid", "tokenUsage": {"input": 1200, "output": 350}, "costCents": 1}
```

**SSE Event Types:**
| Event | Description | Data |
|-------|-------------|------|
| `thinking` | Agent is processing | `{ status }` |
| `tool_call` | Agent is calling a tool | `{ tool, input }` |
| `tool_result` | Tool returned result | `{ tool, summary }` |
| `content` | Text response chunk | `{ delta }` |
| `action_confirm` | Agent asks to confirm an action | `{ action, description, confirmId }` |
| `done` | Stream complete | `{ messageId, runId, tokenUsage, costCents }` |
| `error` | Error occurred | `{ code, message }` |

**Notes:**
- `action_confirm` is used when the agent wants to create/modify something and autonomy level requires confirmation. Frontend shows confirm/reject buttons.
- Client should handle reconnection gracefully.

**RBAC:** Any authenticated user (agent operates with their role per DA-6).

**Errors:**
- 402: Budget exceeded (internal agent over monthly limit)
- 503: LLM provider unavailable

---

### 2.2 Confirm Agent Action

```
POST /api/companies/:companyId/internal-agent/confirm
```

Confirms or rejects an action the agent proposed during conversation.

**Request Body:**
```json
{
  "confirmId": "uuid",
  "approved": true
}
```

**Response: 200 OK**
```json
{
  "confirmId": "uuid",
  "result": "Task 'Redesign dashboard' created successfully",
  "entityType": "task",
  "entityId": "uuid"
}
```

---

### 2.3 Get Conversation

```
GET /api/companies/:companyId/internal-agent/conversation
```

Returns the current active conversation for the authenticated user.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| limit | number | 50 | Max messages to return |
| offset | number | 0 | Message offset |
| includeArchived | boolean | false | Include archived conversations |

**Response: 200 OK**
```json
{
  "conversation": {
    "id": "uuid",
    "status": "active",
    "messageCount": 127,
    "createdAt": "2026-03-01T08:00:00Z",
    "updatedAt": "2026-03-24T14:00:00Z"
  },
  "messages": [
    {
      "id": "uuid",
      "role": "assistant",
      "content": "Good morning TK. Here's what happened overnight...",
      "toolCalls": null,
      "pageContext": "/home",
      "createdAt": "2026-03-24T08:00:00Z"
    },
    {
      "id": "uuid",
      "role": "user",
      "content": "What tasks are blocked?",
      "pageContext": "/issues",
      "createdAt": "2026-03-24T08:01:00Z"
    }
  ],
  "summarizedContext": "Previous conversation summary...",
  "total": 127,
  "limit": 50,
  "offset": 0
}
```

---

### 2.4 Reset Conversation

```
DELETE /api/companies/:companyId/internal-agent/conversation
```

Archives the current conversation and starts a new one. Summarized context from the old conversation is preserved and accessible.

**Response: 200 OK**
```json
{
  "archivedConversationId": "uuid",
  "newConversationId": "uuid"
}
```

---

### 2.5 Get Agent Config

```
GET /api/companies/:companyId/internal-agent/config
```

**Response: 200 OK**
```json
{
  "id": "uuid",
  "executionMode": "api",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "cliTool": null,
  "autonomyLevel": 0,
  "enabledCapabilities": [
    "discussion_processing",
    "proactive_suggestions",
    "organizational_queries",
    "system_actions",
    "context_briefing",
    "memory_management",
    "conflict_detection",
    "budget_awareness",
    "workflow_coaching",
    "workflow_discovery",
    "cross_department_coordination",
    "department_personas"
  ],
  "notificationPreference": "realtime",
  "contextTokenBudget": 8000,
  "budgetMonthlyCents": 5000,
  "spentMonthlyCents": 1234,
  "proactiveIntervalMinutes": 240,
  "lastProactiveRunAt": "2026-03-24T06:00:00Z"
}
```

**RBAC:** `founder` role only.

---

### 2.6 Update Agent Config

```
PATCH /api/companies/:companyId/internal-agent/config
```

**Request Body (all fields optional):**
```json
{
  "executionMode": "api",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "cliTool": null,
  "autonomyLevel": 0,
  "enabledCapabilities": ["discussion_processing", "organizational_queries"],
  "notificationPreference": "digest",
  "contextTokenBudget": 12000,
  "budgetMonthlyCents": 10000,
  "proactiveIntervalMinutes": 120
}
```

**Response: 200 OK** — Updated config object.

**Validation:**
- `autonomyLevel` must be 0 in v2.5 (reject 1-3 with 400)
- `contextTokenBudget` minimum 2000, maximum 32000
- `proactiveIntervalMinutes` minimum 30, maximum 1440

**RBAC:** `founder` role only.

---

### 2.7 Get Agent Runs

```
GET /api/companies/:companyId/internal-agent/runs
```

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| triggerType | string | — | Filter: 'conversation' \| 'proactive' \| 'event' \| 'sub_agent' |
| triggerSource | string | — | Filter by specific source |
| status | string | — | Filter: 'running' \| 'completed' \| 'failed' |
| limit | number | 20 | Pagination limit |
| offset | number | 0 | Pagination offset |
| from | ISO date | — | Start date filter |
| to | ISO date | — | End date filter |

**Response: 200 OK**
```json
{
  "runs": [
    {
      "id": "uuid",
      "triggerType": "conversation",
      "triggerSource": "user_message",
      "status": "completed",
      "toolsCalled": [
        { "name": "query_tasks", "durationMs": 45, "success": true },
        { "name": "query_goals", "durationMs": 32, "success": true }
      ],
      "tokenUsage": { "inputTokens": 1200, "outputTokens": 350 },
      "costCents": 1,
      "durationMs": 2340,
      "summary": "Answered question about blocked tasks",
      "departmentContext": null,
      "userId": "user_id",
      "createdAt": "2026-03-24T08:01:00Z",
      "completedAt": "2026-03-24T08:01:02Z"
    }
  ],
  "total": 1543,
  "limit": 20,
  "offset": 0,
  "aggregates": {
    "totalCostCents": 1245,
    "totalRuns": 1543,
    "avgDurationMs": 1850,
    "failureRate": 0.02
  }
}
```

**RBAC:** `founder` role only.

---

### 2.8 Get Reminders

```
GET /api/companies/:companyId/internal-agent/reminders
```

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| status | string | 'pending' | 'pending' \| 'fired' \| 'cancelled' \| 'all' |

**Response: 200 OK**
```json
{
  "reminders": [
    {
      "id": "uuid",
      "content": "Follow up on dashboard project",
      "triggerAt": "2026-03-28T09:00:00Z",
      "status": "pending",
      "relatedEntityType": "project",
      "relatedEntityId": "uuid",
      "createdAt": "2026-03-24T14:00:00Z"
    }
  ]
}
```

---

### 2.9 Cancel Reminder

```
PATCH /api/companies/:companyId/internal-agent/reminders/:reminderId
```

**Request Body:**
```json
{
  "status": "cancelled"
}
```

**Response: 200 OK** — Updated reminder.

---

## 3. Workflow Template Routes

**File:** `server/src/routes/workflow-templates.ts`

### 3.1 List Templates

```
GET /api/companies/:companyId/workflow-templates
```

**Response: 200 OK**
```json
{
  "templates": [
    {
      "id": "uuid",
      "name": "Feature Development Pipeline",
      "description": "Standard flow: spec → design → code → test → UAT",
      "stepCount": 5,
      "instantiationCount": 3,
      "lastInstantiatedAt": "2026-03-20T10:00:00Z",
      "createdBy": "internal_agent",
      "createdAt": "2026-03-15T14:00:00Z"
    }
  ]
}
```

---

### 3.2 Get Template

```
GET /api/companies/:companyId/workflow-templates/:templateId
```

**Response: 200 OK**
```json
{
  "id": "uuid",
  "name": "Feature Development Pipeline",
  "description": "Standard flow: spec → design → code → test → UAT",
  "steps": [
    {
      "order": 1,
      "title": "Write spec",
      "description": "Create technical specification document",
      "role": "pm",
      "suggestedAssigneeType": "human",
      "suggestedDepartmentId": "uuid",
      "estimatedDurationHours": 4,
      "priority": "high"
    },
    {
      "order": 2,
      "title": "Create designs",
      "description": "Design UI based on spec",
      "role": "designer",
      "suggestedAssigneeType": "agent",
      "suggestedDepartmentId": "uuid",
      "estimatedDurationHours": 8,
      "priority": "high"
    }
  ],
  "dependencies": [
    { "fromStep": 1, "toStep": 2 },
    { "fromStep": 2, "toStep": 3 },
    { "fromStep": 3, "toStep": 4 },
    { "fromStep": 4, "toStep": 5 }
  ],
  "instantiationCount": 3,
  "createdBy": "internal_agent",
  "createdAt": "2026-03-15T14:00:00Z"
}
```

---

### 3.3 Create Template

```
POST /api/companies/:companyId/workflow-templates
```

**Request Body:**
```json
{
  "name": "Feature Development Pipeline",
  "description": "Standard flow for feature development",
  "steps": [...],
  "dependencies": [...]
}
```

**Response: 201 Created** — Template object.

**Validation:**
- `steps` must have at least 2 items
- `dependencies` must reference valid step orders
- No circular dependencies
- Step orders must be sequential starting from 1

**RBAC:** `founder` or `team_lead` role.

---

### 3.4 Update Template

```
PATCH /api/companies/:companyId/workflow-templates/:templateId
```

**Request Body (all fields optional):**
```json
{
  "name": "Updated name",
  "description": "Updated description",
  "steps": [...],
  "dependencies": [...]
}
```

**Response: 200 OK** — Updated template.

---

### 3.5 Instantiate Template

```
POST /api/companies/:companyId/workflow-templates/:templateId/instantiate
```

Creates tasks from the template with proper dependencies.

**Request Body:**
```json
{
  "goalId": "uuid",
  "departmentId": "uuid",
  "prefix": "Dashboard Redesign",
  "assignees": {
    "1": "agent-uuid",
    "2": "agent-uuid",
    "3": null
  }
}
```

**Notes:**
- `prefix` prepended to each task title: "Dashboard Redesign: Write spec"
- `assignees` maps step order → agent/user ID. Null = unassigned (backlog).
- Tasks linked to goal via `goalId`.
- Dependencies created in `task_dependencies` table.

**Response: 201 Created**
```json
{
  "templateId": "uuid",
  "tasksCreated": [
    { "stepOrder": 1, "taskId": "uuid", "title": "Dashboard Redesign: Write spec" },
    { "stepOrder": 2, "taskId": "uuid", "title": "Dashboard Redesign: Create designs" }
  ],
  "dependenciesCreated": 4
}
```

**Side effects:**
- Tasks created with status 'todo' (if assigned) or 'backlog' (if unassigned).
- First task in dependency chain unblocked; subsequent tasks blocked.
- Template `instantiationCount` incremented.

**RBAC:** `founder` or `team_lead` role.

---

### 3.6 Delete Template

```
DELETE /api/companies/:companyId/workflow-templates/:templateId
```

**Response: 204 No Content**

**Note:** Does not affect previously instantiated tasks.

**RBAC:** `founder` role only.

---

## 4. Deprecated Routes

### Old Debrief Routes (kept for backward compatibility)

```
GET  /api/companies/:companyId/debriefs        → 301 redirect to /discussions
POST /api/companies/:companyId/debriefs         → 301 redirect to /discussions
GET  /api/companies/:companyId/debriefs/:id     → 301 redirect to /discussions/:mappedId
POST /api/companies/:companyId/debriefs/mcp     → proxies to /discussions/mcp
```

### Old Brief Routes (kept for backward compatibility)

```
GET  /api/companies/:companyId/briefs           → 301 redirect to /discussions
GET  /api/companies/:companyId/briefs/:id       → 301 redirect to /discussions/:mappedId
POST /api/companies/:companyId/briefs/:id/approve → 301 redirect to /discussions/:mappedId/approve
```

Redirect mapping maintained via a lookup from old debrief/brief IDs to new discussion IDs (populated during migration).

---

## 5. WebSocket Events (New)

Added to existing LiveEvents system.

| Event Type | Payload | Trigger |
|------------|---------|---------|
| `internal_agent.message` | `{ conversationId, messageId, role, content (partial for streaming) }` | Agent sends a message |
| `internal_agent.run.status` | `{ runId, status, summary }` | Run completes or fails |
| `internal_agent.reminder` | `{ reminderId, content, relatedEntityType, relatedEntityId }` | Reminder fires |
| `discussion.entry.created` | `{ discussionId, entryId, inputType }` | New entry added |
| `discussion.extraction.completed` | `{ discussionId, entryId, itemCount, pendingCount }` | Extraction finished |
| `discussion.items.approved` | `{ discussionId, tasksCreated, memoryCreated }` | Items approved |

These events trigger React Query invalidation in the frontend via the existing LiveUpdatesProvider pattern.

---

## 6. Error Codes

Standard error response format (matches existing pattern):

```json
{
  "error": {
    "code": "DISCUSSION_NOT_FOUND",
    "message": "Discussion with id xyz not found",
    "status": 404
  }
}
```

| Code | Status | Description |
|------|--------|-------------|
| `DISCUSSION_NOT_FOUND` | 404 | Discussion does not exist |
| `ENTRY_NOT_FOUND` | 404 | Discussion entry does not exist |
| `ITEM_NOT_FOUND` | 404 | Extracted item does not exist |
| `TEMPLATE_NOT_FOUND` | 404 | Workflow template does not exist |
| `AGENT_NOT_CONFIGURED` | 400 | Internal agent not configured for this company |
| `AGENT_BUDGET_EXCEEDED` | 402 | Internal agent monthly budget exceeded |
| `AGENT_PROVIDER_ERROR` | 502 | LLM provider returned an error |
| `AGENT_PROVIDER_UNAVAILABLE` | 503 | LLM provider not reachable |
| `EXTRACTION_FAILED` | 500 | Internal agent extraction failed |
| `CIRCULAR_DEPENDENCY` | 400 | Workflow template has circular dependencies |
| `INVALID_STEP_ORDER` | 400 | Workflow step orders are not sequential |
| `CONVERSATION_NOT_FOUND` | 404 | No active conversation for this user |
| `APPROVAL_FORBIDDEN` | 403 | Only founder can approve items |
| `ENTRY_ALREADY_PROCESSING` | 409 | Entry extraction already in progress |
