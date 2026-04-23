# V2.5 Spec Documents — Comprehensive Review Report

**Reviewer:** AI Agent (against actual codebase)
**Date:** 2026-03-24
**Last updated:** 2026-03-25
**Scope:** All 15 spec documents cross-referenced against live source code

---

## FIX STATUS

All critical and moderate inaccuracies have been resolved. All 4 decisions locked by TK:
- **D1 (C5):** Cents — applied across all docs
- **D2 (C6):** company_secrets — applied across all docs
- **D3 (M3):** New notifications table — added to schema.md, tasks.md
- **D4 (M4):** Keep all 4 WORK sidebar items — confirmed, already correct in decisions.md

All gaps (G1–G10) have been filled in the relevant documents.

**Final verification:** Grep scan on 2026-03-25 confirms zero remaining `costUsd`, `budgetLimitUsd`, `budgetUsedUsd`, `llm_providers`, `c.req.json()`, `c.get('user')`, or `req.user` references in any spec document (only in this review report as historical context).

---

## CRITICAL INACCURACIES (Must Fix Before Coding)

### C1. Framework is Express, NOT Hono

**Affected docs:** architecture.md, integration.md, api_contract.md
**Severity:** CRITICAL — code will not compile

The CLAUDE.md says "Hono framework" but the actual codebase uses **Express 5.1.0** (confirmed in `server/package.json`, `server/src/app.ts` imports `express`). Multiple v2.5 docs reference Hono-specific APIs:

| Doc | Line/Section | What's Wrong |
|-----|-------------|-------------|
| architecture.md | "Service Pattern" | Says "Hono route handlers" — should say Express |
| integration.md | SSE section | Uses `c.stream()`, `c.streamSSE()`, `c.req.json()`, `c.get('user')` — these are Hono APIs |
| api_contract.md | Route examples | May reference Hono patterns |

**Fix:** Replace all Hono references with Express patterns:
- `c.stream()` → `res.write()` + `res.flush()` with `Content-Type: text/event-stream`
- `c.req.json()` → `req.body` (Express auto-parses JSON via `express.json()`)
- `c.get('user')` → `req.actor` (the actual auth pattern)
- Route handler signature: `async (req, res) => {}` not `async (c) => {}`

**DECISION NEEDED:** None — straightforward fix.

---

### C2. Route Pattern: Factory Functions, Not Plain Handlers

**Affected docs:** architecture.md, api_contract.md
**Severity:** HIGH — will cause confusion during implementation

Actual route pattern is a **factory function returning Express Router**, taking `Db` as parameter:

```typescript
// ACTUAL PATTERN
export function discussionRoutes(db: Db) {
  const router = Router();
  const svc = discussionService(db);

  router.get("/companies/:companyId/discussions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.list(companyId);
    res.json(result);
  });

  return router;
}
```

The architecture doc says "Export functions, not classes" which is partially correct — the services return object literals, not classes. But it misses the factory pattern.

**Fix:** Update architecture.md "Service Pattern" and "Conventions" sections to show the actual factory pattern for both routes and services.

**DECISION NEEDED:** None — straightforward fix.

---

### C3. Service Pattern: Factory Returns Object, Not Standalone Functions

**Affected docs:** architecture.md, integration.md
**Severity:** HIGH — tools calling services will fail

Actual service pattern:
```typescript
// ACTUAL PATTERN
export function discussionService(db: Db) {
  return {
    list: async (companyId: string) => { ... },
    create: async (companyId: string, data: ...) => { ... },
    getById: async (companyId: string, id: string) => { ... },
  };
}
```

The integration doc's "Services the Internal Agent Calls" table references standalone functions like `listIssues()`, `getIssue()`. In reality, you'd call `issueService(db).list()`, `issueService(db).getById()`.

**Fix:** The internal agent's tool context needs a `ServiceContainer` that holds pre-instantiated service instances:
```typescript
interface ServiceContainer {
  issues: ReturnType<typeof issueService>;
  goals: ReturnType<typeof goalService>;
  memory: ReturnType<typeof memoryService>;
  // etc.
}
```

**DECISION NEEDED:** None — design the ServiceContainer to hold pre-built services.

---

### C4. Auth Model: `req.actor`, Not `req.user`

**Affected docs:** integration.md, architecture.md, permissions.md
**Severity:** HIGH — auth checks will not work

The actual auth system uses `req.actor` with actor types:
- `"board"` — human user (founder, team lead, member) with `.userId`
- `"agent"` — agent with `.agentId` and `.companyId`
- `"none"` — unauthenticated

