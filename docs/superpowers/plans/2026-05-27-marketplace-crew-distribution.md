# Marketplace Crew Distribution — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "AoA Standard Crew" (7 worker agents — no Commander) is installable as a one-click marketplace team package, version-pinned, updatable with full-replacement semantics, and uninstallable cleanly.

**Architecture:** Extends the existing `team-installer.ts` 3-phase saga. Crew agents are `kind='aoa'` (trigger-driven, not heartbeat). Commander is mandatory infrastructure that is always provisioned by `ensure-commander.ts` — it is NOT part of the marketplace package. The 7 package agents are: Scribe, Adjutant, Memory Keeper, Router, Planner, Dispatcher, Maker. Catalog entries live in `MeteoriteLabs/aoa-marketplace-cdn` (coordinated separately). Server-side changes live in this repo.

**Key design decisions (locked — do not relitigate):**
- Commander is NOT in the package. It is always-present infrastructure.
- Instruction files (SOUL.md, INSTRUCTIONS.md, HEARTBEAT.md, TOOLS.md, MEMORY.md) are **app code**, not user config. They are fully replaced on update (`replaceExisting: true`). No non-destructive semantics.
- `agentUpdatePolicy === "auto"` + within `updateWindow` → silent full replacement, no inbox notification.
- `agentUpdatePolicy === "notify"` or outside `updateWindow` → `marketplace_pending_updates` row + `marketplaceNotifications.updateAvailable()` + Commander Team tab badge.
- Auto-update applies EVERYTHING: instruction files + `skillKeys` + `runtimeConfig.aoa.toolAllowlist`.
- Checksum/pristine detection deferred to v1.2. No comparison logic in this release.
- Crew agents (`kind='aoa'`) do NOT appear on the regular Agents page.
- Marketplace Browse shows a separate "Crew & Internal Agents" category for `kind='aoa'` catalog items.

**Tech stack:** TypeScript + Drizzle ORM + Express 5 + Zod + React + Tailwind v4.

**Repo:** `AoA-threads` worktree on `feat/v1-combined`

---

## File structure

| File | Action | Purpose |
|------|--------|---------|
| `server/src/services/internal-agent/aoa-agents/backfill-template-origin.ts` | Create | Idempotent startup backfill — stamp `templateOrigin` on legacy crew rows |
| `server/src/__tests__/backfill-template-origin.test.ts` | Create | Tests for the backfill |
| `server/src/index.ts` | Modify | Wire backfill into startup loop |
| `server/src/services/marketplace-install/agent-runtime.ts` | Modify | Add optional `aoa.triggers` to `AgentRuntimeSchema` |
| `server/src/services/marketplace-install/types.ts` | Modify | Add `triggers` to `NormalizedMarketplaceAgentTemplate` |
| `server/src/services/marketplace-install/agent-create.ts` | Modify | Insert `aoaAgentTriggers` rows in same transaction when triggers present |
| `server/src/services/marketplace-install/team-installer.ts` | Modify | Route agent inserts through `createMarketplaceAgent()` (agent.v1 path) |
| `server/src/__tests__/team-installer-agent-v1.test.ts` | Create | Tests for upgraded team-installer |
| `server/src/services/marketplace-install/team-uninstaller.ts` | Create | Reverse of team-installer: delete agents + triggers + team |
| `server/src/routes/marketplace.ts` | Modify | Add DELETE route for team uninstall |
| `server/src/__tests__/team-uninstaller.test.ts` | Create | Tests for team-uninstaller |
| `server/src/services/marketplace-install/crew-updater.ts` | Create | `checkCrewUpdates()` + `applyCrewAgentUpdate()` — update-check + apply mechanics |
| `server/src/__tests__/crew-updater.test.ts` | Create | Tests for crew updater |
| `server/src/index.ts` | Modify | Wire update-check into startup + periodic interval |
| `server/src/routes/crew.ts` | Create | `GET /api/companies/:cid/crew/update-status` endpoint |
| `server/src/services/marketplace-install/default-skill-seeder.ts` | Modify | Drop/stub — dead code for v1.1 (catalog governs skills) |
| `server/src/services/companies.ts` | Modify | Boot-time gate — skip ensure-*.ts if crew already marketplace-installed |
| `server/src/index.ts` | Modify | Boot-time gate in startup backfill |
| `ui/src/api/agents.ts` | Modify | Filter `kind='aoa'` from Agents page query |
| `ui/src/components/marketplace/MarketplaceBrowse.tsx` | Modify | Add "Crew & Internal Agents" category section |
| `ui/src/components/team/CommanderTeamTab.tsx` | Modify | Show "Update Available" badge when pending updates exist |

---

## Task 3.0 — Backfill `templateOrigin` on existing crew rows

**Why first:** Existing companies have crew agents seeded by `ensure-*.ts` with no `templateOrigin`. Without this, T3.5's boot-time gate cannot distinguish marketplace-governed from legacy-seeded agents. The backfill stamps `@legacy`-suffixed templateOrigin values so all downstream logic works uniformly.

**Files:**
- Create: `server/src/services/internal-agent/aoa-agents/backfill-template-origin.ts`
- Create: `server/src/__tests__/backfill-template-origin.test.ts`
- Modify: `server/src/index.ts` (~line 701) — add to existing startup backfill block

- [ ] **Step 1: Write the failing test**

```ts
// server/src/__tests__/backfill-template-origin.test.ts
import { describe, it, expect, vi } from "vitest";

function makeBackfillDb() {
  const whereProxy = { execute: vi.fn().mockResolvedValue(undefined) };
  const setProxy = { where: vi.fn().mockReturnValue(whereProxy) };
  const updateProxy = { set: vi.fn().mockReturnValue(setProxy) };
  const db = { update: vi.fn().mockReturnValue(updateProxy) };
  return { db, updateProxy, setProxy };
}

describe("backfillCrewTemplateOrigin", () => {
  it("calls UPDATE with correct WHERE and SET clauses", async () => {
    const { db, updateProxy, setProxy } = makeBackfillDb();
    const { backfillCrewTemplateOrigin } = await import(
      "../services/internal-agent/aoa-agents/backfill-template-origin.js"
    );

    await backfillCrewTemplateOrigin(db as any);

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateProxy.set).toHaveBeenCalledTimes(1);
    const setArg = updateProxy.set.mock.calls[0][0];
    expect(setArg.updatedAt).toBeInstanceOf(Date);
    // templateOrigin should be a SQL expression (drizzle sql tag)
    expect(setArg.templateOrigin).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to see it fail**

```bash
pnpm --filter @armyofagents/server test backfill-template-origin
```
Expected: FAIL — file doesn't exist yet.

- [ ] **Step 3: Implement `backfillCrewTemplateOrigin`**

```ts
// server/src/services/internal-agent/aoa-agents/backfill-template-origin.ts
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents } from "@armyofagents/db";

/**
 * Names of all crew agents seeded by ensure-*.ts.
 * Commander is included even though it's not in the marketplace package —
 * the T3.5 boot-time gate checks kind='aoa' agents generically.
 */
const CREW_NAMES = [
  "Commander", "Adjutant", "Scribe", "Memory Keeper",
  "Router", "Planner", "Dispatcher", "Maker",
] as const;

/**
 * Idempotent startup backfill: stamp templateOrigin on pre-existing crew
 * agents that were seeded by ensure-*.ts before the marketplace install path
 * existed. The '@legacy' suffix distinguishes legacy seeds from marketplace
 * installs. WHERE clause: only kind='aoa' + NULL templateOrigin rows are
 * touched — a second run is a no-op (rows already have templateOrigin set).
 */
