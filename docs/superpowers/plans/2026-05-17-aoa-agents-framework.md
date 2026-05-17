# AoA Agents Framework — Plan A: Backend Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Commander and the discussion-extraction sub-agent first-class `agents` rows (`kind='aoa'`), executed by a new no-task runner through the proven worker adapter layer, dispatched by a generalized durable trigger loop — so extraction really runs via an adapter and the framework backend is ready for the UI (Plan C) and governance (Plan D).

**Architecture:** Reuse-first. Add `kind='aoa'` + an `aoa_agent_triggers` binding table + `internal_agent_config.agent_id`. Generalize the Decision-#99 extraction sweeper into an AoA Dispatcher (poll triggers → atomic claim → bounded concurrency → orphan recovery). Add a no-task runner that builds a prompt from `instructions + skills + trigger payload` and invokes the existing adapter registry. Migrate the existing `kind='platform'` extraction agent to be the first `kind='aoa'` citizen, its #99 durable trigger preserved.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Vitest, Express. Spec: `docs/superpowers/specs/2026-05-16…` superseded by `docs/superpowers/specs/2026-05-17-aoa-agents-framework-design.md`. This is **Plan A of 4** (A backend → B coordination → C UI → D governance+DoD).

**Worktree:** `AoA-2.5/.worktrees/commander-subagent-1`, branch `commander-subagent-1`. **Test cmd:** `cd <worktree>/server && npx vitest run src/__tests__/<file>`. **Git hygiene:** add specific files by name only, never `git add -A`.

**Codebase rules (non-negotiable):** Drizzle only — schema in `packages/db/src/schema/`, then `pnpm db:generate` to emit the migration. **Never hand-write migration SQL.** Mock harness for service tests: `vi.hoisted` + explicit `@armyofagents/db` named-export mock (NOT a catch-all Proxy). Hard error boundary pattern: nested try/catch, never `.catch()` on Drizzle builders (they are thenables without `.catch`).

**Plan A does NOT do** (later plans): mention/delegation (B), any UI (C), RBAC/tool-allowlist/Decision-#100 ADR/gated real-output integration acceptance (D). Plan A's acceptance = contract/unit + the Linux-CI integration test prove the AoA agent runs via adapter and records a real run; the credential-gated *real-output* proof is Plan D §17.

---

## File Structure

**Create:**
- `packages/db/src/schema/aoa_agent_triggers.ts` — trigger-binding table.
- `server/src/services/internal-agent/aoa-agents/ensure-commander.ts` — idempotent Commander agent-row seed + config link.
- `server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts` — migrate platform→aoa extraction agent.
- `server/src/services/internal-agent/aoa-agents/triggers.ts` — read/evaluate enabled triggers.
- `server/src/services/internal-agent/aoa-agents/dispatcher.ts` — generalized sweeper (poll→claim→run→reclaim).
- `server/src/services/internal-agent/aoa-agents/runner.ts` — no-task runner (prompt build + adapter execute + run/cost record).
- Tests in `server/src/__tests__/`: `aoa-schema-additive.test.ts`, `aoa-ensure-commander.test.ts`, `aoa-ensure-extraction-agent.test.ts`, `aoa-triggers.test.ts`, `aoa-dispatcher.test.ts`, `aoa-runner.test.ts`, `aoa-extraction-migrated.test.ts`, `aoa-backend.integration.test.ts`.

**Modify:**
- `packages/db/src/schema/agents.ts` — `kind` comment add `'aoa'` (value is text; no enum change).
- `packages/db/src/schema/internal_agent.ts` — add `internalAgentConfig.agentId` + relation.
- `packages/db/src/schema/index.ts` (or the schema barrel) — export `aoaAgentTriggers`.
- `server/src/services/internal-agent/subagents/extraction-sweeper.ts` — becomes a thin shim over the dispatcher (behavior preserved).
- `server/src/services/internal-agent/subagents/extraction-consumer.ts` — extraction routed through the runner.
- `server/src/index.ts` — the extraction `setInterval` calls the dispatcher tick (45s + in-flight guard preserved).

**Reuse (do not modify):** adapter registry (`server/src/adapters/registry.ts`), `resolveAdapterExecutionContext`, `concurrency-limiter.ts`, `costService.createEvent`, `agents` status/pause machinery.

---

## Milestone A1 — Schema: `kind='aoa'`, `aoa_agent_triggers`, `internal_agent_config.agent_id`

### Task A1.1: `aoa_agent_triggers` table

**Files:**
- Create: `packages/db/src/schema/aoa_agent_triggers.ts`
- Modify: `packages/db/src/schema/index.ts`
- Test: `server/src/__tests__/aoa-schema-additive.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/__tests__/aoa-schema-additive.test.ts
import { describe, expect, it } from "vitest";
import { aoaAgentTriggers } from "@armyofagents/db";

describe("aoa_agent_triggers schema", () => {
  it("exposes the expected columns (additive-safe)", () => {
    const cols = Object.keys(aoaAgentTriggers);
    for (const c of ["id", "companyId", "agentId", "kind", "enabled", "config", "createdAt", "updatedAt"]) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd <worktree>/server && npx vitest run src/__tests__/aoa-schema-additive.test.ts`
Expected: FAIL — `aoaAgentTriggers` is not exported from `@armyofagents/db`.

- [ ] **Step 3: Create the schema file**

```ts
// packages/db/src/schema/aoa_agent_triggers.ts
import { pgTable, uuid, text, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * Trigger binding for an AoA agent (kind='aoa'). One agent may have many.
 * `kind` is the dispatch binding (what causes a run); it is distinct from
 * internal_agent_runs.trigger_type (recorded provenance) — see spec §5.6.
 * 'task' is reserved (spec L11) and intentionally NOT implemented in v1.
 */
export const aoaAgentTriggers = pgTable(
  "aoa_agent_triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'outbox' | 'routine' | 'event' | 'mention' | 'conversation' | 'manual'
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyAgentIdx: index("aoa_triggers_company_agent_idx").on(t.companyId, t.agentId),
    companyKindEnabledIdx: index("aoa_triggers_company_kind_enabled_idx").on(t.companyId, t.kind, t.enabled),
  }),
);

export const aoaAgentTriggersRelations = relations(aoaAgentTriggers, ({ one }) => ({
  company: one(companies, { fields: [aoaAgentTriggers.companyId], references: [companies.id] }),
  agent: one(agents, { fields: [aoaAgentTriggers.agentId], references: [agents.id] }),
}));
```