RBAC checks use `assertRole(db, req, companyId, "founder")` and `assertCompanyAccess(req, companyId)`, not a simple role on the user object.

**Fix:**
- Replace all `c.get('user')` references with `req.actor`
- The internal agent's tool context `userId` and `userRole` must be extracted from `req.actor`
- Tool RBAC checks should use the existing `assertRole()` / `permissionService` pattern

**DECISION NEEDED:** None — use existing auth patterns.

---

### C5. Cost Tracking Uses Cents (Integer), Not USD (Float)

**Affected docs:** schema.md, architecture.md, integration.md
**Severity:** HIGH — budget math will be wrong

The existing `cost_events` table uses `costCents: integer("cost_cents")`. Agent budgets use `budgetMonthlyCents` and `spentMonthlyCents` (both integers in cents).

The v2.5 `internal_agent_config` schema uses `budgetLimitUsd` and `budgetUsedUsd` (implying float/decimal in dollars). This breaks the established pattern.

**Fix:** Change `internal_agent_config` to use cents:
- `budgetLimitUsd` → `budgetMonthlyCents: integer("budget_monthly_cents").notNull().default(1000)` (= $10.00)
- `budgetUsedUsd` → `spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0)`

This also matches agent budget columns and the company budget columns.

**DECISION NEEDED:** Confirm switching to cents pattern (recommended) or intentionally break from pattern for UX reasons (showing dollars in settings UI, converting at the API boundary).

---

### C6. No `llm_providers` Table Exists

**Affected docs:** integration.md, env.md
**Severity:** HIGH — key lookup flow won't work

The integration doc says: "Reuse the existing `llm_providers` table and settings infrastructure." **This table does not exist.**

The current extraction service reads API keys directly from environment variables:
```typescript
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
```

The codebase has a `company_secrets` + `company_secret_versions` table and a `secretService` for managing encrypted secrets. API adapter configurations store model preferences in `agents.runtimeConfig`.

