# W1a — Hub Data Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the trustworthy `hub_items` control-plane index (data + RBAC + audit core) that the merged Inbox/Approvals hub reads from — emit, query, action, and reconcile — with no UI yet.

**Architecture:** Evolve the existing `notifications` table into the single unified attention index (the "one store" decision, §18). Add two sibling tables: `hub_item_user_state` (sparse, per-principal read/snooze/dismiss) and `hub_audit` (append-only decision record). A new `hubItems` service owns idempotent same-transaction emit (upsert on a `source_unique_key`), RBAC-filtered query with redacted denormalized summaries, optimistic-concurrency actions that write an immutable audit row before any side-effect, and a reconciliation sweeper that treats sources as truth. RBAC + audit are baked into the data model and emit path from day 1.

**Tech Stack:** PostgreSQL + Drizzle ORM (`packages/db`), Express 5 (`server/src`), shared Zod contracts (`packages/shared`), Vitest (unit + embedded-postgres real-DB integration). Mirror the `goals.ts` schema/service/route trio and the `agents.ts` optimistic-concurrency idiom.

---

## Scope

**In scope (W1a):** shared type contract; schema evolution + 2 new tables + migration & backfill; emit / query / action / sweeper service; REST routes (list, get, action, per-user state, counters); RBAC + redaction + audit; migrate the 4 existing notification emit sites onto the new emit path; full unit + real-DB integration + contract tests.

**Out of scope (later sub-phases):** the 3-pane UI / lanes / viewer (W1b); lifecycle UI like snooze-return animation and undo timers (W1c); grouping/search/settings/mobile (W1d); realtime push and the toast↔hub bridge (W2 Layer 3); autonomy/Autopilot (W3); the Steward crew agent (W4); runtime-decision routing (W5 — W1a only **reserves** the `agent_runtime_decision` semantic type, it does not build the bridge).

## Key decisions (locked here; flag at review if you disagree)

1. **Evolve, don't rename.** `export const hubItems = pgTable("notifications", {…extended})`. The physical SQL table stays `notifications` (no `ALTER TABLE RENAME`, no FK churn, no emit-site breakage); the TS/code name becomes `hubItems`. Keep `export const notifications = hubItems` as a deprecated alias so untouched call sites compile. Physical rename + a `notifications` view are a trivial cosmetic follow-up, intentionally deferred.
2. **Seat-keyed per-user state.** `hub_item_user_state` keys on `(principal_type, principal_id)`, NOT `auth_users.id` — consistent with W6 (`local-board` and synthetic principals work). `principal_type` is `'user'` today (reserved for future kinds).
3. **Sparse user-state.** Write a `hub_item_user_state` row only when a user diverges from the default (read/snooze/dismiss). Never pre-fan-out per user×item (avoids the M×N explosion, §18 scalability).
4. **Redact-before-persist.** The denormalized `summary` is sanitized with `server/src/redaction.ts` at emit time, before it ever hits the row. RBAC is enforced at emit + query + action, not just render.
5. **Audit before side-effect.** `recordAndAct()` writes the immutable `hub_audit` row inside the same transaction as the state transition, before the source-API side-effect — manual actions too, not just Autopilot.
6. **Concurrency = conditional UPDATE → 409.** Actions carry the item's `version`; the guarded UPDATE only matches the expected version and bumps it; a no-match re-reads to return 409 (stale) vs 404 (gone) — the `agents.ts` idiom, not a generic ORM version column.

## File structure

- Create: `packages/shared/src/hub.ts` — shared contract (semantic types, lanes, statuses, action contract, envelope).
- Modify: `packages/shared/src/index.ts` — re-export `./hub.js`.
- Modify: `packages/db/src/schema/notifications.ts` — add hub columns; export `hubItems`; keep `notifications` alias.
- Create: `packages/db/src/schema/hub_item_user_state.ts`
- Create: `packages/db/src/schema/hub_audit.ts`
- Modify: `packages/db/src/schema/index.ts` — export the two new schema files.
- Generated: `packages/db/dist/migrations/<n>_*.sql` via `pnpm db:generate`, then hand-append the data backfill (statement-breakpoint separated).
- Create: `packages/shared/src/validators/hub.ts` — Zod request schemas.
- Create: `server/src/services/hub-items.ts` — emit / query / action / sweeper / counters.
- Create: `server/src/routes/hub-items.ts` — REST routes.
- Modify: `server/src/index.ts` (or the route registrar) — mount `hubItemRoutes`.
- Modify (Task 10): `server/src/services/threads.ts`, `server/src/services/internal-agent/proactive.ts`, `server/src/services/marketplace-notifications.ts`, `server/src/services/internal-agent/tools/notify-owner-tool.ts` — emit via `hubItems.emit`.
- Tests: `server/src/__tests__/hub-items-*.{test,integration.test}.ts`, `packages/shared/src/__tests__/hub-contract.test.ts`.