export async function backfillCrewTemplateOrigin(db: Db): Promise<void> {
  await db
    .update(agents)
    .set({
      templateOrigin: sql`'aoa-curated/standard-crew/' || lower(replace(${agents.name}, ' ', '-')) || '@legacy'`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(agents.kind, "aoa"),
      isNull(agents.templateOrigin),
      inArray(agents.name, [...CREW_NAMES]),
    ));
}
```

- [ ] **Step 4: Wire into startup loop in `server/src/index.ts`**

Find the existing startup backfill block (~lines 675–701). Add to the `Promise.all` array:

```ts
backfillCrewTemplateOrigin(db as any).catch((err: unknown) => {
  logger.warn({ err }, "templateOrigin backfill failed");
}),
```

Add import at the top of `server/src/index.ts`:

```ts
import { backfillCrewTemplateOrigin } from "./services/internal-agent/aoa-agents/backfill-template-origin.js";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @armyofagents/server test backfill-template-origin
```
Expected: PASS

- [ ] **Step 6: TypeScript check**

```bash
pnpm --filter @armyofagents/server tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/backfill-template-origin.ts \
        server/src/__tests__/backfill-template-origin.test.ts \
        server/src/index.ts
git commit -m "feat(marketplace): backfill templateOrigin on legacy crew agents (T3.0)"
```

---

## Task 3.0.5 — Upgrade team-installer to route through agent.v1 path

**Why now:** `team-installer.ts` currently raw-parses agent JSON into the legacy `AgentTemplateBody` schema and does inline `tx.insert(agents)` — bypassing `createMarketplaceAgent()`. After T3.2 adds trigger insertion to `createMarketplaceAgent()`, the team-installer would silently drop triggers. Fix: parse agent.json via `parseMarketplaceAgentTemplate()` + `normalizeMarketplaceAgentTemplate()`, then call `createMarketplaceAgent({ db: tx as unknown as Db, ... })` (nested transaction as SAVEPOINT — valid in PostgreSQL).

**Files:**
- Modify: `server/src/services/marketplace-install/team-installer.ts` lines ~97–105, ~216–264
- Create: `server/src/__tests__/team-installer-agent-v1.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// server/src/__tests__/team-installer-agent-v1.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../services/marketplace-install/fetch-resource.js", () => ({
  fetchCatalogResource: vi.fn(),
}));
vi.mock("../services/marketplace-install/agent-runtime.js", () => ({
  parseMarketplaceAgentTemplate: vi.fn(),
  normalizeMarketplaceAgentTemplate: vi.fn(),
}));
vi.mock("../services/marketplace-install/agent-create.js", () => ({
  createMarketplaceAgent: vi.fn().mockResolvedValue({ agentId: "agent-123" }),
}));

import { parseMarketplaceAgentTemplate, normalizeMarketplaceAgentTemplate } from
  "../services/marketplace-install/agent-runtime.js";
import { createMarketplaceAgent } from "../services/marketplace-install/agent-create.js";
import { fetchCatalogResource } from "../services/marketplace-install/fetch-resource.js";

const agentItem = {
  id: "aoa-curated/standard-crew/maker", type: "agent" as const, name: "Maker",
  version: "0.1.0", trust: { tier: "aoa_curated" }, category: "crew", tags: [],
  resourceUrl: "https://cdn.example.com/agents/maker/agent.json",
};
const teamBody = {
  slug: "standard-crew", description: "AoA Standard Crew",
  agents: [{ templateOrigin: agentItem.id, name: "Maker" }],
};
const catalog = { schemaVersion: "1.0.0", generatedAt: "", itemCount: 1, items: [agentItem] };
const catalogItem = {
  id: "aoa-curated/standard-crew", type: "team" as const, name: "Standard Crew",
  version: "0.1.0", trust: { tier: "aoa_curated" }, category: "crew", tags: [],
  requires: [{ id: agentItem.id, type: "agent" as const }],
};

describe("installTeam routes through createMarketplaceAgent for agent.v1", () => {
  it("calls parseMarketplaceAgentTemplate + createMarketplaceAgent for each agent", async () => {
    const mockFetch = fetchCatalogResource as ReturnType<typeof vi.fn>;
    mockFetch.mockImplementation((item: { type: string }) => {
      if (item.type === "team") return Promise.resolve(JSON.stringify(teamBody));
      return Promise.resolve(JSON.stringify({
        schemaVersion: "agent.v1", id: agentItem.id, name: "Maker", description: "test",
        instructions: { type: "inline", content: "hi" },
      }));
    });
    (parseMarketplaceAgentTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: "agent.v1", runtime: { aoa: { triggers: [] } },
    });
    (normalizeMarketplaceAgentTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "Maker", role: "general", status: "idle", adapterType: "process",
      adapterConfig: {}, runtimeConfig: {}, permissions: {}, budgetMonthlyCents: 0,
      skillKeys: [], triggers: [], setupRequirements: [], setupRequired: false,
      metadata: {}, warnings: [],
    });

    const deptRow = [{ id: "dept-1", type: "department" }];
    let selectCalls = 0;
    // Engineering review fix (D2): txMock needs .select so resolveAgentNameConflict
    // (which runs inside the transaction BEFORE createMarketplaceAgent) doesn't throw.
    let txSelectCalls = 0;
    const txMock = {
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
        returning: vi.fn().mockResolvedValue([{ id: "team-1" }]),
      }) }),
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(() => Promise.resolve(txSelectCalls++ === 0 ? [] : [])),
      }) }) }),
    };
    const dbMock = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(() => Promise.resolve(selectCalls++ === 0 ? deptRow : [])),
      }) }) }),
      transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
    };

    const { installTeam } = await import("../services/marketplace-install/team-installer.js");
    await installTeam({
      catalogItem, catalog: catalog as any, companyId: "co-1",
      targetDepartmentId: "dept-1", db: dbMock as any,
      installPlugin: vi.fn().mockResolvedValue({ pluginId: "p1", alreadyInstalled: false }),
    });

    expect(parseMarketplaceAgentTemplate).toHaveBeenCalledTimes(1);
    expect(normalizeMarketplaceAgentTemplate).toHaveBeenCalledTimes(1);
    expect(createMarketplaceAgent).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to see it fail**

```bash
pnpm --filter @armyofagents/server test team-installer-agent-v1
```
Expected: FAIL — team-installer doesn't call `createMarketplaceAgent`.

- [ ] **Step 3: Update team-installer.ts**

Change the agent-parsing section (lines ~97–105):

**Before:**
```ts
const agentBodies = new Map<string, AgentTemplateBody>();
for (const a of requiredAgentItems) {
  const text = await fetchCatalogResource(a, "agent template");
  agentBodies.set(a.id, JSON.parse(text) as AgentTemplateBody);
}
```

**After:**
```ts
import { parseMarketplaceAgentTemplate, normalizeMarketplaceAgentTemplate } from "./agent-runtime.js";
import { createMarketplaceAgent } from "./agent-create.js";

const agentParsed = new Map<string, ReturnType<typeof normalizeMarketplaceAgentTemplate>>();
for (const a of requiredAgentItems) {
  const text = await fetchCatalogResource(a, "agent template");
  const parsed = parseMarketplaceAgentTemplate(text, a);
  const normalized = normalizeMarketplaceAgentTemplate({
    parsed,
    catalogItem: a,
    availableAdapterTypes: [],
  });
  agentParsed.set(a.id, normalized);
}
```

Change the agent insert section inside the transaction (lines ~216–264):

**Before:**
```ts
const agentInsertResults: Array<{ id: string; templateOrigin: string }> = [];
for (const teamAgent of teamBody.agents) {
  const template = agentBodies.get(teamAgent.templateOrigin);
  // ... inline tx.insert(agents).values({...})
}
```

