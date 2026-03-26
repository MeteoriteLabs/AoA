---
Feature: v2_5_discussions_and_agent
Doc type: sessions_plan
Status: draft
Created: 2026-03-25
Updated by: agent
Methodology: superpowers (brainstorm → spec → plan → implement with TDD → verify)
Depends on: All v2.5 spec documents (reviewed and approved 2026-03-25)
---

# V2.5 Discussions & Internal Agent — Session Plan

21 sessions across 7 phases. Each session is self-contained: goal, context references, exact steps with file paths, tests, verification, and commit message. Sessions follow **superpowers methodology** — TDD (red-green-refactor), verify before claiming done.

**Prerequisite:** All 15 spec documents in `plans/v2_5_discussions_and_agent/` are reviewed and approved.

**Conventions used in every session:**
- Schema pattern: `pgTable("name", { columns }, (table) => ({ indexes }))`
- Service factory: `export function serviceName(db: Db) { return { list, getById, create, ... } }`
- Route factory: `export function nameRoutes(db: Db) { const router = Router(); ... return router; }`
- Auth: `assertCompanyAccess(req, companyId)` + `assertRole(db, req, companyId, "founder")`
- Activity logging: `logActivity(db, { companyId, actorType, actorId, action, entityType, entityId, details })`
- Costs in cents (integer), never USD floats
- API keys via `company_secrets` table + `secretService(db).resolveSecretValue()`
- Tests mock `drizzle-orm` and `@paperclipai/db` before importing services (ESM workaround)

---

## Phase A — Foundation (Sessions 1–3)

---

### Session 1: Discussion Schema Tables

**Goal:** Create the 4 discussion-related database tables with all indexes and relations.

**Spec references:**
- `v2_5_discussions_and_agent_schema.md` — Tables 1–4 (discussions, discussion_entries, discussion_extracted_items, discussion_annotations)
- `v2_5_discussions_and_agent_gotchas.md` — Gotcha 1.1 (polymorphic scope validation), 1.2 (denormalized count drift), 1.3 (entry ordering)

**Steps:**

1. **Create `packages/db/src/schema/discussions.ts`**
   - Import: `pgTable, uuid, text, timestamp, integer, jsonb, index` from `drizzle-orm/pg-core`
   - Import: `companies` from `./companies.js`, `projects` from `./projects.js`, `goals` from `./goals.js`, `issues` from `./issues.js`, `memoryItems` from `./memory_items.js`
   - Define table `discussions`:
     - `id: uuid('id').primaryKey().defaultRandom()`
     - `companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' })`
     - `title: text('title')` — nullable, auto-generated if not provided
     - `status: text('status').notNull().default('active')` — 'active' | 'archived'
     - `scopeType: text('scope_type')` — 'department' | 'project' | 'goal' | null
     - `scopeId: uuid('scope_id')` — polymorphic, resolved at app level
     - `tags: jsonb('tags').default([])`
     - `entryCount: integer('entry_count').notNull().default(0)` — denormalized
     - `pendingItemCount: integer('pending_item_count').notNull().default(0)` — denormalized
     - `lastEntryAt: timestamp('last_entry_at', { withTimezone: true })`
     - `createdBy: text('created_by').notNull()`
     - `createdAt`, `updatedAt` timestamps
     - Indexes: `companyIdx`, `companyStatusIdx`, `scopeIdx`, `lastEntryIdx`
   - Define table `discussionEntries`:
     - `id`, `discussionId` (FK → discussions, cascade), `inputType`, `rawContent`, `title`
     - `sourceInfo: jsonb('source_info')` — { transcriptionModel, mcpSource, mcpClientId, ... }
     - `departmentId`, `projectId`, `goalId` — optional scope overrides (FKs to projects/goals, onDelete set null)
     - `extractionStatus: text('extraction_status').notNull().default('pending')` — pending | processing | completed | failed | skipped
     - `extractionRunId: uuid('extraction_run_id')` — FK will reference internal_agent_runs (add `.references()` in Session 2 after that table exists; for now leave as plain uuid)
     - `createdBy`, `createdAt`
     - Indexes: `discussionIdx`, `extractionStatusIdx`, `createdAtIdx`
   - Define table `discussionExtractedItems`:
     - All columns per schema doc table 3 — type, title, description, suggestedPriority, suggestedAssigneeId, suggestedDepartmentId (FK → projects), suggestedProjectId (FK → projects), suggestedLayer, suggestedGoalId (FK → goals), layer, priority, dedupAction, selectedMemoryId (FK → memoryItems), mergedContent, status, resultTaskId (FK → issues), resultMemoryId (FK → memoryItems), conflictsWith (jsonb)
     - Indexes: `entryIdx`, `statusIdx`
   - Define table `discussionAnnotations`:
     - id, discussionEntryId (FK → discussionEntries, cascade), content, anchorStart (integer), anchorEnd (integer), createdBy, createdAt, updatedAt
     - Indexes: `entryIdx`
   - Define all Drizzle relations: `discussionsRelations`, `discussionEntriesRelations`, `discussionExtractedItemsRelations`, `discussionAnnotationsRelations` (per schema doc Relations section)

2. **Export from `packages/db/src/schema/index.ts`**
   - Add: `export { discussions, discussionEntries, discussionExtractedItems, discussionAnnotations } from "./discussions.js";`

3. **Run `pnpm db:generate`**
   - Verify migration file is created in `packages/db/drizzle/`
   - Review generated SQL to confirm all tables, FKs, and indexes match spec

**Tests (RED → GREEN):**

Create `server/src/__tests__/discussions-schema-contract.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { discussions, discussionEntries, discussionExtractedItems, discussionAnnotations } from "@paperclipai/db";

describe("Discussion schema contract", () => {
  it("discussions table has required columns", () => {
    expect(discussions.id).toBeDefined();
    expect(discussions.companyId).toBeDefined();
    expect(discussions.status).toBeDefined();
    expect(discussions.scopeType).toBeDefined();
    expect(discussions.scopeId).toBeDefined();
    expect(discussions.entryCount).toBeDefined();
    expect(discussions.pendingItemCount).toBeDefined();
    expect(discussions.tags).toBeDefined();
  });

  it("discussionEntries table has extraction tracking", () => {
    expect(discussionEntries.extractionStatus).toBeDefined();
    expect(discussionEntries.extractionRunId).toBeDefined();
    expect(discussionEntries.inputType).toBeDefined();
    expect(discussionEntries.rawContent).toBeDefined();
  });

  it("discussionExtractedItems has conflict detection", () => {
    expect(discussionExtractedItems.conflictsWith).toBeDefined();
    expect(discussionExtractedItems.suggestedGoalId).toBeDefined();
    expect(discussionExtractedItems.dedupAction).toBeDefined();
    expect(discussionExtractedItems.status).toBeDefined();
  });

  it("discussionAnnotations supports inline positioning", () => {
    expect(discussionAnnotations.anchorStart).toBeDefined();
    expect(discussionAnnotations.anchorEnd).toBeDefined();
  });
});
```

**Verify:**
```bash
pnpm db:generate
pnpm test -- --run discussions-schema-contract
```

**Commit:** `feat(db): add discussion tables — discussions, entries, extracted items, annotations`

---

### Session 2: Internal Agent Schema Tables

**Goal:** Create the 7 remaining v2.5 tables (internal agent config, conversations, messages, runs, reminders, workflow templates, notifications).

**Spec references:**
- `v2_5_discussions_and_agent_schema.md` — Tables 5–11
- `v2_5_discussions_and_agent_decisions.md` — DA-27 (run tracking), DA-25 (budget cents)

**Steps:**

1. **Create `packages/db/src/schema/internal_agent.ts`**
   - Define 5 tables: `internalAgentConfig`, `internalAgentConversations`, `internalAgentMessages`, `internalAgentRuns`, `internalAgentReminders`
   - All columns exactly per schema doc tables 5–9
   - Key fields:
     - `internalAgentConfig.budgetMonthlyCents: integer('budget_monthly_cents')` — nullable = unlimited
     - `internalAgentConfig.spentMonthlyCents: integer('spent_monthly_cents').notNull().default(0)`
     - `internalAgentRuns.costCents: integer('cost_cents')`
     - `internalAgentConfig.companyId` — unique constraint
   - All indexes per schema doc

2. **Create `packages/db/src/schema/workflow_templates.ts`**
   - Define `workflowTemplates` table per schema doc table 10
   - `steps: jsonb('steps').notNull()` — ordered array of step objects
   - `dependencies: jsonb('dependencies').notNull().default([])` — fromStep/toStep pairs

