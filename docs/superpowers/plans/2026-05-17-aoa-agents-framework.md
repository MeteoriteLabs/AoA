# AoA Agents Framework — Plan A: Backend Foundation (v3 — spike-verified + #99/M2 claim preserved)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Commander + the discussion-extraction sub-agent become first-class `agents` rows (`kind='aoa'`), executed uniformly through the existing worker CLI adapter with the internal-agent MCP bridge attached, so the extraction agent really produces `discussion_extracted_items` by calling a new `submit-extracted-items` tool — proving the backend foundation for Plans B/C/D.

**Architecture:** Reuse-first, **uniform** (spec §7 LOCKED). Every AoA agent runs via `getServerAdapter(agent.adapterType).execute(...)` with `adapterConfig.args=["--mcp-config",<file>]` pointing at the existing `mcp-bridge.js` (built by the exported `buildMcpConfig`). Structured output is persisted by the agent calling the new `submit-extracted-items` internal-agent tool — **not** by parsing adapter stdout (spike S1: `AdapterExecutionResult` has no text field). Generalize the Decision-#99 sweeper into an AoA dispatcher. No hybrid executor. Provider-SDK stays a non-agent primitive (untouched).

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Vitest, Express. Spec: `docs/superpowers/specs/2026-05-17-aoa-agents-framework-design.md` (LOCKED, committed `a5fd13fd`). **Plan A of 4.**

**Worktree:** `AoA-2.5/.worktrees/commander-subagent-1`, branch `commander-subagent-1`. **Test cmd:** `cd <worktree>/server && npx vitest run src/__tests__/<file>`. **Git:** add specific files only, never `git add -A`.

**Spike-verified facts this plan depends on (do not re-question; cited inline):**
- `getServerAdapter(type)` — `server/src/adapters/registry.ts:251` (NOT `getAdapter`).
- `buildMcpConfig(params)` exported — `server/src/services/internal-agent/cli-mode.ts:70`; params `{companyId,userId,userRole,enabledCapabilities,bridgeEntrypoint}` → `{mcpServers:{aoa:{command:"node",args:[bridge],env:{AOA_SESSION_*}}}}`.
- `mcp-bridge.js` is a stdio MCP server exposing `createToolRegistry()` (`server/src/services/internal-agent/tool-registry.ts:12`); needs env `AOA_SESSION_COMPANY_ID/USER_ID/USER_ROLE/ENABLED_CAPABILITIES` + `DATABASE_URL`; tools are `AgentTool{name,description,parameters,...}` run via `executeTool(tool,args,ctx)→ToolResult{success,data,summary,error}`.
- `claude-local` adapter forwards `config.args` (`packages/adapters/claude-local/src/server/execute.ts:249`→`:415`) and `config.env`; injects instructions via `--append-system-prompt-file`, skills via `--add-dir`. Output streams (`stream-json`) via `onLog`; **we do not parse it** — persistence is the tool call.
- `resolveAdapterExecutionContext(config,adapter)` exported — `heartbeat.ts:172`.
- extraction item→row mapping + insert: `extraction.ts:582-611` (`db.insert(discussionExtractedItems).values(itemValues)`); `parseExtractedItems` exported `:202`.
- `agents.role` is special-cased (`agent-permissions.ts:11 role==='cxo'`, 0070 tiers) → **discriminator is `kind='aoa'` + `runtimeConfig.aoa.role`, never `agents.role`** (review Finding 4).

**Out of Plan A** (later plans / user-deferred): mention/delegation (B); all UI (C); RBAC/tool-allowlist/Decision-#100 ADR/§17 gated real-output acceptance (D); rich **marketplace-seeded** extraction skill (user-deferred extraction-behavior discussion — Plan A uses a minimal seeded instruction to prove the mechanism).

### #99 / M2 invariants the runner MUST preserve (review Finding 6 — non-negotiable)

The old `extraction-consumer` called `extractFromDiscussionEntry`, which **encapsulated** the M2 atomic claim (`extraction.ts:383-402`). The uniform runner does NOT call that function, so it must **reproduce these invariants itself** or extraction loses at-most-once and the dispatcher re-runs the same `pending` entry every tick (duplicate/infinite runs):

1. **Atomic claim before work:** `UPDATE discussion_entries SET extraction_status='processing', extraction_run_id=<runId> WHERE id=? AND extraction_status='pending' RETURNING`. If `RETURNING` is empty → the entry is already claimed/terminal → **abort this run** (mark the just-created run `failed` with `errorMessage:'not claimable (concurrent)'`, return). Mirrors `extraction.ts:389-402`.
2. **Linked-run orphan signal:** the claim sets `extraction_run_id` to THIS run's id at claim time — that is exactly what the dispatcher Phase-1 reclaim keys on (#99). Set it IN the claim UPDATE, not separately.
3. **Terminal transition is the tool's job:** `submit-extracted-items` sets `extraction_status='extracted'`. Adapter failure → run `failed`; the entry stays `processing` and is recovered by Phase-1 reclaim after `staleMs` (the #99 path — unchanged).
4. `extraction.ts`'s own claim **stays** (the reprocess/Q2-b direct path still uses `extractFromDiscussionEntry`); the runner ADDS its own claim for the AoA path. Both guarded on `extraction_status='pending'`, so concurrent-safe. `extraction-atomic-claim.test.ts` (tests `extraction.ts`) stays valid; A7 ADDS a runner-claim test.

---

## File Structure

**Create:** `packages/db/src/schema/aoa_agent_triggers.ts`; `server/src/services/internal-agent/aoa-agents/{ensure-commander,ensure-extraction-agent,triggers,dispatcher,runner,bridge-path}.ts`; `server/src/services/internal-agent/tools/submit-extracted-items.ts`; tests `server/src/__tests__/aoa-*.test.ts`.
**Modify:** `packages/db/src/schema/{agents.ts(comment),internal_agent.ts}`, schema barrel; `server/src/services/internal-agent/tool-registry.ts` (register the tool); `server/src/services/internal-agent/subagents/{extraction-sweeper,extraction-consumer}.ts` (shims); `server/src/index.ts` (no change — shim indirection); bootstrap file (A9 step 1).
**Reuse unchanged:** `registry.ts`, `cli-mode.ts buildMcpConfig`, `mcp-bridge.ts`, `concurrency-limiter.ts`, `costService`, `agents` status/pause, claude-local adapter.

---

## Milestone A1 — Schema

### Task A1.1: `aoa_agent_triggers`
**Files:** Create `packages/db/src/schema/aoa_agent_triggers.ts`; Modify schema barrel; Test `server/src/__tests__/aoa-schema-additive.test.ts`.