---

## Task 0: Shared item/notification type contract

**Why first:** §18 — "Lock a shared item/notification type contract before W1 and W2-L2 run in parallel (else churn)." Both the hub and the notifications Layer-2 registry consume these definitions.

**Files:**
- Create: `packages/shared/src/hub.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/hub-contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
// packages/shared/src/__tests__/hub-contract.test.ts
import { describe, it, expect } from "vitest";
import {
  HUB_LANES,
  HUB_ITEM_STATUSES,
  HUB_SEMANTIC_TYPES,
  HUB_SEMANTIC_TO_LANE,
  laneForSemanticType,
} from "../hub.js";

describe("hub contract", () => {
  it("every semantic type maps to exactly one valid lane", () => {
    for (const t of HUB_SEMANTIC_TYPES) {
      const lane = HUB_SEMANTIC_TO_LANE[t];
      expect(HUB_LANES, `${t} -> ${lane}`).toContain(lane);
      expect(laneForSemanticType(t)).toBe(lane);
    }
  });
  it("reserves the W5 runtime-decision type without a UI bridge yet", () => {
    expect(HUB_SEMANTIC_TYPES).toContain("agent_runtime_decision");
    expect(HUB_SEMANTIC_TO_LANE.agent_runtime_decision).toBe("waiting_on_you");
  });
  it("statuses are the three terminal-distinct lifecycle states + open", () => {
    expect(HUB_ITEM_STATUSES).toEqual(["open", "snoozed", "resolved", "archived"]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @armyofagents/shared exec vitest run src/__tests__/hub-contract.test.ts`
Expected: FAIL — `Cannot find module ../hub.js`.

- [ ] **Step 3: Write `packages/shared/src/hub.ts`**

```ts
// packages/shared/src/hub.ts
// Shared contract for the unified hub index. Consumed by the hub service,
// the (future) notifications Layer-2 registry, and the UI registry (W1b).

export const HUB_LANES = ["waiting_on_you", "notifications", "suggestions"] as const;
export type HubLane = (typeof HUB_LANES)[number];

export const HUB_ITEM_STATUSES = ["open", "snoozed", "resolved", "archived"] as const;
export type HubItemStatus = (typeof HUB_ITEM_STATUSES)[number];

export const HUB_ITEM_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type HubItemPriority = (typeof HUB_ITEM_PRIORITIES)[number];

// Semantic type = WHAT the item is, independent of its source table. Adding a
// type = one entry here + one registry entry (W1b). The W5 runtime-decision type
// is RESERVED (no adapter bridge yet — see master scope §10).
export const HUB_SEMANTIC_TYPES = [
  // waiting_on_you
  "approval_request",
  "discussion_pending",
  "join_request",
  "agent_runtime_decision", // reserved (W5)
  // notifications
  "run_failed",
  "budget_alert",
  "agent_error",
  "mention",
  "marketplace_op",
  "run_complete",
  // suggestions
  "suggestion",
  "stale_work",
] as const;
export type HubSemanticType = (typeof HUB_SEMANTIC_TYPES)[number];

export const HUB_SEMANTIC_TO_LANE: Record<HubSemanticType, HubLane> = {
  approval_request: "waiting_on_you",
  discussion_pending: "waiting_on_you",
  join_request: "waiting_on_you",
  agent_runtime_decision: "waiting_on_you",
  run_failed: "notifications",
  budget_alert: "notifications",
  agent_error: "notifications",
  mention: "notifications",
  marketplace_op: "notifications",
  run_complete: "notifications",
  suggestion: "suggestions",
  stale_work: "suggestions",
};

export function laneForSemanticType(t: HubSemanticType): HubLane {
  return HUB_SEMANTIC_TO_LANE[t];
}

// Owner pool sentinel for authority-gated items with no single natural owner.
export const HUB_OWNER_POOLS = ["board"] as const;
export type HubOwnerPool = (typeof HUB_OWNER_POOLS)[number];

// The action contract every action request carries (optimistic concurrency).
export interface HubActionEnvelope {
  action: string; // e.g. "approve" | "reject" | "retry" | "dismiss"
  expectedVersion: number; // hub_items.version the client last saw → 409 on mismatch
  idempotencyKey?: string;
  reason?: string;
}
```

- [ ] **Step 4: Re-export from the shared barrel**

