# Threads — Plan 1: Data Model & Migrations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add every Threads v1 schema change on the `discussions` backbone plus six new tables, then generate one Drizzle migration — verified by contract tests.

**Architecture:** Threads reuses the discussion tables. This plan ALTERs `discussions`, `discussion_entries`, `discussion_extracted_items`, and `projects`, adds a new `packages/db/src/schema/threads.ts` with six tables, registers it in the schema barrel, and generates a single migration. Following codebase convention, **enums are `text()` columns backed by `as const` arrays in `packages/shared/src/constants.ts`** (no `pgEnum`), and **user IDs are `text`** (no FK).

**Tech stack:** Drizzle ORM + PostgreSQL (`packages/db`), shared constants (`packages/shared`), Vitest contract tests (`server/src/__tests__`).

**Pre-read (do not skip):**
- `packages/db/src/schema/discussions.ts` — the four tables you'll ALTER.
- `packages/db/src/schema/goals.ts` — the canonical column/enum/timestamp pattern.
- `packages/db/src/schema/index.ts` — the barrel you'll register `threads.js` in.
- `packages/shared/src/constants.ts` (lines ~617-636, the "V2.5: Discussions" block) — where new const arrays go.
- `server/src/__tests__/discussions-schema-contract.test.ts` — the contract-test pattern you'll mirror.

**Conventions for this plan:**
- Run tests from the repo root: `pnpm exec vitest run <path>`. `@armyofagents/db` and `@armyofagents/shared` resolve to **source**, so tests see schema/const edits immediately — **no build needed between edit and test**.
- snake_case DB column names → camelCase TS keys.
- `companyId` is always `.notNull().references(() => companies.id, { onDelete: "cascade" })`.
- Timestamps: `timestamp("...", { withTimezone: true })` + `.notNull().defaultNow()`.
- Self-references use `(): AnyPgColumn => table.id`.
- Do NOT hand-write SQL. The migration is generated in Task 7.

---

## Task 1: Threads constants

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Test: `server/src/__tests__/threads-constants.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/threads-constants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  THREAD_PHASES,
  THREAD_VISIBILITIES,
  THREAD_ORIGIN_SOURCES,
  THREAD_PARTICIPANT_ROLES,
  THREAD_LINK_KINDS,
  THREAD_INBOX_STATUSES,
  DISCUSSION_ENTRY_INPUT_TYPES,
  EXTRACTION_ITEM_TYPES,
} from "@armyofagents/shared";

describe("Threads constants", () => {
  it("THREAD_PHASES are the four lifecycle phases in order", () => {
    expect(THREAD_PHASES).toEqual(["discuss", "scope", "assign", "done"]);
  });

  it("THREAD_VISIBILITIES = open|private", () => {
    expect(THREAD_VISIBILITIES).toEqual(["open", "private"]);
  });

  it("THREAD_ORIGIN_SOURCES cover human/agent/external/system", () => {
    expect(THREAD_ORIGIN_SOURCES).toEqual([
      "human",
      "agent",
      "external",
      "system",
    ]);
  });

  it("participant roles include owner and worker", () => {
    expect(THREAD_PARTICIPANT_ROLES).toContain("owner");
    expect(THREAD_PARTICIPANT_ROLES).toContain("co_owner");
    expect(THREAD_PARTICIPANT_ROLES).toContain("worker");
  });

  it("link kinds include spawned_from_task (for the later worker->thread write-back)", () => {
    expect(THREAD_LINK_KINDS).toContain("spawned_from_task");
  });

  it("inbox statuses cover the triage lifecycle", () => {
    expect(THREAD_INBOX_STATUSES).toEqual(["pending", "attached", "dismissed"]);
  });

  it("entry input types are widened for thread origins", () => {
    for (const t of [
      "transcript",
      "document",
      "routine",
      "webhook",
      "integration",
      "agent",
    ]) {
      expect(DISCUSSION_ENTRY_INPUT_TYPES).toContain(t);
    }
    // backward-compat values preserved
    expect(DISCUSSION_ENTRY_INPUT_TYPES).toContain("paste");
    expect(DISCUSSION_ENTRY_INPUT_TYPES).toContain("voice");
  });

  it("extracted item types include artifact + spin_off_thread", () => {
    expect(EXTRACTION_ITEM_TYPES).toContain("artifact");
    expect(EXTRACTION_ITEM_TYPES).toContain("spin_off_thread");
    // existing values preserved
    expect(EXTRACTION_ITEM_TYPES).toContain("decision");
    expect(EXTRACTION_ITEM_TYPES).toContain("task");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/threads-constants.test.ts`