- [ ] **Step 1: Failing test**
```ts
// server/src/__tests__/aoa-schema-additive.test.ts
import { describe, expect, it } from "vitest";
import { aoaAgentTriggers } from "@armyofagents/db";
describe("aoa_agent_triggers schema", () => {
  it("has the expected columns", () => {
    const cols = Object.keys(aoaAgentTriggers);
    for (const c of ["id","companyId","agentId","kind","enabled","config","createdAt","updatedAt"]) expect(cols).toContain(c);
  });
});
```
- [ ] **Step 2: Run → FAIL** `cd <worktree>/server && npx vitest run src/__tests__/aoa-schema-additive.test.ts` (no export).
- [ ] **Step 3: Create schema** (drizzle; never hand-write SQL)
```ts
// packages/db/src/schema/aoa_agent_triggers.ts
import { pgTable, uuid, text, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/** Trigger binding for a kind='aoa' agent. `kind` is the dispatch binding
 *  (distinct from internal_agent_runs.trigger_type provenance — spec §5.6).
 *  'task' reserved (spec L11), NOT implemented v1. */
export const aoaAgentTriggers = pgTable("aoa_agent_triggers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'outbox'|'routine'|'event'|'mention'|'manual'|'conversation'
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyAgentIdx: index("aoa_triggers_company_agent_idx").on(t.companyId, t.agentId),
  companyKindEnabledIdx: index("aoa_triggers_company_kind_enabled_idx").on(t.companyId, t.kind, t.enabled),
}));
export const aoaAgentTriggersRelations = relations(aoaAgentTriggers, ({ one }) => ({
  company: one(companies, { fields: [aoaAgentTriggers.companyId], references: [companies.id] }),
  agent: one(agents, { fields: [aoaAgentTriggers.agentId], references: [agents.id] }),
}));
```
- [ ] **Step 4:** Add `export * from "./aoa_agent_triggers.js";` to the schema barrel (`packages/db/src/schema/index.ts`, alphabetical).
- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** `git add packages/db/src/schema/aoa_agent_triggers.ts packages/db/src/schema/index.ts server/src/__tests__/aoa-schema-additive.test.ts && git commit -m "feat(aoa): aoa_agent_triggers schema"`

### Task A1.2: `internal_agent_config.agentId` + `kind='aoa'` comment + migration
**Files:** Modify `packages/db/src/schema/internal_agent.ts`, `packages/db/src/schema/agents.ts:21`; Test extends A1.1 test.

- [ ] **Step 1: Add failing assertion**
```ts
  it("internal_agent_config + internal_agent_runs expose agentId", async () => {
    const { internalAgentConfig, internalAgentRuns } = await import("@armyofagents/db");
    expect(Object.keys(internalAgentConfig)).toContain("agentId");
    expect(Object.keys(internalAgentRuns)).toContain("agentId"); // Finding R1
  });
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3:** In `internal_agent.ts`: add `import { agents } from "./agents.js";`; after `metadata: jsonb("metadata").default({}),` add:
```ts
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
```
and in `internalAgentConfigRelations` `one(...)` add `agent: one(agents, { fields: [internalAgentConfig.agentId], references: [agents.id] }),`.

**ALSO (review Finding R1 — required for Plan C's per-agent Runs tab):** the `internalAgentRuns` table (same file) has **no agent attribution** today (only `relatedEntityType/Id` = the discussion entry). Add an indexed nullable `agentId` so runs are filterable per AoA agent. After `userId: text("user_id"),` in `internalAgentRuns` add:
```ts
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
```
and add to its index block: `agentIdx: index("ia_runs_agent_idx").on(table.companyId, table.agentId),`. (Additive, nullable — existing rows unaffected; the A7 runner sets it.)

In `agents.ts:21` change the comment only: `// 'org' | 'platform' | 'aoa' — 'aoa' = Commander + sub-agents (trigger-driven)`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Generate migration** `cd <worktree> && pnpm db:generate`. Open the emitted `packages/db/src/migrations/00NN_*.sql`; confirm it is **additive only** (`CREATE TABLE aoa_agent_triggers`, `ALTER TABLE internal_agent_config ADD COLUMN agent_id`, `ALTER TABLE internal_agent_runs ADD COLUMN agent_id` + the new index). Never hand-edit it.
- [ ] **Step 6: Commit** `git add packages/db/src/schema/internal_agent.ts packages/db/src/schema/agents.ts packages/db/src/migrations/ server/src/__tests__/aoa-schema-additive.test.ts && git commit -m "feat(aoa): internal_agent_config.agentId + kind='aoa'; migration"`

---

## Milestone A2 — Commander as a `kind='aoa'` row (discriminator via runtimeConfig.aoa)

**Files:** Create `server/src/services/internal-agent/aoa-agents/ensure-commander.ts`; Test `server/src/__tests__/aoa-ensure-commander.test.ts`.

- [ ] **Step 1: Failing test** (harness mirrors `platform-agent-seed.test.ts`)
```ts
// server/src/__tests__/aoa-ensure-commander.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const { eqMock, andMock } = vi.hoisted(() => ({ eqMock: vi.fn((a:unknown,b:unknown)=>({eq:[a,b]})), andMock: vi.fn((...a:unknown[])=>({and:a})) }));
vi.mock("drizzle-orm", () => ({ and: andMock, eq: eqMock }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agents:t("agents"), internalAgentConfig:t("iac") }; });
import { ensureCommanderAgent } from "../services/internal-agent/aoa-agents/ensure-commander.js";
function sel(rows:unknown[]){const c:any={};c.from=()=>c;c.where=()=>c;c.then=(r:(v:unknown[])=>unknown)=>Promise.resolve(rows).then(r);return c;}
describe("ensureCommanderAgent", () => {
  beforeEach(() => { eqMock.mockClear(); andMock.mockClear(); });
  it("returns existing commander id, no insert", async () => {
    const insert = vi.fn();
    const db:any = { select:()=>sel([{id:"cmd-1"}]), insert, update:()=>({set:()=>({where:()=>Promise.resolve([])})}) };
    expect(await ensureCommanderAgent(db,"co-1")).toBe("cmd-1"); expect(insert).not.toHaveBeenCalled();
  });
  it("creates kind='aoa' role='general' runtimeConfig.aoa.role='lead' + links config", async () => {
    const av:any[]=[]; const sv:any[]=[];
    const db:any = { select:()=>sel([]), insert:()=>({values:(v:any)=>{av.push(v);return{returning:()=>Promise.resolve([{id:"cmd-new"}])};}}), update:()=>({set:(v:any)=>{sv.push(v);return{where:()=>Promise.resolve([])};}}) };
    expect(await ensureCommanderAgent(db,"co-1")).toBe("cmd-new");
    expect(av[0].kind).toBe("aoa");
    expect(av[0].role).toBe("general"); // NOT overloaded
    expect(av[0].runtimeConfig.aoa).toEqual({ role: "lead" });
    expect(av[0].runtimeConfig.heartbeat).toEqual({ enabled:false, intervalSec:0 });
    expect(sv.some((s)=>s.agentId==="cmd-new")).toBe(true);
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
```ts
// server/src/services/internal-agent/aoa-agents/ensure-commander.ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, internalAgentConfig } from "@armyofagents/db";

export const COMMANDER_AGENT_NAME = "Commander";

/** Idempotently ensure the per-company Commander kind='aoa' row + link
 *  internal_agent_config.agentId. Chat loop (agent-loop.ts) unaffected.
 *  Discriminator: kind='aoa' + runtimeConfig.aoa.role='lead' (NOT agents.role
 *  — that is special-cased: agent-permissions.ts role==='cxo', 0070 tiers). */
