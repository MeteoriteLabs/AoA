---
Feature: v2_5_discussions_and_agent
Doc type: schema
Status: draft
Created: 2026-03-24
Last updated: 2026-03-24
Updated by: agent
Depends on: v2_5_discussions_and_agent_decisions.md, v2_5_discussions_and_agent_prd.md
---

# V2.5 Discussions & Internal Agent — Schema

Complete data model with all new tables, modified tables, indexes, migration strategy, and rollback plan. All schemas follow Drizzle ORM patterns per CLAUDE.md Critical Rule #1.

---

## New Tables

### 1. `discussions`

Thread container. One discussion = one thread of related conversation entries.

```typescript
// packages/db/src/schema/discussions.ts

export const discussions = pgTable('discussions', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  title: text('title'), // nullable — auto-generated if not provided
  status: text('status').notNull().default('active'), // 'active' | 'archived'

  // Polymorphic scope — what this discussion is about
  scopeType: text('scope_type'), // 'department' | 'project' | 'goal' | null
  scopeId: uuid('scope_id'), // FK resolved at app level based on scopeType

  tags: jsonb('tags').default([]), // string array for flexible categorization

  // Metadata
  entryCount: integer('entry_count').notNull().default(0), // denormalized for list performance
  pendingItemCount: integer('pending_item_count').notNull().default(0), // denormalized
  lastEntryAt: timestamp('last_entry_at', { withTimezone: true }),

  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyIdx: index('discussions_company_idx').on(table.companyId),
  companyStatusIdx: index('discussions_company_status_idx').on(table.companyId, table.status),
  scopeIdx: index('discussions_scope_idx').on(table.scopeType, table.scopeId),
  lastEntryIdx: index('discussions_last_entry_idx').on(table.companyId, table.lastEntryAt),
}));
```

**Notes:**
- `scopeType` + `scopeId` is polymorphic to avoid multiple nullable FK columns. App-level validation ensures scopeId references the correct table based on scopeType.
- `entryCount` and `pendingItemCount` are denormalized for list page performance. Updated via triggers or service-level increment/decrement.
- `tags` is a JSON string array, not a junction table. Simpler for v2.5; can migrate to a junction table if tag management becomes complex.

---

### 2. `discussion_entries`

Individual messages in a discussion thread. Each entry is one piece of input (transcript, voice memo, MCP push, typed note).

```typescript
export const discussionEntries = pgTable('discussion_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  discussionId: uuid('discussion_id').notNull().references(() => discussions.id, { onDelete: 'cascade' }),

  // Input
  inputType: text('input_type').notNull(), // 'paste' | 'write' | 'voice' | 'mcp'
  rawContent: text('raw_content').notNull(),
  title: text('title'), // nullable, optional per-entry title

  // Source metadata
  sourceInfo: jsonb('source_info'), // { transcriptionModel, mcpSource, mcpClientId, ... }

  // Scope override (entry-level > discussion-level, per Decision #61 pattern)
  departmentId: uuid('department_id').references(() => projects.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  goalId: uuid('goal_id').references(() => goals.id, { onDelete: 'set null' }),

  // Processing state
  extractionStatus: text('extraction_status').notNull().default('pending'),
  // 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'
  extractionRunId: uuid('extraction_run_id')
    .references(() => internalAgentRuns.id, { onDelete: 'set null' }),

  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  discussionIdx: index('discussion_entries_discussion_idx').on(table.discussionId),
  extractionStatusIdx: index('discussion_entries_extraction_status_idx').on(table.extractionStatus),
  createdAtIdx: index('discussion_entries_created_at_idx').on(table.discussionId, table.createdAt),
}));
```

**Notes:**
- `extractionStatus` tracks whether the internal agent has processed this entry.
- `extractionRunId` links to the `internal_agent_runs` record that processed this entry.
- `sourceInfo` for MCP entries includes the MCP client identifier for future auto-threading.