In `packages/shared/src/index.ts` add (alongside the other re-exports):

```ts
export * from "./hub.js";
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --filter @armyofagents/shared exec vitest run src/__tests__/hub-contract.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/hub.ts packages/shared/src/index.ts packages/shared/src/__tests__/hub-contract.test.ts
git commit -m "feat(hub): shared item/notification type contract (W1a Task 0)"
```

---

## Task 1: Evolve `notifications` → `hubItems` schema

**Files:**
- Modify: `packages/db/src/schema/notifications.ts`
- Test: covered by the migration + integration tests (Tasks 4, 5+). Add a fast field-presence unit test below.

- [ ] **Step 1: Add the hub columns + indexes to the existing table**

Edit `packages/db/src/schema/notifications.ts`. Keep ALL existing columns (id, companyId, userId, type, title, message, relatedEntityType, relatedEntityId, readAt, dismissedAt, deliveryAttempts, deliveredAt, deliveryError, createdAt). Add the hub columns and rename the export. Mirror the existing import/index style in the file.

```ts
// add these columns inside the existing pgTable("notifications", { ... }) body:
  // ── Hub control-plane columns (W1a) ──
  semanticType: text("semantic_type"),                 // HubSemanticType; null on legacy rows until backfilled
  status: text("status").notNull().default("open"),    // HubItemStatus
  priority: text("priority").notNull().default("normal"),
  groupKey: text("group_key"),
  slaAt: timestamp("sla_at", { withTimezone: true }),
  sourceType: text("source_type"),                     // e.g. "approval" | "heartbeat_run" | "discussion"
  sourceId: text("source_id"),
  scopeKey: text("scope_key"),                         // department/project/goal scope for RBAC + dedupe
  sourceUniqueKey: text("source_unique_key"),          // company+sourceType+sourceId+semanticType+scopeKey
  summary: text("summary"),                            // REDACTED denormalized body (redact-before-persist)
  sourcePermissionRevision: text("source_permission_revision"),
  ownerUserId: text("owner_user_id"),                  // nullable (pool-owned items)
  ownerPool: text("owner_pool"),                       // HubOwnerPool when no single owner
  version: integer("version").notNull().default(0),    // optimistic concurrency token
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
```

In the table's index callback, add:

```ts
    // Hot set = open items only; active-hub queries touch a small working set.
    hubOpenIdx: index("hub_items_open_idx")
      .on(table.companyId, table.semanticType, table.createdAt)
      .where(sql`${table.status} = 'open'`),
    hubOwnerOpenIdx: index("hub_items_owner_open_idx")
      .on(table.companyId, table.ownerUserId)
      .where(sql`${table.status} = 'open'`),
    hubSourceUniqueIdx: uniqueIndex("hub_items_source_unique_idx").on(table.sourceUniqueKey),
```

At the bottom of the file, rename the export and add the alias:

```ts
export const hubItems = notifications; // canonical hub name; same physical table
// `notifications` export stays for un-migrated call sites (deprecated).
```

Ensure `sql`, `index`, `uniqueIndex`, `integer` are imported (add to the existing drizzle-orm/pg-core import as needed). NOTE: `sourceUniqueKey` is nullable so the partial-unique only applies to backfilled/new rows; Postgres treats multiple NULLs as distinct, so legacy null rows don't collide.

- [ ] **Step 2: Add a field-presence unit test**

```ts
// packages/db/src/__tests__/hub-items-schema.test.ts
import { describe, it, expect } from "vitest";
import { hubItems, notifications } from "../schema/notifications.js";

describe("hubItems schema", () => {
  it("hubItems aliases the notifications table and exposes hub columns", () => {
    expect(hubItems).toBe(notifications);
    for (const col of ["semanticType","status","sourceUniqueKey","summary","version","ownerUserId"]) {
      expect(hubItems, col).toHaveProperty(col);
    }
  });
});
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter @armyofagents/db exec vitest run src/__tests__/hub-items-schema.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/notifications.ts packages/db/src/__tests__/hub-items-schema.test.ts
git commit -m "feat(hub): evolve notifications into the hubItems index (W1a Task 1)"
```

---

## Task 2: `hub_item_user_state` table (sparse, seat-keyed)

**Files:**
- Create: `packages/db/src/schema/hub_item_user_state.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema (mirror `goals.ts` + `inbox_dismissals` style)**

```ts
// packages/db/src/schema/hub_item_user_state.ts
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { notifications } from "./notifications.js"; // physical table; hubItems alias