**Fix:** Two options:
- **Option A:** Use existing `company_secrets` for storing LLM API keys, with a well-known secret name convention (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
- **Option B:** Create a new lightweight `llm_provider_configs` table as part of v2.5 schema

**DECISION NEEDED:** Which approach for storing internal agent's LLM API keys — existing company_secrets or new table?

---

### C7. API Route Prefix Pattern

**Affected docs:** api_contract.md
**Severity:** MEDIUM — routes will 404 if wrong prefix

All existing routes use the `/companies/:companyId/` prefix pattern:
```
GET  /companies/:companyId/issues
GET  /companies/:companyId/goals
POST /companies/:companyId/debriefs
```

The v2.5 API contract doc should confirm all new endpoints follow this pattern:
```
GET  /companies/:companyId/discussions         (not /discussions)
POST /companies/:companyId/internal-agent/chat (not /internal-agent/chat)
GET  /companies/:companyId/workflow-templates   (not /workflow-templates)
```

**Fix:** Verify API contract doc uses `/companies/:companyId/` prefix everywhere.

**DECISION NEEDED:** None — follow existing pattern.

---

## MODERATE INACCURACIES (Should Fix)

### M1. LiveEvents Pattern Specifics

**Affected docs:** integration.md
**Severity:** MEDIUM

The integration doc shows `liveEvents.publish(companyId, { type, data })`. The actual API is:
```typescript
publishLiveEvent({ companyId, type, payload });  // not .publish()
```

And event types are typed via `LiveEventType` from `@armyofagents/shared`, not arbitrary strings. New event types for v2.5 must be added to the `LiveEventType` union in the shared package.

**Fix:** Use `publishLiveEvent()` (named export from `services/live-events.ts`) and add new types to `LiveEventType`.

---

### M2. Extraction Service Uses Raw `fetch()`, Not SDK

**Affected docs:** integration.md, dependencies.md
**Severity:** MEDIUM

The current extraction service calls LLM APIs using raw `fetch()` — it does NOT use `@anthropic-ai/sdk` or `openai` npm packages. It directly hits `https://api.anthropic.com/v1/messages` and `https://api.openai.com/v1/chat/completions`.

The v2.5 internal agent should use the SDKs (for streaming support and tool calling), but be aware that the existing extraction service doesn't — so there's no pattern to copy for SDK usage within this codebase's services. The SDK usage exists in the adapters.

**Fix:** Note in architecture doc that the internal agent providers will follow the adapter SDK patterns (e.g., `server/src/adapters/claude-api/`), not the extraction service's raw fetch pattern.

---

### M3. No Dedicated Notifications/Inbox Table

**Affected docs:** integration.md (Inbox Integration section)
**Severity:** MEDIUM

The integration doc references "existing notifications/inbox infrastructure." There is no `notifications` table. The current "inbox" is built from:
- `approvals` table (pending approval items)
- `sidebar_badges` service (counts failed runs, pending briefs)
- `debriefs` with status `completed` but unreviewed briefs

**Fix:** V2.5 needs to either (a) piggyback on the approvals system for discussion extraction notifications, or (b) create a simple `notifications` table. The testing doc references `notifications.add()` which doesn't exist.

**DECISION NEEDED:** How should discussion extraction notifications work? Piggyback on approvals table? Create a new notifications table? Or just use WebSocket events + toast (ephemeral, no persistence)?

---

### M4. Sidebar "WORK" Section Has Different Items

**Affected docs:** decisions.md (DA-10)
**Severity:** LOW — cosmetic but worth noting

Current sidebar WORK section: **Tasks, Briefs, Agents, Goals**

DA-10 plans the new sidebar as: **Discussions, Tasks** (under WORK). But the current sidebar also has **Agents** and **Goals** in WORK. Need to confirm: do Agents and Goals stay in WORK, move elsewhere, or remain as-is?

**DECISION NEEDED:** Confirm full sidebar WORK section content after v2.5 changes.

---

### M5. `extractionStatus` Field Missing from Schema Doc

**Affected docs:** schema.md
**Severity:** MEDIUM

The flow doc and gotchas doc reference `discussion_entries.extractionStatus` (pending → processing → completed → failed). But checking the schema doc, the `discussion_entries` table definition should include this field. Let me verify it's there.

**Fix:** Ensure `extractionStatus` is explicitly in the discussion_entries schema definition with the correct enum values.

---

### M6. Brief Items vs. Discussion Extracted Items Status Enum

**Affected docs:** schema.md, rollout.md
**Severity:** LOW

Existing `brief_items.status` has: `"pending"`, `"approved"`, `"rejected"`, `"completed"`. The v2.5 `discussion_extracted_items.status` adds `"edited"`. The migration mapping should account for this — old items won't have `edited` status, which is fine, but document it.

---

### M7. `suggestedGoalId` and `conflictsWith` in Extracted Items

**Affected docs:** schema.md
**Severity:** LOW

The summary mentions `conflictsWith` and `suggestedGoalId` on `discussion_extracted_items`. Verify these are in the actual schema definition. If the schema doesn't have them, they need to be added. These are important for conflict detection and goal linking.

---

## GAPS (Missing Details)

### G1. Route Registration in app.ts

**Gap:** None of the docs mention how new routes get registered. In the actual codebase, `server/src/app.ts` imports each route factory and mounts it:
```typescript
api.use(discussionRoutes(db));
api.use(internalAgentRoutes(db));
api.use(workflowTemplateRoutes(db));
```

**Fix:** Add to tasks doc: "Register new routes in `server/src/app.ts`" as a subtask of route implementation tasks.

---

### G2. Service Registration in services/index.ts

**Gap:** New services need to be exported from `server/src/services/index.ts` (barrel file). Not mentioned anywhere.

**Fix:** Add to tasks doc.

---

### G3. Shared Types Registration

**Gap:** New types, validators, and constants need to be added to `packages/shared/src/`. Not detailed which specific exports are needed.

**Fix:** Add explicit list: new Zod schemas (createDiscussionSchema, createDiscussionEntrySchema, etc.), new constants (DISCUSSION_STATUSES, EXTRACTION_ITEM_TYPES, AGENT_CAPABILITIES, TRIGGER_SOURCES, TRIGGER_TYPES), new TypeScript types.

---

### G4. Query Keys for React Query

**Gap:** Frontend needs new query keys in `ui/src/lib/queryKeys.ts` for discussions, internal agent, and workflow templates. Not mentioned.

**Fix:** Add to tasks doc: update queryKeys.ts with discussion, agent, and workflow query key factories.

---

### G5. DialogContext Updates

**Gap:** The existing `DialogContext` has `debriefOpen/openDebrief/closeDebrief`. This needs to change to `discussionCaptureOpen/openDiscussionCapture/closeDiscussionCapture`. Not mentioned in any doc.

**Fix:** Add to tasks doc: update DialogContext for discussion capture modal.

---

### G6. Mobile Bottom Nav "Create" → Agent Toggle

**Gap:** DA-26 says "Replace Create with agent toggle in mobile bottom nav." The current `MobileBottomNav.tsx` has 5 items: Home, Tasks, Create, Agents, Inbox. The tasks doc should have a specific subtask for this change including: updating the component, handling the toggle animation, ensuring the agent panel shows as a full-screen overlay on mobile.

---

### G7. Error Classes

**Gap:** The codebase uses custom error functions: `badRequest()`, `notFound()`, `unprocessable()`, `conflict()`, `forbidden()` from `server/src/errors.ts`. New services should use these, not generic `throw new Error()`. Not mentioned in architecture doc.

**Fix:** Add to conventions section of architecture doc.

---

### G8. Activity Logging for New Operations

**Gap:** Every mutation in the codebase logs an activity entry via `logActivity()`. The v2.5 services need activity logging for: discussion.created, discussion.entry.created, discussion.item.approved, discussion.item.rejected, agent.chat, agent.action.confirmed, workflow.template.created, workflow.instantiated.

**Fix:** Add activity logging as a requirement in the tasks doc for each service.

---

### G9. Test File Import Patterns (ESM/Drizzle Workaround)

**Gap:** The testing doc describes test suites but doesn't mention the critical ESM/Drizzle mock workaround. All v2.5 tests MUST use the proxy-based mock pattern for `@armyofagents/db` and `drizzle-orm` to avoid the ESM cycle issue.

```typescript
vi.mock("drizzle-orm", () => ({
  and: vi.fn(), eq: vi.fn(), sql: vi.fn(), // etc.
}));
vi.mock("@armyofagents/db", () => ({
  discussions: { id: "id", companyId: "company_id", /* ... */ },
}));
```

**Fix:** Add this as a required pattern in the testing doc's "Test Strategy" section.

---

### G10. Existing Extraction Prompt As Reference

**Gap:** The extraction service has a well-crafted `EXTRACTION_PROMPT_TEMPLATE` that includes department/project context, item type definitions, and layer heuristics. The v2.5 internal agent's `extract_from_content` tool should reuse or extend this prompt — not write a new one from scratch.

**Fix:** Reference `server/src/services/extraction.ts` EXTRACTION_PROMPT_TEMPLATE in the architecture doc as the starting point for discussion extraction.

---

## DECISIONS NEEDED (Summary)

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| C5 | Budget units | Cents (int, match existing) vs. USD (float, new pattern) | **Cents** — consistency |
| C6 | API key storage | company_secrets table vs. new llm_provider_configs table | **company_secrets** — already exists, secure |
| M3 | Notification persistence | Approvals table / new notifications table / WebSocket-only | **New simple notifications table** — needed for reminders and offline users |
| M4 | Sidebar WORK items | Discussions, Tasks, Agents, Goals vs. Discussions, Tasks only | **Discussions, Tasks, Agents, Goals** — don't remove existing items |

---

## DOCUMENT-BY-DOCUMENT STATUS

| Document | Original Issues | Fixes Applied | Status |
|----------|----------------|---------------|--------|
| decisions.md | None | costUsd → costCents | DONE |
| tasks.md | G1-G6, G8 | Added T13a/T13b/T13c, route registration, activity logging, notifications, shared types details | DONE |
| prd.md | None | — | DONE |
| schema.md | C5, M5-M7 | costUsd → costCents, added notifications table (#11), verified extractionStatus/suggestedGoalId/conflictsWith present | DONE |
| api_contract.md | C1, C7 | costUsd → costCents, verified route prefix pattern | DONE |
| flow.md | None | — | DONE |
| permissions.md | C4 | — (permissions doc already used correct patterns) | DONE |
| architecture.md | C1-C3, M2, G7, G10 | Replaced service/route patterns with factory examples, added Auth Model section, added ESM mock pattern, added extraction prompt reference, costUsd → costCents | DONE |
| integration.md | C1, C4, C6, M1, M3 | Hono → Express SSE, req.actor, company_secrets flow, LiveEvents API, ServiceContainer, costUsd → costCents, redirect routes fixed | DONE |
| testing.md | G9 | Added ESM/Drizzle mock pattern section with full code example | DONE |
| rollout.md | M6 | budgetLimitUsd → budgetMonthlyCents, budgetUsedUsd → spentMonthlyCents | DONE |
| dependencies.md | M2 | Added note clarifying Express 5.1.0 is actual framework (Hono mention kept as migration context) | DONE |
| gotchas.md | None | — | DONE |
| security.md | C5, C6 | budgetLimitUsd → budgetMonthlyCents, llm_providers → company_secrets | DONE |
| env.md | C6 | llm_providers → company_secrets | DONE |

---

## NEXT STEP

All 15 spec documents are reviewed, corrected, and consistent with the actual codebase. Ready for TK's final review, then proceed to coding Phase 1 (schema + backend services).