---

### 3. `discussion_extracted_items`

Items extracted from discussion entries. Replaces `brief_items`. Same structure with minor additions.

```typescript
export const discussionExtractedItems = pgTable('discussion_extracted_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  discussionEntryId: uuid('discussion_entry_id').notNull()
    .references(() => discussionEntries.id, { onDelete: 'cascade' }),

  // Item content
  type: text('type').notNull(),
  // 'decision' | 'task' | 'insight' | 'context' | 'reference' | 'preference'
  title: text('title').notNull(),
  description: text('description'),

  // Suggestions from extraction
  suggestedPriority: text('suggested_priority'), // tasks: 'urgent' | 'high' | 'medium' | 'low'
  suggestedAssigneeId: uuid('suggested_assignee_id'),
  suggestedDepartmentId: uuid('suggested_department_id')
    .references(() => projects.id, { onDelete: 'set null' }),
  suggestedProjectId: uuid('suggested_project_id')
    .references(() => projects.id, { onDelete: 'set null' }),
  suggestedLayer: text('suggested_layer'), // memory: 'identity' | 'domain' | 'active_context' | 'working'
  suggestedGoalId: uuid('suggested_goal_id')
    .references(() => goals.id, { onDelete: 'set null' }),

  // Founder overrides (applied during review)
  layer: text('layer'), // actual memory layer chosen by founder
  priority: text('priority'), // actual priority chosen by founder

  // Memory dedup
  dedupAction: text('dedup_action'), // 'create_separate' | 'update_existing' | 'replace'
  selectedMemoryId: uuid('selected_memory_id')
    .references(() => memoryItems.id, { onDelete: 'set null' }),
  mergedContent: text('merged_content'), // preview of merge result

  // Status
  status: text('status').notNull().default('pending'),
  // 'pending' | 'approved' | 'rejected' | 'edited'

  // Result links (populated after approval)
  resultTaskId: uuid('result_task_id').references(() => issues.id, { onDelete: 'set null' }),
  resultMemoryId: uuid('result_memory_id')
    .references(() => memoryItems.id, { onDelete: 'set null' }),

  // Conflict detection
  conflictsWith: jsonb('conflicts_with'), // array of { entityType, entityId, description }

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  entryIdx: index('discussion_extracted_items_entry_idx').on(table.discussionEntryId),
  statusIdx: index('discussion_extracted_items_status_idx').on(table.discussionEntryId, table.status),
}));
```

**Notes:**
- `conflictsWith` is new (not in brief_items). Populated by the internal agent's conflict detection during extraction.
- `suggestedGoalId` is new — allows extraction to suggest linking items to goals.
- Structure otherwise mirrors `brief_items` for migration compatibility.

---

### 4. `discussion_annotations`

Founder annotations on discussion entries. Metadata, not extractable content.

```typescript
export const discussionAnnotations = pgTable('discussion_annotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  discussionEntryId: uuid('discussion_entry_id').notNull()
    .references(() => discussionEntries.id, { onDelete: 'cascade' }),

  content: text('content').notNull(),

  // Position in the entry text (for inline annotations)
  // null = general annotation on the whole entry
  anchorStart: integer('anchor_start'), // character offset start
  anchorEnd: integer('anchor_end'), // character offset end

  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  entryIdx: index('discussion_annotations_entry_idx').on(table.discussionEntryId),
}));
```

**Notes:**
- `anchorStart` / `anchorEnd` enable inline annotations at specific positions in the transcript text.
- If both are null, the annotation is a general note on the entire entry.

---

### 5. `internal_agent_config`

Per-company configuration for the internal agent. One row per company.