3. **Create `packages/db/src/schema/notifications.ts`**
   - Define `notifications` table per schema doc table 11
   - Indexes: `companyUserIdx`, `unreadIdx` (companyId + userId + readAt), `createdAtIdx`

4. **Update `packages/db/src/schema/discussions.ts`**
   - Now that `internalAgentRuns` exists, add the FK reference to `discussionEntries.extractionRunId`:
     ```typescript
     extractionRunId: uuid('extraction_run_id')
       .references(() => internalAgentRuns.id, { onDelete: 'set null' }),
     ```

5. **Export all from `packages/db/src/schema/index.ts`**
   - Add exports for all new tables from `internal_agent.ts`, `workflow_templates.ts`, `notifications.ts`

6. **Run `pnpm db:generate`**

**Tests (RED → GREEN):**

Create `server/src/__tests__/internal-agent-schema-contract.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  internalAgentConfig, internalAgentConversations, internalAgentMessages,
  internalAgentRuns, internalAgentReminders, workflowTemplates, notifications
} from "@paperclipai/db";

describe("Internal agent schema contract", () => {
  it("internalAgentConfig uses cents for budget", () => {
    expect(internalAgentConfig.budgetMonthlyCents).toBeDefined();
    expect(internalAgentConfig.spentMonthlyCents).toBeDefined();
    // Verify no USD fields exist
    expect((internalAgentConfig as any).budgetLimitUsd).toBeUndefined();
  });

  it("internalAgentRuns tracks cost and tools", () => {
    expect(internalAgentRuns.costCents).toBeDefined();
    expect(internalAgentRuns.toolsCalled).toBeDefined();
    expect(internalAgentRuns.tokenUsage).toBeDefined();
    expect(internalAgentRuns.triggerType).toBeDefined();
    expect(internalAgentRuns.triggerSource).toBeDefined();
  });

  it("notifications has read/dismiss tracking", () => {
    expect(notifications.readAt).toBeDefined();
    expect(notifications.dismissedAt).toBeDefined();
    expect(notifications.relatedEntityType).toBeDefined();
  });

  it("workflowTemplates has steps and dependencies as JSON", () => {
    expect(workflowTemplates.steps).toBeDefined();
    expect(workflowTemplates.dependencies).toBeDefined();
    expect(workflowTemplates.instantiationCount).toBeDefined();
  });

  it("internalAgentConversations supports summarization", () => {
    expect(internalAgentConversations.summarizedContext).toBeDefined();
    expect(internalAgentConversations.summarizedUpToMessageId).toBeDefined();
  });
});
```

**Verify:**
```bash
pnpm db:generate
pnpm test -- --run internal-agent-schema-contract
```

**Commit:** `feat(db): add internal agent, workflow, and notification tables`

---

### Session 3: Shared Types + Data Migration

**Goal:** Create all shared constants/types/validators AND the debrief → discussion data migration script.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T4 (shared types), T3 (data migration)
- `v2_5_discussions_and_agent_schema.md` — Migration Strategy (Phase 2)
- `v2_5_discussions_and_agent_rollout.md` — Phase 1 migration mapping

**Steps:**

**Part A — Shared Types (T4):**

1. **Create `packages/shared/src/discussions.ts`**
   - Constants:
     ```typescript
     export const DISCUSSION_STATUSES = ["active", "archived"] as const;
     export const DISCUSSION_ENTRY_INPUT_TYPES = ["paste", "write", "voice", "mcp"] as const;
     export const EXTRACTION_ITEM_TYPES = ["decision", "task", "insight", "context", "reference", "preference"] as const;
     export const EXTRACTION_ITEM_STATUSES = ["pending", "approved", "rejected", "edited"] as const;
     ```
   - TypeScript types derived from constants:
     ```typescript
     export type DiscussionStatus = typeof DISCUSSION_STATUSES[number];
     export type DiscussionEntryInputType = typeof DISCUSSION_ENTRY_INPUT_TYPES[number];
     export type ExtractedItemType = typeof EXTRACTION_ITEM_TYPES[number];
     export type ExtractedItemStatus = typeof EXTRACTION_ITEM_STATUSES[number];
     ```
   - Zod validators:
     ```typescript
     export const createDiscussionSchema = z.object({
       title: z.string().max(500).optional(),
       scopeType: z.enum(["department", "project", "goal"]).optional(),
       scopeId: z.string().uuid().optional(),
       tags: z.array(z.string().max(50)).max(20).optional(),
       entry: z.object({
         inputType: z.enum(DISCUSSION_ENTRY_INPUT_TYPES),
         rawContent: z.string().min(1).max(100000),
         title: z.string().max(500).optional(),
       }).optional(),
     });
     export const createDiscussionEntrySchema = z.object({ ... });
     export const updateDiscussionSchema = z.object({ ... });
     export const approveItemsSchema = z.object({ ... });
     export const createAnnotationSchema = z.object({ ... });
     ```

2. **Create `packages/shared/src/internal-agent.ts`**
   - Constants:
     ```typescript
     export const AGENT_CAPABILITIES = [
       "discussion_processing", "proactive_suggestions", "organizational_queries",
       "system_actions", "context_briefing", "memory_management",
       "conflict_detection", "budget_awareness", "workflow_coaching",
       "workflow_discovery", "cross_department_coordination", "department_personas",
     ] as const;
     export const TRIGGER_TYPES = ["conversation", "proactive", "event", "sub_agent"] as const;
     export const TRIGGER_SOURCES = [
       "user_message", "discussion_entry", "mcp_inbound", "scheduled_check",
       "morning_digest", "reminder", "task_completed", "task_status_change",
       "agent_error", "agent_budget_alert", "ttl_expiry",
     ] as const;
     export const NOTIFICATION_TYPES = [
       "discussion.extraction_complete", "discussion.extraction_failed",
       "internal_agent.reminder", "internal_agent.proactive",
       "internal_agent.action_result",
     ] as const;
     ```
   - Zod validators:
     ```typescript
     export const updateInternalAgentConfigSchema = z.object({ ... });
     export const chatMessageSchema = z.object({
       message: z.string().min(1).max(10000),
       pageContext: z.string().max(500).optional(),
     });
     ```

3. **Create `packages/shared/src/workflow-templates.ts`**
   - Zod schemas: `createWorkflowTemplateSchema`, `updateWorkflowTemplateSchema`

4. **Add LiveEventType additions in `packages/shared/src/live-events.ts`** (or wherever `LIVE_EVENT_TYPES` is defined):
   - Add: `'discussion.entry.created'`, `'discussion.extraction.completed'`, `'discussion.extraction.failed'`, `'internal_agent.greeting'`, `'internal_agent.reminder'`, `'internal_agent.notification'`

5. **Export all from `packages/shared/src/index.ts`**
   - Add re-exports for new modules

**Part B — Data Migration (T3):**

6. **Create `server/src/migrations/v2_5-migrate-debriefs-to-discussions.ts`**
   - Import `db` type, `debriefs`, `briefs`, `briefItems`, `discussions`, `discussionEntries`, `discussionExtractedItems`
   - Function: `export async function migrateDebriefsTodDiscussions(db: Db)`
   - Logic per schema doc Phase 2 migration mapping:
     - For each debrief → create discussion + discussion_entry
     - Map debrief.status → extractionStatus: 'ready' → 'completed', 'processing' → 'completed', 'processing_failed' → 'failed'
     - For each brief_item → create discussion_extracted_item preserving all fields
     - Update denormalized counts on discussions (entryCount, pendingItemCount, lastEntryAt)
   - Verification function: `export async function verifyMigration(db: Db)` — count assertions

**Tests (RED → GREEN):**

Create `server/src/__tests__/shared-types-contract.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  DISCUSSION_STATUSES, EXTRACTION_ITEM_TYPES, AGENT_CAPABILITIES,
  TRIGGER_TYPES, NOTIFICATION_TYPES, createDiscussionSchema, chatMessageSchema,
} from "@paperclipai/shared";

describe("v2.5 shared types contract", () => {
  it("discussion statuses include active and archived", () => {
    expect(DISCUSSION_STATUSES).toContain("active");
    expect(DISCUSSION_STATUSES).toContain("archived");
  });
  it("extraction item types include all 6 types", () => {
    expect(EXTRACTION_ITEM_TYPES).toHaveLength(6);
    expect(EXTRACTION_ITEM_TYPES).toContain("decision");
    expect(EXTRACTION_ITEM_TYPES).toContain("preference");
  });
  it("agent capabilities include all 12", () => {
    expect(AGENT_CAPABILITIES).toHaveLength(12);
  });
  it("createDiscussionSchema validates entry input types", () => {
    const result = createDiscussionSchema.safeParse({
      entry: { inputType: "paste", rawContent: "test" },
    });
    expect(result.success).toBe(true);
  });
  it("createDiscussionSchema rejects invalid input type", () => {
    const result = createDiscussionSchema.safeParse({
      entry: { inputType: "invalid", rawContent: "test" },
    });
    expect(result.success).toBe(false);
  });
  it("chatMessageSchema enforces 10k char limit", () => {
    const result = chatMessageSchema.safeParse({ message: "x".repeat(10001) });
    expect(result.success).toBe(false);
  });
});
```