export async function ensureCommanderAgent(db: Db, companyId: string): Promise<string> {
  const existing = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa"), eq(agents.name, COMMANDER_AGENT_NAME)))
    .then((r: { id: string }[]) => r[0] ?? null);
  let agentId = existing?.id ?? null;
  if (!agentId) {
    const [created] = await db.insert(agents).values({
      companyId, name: COMMANDER_AGENT_NAME, kind: "aoa", role: "general", status: "idle",
      adapterType: "process",
      runtimeConfig: { aoa: { role: "lead" }, heartbeat: { enabled: false, intervalSec: 0 } },
    }).returning();
    agentId = created.id;
  }
  await db.update(internalAgentConfig).set({ agentId, updatedAt: new Date() })
    .where(eq(internalAgentConfig.companyId, companyId));
  return agentId;
}
```
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git add server/src/services/internal-agent/aoa-agents/ensure-commander.ts server/src/__tests__/aoa-ensure-commander.test.ts && git commit -m "feat(aoa): ensureCommanderAgent (kind='aoa' lead via runtimeConfig)"`

---

## Milestone A3 — Extraction as the first `kind='aoa'` agent + outbox trigger + seeded instruction

**Files:** Create `server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts`; Test `server/src/__tests__/aoa-ensure-extraction-agent.test.ts`.

The agent's `adapterType` defaults to `process` for safety (deterministic, no external CLI needed for unit/integration); a real run uses `claude_local` when configured (Plan D gated acceptance). Its `runtimeConfig.aoa.instruction` carries the **minimal seeded instruction** (rich marketplace skill = user-deferred). Instruction text: *"You are the discussion-extraction agent. Read the discussion entry in your context. Identify decisions, tasks, insights, context, references and preferences. Call the `submit-extracted-items` tool with the structured items. Do not output anything else."*

- [ ] **Step 1: Failing test**
```ts
// server/src/__tests__/aoa-ensure-extraction-agent.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const { eqMock, andMock } = vi.hoisted(() => ({ eqMock: vi.fn((a:unknown,b:unknown)=>({eq:[a,b]})), andMock: vi.fn((...a:unknown[])=>({and:a})) }));
vi.mock("drizzle-orm", () => ({ and: andMock, eq: eqMock }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agents:t("agents"), aoaAgentTriggers:t("agt") }; });
import { ensureExtractionAgent, EXTRACTION_AGENT_NAME } from "../services/internal-agent/aoa-agents/ensure-extraction-agent.js";
function sel(rows:unknown[]){const c:any={};c.from=()=>c;c.where=()=>c;c.then=(r:(v:unknown[])=>unknown)=>Promise.resolve(rows).then(r);return c;}
describe("ensureExtractionAgent", () => {
  beforeEach(() => { eqMock.mockClear(); andMock.mockClear(); });
  it("creates kind='aoa' member + enabled outbox trigger + seeded instruction", async () => {
    const av:any[]=[]; const tv:any[]=[]; let n=0;
    const db:any = { select:()=>sel([]), insert:()=>{const w=n++;return{values:(v:any)=>{(w===0?av:tv).push(v);return{returning:()=>Promise.resolve([{id:w===0?"ext-1":"trg-1"}])};}};} };
    const id = await ensureExtractionAgent(db,"co-1");
    expect(id).toBe("ext-1");
    expect(av[0].kind).toBe("aoa"); expect(av[0].role).toBe("general");
    expect(av[0].runtimeConfig.aoa.role).toBe("member");
    expect(typeof av[0].runtimeConfig.aoa.instruction).toBe("string");
    expect(av[0].runtimeConfig.aoa.instruction).toContain("submit-extracted-items");
    expect(tv[0].kind).toBe("outbox");
    expect(tv[0].config).toEqual({ source: "discussion_entry_pending" });
  });
  it("idempotent: existing id, no insert", async () => {
    const insert = vi.fn();
    expect(await ensureExtractionAgent({ select:()=>sel([{id:"ext-x"}]), insert } as any,"co-1")).toBe("ext-x");
    expect(insert).not.toHaveBeenCalled();
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
```ts
// server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers } from "@armyofagents/db";

export const EXTRACTION_AGENT_NAME = "Discussion Extraction";
export const EXTRACTION_INSTRUCTION =
  "You are the discussion-extraction agent. Read the discussion entry in your " +
  "context. Identify decisions, tasks, insights, context, references and " +
  "preferences. Call the `submit-extracted-items` tool with the structured " +
  "items. Do not output anything else.";

export async function ensureExtractionAgent(db: Db, companyId: string): Promise<string> {
  const existing = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa"), eq(agents.name, EXTRACTION_AGENT_NAME)))
    .then((r: { id: string }[]) => r[0] ?? null);
  if (existing) return existing.id;
  const [created] = await db.insert(agents).values({
    companyId, name: EXTRACTION_AGENT_NAME, kind: "aoa", role: "general", status: "idle",
    adapterType: "process",
    runtimeConfig: { aoa: { role: "member", instruction: EXTRACTION_INSTRUCTION }, heartbeat: { enabled: false, intervalSec: 0 } },
  }).returning();
  await db.insert(aoaAgentTriggers).values({
    companyId, agentId: created.id, kind: "outbox", enabled: true,
    config: { source: "discussion_entry_pending" },
  });
  return created.id;
}
```
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git add server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts server/src/__tests__/aoa-ensure-extraction-agent.test.ts && git commit -m "feat(aoa): ensureExtractionAgent (first kind='aoa' citizen + outbox)"`

---

## Milestone A4 — Trigger evaluation
**Files:** Create `server/src/services/internal-agent/aoa-agents/triggers.ts`; Test `server/src/__tests__/aoa-triggers.test.ts`.

- [ ] **Step 1: Failing test**
```ts
// server/src/__tests__/aoa-triggers.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const { eqMock, andMock } = vi.hoisted(() => ({ eqMock: vi.fn((a:unknown,b:unknown)=>({eq:[a,b]})), andMock: vi.fn((...a:unknown[])=>({and:a})) }));
vi.mock("drizzle-orm", () => ({ and: andMock, eq: eqMock }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { aoaAgentTriggers:t("agt"), agents:t("a") }; });
import { listEnabledOutboxAgents } from "../services/internal-agent/aoa-agents/triggers.js";
function sel(rows:unknown[]){const c:any={};c.from=()=>c;c.innerJoin=()=>c;c.where=()=>c;c.then=(r:(v:unknown[])=>unknown)=>Promise.resolve(rows).then(r);return c;}
describe("aoa triggers", () => {
  beforeEach(()=>{eqMock.mockClear();andMock.mockClear();});
  it("returns non-paused agents with an enabled outbox trigger for a company", async () => {
    const db:any = { select:()=>sel([{agentId:"ext-1",status:"idle"},{agentId:"ext-2",status:"paused"}]) };
    expect(await listEnabledOutboxAgents(db,"co-1")).toEqual(["ext-1"]);
  });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
```ts
// server/src/services/internal-agent/aoa-agents/triggers.ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { aoaAgentTriggers, agents } from "@armyofagents/db";

/** Agent ids in `companyId` that have an enabled `outbox`
 *  (discussion_entry_pending) trigger and are not paused/terminated.
 *  v1 implements outbox only; routine/event/mention are recognized
 *  kinds with no evaluator yet (the seam exists, Plan B extends). */