```typescript
export const internalAgentConfig = pgTable('internal_agent_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().unique()
    .references(() => companies.id, { onDelete: 'cascade' }),

  // Execution mode
  executionMode: text('execution_mode').notNull().default('api'), // 'api' | 'cli'

  // API mode settings
  provider: text('provider').default('anthropic'), // 'anthropic' | 'openai' | 'google'
  model: text('model').default('claude-sonnet-4-6'),

  // CLI mode settings
  cliTool: text('cli_tool'), // 'claude_cli' | 'codex' | 'opencode' | null

  // Autonomy
  autonomyLevel: integer('autonomy_level').notNull().default(0), // 0-3, v2.5 ships with 0 only

  // Capabilities
  enabledCapabilities: jsonb('enabled_capabilities').notNull().default([
    'discussion_processing', 'proactive_suggestions', 'organizational_queries',
    'system_actions', 'context_briefing', 'memory_management',
    'conflict_detection', 'budget_awareness', 'workflow_coaching',
    'workflow_discovery', 'cross_department_coordination', 'department_personas'
  ]),

  // Notifications
  notificationPreference: text('notification_preference').notNull().default('realtime'),
  // 'silent' | 'digest' | 'realtime'

  // Context
  contextTokenBudget: integer('context_token_budget').notNull().default(8000),

  // Budget
  budgetMonthlyCents: integer('budget_monthly_cents'), // null = unlimited
  spentMonthlyCents: integer('spent_monthly_cents').notNull().default(0),

  // Proactive scheduling
  proactiveIntervalMinutes: integer('proactive_interval_minutes').notNull().default(240), // 4 hours
  lastProactiveRunAt: timestamp('last_proactive_run_at', { withTimezone: true }),

  // Metadata
  metadata: jsonb('metadata').default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyIdx: uniqueIndex('internal_agent_config_company_uq').on(table.companyId),
}));
```

**Notes:**
- One row per company enforced by unique constraint on `companyId`.
- `enabledCapabilities` is a JSON array of capability identifiers. All enabled by default.
- `spentMonthlyCents` reset monthly (same pattern as worker agents).
- `proactiveIntervalMinutes` configurable, default 4 hours.

---

### 6. `internal_agent_conversations`

Conversation container. One active conversation per user per company.

```typescript
export const internalAgentConversations = pgTable('internal_agent_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),

  status: text('status').notNull().default('active'), // 'active' | 'archived'

  // Summarized context from older messages
  summarizedContext: text('summarized_context'), // compressed history for token management
  summarizedUpToMessageId: uuid('summarized_up_to_message_id'), // last message included in summary

  messageCount: integer('message_count').notNull().default(0), // denormalized

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyUserIdx: index('ia_conversations_company_user_idx').on(table.companyId, table.userId),
  activeIdx: index('ia_conversations_active_idx').on(table.companyId, table.userId, table.status),
}));
```

**Notes:**
- `summarizedContext` holds the compressed version of older messages. Updated periodically when conversation exceeds token threshold.
- When user resets conversation, current conversation is archived (status='archived') and a new one created.
- Old archived conversations remain queryable for context retrieval.

---

### 7. `internal_agent_messages`

Individual messages in an internal agent conversation.

```typescript
export const internalAgentMessages = pgTable('internal_agent_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull()
    .references(() => internalAgentConversations.id, { onDelete: 'cascade' }),

  role: text('role').notNull(), // 'user' | 'assistant' | 'system' | 'tool_call' | 'tool_result'
  content: text('content'), // nullable for tool_call messages where content is in toolCalls

  // Tool interaction
  toolCalls: jsonb('tool_calls'), // array of { id, name, input } — when role='assistant' and agent called tools
  toolResults: jsonb('tool_results'), // array of { toolCallId, result } — when role='tool_result'

  // Context at time of message
  pageContext: text('page_context'), // which page the user was on (e.g., '/issues', '/projects/xyz')
  departmentContext: uuid('department_context'), // if agent was in department persona mode

  // Metadata
  tokenCount: integer('token_count'), // estimated tokens this message consumed
  runId: uuid('run_id'), // FK to internal_agent_runs that processed this message

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  conversationIdx: index('ia_messages_conversation_idx').on(table.conversationId),
  conversationTimeIdx: index('ia_messages_conversation_time_idx')
    .on(table.conversationId, table.createdAt),
  runIdx: index('ia_messages_run_idx').on(table.runId),
}));
```