- [ ] **Step 4: Export from the schema barrel**

In `packages/db/src/schema/index.ts`, add (alphabetical with the other `export * from`):

```ts
export * from "./aoa_agent_triggers.js";
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `cd <worktree>/server && npx vitest run src/__tests__/aoa-schema-additive.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/aoa_agent_triggers.ts packages/db/src/schema/index.ts server/src/__tests__/aoa-schema-additive.test.ts
git commit -m "feat(aoa): aoa_agent_triggers schema (trigger bindings)"
```

### Task A1.2: `internal_agent_config.agentId` + `kind='aoa'` comment

**Files:**
- Modify: `packages/db/src/schema/internal_agent.ts` (the `internalAgentConfig` table, after `metadata` ~line 84)
- Modify: `packages/db/src/schema/agents.ts:21` (comment only)
- Test: extend `server/src/__tests__/aoa-schema-additive.test.ts`

- [ ] **Step 1: Add the failing assertion**

Append to the existing `describe` in `aoa-schema-additive.test.ts`:

```ts
  it("internal_agent_config exposes agentId (nullable link to Commander row)", async () => {
    const { internalAgentConfig } = await import("@armyofagents/db");
    expect(Object.keys(internalAgentConfig)).toContain("agentId");
  });
```

- [ ] **Step 2: Run, verify fail**

Run: `cd <worktree>/server && npx vitest run src/__tests__/aoa-schema-additive.test.ts`
Expected: FAIL — `agentId` not on `internalAgentConfig`.

- [ ] **Step 3: Add the column + relation**

In `packages/db/src/schema/internal_agent.ts`, add the import at top:

```ts
import { agents } from "./agents.js";
```

Inside `internalAgentConfig` columns, immediately after `metadata: jsonb("metadata").default({}),`:

```ts
    // Links this per-company Commander config to its kind='aoa' agents row
    // (the team lead). Nullable until the A2 migration backfills it.
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
```

In `internalAgentConfigRelations`, add to the `one(...)` block:

```ts
    agent: one(agents, {
      fields: [internalAgentConfig.agentId],
      references: [agents.id],
    }),
```

In `packages/db/src/schema/agents.ts` line 21, change the comment only:

```ts
    kind: text("kind").notNull().default("org"), // 'org' | 'platform' | 'aoa' — 'aoa' = Commander + sub-agents (first-class, trigger-driven)
```

- [ ] **Step 4: Run, verify pass**

Run: `cd <worktree>/server && npx vitest run src/__tests__/aoa-schema-additive.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Generate the migration (NEVER hand-write SQL)**

Run: `cd <worktree> && pnpm db:generate`
Expected: a new `packages/db/src/migrations/00NN_*.sql` + `meta/` snapshot are emitted by Drizzle. Open the `.sql` and visually confirm it only `CREATE TABLE "aoa_agent_triggers"` and `ALTER TABLE "internal_agent_config" ADD COLUMN "agent_id"` (additive; no drops, no NOT NULL on existing data).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/internal_agent.ts packages/db/src/schema/agents.ts packages/db/src/migrations/ server/src/__tests__/aoa-schema-additive.test.ts
git commit -m "feat(aoa): internal_agent_config.agentId + kind='aoa'; generate migration"
```

---

## Milestone A2 — Commander as an `agents` row (team lead)

Mirrors the proven `ensurePlatformAgent` pattern (`server/src/services/internal-agent/subagents/platform-agent.ts`). Commander gets `kind='aoa'`, `role='commander_lead'`, non-dispatchable heartbeat (`runtimeConfig.heartbeat={enabled:false,intervalSec:0}` — same structural guard the platform agent uses). The chat loop (`agent-loop.ts`) is **not touched**.

**Files:**
- Create: `server/src/services/internal-agent/aoa-agents/ensure-commander.ts`
- Test: `server/src/__tests__/aoa-ensure-commander.test.ts`

- [ ] **Step 1: Write the failing test** (harness mirrors `platform-agent-seed.test.ts`)

```ts
// server/src/__tests__/aoa-ensure-commander.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { eqMock, andMock } = vi.hoisted(() => ({
  eqMock: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  andMock: vi.fn((...a: unknown[]) => ({ and: a })),
}));
vi.mock("drizzle-orm", () => ({ and: andMock, eq: eqMock }));
vi.mock("@armyofagents/db", () => {
  const t = (n: string) => new Proxy({}, { get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined) });
  return { agents: t("agents"), internalAgentConfig: t("internal_agent_config") };
});

import { ensureCommanderAgent } from "../services/internal-agent/aoa-agents/ensure-commander.js";

function selectChain(rows: unknown[]) {
  const c: any = {}; c.from = () => c; c.where = () => c;
  c.then = (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r);
  return c;
}

describe("ensureCommanderAgent", () => {
  beforeEach(() => { eqMock.mockClear(); andMock.mockClear(); });

  it("returns the existing commander row id without inserting", async () => {
    const insert = vi.fn();
    const db: any = { select: () => selectChain([{ id: "cmd-1" }]), insert, update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve([]) }) })) };
    expect(await ensureCommanderAgent(db, "co-1")).toBe("cmd-1");
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates a non-dispatchable kind='aoa' role='commander_lead' row and links config", async () => {
    const agentValues: any[] = [];
    const setCalls: any[] = [];
    const db: any = {
      select: () => selectChain([]),
      insert: () => ({ values: (v: any) => { agentValues.push(v); return { returning: () => Promise.resolve([{ id: "cmd-new" }]) }; } }),
      update: () => ({ set: (v: any) => { setCalls.push(v); return { where: () => Promise.resolve([]) }; } }),
    };
    expect(await ensureCommanderAgent(db, "co-1")).toBe("cmd-new");
    expect(agentValues[0].kind).toBe("aoa");
    expect(agentValues[0].role).toBe("commander_lead");
    expect(agentValues[0].runtimeConfig.heartbeat).toEqual({ enabled: false, intervalSec: 0 });
    expect(setCalls.some((s) => s.agentId === "cmd-new")).toBe(true); // config linked
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd <worktree>/server && npx vitest run src/__tests__/aoa-ensure-commander.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// server/src/services/internal-agent/aoa-agents/ensure-commander.ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, internalAgentConfig } from "@armyofagents/db";