Create `server/src/__tests__/migration-debrief-to-discussion.test.ts` — pure function tests for migration logic (mock db).

**Verify:**
```bash
pnpm build  # shared package compiles
pnpm test -- --run shared-types-contract
pnpm test -- --run migration-debrief-to-discussion
```

**Commit:** `feat(shared): add v2.5 discussion, agent, workflow types and validators; add debrief migration script`

---

## Phase B — Discussion Backend (Sessions 4–6)

---

### Session 4: Discussion Service

**Goal:** Build the discussion service with full CRUD, entry processing trigger, and item approval.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T6
- `v2_5_discussions_and_agent_api_contract.md` — Sections 1.1–1.10
- `v2_5_discussions_and_agent_architecture.md` — Service Pattern section
- `v2_5_discussions_and_agent_gotchas.md` — 1.1 (scope validation), 1.2 (count drift), 1.4 (extraction status on edit)

**Steps:**

1. **Create `server/src/services/discussions.ts`**
   ```typescript
   import { and, eq, desc, sql } from "drizzle-orm";
   import type { Db } from "@paperclipai/db";
   import { discussions, discussionEntries, discussionExtractedItems, discussionAnnotations } from "@paperclipai/db";
   import { publishLiveEvent } from "./live-events.js";
   import { logActivity } from "./activity-log.js";

   export interface DiscussionFilters {
     status?: string;
     scopeType?: string;
     scopeId?: string;
     hasPendingItems?: boolean;
     inputType?: string;
   }

   export function discussionService(db: Db) {
     return {
       list: async (companyId: string, filters: DiscussionFilters = {}) => { ... },
       getById: async (companyId: string, id: string) => { ... },
       create: async (companyId: string, data: CreateDiscussionInput, actorId: string) => { ... },
       addEntry: async (companyId: string, discussionId: string, data: CreateEntryInput, actorId: string) => { ... },
       update: async (companyId: string, id: string, data: UpdateDiscussionInput) => { ... },
       approveItems: async (companyId: string, discussionId: string, itemIds: string[], actorId: string) => { ... },
       rejectItems: async (companyId: string, discussionId: string, itemIds: string[], actorId: string) => { ... },
       updateItem: async (companyId: string, itemId: string, data: UpdateItemInput) => { ... },
       reprocessEntry: async (companyId: string, entryId: string) => { ... },
       addAnnotation: async (companyId: string, entryId: string, data: CreateAnnotationInput, actorId: string) => { ... },
       linkEntry: async (companyId: string, entryId: string, targetDiscussionId: string) => { ... },
     };
   }
   ```
   - `create()`: Creates discussion row + optional first entry. Fires `discussion.entry.created` LiveEvent if entry included. Increments denormalized counts.
   - `addEntry()`: Creates entry, triggers extraction (fire-and-forget like current debrief pattern), increments entryCount, updates lastEntryAt. Publishes `discussion.entry.created` LiveEvent.
   - `approveItems()`: Atomic transaction — for each item: if type is 'task' → create issue; if type is memory-related → create memoryItem. Set status='approved', link resultTaskId/resultMemoryId. Decrement pendingItemCount. Log activity per item.
   - `reprocessEntry()`: Set extractionStatus back to 'pending', delete existing extracted items for that entry. Trigger re-extraction.
   - Scope validation: If scopeType is set, verify scopeId references the correct table (department/project/goal). Use `badRequest()` from `server/src/errors.js`.

2. **Export from `server/src/services/index.ts`**
   - Add: `export { discussionService, type DiscussionFilters } from "./discussions.js";`

**Tests (RED → GREEN):**

Create `server/src/__tests__/discussions-service.test.ts`:
- Mock `drizzle-orm` and `@paperclipai/db` per ESM pattern
- Test `list()` with filters returns correct query conditions
- Test `create()` with entry triggers LiveEvent
- Test `approveItems()` creates tasks and memory items in transaction
- Test denormalized count updates (increment on addEntry, decrement on approveItems)
- Test scope validation rejects invalid scopeType/scopeId combos

**Verify:**
```bash
pnpm test -- --run discussions-service
```

**Commit:** `feat(server): add discussion service with CRUD, approval, and extraction trigger`

---

### Session 5: Discussion Routes + Notification Service

**Goal:** Create discussion HTTP routes and the notification service + routes.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T7, T13c
- `v2_5_discussions_and_agent_api_contract.md` — Section 1
- `v2_5_discussions_and_agent_permissions.md` — Discussion access matrix

**Steps:**

1. **Create `server/src/routes/discussions.ts`**
   ```typescript
   import { Router } from "express";
   import type { Db } from "@paperclipai/db";
   import { createDiscussionSchema, createDiscussionEntrySchema, updateDiscussionSchema, approveItemsSchema, createAnnotationSchema } from "@paperclipai/shared";
   import { validate } from "../middleware/validate.js";
   import { discussionService, logActivity } from "../services/index.js";
   import { assertCompanyAccess, getActorInfo } from "./authz.js";
   import { assertRole } from "../middleware/rbac.js";

   export function discussionRoutes(db: Db) {
     const router = Router();
     const svc = discussionService(db);
     // 10 endpoints per API contract section 1
     // ... (each endpoint follows goal routes pattern)
     return router;
   }
   ```
   - 10 endpoints per API contract:
     - `GET /companies/:companyId/discussions` — list with query filters
     - `GET /companies/:companyId/discussions/:discussionId` — get with entries + items
     - `POST /companies/:companyId/discussions` — create (validate with createDiscussionSchema)
     - `POST /companies/:companyId/discussions/:discussionId/entries` — add entry
     - `PATCH /companies/:companyId/discussions/:discussionId` — update title/scope/tags
     - `POST /companies/:companyId/discussions/:discussionId/entries/:entryId/reprocess` — founder only
     - `PATCH /companies/:companyId/discussions/:discussionId/entries/:entryId/items/:itemId` — update item
     - `POST /companies/:companyId/discussions/:discussionId/approve` — approve items (founder only)
     - `POST /companies/:companyId/discussions/:discussionId/entries/:entryId/annotations` — add annotation
     - `POST /companies/:companyId/discussions/link` — link entry to different thread
   - Every mutation logs activity via `logActivity()`
   - RBAC: approve/reject/reprocess = founder only. List/get/addEntry = any company member.

2. **Create `server/src/services/notifications.ts`**
   ```typescript
   export function notificationService(db: Db) {
     return {
       create: async (companyId: string, data: CreateNotificationInput) => { ... },
       list: async (companyId: string, userId: string, filters?: { unreadOnly?: boolean }) => { ... },
       markRead: async (id: string) => { ... },
       dismiss: async (id: string) => { ... },
       getUnreadCount: async (companyId: string, userId: string) => { ... },
     };
   }
   ```

3. **Create `server/src/routes/notifications.ts`**
   - 4 endpoints:
     - `GET /companies/:companyId/notifications` — list for current user (from req.actor)
     - `PATCH /companies/:companyId/notifications/:id/read` — mark read
     - `PATCH /companies/:companyId/notifications/:id/dismiss` — dismiss
     - `GET /companies/:companyId/notifications/unread-count` — badge count

4. **Register routes in `server/src/app.ts`**
   - Add imports: `import { discussionRoutes } from "./routes/discussions.js";`
   - Add imports: `import { notificationRoutes } from "./routes/notifications.js";`
   - Add: `api.use(discussionRoutes(db));` and `api.use(notificationRoutes(db));`

5. **Export from services barrel**
   - `export { notificationService } from "./notifications.js";`

**Tests (RED → GREEN):**

Create `server/src/__tests__/discussions-routes-contract.test.ts`:
- Verify route factory returns a Router
- Verify all 10 endpoint paths are registered (introspect router stack)

Create `server/src/__tests__/notifications-service.test.ts`:
- Test create, list, markRead, dismiss, getUnreadCount
- Test unreadOnly filter excludes read notifications

**Verify:**
```bash
pnpm test -- --run discussions-routes-contract
pnpm test -- --run notifications-service
pnpm build
```