**Notes:**
- `role` includes `tool_call` and `tool_result` to faithfully represent the agent loop conversation.
- `pageContext` captures what the founder was looking at, enabling context-aware responses.
- `tokenCount` is estimated (chars/4) for budget tracking.

---

### 8. `internal_agent_runs`

Run tracking system — the internal agent's heartbeat. Per Decision DA-27.

```typescript
export const internalAgentRuns = pgTable('internal_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),

  // Trigger classification
  triggerType: text('trigger_type').notNull(),
  // 'conversation' | 'proactive' | 'event' | 'sub_agent'
  triggerSource: text('trigger_source').notNull(),
  // Extensible: 'user_message', 'discussion_entry', 'mcp_inbound', 'scheduled_check',
  // 'morning_digest', 'reminder', 'task_completed', 'task_status_change',
  // 'agent_error', 'agent_budget_alert', 'ttl_expiry', etc.

  // Execution state
  status: text('status').notNull().default('running'),
  // 'running' | 'completed' | 'failed'
  errorMessage: text('error_message'), // populated on failure

  // What the agent did
  toolsCalled: jsonb('tools_called').default([]),
  // array of { name, input, output, durationMs, success }
  summary: text('summary'), // human-readable summary of what happened

  // Cost tracking
  tokenUsage: jsonb('token_usage'),
  // { inputTokens, outputTokens, cachedInputTokens }
  costCents: integer('cost_cents'),
  durationMs: integer('duration_ms'),

  // Context
  departmentContext: uuid('department_context')
    .references(() => projects.id, { onDelete: 'set null' }),
  userId: text('user_id'), // who triggered (null for proactive/event)
  conversationMessageId: uuid('conversation_message_id'), // FK to message that triggered this

  // Related entity
  relatedEntityType: text('related_entity_type'),
  // 'discussion' | 'task' | 'agent' | 'goal' | 'memory' | null
  relatedEntityId: uuid('related_entity_id'),

  // LLM info
  provider: text('provider'), // 'anthropic' | 'openai' | 'google'
  model: text('model'), // specific model used

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  companyIdx: index('ia_runs_company_idx').on(table.companyId),
  companyStatusIdx: index('ia_runs_company_status_idx').on(table.companyId, table.status),
  triggerIdx: index('ia_runs_trigger_idx').on(table.companyId, table.triggerType, table.triggerSource),
  createdAtIdx: index('ia_runs_created_at_idx').on(table.companyId, table.createdAt),
  relatedEntityIdx: index('ia_runs_related_entity_idx')
    .on(table.relatedEntityType, table.relatedEntityId),
}));
```

---

### 9. `internal_agent_reminders`

Scheduled reminders created by the internal agent on founder's request.

```typescript
export const internalAgentReminders = pgTable('internal_agent_reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),

  content: text('content').notNull(), // "Follow up on dashboard project"
  triggerAt: timestamp('trigger_at', { withTimezone: true }).notNull(),

  status: text('status').notNull().default('pending'),
  // 'pending' | 'fired' | 'cancelled'

  firedRunId: uuid('fired_run_id'), // FK to the run that fired this reminder

  // Optional link to entity
  relatedEntityType: text('related_entity_type'),
  relatedEntityId: uuid('related_entity_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyUserIdx: index('ia_reminders_company_user_idx').on(table.companyId, table.userId),
  pendingIdx: index('ia_reminders_pending_idx').on(table.status, table.triggerAt),
}));
```

---

### 10. `workflow_templates`

Reusable process patterns created by the internal agent or founder.