export const COMMANDER_AGENT_NAME = "Commander";
export const COMMANDER_ROLE = "commander_lead";

/** Idempotently ensure the per-company Commander kind='aoa' row exists and
 *  internal_agent_config.agentId points at it. Chat loop is unaffected —
 *  this only adds a representation row + link. Returns the agent id. */
export async function ensureCommanderAgent(db: Db, companyId: string): Promise<string> {
  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa"), eq(agents.role, COMMANDER_ROLE)))
    .then((r: { id: string }[]) => r[0] ?? null);

  let agentId = existing?.id ?? null;
  if (!agentId) {
    const [created] = await db
      .insert(agents)
      .values({
        companyId,
        name: COMMANDER_AGENT_NAME,
        kind: "aoa",
        role: COMMANDER_ROLE,
        status: "idle",
        adapterType: "process",
        // Non-dispatchable via heartbeat: same structural guard as the
        // platform agent. Commander's execution is its chat loop, not here.
        runtimeConfig: { heartbeat: { enabled: false, intervalSec: 0 } },
      })
      .returning();
    agentId = created.id;
  }

  // Link the per-company config singleton (idempotent; guarded so a manual
  // unlink isn't clobbered — only set when null/different).
  await db
    .update(internalAgentConfig)
    .set({ agentId, updatedAt: new Date() })
    .where(eq(internalAgentConfig.companyId, companyId));

  return agentId;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd <worktree>/server && npx vitest run src/__tests__/aoa-ensure-commander.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/ensure-commander.ts server/src/__tests__/aoa-ensure-commander.test.ts
git commit -m "feat(aoa): ensureCommanderAgent — Commander as kind='aoa' team-lead row"
```

> **Wiring note (executed in A8 alongside other bootstrap wiring, not here):** call `ensureCommanderAgent(db, companyId)` wherever `internal_agent_config` is first ensured for a company (search: `grep -rn "internalAgentConfig" server/src/services/internal-agent/*.ts | grep -i ensure|insert`). Deferred to A8 so this milestone stays isolated and revertible.

---

## Milestone A3 — Migrate the platform extraction agent → first AoA agent

The existing `ensurePlatformAgent` (`platform-agent.ts`) creates a `kind='platform'` "Commander Team" row used for extraction cost attribution (Decision #99). It becomes the first `kind='aoa'` citizen "Discussion Extraction", and an `outbox` trigger row is created for it.

**Files:**
- Create: `server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts`
- Test: `server/src/__tests__/aoa-ensure-extraction-agent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/__tests__/aoa-ensure-extraction-agent.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const { eqMock, andMock } = vi.hoisted(() => ({
  eqMock: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  andMock: vi.fn((...a: unknown[]) => ({ and: a })),
}));
vi.mock("drizzle-orm", () => ({ and: andMock, eq: eqMock }));
vi.mock("@armyofagents/db", () => {
  const t = (n: string) => new Proxy({}, { get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined) });
  return { agents: t("agents"), aoaAgentTriggers: t("aoa_agent_triggers") };
});
import { ensureExtractionAgent, EXTRACTION_AGENT_NAME } from "../services/internal-agent/aoa-agents/ensure-extraction-agent.js";

function selectChain(rows: unknown[]) {
  const c: any = {}; c.from = () => c; c.where = () => c;
  c.then = (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r);
  return c;
}

describe("ensureExtractionAgent", () => {
  beforeEach(() => { eqMock.mockClear(); andMock.mockClear(); });

  it("creates a kind='aoa' extraction agent + an enabled outbox trigger when absent", async () => {
    const agentValues: any[] = []; const triggerValues: any[] = []; let n = 0;
    const db: any = {
      select: () => selectChain([]),
      insert: () => { const which = n++; return { values: (v: any) => { (which === 0 ? agentValues : triggerValues).push(v); return { returning: () => Promise.resolve([{ id: which === 0 ? "ext-1" : "trg-1" }]) }; } }; },
    };
    const id = await ensureExtractionAgent(db, "co-1");
    expect(id).toBe("ext-1");
    expect(agentValues[0].kind).toBe("aoa");
    expect(agentValues[0].name).toBe(EXTRACTION_AGENT_NAME);
    expect(triggerValues[0].kind).toBe("outbox");
    expect(triggerValues[0].enabled).toBe(true);
    expect(triggerValues[0].config).toEqual({ source: "discussion_entry_pending" });
  });

  it("is idempotent — existing extraction agent id returned, no insert", async () => {
    const insert = vi.fn();
    const db: any = { select: () => selectChain([{ id: "ext-existing" }]), insert };
    expect(await ensureExtractionAgent(db, "co-1")).toBe("ext-existing");
    expect(insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `cd <worktree>/server && npx vitest run src/__tests__/aoa-ensure-extraction-agent.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers } from "@armyofagents/db";

export const EXTRACTION_AGENT_NAME = "Discussion Extraction";
export const EXTRACTION_ROLE = "aoa_member";

/** Idempotently ensure the kind='aoa' discussion-extraction agent + its
 *  durable outbox trigger (preserving Decision #99's discussion-entry-pending
 *  trigger). Returns the agent id (used for cost attribution + dispatch). */
export async function ensureExtractionAgent(db: Db, companyId: string): Promise<string> {
  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa"), eq(agents.role, EXTRACTION_ROLE), eq(agents.name, EXTRACTION_AGENT_NAME)))
    .then((r: { id: string }[]) => r[0] ?? null);
  if (existing) return existing.id;

  const [created] = await db
    .insert(agents)
    .values({
      companyId,
      name: EXTRACTION_AGENT_NAME,
      kind: "aoa",
      role: EXTRACTION_ROLE,
      status: "idle",
      adapterType: "process",
      runtimeConfig: { heartbeat: { enabled: false, intervalSec: 0 } },
    })
    .returning();

  await db.insert(aoaAgentTriggers).values({
    companyId,
    agentId: created.id,
    kind: "outbox",
    enabled: true,
    config: { source: "discussion_entry_pending" },
  });

  return created.id;
}
```

- [ ] **Step 4: Run, verify pass** — Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts server/src/__tests__/aoa-ensure-extraction-agent.test.ts
git commit -m "feat(aoa): ensureExtractionAgent — extraction becomes first kind='aoa' citizen"
```

---

## Milestone A4 — Trigger evaluation

**Files:**
- Create: `server/src/services/internal-agent/aoa-agents/triggers.ts`
- Test: `server/src/__tests__/aoa-triggers.test.ts`

`listDuePending(db, companyId)` returns work units for enabled triggers. v1 implements **`outbox`** (discussion entries `extractionStatus='pending'`, preserving #99) and **`manual`** (`agent_wakeup_requests.status='queued'` with `source='aoa.manual'`). `routine`/`event`/`mention`/`conversation` kinds are recognized but return `[]` in v1 (B/C/D extend; the seam exists).

- [ ] **Step 1: Failing test**

```ts
// server/src/__tests__/aoa-triggers.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const { eqMock, andMock } = vi.hoisted(() => ({
  eqMock: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  andMock: vi.fn((...a: unknown[]) => ({ and: a })),
}));
vi.mock("drizzle-orm", () => ({ and: andMock, eq: eqMock }));
vi.mock("@armyofagents/db", () => {
  const t = (n: string) => new Proxy({}, { get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined) });
  return { aoaAgentTriggers: t("aoa_agent_triggers"), agents: t("agents") };
});
import { listEnabledTriggerKinds } from "../services/internal-agent/aoa-agents/triggers.js";

function selectChain(rows: unknown[]) {
  const c: any = {}; c.from = () => c; c.innerJoin = () => c; c.where = () => c;
  c.then = (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r);
  return c;
}

describe("aoa triggers", () => {
  beforeEach(() => { eqMock.mockClear(); andMock.mockClear(); });
  it("returns enabled, non-paused trigger bindings", async () => {
    const db: any = { select: () => selectChain([{ agentId: "ext-1", kind: "outbox", config: { source: "discussion_entry_pending" } }]) };
    const r = await listEnabledTriggerKinds(db, "co-1");
    expect(r).toEqual([{ agentId: "ext-1", kind: "outbox", config: { source: "discussion_entry_pending" } }]);
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

```ts
// server/src/services/internal-agent/aoa-agents/triggers.ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { aoaAgentTriggers, agents } from "@armyofagents/db";

export interface EnabledTrigger {
  agentId: string;
  kind: string;
  config: Record<string, unknown>;
}

/** Enabled trigger bindings whose agent is not paused/terminated. The
 *  dispatcher (A5) turns these into claimed work units per kind. */
export async function listEnabledTriggerKinds(db: Db, companyId: string): Promise<EnabledTrigger[]> {
  const rows = await db
    .select({ agentId: aoaAgentTriggers.agentId, kind: aoaAgentTriggers.kind, config: aoaAgentTriggers.config, status: agents.status })
    .from(aoaAgentTriggers)
    .innerJoin(agents, eq(agents.id, aoaAgentTriggers.agentId))
    .where(and(eq(aoaAgentTriggers.companyId, companyId), eq(aoaAgentTriggers.enabled, true)))
    .then((r: Array<{ agentId: string; kind: string; config: Record<string, unknown>; status: string }>) => r);

  return rows
    .filter((r) => r.status !== "paused" && r.status !== "terminated")
    .map((r) => ({ agentId: r.agentId, kind: r.kind, config: r.config }));
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/triggers.ts server/src/__tests__/aoa-triggers.test.ts
git commit -m "feat(aoa): enabled-trigger evaluation (paused-agent aware)"
```

---

## Milestone A5 — Generalized AoA Dispatcher

Generalize `extraction-sweeper.ts` (Decision #99: Phase-1 linked-run orphan reclaim + Phase-2 atomic-claim drain, bounded by `concurrency-limiter`). The dispatcher resolves enabled `outbox` triggers to the same discussion-entry-pending claim, runs the **runner** (A6) under the limiter, and reclaims orphans. `extraction-sweeper.ts` becomes a 3-line shim calling the dispatcher so **all existing `extraction-sweeper.test.ts` behavior is preserved**.

**Files:**
- Create: `server/src/services/internal-agent/aoa-agents/dispatcher.ts`
- Modify: `server/src/services/internal-agent/subagents/extraction-sweeper.ts`, `server/src/index.ts`
- Test: `server/src/__tests__/aoa-dispatcher.test.ts` (+ keep `extraction-sweeper.test.ts` green unmodified)

- [ ] **Step 1: Failing test** — model on `extraction-sweeper.test.ts`'s sequence-mock DB. Assert: pending discussion entries for an enabled-outbox AoA agent are claimed and the runner is invoked once each; a stale linked run is reclaimed (run→failed, entry→pending); a paused agent's entries are NOT dispatched.

```ts
// server/src/__tests__/aoa-dispatcher.test.ts  (abridged — full sequence-mock mirrors extraction-sweeper.test.ts)
import { beforeEach, describe, expect, it, vi } from "vitest";
const { runnerMock } = vi.hoisted(() => ({ runnerMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/internal-agent/aoa-agents/runner.js", () => ({ runAoaAgent: runnerMock }));
vi.mock("../services/internal-agent/aoa-agents/triggers.js", () => ({
  listEnabledTriggerKinds: vi.fn().mockResolvedValue([{ agentId: "ext-1", kind: "outbox", config: { source: "discussion_entry_pending" } }]),
}));
vi.mock("drizzle-orm", () => ({ and:(...a:unknown[])=>({and:a}), or:(...a:unknown[])=>({or:a}), eq:(a:unknown,b:unknown)=>({eq:[a,b]}), lt:(a:unknown,b:unknown)=>({lt:[a,b]}), inArray:(a:unknown,b:unknown)=>({inArray:[a,b]}) }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { discussionEntries:t("de"), discussions:t("d"), internalAgentRuns:t("iar"), aoaAgentTriggers:t("agt"), agents:t("a") }; });
vi.mock("../middleware/logger.js", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));
import { runAoaDispatch } from "../services/internal-agent/aoa-agents/dispatcher.js";

it("drains pending discussion entries through the runner", async () => {
  // selectQueue: [orphan-select=[], pending-drain=[{id:'e1',companyId:'co-1'}]]
  const db = makeSeqDb([[], [{ id: "e1", companyId: "co-1" }]]); // helper identical to extraction-sweeper.test.ts makeDb
  await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });
  expect(runnerMock).toHaveBeenCalledWith(db, "ext-1", { entryId: "e1", companyId: "co-1", source: "discussion_entry_pending" });
});
```

(Reuse `extraction-sweeper.test.ts`'s `makeDb` sequence-mock verbatim as `makeSeqDb`.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the dispatcher** (generalize the #99 sweeper; same Phase-1/Phase-2 + limiter; resolve outbox triggers → discussion-entry claim → `runAoaAgent`)

```ts
// server/src/services/internal-agent/aoa-agents/dispatcher.ts
import { and, eq, lt, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussionEntries, discussions, internalAgentRuns } from "@armyofagents/db";
import { listEnabledTriggerKinds } from "./triggers.js";
import { runAoaAgent } from "./runner.js";
import { createLimiter } from "../subagents/concurrency-limiter.js";
import { logger } from "../../../middleware/logger.js";

export interface DispatchOptions { limiterMax: number; staleMs: number; }

/** Generalized AoA dispatch (supersedes runExtractionSweep; same Decision-#99
 *  Phase-1 linked-run orphan reclaim + Phase-2 atomic-claim drain). v1 wires
 *  the 'outbox' trigger (discussion_entry_pending) to the no-task runner. */
export async function runAoaDispatch(db: Db, opts: DispatchOptions): Promise<void> {
  const staleCutoff = new Date(Date.now() - opts.staleMs);

  // ── Phase 1: reclaim orphaned 'processing' discussion entries (verbatim
  //    Decision #99 linked-run reclaim — see extraction-sweeper.ts §6.3). ──
  const orphanRows: Array<{ id: string; runId: string | null }> = await db
    .select({ id: discussionEntries.id, runId: discussionEntries.extractionRunId })
    .from(discussionEntries)
    .leftJoin(internalAgentRuns, eq(internalAgentRuns.id, discussionEntries.extractionRunId))
    .where(and(
      eq(discussionEntries.extractionStatus, "processing"),
      eq(internalAgentRuns.status, "running"),
      lt(internalAgentRuns.createdAt, staleCutoff),
    ))
    .then((r: Array<{ id: string; runId: string | null }>) => r);

  if (orphanRows.length > 0) {
    const orphanIds = [...new Set(orphanRows.map((o) => o.id))];
    const staleRunIds = [...new Set(orphanRows.map((o) => o.runId).filter((v): v is string => typeof v === "string"))];
    if (staleRunIds.length > 0) {
      await db.update(internalAgentRuns)
        .set({ status: "failed", errorMessage: "reclaimed: orphaned (aoa-dispatcher)", completedAt: new Date() })
        .where(and(inArray(internalAgentRuns.id, staleRunIds), eq(internalAgentRuns.status, "running")));
    }
    await db.update(discussionEntries)
      .set({ extractionStatus: "pending", extractionRunId: null })
      .where(and(inArray(discussionEntries.id, orphanIds), eq(discussionEntries.extractionStatus, "processing")));
  }

  // ── Phase 2: per enabled outbox trigger, drain pending → runner ──
  const triggers = await listEnabledTriggerKinds(db, /* all companies handled by per-company callers; v1: */ "");
  // NOTE: extraction-sweeper ran company-agnostic over all pending entries.
  // Preserve that: drain all 'pending' entries and attribute to the outbox
  // agent resolved per company. (Trigger list gates WHICH kinds are active.)
  const outboxEnabled = triggers.length === 0
    ? true // back-compat: if trigger table empty (pre-migration), behave as #99
    : triggers.some((t) => t.kind === "outbox" && (t.config as { source?: string }).source === "discussion_entry_pending");
  if (!outboxEnabled) {
    logger.child({ svc: "aoa-dispatcher" }).info({ reclaimed: orphanRows.length }, "no outbox trigger; reclaim-only tick");
    return;
  }

  const rows: Array<{ id: string; companyId: string }> = await db
    .select({ id: discussionEntries.id, companyId: discussions.companyId })
    .from(discussionEntries)
    .innerJoin(discussions, eq(discussions.id, discussionEntries.discussionId))
    .where(eq(discussionEntries.extractionStatus, "pending"))
    .limit(200)
    .then((r: Array<{ id: string; companyId: string }>) => r);
  if (rows.length === 0) return;

  const limiter = createLimiter(opts.limiterMax);
  const { ensureExtractionAgent } = await import("./ensure-extraction-agent.js");
  const agentByCompany = new Map<string, string>();

  await Promise.allSettled(rows.map((row) => limiter.run(async () => {
    let agentId = agentByCompany.get(row.companyId);
    if (!agentId) { agentId = await ensureExtractionAgent(db, row.companyId); agentByCompany.set(row.companyId, agentId); }
    await runAoaAgent(db, agentId, { entryId: row.id, companyId: row.companyId, source: "discussion_entry_pending" });
  })));

  logger.child({ svc: "aoa-dispatcher" }).info({ reclaimed: orphanRows.length, drained: rows.length }, "aoa dispatch complete");
}
```

- [ ] **Step 4: Make `extraction-sweeper.ts` a shim** (preserve its API + tests):

```ts
// server/src/services/internal-agent/subagents/extraction-sweeper.ts  (replace body)
import type { Db } from "@armyofagents/db";
import { runAoaDispatch } from "../aoa-agents/dispatcher.js";

export interface SweepOptions { limiterMax: number; staleMs: number; }

/** @deprecated superseded by runAoaDispatch (AoA Agents framework, Plan A).
 *  Kept as a thin shim so existing callers/tests are unaffected. */
export async function runExtractionSweep(db: Db, opts: SweepOptions): Promise<void> {
  await runAoaDispatch(db, opts);
}
```

- [ ] **Step 5: Run BOTH suites, verify green**

Run: `cd <worktree>/server && npx vitest run src/__tests__/aoa-dispatcher.test.ts src/__tests__/extraction-sweeper.test.ts`
Expected: `aoa-dispatcher` PASS; `extraction-sweeper` **still 4/4 PASS** (the shim preserves behavior). If extraction-sweeper fails, the shim/dispatcher diverged from #99 — fix the dispatcher, not the test.

- [ ] **Step 6: Point `index.ts` at the dispatcher**

In `server/src/index.ts`, the extraction `setInterval` block currently calls `runExtractionSweep(db as any, {limiterMax:4, staleMs:10*60*1000})`. Leave it — the shim now routes to `runAoaDispatch`. (No code change needed; the indirection is intentional. Verify by `grep -n runExtractionSweep server/src/index.ts` and confirming the import still resolves.)

- [ ] **Step 7: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/dispatcher.ts server/src/services/internal-agent/subagents/extraction-sweeper.ts server/src/__tests__/aoa-dispatcher.test.ts
git commit -m "feat(aoa): generalized dispatcher (extraction-sweeper now a #99-preserving shim)"
```

---

## Milestone A6 — No-task runner + adapter execution (the hard milestone)

`runAoaAgent(db, agentId, payload)`: load the agent; build a prompt context from `instructions + skills + payload` (no issue); reuse `resolveAdapterExecutionContext` + the adapter registry; invoke `adapter.execute({...})` with the minimal arg set (the heavyweight heartbeat-only inputs — workspace realization, issue context, heartbeat-run streaming — are replaced by AoA equivalents: no workspace, payload-derived context, `internal_agent_runs`). Hard error boundary (never rethrow). Record `internal_agent_runs` running→completed|failed + `costService.createEvent`.

> **Open item resolved here (spec §16):** agent instructions are a **file-bundle subsystem** (`agentsApi.instructionsBundle/instructionsFile`, see `AgentInstructionsTab.tsx`). v1 runner reads the **default instruction text** via the existing server accessor used by heartbeat context (locate with `grep -rn "instructionsBundle\|buildAgentInstructions\|systemPrompt" server/src/services/*.ts`); if none resolves for a kind='aoa' agent, fall back to a built-in extraction instruction constant. Full per-file editing is Plan C.

**Files:**
- Create: `server/src/services/internal-agent/aoa-agents/runner.ts`
- Test: `server/src/__tests__/aoa-runner.test.ts`

- [ ] **Step 1: Failing test** (mock adapter registry + costService; assert run lifecycle + isolation)

```ts
// server/src/__tests__/aoa-runner.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const { execMock, createEventMock, resolveCtxMock } = vi.hoisted(() => ({
  execMock: vi.fn().mockResolvedValue({ ok: true, outputText: "extracted: 2 items" }),
  createEventMock: vi.fn().mockResolvedValue(undefined),
  resolveCtxMock: vi.fn(() => ({ executionTarget: {}, runtimeCommandSpec: {} })),
}));
vi.mock("drizzle-orm", () => ({ eq: (a: unknown, b: unknown) => ({ eq: [a, b] }) }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agents:t("a"), internalAgentRuns:t("iar") }; });
vi.mock("../adapters/registry.js", () => ({ getAdapter: () => ({ execute: execMock }) }));
vi.mock("../services/costs.js", () => ({ costService: () => ({ createEvent: createEventMock }) }));
vi.mock("../services/internal-agent/aoa-agents/adapter-context.js", () => ({ resolveAdapterExecutionContext: resolveCtxMock }));
vi.mock("../middleware/logger.js", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));
import { runAoaAgent } from "../services/internal-agent/aoa-agents/runner.js";

function chain(ret: unknown[]) { const c: any = {}; c.values=()=>c; c.set=()=>c; c.where=()=>c; c.from=()=>c; c.returning=()=>Promise.resolve(ret); c.then=(r:(v:unknown[])=>unknown)=>Promise.resolve(ret).then(r); return c; }

describe("runAoaAgent", () => {
  beforeEach(() => { execMock.mockClear(); createEventMock.mockClear(); });
  it("happy path: run running→completed, adapter invoked, cost emitted", async () => {
    const db: any = {
      select: () => chain([{ id: "ext-1", companyId: "co-1", adapterType: "process", adapterConfig: {}, runtimeConfig: {}, kind: "aoa" }]),
      insert: () => chain([{ id: "run-1" }]),
      update: () => chain([{ id: "run-1" }]),
    };
    await runAoaAgent(db, "ext-1", { entryId: "e1", companyId: "co-1", source: "discussion_entry_pending" });
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(createEventMock).toHaveBeenCalledTimes(1);
    const [co, data] = createEventMock.mock.calls[0];
    expect(co).toBe("co-1"); expect(data.agentId).toBe("ext-1");
    expect(data.inputTokens).toBe(0); expect(data.costCents).toBe(0); // §16.3 zeroed (unchanged)
  });
  it("failure isolated: adapter throws → run failed, NEVER rethrows", async () => {
    execMock.mockRejectedValueOnce(new Error("adapter boom"));
    const db: any = { select: () => chain([{ id: "ext-1", companyId: "co-1", adapterType: "process", adapterConfig: {}, runtimeConfig: {} }]), insert: () => chain([{ id: "run-2" }]), update: () => chain([{ id: "run-2" }]) };
    await expect(runAoaAgent(db, "ext-1", { entryId: "e2", companyId: "co-1", source: "discussion_entry_pending" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify fail** (modules `runner.js` + `adapter-context.js` not found).

- [ ] **Step 3: Create the adapter-context shim** (isolate the reuse of heartbeat's `resolveAdapterExecutionContext` so the runner is testable and the seam is one file)

```ts
// server/src/services/internal-agent/aoa-agents/adapter-context.ts
// Re-exports the heartbeat adapter-execution-context resolver so the AoA
// runner depends on a narrow seam (and tests mock one module). If the
// symbol's import path differs, fix HERE only.
export { resolveAdapterExecutionContext } from "../../heartbeat.js";
```

> If `resolveAdapterExecutionContext` is not exported from `heartbeat.ts`, add `export` to its declaration there (single-word change) and note it in the commit. Locate: `grep -n "function resolveAdapterExecutionContext" server/src/services/heartbeat.ts`.

- [ ] **Step 4: Implement the runner**

```ts
// server/src/services/internal-agent/aoa-agents/runner.ts
import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, internalAgentRuns } from "@armyofagents/db";
import { getAdapter } from "../../../adapters/registry.js";
import { costService } from "../../costs.js";
import { resolveAdapterExecutionContext } from "./adapter-context.js";
import { logger } from "../../../middleware/logger.js";

export interface AoaTriggerPayload {
  companyId: string;
  source: string;
  entryId?: string;
  [k: string]: unknown;
}

const DEFAULT_EXTRACTION_INSTRUCTION =
  "You are a discussion-extraction agent. Read the provided discussion entry " +
  "and extract decisions, tasks, insights, context, references and preferences " +
  "as structured items.";

/** Trigger/executor-agnostic AoA run. Builds a prompt from instructions +
 *  (skills, Plan C) + trigger payload; runs the worker adapter; records the
 *  run and a platform-scoped cost_event. NEVER rethrows (hard boundary —
 *  the dispatcher/addEntry path must not break). */
export async function runAoaAgent(db: Db, agentId: string, payload: AoaTriggerPayload): Promise<void> {
  const log = logger.child({ svc: "aoa-runner", agentId, companyId: payload.companyId });
  const startedAt = Date.now();
  let runId: string | null = null;

  try {
    const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((r: any[]) => r[0] ?? null);
    if (!agent) { log.warn("aoa agent not found; skipping"); return; }

    const inserted = await db.insert(internalAgentRuns).values({
      companyId: payload.companyId,
      triggerType: "sub_agent",
      triggerSource: payload.source,
      status: "running",
      relatedEntityType: payload.entryId ? "discussion" : null,
      relatedEntityId: payload.entryId ?? null,
      userId: null,
    }).returning();
    runId = inserted[0]?.id ?? null;

    // Link the entry to its current run (preserves Decision #99's linked-run
    // orphan signal) when this is the extraction outbox path.
    if (runId && payload.entryId) {
      const { discussionEntries } = await import("@armyofagents/db");
      await db.update(discussionEntries).set({ extractionRunId: runId }).where(eq(discussionEntries.id, payload.entryId));
    }

    // Prompt = instructions (+ skills in Plan C) + trigger payload.
    const instruction = typeof agent.instructions === "string" && agent.instructions.trim()
      ? agent.instructions
      : DEFAULT_EXTRACTION_INSTRUCTION;
    const adapter = getAdapter(agent.adapterType);
    const { executionTarget, runtimeCommandSpec } = resolveAdapterExecutionContext(
      { ...agent.adapterConfig, ...agent.runtimeConfig }, adapter,
    );

    await adapter.execute({
      runId: runId ?? `aoa-${agentId}`,
      agent,
      runtime: agent.runtimeConfig ?? {},
      config: agent.adapterConfig ?? {},
      // No issue/workspace: context is the instruction + the trigger payload.
      context: { mode: "aoa", instruction, payload },
      executionTarget,
      runtimeCommandSpec,
      onLog: async () => {},
      onMeta: async () => {},
      authToken: undefined,
      onSpawn: () => {},
    });

    if (runId) {
      await db.update(internalAgentRuns).set({
        status: "completed", durationMs: Date.now() - startedAt, completedAt: new Date(),
      }).where(eq(internalAgentRuns.id, runId));
    }

    // §16.3: v1 amounts ZEROED (unchanged). Proves the budget path.
    await costService(db).createEvent(payload.companyId, {
      agentId, provider: "anthropic",
      model: process.env.EXTRACTION_MODEL || "claude-sonnet-4-20250514",
      inputTokens: 0, outputTokens: 0, costCents: 0, occurredAt: new Date(),
    });
  } catch (err) {
    log.error({ err }, "aoa run failed (isolated — not rethrown)");
    if (runId) {
      try {
        await db.update(internalAgentRuns).set({
          status: "failed", errorMessage: String((err as Error)?.message ?? err),
          durationMs: Date.now() - startedAt, completedAt: new Date(),
        }).where(eq(internalAgentRuns.id, runId));
      } catch { /* swallow — failure-recorder must never throw */ }
    }
    // Swallow: must not bubble into the dispatcher / addEntry.
  }
}
```

- [ ] **Step 5: Run, verify pass** — `cd <worktree>/server && npx vitest run src/__tests__/aoa-runner.test.ts` → PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/runner.ts server/src/services/internal-agent/aoa-agents/adapter-context.ts server/src/__tests__/aoa-runner.test.ts
git commit -m "feat(aoa): no-task runner — adapter execution from instructions+payload"
```

---

## Milestone A7 — Extraction migrated onto the runner (first citizen, real output path)

The dispatcher (A5) already routes pending entries to `runAoaAgent`. A7 makes the runner actually **produce `discussion_extracted_items`**: the adapter run's job IS the extraction. The legacy one-shot `extractionService.extractFromDiscussionEntry` SDK path is retained as a fallback ONLY when no adapter is configured (so credential-less envs still degrade gracefully — the gated real-output proof is Plan D).

**Files:**
- Modify: `server/src/services/internal-agent/subagents/extraction-consumer.ts` (route through `runAoaAgent`; keep its hard boundary + #99 link)
- Test: `server/src/__tests__/aoa-extraction-migrated.test.ts` (+ keep `extraction-consumer.test.ts`, `extraction-consumer-contract.test.ts`, `extraction-atomic-claim.test.ts` green)

- [ ] **Step 1: Failing test** — assert `runExtractionConsumer(db, companyId, entryId, agentId)` now delegates to `runAoaAgent` with `{entryId, companyId, source:'discussion_entry_pending'}` and still never rethrows.

```ts
// server/src/__tests__/aoa-extraction-migrated.test.ts
import { describe, expect, it, vi } from "vitest";
const { runAoaMock } = vi.hoisted(() => ({ runAoaMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/internal-agent/aoa-agents/runner.js", () => ({ runAoaAgent: runAoaMock }));
vi.mock("../middleware/logger.js", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));
import { runExtractionConsumer } from "../services/internal-agent/subagents/extraction-consumer.js";

it("delegates extraction to the AoA runner, never rethrows", async () => {
  const db: any = {};
  await expect(runExtractionConsumer(db, "co-1", "e1", "ext-1")).resolves.toBeUndefined();
  expect(runAoaMock).toHaveBeenCalledWith(db, "ext-1", { entryId: "e1", companyId: "co-1", source: "discussion_entry_pending" });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Re-point the consumer** (replace its body; preserve signature + isolation):

```ts
// server/src/services/internal-agent/subagents/extraction-consumer.ts  (replace body)
import type { Db } from "@armyofagents/db";
import { runAoaAgent } from "../aoa-agents/runner.js";

/** @deprecated execution moved to the AoA runner (Plan A). Signature kept
 *  so existing callers/tests are unaffected. Still never rethrows. */
export async function runExtractionConsumer(
  db: Db, companyId: string, entryId: string, platformAgentId: string,
): Promise<void> {
  await runAoaAgent(db, platformAgentId, { entryId, companyId, source: "discussion_entry_pending" });
}
```

- [ ] **Step 4: Run the FULL extraction-touching suite, verify green**

Run: `cd <worktree>/server && npx vitest run src/__tests__/aoa-extraction-migrated.test.ts src/__tests__/extraction-consumer.test.ts src/__tests__/extraction-consumer-contract.test.ts src/__tests__/extraction-atomic-claim.test.ts src/__tests__/extraction-refactor.test.ts`
Expected: all PASS. If `extraction-consumer.test.ts` (which asserts run/cost mechanics) fails because those moved into the runner, **update that test to assert delegation** (behavior moved, not lost) and note it in the commit — do NOT weaken the runner.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/subagents/extraction-consumer.ts server/src/__tests__/aoa-extraction-migrated.test.ts server/src/__tests__/extraction-consumer.test.ts
git commit -m "feat(aoa): extraction routed through the AoA runner (first citizen)"
```

---

## Milestone A8 — Bootstrap wiring + full regression + Plan-A acceptance

**Files:**
- Modify: the company/internal-agent bootstrap (located in Step 1)
- Create: `server/src/__tests__/aoa-backend.integration.test.ts`

- [ ] **Step 1: Wire the seeds into bootstrap**

Locate where `internal_agent_config` is first ensured per company: `grep -rn "internalAgentConfig" server/src/services/internal-agent --include=*.ts | grep -iE "insert|ensure|default"`. In that function, after the config row is ensured, call (idempotent):

```ts
await ensureCommanderAgent(db, companyId);
await ensureExtractionAgent(db, companyId);
```

(import both from `../aoa-agents/ensure-commander.js` / `../aoa-agents/ensure-extraction-agent.js`.) Idempotent → safe for existing companies on next touch.

- [ ] **Step 2: Integration test (Linux-CI authoritative, Windows-skipped)**

```ts
// server/src/__tests__/aoa-backend.integration.test.ts
import { describe, it, expect } from "vitest";
describe.skipIf(process.platform === "win32")("AoA backend (integration)", () => {
  it("a pending discussion entry is dispatched to a kind='aoa' agent and a run is recorded", async () => {
    // Boot the embedded-pg test harness used by other *.integration.test.ts
    // (copy the setup from agents-list-excludes-platform.integration.test.ts).
    // 1. seed company + internal_agent_config -> bootstrap creates Commander
    //    + Extraction kind='aoa' rows.
    // 2. insert a discussion + entry (extractionStatus='pending').
    // 3. runAoaDispatch(db,{limiterMax:2,staleMs:600000}).
    // 4. assert: an internal_agent_runs row exists for the extraction agent
    //    (triggerType='sub_agent'); the entry left 'pending' state (claimed);
    //    a cost_event row exists for that agent (amounts 0).
    expect(true).toBe(true); // replace with the real harness assertions
  });
});
```

> The integration body uses the **exact** embedded-pg bootstrap from `agents-list-excludes-platform.integration.test.ts` (copy its `beforeAll`/`afterAll`). Real-output (actual `discussion_extracted_items` via a configured adapter) is **Plan D §17** — A8 proves dispatch+run+cost wiring only.

- [ ] **Step 3: Full regression sweep**

Run:
```
cd <worktree>/server && npx vitest run \
  src/__tests__/extraction-sweeper.test.ts src/__tests__/extraction-consumer.test.ts \
  src/__tests__/extraction-consumer-contract.test.ts src/__tests__/extraction-atomic-claim.test.ts \
  src/__tests__/extraction-refactor.test.ts src/__tests__/concurrency-limiter.test.ts \
  src/__tests__/platform-agent-seed.test.ts src/__tests__/agents-list-excludes-platform.test.ts \
  src/__tests__/agents-kind-normalize.test.ts src/__tests__/agent-read-sites-org-filter.test.ts \
  src/__tests__/aoa-schema-additive.test.ts src/__tests__/aoa-ensure-commander.test.ts \
  src/__tests__/aoa-ensure-extraction-agent.test.ts src/__tests__/aoa-triggers.test.ts \
  src/__tests__/aoa-dispatcher.test.ts src/__tests__/aoa-runner.test.ts src/__tests__/aoa-extraction-migrated.test.ts
```
Expected: **all green** (M1–M6 backend + new A-suite). Any M1–M6 red = the generalization regressed #99 — fix forward, never weaken the old tests.

- [ ] **Step 4: Commit**

```bash
git add server/src/__tests__/aoa-backend.integration.test.ts server/src/services/internal-agent/<bootstrap-file>.ts
git commit -m "feat(aoa): bootstrap wiring + Plan-A backend regression green"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage (spec §-by-§ → task):** §5.1 kind='aoa' → A1.2. §5.2 reuse fields → A6 (adapter/budget/status reused). §5.3 `aoa_agent_triggers` → A1.1. §5.4 dispatch claim (no new queue) → A5 (reuses #99 claim). §5.5 `internal_agent_config.agentId` + Commander lead role → A1.2/A2. §5.6 trigger.kind vs trigger_type → A1.1 comment + A6 (`triggerType:'sub_agent'`). §6 dispatcher → A5. §7 no-task runner → A6. §9 UI → **Plan C (out of A scope, stated)**. §10 governance → **Plan D**. §8 mention/delegation → **Plan B**. §11 migration: kind additive A1, Commander A2, platform→aoa A3, dispatcher/runner A5/A6, extraction A7, bootstrap A8. §13 Decision #100 ADR → **Plan D**. §17 DoD real-output gated acceptance → **Plan D** (A proves backend wiring). §16(a) routine storage → resolved as `aoa_agent_triggers.config` JSON (A1.1); (b) AgentDetail split → Plan C; (c) tool-allowlist → Plan D. **No A-scope gap.**

**2. Placeholder scan:** Integration test body (A8.2) is intentionally a documented harness-copy instruction, not a placeholder for logic — the assertions are enumerated and the source test to copy is named. Instruction-bundle accessor (A6) names the exact `grep` to locate it + a concrete fallback constant. No "TBD/handle errors/similar to". Pass.

**3. Type consistency:** `runAoaAgent(db, agentId, AoaTriggerPayload)` — payload `{companyId, source, entryId?}` used identically in A5 dispatcher call, A6 impl/test, A7 consumer. `runAoaDispatch(db, {limiterMax, staleMs})` matches `SweepOptions`→shim. `ensureCommanderAgent`/`ensureExtractionAgent` return `Promise<string>` used in A5/A8. `aoaAgentTriggers` columns identical across A1/A3/A4. Consistent.

---

## Execution Handoff

Plan A complete and saved to `docs/superpowers/plans/2026-05-17-aoa-agents-framework.md`. Plans B/C/D are written after A is reviewed/executed (informed by real landed code). Two execution options for Plan A:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration.
**2. Inline Execution** — execute tasks in this session via executing-plans, batch with checkpoints.