// Sparse per-principal state. A row exists ONLY when a principal diverges from
// the default (read/snooze/dismiss) — never pre-fanned-out per user×item.
// Seat-keyed by (principalType, principalId) per W6 — NOT auth_users.id — so the
// synthetic local-board principal works in local_trusted.
export const hubItemUserState = pgTable(
  "hub_item_user_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    hubItemId: uuid("hub_item_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull().default("user"),
    principalId: text("principal_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    principalItemUq: uniqueIndex("hub_item_user_state_principal_item_uq").on(
      table.hubItemId, table.principalType, table.principalId,
    ),
    principalIdx: index("hub_item_user_state_principal_idx").on(
      table.companyId, table.principalType, table.principalId,
    ),
  }),
);
```

- [ ] **Step 2: Export it** — add `export * from "./hub_item_user_state.js";` to `packages/db/src/schema/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/hub_item_user_state.ts packages/db/src/schema/index.ts
git commit -m "feat(hub): hub_item_user_state table (sparse, seat-keyed) (W1a Task 2)"
```

---

## Task 3: `hub_audit` immutable decision record

**Files:**
- Create: `packages/db/src/schema/hub_audit.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema (canonical §18 audit shape)**

```ts
// packages/db/src/schema/hub_audit.ts
import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { notifications } from "./notifications.js";

// Append-only. One row per hub action (manual OR autonomous) written BEFORE the
// source-API side-effect, in the same transaction as the state transition.
export const hubAudit = pgTable(
  "hub_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    hubItemId: uuid("hub_item_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),      // "user" | "agent" | "autonomy" | "system"
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    authorityBasis: text("authority_basis"),       // why the actor was allowed (role/grant)
    autonomyLevel: text("autonomy_level"),         // null for manual actions
    priorState: jsonb("prior_state"),              // {status, version, ...} before the transition
    sourceRevision: text("source_revision"),
    reason: text("reason"),
    undoDeadline: timestamp("undo_deadline", { withTimezone: true }),
    irreversibleSideEffects: jsonb("irreversible_side_effects"),
    relayResult: jsonb("relay_result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    itemIdx: index("hub_audit_item_idx").on(table.hubItemId, table.createdAt),
    companyIdx: index("hub_audit_company_idx").on(table.companyId, table.createdAt),
  }),
);
```

- [ ] **Step 2: Export it** — add `export * from "./hub_audit.js";` to `packages/db/src/schema/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/hub_audit.ts packages/db/src/schema/index.ts
git commit -m "feat(hub): hub_audit immutable decision record (W1a Task 3)"
```

---

## Task 4: Migration + data backfill

**Files:**
- Generated: `packages/db/dist/migrations/<n>_*.sql` + meta journal (via `pnpm db:generate`).

- [ ] **Step 1: Generate the migration**

Run: `pnpm db:generate`
Expected: a new migration adding the hub columns + 3 indexes on `notifications`, and `CREATE TABLE hub_item_user_state` + `hub_audit`. Review the SQL — it must be ADD COLUMN / CREATE TABLE / CREATE INDEX only (no destructive ops).

- [ ] **Step 2: Append the idempotent data backfill**

At the end of the generated SQL file, append (each step `--> statement-breakpoint` separated, mirroring `0149_fresh_warlock.sql`). Derive hub fields for existing notification rows so the sweeper/queries treat them uniformly:

```sql
--> statement-breakpoint
-- W1a backfill: map legacy notifications onto the hub model. Idempotent.
UPDATE "notifications" SET
  "status" = COALESCE("status", 'open'),
  "source_type" = COALESCE("source_type", 'notification'),
  "source_id" = COALESCE("source_id", "id"::text),
  "semantic_type" = COALESCE("semantic_type",
     CASE
       WHEN "type" LIKE 'marketplace.%' THEN 'marketplace_op'
       WHEN "type" LIKE 'thread.mention%' THEN 'mention'
       ELSE 'run_complete'
     END),
  "source_unique_key" = COALESCE("source_unique_key",
     "company_id"::text || ':notification:' || "id"::text)
WHERE "source_unique_key" IS NULL;
--> statement-breakpoint
-- Resolved legacy rows (already dismissed) leave the open hot set.
UPDATE "notifications" SET "status" = 'archived', "archived_at" = COALESCE("archived_at", "dismissed_at")
WHERE "dismissed_at" IS NOT NULL AND "status" = 'open';
```

- [ ] **Step 3: Verify migration applies cleanly (real DB)**

This is implicitly covered by Task 5's integration harness (`applyPendingMigrations`). Confirm the harness boots without error before writing service tests.

- [ ] **Step 4: Commit**