**Commit:** `feat(server): add discussion routes, notification service and routes`

---

### Session 6: Debrief Deprecation + Redirect Layer

**Goal:** Add redirect middleware from old debrief/brief routes to new discussion routes. Update MCP inbound.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T8
- `v2_5_discussions_and_agent_integration.md` — API Redirect Layer section
- `v2_5_discussions_and_agent_rollout.md` — Phase 4 deprecation

**Steps:**

1. **Modify `server/src/routes/debriefs.ts`**
   - Add deprecation header to all existing debrief endpoints: `res.set('X-Deprecated', 'Use /discussions instead')`
   - Add redirect routes at the bottom:
     ```typescript
     // POST /companies/:companyId/debriefs → redirect to discussion creation
     router.post("/companies/:companyId/debriefs/redirect", async (req, res) => {
       res.redirect(307, `/api/companies/${req.params.companyId}/discussions`);
     });
     ```
   - Update MCP inbound route (`/companies/:companyId/debriefs/mcp`):
     - Instead of creating a debrief, create a discussion + entry via `discussionService(db).create()`
     - Keep the old endpoint path for backward compatibility
     - Log activity as `discussion.created` (not `debrief.created`)

2. **Modify `server/src/routes/briefs.ts`**
   - Add deprecation header
   - Add redirect: `GET /companies/:companyId/briefs` → `302` to `/companies/:companyId/discussions?hasPendingItems=true`

**Tests (RED → GREEN):**

Create `server/src/__tests__/debrief-redirect.test.ts`:
- Test deprecated headers are set
- Test MCP inbound creates a discussion (not a debrief)

**Verify:**
```bash
pnpm test -- --run debrief-redirect
pnpm build
```

**Commit:** `feat(server): deprecate debrief/brief routes with discussion redirects; update MCP inbound`

---

## Phase C — Internal Agent Core (Sessions 7–10)

---

### Session 7: Tool Registry + ServiceContainer

**Goal:** Create the tool registry with all 30 tools as thin service wrappers, plus the ServiceContainer.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T5
- `v2_5_discussions_and_agent_architecture.md` — Component Architecture, Tool Registry section
- `v2_5_discussions_and_agent_integration.md` — ServiceContainer pattern, Tool-to-Service mapping table

**Steps:**

1. **Create `server/src/services/internal-agent/types.ts`**
   - Define interfaces:
     ```typescript
     export interface AgentTool {
       name: string;
       description: string;
       parameters: Record<string, unknown>; // JSON Schema
       category: 'discussion' | 'query' | 'action' | 'memory' | 'workflow' | 'file' | 'coordination' | 'analysis';
       requiresConfirmation: boolean; // Level 0: all actions need confirmation
       execute: (params: unknown, context: ToolExecutionContext) => Promise<ToolResult>;
     }
     export interface ToolExecutionContext {
       companyId: string;
       userId: string;
       userRole: string;
       services: ServiceContainer;
       db: Db;
     }
     export interface ToolResult {
       success: boolean;
       data?: unknown;
       error?: string;
     }
     export interface ServiceContainer {
       issues: ReturnType<typeof issueService>;
       goals: ReturnType<typeof goalService>;
       memory: ReturnType<typeof memoryService>;
       discussions: ReturnType<typeof discussionService>;
       agents: ReturnType<typeof agentService>;
       projects: ReturnType<typeof projectService>;
       costs: ReturnType<typeof costService>;
       activity: ReturnType<typeof activityService>;
       dependencies: ReturnType<typeof dependencyService>;
       suggestions: ReturnType<typeof suggestionService>;
       notifications: ReturnType<typeof notificationService>;
       secrets: ReturnType<typeof secretService>;
     }
     ```

2. **Create tool files** in `server/src/services/internal-agent/tools/`:
   - `query-tools.ts` — 6 tools: query_tasks, query_goals, query_agents, query_departments, query_budget, query_activity
   - `action-tools.ts` — 8 tools: create_task, update_task, create_department, create_goal, create_agent, update_agent, assign_task, wakeup_agent
   - `memory-tools.ts` — 5 tools: query_memory, create_memory, update_memory, find_similar_memory, detect_conflicts
   - `discussion-tools.ts` — 3 tools: extract_from_content, search_discussions, link_discussion_to_project
   - `workflow-tools.ts` — 3 tools: create_workflow_template, instantiate_workflow, add_task_dependency
   - `file-tools.ts` — 2 tools: read_file, write_file
   - `analysis-tools.ts` — 2 tools: analyze_workload, suggest_improvements
   - Each tool: define name, description, JSON Schema for params, category, requiresConfirmation, and execute function that calls the corresponding service method

3. **Create `server/src/services/internal-agent/tool-registry.ts`**
   ```typescript
   export function createToolRegistry(context: ToolExecutionContext): AgentTool[] { ... }
   export function getToolsForMessage(message: string, allTools: AgentTool[]): AgentTool[] { ... }
   export function toolToAnthropicFormat(tool: AgentTool): AnthropicToolDef { ... }
   export function toolToOpenAIFormat(tool: AgentTool): OpenAIFunctionDef { ... }
   ```

**Tests (RED → GREEN):**

Create `server/src/__tests__/tool-registry.test.ts`:
- Test all 30 tools are registered
- Test each tool has required fields (name, description, parameters, execute)
- Test `getToolsForMessage()` returns relevant subset (e.g., "how many tasks" → query_tasks)
- Test tool format conversion for Anthropic and OpenAI

Create `server/src/__tests__/query-tools.test.ts`:
- Test query_tasks calls `services.issues.list()` and returns ToolResult
- Test query_goals calls `services.goals.list()`

**Verify:**
```bash
pnpm test -- --run tool-registry
pnpm test -- --run query-tools
```

**Commit:** `feat(server): add internal agent tool registry with 30 tools and ServiceContainer`

---

### Session 8: LLM Provider Abstraction

**Goal:** Create the provider abstraction layer for Anthropic, OpenAI, and Google.

**Spec references:**
- `v2_5_discussions_and_agent_architecture.md` — Provider Abstraction section
- `v2_5_discussions_and_agent_integration.md` — LLM Provider Integration, company_secrets flow
- `v2_5_discussions_and_agent_gotchas.md` — 2.2 (OpenAI JSON accumulation), 2.4 (token budget vs provider limits)

**Steps:**

1. **Create `server/src/services/internal-agent/providers/types.ts`**
   ```typescript
   export interface LLMProvider {
     chat(params: ChatParams): AsyncIterable<ChatStreamChunk>;
     name: string;
   }
   export interface ChatParams {
     messages: ChatMessage[];
     tools: ProviderToolDef[];
     model: string;
     maxTokens: number;
     systemPrompt: string;
   }
   export type ChatStreamChunk =
     | { type: 'text'; delta: string }
     | { type: 'tool_call'; id: string; name: string; input: unknown }
     | { type: 'done'; usage: { inputTokens: number; outputTokens: number } };
   ```

2. **Create `server/src/services/internal-agent/providers/anthropic.ts`**
   - Uses `@anthropic-ai/sdk` (already in package.json ^0.79.0)
   - API key from: `secretService(db).resolveSecretValue(companyId, 'anthropic_api_key')` with fallback to `process.env.ANTHROPIC_API_KEY`
   - Streaming via `client.messages.stream()` → yields `ChatStreamChunk`
   - Tool format: convert `AgentTool` → Anthropic `tool` shape (name, description, input_schema)

3. **Create `server/src/services/internal-agent/providers/openai.ts`**
   - Uses `openai` npm (^6.29.0)
   - API key from company_secrets with fallback to env
   - **Gotcha 2.2:** OpenAI streams tool call arguments as JSON fragments. Must accumulate fragments before parsing.
   - Tool format: convert to OpenAI `function` shape

4. **Create `server/src/services/internal-agent/providers/gemini.ts`**
   - Uses `@google/generative-ai` (^0.24.1)
   - API key from company_secrets with fallback to env
   - Tool format: convert to Gemini `functionDeclarations`

5. **Create `server/src/services/internal-agent/providers/index.ts`**
   ```typescript
   export function createProvider(provider: string, apiKey: string): LLMProvider { ... }
   export async function getProviderApiKey(db: Db, companyId: string, provider: string): Promise<string> {
     const secretName = `${provider}_api_key`; // e.g., 'anthropic_api_key'
     const svc = secretService(db);
     const secret = await svc.getByName(companyId, secretName);
     if (secret) return svc.resolveSecretValue(secret);
     // Fallback to env
     const envKey = `${provider.toUpperCase()}_API_KEY`;
     return process.env[envKey] ?? '';
   }
   ```