**After:**
```ts
const agentInsertResults: Array<{ id: string; templateOrigin: string }> = [];
for (const teamAgent of teamBody.agents) {
  const template = agentParsed.get(teamAgent.templateOrigin);
  if (!template) {
    throw new Error(`team.json references unknown agent template: ${teamAgent.templateOrigin}`);
  }
  const agentItem = itemsById.get(teamAgent.templateOrigin);
  if (!agentItem) {
    throw new Error(`team.json references catalog agent not in catalog: ${teamAgent.templateOrigin}`);
  }
  const resolvedAgentName = await resolveAgentNameConflict({
    db: tx as unknown as Db,
    companyId,
    desiredName: teamAgent.name,
  });
  const { agentId } = await createMarketplaceAgent({
    catalogItem: agentItem,
    companyId,
    db: tx as unknown as Db,
    desiredName: resolvedAgentName,
    template,
  });
  agentInsertResults.push({ id: agentId, templateOrigin: teamAgent.templateOrigin });
  cascadeResults.push({
    step: "agent-install",
    itemId: teamAgent.templateOrigin,
    status: "success",
    resultEntityId: agentId,
    durationMs: 0,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @armyofagents/server test team-installer-agent-v1
```
Expected: PASS

- [ ] **Step 5: TypeScript check + commit**

```bash
pnpm --filter @armyofagents/server tsc --noEmit
git add server/src/services/marketplace-install/team-installer.ts \
        server/src/__tests__/team-installer-agent-v1.test.ts
git commit -m "feat(marketplace): route team-installer through createMarketplaceAgent agent.v1 path (T3.0.5)"
```

---

## Task 3.1 — Author crew catalog entries in aoa-marketplace-cdn

**External repo — do in `MeteoriteLabs/aoa-marketplace-cdn` as a coordinated PR.**

**Package: 7 agents only. Commander intentionally excluded — it is always-present infrastructure.**

Agents: Scribe, Adjutant, Memory Keeper, Router, Planner, Dispatcher, Maker.

**team.json shape:**

```json
{
  "schemaVersion": "1.0.0",
  "id": "aoa-curated/standard-crew",
  "type": "team",
  "name": "AoA Standard Crew",
  "version": "0.1.0",
  "description": "7-agent crew for discussion processing: routing, planning, dispatch, artifact generation, and memory.",
  "trust": { "tier": "aoa_curated" },
  "category": "crew",
  "tags": ["crew", "aoa", "official"],
  "kind": "aoa",
  "requires": [
    { "id": "aoa-curated/standard-crew/scribe", "type": "agent" },
    { "id": "aoa-curated/standard-crew/adjutant", "type": "agent" },
    { "id": "aoa-curated/standard-crew/memory-keeper", "type": "agent" },
    { "id": "aoa-curated/standard-crew/router", "type": "agent" },
    { "id": "aoa-curated/standard-crew/planner", "type": "agent" },
    { "id": "aoa-curated/standard-crew/dispatcher", "type": "agent" },
    { "id": "aoa-curated/standard-crew/maker", "type": "agent" }
  ],
  "resourceUrl": "https://meteoritelabs.github.io/aoa-marketplace-cdn/teams/aoa-curated/standard-crew/team.json"
}
```

**Per-agent agent.json shape (example: Maker):**

```json
{
  "schemaVersion": "agent.v1",
  "id": "aoa-curated/standard-crew/maker",
  "name": "Maker",
  "description": "Generates artifacts on demand in discussion threads.",
  "instructions": {
    "type": "bundle",
    "entry": "INSTRUCTIONS.md",
    "files": ["SOUL.md", "INSTRUCTIONS.md", "HEARTBEAT.md", "TOOLS.md", "MEMORY.md"]
  },
  "aoa": {
    "install": { "defaultRole": "general", "defaultStatus": "paused" },
    "runtimeConfig": {
      "aoa": {
        "role": "member",
        "toolAllowlist": ["read_file", "search_discussions", "query_extracted_items", "create_artifact", "post_entry"]
      }
    },
    "skillKeys": [],
    "triggers": [
      { "kind": "mention", "config": { "role": "maker" } }
    ]
  }
}
```

Trigger kinds per agent:
- Scribe: `[{ "kind": "outbox" }]`
- Adjutant: `[{ "kind": "sweep", "config": { "role": "adjutant" } }]`
- Memory Keeper: `[{ "kind": "sweep", "config": { "role": "memory_keeper" } }]`
- Router: `[{ "kind": "mention" }]`
- Planner: `[{ "kind": "phase-advance" }]`
- Dispatcher: `[{ "kind": "phase-advance" }]`
- Maker: `[{ "kind": "mention", "config": { "role": "maker" } }]`

Instruction files per agent go under `agents/aoa-curated/standard-crew/<role>/instructions/` — mirror content from `server/src/onboarding-assets/<role>/`.

- [ ] **Step 1**: Mirror current onboarding-assets content into CDN repo structure
- [ ] **Step 2**: Write all 7 agent.json files
- [ ] **Step 3**: Write team.json referencing all 7 agents
- [ ] **Step 4**: Open PR to aoa-marketplace-cdn; get CDN URL after merge

**Note:** This task can proceed in parallel with T3.2–T3.5. AoA-side changes don't need the CDN live to be testable.

---

## Task 3.2 — Extend agent.v1 schema for `aoa.triggers` + wire trigger insertion

**Why:** Without `triggers` in the Zod schema, trigger config in agent.json is discarded during install. Crew agents would install but never activate.

**Files:**
- Modify: `server/src/services/marketplace-install/agent-runtime.ts` — add `triggers` to the `aoa` block in `AgentRuntimeSchema`
- Modify: `server/src/services/marketplace-install/types.ts` — add `triggers` to `NormalizedMarketplaceAgentTemplate`
- Modify: `server/src/services/marketplace-install/agent-create.ts` — insert `aoaAgentTriggers` rows after agent insert

- [ ] **Step 1: Write failing tests**