```bash
git add packages/db/dist/migrations
git commit -m "feat(hub): migration + idempotent backfill for the hub index (W1a Task 4)"
```

---

## Task 5: `hubItems.emit` — idempotent, same-transaction, redacted

**Files:**
- Create: `server/src/services/hub-items.ts`
- Test: `server/src/__tests__/hub-items-emit.integration.test.ts`

- [ ] **Step 1: Write the failing integration test (embedded-postgres, Linux-gated)**

Mirror the W6 harness exactly (`server/src/__tests__/w6-org-reporting.integration.test.ts`): `describe.skipIf(process.platform === "win32")`, embedded-postgres `beforeAll` calling `applyPendingMigrations`, `seedCompanyWithFounder()` helper that inserts `companies` **with a unique `issue_prefix`** (NOT NULL UNIQUE — W6 lesson) + a `"user"` row. Then:

```ts
it("emit upserts on source_unique_key (idempotent), redacts the summary, bumps a counter", async () => {
  if (setupError) throw new Error(String(setupError));
  const { companyId, founderId } = await seedCompanyWithFounder();
  const svc = hubItemsService(db);
  const args = {
    companyId, semanticType: "approval_request" as const,
    sourceType: "approval", sourceId: "appr-1", title: "Approve hire",
    summary: "token sk-ABC123SECRETVALUE in the payload", ownerUserId: founderId,
  };
  const a = await svc.emit(args);
  const b = await svc.emit(args); // same source → same row, not a duplicate
  expect(b.id).toBe(a.id);
  expect(a.summary).not.toContain("sk-ABC123SECRETVALUE"); // redact-before-persist
  const open = await db.execute(sql`SELECT count(*)::int AS n FROM notifications WHERE company_id = ${companyId} AND status = 'open'`);
  expect(firstRow(open).n).toBe(1);
});
```

- [ ] **Step 2: Run it to confirm it fails** — `pnpm -C server exec vitest run src/__tests__/hub-items-emit.integration.test.ts` → FAIL (no `hubItemsService`).

- [ ] **Step 3: Implement `hubItemsService(db).emit`**

```ts
// server/src/services/hub-items.ts
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { hubItems, hubItemUserState, hubAudit } from "@armyofagents/db";
import type { HubSemanticType, HubOwnerPool } from "@armyofagents/shared";
import { laneForSemanticType } from "@armyofagents/shared";
import { redactSecretsInString } from "../redaction.js";

export interface EmitArgs {
  companyId: string;
  semanticType: HubSemanticType;
  sourceType: string;
  sourceId: string;
  title: string;
  summary?: string | null;
  scopeKey?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  ownerUserId?: string | null;
  ownerPool?: HubOwnerPool | null;
  slaAt?: Date | null;
  sourcePermissionRevision?: string | null;
  tx?: Db; // emit in the SAME transaction as the source mutation (no silent drops)
}

export function hubItemsService(db: Db) {
  function sourceUniqueKey(a: EmitArgs): string {
    return [a.companyId, a.sourceType, a.sourceId, a.semanticType, a.scopeKey ?? ""].join(":");
  }

  async function emit(a: EmitArgs) {
    const conn = a.tx ?? db;
    const key = sourceUniqueKey(a);
    const safeSummary = a.summary == null ? null : redactSecretsInString(a.summary);
    const values = {
      companyId: a.companyId,
      userId: a.ownerUserId ?? "", // legacy NOT NULL column; owner is the canonical field
      type: a.semanticType,        // keep legacy `type` populated for back-compat reads
      title: a.title,
      semanticType: a.semanticType,
      sourceType: a.sourceType,
      sourceId: a.sourceId,
      scopeKey: a.scopeKey ?? null,
      sourceUniqueKey: key,
      summary: safeSummary,
      priority: a.priority ?? "normal",
      ownerUserId: a.ownerUserId ?? null,
      ownerPool: a.ownerPool ?? null,
      slaAt: a.slaAt ?? null,
      sourcePermissionRevision: a.sourcePermissionRevision ?? null,
      status: "open" as const,
    };
    // Idempotent upsert: a re-emit refreshes the denormalized summary/owner but
    // does NOT resurrect a resolved item or create a duplicate.
    const [row] = await conn
      .insert(hubItems)
      .values(values)
      .onConflictDoUpdate({
        target: hubItems.sourceUniqueKey,
        set: {
          title: values.title, summary: values.summary, priority: values.priority,
          ownerUserId: values.ownerUserId, ownerPool: values.ownerPool, slaAt: values.slaAt,
          sourcePermissionRevision: values.sourcePermissionRevision,
        },
      })
      .returning();
    return { ...row, lane: laneForSemanticType(a.semanticType) };
  }

  return { emit, sourceUniqueKey };
}
```