```typescript
export const workflowTemplates = pgTable('workflow_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  description: text('description'),

  // Ordered steps with role assignments
  steps: jsonb('steps').notNull(),
  // Array of:
  // {
  //   order: number,
  //   title: string,
  //   description: string,
  //   role: string (agent role or 'human'),
  //   suggestedAssigneeType: 'agent' | 'human' | 'any',
  //   suggestedDepartmentId: uuid | null,
  //   estimatedDurationHours: number | null,
  //   priority: 'urgent' | 'high' | 'medium' | 'low'
  // }

  // Dependencies between steps
  dependencies: jsonb('dependencies').notNull().default([]),
  // Array of: { fromStep: number (order), toStep: number (order) }

  // Usage tracking
  instantiationCount: integer('instantiation_count').notNull().default(0),
  lastInstantiatedAt: timestamp('last_instantiated_at', { withTimezone: true }),

  createdBy: text('created_by').notNull(), // userId or 'internal_agent'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyIdx: index('workflow_templates_company_idx').on(table.companyId),
}));
```

**Notes:**
- `steps` and `dependencies` are JSON rather than separate tables — simpler for v2.5, adequate for the template use case.
- When instantiated, each step becomes a task in the `issues` table with dependencies created in `task_dependencies`.
- `createdBy` can be 'internal_agent' when the agent creates a template from conversation.

---

### 11. `notifications`

Persistent notification records for actions that need to survive offline periods (extraction results, reminders, proactive findings). Replaces the implicit "inbox" built from approvals + sidebar badges.

```typescript
// packages/db/src/schema/notifications.ts

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), // recipient

  // Notification content
  type: text('type').notNull(),
  // 'discussion.extraction_complete' | 'discussion.extraction_failed'
  // | 'internal_agent.reminder' | 'internal_agent.proactive'
  // | 'internal_agent.action_result'
  title: text('title').notNull(),
  message: text('message'),

  // Link to related entity
  relatedEntityType: text('related_entity_type'),
  // 'discussion' | 'task' | 'goal' | 'agent' | 'memory' | 'reminder'
  relatedEntityId: uuid('related_entity_id'),

  // State
  readAt: timestamp('read_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyUserIdx: index('notifications_company_user_idx').on(table.companyId, table.userId),
  unreadIdx: index('notifications_unread_idx').on(table.companyId, table.userId, table.readAt),
  createdAtIdx: index('notifications_created_at_idx').on(table.companyId, table.createdAt),
}));
```

**Notes:**
- `readAt` null = unread. This allows efficient unread count queries.
- `dismissedAt` allows users to clear notifications without "reading" them.
- Notifications are created by: extraction completion, reminder firing, proactive check results, and action confirmations.
- The inbox page aggregates these alongside existing approval items.
- Cleanup: notifications older than 90 days can be archived (future, not v2.5 scope).

---

## Modified Tables

### `cost_events`

Add support for internal agent cost tracking.

```typescript
// Existing cost_events table — add new source type support
// No schema change needed if 'source' is a text field.
// The service layer will write cost_events with:
//   source: 'internal_agent'
//   sourceId: internal_agent_run.id
//   agentId: null (internal agent is not in agents table)
```

**Note:** If the existing `cost_events` table has a NOT NULL constraint or FK on `agentId`, this needs to be relaxed to allow null for internal agent costs. Check during implementation.

---

## Migration Strategy

### Phase 1: Create New Tables

Run Drizzle schema generation for all 11 new tables. Order matters for FK dependencies:

1. `discussions` (depends on: companies)
2. `discussion_entries` (depends on: discussions, projects, goals)
3. `discussion_extracted_items` (depends on: discussion_entries, projects, goals, memory_items, issues)
4. `discussion_annotations` (depends on: discussion_entries)
5. `internal_agent_config` (depends on: companies)
6. `internal_agent_conversations` (depends on: companies)
7. `internal_agent_messages` (depends on: internal_agent_conversations)
8. `internal_agent_runs` (depends on: companies, projects)
9. `internal_agent_reminders` (depends on: companies)
10. `workflow_templates` (depends on: companies)
11. `notifications` (depends on: companies)