Expected: FAIL — import errors / `undefined` for `THREAD_PHASES` etc. (the constants don't exist yet), and `DISCUSSION_ENTRY_INPUT_TYPES`/`EXTRACTION_ITEM_TYPES` assertions fail (not yet widened).

- [ ] **Step 3: Extend the two existing arrays**

In `packages/shared/src/constants.ts`, find the V2.5 Discussions block and replace these two lines:

```ts
export const DISCUSSION_ENTRY_INPUT_TYPES = ["paste", "write", "voice", "mcp"] as const;
```
with:
```ts
export const DISCUSSION_ENTRY_INPUT_TYPES = ["paste", "write", "voice", "mcp", "transcript", "document", "routine", "webhook", "integration", "agent"] as const;
```

and replace:
```ts
export const EXTRACTION_ITEM_TYPES = ["decision", "task", "insight", "context", "reference", "preference"] as const;
```
with:
```ts
export const EXTRACTION_ITEM_TYPES = ["decision", "task", "insight", "context", "reference", "preference", "artifact", "spin_off_thread"] as const;
```

- [ ] **Step 4: Add the new Threads const arrays**

In `packages/shared/src/constants.ts`, immediately AFTER the `EXTRACTION_ITEM_STATUSES` block (end of the V2.5 Discussions section), add:

```ts
// ── V2.5: Threads (extends Discussions) ───────────────────────────────

export const THREAD_ORIGIN_SOURCES = ["human", "agent", "external", "system"] as const;
export type ThreadOriginSource = (typeof THREAD_ORIGIN_SOURCES)[number];

export const THREAD_ORIGIN_MEDIA = ["text", "voice", "transcription", "file", "api", "scheduled", "integration"] as const;
export type ThreadOriginMedium = (typeof THREAD_ORIGIN_MEDIA)[number];

export const THREAD_INTENTS = ["planning", "review", "decision", "research", "problem", "alignment", "feedback", "retrospective"] as const;
export type ThreadIntent = (typeof THREAD_INTENTS)[number];

export const THREAD_PHASES = ["discuss", "scope", "assign", "done"] as const;
export type ThreadPhase = (typeof THREAD_PHASES)[number];

export const THREAD_VISIBILITIES = ["open", "private"] as const;
export type ThreadVisibility = (typeof THREAD_VISIBILITIES)[number];

export const THREAD_SUBTYPES = ["normal", "live"] as const;
export type ThreadSubtype = (typeof THREAD_SUBTYPES)[number];

export const THREAD_PARTICIPANT_PRINCIPAL_TYPES = ["user", "agent"] as const;
export type ThreadParticipantPrincipalType = (typeof THREAD_PARTICIPANT_PRINCIPAL_TYPES)[number];

export const THREAD_PARTICIPANT_ROLES = ["owner", "co_owner", "collaborator", "viewer", "worker"] as const;
export type ThreadParticipantRole = (typeof THREAD_PARTICIPANT_ROLES)[number];

export const THREAD_LINK_KINDS = ["link", "spinoff", "fork", "merge", "goal_cluster", "spawned_from_task"] as const;
export type ThreadLinkKind = (typeof THREAD_LINK_KINDS)[number];

export const THREAD_ROUTER_DECISIONS = ["auto_attach", "suggest", "human"] as const;
export type ThreadRouterDecision = (typeof THREAD_ROUTER_DECISIONS)[number];

export const THREAD_INBOX_STATUSES = ["pending", "attached", "dismissed"] as const;
export type ThreadInboxStatus = (typeof THREAD_INBOX_STATUSES)[number];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run server/src/__tests__/threads-constants.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/constants.ts server/src/__tests__/threads-constants.test.ts
git commit -m "feat(threads): add thread constants + widen entry/item enums"
```

---

## Task 2: ALTER `discussions` — thread-container columns

**Files:**
- Modify: `packages/db/src/schema/discussions.ts`
- Test: `server/src/__tests__/threads-schema-contract.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/threads-schema-contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { discussions } from "@armyofagents/db";

// Helper: get Drizzle column names from a table object.
function getColumnNames(table: Record<string, unknown>): string[] {
  return Object.keys(table).filter(
    (key) =>
      typeof table[key] === "object" &&
      table[key] !== null &&
      "name" in (table[key] as Record<string, unknown>),
  );
}

describe("discussions table — thread-container columns", () => {
  const cols = getColumnNames(discussions);

  it("has the thread origin/intent/phase columns", () => {
    for (const c of ["originSource", "originMedium", "intent", "phase"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("has goal-as-property + visibility + owner", () => {
    for (const c of ["goalId", "visibility", "ownerUserId"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("has autonomy + subtype + fork/merge lineage", () => {
    for (const c of ["autonomyLevel", "subtype", "forkedFromId", "mergedIntoId"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("has the Scribe summary fields", () => {
    for (const c of ["summaryText", "summaryNext", "summaryUpdatedAt"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("preserves existing discussion columns", () => {
    for (const c of ["id", "companyId", "title", "status", "scopeType", "tags"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/threads-schema-contract.test.ts`
Expected: FAIL — `missing column: originSource` (and the other new columns).

- [ ] **Step 3: Add the self-reference import**

In `packages/db/src/schema/discussions.ts`, update the `drizzle-orm/pg-core` import to add `type AnyPgColumn` as the first member (needed for the `forkedFromId` / `mergedIntoId` self-references):

```ts
import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
```

(The `agents` table import is added in Task 3, at its first use — adding it here would be an unused import until then.)

- [ ] **Step 4: Add the thread-container columns**

In the `discussions` pgTable column object, immediately AFTER this line:

```ts
    tags: jsonb("tags").default([]), // string array for flexible categorization
```

insert:

```ts
    // ── Threads v1: thread-container fields ──
    originSource: text("origin_source"), // ThreadOriginSource: human|agent|external|system
    originMedium: text("origin_medium"), // ThreadOriginMedium
    intent: jsonb("intent").default([]), // ThreadIntent[] (multi-tag)
    phase: text("phase").notNull().default("discuss"), // ThreadPhase: discuss|scope|assign|done
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }), // goal-as-property
    visibility: text("visibility").notNull().default("open"), // ThreadVisibility: open|private
    ownerUserId: text("owner_user_id"), // accountable human (TEXT like issues.assigneeUserId); null = Unclaimed
    autonomyLevel: integer("autonomy_level"), // 1..3; null = fall back to internal_agent_config
    subtype: text("subtype").notNull().default("normal"), // ThreadSubtype: normal|live
    forkedFromId: uuid("forked_from_id").references((): AnyPgColumn => discussions.id, { onDelete: "set null" }),
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => discussions.id, { onDelete: "set null" }),
    summaryText: text("summary_text"),
    summaryNext: text("summary_next"),
    summaryUpdatedAt: timestamp("summary_updated_at", { withTimezone: true }),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run server/src/__tests__/threads-schema-contract.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/discussions.ts server/src/__tests__/threads-schema-contract.test.ts
git commit -m "feat(threads): add thread-container columns to discussions"
```

---

## Task 3: ALTER `discussion_entries` — nested replies + agent author

**Files:**
- Modify: `packages/db/src/schema/discussions.ts`
- Test: `server/src/__tests__/threads-schema-contract.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `server/src/__tests__/threads-schema-contract.test.ts` (add the import at top and a new describe block). Change the existing import line:

```ts
import { discussions } from "@armyofagents/db";
```
to:
```ts
import { discussions, discussionEntries } from "@armyofagents/db";
```

Then add:

```ts
describe("discussion_entries table — thread additions", () => {
  const cols = getColumnNames(discussionEntries);

  it("has nested-reply parent + agent author", () => {
    expect(cols).toContain("parentEntryId");
    expect(cols).toContain("authorAgentId");
  });

  it("preserves existing entry columns", () => {
    for (const c of ["id", "discussionId", "inputType", "rawContent", "extractionStatus"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/threads-schema-contract.test.ts`
Expected: FAIL — `expected [...] to contain 'parentEntryId'`.

- [ ] **Step 3: Add the `agents` import + the columns**

First, add the `agents` table import to `packages/db/src/schema/discussions.ts` (after the `goals` import) — used by `authorAgentId` here and by `assigneeAgentId` in Task 4:

```ts
import { agents } from "./agents.js";
```

Then, in the `discussionEntries` pgTable column object, immediately AFTER this block:

```ts
    extractionRunId: uuid("extraction_run_id").references(
      () => internalAgentRuns.id,
      { onDelete: "set null" },
    ),
```

insert:

```ts
    // ── Threads v1: nested replies + agent authorship ──
    parentEntryId: uuid("parent_entry_id").references((): AnyPgColumn => discussionEntries.id, { onDelete: "set null" }),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run server/src/__tests__/threads-schema-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/discussions.ts server/src/__tests__/threads-schema-contract.test.ts
git commit -m "feat(threads): add nested-reply + agent-author columns to discussion_entries"
```

---

## Task 4: ALTER `discussion_extracted_items` — committed routing

**Files:**
- Modify: `packages/db/src/schema/discussions.ts`
- Test: `server/src/__tests__/threads-schema-contract.test.ts` (append)

- [ ] **Step 1: Write the failing test**

In `server/src/__tests__/threads-schema-contract.test.ts`, extend the import:

```ts
import { discussions, discussionEntries, discussionExtractedItems } from "@armyofagents/db";
```

Then add:

```ts
describe("discussion_extracted_items table — committed routing", () => {
  const cols = getColumnNames(discussionExtractedItems);

  it("has committed agent|human assignee + department", () => {
    expect(cols).toContain("assigneeAgentId");
    expect(cols).toContain("assigneeUserId");
    expect(cols).toContain("departmentId");
  });

  it("preserves the suggested* fields + result links", () => {
    for (const c of ["suggestedDepartmentId", "suggestedAssigneeId", "resultTaskId", "resultMemoryId", "conflictsWith"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/threads-schema-contract.test.ts`
Expected: FAIL — `expected [...] to contain 'assigneeAgentId'`.

- [ ] **Step 3: Add the committed-routing columns**

In `packages/db/src/schema/discussions.ts`, in the `discussionExtractedItems` pgTable column object, immediately AFTER this line:

```ts
    conflictsWith: jsonb("conflicts_with"), // array of { entityType, entityId, description }
```

insert:

```ts
    // ── Threads v1: committed per-item routing (agent|human discriminator) ──
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
    assigneeUserId: text("assignee_user_id"), // TEXT (mirrors issues.assigneeUserId; no FK)
    departmentId: uuid("department_id").references(() => projects.id, { onDelete: "set null" }),
```

- [ ] **Step 4: Fix the stale priority comment**

Still in `discussionExtractedItems`, replace this line:

```ts
    suggestedPriority: text("suggested_priority"), // 'urgent' | 'high' | 'medium' | 'low'
```
with:
```ts
    suggestedPriority: text("suggested_priority"), // IssuePriority: 'critical' | 'high' | 'medium' | 'low'
```

And update the `type` comment to include the new item types — replace:

```ts
    type: text("type").notNull(),
    // 'decision' | 'task' | 'insight' | 'context' | 'reference' | 'preference'
```
with:
```ts
    type: text("type").notNull(),
    // ExtractionItemType: decision|task|insight|context|reference|preference|artifact|spin_off_thread
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run server/src/__tests__/threads-schema-contract.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/discussions.ts server/src/__tests__/threads-schema-contract.test.ts
git commit -m "feat(threads): add committed routing to discussion_extracted_items; fix priority comment"
```

---

## Task 5: ALTER `projects` — per-department default visibility

**Files:**
- Modify: `packages/db/src/schema/projects.ts`
- Test: `server/src/__tests__/threads-schema-contract.test.ts` (append)

- [ ] **Step 1: Write the failing test**

In `server/src/__tests__/threads-schema-contract.test.ts`, extend the import:

```ts
import { discussions, discussionEntries, discussionExtractedItems, projects } from "@armyofagents/db";
```

Then add:

```ts
describe("projects table — per-department thread visibility default", () => {
  const cols = getColumnNames(projects);

  it("has defaultThreadVisibility", () => {
    expect(cols).toContain("defaultThreadVisibility");
  });

  it("preserves the department/project type discriminator", () => {
    expect(cols).toContain("type");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/threads-schema-contract.test.ts`
Expected: FAIL — `expected [...] to contain 'defaultThreadVisibility'`.

- [ ] **Step 3: Add the column**

In `packages/db/src/schema/projects.ts`, in the `projects` pgTable column object, immediately AFTER this line:

```ts
    functionType: text("function_type").default("general"),
```

insert:

```ts
    defaultThreadVisibility: text("default_thread_visibility").notNull().default("open"), // ThreadVisibility: per-dept default for new threads (HR/Finance/Exec -> private)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run server/src/__tests__/threads-schema-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/projects.ts server/src/__tests__/threads-schema-contract.test.ts
git commit -m "feat(threads): add per-department default thread visibility to projects"
```

---

## Task 6: New `threads.ts` — six tables

**Files:**
- Create: `packages/db/src/schema/threads.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `server/src/__tests__/threads-schema-contract.test.ts` (append)

> Note: no `relations()` in this file for v1 (YAGNI — no query needs them yet; add when Plan 2/6 services require eager joins). `thread_channel_bindings` is intentionally deferred to the v1.1 Live-integrations plan.

- [ ] **Step 1: Write the failing test**

In `server/src/__tests__/threads-schema-contract.test.ts`, extend the import to add the six new tables:

```ts
import {
  discussions,
  discussionEntries,
  discussionExtractedItems,
  projects,
  threadParticipants,
  threadLinks,
  scopeItemDependencies,
  threadPlanSteps,
  threadInboxItems,
  discussionEntryAttachments,
} from "@armyofagents/db";
```

Then add:

```ts
describe("threads.ts — new tables", () => {
  it("thread_participants has principal + role", () => {
    const cols = getColumnNames(threadParticipants);
    for (const c of ["id", "companyId", "threadId", "principalType", "principalId", "role", "addedAt"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("thread_links has from/to + kind", () => {
    const cols = getColumnNames(threadLinks);
    for (const c of ["id", "companyId", "fromThreadId", "toThreadId", "kind", "createdBy"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("scope_item_dependencies has blocker/blocked", () => {
    const cols = getColumnNames(scopeItemDependencies);
    for (const c of ["id", "blockerItemId", "blockedItemId"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("thread_plan_steps has ordering + linked item", () => {
    const cols = getColumnNames(threadPlanSteps);
    for (const c of ["id", "threadId", "stepOrder", "title", "collapsed", "linkedItemId"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("thread_inbox_items has router fields + status", () => {
    const cols = getColumnNames(threadInboxItems);
    for (const c of ["id", "companyId", "rawContent", "routerConfidence", "routerDecision", "suggestedThreadId", "status"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("discussion_entry_attachments links assets/artifacts to entries", () => {
    const cols = getColumnNames(discussionEntryAttachments);
    for (const c of ["id", "discussionEntryId", "assetId", "artifactId"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/threads-schema-contract.test.ts`
Expected: FAIL — import resolves `threadParticipants` etc. to `undefined`, so `getColumnNames(undefined)` throws `TypeError: Cannot convert undefined or null to object` (the new tables don't exist / aren't exported yet).

- [ ] **Step 3: Create the schema file**

Create `packages/db/src/schema/threads.ts`:

```ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { assets } from "./assets.js";
import { artifacts } from "./artifacts.js";
import {
  discussions,
  discussionEntries,
  discussionExtractedItems,
} from "./discussions.js";

// ── thread_participants: who's on a thread (humans + agents) ──
export const threadParticipants = pgTable(
  "thread_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull().references(() => discussions.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(), // ThreadParticipantPrincipalType: user|agent
    principalId: text("principal_id").notNull(), // user id (text) OR agent id (uuid stored as text)
    role: text("role").notNull(), // ThreadParticipantRole: owner|co_owner|collaborator|viewer|worker
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadIdx: index("thread_participants_thread_idx").on(table.threadId),
    principalIdx: index("thread_participants_principal_idx").on(table.principalType, table.principalId),
    companyIdx: index("thread_participants_company_idx").on(table.companyId),
  }),
);

// ── thread_links: typed relationships between threads ──
export const threadLinks = pgTable(
  "thread_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    fromThreadId: uuid("from_thread_id").notNull().references(() => discussions.id, { onDelete: "cascade" }),
    toThreadId: uuid("to_thread_id").notNull().references(() => discussions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // ThreadLinkKind: link|spinoff|fork|merge|goal_cluster|spawned_from_task
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fromIdx: index("thread_links_from_idx").on(table.fromThreadId),
    toIdx: index("thread_links_to_idx").on(table.toThreadId),
  }),
);

// ── scope_item_dependencies: pre-task -> pre-task blocking (before tasks exist) ──
export const scopeItemDependencies = pgTable(
  "scope_item_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerItemId: uuid("blocker_item_id").notNull().references(() => discussionExtractedItems.id, { onDelete: "cascade" }),
    blockedItemId: uuid("blocked_item_id").notNull().references(() => discussionExtractedItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    blockerIdx: index("scope_item_dependencies_blocker_idx").on(table.blockerItemId),
    blockedIdx: index("scope_item_dependencies_blocked_idx").on(table.blockedItemId),
  }),
);

// ── thread_plan_steps: the live ordered Plan in the Scope tab ──
export const threadPlanSteps = pgTable(
  "thread_plan_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id").notNull().references(() => discussions.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull().default(0), // "order" is a SQL reserved word -> step_order
    title: text("title").notNull(),
    collapsed: boolean("collapsed").notNull().default(false),
    linkedItemId: uuid("linked_item_id").references(() => discussionExtractedItems.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadIdx: index("thread_plan_steps_thread_idx").on(table.threadId),
  }),
);

// ── thread_inbox_items: the Unlisted queue (un-routed inbound) ──
export const threadInboxItems = pgTable(
  "thread_inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    rawContent: text("raw_content").notNull(),
    originSource: text("origin_source"), // ThreadOriginSource
    originMedium: text("origin_medium"), // ThreadOriginMedium
    routerConfidence: doublePrecision("router_confidence"), // 0..1 internal score (never shown raw)
    routerDecision: text("router_decision"), // ThreadRouterDecision: auto_attach|suggest|human
    suggestedThreadId: uuid("suggested_thread_id").references(() => discussions.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"), // ThreadInboxStatus: pending|attached|dismissed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("thread_inbox_items_company_status_idx").on(table.companyId, table.status),
  }),
);

// ── discussion_entry_attachments: link assets/artifacts to entries ──
export const discussionEntryAttachments = pgTable(
  "discussion_entry_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    discussionEntryId: uuid("discussion_entry_id").notNull().references(() => discussionEntries.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    artifactId: uuid("artifact_id").references(() => artifacts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entryIdx: index("discussion_entry_attachments_entry_idx").on(table.discussionEntryId),
  }),
);
```

> Before saving, confirm the import filenames exist: `ls packages/db/src/schema/assets.ts packages/db/src/schema/artifacts.ts packages/db/src/schema/companies.ts`. If `assets`/`artifacts` live in a differently-named file, fix the import path.

- [ ] **Step 4: Register the new tables in the barrel**

In `packages/db/src/schema/index.ts`, AFTER the existing discussions export block:

```ts
export {
  discussions,
  discussionEntries,
  discussionExtractedItems,
  discussionAnnotations,
} from "./discussions.js";
```

add:

```ts
export {
  threadParticipants,
  threadLinks,
  scopeItemDependencies,
  threadPlanSteps,
  threadInboxItems,
  discussionEntryAttachments,
} from "./threads.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run server/src/__tests__/threads-schema-contract.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 6: Type-check the db package**

Run: `pnpm --filter @armyofagents/db typecheck`
Expected: no errors (this is what the migration generator will compile in Task 7; catching type errors here keeps Task 7 clean).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/threads.ts packages/db/src/schema/index.ts server/src/__tests__/threads-schema-contract.test.ts
git commit -m "feat(threads): add thread_participants/links/deps/plan_steps/inbox/entry_attachments tables"
```

---

## Task 7: Generate the migration

**Files:**
- Generated: `packages/db/src/migrations/0100_*.sql` (+ updated `packages/db/src/migrations/meta/`)

- [ ] **Step 1: Generate**

Run from the repo root: `pnpm db:generate`
(This runs `tsc -p tsconfig.json` to compile the schema to `dist/`, then `drizzle-kit generate`.)
Expected: a new migration file appears, e.g. `packages/db/src/migrations/0100_<random-name>.sql`, and drizzle prints something like `✓ Your SQL migration file ➜ src/migrations/0100_*.sql`.

- [ ] **Step 2: Verify the migration content**

Open the generated `0100_*.sql` and confirm it contains:
- `CREATE TABLE "thread_participants"`, `"thread_links"`, `"scope_item_dependencies"`, `"thread_plan_steps"`, `"thread_inbox_items"`, `"discussion_entry_attachments"` (six new tables).
- `ALTER TABLE "discussions" ADD COLUMN "phase"` (and the other thread-container columns).
- `ALTER TABLE "discussion_entries" ADD COLUMN "parent_entry_id"` and `"author_agent_id"`.
- `ALTER TABLE "discussion_extracted_items" ADD COLUMN "assignee_agent_id"`, `"assignee_user_id"`, `"department_id"`.
- `ALTER TABLE "projects" ADD COLUMN "default_thread_visibility"`.

Use Grep on the file, e.g.: search `thread_participants` and `default_thread_visibility` in `packages/db/src/migrations/0100_*.sql` — both must appear.

If a table or column is missing: it means the schema didn't compile or a column wasn't saved — re-check Tasks 2-6, fix, delete the partial `0100_*.sql` + its `meta` snapshot entry, and re-run `pnpm db:generate`.

- [ ] **Step 3: Confirm no unrelated drift**

Confirm the migration ONLY adds the Threads changes (no accidental drops/renames of existing columns). If drizzle emits unexpected `DROP`/`RENAME` statements, stop and investigate (likely an unintended schema edit).

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/migrations/
git commit -m "feat(threads): generate migration 0100 for thread data model"
```

---

## Done criteria (Plan 1)

- `pnpm exec vitest run server/src/__tests__/threads-constants.test.ts` — PASS.
- `pnpm exec vitest run server/src/__tests__/threads-schema-contract.test.ts` — PASS.
- `pnpm --filter @armyofagents/db typecheck` — no errors.
- `pnpm db:generate` produced one `0100_*` migration containing all six new tables + the four ALTERs.
- All changes committed.

Hand-off: Plan 2 (Thread Service & Lifecycle) builds on these tables.

---

## Eng-Review Amendments (2026-05-24)

Apply these to the tasks above before/while implementing.

**A1 — Unique constraint on `thread_participants` (prevents duplicate owner rows).** In Task 6, import `uniqueIndex` from `drizzle-orm/pg-core` and add to the `threadParticipants` index block:

```ts
    uniqParticipant: uniqueIndex("thread_participants_unique").on(
      table.threadId, table.principalType, table.principalId,
    ),
```

Without this, `claim`/`addParticipant` (Plan 2) can insert the same owner repeatedly. (Plan 2 then upserts via `.onConflictDoNothing()` against this index.)

**A2 — `entry_seq` counter column for Plan 7's atomic ordering (D1).** Add to `discussions` (Task 2 column block):

```ts
    entrySeq: integer("entry_seq").notNull().default(0), // atomic per-thread entry counter (Plan 7 seq assignment)
```

Adding it here keeps it in migration `0100` so Plan 7 needs no second discussions migration.

**A3 — Data backfill for `owner_user_id` (migration safety).** Generated migrations are schema-only. Existing `discussions` rows would all become "Unclaimed" on upgrade. Add a one-time backfill that runs via Drizzle in a backfill script (do NOT hand-author a numbered SQL migration — Drizzle-only rule). In `packages/db/src/migrate.ts` (or a `packages/db/src/backfills/` script invoked once):

```ts
// One-time: pre-Threads discussions were human-created -> owner = creator.
await db.execute(sql`UPDATE discussions SET owner_user_id = created_by WHERE owner_user_id IS NULL`);
```

Run after the `0100` migration applies. Idempotent (only fills NULLs).

---

## Codex Outside-Voice Amendments (2026-05-24)

**#3 — Backfill must cover `origin`, not just owner.** `phase`/`visibility`/`subtype` get column defaults (discuss/open/normal) on existing rows, but `origin_source`/`origin_medium` are nullable with no default, so existing discussions render as threads with null origin. Extend the A3 backfill script:

```ts
await db.execute(sql`UPDATE discussions SET origin_source = 'human', origin_medium = 'text' WHERE origin_source IS NULL`);
```

Optional heuristic (SPEC §8): set `phase = 'scope'` for discussions that already have approved extracted items, else leave `discuss`. Run in the same one-time backfill as the owner fill.