NOTE: `firstRow`/`firstId` helpers + the harness header come from the W6 integration test — copy them. `userId` stays populated (legacy NOT NULL) but ownership reads use `ownerUserId`.

- [ ] **Step 4: Run the test to confirm it passes** (Linux/CI; on Windows it skips). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/hub-items.ts server/src/__tests__/hub-items-emit.integration.test.ts
git commit -m "feat(hub): idempotent same-tx emit with redacted summaries (W1a Task 5)"
```

---

## Task 6: `hubItems.query` — RBAC-filtered, hot-set, per-user state

**Files:**
- Modify: `server/src/services/hub-items.ts`
- Test: `server/src/__tests__/hub-items-query.integration.test.ts`

- [ ] **Step 1: Failing test** — assert: (a) a team_member sees only items they own or are department-scoped to; founder sees all; (b) resolved/archived items are excluded from the default open query; (c) the per-principal `readAt/snoozedUntil/dismissedAt` is joined in; (d) cross-department leakage negative test (a member of dept A does NOT see a dept-B-scoped item).

```ts
it("query is RBAC-scoped: founder sees all, member sees only owned/in-scope; resolved excluded", async () => {
  if (setupError) throw new Error(String(setupError));
  const { companyId, founderId } = await seedCompanyWithFounder();
  const memberId = await seedMember(companyId, "team_member"); // helper: user + membership + user_roles
  const svc = hubItemsService(db);
  await svc.emit({ companyId, semanticType: "approval_request", sourceType: "approval", sourceId: "a1", title: "owned", ownerUserId: memberId });
  await svc.emit({ companyId, semanticType: "approval_request", sourceType: "approval", sourceId: "a2", title: "founder-only", ownerUserId: founderId });
  const asFounder = await svc.query(companyId, { actorUserId: founderId, role: "founder" });
  const asMember = await svc.query(companyId, { actorUserId: memberId, role: "team_member" });
  expect(asFounder.map((i) => i.title).sort()).toEqual(["founder-only", "owned"]);
  expect(asMember.map((i) => i.title)).toEqual(["owned"]);
});
```

- [ ] **Step 2: Run → FAIL** (no `query`).

- [ ] **Step 3: Implement `query`**

Mirror `permissionService`/`assertRole` semantics: founder → no owner/scope filter; team_lead → items owned by them OR scoped to a department they lead (via `permissionService.getTeamLeadDepartments`); team_member → items where `ownerUserId = actorUserId`. Always filter `status = 'open'` by default (hot set, uses `hub_items_open_idx`), `companyId` leading. Left-join `hub_item_user_state` on `(hubItemId, principalType='user', principalId=actorUserId)` to attach `readAt/snoozedUntil/dismissedAt`. Exclude rows the principal dismissed unless `opts.includeDismissed`. Return the redacted `summary` as-is (already redacted at emit). Add a `lane` filter option. Do NOT re-query the source here (viewer loads detail on demand — hybrid model §5).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(hub): RBAC-filtered hot-set query with per-user state (W1a Task 6)`.

---

## Task 7: `hubItems.recordAndAct` — concurrency + audit-before-side-effect

**Files:**
- Modify: `server/src/services/hub-items.ts`
- Test: `server/src/__tests__/hub-items-action.integration.test.ts`

- [ ] **Step 1: Failing test** — assert: (a) a stale `expectedVersion` → throws `conflict` (409) and does NOT transition; (b) a fresh version transitions `open→resolved`, bumps `version`, and writes exactly one `hub_audit` row whose `priorState.status='open'`; (c) the audit row is written BEFORE the side-effect callback runs (capture call order); (d) idempotency: replaying the same `idempotencyKey` is a no-op (no second audit row, no double side-effect).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `recordAndAct`**