### Phase 2: Migrate Existing Data

Per Decision DA-16, migrate debriefs and briefs into the new Discussion model.

```
For each debrief:
  1. Create discussions row:
     - title: debrief.title
     - companyId: debrief.companyId
     - status: 'active' (or 'archived' if debrief.status = 'archived')
     - scopeType/scopeId: derived from debrief.departmentId or debrief.projectId or debrief.goalId
     - createdBy: debrief.createdBy
     - createdAt: debrief.createdAt

  2. Create discussion_entries row:
     - discussionId: new discussion id
     - inputType: debrief.inputType
     - rawContent: debrief.rawContent
     - title: debrief.title
     - sourceInfo: debrief.sourceInfo
     - departmentId: debrief.departmentId
     - projectId: debrief.projectId
     - goalId: debrief.goalId
     - extractionStatus: map from debrief.status
       'ready' → 'completed'
       'processing' → 'completed' (brief exists)
       'processing_failed' → 'failed'
     - createdBy: debrief.createdBy
     - createdAt: debrief.createdAt

  3. For the associated brief + brief_items:
     For each brief_item:
       Create discussion_extracted_items row:
         - discussionEntryId: new entry id
         - type: brief_item.type
         - title: brief_item.title
         - description: brief_item.description
         - suggestedPriority: brief_item.suggestedPriority
         - suggestedAssigneeId: brief_item.suggestedAssigneeId
         - suggestedDepartmentId: brief_item.suggestedDepartmentId
         - suggestedProjectId: brief_item.suggestedProjectId
         - suggestedLayer: brief_item.suggestedLayer
         - layer: brief_item.layer
         - dedupAction: brief_item.dedupAction
         - selectedMemoryId: brief_item.selectedMemoryId
         - mergedContent: brief_item.mergedContent
         - status: brief_item.status
         - resultTaskId: brief_item.resultTaskId
         - resultMemoryId: brief_item.resultMemoryId
         - createdAt: brief_item.createdAt
         - updatedAt: brief_item.updatedAt

  4. Update discussions denormalized counts:
     - entryCount: 1
     - pendingItemCount: count of items with status='pending'
     - lastEntryAt: entry.createdAt
```

### Phase 3: Create Default Internal Agent Config

For each existing company, create a default `internal_agent_config` row with default values. This ensures the settings page works immediately.

### Phase 4: Deprecate Old Tables

Do NOT drop old tables immediately. Mark as deprecated:
- `debriefs` — no new writes, reads redirect to discussions
- `briefs` — no new writes, reads redirect to discussions
- `brief_items` — no new writes, reads redirect to discussion_extracted_items

Old tables can be dropped in a future release after confirming migration integrity.

---

## Rollback Plan

If v2.5 needs to be rolled back:

1. **Schema rollback:** Drizzle generates down migrations. Drop new tables in reverse order of creation (workflow_templates first, discussions last).

2. **Data rollback:** Old `debriefs`, `briefs`, `brief_items` tables are NOT dropped during v2.5. They still contain the original data. Re-enable old routes and UI.

3. **Code rollback:** Git revert of v2.5 code changes. Old DebriefModal, Briefs page, BriefReview page are restored.

4. **Config rollback:** `internal_agent_config` rows deleted. No impact on existing functionality.

The key safeguard: **old tables are preserved, not dropped.** This allows rolling back to pre-v2.5 behavior at any time during the transition period.

---

## Indexes Summary