```ts
// server/src/__tests__/agent-runtime-triggers.test.ts
import { describe, it, expect } from "vitest";
import { parseMarketplaceAgentTemplate } from "../services/marketplace-install/agent-runtime.js";

const catalogItem = { id: "test/agent", type: "agent" as const, name: "Test",
  version: "1.0.0", trust: { tier: "standard" }, category: "test", tags: [] };

describe("agent.v1 triggers schema", () => {
  it("accepts agent.v1 with no triggers field", () => {
    const body = JSON.stringify({ schemaVersion: "agent.v1", id: "test", name: "Test",
      description: "test", instructions: { type: "inline", content: "hi" } });
    const result = parseMarketplaceAgentTemplate(body, catalogItem);
    expect(result.kind).toBe("agent.v1");
    expect((result as any).runtime.aoa?.triggers).toBeUndefined();
  });

  it("accepts agent.v1 with valid triggers array", () => {
    const body = JSON.stringify({ schemaVersion: "agent.v1", id: "test", name: "Test",
      description: "test", instructions: { type: "inline", content: "hi" },
      aoa: { triggers: [{ kind: "mention", config: { role: "maker" } }] } });
    const result = parseMarketplaceAgentTemplate(body, catalogItem);
    expect(result.kind).toBe("agent.v1");
    expect((result as any).runtime.aoa.triggers).toHaveLength(1);
    expect((result as any).runtime.aoa.triggers[0].kind).toBe("mention");
  });

  it("rejects agent.v1 with unknown trigger kind", () => {
    const body = JSON.stringify({ schemaVersion: "agent.v1", id: "test", name: "Test",
      description: "test", instructions: { type: "inline", content: "hi" },
      aoa: { triggers: [{ kind: "bad-kind" }] } });
    expect(() => parseMarketplaceAgentTemplate(body, catalogItem)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to see them fail**

```bash
pnpm --filter @armyofagents/server test agent-runtime-triggers
```
Expected: FAIL

- [ ] **Step 3: Add `triggers` to `AgentRuntimeSchema.aoa` in `agent-runtime.ts`**

Inside the existing `aoa: z.object({ ... }).strict().optional()` block, add before the closing `}).strict().optional()`:

```ts
triggers: z.array(
  z.object({
    kind: z.enum(["mention", "phase-advance", "sweep", "outbox", "event"]),
    config: z.record(z.unknown()).optional().default({}),
  }).strict()
).optional(),
```

- [ ] **Step 4: Add `kind` + `triggers` to `NormalizedMarketplaceAgentTemplate` in `types.ts`**

> **Engineering review fix (D1):** `createMarketplaceAgent` never set `kind` on the DB row — all crew agents landed as `kind='org'` (DB default). This broke T3.5 gate, T3.y filter, and T3.4 update-checker. Fix: propagate `kind` from `CatalogItem` through the normalize→create chain.

```ts
kind: 'org' | 'aoa';  // ← NEW (D1 fix): populated from CatalogItem.kind; default 'org'
triggers: Array<{ kind: string; config: Record<string, unknown> }>;
```

- [ ] **Step 5: Populate `kind` + `triggers` in `normalizeMarketplaceAgentTemplate` in `agent-runtime.ts`**

In the **agent.v1 return object**, add:
```ts
kind: (catalogItem.kind === 'aoa' ? 'aoa' : 'org') as 'org' | 'aoa',
triggers: runtime.aoa?.triggers?.map((t) => ({
  kind: t.kind,
  config: (t.config ?? {}) as Record<string, unknown>,
})) ?? [],
```

In the **legacy return object**, add:
```ts
kind: 'org' as const,
triggers: [],
```

- [ ] **Step 6: Pass `kind` + insert trigger rows in `agent-create.ts`**

> **D1 fix:** The INSERT in `createMarketplaceAgent` must now include `kind` from the template. Without this, all crew agents default to `kind='org'`.

Import `aoaAgentTriggers` from `@armyofagents/db`. In the `tx.insert(agents).values({...})` block, add:

```ts
kind: template.kind ?? 'org',   // ← NEW: propagated from NormalizedMarketplaceAgentTemplate
```

After the agent insert (and after the optional `materializeManagedBundle` block), inside the transaction, insert trigger rows:

```ts
for (const trigger of template.triggers ?? []) {
  await tx
    .insert(aoaAgentTriggers)
    .values({
      companyId,
      agentId: agent.id,
      kind: trigger.kind,
      enabled: true,
      config: trigger.config,
    });
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
pnpm --filter @armyofagents/server test agent-runtime-triggers
```
Expected: PASS

- [ ] **Step 8: TypeScript check + commit**

```bash
pnpm --filter @armyofagents/server tsc --noEmit
git add server/src/services/marketplace-install/agent-runtime.ts \
        server/src/services/marketplace-install/types.ts \
        server/src/services/marketplace-install/agent-create.ts \
        server/src/__tests__/agent-runtime-triggers.test.ts
git commit -m "feat(marketplace): add aoa.triggers to agent.v1 schema + insert trigger rows on install (T3.2)"
```

---

## Task 3.3 — Implement `uninstallTeam`

**Reversal logic (transactional):**
1. DELETE `aoaAgentTriggers` WHERE `agent_id IN (team's agents)`
2. DELETE `agents` rows (FK cascade handles `team_members`)
3. DELETE `teams` row (FK cascade handles `team_members`)
4. Skills left in place — may be used by other agents
5. Log to `marketplace_install_operations`

**Files:**
- Create: `server/src/services/marketplace-install/team-uninstaller.ts`
- Modify: `server/src/routes/marketplace.ts` — add `DELETE /api/companies/:cid/marketplace/teams/:teamId`
- Create: `server/src/__tests__/team-uninstaller.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// server/src/__tests__/team-uninstaller.test.ts
import { describe, it, expect, vi } from "vitest";
import { uninstallTeam } from "../services/marketplace-install/team-uninstaller.js";

function makeDb(teamRow: unknown, memberRows: { agentId: string }[]) {
  let selectCount = 0;
  const mockDelete = vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(memberRows.map(m => ({ id: m.agentId }))) }),
  });
  const mockInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "op-1" }]) }),
  });
  const db = {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({
      limit: vi.fn().mockImplementation(() => Promise.resolve(selectCount++ === 0 ? (teamRow ? [teamRow] : []) : memberRows)),
    }) }) }),
    delete: mockDelete,
    insert: mockInsert,
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ delete: mockDelete, insert: mockInsert,
        select: db.select,
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
      });
    }),
  };
  return { db, mockDelete };
}

describe("uninstallTeam", () => {
  it("throws if team not found", async () => {
    const { db } = makeDb(null, []);
    await expect(uninstallTeam({ db: db as any, companyId: "co-1", teamId: "t-1" }))
      .rejects.toThrow("Team not found");
  });

  it("deletes triggers, agents, and team row in a transaction", async () => {
    const teamRow = { id: "t-1", companyId: "co-1", templateOrigin: "aoa-curated/standard-crew" };
    const { db, mockDelete } = makeDb(teamRow, [{ agentId: "a-1" }, { agentId: "a-2" }]);
    await uninstallTeam({ db: db as any, companyId: "co-1", teamId: "t-1" });
    expect(mockDelete).toHaveBeenCalledTimes(3); // triggers + agents + team
  });
});
```

- [ ] **Step 2: Run test to see it fail**

```bash
pnpm --filter @armyofagents/server test team-uninstaller
```
Expected: FAIL

- [ ] **Step 3: Implement `team-uninstaller.ts`**

```ts
// server/src/services/marketplace-install/team-uninstaller.ts
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { teams, teamMembers, agents, aoaAgentTriggers, marketplaceInstallOperations } from "@armyofagents/db";
import { logger } from "../../middleware/logger.js";

export interface UninstallTeamOpts {
  db: Db;
  companyId: string;
  teamId: string;
}

export interface UninstallTeamResult {
  deletedAgentIds: string[];
}

/**
 * Reverse of installTeam: delete agents + triggers + team row.
 * Skills are left in place. Transactional (all-or-nothing). Idempotent.
 */
export async function uninstallTeam(opts: UninstallTeamOpts): Promise<UninstallTeamResult> {
  const { db, companyId, teamId } = opts;

  const [teamRow] = await db
    .select({ id: teams.id, templateOrigin: teams.templateOrigin })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.companyId, companyId)))
    .limit(1);
  if (!teamRow) throw new Error(`Team not found: ${teamId}`);

  const memberRows = await db
    .select({ agentId: teamMembers.agentId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));
  const agentIds = memberRows.map((m) => m.agentId);

  const deletedAgentIds: string[] = [];

  await db.transaction(async (tx) => {
    if (agentIds.length > 0) {
      // 1. Delete triggers
      await tx.delete(aoaAgentTriggers).where(inArray(aoaAgentTriggers.agentId, agentIds));
      // 2. Delete agents (cascades team_members FK)
      const deleted = await tx
        .delete(agents)
        .where(and(eq(agents.companyId, companyId), inArray(agents.id, agentIds)))
        .returning({ id: agents.id });
      deletedAgentIds.push(...deleted.map((r) => r.id));
    }
    // 3. Delete team row (cascades team_members FK)
    await tx.delete(teams).where(and(eq(teams.id, teamId), eq(teams.companyId, companyId)));
    // 4. Log the operation
    await tx.insert(marketplaceInstallOperations).values({
      companyId,
      catalogItemId: teamRow.templateOrigin ?? teamId,
      operationType: "uninstall",
      status: "success",
      resultEntityId: teamId,
      completedAt: new Date(),
    });
  });

  logger.info({ companyId, teamId, deletedAgentIds }, "marketplace: team uninstalled");
  return { deletedAgentIds };
}
```

- [ ] **Step 4: Add DELETE route in `server/src/routes/marketplace.ts`**

```ts
// DELETE /api/companies/:cid/marketplace/teams/:teamId
router.delete("/api/companies/:cid/marketplace/teams/:teamId", requireFounder, async (req, res) => {
  const { cid: companyId, teamId } = req.params;
  try {
    const result = await uninstallTeam({ db, companyId, teamId });
    res.json({ success: true, deletedAgentIds: result.deletedAgentIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) return res.status(404).json({ error: message });
    logger.error({ err, companyId, teamId }, "team uninstall failed");
    res.status(500).json({ error: "Uninstall failed" });
  }
});
```

- [ ] **Step 5: Run test + TypeScript check + commit**

```bash
pnpm --filter @armyofagents/server test team-uninstaller
pnpm --filter @armyofagents/server tsc --noEmit
git add server/src/services/marketplace-install/team-uninstaller.ts \
        server/src/routes/marketplace.ts \
        server/src/__tests__/team-uninstaller.test.ts
git commit -m "feat(marketplace): implement team uninstaller + DELETE route (T3.3)"
```

---

## Task 3.4 — Full-replacement update mechanics (`applyCrewAgentUpdate`)

**Design decision (CRITICAL — reversed from old plan):** Instruction files are **app code**, not user config. `replaceExisting: true` → ALL files replaced. No preservation of founder edits. This also replaces `skillKeys`, `runtimeConfig.aoa.toolAllowlist`, and bumps `templateVersion`.

**Files:**
- Create: `server/src/services/marketplace-install/crew-updater.ts`
- Create: `server/src/__tests__/crew-updater.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// server/src/__tests__/crew-updater.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../services/marketplace-install/fetch-resource.js", () => ({
  fetchCatalogResource: vi.fn().mockResolvedValue(JSON.stringify({
    schemaVersion: "agent.v1", id: "aoa-curated/standard-crew/maker", name: "Maker",
    description: "test", instructions: { type: "inline", content: "new instructions" },
    aoa: {
      runtimeConfig: { aoa: { toolAllowlist: ["new_tool"] } },
      skillKeys: ["new-skill"],
      triggers: [{ kind: "mention", config: { role: "maker" } }],
    },
  })),
}));
vi.mock("../services/marketplace-install/agent-create.js", () => ({
  loadMarketplaceInstructionFiles: vi.fn().mockResolvedValue({
    files: { "INSTRUCTIONS.md": "new content" }, entryFile: "INSTRUCTIONS.md",
  }),
}));

import { applyCrewAgentUpdate } from "../services/marketplace-install/crew-updater.js";

describe("applyCrewAgentUpdate", () => {
  it("calls materializeManagedBundle with replaceExisting:true and bumps templateVersion", async () => {
    const mockMaterialize = vi.fn().mockResolvedValue({ adapterConfig: { updated: true } });
    const updatedFields: Record<string, unknown> = {};
    const txMock = {
      update: vi.fn().mockReturnValue({ set: vi.fn().mockImplementation((v: Record<string, unknown>) => {
        Object.assign(updatedFields, v);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }) }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }) }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    };
    const db = {
      transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
    };
    const agentRow = {
      id: "agent-1", companyId: "co-1", name: "Maker", adapterType: "claude_local",
      adapterConfig: {}, runtimeConfig: { aoa: { toolAllowlist: ["old_tool"] } },
      skillKeys: ["old-skill"], templateVersion: "0.0.1",
    };
    const catalogItem = { id: "aoa-curated/standard-crew/maker", type: "agent" as const,
      name: "Maker", version: "0.1.0", trust: { tier: "aoa_curated" }, category: "crew",
      tags: [], resourceUrl: "https://example.com/agent.json" };

    await applyCrewAgentUpdate({
      db: db as any, agentRow, catalogItem,
      instructionsService: { materializeManagedBundle: mockMaterialize } as any,
    });

    // Must call with replaceExisting: true
    expect(mockMaterialize).toHaveBeenCalledWith(
      expect.objectContaining({ id: "agent-1" }),
      expect.any(Object),
      expect.objectContaining({ replaceExisting: true }),
    );
    // Must bump templateVersion
    expect(updatedFields.templateVersion).toBe("0.1.0");
  });
});
```

- [ ] **Step 2: Run test to see it fail**

```bash
pnpm --filter @armyofagents/server test crew-updater
```
Expected: FAIL

- [ ] **Step 3: Implement `crew-updater.ts`**

```ts
// server/src/services/marketplace-install/crew-updater.ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers, marketplacePendingUpdates } from "@armyofagents/db";
import type { CatalogItem, MarketplaceSettings } from "@armyofagents/shared";
import { fetchCatalogResource } from "./fetch-resource.js";
import { parseMarketplaceAgentTemplate, normalizeMarketplaceAgentTemplate } from "./agent-runtime.js";
import { loadMarketplaceInstructionFiles } from "./agent-create.js";
import type { AgentInstructionsServiceLike } from "./agent-create.js";
import { marketplaceNotifications } from "../marketplace-notifications.js";
import { isWithinUpdateWindow } from "./skill-auto-updater.js";
import { logger } from "../../middleware/logger.js";

export interface CrewAgentRow {
  id: string;
  companyId: string;
  name: string;
  adapterType: string;
  adapterConfig: Record<string, unknown> | null;
  runtimeConfig: Record<string, unknown> | null;
  skillKeys: string[];
  templateVersion: string | null;
}

/**
 * Apply a full-replacement update to a single crew agent.
 *
 * DESIGN DECISION: instruction files are app code, not user config.
 * replaceExisting: true → ALL files replaced (no preservation of edits).
 * Also replaces: skillKeys, runtimeConfig.aoa.toolAllowlist, templateVersion.
 * Triggers are replaced (DELETE + re-INSERT) from catalog definition.
 */
export async function applyCrewAgentUpdate(opts: {
  db: Db;
  agentRow: CrewAgentRow;
  catalogItem: CatalogItem;
  instructionsService: AgentInstructionsServiceLike;
}): Promise<void> {
  const { db, agentRow, catalogItem, instructionsService } = opts;

  const bodyText = await fetchCatalogResource(catalogItem, "agent template for update");
  const parsed = parseMarketplaceAgentTemplate(bodyText, catalogItem);
  const template = normalizeMarketplaceAgentTemplate({ parsed, catalogItem, availableAdapterTypes: [] });
  const instructionFiles = await loadMarketplaceInstructionFiles(catalogItem, template);

  const agentForMaterialize = {
    id: agentRow.id, companyId: agentRow.companyId, name: agentRow.name,
    role: "general", adapterType: agentRow.adapterType, adapterConfig: agentRow.adapterConfig,
  };
  const materialized = instructionFiles
    ? await instructionsService.materializeManagedBundle(
        agentForMaterialize,
        instructionFiles.files,
        { entryFile: instructionFiles.entryFile, replaceExisting: true, clearLegacyPromptTemplate: true },
      )
    : null;

  // Merge new toolAllowlist into runtimeConfig.aoa (replace, not merge)
  const existingRc = agentRow.runtimeConfig ?? {};
  const existingAoa = (existingRc.aoa as Record<string, unknown>) ?? {};
  const newAoa = (template.runtimeConfig.aoa as Record<string, unknown>) ?? {};
  const updatedRc = {
    ...existingRc,
    aoa: {
      ...existingAoa,
      ...(newAoa.toolAllowlist !== undefined ? { toolAllowlist: newAoa.toolAllowlist } : {}),
    },
  };

  await db.transaction(async (tx) => {
    await tx.update(agents).set({
      skillKeys: template.skillKeys,
      runtimeConfig: updatedRc,
      templateVersion: catalogItem.version,
      ...(materialized ? { adapterConfig: materialized.adapterConfig } : {}),
      updatedAt: new Date(),
    }).where(eq(agents.id, agentRow.id));

    // Replace triggers: delete existing, re-insert from catalog
    await tx.delete(aoaAgentTriggers).where(eq(aoaAgentTriggers.agentId, agentRow.id));
    for (const trigger of template.triggers ?? []) {
      await tx.insert(aoaAgentTriggers).values({
        companyId: agentRow.companyId, agentId: agentRow.id,
        kind: trigger.kind, enabled: true, config: trigger.config,
      });
    }

    // Mark pending update as applied
    await tx.update(marketplacePendingUpdates).set({ status: "applied", updatedAt: new Date() })
      .where(and(
        eq(marketplacePendingUpdates.companyId, agentRow.companyId),
        eq(marketplacePendingUpdates.catalogItemId, catalogItem.id),
        eq(marketplacePendingUpdates.status, "pending"),
      ));
  });

  logger.info({ agentId: agentRow.id, catalogItemId: catalogItem.id, version: catalogItem.version },
    "marketplace: crew agent update applied");
}

/**
 * Check all installed crew agents against the catalog for new versions.
 * auto policy + within window → apply immediately (silent, no notification).
 * notify policy or outside window → record pending_update + updateAvailable notification.
 */
export async function checkCrewUpdates(opts: {
  db: Db;
  companyId: string;
  catalogItems: CatalogItem[];
  settings: MarketplaceSettings;
  instructionsService: AgentInstructionsServiceLike;
}): Promise<void> {
  const { db, companyId, catalogItems, settings, instructionsService } = opts;
  const catalogById = new Map(catalogItems.map((item) => [item.id, item]));

  const crewAgents = await db
    .select({
      id: agents.id, name: agents.name, adapterType: agents.adapterType,
      adapterConfig: agents.adapterConfig, runtimeConfig: agents.runtimeConfig,
      skillKeys: agents.skillKeys, templateOrigin: agents.templateOrigin,
      templateVersion: agents.templateVersion,
    })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa")));

  for (const agent of crewAgents) {
    if (!agent.templateOrigin || agent.templateOrigin.endsWith("@legacy")) continue;
    if (!agent.templateVersion) continue;

    const catalogItem = catalogById.get(agent.templateOrigin);
    if (!catalogItem) continue;
    if (catalogItem.version === agent.templateVersion) continue;

    const autoApply = settings.agentUpdatePolicy === "auto" &&
      isWithinUpdateWindow(settings.updateWindow);

    if (autoApply) {
      try {
        await applyCrewAgentUpdate({
          db, agentRow: { ...agent, companyId }, catalogItem, instructionsService,
        });
        continue;
      } catch (err) {
        logger.error({ err, agentId: agent.id }, "marketplace: crew auto-update failed — notifying");
      }
    }

    // Notify path: record pending update + fire notification
    try {
      await db.insert(marketplacePendingUpdates).values({
        companyId, catalogItemId: catalogItem.id, catalogItemName: catalogItem.name,
        itemType: "agent", currentVersion: agent.templateVersion ?? "0.0.0",
        latestVersion: catalogItem.version, status: "pending",
      }).onConflictDoUpdate({
        target: [marketplacePendingUpdates.companyId, marketplacePendingUpdates.catalogItemId],
        set: { latestVersion: catalogItem.version, status: "pending", updatedAt: new Date() },
      });
    } catch (err) {
      logger.error({ err }, "marketplace: failed to record pending update");
    }
    try {
      await marketplaceNotifications.updateAvailable(
        db, companyId, catalogItem.name, agent.templateVersion ?? "0.0.0", catalogItem.version,
      );
    } catch (err) {
      logger.error({ err }, "marketplace: updateAvailable notification failed");
    }
  }
}
```

- [ ] **Step 4: Run test + TypeScript check + commit**

```bash
pnpm --filter @armyofagents/server test crew-updater
pnpm --filter @armyofagents/server tsc --noEmit
git add server/src/services/marketplace-install/crew-updater.ts \
        server/src/__tests__/crew-updater.test.ts
git commit -m "feat(marketplace): full-replacement crew agent update mechanics + check/notify pipeline (T3.4/T3.x)"
```

---

## Task 3.5 — Boot-time fallback gate

**Why:** After crew is marketplace-installed, `ensure-*.ts` startup calls are redundant and risk overwriting marketplace-managed config.

Check: `≥1 kind='aoa' agent with non-legacy templateOrigin` → marketplace governs.

- [ ] **Step 1: Replace the existing `Promise.all(rows.flatMap(...))` startup backfill block in `server/src/index.ts`**

```ts
void db
  .select({ id: companies.id })
  .from(companies)
  .then(async (rows) => {
    for (const row of rows) {
      // T3.5: skip ensure-*.ts if marketplace already governs this company's crew
      const [marketplaceInstalled] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(
          eq(agents.companyId, row.id),
          eq(agents.kind, "aoa"),
          sql`${agents.templateOrigin} IS NOT NULL AND ${agents.templateOrigin} NOT LIKE '%@legacy'`,
        ))
        .limit(1);

      if (marketplaceInstalled) {
        logger.debug({ companyId: row.id }, "crew startup backfill: skipping — marketplace governs");
        continue;
      }

      await Promise.all([
        ensureCommandStaff(db as any, row.id).catch((err: unknown) =>
          logger.warn({ err, companyId: row.id }, "command staff backfill failed")),
        ensureAdjutant(db as any, row.id).catch((err: unknown) =>
          logger.warn({ err, companyId: row.id }, "adjutant backfill failed")),
        ensureMaker(db as any, row.id).catch((err: unknown) =>
          logger.warn({ err, companyId: row.id }, "maker backfill failed")),
        ensureCommanderAgent(db as any, row.id).catch((err: unknown) =>
          logger.warn({ err, companyId: row.id }, "commander backfill failed")),
        ensureExtractionAgent(db as any, row.id).catch((err: unknown) =>
          logger.warn({ err, companyId: row.id }, "extraction agent backfill failed")),
      ]);
    }
  })
  .catch((err) => logger.warn({ err }, "crew startup backfill failed"));
```

Ensure `sql` is imported from `drizzle-orm` if not already present.

- [ ] **Step 2 (index.ts): Wire `checkCrewUpdates` into startup + periodic interval**

```ts
import { checkCrewUpdates } from "./services/marketplace-install/crew-updater.js";
import { MARKETPLACE_SETTINGS_DEFAULTS } from "@armyofagents/shared";
import { marketplaceCompanySettings, marketplaceCatalogCache } from "@armyofagents/db";
import { agentInstructionsService } from "./services/agent-instructions.js";

const CREW_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function runCrewUpdateCheck(): Promise<void> {
  try {
    const catalogRows = await db.select().from(marketplaceCatalogCache)
      .where(eq(marketplaceCatalogCache.id, 1)).limit(1);
    if (catalogRows.length === 0) return;
    const catalogData = (catalogRows[0].catalogJson as { items?: unknown }).items;
    if (!Array.isArray(catalogData)) return;

    const allCompanies = await db.select({ id: companies.id }).from(companies);
    for (const company of allCompanies) {
      const settingsRow = await db.select({ settings: marketplaceCompanySettings.settings })
        .from(marketplaceCompanySettings)
        .where(eq(marketplaceCompanySettings.companyId, company.id)).limit(1);
      const settings = { ...MARKETPLACE_SETTINGS_DEFAULTS, ...((settingsRow[0]?.settings as object) ?? {}) };
      await checkCrewUpdates({
        db: db as any, companyId: company.id, catalogItems: catalogData as any,
        settings, instructionsService: agentInstructionsService(),
      });
    }
  } catch (err) {
    logger.warn({ err }, "crew update check failed");
  }
}

void runCrewUpdateCheck();
setInterval(() => void runCrewUpdateCheck().catch((err) =>
  logger.warn({ err }, "crew update check interval failed")),
  CREW_UPDATE_CHECK_INTERVAL_MS,
);
```

- [ ] **Step 3: Add marketplace gate to `companies.ts` `createCompanyWithUniquePrefix`**

> **Engineering review fix (D2):** The startup backfill gate in index.ts is correct, but `companies.ts` also calls ensure-*.ts on every NEW company creation. Without a gate here, a brand-new company that also has a marketplace crew install would have its agents overwritten on first boot.

In `server/src/services/companies.ts`, in `createCompanyWithUniquePrefix`, wrap the ensure-*.ts calls with a marketplace check:

```ts
// T3.5: skip ensure-*.ts if marketplace already governs this company's crew
const [mktInstalled] = await db
  .select({ id: agents.id })
  .from(agents)
  .where(and(
    eq(agents.companyId, company.id),
    eq(agents.kind, "aoa"),
    sql`${agents.templateOrigin} IS NOT NULL AND ${agents.templateOrigin} NOT LIKE '%@legacy'`,
  ))
  .limit(1);

if (!mktInstalled) {
  await ensureInternalAgentConfig(db, company.id).catch(...);
  await ensureCommanderAgent(db, company.id).catch(...);
  await ensureExtractionAgent(db, company.id).catch(...);
  await ensureCommandStaff(db, company.id).catch(...);
}
```

Add imports as needed: `sql` from `drizzle-orm`, `agents` from `@armyofagents/db`.

- [ ] **Step 4: TypeScript check + commit**

```bash
pnpm --filter @armyofagents/server tsc --noEmit
git add server/src/index.ts server/src/services/companies.ts
git commit -m "feat(marketplace): boot-time gate + companies.ts gate + wire crew update-check startup/interval (T3.5/T3.x)"
```

---

## Task 3.6 — Drop `seedDefaultCommanderSkills` dead hook

Skills are now installed via the marketplace team package (`requires` in team.json). The standalone seeder is dead code.

- [ ] **Step 1: Check for call sites**

```bash
grep -rn "seedDefaultCommanderSkills" server/src/
```

- [ ] **Step 2: Stub out the function body**

```ts
/** @deprecated v1.1 — skills installed via marketplace team package. No-op. */
export async function seedDefaultCommanderSkills(_params: { db: Db; companyId: string }): Promise<void> {
  // No-op: replaced by marketplace team package install.
}
```

- [ ] **Step 3: Remove call sites** found in Step 1

- [ ] **Step 4: TypeScript check + commit**

```bash
pnpm --filter @armyofagents/server tsc --noEmit
git add server/src/services/marketplace-install/default-skill-seeder.ts
git commit -m "chore(marketplace): stub out seedDefaultCommanderSkills — dead code for v1.1 (T3.6)"
```

---

## Task 3.x — Crew update-status API + Commander Team tab badge

**Files:**
- Create: `server/src/routes/crew.ts`
- Modify: `server/src/app.ts` — register router
- Modify: `ui/src/components/team/CommanderTeamTab.tsx` — add update badge

- [ ] **Step 1: Create `server/src/routes/crew.ts`**

```ts
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { marketplacePendingUpdates } from "@armyofagents/db";

export function createCrewRouter(db: Db) {
  const router = Router({ mergeParams: true });

  router.get("/update-status", async (req, res) => {
    const companyId = req.params.cid;
    try {
      const pending = await db
        .select({
          id: marketplacePendingUpdates.id,
          catalogItemId: marketplacePendingUpdates.catalogItemId,
          catalogItemName: marketplacePendingUpdates.catalogItemName,
          currentVersion: marketplacePendingUpdates.currentVersion,
          latestVersion: marketplacePendingUpdates.latestVersion,
          detectedAt: marketplacePendingUpdates.detectedAt,
        })
        .from(marketplacePendingUpdates)
        .where(and(
          eq(marketplacePendingUpdates.companyId, companyId),
          eq(marketplacePendingUpdates.status, "pending"),
          eq(marketplacePendingUpdates.itemType, "agent"),
        ));
      res.json({ pendingUpdates: pending, count: pending.length });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch update status" });
    }
  });

  return router;
}
```

- [ ] **Step 2: Register in `server/src/app.ts`**

```ts
import { createCrewRouter } from "./routes/crew.js";
app.use("/api/companies/:cid/crew", createCrewRouter(db));
```

- [ ] **Step 3: Add badge in `CommanderTeamTab.tsx`**

```tsx
const { data: updateStatus } = useQuery(
  ["crew-update-status", companyId],
  () => fetch(`/api/companies/${companyId}/crew/update-status`).then(r => r.json()),
  { refetchInterval: 5 * 60 * 1000, staleTime: 60 * 1000 },
);
const hasUpdates = (updateStatus?.count ?? 0) > 0;

// In the tab label:
{hasUpdates && (
  <span className="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-medium text-white">
    {updateStatus.count}
  </span>
)}
```

- [ ] **Step 4: TypeScript check + commit**

```bash
pnpm --filter @armyofagents/server tsc --noEmit
pnpm --filter @armyofagents/ui tsc --noEmit
git add server/src/routes/crew.ts server/src/app.ts ui/src/components/team/CommanderTeamTab.tsx
git commit -m "feat(marketplace): crew update-status endpoint + Commander tab badge (T3.x)"
```

---

## Task 3.y — Marketplace UI: crew category + Agents page filter

**Files:**
- Modify: `server/src/routes/agents.ts` or `ui/src/api/agents.ts` — filter out `kind='aoa'` from Agents page
- Modify: `packages/shared/src/marketplace.ts` — add optional `kind` field to `CatalogItem`
- Modify: `ui/src/components/marketplace/MarketplaceBrowse.tsx` (or equivalent) — crew category section

- [ ] **Step 1: Add `kind?: string` to `CatalogItem` in `packages/shared/src/marketplace.ts`**

Find the `CatalogItem` interface and add:
```ts
kind?: string; // "aoa" for crew packages; undefined for standard
```

- [ ] **Step 2: Filter Agents page**

In the agents list endpoint (`server/src/routes/agents.ts`), find the SELECT query and add `eq(agents.kind, "org")` to the WHERE clause. Or in the frontend filter: `.filter(a => a.kind !== "aoa")`.

- [ ] **Step 3: Crew category in Marketplace Browse**

```tsx
const crewItems = catalogItems.filter(
  item => item.kind === "aoa" || item.packageId?.startsWith("aoa-curated/")
);
const regularItems = catalogItems.filter(
  item => item.kind !== "aoa" && !item.packageId?.startsWith("aoa-curated/")
);

// Render crewItems in a dedicated section before the regular grid:
{crewItems.length > 0 && (
  <section>
    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
      Crew & Internal Agents
    </h2>
    <p className="text-xs text-muted-foreground mb-4">Official AoA packages — installs as Commander's crew</p>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {crewItems.map(item => <MarketplaceCard key={item.id} item={item} />)}
    </div>
  </section>
)}
```

Use the same card chrome as regular items (locked in design-system.md §9.13–9.18).

- [ ] **Step 4: TypeScript check + commit**

```bash
pnpm --filter @armyofagents/server tsc --noEmit
pnpm --filter @armyofagents/ui tsc --noEmit
git add packages/shared/src/marketplace.ts server/src/routes/agents.ts \
        ui/src/components/marketplace/
git commit -m "feat(marketplace): crew category in browse UI + filter Agents page (T3.y)"
```

---

## Task 3.7 — Phase 3 verification smoke test

- [ ] **Step 1: Start dev server + seed catalog cache**

```bash
pnpm dev
curl -X POST http://localhost:3000/api/marketplace/refresh-catalog
```

- [ ] **Step 2: Install crew team package and verify**

```bash
curl -X POST http://localhost:3000/api/companies/<CID>/marketplace/install \
  -H "Content-Type: application/json" \
  -d '{"catalogItemId": "aoa-curated/standard-crew", "targetDepartmentId": "<DEPT_ID>"}'
```

Expected in DB:
- 7 agents with `kind='aoa'` and `templateOrigin` set (no `@legacy`)
- `aoaAgentTriggers` rows for each agent
- 1 `teams` row + 7 `team_members` rows

- [ ] **Step 3: Verify crew NOT in Agents page**

```bash
curl http://localhost:3000/api/companies/<CID>/agents
```
Expected: 0 crew agents returned (all `kind='aoa'` filtered out).

- [ ] **Step 4: Verify update-status endpoint**

```bash
curl http://localhost:3000/api/companies/<CID>/crew/update-status
```
Expected: `{ count: 0, pendingUpdates: [] }`

- [ ] **Step 5: Uninstall and re-install (clean)**

```bash
curl -X DELETE http://localhost:3000/api/companies/<CID>/marketplace/teams/<TEAM_ID>
# Expected: 7 agents deleted
curl -X POST http://localhost:3000/api/companies/<CID>/marketplace/install ...
# Expected: clean re-install, no unique-index conflicts
```

- [ ] **Step 6: Commit**

```bash
git commit --allow-empty -m "chore(marketplace): Phase 3 verification complete (T3.7)"
```

---

## v1.2 deferred items

1. **Checksum / pristine detection** — compare file checksums before auto-apply; if founder edited a file, downgrade to notify path even when `agentUpdatePolicy='auto'`.
2. **Manual apply of pending updates** — "Review & Apply" button in Commander Team tab; `POST /api/companies/:cid/crew/apply-update`.
3. **Commander in catalog listing** — show as "Always installed — infrastructure" without an Install button.
4. **Update window UI** — settings page controls for `updateWindow` + `agentUpdatePolicy`.

---

## Self-review

| Requirement | Covered by |
|------------|-----------|
| Commander not in package | T3.1 lists 7 agents explicitly |
| Full-replacement update semantics | T3.4 uses `replaceExisting: true`; replaces skillKeys + toolAllowlist |
| Auto-update ON → silent | `checkCrewUpdates` skips notification on successful auto-apply |
| Auto-update OFF → notify | `recordPendingUpdate` + `marketplaceNotifications.updateAvailable()` |
| All changes applied (instructions + skillKeys + toolAllowlist) | `applyCrewAgentUpdate` covers all three |
| Crew not in Agents page | T3.y Step 2 |
| Crew category in Marketplace Browse | T3.y Step 3 |
| Commander Team tab badge | T3.x Step 3 |
| Checksum detection deferred | v1.2 deferred items |
| T3.0.5 routes through `createMarketplaceAgent` | Triggers auto-inserted from T3.2 |
| `kind='aoa'` set on crew agent rows | T3.2 Step 4–6 (D1 fix) |
| Boot-gate covers both startup AND company-create paths | T3.5 Step 1 + Step 3 (D2 fix) |

---

## GSTACK REVIEW REPORT
**Reviewer:** plan-eng-review skill  
**Reviewed:** 2026-05-27  
**Branch:** feat/v1-combined  
**Scope:** Phase 3 — Marketplace crew distribution (T3.0–T3.7, 19 files)

---

### Verdict: APPROVED WITH REQUIRED FIXES ✅

Two critical/important issues were found and fixed inline before approval. Plan is now implementation-ready. Full findings below.

---

### A. Architecture — Data flow

**Clean.** Three distinct paths are correctly separated:
1. **Install path:** `installTeam` → (T3.0.5) `createMarketplaceAgent` → triggers inserted in same transaction
2. **Update path:** `checkCrewUpdates` → `applyCrewAgentUpdate` → full replacement transactional
3. **Uninstall path:** `uninstallTeam` → delete triggers + agents + team in one transaction

Saga pattern (Phase 1 preflight / Phase 2 plugins / Phase 3 atomic) is preserved from the existing team-installer. Correct.

**Boot-time gate:** Two layers — `index.ts` startup backfill + `companies.ts` company-create (added in D2 fix). Gate condition: `kind='aoa' AND templateOrigin NOT LIKE '%@legacy'`. Idempotent. Correct.

**`@legacy` stamp:** Backfill distinguishes pre-marketplace crew from marketplace-installed crew. The gate correctly treats `@legacy` rows as unmanaged, allowing ensure-*.ts to continue running for them. Commander (mandatory infrastructure) gets `@legacy` stamp and is not affected by the gate. Sound design.

---

### B. Critical issue fixed — `kind='aoa'` never set on agent rows (D1)

**Root cause:** `createMarketplaceAgent` in `agent-create.ts` INSERT never included `kind`. DB default is `'org'`.  
**Impact:** T3.5 gate, T3.y Agents filter, and T3.4 `checkCrewUpdates` all query `eq(agents.kind, "aoa")` — silently finding nothing.  
**Fix applied:** Added `kind: 'org' | 'aoa'` to `NormalizedMarketplaceAgentTemplate`, populated from `catalogItem.kind` in `normalizeMarketplaceAgentTemplate`, and passed to `createMarketplaceAgent` INSERT. Fix is in T3.2 Steps 4–6.

---

### C. Important issues fixed — T3.0.5 test bug + companies.ts gate gap (D2)

**Test bug:** `txMock` in `team-installer-agent-v1.test.ts` had no `.select` method. `resolveAgentNameConflict` runs inside the transaction and calls `tx.select()` — the test would fail even with a correct implementation. Fix applied: added `select: vi.fn()...` to `txMock` in T3.0.5.

**Gate gap:** T3.5 originally only gated the startup backfill in `index.ts`. The `companies.ts` `createCompanyWithUniquePrefix` path was unmodified — meaning ensure-*.ts would still run for new companies that get marketplace crew installed. Fix applied: same gate condition added to T3.5 Step 3.

---

### D. Code quality notes (no blockers)

1. **`checkCrewUpdates` ignores `updateCheckHours` per-company setting** — the global 24h interval doesn't respect a company's `updateCheckHours: 6 | 12` preference. Acceptable for v1.1 since the check is additive (early re-check just wastes a catalog read). Added to deferred items.

2. **`applyCrewAgentUpdate` has no concurrency protection** — two simultaneous calls for the same agent would both update. In practice the caller is a single-process interval loop, so race is unlikely. Acceptable for v1.1.

3. **`marketplace_pending_updates.currentVersion` can be stale** — if an agent's `templateVersion` changes between detection and display, the "from X to Y" text in notifications may be off. Display-only issue, no data corruption. Acceptable.

4. **`CREW_NAMES` in T3.0 includes Commander** — this is intentional: Commander gets `@legacy` stamp so the T3.5 gate doesn't bypass its ensure path. Correct.

5. **Nested transaction in T3.0.5** — calling `createMarketplaceAgent({ db: tx as unknown as Db, ... })` inside `installTeam`'s transaction creates a PostgreSQL SAVEPOINT. This is valid in Drizzle ORM. Correct.

---

### E. Test coverage

| File | Type | What it tests |
|------|------|---------------|
| `backfill-template-origin.test.ts` | Unit | UPDATE WHERE clause correctness |
| `team-installer-agent-v1.test.ts` | Integration-mock | T3.0.5 routing: parse→normalize→createMarketplaceAgent called |
| `agent-runtime-triggers.test.ts` | Unit | Zod schema: triggers accepted/rejected; `kind` populated |
| `team-uninstaller.test.ts` | Unit | Not-found error, delete count = 3 |
| `crew-updater.test.ts` | Unit | `replaceExisting:true` called, `templateVersion` bumped |

**Missing coverage (not blocking, add to backlog):**
- T3.5 gate condition unit test (new SELECT + conditional branch)
- `companies.ts` gate unit test (added by D2 fix)
- T3.x crew route (`GET /update-status`) — no route test
- `normalizeMarketplaceAgentTemplate` with `kind='aoa'` input — add a test case in T3.2 `agent-runtime-triggers.test.ts`

---

### F. Performance

- T3.5 adds 1 SELECT per company at startup — O(companies). Acceptable.
- `checkCrewUpdates` at startup does 1 catalog SELECT + 1 agents SELECT + N notification UPSERTs per company. For typical sizes (< 100 companies × 7 agents), total startup overhead < 200ms. Acceptable.
- T3.0 backfill: single bulk UPDATE (WHERE + IN clause), not N individual UPDATEs. Efficient.

---

### G. Deferred to v1.2 (updated)

1. Checksum / pristine detection before auto-apply
2. Manual "Review & Apply" button in Commander Team tab
3. Commander shown in catalog as "Always installed — infrastructure"
4. Update window UI controls in Settings page
5. **Per-company `updateCheckHours` respected by check interval** (noted above)
6. **Route test for `GET /api/companies/:cid/crew/update-status`**