```ts
async function recordAndAct(args: {
  companyId: string; hubItemId: string; action: string;
  expectedVersion: number; actorType: string; actorId: string;
  authorityBasis?: string; reason?: string; idempotencyKey?: string;
  nextStatus: "resolved" | "archived" | "snoozed";
  sideEffect?: (tx: Db) => Promise<{ irreversibleSideEffects?: unknown; relayResult?: unknown }>;
}) {
  return db.transaction(async (tx) => {
    const current = await tx.select().from(hubItems)
      .where(and(eq(hubItems.id, args.hubItemId), eq(hubItems.companyId, args.companyId)))
      .limit(1).then((r) => r[0]);
    if (!current) throw notFound("Hub item not found");

    // Idempotency: a replay short-circuits without a second audit/side-effect.
    if (args.idempotencyKey) {
      const dup = await tx.select({ id: hubAudit.id }).from(hubAudit)
        .where(and(eq(hubAudit.hubItemId, args.hubItemId),
                   sql`${hubAudit.relayResult}->>'idempotencyKey' = ${args.idempotencyKey}`))
        .limit(1).then((r) => r[0]);
      if (dup) return current;
    }

    // Optimistic concurrency: guarded UPDATE only matches the expected version.
    const updated = await tx.update(hubItems)
      .set({
        status: args.nextStatus, version: current.version + 1,
        resolvedAt: args.nextStatus === "resolved" ? new Date() : current.resolvedAt,
        archivedAt: args.nextStatus === "archived" ? new Date() : current.archivedAt,
      })
      .where(and(eq(hubItems.id, args.hubItemId), eq(hubItems.version, args.expectedVersion)))
      .returning().then((r) => r[0] ?? null);
    if (!updated) {
      throw conflict("This item was changed by someone else. Reload and retry.",
        { currentVersion: current.version });
    }

    // Audit BEFORE the side-effect (manual + autonomous).
    await tx.insert(hubAudit).values({
      companyId: args.companyId, hubItemId: args.hubItemId,
      actorType: args.actorType, actorId: args.actorId, action: args.action,
      authorityBasis: args.authorityBasis ?? null, reason: args.reason ?? null,
      priorState: { status: current.status, version: current.version },
      relayResult: args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : null,
    });

    let effects: { irreversibleSideEffects?: unknown; relayResult?: unknown } = {};
    if (args.sideEffect) effects = await args.sideEffect(tx); // source-API call (Task 9 wires real ones)
    return { ...updated, effects };
  });
}
```