**Tests (RED → GREEN):**

Create `server/src/__tests__/llm-providers.test.ts`:
- Test Anthropic provider converts tools to correct format
- Test OpenAI provider accumulates JSON fragments correctly (Gotcha 2.2)
- Test Gemini provider converts tools to functionDeclarations
- Test `getProviderApiKey()` checks company_secrets first, then falls back to env
- Test all providers yield correct `ChatStreamChunk` types

**Verify:**
```bash
pnpm test -- --run llm-providers
```

**Commit:** `feat(server): add LLM provider abstraction for Anthropic, OpenAI, Google with company_secrets integration`

---

### Session 9: Agent Loop + Conversation Management

**Goal:** Build the core agent loop (multi-turn tool use) and conversation management.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T9, T10
- `v2_5_discussions_and_agent_architecture.md` — Agent Loop, Context Assembly
- `v2_5_discussions_and_agent_gotchas.md` — 2.3 (infinite recursion), 2.4 (token budget), 2.5 (action confirmation timeout)
- `v2_5_discussions_and_agent_security.md` — Prompt injection mitigations

**Steps:**

1. **Create `server/src/services/internal-agent/context-assembly.ts`**
   - `assembleContext(db, companyId, userId, pageContext, departmentContext)`:
     - Fetch company identity (from companies table + identity memory items)
     - Fetch relevant department context if departmentContext is set
     - Fetch recent conversation summary
     - Combine into system prompt sections
     - Estimate token count: `Math.ceil(text.length / 4)`
     - Respect `contextTokenBudget` from config — truncate if needed

2. **Create `server/src/services/internal-agent/conversation.ts`**
   ```typescript
   export function conversationService(db: Db) {
     return {
       getOrCreateActive: async (companyId: string, userId: string) => { ... },
       appendMessage: async (conversationId: string, message: MessageInput) => { ... },
       getRecentMessages: async (conversationId: string, limit?: number) => { ... },
       summarizeIfNeeded: async (conversationId: string, tokenThreshold: number) => { ... },
       reset: async (companyId: string, userId: string) => { ... },
     };
   }
   ```
   - `getOrCreateActive()`: Find active conversation for user+company, create if none
   - `summarizeIfNeeded()`: If total tokens > threshold, summarize older messages into `summarizedContext` field
   - `reset()`: Archive current conversation (status='archived'), create new one

3. **Create `server/src/services/internal-agent/agent-loop.ts`**
   ```typescript
   export function agentLoopService(db: Db) {
     return {
       chat: async function* (params: ChatInput): AsyncGenerator<AgentStreamChunk> {
         // 1. Get/create active conversation
         // 2. Append user message
         // 3. Assemble context (system prompt)
         // 4. Get provider + API key
         // 5. Create internal_agent_runs record (status: 'running')
         // 6. Loop: call LLM → if tool_call, execute tool → if text, yield to client
         // 7. Max iterations guard (Gotcha 2.3): cap at 10 tool rounds
         // 8. Track cost: sum token usage, write to cost_events
         // 9. Update run record (status: 'completed', costCents, durationMs, toolsCalled)
         // 10. Yield 'done' chunk with run summary
       },
       confirmAction: async (companyId: string, runId: string, confirmed: boolean) => { ... },
     };
   }
   ```
   - **Gotcha 2.3 guard:** Max 10 tool-call rounds per single user message. If exceeded, yield error message.
   - **Budget check:** Before each LLM call, check `spentMonthlyCents < budgetMonthlyCents`. If exceeded, yield "Budget exceeded" message.
   - **Action confirmation (Gotcha 2.5):** For write operations at autonomy level 0, yield `{ type: 'action_confirmation', tool, params }` and pause. Wait for `confirmAction()` call. Timeout after 5 minutes → cancel.

**Tests (RED → GREEN):**

Create `server/src/__tests__/agent-loop.test.ts`:
- Mock LLM provider to return tool_call → text sequence
- Test loop executes tool and yields text response
- Test max iterations guard stops at 10 rounds
- Test budget exceeded halts conversation
- Test action confirmation flow (yield pending → confirm → execute)
- Test cost tracking writes to cost_events

Create `server/src/__tests__/conversation-service.test.ts`:
- Test getOrCreateActive creates new conversation
- Test appendMessage increments messageCount
- Test summarizeIfNeeded triggers when threshold exceeded
- Test reset archives old and creates new

**Verify:**
```bash
pnpm test -- --run agent-loop
pnpm test -- --run conversation-service
```

**Commit:** `feat(server): add agent loop with multi-turn tool use, conversation management, budget enforcement`

---

### Session 10: Proactive Agent + Event Listener + Internal Agent Routes

**Goal:** Build proactive checks, event-driven triggers, and expose all internal agent HTTP endpoints.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T11, T12, T13a
- `v2_5_discussions_and_agent_api_contract.md` — Section 2 (Internal Agent endpoints)
- `v2_5_discussions_and_agent_gotchas.md` — 2.6 (proactive during active conversation)

**Steps:**

1. **Create `server/src/services/internal-agent/proactive.ts`**
   - 6 scheduled checks:
     - `blockedTaskScan()`: Find tasks in 'in_progress' that have unresolved blocking dependencies
     - `budgetThresholdAlert()`: Check agent + internal agent spend vs limits (80% warning)
     - `staleWorkDetection()`: Tasks in 'in_progress' with no activity for 3+ days
     - `dependencyChainGaps()`: Goals with incomplete dependency chains
     - `memoryConflictScan()`: Memory items flagged with conflicts
     - `workloadImbalance()`: Agents with >3x average task count
   - `morningDigest(companyId, userId)`: Summarize overnight activity
   - `checkReminders(companyId)`: Query due reminders, fire them, create notifications
   - Each check creates an `internal_agent_runs` record and a `notification` if findings exist

2. **Create `server/src/services/internal-agent/event-listener.ts`**
   - Subscribe to LiveEvents for the company
   - Route events to triggers with 30-second debounce:
     - `heartbeat.run.status` (terminal) → log, optionally notify
     - `activity.logged` (task status change) → check for blocked tasks
     - `discussion.entry.created` → trigger extraction
   - Each trigger creates an `internal_agent_runs` record

3. **Create `server/src/routes/internal-agent.ts`**
   ```typescript
   export function internalAgentRoutes(db: Db) {
     const router = Router();
     // 9 endpoints per API contract section 2:
     // POST /companies/:companyId/internal-agent/chat — SSE streaming
     // POST /companies/:companyId/internal-agent/confirm — confirm/reject action
     // GET  /companies/:companyId/internal-agent/conversation
     // POST /companies/:companyId/internal-agent/conversation/reset
     // GET  /companies/:companyId/internal-agent/config
     // PATCH /companies/:companyId/internal-agent/config (founder-only)
     // GET  /companies/:companyId/internal-agent/runs (founder-only)
     // GET  /companies/:companyId/internal-agent/reminders
     // DELETE /companies/:companyId/internal-agent/reminders/:id
     return router;
   }
   ```
   - **SSE chat endpoint** (per gotchas 5.2 — POST-based, not EventSource):
     ```typescript
     router.post("/companies/:companyId/internal-agent/chat", validate(chatMessageSchema), async (req, res) => {
       const companyId = req.params.companyId as string;
       assertCompanyAccess(req, companyId);
       res.setHeader("Content-Type", "text/event-stream");
       res.setHeader("Cache-Control", "no-cache");
       res.setHeader("Connection", "keep-alive");
       const loop = agentLoopService(db);
       for await (const chunk of loop.chat({ companyId, userId: req.actor.userId, ... })) {
         res.write(`event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`);
         if (typeof res.flush === 'function') res.flush();
       }
       res.end();
     });
     ```

4. **Register in `server/src/app.ts`**
   - `api.use(internalAgentRoutes(db));`

**Tests (RED → GREEN):**

Create `server/src/__tests__/proactive-checks.test.ts`:
- Test blockedTaskScan finds blocked tasks
- Test budgetThresholdAlert triggers at 80%
- Test staleWorkDetection finds old in_progress tasks
- Test morningDigest generates summary

Create `server/src/__tests__/event-listener.test.ts`:
- Test event routing maps correct events to triggers
- Test debounce prevents duplicate triggers within 30 seconds

Create `server/src/__tests__/internal-agent-routes-contract.test.ts`:
- Test route factory returns Router with 9 endpoints

**Verify:**
```bash
pnpm test -- --run proactive-checks
pnpm test -- --run event-listener
pnpm test -- --run internal-agent-routes-contract
pnpm build
```