export async function listEnabledOutboxAgents(db: Db, companyId: string): Promise<string[]> {
  const rows = await db
    .select({ agentId: aoaAgentTriggers.agentId, status: agents.status })
    .from(aoaAgentTriggers)
    .innerJoin(agents, eq(agents.id, aoaAgentTriggers.agentId))
    .where(and(
      eq(aoaAgentTriggers.companyId, companyId),
      eq(aoaAgentTriggers.kind, "outbox"),
      eq(aoaAgentTriggers.enabled, true),
    ))
    .then((r: Array<{ agentId: string; status: string }>) => r);
  return rows.filter((r) => r.status !== "paused" && r.status !== "terminated").map((r) => r.agentId);
}
```
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `git add server/src/services/internal-agent/aoa-agents/triggers.ts server/src/__tests__/aoa-triggers.test.ts && git commit -m "feat(aoa): enabled-outbox-agent evaluation (paused-aware)"`

---

## Milestone A5 — `submit-extracted-items` tool (THE LINCHPIN)

**Files:** Create `server/src/services/internal-agent/tools/submit-extracted-items.ts`; Modify `server/src/services/internal-agent/tool-registry.ts`; Test `server/src/__tests__/aoa-submit-extracted-items.test.ts`.

- [ ] **Step 1: Read the existing pattern (required before writing the tool — no-placeholder honesty).** Run: open `server/src/services/internal-agent/tool-registry.ts` and ONE existing tool it registers (follow an import) + `server/src/services/internal-agent/types.ts` for `AgentTool`/`ToolContext`/`ToolResult`. Confirm: the exact `AgentTool` shape (`name`, `description`, `parameters` JSON-schema, `execute`/handler signature), how `createToolRegistry()` assembles the array, and how `ToolContext` exposes `db`/`companyId`. Also open `extraction.ts:570-611` for the `ExtractedItem`→`discussionExtractedItems` value mapping to reuse. Note the exact shapes in the commit message.
- [ ] **Step 2: Failing test** (assert the tool inserts mapped rows; adjust the harness to the `AgentTool` shape learned in Step 1 — the assertions below are stable regardless of shape)
```ts
// server/src/__tests__/aoa-submit-extracted-items.test.ts
import { describe, expect, it, vi } from "vitest";
vi.mock("drizzle-orm", () => ({ eq: (a:unknown,b:unknown)=>({eq:[a,b]}) }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { discussionExtractedItems:t("dei"), discussionEntries:t("de") }; });
import { submitExtractedItemsTool } from "../services/internal-agent/tools/submit-extracted-items.js";

it("inserts mapped discussion_extracted_items and reports count", async () => {
  const inserted:any[]=[];
  const db:any = { insert:()=>({values:(v:any)=>{inserted.push(v);return Promise.resolve([]);}}) };
  const ctx:any = { db, companyId:"co-1" };
  const res = await submitExtractedItemsTool.handler(
    { entryId:"e1", items:[{ type:"task", content:"Ship X", confidence:0.9 }] }, ctx);
  expect(res.success).toBe(true);
  expect(inserted[0][0].discussionEntryId ?? inserted[0][0].entryId).toBe("e1");
  expect(res.data.count).toBe(1);
});
```
> If Step 1 shows the registry uses a different handler key than `.handler` or a different result field, update this test to that shape (behavior asserted — insert happened, count returned — is what matters). Record the chosen shape in the commit.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement the tool** (mirror the `AgentTool` shape from Step 1; logic below is exact — reuse the `extraction.ts:582-611` mapping verbatim for the value object: `discussionEntryId`, `companyId`, `itemType`, `content`, `confidence`, `status:'pending'` — match the real column names found in Step 1)
```ts
// server/src/services/internal-agent/tools/submit-extracted-items.ts
import { eq } from "drizzle-orm";
import { discussionExtractedItems, discussionEntries } from "@armyofagents/db";
import type { AgentTool, ToolContext, ToolResult } from "../types.js";

interface SubmitItem { type: string; content: string; confidence?: number; }