| Table | Index | Columns | Purpose |
|-------|-------|---------|---------|
| discussions | company | companyId | List by company |
| discussions | company_status | companyId, status | Filter active discussions |
| discussions | scope | scopeType, scopeId | Project/dept page tab |
| discussions | last_entry | companyId, lastEntryAt | Sort by recent activity |
| discussion_entries | discussion | discussionId | List entries in thread |
| discussion_entries | extraction_status | extractionStatus | Find unprocessed entries |
| discussion_entries | created_at | discussionId, createdAt | Chronological order |
| discussion_extracted_items | entry | discussionEntryId | Items per entry |
| discussion_extracted_items | status | discussionEntryId, status | Pending items filter |
| discussion_annotations | entry | discussionEntryId | Annotations per entry |
| internal_agent_config | company | companyId (unique) | One config per company |
| internal_agent_conversations | company_user | companyId, userId | Find user's conversation |
| internal_agent_conversations | active | companyId, userId, status | Find active conversation |
| internal_agent_messages | conversation | conversationId | Messages in conversation |
| internal_agent_messages | conversation_time | conversationId, createdAt | Chronological order |
| internal_agent_messages | run | runId | Messages per run |
| internal_agent_runs | company | companyId | Runs by company |
| internal_agent_runs | company_status | companyId, status | Active runs |
| internal_agent_runs | trigger | companyId, triggerType, triggerSource | Filter by trigger |
| internal_agent_runs | created_at | companyId, createdAt | Chronological order |
| internal_agent_runs | related_entity | relatedEntityType, relatedEntityId | Runs for an entity |
| internal_agent_reminders | company_user | companyId, userId | User's reminders |
| internal_agent_reminders | pending | status, triggerAt | Due reminders scan |
| workflow_templates | company | companyId | Templates by company |

---

## Relations (Drizzle)

```typescript
// packages/db/src/schema/discussions.ts — relations

export const discussionsRelations = relations(discussions, ({ one, many }) => ({
  company: one(companies, { fields: [discussions.companyId], references: [companies.id] }),
  entries: many(discussionEntries),
}));

export const discussionEntriesRelations = relations(discussionEntries, ({ one, many }) => ({
  discussion: one(discussions, { fields: [discussionEntries.discussionId], references: [discussions.id] }),
  extractedItems: many(discussionExtractedItems),
  annotations: many(discussionAnnotations),
  department: one(projects, { fields: [discussionEntries.departmentId], references: [projects.id] }),
  project: one(projects, { fields: [discussionEntries.projectId], references: [projects.id] }),
  goal: one(goals, { fields: [discussionEntries.goalId], references: [goals.id] }),
}));

export const discussionExtractedItemsRelations = relations(discussionExtractedItems, ({ one }) => ({
  entry: one(discussionEntries, {
    fields: [discussionExtractedItems.discussionEntryId],
    references: [discussionEntries.id],
  }),
  resultTask: one(issues, {
    fields: [discussionExtractedItems.resultTaskId],
    references: [issues.id],
  }),
  resultMemory: one(memoryItems, {
    fields: [discussionExtractedItems.resultMemoryId],
    references: [memoryItems.id],
  }),
}));

export const discussionAnnotationsRelations = relations(discussionAnnotations, ({ one }) => ({
  entry: one(discussionEntries, {
    fields: [discussionAnnotations.discussionEntryId],
    references: [discussionEntries.id],
  }),
}));
```

---

## Estimated Table Sizes (for index tuning)

| Table | Expected rows (1 year, active solo founder) |
|-------|----------------------------------------------|
| discussions | 200-500 |
| discussion_entries | 500-2000 |
| discussion_extracted_items | 2000-8000 |
| discussion_annotations | 100-500 |
| internal_agent_config | 1 per company |
| internal_agent_conversations | 1-10 per user |
| internal_agent_messages | 5000-20000 |
| internal_agent_runs | 3000-15000 |
| internal_agent_reminders | 50-200 |
| workflow_templates | 10-50 |

At these scales, B-tree indexes are sufficient. No need for partitioning or advanced index types in v2.5.