**Commit:** `feat(server): add proactive agent, event listener, and internal agent HTTP routes with SSE streaming`

---

## Phase D — Frontend (Sessions 11–14)

---

### Session 11: Agent Panel API Client + Frontend Wiring

**Goal:** Create API client functions, query keys, and SSE streaming client for the agent panel.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T15
- `v2_5_discussions_and_agent_api_contract.md` — Sections 1 and 2
- `v2_5_discussions_and_agent_gotchas.md` — 5.2 (POST-based SSE)

**Steps:**

1. **Create `ui/src/api/discussions.ts`**
   - Functions: `listDiscussions()`, `getDiscussion()`, `createDiscussion()`, `addEntry()`, `updateDiscussion()`, `approveItems()`, `rejectItems()`, `updateItem()`, `reprocessEntry()`, `addAnnotation()`
   - Follow existing API client pattern in `ui/src/api/`

2. **Create `ui/src/api/internal-agent.ts`**
   - `sendMessage(companyId, message, pageContext)`: POST to `/internal-agent/chat`, returns a ReadableStream for SSE parsing
   - `getConversation(companyId)`, `resetConversation(companyId)`
   - `getAgentConfig(companyId)`, `updateAgentConfig(companyId, config)`
   - `getAgentRuns(companyId, filters)`, `getAgentReminders(companyId)`
   - SSE client helper (POST-based, not EventSource — see gotcha 5.2):
     ```typescript
     export async function* streamAgentChat(companyId: string, message: string, pageContext?: string) {
       const response = await fetch(`/api/companies/${companyId}/internal-agent/chat`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ message, pageContext }),
       });
       const reader = response.body!.getReader();
       const decoder = new TextDecoder();
       // Parse SSE: split on \n\n, extract event + data lines
       // yield parsed chunks
     }
     ```

3. **Update `ui/src/lib/queryKeys.ts`**
   - Add: `discussions`, `discussion`, `agentConversation`, `agentConfig`, `agentRuns`, `agentReminders`, `notifications`, `workflowTemplates`

4. **Update LiveUpdatesProvider** (wherever WebSocket events are handled)
   - Add handlers for new LiveEventTypes: `discussion.entry.created`, `discussion.extraction.completed`, `discussion.extraction.failed`, `internal_agent.greeting`, `internal_agent.reminder`, `internal_agent.notification`
   - Invalidate relevant query keys on each event

**Verify:**
```bash
pnpm build  # UI compiles
```

**Commit:** `feat(ui): add discussion and internal agent API clients with SSE streaming`

---

### Session 12: Agent Panel Component

**Goal:** Build the collapsible right-side agent panel with chat interface.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T14
- `v2_5_discussions_and_agent_flow.md` — Agent Panel flows
- `v2_5_discussions_and_agent_decisions.md` — DA-23 (mutual exclusion mobile), DA-22 (always-available)
- `v2_5_discussions_and_agent_gotchas.md` — 5.4 (streaming markdown rendering)

**Steps:**

1. **Create `ui/src/context/AgentPanelContext.tsx`**
   - State: `isOpen`, `isStreaming`, `currentConversationId`
   - Actions: `openPanel()`, `closePanel()`, `togglePanel()`

2. **Create `ui/src/components/InternalAgentPanel.tsx`**
   - Collapsible right panel (w-80 or w-96)
   - Message list: scrollable, auto-scroll on new messages
   - Input bar at bottom: text input + send button
   - Streaming response: render markdown progressively (gotcha 5.4)
   - Tool execution indicators: "Checking your tasks...", "Creating department..."
   - Action confirmation buttons: Confirm / Reject inline for pending actions
   - Greeting message: fetch from proactive service on panel open
   - "New conversation" button → calls resetConversation()
   - Header with context indicator (current page name)

3. **Update `ui/src/components/Layout.tsx`**
   - Wrap content with `AgentPanelProvider`
   - Add agent panel alongside main content: `<div className="flex"><Sidebar /><main className="flex-1">{children}</main><AgentPanel /></div>`
   - Responsive: panel hidden on mobile by default, full-screen sheet when opened (DA-23)

4. **Update `ui/src/components/BreadcrumbBar.tsx`**
   - Add agent panel toggle button (right side, next to search icon)

5. **Update `ui/src/components/MobileBottomNav.tsx`**
   - Replace Create button with AoA agent toggle (center position)

**Verify:**
```bash
pnpm build  # UI compiles
# Manual: open app, toggle agent panel, send a message, verify streaming
```

**Commit:** `feat(ui): add internal agent panel with chat interface, streaming, and action confirmation`

---

### Session 13: Discussion Pages

**Goal:** Build Discussions list page, Discussion detail page, and quick capture modal.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T16, T17, T18
- `v2_5_discussions_and_agent_flow.md` — Discussion flows
- `v2_5_discussions_and_agent_api_contract.md` — Section 1 response shapes

**Steps:**

1. **Create `ui/src/pages/Discussions.tsx`** (list page)
   - Filters: status, scope (department/project/goal), source (paste/write/voice/mcp), date range
   - Each row: title, scope tags, entry count, pending item count, last entry date, source badges
   - Sort by: most recent entry, most pending items
   - "New Discussion" button → opens quick capture modal
   - Uses `useQuery` with `queryKeys.discussions`

2. **Create `ui/src/pages/DiscussionDetail.tsx`** (detail page)
   - Thread view: entries displayed chronologically
   - Per entry: raw content, source badge, timestamp, extracted items below
   - Extracted items: pending (checkbox + edit controls), approved (green), rejected (greyed)
   - "Confirm All" button for quick approval
   - Bottom input bar: add new entry (paste/write/voice tabs)
   - Thread info sidebar: scope, tags, related discussions
   - "Reprocess" button per entry

3. **Create `ui/src/components/DiscussionCaptureModal.tsx`** (replaces DebriefModal)
   - Same input modes: Paste, Write, Voice
   - Add: "Add to existing Discussion" dropdown (recent discussions, searchable)
   - Default: new standalone discussion
   - After submission: async processing, notification when ready (no blocking spinner)
   - Register in DialogContext: `openDiscussionCapture()` / `closeDiscussionCapture()`

**Verify:**
```bash
pnpm build
# Manual: navigate to /discussions, create discussion, view detail, approve items
```

**Commit:** `feat(ui): add discussions list page, detail page, and quick capture modal`

---

### Session 14: Mid-Point Review + Discussion Tab on Projects

**Goal:** Add discussions tab to project/department pages. Then pause for UX review.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T19, H1

**Steps:**

1. **Update `ui/src/pages/ProjectDetail.tsx`**
   - Add "Discussions" tab
   - Shows discussions filtered by scope (tagged to this project/department)
   - "New Discussion" button pre-scoped to the project/department
   - Reuses `DiscussionsList` component from Session 13

2. **H1 — Mid-Point Review**
   - Manually test all discussion flows: create, add entry, extraction trigger, approve/reject, annotations
   - Test agent panel: send message, streaming response, tool execution, action confirmation
   - Test mobile: agent panel as full-screen sheet, mutual exclusion with capture modal
   - Document any UX adjustments needed before continuing

**Verify:**
```bash
pnpm build
pnpm test -- --run  # all tests pass
# Full manual walkthrough of discussion + agent panel flows
```

**Commit:** `feat(ui): add discussions tab to project/department detail pages`

---

## Phase E — Settings & Integration (Sessions 15–17)

---

### Session 15: Internal Agent Settings + Budget Integration

**Goal:** Build the settings UI for configuring the internal agent and integrate with budget display.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T20, T21
- `v2_5_discussions_and_agent_api_contract.md` — Section 2.5–2.7
- `v2_5_discussions_and_agent_env.md` — All config in DB

**Steps:**

1. **Create agent settings section** in Settings page (or new sub-page)
   - Execution mode: API / CLI toggle
   - If API: Provider dropdown (Anthropic/OpenAI/Google), Model dropdown, API key reference link
   - If CLI: CLI tool dropdown (Claude CLI/Codex/OpenCode)
   - Enabled capabilities: checkboxes for each of 12 capabilities
   - Notification preference: Silent / Digest / Real-time
   - Context token budget: compact (4000) / standard (8000) / large (16000)
   - Monthly budget: input in cents (display as dollars with $ prefix)
   - Current spend: progress bar showing spentMonthlyCents vs budgetMonthlyCents
   - "Test connection" button → validates API key by making a minimal LLM call
   - Run history: collapsible section with recent runs (trigger type, status, cost, duration)