export const submitExtractedItemsTool: AgentTool = {
  name: "submit-extracted-items",
  description:
    "Persist structured items extracted from a discussion entry. Call once " +
    "with all items. items[] = { type, content, confidence? }.",
  parameters: {
    type: "object",
    required: ["entryId", "items"],
    properties: {
      entryId: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object", required: ["type", "content"],
          properties: {
            type: { type: "string" }, content: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
    },
  },
  // Signature MUST match the shape learned in Step 1 (handler vs execute,
  // ctx fields). The body is exact:
  handler: async (args: { entryId: string; items: SubmitItem[] }, ctx: ToolContext): Promise<ToolResult> => {
    const items = Array.isArray(args.items) ? args.items : [];
    if (items.length > 0) {
      const values = items.map((it) => ({
        discussionEntryId: args.entryId,
        companyId: ctx.companyId,
        itemType: it.type,
        content: it.content,
        confidence: typeof it.confidence === "number" ? it.confidence : null,
        status: "pending",
      }));
      await ctx.db.insert(discussionExtractedItems).values(values);
    }
    // Mark the entry extracted (mirrors extraction.ts terminal state).
    await ctx.db.update(discussionEntries)
      .set({ extractionStatus: "extracted" })
      .where(eq(discussionEntries.id, args.entryId));
    return { success: true, data: { count: items.length }, summary: `Extracted ${items.length} item(s)` };
  },
};
```
- [ ] **Step 5: Register it** — in `tool-registry.ts` `createToolRegistry()`, add `submitExtractedItemsTool` to the returned array (import it). Gate it behind the same capability mechanism existing write-tools use (Step 1 shows how; if capability-gated, add its capability key to the constant the bridge passes — A7 sets `enabledCapabilities`).
- [ ] **Step 6: Run → PASS** (adjust harness per Step 1 shape if needed).
- [ ] **Step 7: Commit** `git add server/src/services/internal-agent/tools/submit-extracted-items.ts server/src/services/internal-agent/tool-registry.ts server/src/__tests__/aoa-submit-extracted-items.test.ts && git commit -m "feat(aoa): submit-extracted-items internal-agent tool (linchpin)"`

---

## Milestone A6 — AoA Dispatcher (generalized #99, coherent per-company)

Fixes review Finding 2+3. The dispatcher stays company-agnostic over pending entries **exactly like the #99 sweeper** (drain all `extractionStatus='pending'`, resolve the agent per company) — BUT only for companies whose extraction agent has an enabled outbox trigger (gating via `listEnabledOutboxAgents` per company). It routes through `runExtractionConsumer` so **`extraction-sweeper.test.ts` stays honest** (that test asserts the consumer is called); the consumer (A8) is the thin entrypoint to the runner.

**Files:** Create `server/src/services/internal-agent/aoa-agents/dispatcher.ts`; Modify `server/src/services/internal-agent/subagents/extraction-sweeper.ts` (shim); Test `server/src/__tests__/aoa-dispatcher.test.ts` + keep `extraction-sweeper.test.ts` green.

- [ ] **Step 1: Failing test** (reuse `extraction-sweeper.test.ts`'s `makeDb` sequence-mock as `makeSeqDb`; assert: pending entry → `runExtractionConsumer(db, companyId, entryId, extractionAgentId)`; stale linked run reclaimed; company with no enabled outbox trigger is skipped)
```ts
// server/src/__tests__/aoa-dispatcher.test.ts  (abridged; full mock mirrors extraction-sweeper.test.ts)
import { describe, expect, it, vi } from "vitest";
const { consumerMock, ensureExtMock, listOutboxMock } = vi.hoisted(() => ({
  consumerMock: vi.fn().mockResolvedValue(undefined),
  ensureExtMock: vi.fn().mockResolvedValue("ext-1"),
  listOutboxMock: vi.fn().mockResolvedValue(["ext-1"]),
}));
vi.mock("../services/internal-agent/subagents/extraction-consumer.js", () => ({ runExtractionConsumer: consumerMock }));
vi.mock("../services/internal-agent/aoa-agents/ensure-extraction-agent.js", () => ({ ensureExtractionAgent: ensureExtMock }));
vi.mock("../services/internal-agent/aoa-agents/triggers.js", () => ({ listEnabledOutboxAgents: listOutboxMock }));
vi.mock("drizzle-orm", () => ({ and:(...a:unknown[])=>({and:a}), eq:(a:unknown,b:unknown)=>({eq:[a,b]}), lt:(a:unknown,b:unknown)=>({lt:[a,b]}), inArray:(a:unknown,b:unknown)=>({inArray:[a,b]}) }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { discussionEntries:t("de"), discussions:t("d"), internalAgentRuns:t("iar") }; });
vi.mock("../middleware/logger.js", () => ({ logger:{ child:()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn()}) } }));
import { runAoaDispatch } from "../services/internal-agent/aoa-agents/dispatcher.js";
it("drains pending entries via the consumer for outbox-enabled companies", async () => {
  const db = makeSeqDb([[], [{ id:"e1", companyId:"co-1" }]]); // [orphan-select, pending-drain]
  await runAoaDispatch(db, { limiterMax:2, staleMs:600_000 });
  expect(consumerMock).toHaveBeenCalledWith(db, "co-1", "e1", "ext-1");
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (Phase 1 = the verbatim #99 linked-run reclaim from `extraction-sweeper.ts`; Phase 2 = drain pending, per row resolve company → skip if `listEnabledOutboxAgents(db,companyId)` empty, else `ensureExtractionAgent` + `runExtractionConsumer` under the limiter)
```ts
// server/src/services/internal-agent/aoa-agents/dispatcher.ts
import { and, eq, lt, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussionEntries, discussions, internalAgentRuns } from "@armyofagents/db";
import { listEnabledOutboxAgents } from "./triggers.js";
import { ensureExtractionAgent } from "./ensure-extraction-agent.js";
import { runExtractionConsumer } from "../subagents/extraction-consumer.js";
import { createLimiter } from "../subagents/concurrency-limiter.js";
import { logger } from "../../../middleware/logger.js";

export interface DispatchOptions { limiterMax: number; staleMs: number; }

export async function runAoaDispatch(db: Db, opts: DispatchOptions): Promise<void> {
  const staleCutoff = new Date(Date.now() - opts.staleMs);

  // Phase 1 — Decision #99 linked-run orphan reclaim (verbatim from
  // extraction-sweeper.ts; unchanged semantics).
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
    const ids = [...new Set(orphanRows.map((o) => o.id))];
    const runIds = [...new Set(orphanRows.map((o) => o.runId).filter((v): v is string => typeof v === "string"))];
    if (runIds.length > 0) {
      await db.update(internalAgentRuns)
        .set({ status: "failed", errorMessage: "reclaimed: orphaned (aoa-dispatcher)", completedAt: new Date() })
        .where(and(inArray(internalAgentRuns.id, runIds), eq(internalAgentRuns.status, "running")));
    }
    await db.update(discussionEntries)
      .set({ extractionStatus: "pending", extractionRunId: null })
      .where(and(inArray(discussionEntries.id, ids), eq(discussionEntries.extractionStatus, "processing")));
  }

  // Phase 2 — drain pending; per-company gate via enabled outbox trigger.
  const rows: Array<{ id: string; companyId: string }> = await db
    .select({ id: discussionEntries.id, companyId: discussions.companyId })
    .from(discussionEntries)
    .innerJoin(discussions, eq(discussions.id, discussionEntries.discussionId))
    .where(eq(discussionEntries.extractionStatus, "pending"))
    .limit(200)
    .then((r: Array<{ id: string; companyId: string }>) => r);
  if (rows.length === 0) return;

  const limiter = createLimiter(opts.limiterMax);
  const enabledByCompany = new Map<string, boolean>();
  const agentByCompany = new Map<string, string>();

  await Promise.allSettled(rows.map((row) => limiter.run(async () => {
    let enabled = enabledByCompany.get(row.companyId);
    if (enabled === undefined) {
      enabled = (await listEnabledOutboxAgents(db, row.companyId)).length > 0;
      enabledByCompany.set(row.companyId, enabled);
    }
    if (!enabled) return; // no outbox trigger for this company — skip (back-compat: bootstrap A9 seeds it)
    let agentId = agentByCompany.get(row.companyId);
    if (!agentId) { agentId = await ensureExtractionAgent(db, row.companyId); agentByCompany.set(row.companyId, agentId); }
    await runExtractionConsumer(db, row.companyId, row.id, agentId);
  })));

  logger.child({ svc: "aoa-dispatcher" }).info({ reclaimed: orphanRows.length, scanned: rows.length }, "aoa dispatch complete");
}
```
> **Back-compat note:** existing companies created before A9 won't have an outbox trigger until bootstrap touches them. A9 Step 1 makes bootstrap idempotently seed it; until then those entries are simply not dispatched (no error, no loss — they stay `pending`, drained once seeded). This is acceptable and matches the durable-outbox guarantee.
- [ ] **Step 4: Shim `extraction-sweeper.ts`** (preserve its public API + tests):
```ts
// server/src/services/internal-agent/subagents/extraction-sweeper.ts  (replace body)
import type { Db } from "@armyofagents/db";
import { runAoaDispatch } from "../aoa-agents/dispatcher.js";
export interface SweepOptions { limiterMax: number; staleMs: number; }
/** @deprecated superseded by runAoaDispatch (AoA framework, Plan A). Shim
 *  so existing callers (server/src/index.ts) + tests are unaffected. */
export async function runExtractionSweep(db: Db, opts: SweepOptions): Promise<void> {
  await runAoaDispatch(db, opts);
}
```
- [ ] **Step 5: Run BOTH** `cd <worktree>/server && npx vitest run src/__tests__/aoa-dispatcher.test.ts src/__tests__/extraction-sweeper.test.ts`. Expected: `aoa-dispatcher` PASS; **`extraction-sweeper` 4/4 PASS** (it asserts `runExtractionConsumer` is called — the dispatcher routes through it, so it holds). If `extraction-sweeper` red: the dispatcher diverged from #99 — fix the dispatcher, never the old test.
- [ ] **Step 6: Commit** `git add server/src/services/internal-agent/aoa-agents/dispatcher.ts server/src/services/internal-agent/subagents/extraction-sweeper.ts server/src/__tests__/aoa-dispatcher.test.ts && git commit -m "feat(aoa): generalized dispatcher (#99 preserved; sweeper is a shim)"`

---

## Milestone A7 — No-task runner (worker adapter + MCP bridge attached)

`runAoaAgent(db, agentId, payload)`: load agent; resolve adapter via **`getServerAdapter`**; write a `buildMcpConfig(...)` temp file; set `adapterConfig.args=["--mcp-config",cfgPath]` + the discussion content into `context`; `adapter.execute(...)` (stdout via `onLog` is **discarded** — persistence is the `submit-extracted-items` tool call); hard error boundary; record `internal_agent_runs` + `cost_event`.

**Files:** Create `server/src/services/internal-agent/aoa-agents/{bridge-path,runner}.ts`; Test `server/src/__tests__/aoa-runner.test.ts`.

- [ ] **Step 1: Read prerequisites (no-placeholder honesty).** Open `server/src/services/internal-agent/cli-mode.ts:60-90` (`McpConfigParams`/`buildMcpConfig` exact param names + the `getBridgeEntrypoint` resolve logic) and `server/src/services/internal-agent/authorize-tool.ts` (the `userRole` ranking + capability the `submit-extracted-items` tool requires). Record the exact role/capability the bridge session must carry for the tool to be callable.
- [ ] **Step 2: Failing test**
```ts
// server/src/__tests__/aoa-runner.test.ts
import { describe, expect, it, vi } from "vitest";
const { execMock, createEventMock, buildMcpMock } = vi.hoisted(() => ({
  execMock: vi.fn().mockResolvedValue({ exitCode: 0 }),
  createEventMock: vi.fn().mockResolvedValue(undefined),
  buildMcpMock: vi.fn(() => ({ mcpServers: {} })),
}));
vi.mock("drizzle-orm", () => ({ eq:(a:unknown,b:unknown)=>({eq:[a,b]}) }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agents:t("a"), internalAgentRuns:t("iar"), discussionEntries:t("de") }; });
vi.mock("../adapters/registry.js", () => ({ getServerAdapter: () => ({ execute: execMock, getRuntimeCommandSpec: () => ({}) }) }));
vi.mock("../services/costs.js", () => ({ costService: () => ({ createEvent: createEventMock }) }));
vi.mock("../services/internal-agent/cli-mode.js", () => ({ buildMcpConfig: buildMcpMock }));
vi.mock("../services/heartbeat.js", () => ({ resolveAdapterExecutionContext: () => ({ executionTarget:{}, runtimeCommandSpec:{} }) }));
vi.mock("../services/internal-agent/aoa-agents/bridge-path.js", () => ({ resolveBridgeEntrypoint: () => "/x/mcp-bridge.js" }));
vi.mock("node:fs/promises", () => ({ writeFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../middleware/logger.js", () => ({ logger:{ child:()=>({info:vi.fn(),warn:vi.fn(),error:vi.fn()}) } }));
import { runAoaAgent } from "../services/internal-agent/aoa-agents/runner.js";
function ch(ret:unknown[]){const c:any={};c.values=()=>c;c.set=()=>c;c.where=()=>c;c.from=()=>c;c.returning=()=>Promise.resolve(ret);c.then=(r:(v:unknown[])=>unknown)=>Promise.resolve(ret).then(r);return c;}
it("happy: bridge attached via adapterConfig.args, run completed, cost emitted", async () => {
  const db:any = { select:()=>ch([{ id:"ext-1", companyId:"co-1", adapterType:"process", adapterConfig:{}, runtimeConfig:{ aoa:{ instruction:"do extraction" } } }]), insert:()=>ch([{id:"run-1"}]), update:()=>ch([{id:"run-1"}]) };
  await runAoaAgent(db, "ext-1", { companyId:"co-1", source:"discussion_entry_pending", entryId:"e1" });
  expect(buildMcpMock).toHaveBeenCalled();
  const execArg = execMock.mock.calls[0][0];
  expect(execArg.config.args).toContain("--mcp-config");
  expect(createEventMock).toHaveBeenCalledTimes(1);
  expect(createEventMock.mock.calls[0][1].agentId).toBe("ext-1");
  expect(createEventMock.mock.calls[0][1].costCents).toBe(0); // §16.3 zeroed (unchanged)
});
it("failure isolated: adapter throws → never rethrows", async () => {
  execMock.mockRejectedValueOnce(new Error("boom"));
  const db:any = { select:()=>ch([{ id:"ext-1", companyId:"co-1", adapterType:"process", adapterConfig:{}, runtimeConfig:{} }]), insert:()=>ch([{id:"run-2"}]), update:()=>ch([{id:"run-2"}]) };
  await expect(runAoaAgent(db,"ext-1",{ companyId:"co-1", source:"discussion_entry_pending", entryId:"e2" })).resolves.toBeUndefined();
});
it("not claimable (concurrent): atomic claim empty → adapter NOT called, returns", async () => {
  execMock.mockClear();
  const claimChain:any = { set:()=>claimChain, where:()=>claimChain, returning:()=>Promise.resolve([]) };
  let upd = 0;
  const db:any = {
    select:()=>ch([{ id:"ext-1", companyId:"co-1", adapterType:"process", adapterConfig:{}, runtimeConfig:{} }]),
    insert:()=>ch([{ id:"run-9" }]),
    update:()=> (upd++ === 0 ? claimChain : ch([{ id:"run-9" }])), // 1st update = the claim (empty ⇒ abort)
  };
  await expect(runAoaAgent(db,"ext-1",{ companyId:"co-1", source:"discussion_entry_pending", entryId:"e9" })).resolves.toBeUndefined();
  expect(execMock).not.toHaveBeenCalled();
});
```
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `bridge-path.ts`** (replicate cli-mode's resolve; no export exists to reuse)
```ts
// server/src/services/internal-agent/aoa-agents/bridge-path.ts
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
/** Path to the compiled mcp-bridge entrypoint (mirrors cli-mode.ts
 *  getBridgeEntrypoint). The bridge lives one dir up from aoa-agents/. */
export function resolveBridgeEntrypoint(): string {
  const here = typeof __dirname !== "undefined" ? __dirname : fileURLToPath(new URL(".", import.meta.url));
  return resolve(here, "..", "mcp-bridge.js");
}
```
- [ ] **Step 5: Implement the runner** (param names for `buildMcpConfig` + the session `userRole`/`enabledCapabilities` constants come from Step 1 — fill the two constants with the values recorded there)
```ts
// server/src/services/internal-agent/aoa-agents/runner.ts
import { and, eq } from "drizzle-orm";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile } from "node:fs/promises";
import type { Db } from "@armyofagents/db";
import { agents, internalAgentRuns, discussionEntries } from "@armyofagents/db";
import { getServerAdapter } from "../../../adapters/registry.js";
import { costService } from "../../costs.js";
import { buildMcpConfig } from "../cli-mode.js";
import { resolveAdapterExecutionContext } from "../../heartbeat.js";
import { resolveBridgeEntrypoint } from "./bridge-path.js";
import { logger } from "../../../middleware/logger.js";

export interface AoaTriggerPayload { companyId: string; source: string; entryId?: string; [k: string]: unknown; }

// From Step 1 (authorize-tool.ts): the system session identity a sub-agent
// run uses so the bridge accepts submit-extracted-items. Replace with the
// exact role/capabilities recorded in Step 1.
const SUBAGENT_SESSION_USER_ID = "aoa-subagent";
const SUBAGENT_SESSION_USER_ROLE = "founder"; // ← confirm/replace per Step 1 ranking
const SUBAGENT_ENABLED_CAPABILITIES = ["discussion_processing"]; // ← + the cap gating submit-extracted-items per Step 1

export async function runAoaAgent(db: Db, agentId: string, payload: AoaTriggerPayload): Promise<void> {
  const log = logger.child({ svc: "aoa-runner", agentId, companyId: payload.companyId });
  const startedAt = Date.now();
  let runId: string | null = null;
  try {
    const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((r: any[]) => r[0] ?? null);
    if (!agent) { log.warn("aoa agent missing; skip"); return; }

    const inserted = await db.insert(internalAgentRuns).values({
      companyId: payload.companyId, agentId, // Finding R1: per-agent attribution (Plan C Runs tab)
      triggerType: "sub_agent", triggerSource: payload.source,
      status: "running", relatedEntityType: payload.entryId ? "discussion" : null,
      relatedEntityId: payload.entryId ?? null, userId: null,
    }).returning();
    runId = inserted[0]?.id ?? null;

    // M2/#99 atomic claim (invariant #1): flip pending→processing AND link
    // extraction_run_id in ONE statement. Empty RETURNING ⇒ already claimed
    // by a concurrent run ⇒ abort (mirrors extraction.ts:389-402). Without
    // this the dispatcher re-runs the same pending entry every tick.
    if (payload.entryId) {
      const claimed = await db.update(discussionEntries)
        .set({ extractionStatus: "processing", extractionRunId: runId })
        .where(and(
          eq(discussionEntries.id, payload.entryId),
          eq(discussionEntries.extractionStatus, "pending"),
        ))
        .returning();
      if (claimed.length === 0) {
        if (runId) {
          await db.update(internalAgentRuns)
            .set({ status: "failed", errorMessage: "not claimable (concurrent)", completedAt: new Date() })
            .where(eq(internalAgentRuns.id, runId));
        }
        log.info("entry not claimable (already processing/terminal) — skipping");
        return;
      }
    }

    // Attach the internal-agent MCP bridge via --mcp-config (claude-local
    // forwards config.args; the AOA_SESSION_* env is baked into the bridge
    // server entry by buildMcpConfig).
    const mcp = buildMcpConfig({
      companyId: payload.companyId,
      userId: SUBAGENT_SESSION_USER_ID,
      userRole: SUBAGENT_SESSION_USER_ROLE,
      enabledCapabilities: SUBAGENT_ENABLED_CAPABILITIES,
      bridgeEntrypoint: resolveBridgeEntrypoint(),
    });
    const cfgPath = join(tmpdir(), `aoa-mcp-${agentId}-${runId ?? "x"}.json`);
    await writeFile(cfgPath, JSON.stringify(mcp, null, 2));

    // runtimeConfig is jsonb (Record<string,unknown>) — narrow explicitly
    // (Finding 8: a chained optional on `unknown` does not type-check).
    const rc = (agent.runtimeConfig ?? {}) as Record<string, unknown>;
    const aoaCfg = (rc.aoa ?? {}) as Record<string, unknown>;
    const instruction = typeof aoaCfg.instruction === "string" ? aoaCfg.instruction : "";
    const adapter = getServerAdapter(agent.adapterType);
    const baseConfig = { ...(agent.adapterConfig ?? {}) } as Record<string, unknown>;
    const prevArgs = Array.isArray(baseConfig.args) ? (baseConfig.args as string[]) : [];
    const config = { ...baseConfig, args: ["--mcp-config", cfgPath, ...prevArgs] };
    const { executionTarget, runtimeCommandSpec } = resolveAdapterExecutionContext(config, adapter);

    await adapter.execute({
      runId: runId ?? `aoa-${agentId}`,
      agent,
      runtime: agent.runtimeConfig ?? {},
      config,
      // Instruction + the entry to extract; the agent reads this and calls
      // submit-extracted-items via the bridge. Output is NOT parsed.
      context: { aoaInstruction: instruction, payload },
      executionTarget, runtimeCommandSpec,
      onLog: async () => {}, onMeta: async () => {},
      authToken: undefined, onSpawn: () => {},
    });

    if (runId) {
      await db.update(internalAgentRuns)
        .set({ status: "completed", durationMs: Date.now() - startedAt, completedAt: new Date() })
        .where(eq(internalAgentRuns.id, runId));
    }
    await costService(db).createEvent(payload.companyId, {
      agentId, provider: "anthropic",
      model: process.env.EXTRACTION_MODEL || "claude-sonnet-4-20250514",
      inputTokens: 0, outputTokens: 0, costCents: 0, occurredAt: new Date(),
    });
  } catch (err) {
    log.error({ err }, "aoa run failed (isolated)");
    if (runId) {
      try {
        await db.update(internalAgentRuns)
          .set({ status: "failed", errorMessage: String((err as Error)?.message ?? err), durationMs: Date.now() - startedAt, completedAt: new Date() })
          .where(eq(internalAgentRuns.id, runId));
      } catch { /* swallow */ }
    }
  }
}
```
- [ ] **Step 6: Run → PASS** (2 tests).
- [ ] **Step 7: Commit** `git add server/src/services/internal-agent/aoa-agents/bridge-path.ts server/src/services/internal-agent/aoa-agents/runner.ts server/src/__tests__/aoa-runner.test.ts && git commit -m "feat(aoa): no-task runner — adapter+bridge + M2/#99 atomic claim preserved"`

---

## Milestone A8 — Extraction routed through the runner
**Files:** Modify `server/src/services/internal-agent/subagents/extraction-consumer.ts`; Test `server/src/__tests__/aoa-extraction-migrated.test.ts` + keep extraction-consumer*/atomic-claim green.

- [ ] **Step 1: Failing test**
```ts
// server/src/__tests__/aoa-extraction-migrated.test.ts
import { describe, expect, it, vi } from "vitest";
const { runAoaMock } = vi.hoisted(() => ({ runAoaMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/internal-agent/aoa-agents/runner.js", () => ({ runAoaAgent: runAoaMock }));
import { runExtractionConsumer } from "../services/internal-agent/subagents/extraction-consumer.js";
it("delegates to the AoA runner, never rethrows", async () => {
  const db:any = {};
  await expect(runExtractionConsumer(db,"co-1","e1","ext-1")).resolves.toBeUndefined();
  expect(runAoaMock).toHaveBeenCalledWith(db,"ext-1",{ entryId:"e1", companyId:"co-1", source:"discussion_entry_pending" });
});
```
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Replace consumer body**
```ts
// server/src/services/internal-agent/subagents/extraction-consumer.ts  (replace body)
import type { Db } from "@armyofagents/db";
import { runAoaAgent } from "../aoa-agents/runner.js";
/** @deprecated execution moved to the AoA runner (Plan A). Signature kept
 *  so existing callers/tests are unaffected. Never rethrows. */
export async function runExtractionConsumer(db: Db, companyId: string, entryId: string, agentId: string): Promise<void> {
  await runAoaAgent(db, agentId, { entryId, companyId, source: "discussion_entry_pending" });
}
```
- [ ] **Step 4: Run the extraction suite** `cd <worktree>/server && npx vitest run src/__tests__/aoa-extraction-migrated.test.ts src/__tests__/extraction-consumer.test.ts src/__tests__/extraction-consumer-contract.test.ts src/__tests__/extraction-atomic-claim.test.ts src/__tests__/extraction-refactor.test.ts`. If `extraction-consumer.test.ts` asserts old run/cost mechanics now in the runner, **update it to assert delegation** (behavior moved, not lost) and note in commit; never weaken the runner.
- [ ] **Step 5: Commit** `git add server/src/services/internal-agent/subagents/extraction-consumer.ts server/src/__tests__/aoa-extraction-migrated.test.ts server/src/__tests__/extraction-consumer.test.ts && git commit -m "feat(aoa): extraction routed through the AoA runner"`

---

## Milestone A9 — Bootstrap wiring + integration + regression + Plan-A acceptance

- [ ] **Step 1: Wire seeds into bootstrap.** Locate where `internal_agent_config` is first ensured per company: `grep -rn "internalAgentConfig" server/src/services/internal-agent --include=*.ts | grep -iE "insert|ensure|default"`. After the config row is ensured, call (idempotent): `await ensureCommanderAgent(db, companyId); await ensureExtractionAgent(db, companyId);` (import from `../aoa-agents/ensure-commander.js` / `ensure-extraction-agent.js`).
- [ ] **Step 2: Integration test** (Linux-CI authoritative, Windows-skipped; copy the embedded-pg `beforeAll/afterAll` from `agents-list-excludes-platform.integration.test.ts` verbatim)
```ts
// server/src/__tests__/aoa-backend.integration.test.ts
import { describe, it, expect } from "vitest";
describe.skipIf(process.platform === "win32")("AoA backend (integration)", () => {
  it("pending entry → kind='aoa' run recorded; entry no longer pending; cost_event emitted", async () => {
    // 1. seed company + internal_agent_config → bootstrap creates Commander +
    //    Extraction kind='aoa' rows + the outbox trigger.
    // 2. insert discussion + entry (extractionStatus='pending').
    // 3. runAoaDispatch(db,{limiterMax:2,staleMs:600000}).
    // 4. assert: internal_agent_runs row for the extraction agent
    //    (triggerType='sub_agent'); discussion_entries.extractionStatus != 'pending';
    //    cost_event row for that agent (costCents=0). adapterType='process'
    //    so no external CLI needed (deterministic).
    expect(true).toBe(true); // replace with the copied-harness assertions
  });
});
```
> Real *extracted content* (the agent calling `submit-extracted-items` via a real `claude_local`) is the **Plan D §17 gated acceptance** — A9 proves the dispatch→run→cost wiring with the `process` adapter, deterministically.
- [ ] **Step 3: Full regression** — run the existing M1–M6 backend suite + all new `aoa-*` files together (the 17-file list from the prior backend sweep + `aoa-schema-additive`, `aoa-ensure-commander`, `aoa-ensure-extraction-agent`, `aoa-triggers`, `aoa-submit-extracted-items`, `aoa-dispatcher`, `aoa-runner`, `aoa-extraction-migrated`). Expected: **all green**. Any M1–M6 red ⇒ the generalization regressed #99 — fix forward, never weaken old tests.
- [ ] **Step 4: Commit** `git add server/src/__tests__/aoa-backend.integration.test.ts server/src/services/internal-agent/<bootstrap-file>.ts && git commit -m "feat(aoa): bootstrap wiring + Plan-A backend regression green"`

---

## Self-Review (completed by plan author)

**1. Spec coverage:** §5.1 kind='aoa'→A1.2; §5.3 triggers→A1.1; §5.5 agentId+discriminator(runtimeConfig.aoa, NOT role)→A1.2/A2; §5.6 kind vs trigger_type→A1.1 comment+A7(`triggerType:'sub_agent'`); §6 dispatcher→A6; §7 uniform CLI-adapter+MCP-tool persistence→A5(tool)+A7(runner attaches bridge via adapterConfig.args, output NOT parsed); §8 mention→**Plan B**; §9 UI→**Plan C**; §10 governance/§13 ADR/§17 gated acceptance→**Plan D**; §11 migration→A2/A3/A6/A8/A9; §16 routine/AgentDetail/tool-allowlist→B/C/D; spike-resolved items honored (getServerAdapter, runtimeConfig.aoa.role, submit-extracted-items as A5 task). No A-scope gap.

**2. Placeholder scan:** A5 Step 1 / A7 Step 1 are explicit "read THIS named file, mirror the pattern, record it" instructions with the *logic* fully specified — same accepted precedent as the integration-harness copy; not vague. Two runner constants (`SUBAGENT_SESSION_USER_ROLE`, `SUBAGENT_ENABLED_CAPABILITIES`) are explicitly resolved in A7 Step 1 from `authorize-tool.ts` with a named source — flagged, not hand-waved. Integration body = documented harness-copy with enumerated assertions + named source test. No "TBD/handle errors/similar to".

**3. Type consistency:** `runAoaAgent(db,agentId,AoaTriggerPayload{companyId,source,entryId?})` identical across A6 (consumer call), A7 (impl/test), A8. `runExtractionConsumer(db,companyId,entryId,agentId)` identical A6/A8 (+ preserved for extraction-sweeper.test.ts). `runAoaDispatch(db,{limiterMax,staleMs})` = SweepOptions shim. `submitExtractedItemsTool` shape reconciled in A5 Step 1 before use. `ensureCommanderAgent`/`ensureExtractionAgent`→`Promise<string>` used in A6/A9. Consistent.

**4. Skeptical re-review (v2→v3) — found + fixed:** **Finding 6 (CRITICAL):** v2's runner dropped the M2/#99 atomic claim (it no longer calls `extractFromDiscussionEntry`) → dispatcher would re-run the same `pending` entry every tick. **Fixed:** A7 runner now performs the atomic `pending→processing`+`extraction_run_id` claim itself (mirrors `extraction.ts:389-402`), aborts if not claimed, + a dedicated test; the "#99/M2 invariants" section makes this explicit so it stops recurring. **Finding 7 (MEDIUM):** `adapterType:'process'` default makes `--mcp-config` a no-op (process≠claude) — already honestly scoped (real extraction = Plan D `claude_local`); Finding-6's claim ensures the entry leaves `pending` regardless of adapter, so no loop. **Finding 8 (MINOR):** `runtimeConfig?.aoa?.instruction` on `Record<string,unknown>` won't compile → A7 now narrows explicitly. v3 has no known critical defects; the softest remaining spot is A5 Step 1 (must read the real `AgentTool`/column shapes before writing the tool) — bounded, named-source, logic fully specified.

**5. Cross-plan review (Finding R1, from reviewing Plan C):** `internal_agent_runs` had no agent attribution (only `relatedEntityId`=the entry) → Plan C's per-agent Runs tab would be impossible. **Fixed in A** (not deferred): A1.2 adds `internal_agent_runs.agentId` + index (same additive migration); A7 runner stamps `agentId`; A1.2 test asserts it. Plan C's C1 now just consumes it. This is why per-plan pre-execution review matters — A was incomplete for the program until C's review surfaced it.

---

## Execution Handoff

Plan A (v2, spike-verified) saved to `docs/superpowers/plans/2026-05-17-aoa-agents-framework.md`. Plans B/C/D follow after A is reviewed/executed. Two options for Plan A:
**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.
**2. Inline Execution** — execute in this session via executing-plans, batched with checkpoints.