`conflict`/`notFound` come from the existing http-errors helper (same module `agents.ts` uses). Action `pending/failed/partial` states + cross-source bulk semantics are noted for W1c; W1a covers single-item resolve/archive/snooze with 409 + audit + idempotency.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(hub): action with optimistic concurrency + audit-before-side-effect (W1a Task 7)`.

---

## Task 8: Reconciliation sweeper (sources = truth)

**Files:**
- Modify: `server/src/services/hub-items.ts`
- Test: `server/src/__tests__/hub-items-sweeper.integration.test.ts`

- [ ] **Step 1: Failing test** — simulate a commit-then-emit-failure: insert an `approvals` row whose `status='approved'` but leave its hub item `open` (the missed-emit case), plus a hub item whose source approval row was deleted. Assert the sweeper (a) closes the hub item whose source is terminal/deleted, and (b) does NOT touch items whose source is still pending.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `reconcile(companyId, { sourceType })`**

For the given `sourceType`, load open hub items; for each, look up the source row by `sourceId`; if the source is gone OR in a terminal state, transition the hub item to `resolved`/`archived` (with an `actorType:"system"` audit row); if the source's summary/permission revision drifted, refresh it. Process in company-scoped batches. W1a implements the **approval** + **heartbeat_run** reconcilers (the two highest-volume terminal sources) and a registry hook so other source types plug in later. Log a count of healed items (no silent caps — `log` what was reconciled).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `feat(hub): reconciliation sweeper heals missed emits + dead sources (W1a Task 8)`.

---

## Task 9: REST routes + maintained counters

**Files:**
- Create: `packages/shared/src/validators/hub.ts`
- Create: `server/src/routes/hub-items.ts`
- Modify: the route registrar (where `goalRoutes` is mounted)
- Test: `server/src/__tests__/hub-items-routes.test.ts` (mock-based, mirror `goals` route tests)

- [ ] **Step 1: Zod request schemas** (`validators/hub.ts`): `listHubItemsQuery` (lane?, status?, includeDismissed?), `hubActionSchema` (action, expectedVersion:int, idempotencyKey?, reason?), `hubUserStateSchema` (one of read/snooze{until}/dismiss).

- [ ] **Step 2: Failing route test** — GET list returns RBAC-scoped items (assert `assertCompanyAccess` is called + a member sees fewer than a founder); POST action with a stale `expectedVersion` → 409; PATCH read/snooze/dismiss upserts `hub_item_user_state`; GET counters returns `{ unread, open }`.

- [ ] **Step 3: Implement routes** (mirror `routes/goals.ts` exactly — `assertCompanyAccess` → `assertRole`/Authority gate → service call → `logActivity` → JSON):
  - `GET  /companies/:companyId/hub-items` (query: lane/status) → `svc.query`
  - `GET  /companies/:companyId/hub-items/counts` → maintained `{ open, unread }`
  - `POST /companies/:companyId/hub-items/:id/action` (validate `hubActionSchema`) → `svc.recordAndAct`; map `conflict`→409, `notFound`→404
  - `PATCH /companies/:companyId/hub-items/:id/state` (validate `hubUserStateSchema`) → upsert `hub_item_user_state` for `req.actor.userId`
  - Mount it next to the other route registrations.

- [ ] **Step 4: Counters** — implement `counts(companyId, actorUserId)` as a maintained read: `open` from the `hub_items_open_idx` (RBAC-scoped), `unread` = open minus rows with a `readAt` in this principal's state. Document that emit/resolve keep these cheap (no `COUNT(*)` across snooze/dismiss/RBAC on every load); a fully-maintained counter table is a W1d optimization.

- [ ] **Step 5: Run → PASS. Commit** — `feat(hub): hub-items REST routes + counts (W1a Task 9)`.

---

## Task 10: Migrate the 4 existing emit sites onto `hubItems.emit`

**Files (modify):** `services/threads.ts` (mention), `services/internal-agent/proactive.ts` (proactive + reminder), `services/marketplace-notifications.ts` (6 marketplace types), `services/internal-agent/tools/notify-owner-tool.ts`.

- [ ] **Step 1:** For each site, replace the raw `createNotification`/`notificationService().create` call with `hubItemsService(db).emit({...})`, mapping the existing `type`→`semanticType`, setting `sourceType`/`sourceId` (the related entity), `ownerUserId` (the existing recipient userId), and `summary` (the existing message — now redacted at emit). Pass `tx` where the call already sits inside a transaction (no silent drops). Keep `createNotification` itself for now (delivery-retry scaffold) but route new emits through `emit`.

- [ ] **Step 2:** Update the existing notification unit tests for these sites (they currently assert a `notifications` insert — assert the `hubItems.emit` shape instead). Drop the dead notification types (`internal_agent.action_result` + the 5 unused `thread.*`) from `NOTIFICATION_TYPES` if nothing emits them (grep to confirm).

- [ ] **Step 3:** Run the affected service test files + `pnpm -C server exec vitest run` to confirm no regressions. Commit — `feat(hub): route the 4 existing emit sites through hubItems.emit (W1a Task 10)`.

---

## Task 11: Test-coverage sweep + contract regression

- [ ] **Step 1:** Confirm the integration suite covers: idempotent emit, redaction-before-persist, RBAC query (founder/lead/member + cross-department negative), 409 on stale action, audit-before-side-effect ordering, idempotency replay, sweeper heal (missed emit + dead source), per-user state upsert, counts.
- [ ] **Step 2:** Add a contract regression unit test asserting the `hubActionEnvelope` shape + `HUB_SEMANTIC_TO_LANE` completeness stays in sync with the DB `semanticType` values.
- [ ] **Step 3:** Run the FULL server suite locally (`pnpm -C server exec vitest run`) → expect 0 failures (integration files skip on Windows). On Linux CI the integration tests are the real gate (Issue #114).
- [ ] **Step 4:** Final commit — `test(hub): W1a data-core coverage sweep (W1a Task 11)`.

---

## Verification & handoff

- Typecheck: `pnpm -r typecheck` (the `@armyofagents/plugin-sdk` "module not built" cascade is pre-existing noise; build it first with `pnpm --filter @armyofagents/plugin-sdk build` for a clean local run).
- Full server suite green locally (integration Windows-skip).
- Open the W1a PR off `main`. Linux `e2e`/`verify`/`migrations`/`e2e-pgvector` are the real gates; remember the W6 lessons: seed companies with a unique `issue_prefix`; complete every service mock the new emit path touches.
- Next sub-phase: **W1b** (3-pane shell + lanes + registry-backed viewer) reads exclusively from these routes.

## Self-review checklist (run before execution)

- [ ] Every §18 day-1 requirement present: RBAC at emit+query+action ✓ (Tasks 5/6/9), redact-before-persist ✓ (Task 5), immutable audit before side-effect ✓ (Task 7), idempotent emit + reconciliation sweeper ✓ (Tasks 5/8), optimistic concurrency 409 ✓ (Task 7), sparse seat-keyed user state ✓ (Task 2).
- [ ] Type names consistent across tasks: `hubItems`, `hubItemUserState`, `hubAudit`, `hubItemsService`, `emit`/`query`/`recordAndAct`/`reconcile`/`counts`, `HUB_SEMANTIC_TYPES`/`laneForSemanticType`.
- [ ] No UI in scope (W1b). No realtime (W2-L3). W5 type reserved only.