2. **Update Budget section**
   - Add internal agent as separate line in budget view
   - Aggregate: total company spend = worker agents + internal agent
   - 80% warning indicator, 100% pause indicator

**Verify:**
```bash
pnpm build
# Manual: open settings, configure agent, test connection, check budget display
```

**Commit:** `feat(ui): add internal agent settings page and budget integration`

---

### Session 16: Sidebar, Navigation, and Inbox Updates

**Goal:** Replace Briefs → Discussions in sidebar, update routing, integrate notifications into Inbox.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T22, T23, T24
- `v2_5_discussions_and_agent_decisions.md` — DA-10 (sidebar structure)

**Steps:**

1. **Update `ui/src/components/Sidebar.tsx`**
   - Replace "Briefs" → "Discussions" with appropriate icon
   - Reorder WORK section: Discussions, Tasks, Agents, Goals
   - Badge: count of discussions with pending items (from sidebar badge service)

2. **Update routing in `ui/src/App.tsx`**
   - `/discussions` → Discussions list page
   - `/discussions/:id` → Discussion detail page
   - Redirect `/briefs` → `/discussions`
   - Redirect `/briefs/:briefId` → corresponding discussion (lookup via migration mapping)

3. **Update `ui/src/pages/Inbox.tsx`**
   - Replace "Briefs Awaiting Review" → "Discussion Items Pending Review"
   - Each item links to Discussion detail page
   - Add "Agent Alerts" section: proactive notifications from internal agent
   - Add "Reminders" section: fired reminders
   - Use notification service for unread counts + badge

4. **Update `ui/src/pages/Dashboard.tsx`** (Home page)
   - Replace Debrief quick action → Discussion quick action
   - Replace "Briefs" references → "Discussions"
   - Add morning digest display (if agent has generated one)

5. **Update `sidebarBadgeService`** on server to include notification unread count in badge response

**Verify:**
```bash
pnpm build
# Manual: verify sidebar shows Discussions, routing works, inbox shows notifications
```

**Commit:** `feat(ui): update sidebar, routing, inbox, and home page for discussions and agent notifications`

---

### Session 17: WebSocket Integration + Extraction Refactor

**Goal:** Wire up live updates for agent events and migrate extraction to use the internal agent.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T25, T26
- `v2_5_discussions_and_agent_integration.md` — WebSocket events, Extraction migration

**Steps:**

1. **Update server-side LiveEvents**
   - Add new event types to `LiveEventType` in shared package (if not done in Session 3)
   - Publish events from internal agent services:
     - After chat response: `publishLiveEvent({ companyId, type: 'internal_agent.message', payload: { ... } })`
     - After run status change: `publishLiveEvent({ companyId, type: 'internal_agent.run.status', payload: { ... } })`
     - After reminder fires: `publishLiveEvent({ companyId, type: 'internal_agent.reminder', payload: { ... } })`

2. **Update frontend LiveUpdatesProvider**
   - Handle new event types: invalidate query keys, update agent panel state, show toast notifications

3. **Refactor `server/src/services/extraction.ts`**
   - Move current `EXTRACTION_PROMPT_TEMPLATE` logic into the `extract_from_content` tool
   - When a discussion entry is created and agent is configured:
     - Use agent loop to extract (multi-turn if needed, with thread context)
     - Agent can check existing tasks/memory for dedup, flag conflicts
   - **Fallback:** If internal agent is not configured (`internalAgentConfig` missing or no API key), use the legacy one-shot extraction with raw `fetch()`
   - Update extraction status on discussion_entries: pending → processing → completed/failed

**Tests (RED → GREEN):**

Create `server/src/__tests__/extraction-refactor.test.ts`:
- Test extraction via agent loop creates extracted items
- Test fallback to legacy extraction when agent not configured
- Test extraction status transitions (pending → processing → completed)
- Test dedup detection (agent finds existing similar task)

**Verify:**
```bash
pnpm test -- --run extraction-refactor
pnpm build
```

**Commit:** `feat(server): wire WebSocket live updates for agent events; refactor extraction to use internal agent with legacy fallback`

---

## Phase F — Workflow & CLI (Sessions 18–19)

---

### Session 18: Workflow Template Service + Routes

**Goal:** Build workflow template CRUD, instantiation, and HTTP routes.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T27, T28, T13b
- `v2_5_discussions_and_agent_api_contract.md` — Section 3

**Steps:**

1. **Create `server/src/services/workflow-templates.ts`**
   ```typescript
   export function workflowTemplateService(db: Db) {
     return {
       list: async (companyId: string) => { ... },
       getById: async (companyId: string, id: string) => { ... },
       create: async (companyId: string, data: CreateWorkflowInput, actorId: string) => { ... },
       update: async (companyId: string, id: string, data: UpdateWorkflowInput) => { ... },
       delete: async (companyId: string, id: string) => { ... },
       instantiate: async (companyId: string, templateId: string, goalId: string, projectId: string) => {
         // For each step in template.steps:
         //   Create issue with priority, department, description
         // For each dependency in template.dependencies:
         //   Create task_dependencies row
         // Link all tasks to the goal
         // Increment template.instantiationCount
         // Return created tasks
       },
     };
   }
   ```

2. **Create `server/src/routes/workflow-templates.ts`**
   - 6 endpoints per API contract section 3
   - All mutations are founder-only
   - Register in `server/src/app.ts`

3. **Export from barrels**

**Tests (RED → GREEN):**

Create `server/src/__tests__/workflow-templates.test.ts`:
- Test instantiation creates correct number of tasks
- Test dependencies are created between tasks
- Test instantiationCount increments
- Test deletion blocked if active instances exist

**Verify:**
```bash
pnpm test -- --run workflow-templates
pnpm build
```

**Commit:** `feat(server): add workflow template service and routes with instantiation`

---

### Session 19: CLI Execution Mode

**Goal:** Build the CLI execution backend for running the agent via local CLI tools (Claude CLI, Codex, OpenCode).

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T13
- `v2_5_discussions_and_agent_integration.md` — CLI Execution Mode section
- `v2_5_discussions_and_agent_gotchas.md` — Gotcha on CLI availability

**Steps:**

1. **Create `server/src/services/internal-agent/cli-mode.ts`**
   - When `executionMode === 'cli'`:
     - Expose AoA tools as MCP server (extend existing V2 MCP outbound from `server/src/mcp/server.ts`)
     - Spawn CLI process with MCP config pointing to AoA server
     - Route conversation through CLI agent loop
     - Capture output and stream to frontend via SSE
   - Session management: persist CLI session between conversation turns
   - Fallback: if CLI tool not found in PATH, return error suggesting API mode

2. **Update agent loop to delegate to CLI mode when config says so**

**Tests (RED → GREEN):**

Create `server/src/__tests__/cli-mode.test.ts`:
- Test CLI mode detects tool availability
- Test fallback error when CLI not found
- Test MCP tool registration includes all 30 tools

**Verify:**
```bash
pnpm test -- --run cli-mode
```

**Commit:** `feat(server): add CLI execution mode for internal agent with MCP bridge`

---

## Phase G — Testing & Cleanup (Sessions 20–21)

---

### Session 20: Full Test Suite

**Goal:** Write comprehensive unit tests, integration tests, and QA edge case tests.

**Spec references:**
- `v2_5_discussions_and_agent_testing.md` — Full test plan (20 test suites)
- `v2_5_discussions_and_agent_gotchas.md` — All 19 gotchas as test cases

**Steps:**

1. **Fill any gaps in unit tests** from previous sessions — ensure every service has test coverage
2. **Write integration test suites:**
   - `v2.5-discussion-flow-qa.test.ts`: Create discussion → add entry → agent extracts → approve → tasks created
   - `v2.5-agent-panel-qa.test.ts`: Send message → agent calls tools → response streamed
   - `v2.5-proactive-qa.test.ts`: Scheduled check fires → notification created
   - `v2.5-workflow-qa.test.ts`: Create template → instantiate → tasks with dependencies
3. **Write edge case tests:**
   - `v2.5-edge-cases-qa.test.ts`:
     - Discussion with 100+ entries (pagination/performance)
     - Agent tool error mid-loop (graceful degradation)
     - Concurrent conversation turns (race condition)
     - Budget exceeded mid-conversation
     - MCP flood: 50 entries rapid-fire (debounce)
     - Migration: debrief with failed extraction
     - Thread merge: move entry between discussions (referential integrity)
     - Conversation summarization coherence
4. **Run full test suite, fix any failures**

**Verify:**
```bash
pnpm test -- --run  # ALL tests pass
# Report coverage numbers for v2.5 code
```

**Commit:** `test(server): add comprehensive v2.5 integration and edge case test suites`

---

### Session 21: Cleanup + CLAUDE.md Update + Final Review

**Goal:** Remove old debrief/brief UI, update CLAUDE.md, final end-to-end review.

**Spec references:**
- `v2_5_discussions_and_agent_tasks.md` — T32, T33, H2, H3

**Steps:**

1. **Remove old UI files:**
   - Delete `ui/src/components/DebriefModal.tsx` (replaced by DiscussionCaptureModal)
   - Delete `ui/src/pages/Briefs.tsx` (replaced by Discussions)
   - Delete `ui/src/pages/BriefReview.tsx` (replaced by DiscussionDetail)
   - Delete `ui/src/api/debriefs.ts` and `ui/src/api/briefs.ts` (replaced by discussions.ts)
   - Remove debrief/brief references from DialogContext
   - Clean up unused imports

2. **Update `CLAUDE.md`:**
   - Critical Rule #5: "MCP inbound always routes through **Discussion** pipeline"
   - Key Architecture: Add Discussions system, Internal Agent, Workflow Templates
   - Naming Map: Add Discussion, Discussion Entry, Extracted Item mappings
   - Sidebar Structure: Update WORK section to Discussions, Tasks, Agents, Goals
   - V2.5 New Tables: List all 11 tables
   - V2.5 Modified Tables: Note cost_events source type addition
   - V2.5 Architecture summary paragraph

3. **H2 — Final Review:**
   - Full end-to-end manual test:
     - Create discussion → add paste/write/voice entries → extraction runs → approve items → tasks + memory created
     - Open agent panel → chat → agent uses tools → streaming response → action confirmation
     - Proactive check runs → notification appears in inbox
     - Create workflow template → instantiate → tasks with dependencies appear
     - Settings: configure agent provider/model/budget → test connection
     - Mobile: agent panel as sheet, discussion capture works
   - Verify all redirects: `/briefs` → `/discussions`, MCP inbound → discussion pipeline
   - Run full test suite one final time

4. **H3 — Changelog:**
   - Create `plans/v2_5_discussions_and_agent/v2_5_changelog.md`
   - Document what shipped, any deviations from spec, decisions made during implementation

**Verify:**
```bash
pnpm test -- --run  # ALL tests pass
pnpm build          # Clean build
# Full manual walkthrough documented above
```

**Commit:** `chore: remove deprecated debrief/brief UI; update CLAUDE.md for v2.5`

---

## PR & Merge Strategy

Each session = 1 branch = 1 PR. **21 PRs total**, merged sequentially into `main` following the dependency order below.

### Branch Naming

Each session gets its own branch off `main`:

| Session | Branch Name | Base |
|---------|-------------|------|
| S1 | `v2.5/s01-discussion-schema` | `main` |
| S2 | `v2.5/s02-agent-schema` | `main` (after S1 merged) |
| S3 | `v2.5/s03-shared-types-migration` | `main` (after S2 merged) |
| S4 | `v2.5/s04-discussion-service` | `main` (after S3 merged) |
| S5 | `v2.5/s05-discussion-routes` | `main` (after S4 merged) |
| S6 | `v2.5/s06-debrief-deprecation` | `main` (after S5 merged) |
| S7 | `v2.5/s07-tool-registry` | `main` (after S3 merged) |
| S8 | `v2.5/s08-llm-providers` | `main` (after S7 merged) |
| S9 | `v2.5/s09-agent-loop` | `main` (after S8 merged) |
| S10 | `v2.5/s10-agent-routes` | `main` (after S9 merged) |
| S11 | `v2.5/s11-frontend-api` | `main` (after S6 + S10 merged) |
| S12 | `v2.5/s12-agent-panel` | `main` (after S11 merged) |
| S13 | `v2.5/s13-discussion-pages` | `main` (after S12 merged) |
| S14 | `v2.5/s14-extraction-ui` | `main` (after S13 merged) |
| S15 | `v2.5/s15-agent-settings` | `main` (after S14 merged) |
| S16 | `v2.5/s16-sidebar-inbox` | `main` (after S15 merged) |
| S17 | `v2.5/s17-live-events` | `main` (after S16 merged) |
| S18 | `v2.5/s18-workflow-templates` | `main` (after S6 merged) |
| S19 | `v2.5/s19-cli-mode` | `main` (after S18 merged) |
| S20 | `v2.5/s20-test-suite` | `main` (after S17 + S19 merged) |
| S21 | `v2.5/s21-cleanup` | `main` (after S20 merged) |

### Merge Order (Critical Path)

There are two parallel tracks after S3, converging at S11 and again at S20:

```
S1 → S2 → S3 ─┬─→ S4 → S5 → S6 ─┬─→ S11 → S12 → S13 → S14 → S15 → S16 → S17 ─┐
               │                   │                                                 │
               │                   └─→ S18 → S19 ──────────────────────────────────┐ │
               │                                                                    │ │
               └─→ S7 → S8 → S9 → S10 ─┘                                    S20 ←─┘─┘
                                                                              │
                                                                             S21
```

**Parallel tracks (can develop simultaneously):**
- **Track 1 (Discussions):** S4 → S5 → S6
- **Track 2 (Agent):** S7 → S8 → S9 → S10
- **Track 3 (Workflows):** S18 → S19 (can start after S6 merges)

**Convergence points:**
- S11 waits for both S6 AND S10 (frontend needs both backends)
- S20 waits for both S17 AND S19 (test suite needs everything)

### Merge Strategy

- **Squash merge** each session PR into `main`. One clean commit per session: `feat(v2.5): S1 — discussion schema tables`
- **Branch from latest `main`** — each new session branches off `main` after its prerequisite session(s) have been merged. Never branch from another session branch.
- **No long-lived feature branch** — each session goes directly to `main` in order. This keeps `main` incrementally deployable and avoids merge conflicts.
- **Conflict resolution** — since each PR merges before the next one branches, conflicts should be rare. If two parallel tracks touch the same barrel file (e.g., `schema/index.ts`), the second to merge rebases onto updated `main` first.

### Vibe Kanban Flow

Each session sub-issue on the kanban board maps 1:1 to a PR. The flow:

1. **Backlog** → session is planned but dependencies not yet merged
2. **Ready** → all prerequisite session PRs are merged into `main`
3. **In Progress** → vibe kanban session running, branch created, coding
4. **Review** → PR open, tests passing, awaiting review
5. **Done** → PR merged to `main`

When a session moves to Done, check the dependency diagram — any session whose ALL prerequisites are now Done moves to Ready.

**Starting state:**

| Column | Sessions |
|--------|----------|
| Ready | S1 |
| Backlog | S2–S21 |

**After S1 merges:**

| Column | Sessions |
|--------|----------|
| Ready | S2 |
| Backlog | S3–S21 |
| Done | S1 |

**After S3 merges (parallel unlocks):**

| Column | Sessions |
|--------|----------|
| Ready | S4, S7 (both can start simultaneously) |
| Backlog | S5–S6, S8–S21 |
| Done | S1, S2, S3 |

### Rollback Plan

Each session is a single squash commit on `main`. To rollback:
1. `git revert <commit-sha>` for the specific session
2. Fix on a new branch
3. Re-merge

Since sessions build on each other, reverting S4 may require also reverting S5–S6 and everything downstream. Keep session scope small to minimize blast radius.

---

## Summary

| Phase | Sessions | Tasks Covered | Description |
|-------|----------|---------------|-------------|
| A — Foundation | 1–3 | T1, T2, T3, T4 | Schema tables, shared types, data migration |
| B — Discussion Backend | 4–6 | T6, T7, T8, T13c | Discussion service, routes, notifications, deprecation |
| C — Internal Agent Core | 7–10 | T5, T9, T10, T11, T12, T13a | Tool registry, providers, agent loop, proactive, events, routes |
| D — Frontend | 11–14 | T14, T15, T16, T17, T18, T19, H1 | API clients, agent panel, discussion pages, mid-review |
| E — Settings & Integration | 15–17 | T20, T21, T22, T23, T24, T25, T26 | Settings UI, sidebar, inbox, live updates, extraction refactor |
| F — Workflow & CLI | 18–19 | T13, T27, T28, T13b | Workflow templates, CLI mode |
| G — Testing & Cleanup | 20–21 | T29, T30, T31, T32, T33, H2, H3 | Full test suite, UI cleanup, CLAUDE.md update, final review |

**Total: 21 sessions covering 33 tasks + 3 handoff/review points.**

Each session is independently committable. If a session runs long, split at the test boundary — commit the code that passes tests, move remaining to next session.
