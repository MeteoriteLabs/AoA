# AoA Run Count (Follow-up #4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AoA agent's capped `"50+"` run KPI with a true total-ever count. Add a `count(*)` `total` to the `/aoa-runs` response, fix BOTH the hero KPI and the Overview "Total runs" stat to read that true total, and relabel the hero KPI from "Recent runs" → "Total runs". Semantics: total ever.

**Architecture:** `GET /companies/:companyId/agents/:id/aoa-runs` (in `server/src/routes/agents.ts`) currently reads `internal_agent_runs`, caps rows at `min(limit ?? 50, 200)`, and returns a **bare array**. We change it to return `{ runs, total, limit }` — mirroring the proven same-table precedent at `server/src/routes/internal-agent.ts:861-895`, which computes the total with `sql<number>\`count(*)::int\`` (the exact idiom at `internal-agent.ts:864`) alongside the paginated query. We use `sql` (already imported by the routes that share this table's contract tests) rather than drizzle's `count` helper, because the existing `agentRoutes` route tests (`server/src/__tests__/agents-keys-routes.test.ts`, `server/src/__tests__/aoa-budget-autopause.test.ts`) mock `drizzle-orm` and provide a `sql` stub but **no `count` export** — importing/calling `count` would resolve to `undefined` and break them. The count is index-backed by `ia_runs_agent_idx` on `(companyId, agentId)` (`packages/db/src/schema/internal_agent.ts:322`) — no schema change. All UI consumers (`getAoaRuns` client + `AoaRunsPanel` + the hero query + the Overview query) read `.runs` for lists and `.total` for the count. `/aoa-runs` is internal (only our own UI consumes it), so the array→object shape change is safe within this one PR provided all consumers are updated atomically.

**Tech Stack:** Express 5 + Drizzle ORM (server), React + TanStack Query + Vitest/Testing-Library (UI). Drizzle ORM only — no raw SQL, no schema/migration change. AoA is not open source — no OSS license headers. This is its own PR/branch off `main`.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `server/src/routes/agents.ts` | Modify | Add `sql` to the `drizzle-orm` import; change the `/aoa-runs` handler to run a `sql<number>\`count(*)::int\`` query + the existing capped page query, and return `{ runs, total, limit }` instead of a bare array. (Use `sql`, not drizzle's `count` helper — the existing `agentRoutes` route tests mock `drizzle-orm` with a `sql` stub but no `count` export, so `count` would break them.) |
| `server/src/__tests__/aoa-runs-total.test.ts` | Create | Unit/contract test: invoke the `/aoa-runs` route handler with a sequence-mock DB (count call returns a number beyond the cap; page call returns ≤ limit rows); assert the response is `{ runs, total, limit }` with `total` > `runs.length`. |
| `ui/src/api/agents.ts` | Modify | Change `getAoaRuns` return type from `unknown[]` to a new `AoaRunsResponse` (`{ runs: unknown[]; total: number; limit: number }`). |
| `ui/src/components/agent-detail/AoaRunsPanel.tsx` | Modify | Read `data.runs` instead of treating `data` as the array. |
| `ui/src/pages/AoaAgentDetail.tsx` | Modify | Hero KPI: read `aoaRunsForKpi?.total`; relabel `"Recent runs"` → `"Total runs"`, key `recent-runs` → `total-runs`; drop the `>= 50 ? "50+"` cap logic. Overview stat: read `runs?.total` instead of `runList.length`. |
| `ui/src/__tests__/AoaAgentDetail.test.tsx` | Modify | Replace the `"Recent runs: 50+"` assertion with a `"Total runs: <real number>"` assertion against the new `{ runs, total }` mock shape. |

---

## Task 1 — Server: add `total` to the `/aoa-runs` response

**Files**
- Create: `server/src/__tests__/aoa-runs-total.test.ts`
- Modify: `server/src/routes/agents.ts` (import line 6; handler lines 552-564)

Current handler (verified, `server/src/routes/agents.ts:552-564`):
```ts
  router.get("/companies/:companyId/agents/:id/aoa-runs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const agentId = req.params.id as string;
    const limit = Math.min(parseInt(String(req.query.limit ?? 50)), 200);
    const runs = await db
      .select()
      .from(internalAgentRuns)
      .where(and(eq(internalAgentRuns.companyId, companyId), eq(internalAgentRuns.agentId, agentId)))
      .orderBy(desc(internalAgentRuns.createdAt))
      .limit(limit);
    res.json(runs);
  });
```

Current import (verified, `server/src/routes/agents.ts:6`):
```ts
import { and, desc, eq } from "drizzle-orm";
```

Precedent to mirror (verified, `server/src/routes/internal-agent.ts:862-895`): a `sql<number>\`count(*)::int\`` aggregate `select` over the same conditions (exact idiom at `internal-agent.ts:864`), then the paginated `select`, then `res.json({ runs, total, limit, offset, aggregates })`. We need only `{ runs, total, limit }` (no offset/aggregates for this endpoint).

**Why `sql`, not `count`:** the existing `agentRoutes` route tests — `server/src/__tests__/agents-keys-routes.test.ts` (mock at lines 6-23) and `server/src/__tests__/aoa-budget-autopause.test.ts` (mock at lines 23-41) — `vi.mock("drizzle-orm", …)` and provide a `sql` Proxy stub but **no `count` export** (verified). Adding `count` to the import and calling `count()` in the route would resolve to `undefined()` and crash router construction / handler execution in both files. Both mocks already export `sql` (a Proxy that returns `{ sql: true }` for any tag/template usage), so mirroring the `internal-agent.ts` `sql\`count(*)::int\`` template needs **zero changes** to those existing mocks. The new test in this task (below) also exports `sql` from its `drizzle-orm` mock.

### Steps

- [ ] Create the failing test file `server/src/__tests__/aoa-runs-total.test.ts`. It mocks `drizzle-orm` + `@armyofagents/db`, builds the router via `agentRoutes(db)`, extracts the `/aoa-runs` GET handler from `router.stack`, and invokes it with a fake `req`/`res`. The mock DB is sequence-based: the **first** `db.select(...)` resolves to the count row `[{ total: 137 }]`; the **second** resolves to a 50-row page. Assert the JSON body is `{ runs, total: 137, limit: 50 }` and `total > runs.length`. Write this file exactly:

```ts
// Unit/contract test for GET /companies/:companyId/agents/:id/aoa-runs.
// Follow-up #4: the endpoint must return { runs, total, limit } with `total`
// = count(*) over (companyId, agentId), so the true run total survives the
// page cap (default 50). Mirrors the count+page precedent at
// internal-agent.ts:861-895 and the mock-router harness in aoa-agents-api.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  desc: vi.fn((c: unknown) => ({ desc: c })),
  // The route computes the total with sql<number>`count(*)::int` (mirroring
  // internal-agent.ts:864). The mock DB's select() ignores the field map and
  // returns the pre-queued rows, so this stub just needs to not throw — match
  // the existing agentRoutes tests' Proxy sql stub. NOTE: no `count` export —
  // the route intentionally uses `sql`, not drizzle's `count` helper, because
  // the sibling agentRoutes mocks (agents-keys-routes.test.ts /
  // aoa-budget-autopause.test.ts) export `sql` but not `count`.
  sql: new Proxy(() => ({ sql: true }), {
    get: () => () => ({ sql: true }),
    apply: () => ({ sql: true }),
  }),
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") return Symbol(`${name}.${prop}`);
        return undefined;
      },
    });
  return {
    agents: makeTable("agents"),
    companies: makeTable("companies"),
    aoaAgentTriggers: makeTable("aoa_agent_triggers"),
    internalAgentRuns: makeTable("internal_agent_runs"),
  };
});

// The agents route module pulls in a large service graph at import time. Stub the
// service barrel and the adapter/login imports so building the router needs no DB.
vi.mock("../services/index.js", () => ({
  agentService: vi.fn(() => ({})),
  agentInstructionsService: vi.fn(() => ({})),
  accessService: vi.fn(() => ({})),
  approvalService: vi.fn(() => ({})),
  companySkillService: vi.fn(() => ({})),
  heartbeatService: vi.fn(() => ({})),
  issueApprovalService: vi.fn(() => ({})),
  issueService: vi.fn(() => ({})),
  logActivity: vi.fn(),
  secretService: vi.fn(() => ({})),
}));
vi.mock("../adapters/index.js", () => ({
  findActiveServerAdapter: vi.fn(),
  findServerAdapter: vi.fn(),
  listAdapterModels: vi.fn(),
}));
vi.mock("@armyofagents/adapter-claude-local/server", () => ({ runClaudeLogin: vi.fn() }));
vi.mock("@armyofagents/adapter-opencode-local/server", () => ({
  ensureOpenCodeModelConfiguredAndAvailable: vi.fn(),
}));

// authz guard is a no-op for this test (company access is asserted elsewhere).
vi.mock("../routes/authz.js", () => ({
  assertBoard: vi.fn(),
  assertCompanyAccess: vi.fn(),
  getActorInfo: vi.fn(() => ({ actorType: "user", actorId: "user-1" })),
}));

import { agentRoutes } from "../routes/agents.js";

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (...args: unknown[]) => unknown }>;
  };
};

// Sequence-based mock DB: each db.select() returns the NEXT pre-queued result.
function createSequenceDb(results: unknown[][]) {
  let call = 0;
  const makeChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit", "offset"]) {
      chain[m] = () => chain;
    }
    chain.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
    return chain;
  };
  return {
    select: () => makeChain(results[Math.min(call++, results.length - 1)]),
  } as any;
}

function getAoaRunsHandler(db: any) {
  const router = agentRoutes(db) as unknown as { stack: RouteLayer[] };
  const layer = router.stack.find(
    (l) => l.route?.path === "/companies/:companyId/agents/:id/aoa-runs" && l.route?.methods?.get,
  );
  if (!layer?.route) throw new Error("aoa-runs GET route not found");
  // The last handler in the layer stack is the route's async handler.
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe("GET /aoa-runs returns { runs, total, limit }", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns total from count(*) even when the page is capped below the total", async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}` }));
    // Call 1 = count query → [{ total: 137 }]; Call 2 = paginated page (50 rows).
    const db = createSequenceDb([[{ total: 137 }], page]);
    const handler = getAoaRunsHandler(db);

    let body: any;
    const req: any = {
      params: { companyId: "c1", id: "a1" },
      query: {},
    };
    const res: any = { json: (v: unknown) => { body = v; } };

    await handler(req, res, () => {});

    expect(body).toBeDefined();
    expect(body.total).toBe(137);
    expect(body.limit).toBe(50);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs).toHaveLength(50);
    // The whole point of the change: total is NOT clamped to the page length.
    expect(body.total).toBeGreaterThan(body.runs.length);
  });

  it("respects the limit query param (clamped to 200)", async () => {
    const db = createSequenceDb([[{ total: 5 }], [{ id: "r0" }, { id: "r1" }]]);
    const handler = getAoaRunsHandler(db);
    let body: any;
    const req: any = { params: { companyId: "c1", id: "a1" }, query: { limit: "999" } };
    const res: any = { json: (v: unknown) => { body = v; } };
    await handler(req, res, () => {});
    expect(body.total).toBe(5);
    expect(body.limit).toBe(200);
  });
});
```

- [ ] Run the new test — expect it to **FAIL** (the handler currently returns a bare array, so `body.total`/`body.limit` are `undefined` and `body.runs` is undefined):

```bash
pnpm --filter @armyofagents/server exec vitest run src/__tests__/aoa-runs-total.test.ts
```

Expected: assertions on `body.total` / `body.runs` fail (the response is an array, not `{ runs, total, limit }`).

- [ ] Add `sql` to the `drizzle-orm` import in `server/src/routes/agents.ts` (NOT `count` — `count` would break the sibling `agentRoutes` mocks that export `sql` but not `count`). Change line 6 from:

```ts
import { and, desc, eq } from "drizzle-orm";
```

to:

```ts
import { and, desc, eq, sql } from "drizzle-orm";
```

- [ ] Rewrite the `/aoa-runs` handler body (`server/src/routes/agents.ts:552-564`) to run a count query alongside the capped page query and return the object shape. Replace:

```ts
  router.get("/companies/:companyId/agents/:id/aoa-runs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const agentId = req.params.id as string;
    const limit = Math.min(parseInt(String(req.query.limit ?? 50)), 200);
    const runs = await db
      .select()
      .from(internalAgentRuns)
      .where(and(eq(internalAgentRuns.companyId, companyId), eq(internalAgentRuns.agentId, agentId)))
      .orderBy(desc(internalAgentRuns.createdAt))
      .limit(limit);
    res.json(runs);
  });
```

with:

```ts
  router.get("/companies/:companyId/agents/:id/aoa-runs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const agentId = req.params.id as string;
    const limit = Math.min(parseInt(String(req.query.limit ?? 50)), 200);
    const where = and(
      eq(internalAgentRuns.companyId, companyId),
      eq(internalAgentRuns.agentId, agentId),
    );
    // True total (count(*)::int) — index-backed by ia_runs_agent_idx on
    // (companyId, agentId), so it stays cheap. Returned alongside the capped
    // page so the UI shows a real "Total runs" count, not the page length.
    // Use sql`count(*)::int` (the internal-agent.ts:864 idiom), NOT drizzle's
    // count() helper — the agentRoutes route tests mock drizzle-orm with `sql`
    // but no `count` export, so `count()` would break them.
    const [{ total } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(internalAgentRuns)
      .where(where);
    const runs = await db
      .select()
      .from(internalAgentRuns)
      .where(where)
      .orderBy(desc(internalAgentRuns.createdAt))
      .limit(limit);
    res.json({ runs, total, limit });
  });
```

- [ ] Re-run the test — expect it to **PASS**:

```bash
pnpm --filter @armyofagents/server exec vitest run src/__tests__/aoa-runs-total.test.ts
```

Expected: both cases pass (`total === 137`, `limit === 50`, `runs.length === 50`, `total > runs.length`; second case `total === 5`, `limit === 200`).

- [ ] Verify the existing AoA agents route source-contract test still passes (it greps for `aoa-runs` / `internalAgentRuns`, which we preserved):

```bash
pnpm --filter @armyofagents/server exec vitest run src/__tests__/aoa-agents-api.test.ts
```

Expected: PASS (unchanged — `aoa-runs`, `/triggers`, `aoaAgentTriggers`, `internalAgentRuns` all still present in the route source).

- [ ] Commit the server change:

```bash
git add server/src/routes/agents.ts server/src/__tests__/aoa-runs-total.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): return true run total from /aoa-runs

Add a count(*) `total` alongside the capped page so the AoA run KPI can show
the real total-ever, not the page length. Response shape: bare array ->
{ runs, total, limit }. Index-backed by ia_runs_agent_idx; no schema change.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — UI client: type `getAoaRuns` as `{ runs, total, limit }`

**Files**
- Modify: `ui/src/api/agents.ts` (line 60)

Current (verified, `ui/src/api/agents.ts:60-61`):
```ts
  getAoaRuns: (agentId: string, companyId: string) =>
    api.get<unknown[]>(`/companies/${companyId}/agents/${encodeURIComponent(agentId)}/aoa-runs`),
```

### Steps

- [ ] Add an exported response interface near the other interfaces at the top of `ui/src/api/agents.ts` (after the `AgentKey` interface block, i.e. after line 22). Insert:

```ts
export interface AoaRunsResponse {
  runs: unknown[];
  total: number;
  limit: number;
}
```

- [ ] Change the `getAoaRuns` client method (`ui/src/api/agents.ts:60-61`) from:

```ts
  getAoaRuns: (agentId: string, companyId: string) =>
    api.get<unknown[]>(`/companies/${companyId}/agents/${encodeURIComponent(agentId)}/aoa-runs`),
```

to:

```ts
  getAoaRuns: (agentId: string, companyId: string) =>
    api.get<AoaRunsResponse>(`/companies/${companyId}/agents/${encodeURIComponent(agentId)}/aoa-runs`),
```

- [ ] Typecheck the UI to surface the consumer sites that now need `.runs` (they will be fixed in Tasks 3-4). This is expected to report errors in `AoaRunsPanel.tsx` and `AoaAgentDetail.tsx` until those tasks land:

```bash
pnpm --filter @armyofagents/ui typecheck
```

Expected: type errors at `AoaRunsPanel.tsx` (treating `runs` as an array) and `AoaAgentDetail.tsx` (`.length` on the response, `.length` in Overview). These resolve in Tasks 3-4. (No commit yet — commit Tasks 2-4 together at the end of Task 4 so the tree never has a broken typecheck mid-commit.)

---

## Task 3 — UI: `AoaRunsPanel` reads `data.runs`

**Files**
- Modify: `ui/src/components/agent-detail/AoaRunsPanel.tsx` (lines 28-33)

Current (verified, `ui/src/components/agent-detail/AoaRunsPanel.tsx:28-33`):
```tsx
  const { data: runs, isLoading } = useQuery({
    queryKey: ["aoa-runs", agentId, companyId],
    queryFn: () => agentsApi.getAoaRuns(agentId, companyId),
  });

  const runList = (runs ?? []) as AoaRun[];
```

### Steps

- [ ] Change the `useQuery` destructure + `runList` derivation in `ui/src/components/agent-detail/AoaRunsPanel.tsx:28-33` from the block above to:

```tsx
  const { data, isLoading } = useQuery({
    queryKey: ["aoa-runs", agentId, companyId],
    queryFn: () => agentsApi.getAoaRuns(agentId, companyId),
  });

  const runList = (data?.runs ?? []) as AoaRun[];
```

(Everything below — `runList.length === 0`, `runList.map(...)` — is unchanged; it already operates on `runList`.)

---

## Task 4 — UI: hero KPI + Overview stat read `total`; relabel "Recent runs" → "Total runs"

**Files**
- Modify: `ui/src/pages/AoaAgentDetail.tsx` (hero KPI: lines 255-265; Overview query+stat: lines 363-400)

### Hero KPI

Current (verified, `ui/src/pages/AoaAgentDetail.tsx:255-265`):
```tsx
  // /aoa-runs returns at most a capped page (default 50), so the fetched length is the
  // recent-run count, not a true total — label it honestly and show "50+" at the cap.
  const recentRunCount = (aoaRunsForKpi ?? []).length;
  const heroKpis: HeroKpi[] = [
    { key: "role", label: "Role", value: roleLabels[agent.role] ?? agent.role },
    {
      key: "recent-runs",
      label: "Recent runs",
      value: recentRunCount >= 50 ? "50+" : recentRunCount,
    },
  ];
```

### Overview query + stat

Current (verified, `ui/src/pages/AoaAgentDetail.tsx:363-400`):
```tsx
  const { data: runs } = useQuery({
    queryKey: ["aoa-runs", agent.id, companyId],
    queryFn: () => agentsApi.getAoaRuns(agent.id, companyId),
    enabled: Boolean(companyId),
  });

  const runList = (runs ?? []) as Array<{
    id: string;
    triggerType?: string;
    summary?: string | null;
    status: string;
    createdAt: string | Date;
    durationMs?: number | null;
  }>;

  const latestRun = runList[0] ?? null;
```
...and the stat at lines 398-401:
```tsx
        <div className="border border-border rounded-lg p-4">
          <span className="text-xs text-muted-foreground block">Total runs</span>
          <span className="text-2xl font-semibold block mt-1">{runList.length}</span>
        </div>
```

### Steps

- [ ] Replace the hero-KPI block (`ui/src/pages/AoaAgentDetail.tsx:255-265`) with the version that reads `.total`, drops the cap, and relabels to "Total runs":

```tsx
  // /aoa-runs now returns { runs, total } — `total` is the true count(*) over
  // all runs for this agent (not the capped page length), so the KPI shows the
  // real total-ever.
  const totalRunCount = aoaRunsForKpi?.total ?? 0;
  const heroKpis: HeroKpi[] = [
    { key: "role", label: "Role", value: roleLabels[agent.role] ?? agent.role },
    {
      key: "total-runs",
      label: "Total runs",
      value: totalRunCount,
    },
  ];
```

- [ ] Update the Overview query destructure + `runList` derivation (`ui/src/pages/AoaAgentDetail.tsx:363-376`) so the list reads `.runs` (keeping the local row type), and capture `total` for the stat. Replace:

```tsx
  const { data: runs } = useQuery({
    queryKey: ["aoa-runs", agent.id, companyId],
    queryFn: () => agentsApi.getAoaRuns(agent.id, companyId),
    enabled: Boolean(companyId),
  });

  const runList = (runs ?? []) as Array<{
    id: string;
    triggerType?: string;
    summary?: string | null;
    status: string;
    createdAt: string | Date;
    durationMs?: number | null;
  }>;
```

with:

```tsx
  const { data: runs } = useQuery({
    queryKey: ["aoa-runs", agent.id, companyId],
    queryFn: () => agentsApi.getAoaRuns(agent.id, companyId),
    enabled: Boolean(companyId),
  });

  const totalRuns = runs?.total ?? 0;
  const runList = (runs?.runs ?? []) as Array<{
    id: string;
    triggerType?: string;
    summary?: string | null;
    status: string;
    createdAt: string | Date;
    durationMs?: number | null;
  }>;
```

- [ ] Update the Overview "Total runs" stat (`ui/src/pages/AoaAgentDetail.tsx:398-401`) to render the true total instead of the (capped) list length. Replace:

```tsx
          <span className="text-2xl font-semibold block mt-1">{runList.length}</span>
```

with:

```tsx
          <span className="text-2xl font-semibold block mt-1">{totalRuns}</span>
```

- [ ] Typecheck the UI — now expected to be **clean** (the client type, the panel, and both page sites all agree on `{ runs, total }`):

```bash
pnpm --filter @armyofagents/ui typecheck
```

Expected: no errors.

- [ ] Commit Tasks 2-4 together (one coherent client-shape + consumer change):

```bash
git add ui/src/api/agents.ts ui/src/components/agent-detail/AoaRunsPanel.tsx ui/src/pages/AoaAgentDetail.tsx
git commit -m "$(cat <<'EOF'
feat(ui): show true AoA run total on hero KPI and Overview

getAoaRuns now returns { runs, total, limit }. The hero KPI reads `total`
(label "Total runs", no more "50+" cap) and the Overview "Total runs" stat
reads `total` instead of the capped page length. AoaRunsPanel reads `.runs`.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — UI test: replace the `"Recent runs: 50+"` assertion

**Files**
- Modify: `ui/src/__tests__/AoaAgentDetail.test.tsx` (mock default at line 179; the run-KPI test at lines 203-211)

Current (verified, `ui/src/__tests__/AoaAgentDetail.test.tsx`):
- Line 179 (in the top `beforeEach`): `mockGetAoaRuns.mockResolvedValue([]);`
- Lines 203-211:
```tsx
  // Codex P2: /aoa-runs is capped (default 50), so labeling its length "Total runs"
  // undercounts. It's now "Recent runs" and shows "50+" at the cap.
  it("labels the run KPI 'Recent runs' and shows 50+ when the run list is capped", async () => {
    mockGetAoaRuns.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ({ id: `r${i}` })));
    renderWithProviders(<AoaAgentDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("kpi-recent-runs")).toHaveTextContent("Recent runs: 50+");
    });
  });
```

The test mock returns a bare array; the component now reads `.total`/`.runs`. Every `mockGetAoaRuns.mockResolvedValue([])` (there are several: lines ~179, 236, 277) must return the new object shape, otherwise the hero KPI reads `undefined.total` and unrelated tests could break. We update the **default** in each `beforeEach` to the object shape, and rewrite the run-KPI test.

### Steps

- [ ] Update the **default** `mockGetAoaRuns` resolution in all three `beforeEach` blocks to the `{ runs, total, limit }` shape. There are three occurrences of `mockGetAoaRuns.mockResolvedValue([]);` (the main suite `beforeEach` ~line 179, the UUID-routing suite ~line 236, and the lifecycle suite ~line 277). Replace each occurrence:

```tsx
    mockGetAoaRuns.mockResolvedValue([]);
```

with:

```tsx
    mockGetAoaRuns.mockResolvedValue({ runs: [], total: 0, limit: 50 });
```

(Use a single find-and-replace-all for the exact string `mockGetAoaRuns.mockResolvedValue([]);`.)

- [ ] Rewrite the run-KPI test (`ui/src/__tests__/AoaAgentDetail.test.tsx:203-211`) to assert the true total via the new shape. Replace the block above with:

```tsx
  // Follow-up #4: /aoa-runs returns { runs, total } — `total` is count(*) over
  // ALL runs, so the hero KPI shows the true total-ever (no "50+" cap), labelled
  // "Total runs".
  it("labels the run KPI 'Total runs' and shows the true total beyond the page cap", async () => {
    mockGetAoaRuns.mockResolvedValue({
      runs: Array.from({ length: 50 }, (_, i) => ({ id: `r${i}` })),
      total: 137,
      limit: 50,
    });
    renderWithProviders(<AoaAgentDetail />);
    await waitFor(() => {
      expect(screen.getByTestId("kpi-total-runs")).toHaveTextContent("Total runs: 137");
    });
  });
```

- [ ] Run the AoaAgentDetail UI test file — expect it to **PASS** (the KPI now renders `Total runs: 137` under testid `kpi-total-runs`, and the other suites get a valid `{ runs, total }` default):

```bash
pnpm --filter @armyofagents/ui exec vitest run src/__tests__/AoaAgentDetail.test.tsx
```

Expected: all describe blocks pass, including the rewritten run-KPI test.

- [ ] Run the AoaRunsPanel test if one exists, to confirm `.runs` access didn't break it (no dedicated test file is expected; this command is a safety net and may report "no test files" — that is acceptable):

```bash
pnpm --filter @armyofagents/ui exec vitest run src/components/agent-detail/__tests__/AoaRunsPanel.test.tsx
```

Expected: PASS, or "No test files found" (the panel has no dedicated test today — verified by grep). If a file exists and fails, fix it to read the `{ runs }` shape.

- [ ] Commit the UI test change:

```bash
git add ui/src/__tests__/AoaAgentDetail.test.tsx
git commit -m "$(cat <<'EOF'
test(ui): assert true AoA run total on the hero KPI

/aoa-runs now returns { runs, total }; the KPI reads `total` and is labelled
"Total runs". Replace the capped "Recent runs: 50+" assertion with a true-total
assertion (kpi-total-runs == "Total runs: 137") and update the mock shape.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Definition of done (full suites + typecheck green)

**Files**
- None (verification only)

### Steps

- [ ] Run the full **server** test suite — expect green:

```bash
pnpm --filter @armyofagents/server exec vitest run
```

Expected: all tests pass (new `aoa-runs-total.test.ts` included; `aoa-agents-api.test.ts` still green).

- [ ] Run the full **UI** test suite — expect green:

```bash
pnpm --filter @armyofagents/ui exec vitest run
```

Expected: all tests pass (AoaAgentDetail suite green with the new shape).

- [ ] Run **typecheck** across the workspace — expect clean:

```bash
pnpm typecheck
```

Expected: no type errors (server + UI both clean).

- [ ] Confirm no schema/migration files were touched (sanity — this change requires none):

```bash
git diff --name-only main...HEAD
```

Expected: only `server/src/routes/agents.ts`, `server/src/__tests__/aoa-runs-total.test.ts`, `ui/src/api/agents.ts`, `ui/src/components/agent-detail/AoaRunsPanel.tsx`, `ui/src/pages/AoaAgentDetail.tsx`, `ui/src/__tests__/AoaAgentDetail.test.tsx` (plus this plan doc). No files under `packages/db/`.

---

## Self-review — spec coverage

This plan implements **only** the "Follow-up #4 — True AoA run count" section of `docs/aoa/plans/2026-06-25-agent-page-followups-design.md`, and covers every point in it:

- **Server (count + shape):** Task 1 adds `sql` to the `drizzle-orm` import (was `{ and, desc, eq }`) and changes `/aoa-runs` from a bare array to `{ runs, total, limit }`, with `total = sql<number>\`count(*)::int\`` over `(companyId, agentId)` — mirroring the verified precedent at `internal-agent.ts:864`. We deliberately use `sql`, **not** drizzle's `count` helper: the sibling `agentRoutes` route tests (`agents-keys-routes.test.ts`, `aoa-budget-autopause.test.ts`) `vi.mock("drizzle-orm")` with a `sql` Proxy stub but no `count` export (verified), so importing/calling `count` would resolve to `undefined()` and break them, whereas `sql` is already stubbed in both — zero mock changes needed (Codex P1 fix). Index-backed by `ia_runs_agent_idx` (verified at `internal_agent.ts:322`); no schema change. Semantics: total ever.
- **Blast radius (complete, verified by grep):** client `getAoaRuns` (Task 2), `AoaRunsPanel` (Task 3), hero query at `AoaAgentDetail.tsx:189-193` + KPI at `:255-265` (Task 4), Overview query/stat at `:363-400` (Task 4), and the test mock in `AoaAgentDetail.test.tsx` (Task 5). Nothing else consumes `getAoaRuns`.
- **Relabel:** hero KPI "Recent runs" → "Total runs" (key `recent-runs` → `total-runs`), cap logic removed (Task 4). Overview already says "Total runs"; it now reads the true `total` (Task 4).
- **Testing (per spec):** server test seeds count > page cap and asserts `total` and `runs.length === 50` (Task 1); UI test asserts KPI shows the real number under the "Total runs" label, replacing the old `"50+"` assertion (Task 5).
- **PR boundary:** server route + UI consumers + tests, one PR off `main` (Decisions: locked). TDD per repo rules (failing test → minimal real code → passing test). No OSS headers; commit trailers per repo convention.

**Things a reviewer should double-check:**
1. **Route-handler extraction in the server test.** The test pulls the `/aoa-runs` handler off `router.stack` and calls it directly with a fake `req`/`res`. This is a slight extension of the repo's existing source-grep contract pattern (`aoa-agents-api.test.ts` does not invoke handlers). It avoids needing the embedded-postgres real-DB harness (which is Windows-skipped). The `vi.mock("../services/index.js", ...)` stub list mirrors the real import at `agents.ts:25-36`; if `agentRoutes` imports another module at construction time that the stubs miss, the import may need one more `vi.mock`. A reviewer should run the file once to confirm the router builds under the mocks. An alternative the reviewer may prefer: a real-DB integration test mirroring `agents-list-excludes-platform.integration.test.ts` (seed >50 runs, assert `total`), Linux-gated — heavier but exercises the actual `count()` SQL.
2. **`sql\`count(*)::int\`` mock (Codex P1 fix).** The route uses `sql<number>\`count(*)::int\`` (the `internal-agent.ts:864` idiom), and the test stubs drizzle's `sql` with the same Proxy the existing `agentRoutes` mocks use — the mock DB's `select()` ignores the field map and returns the pre-queued rows, so the stub only needs to not throw. The original draft used drizzle's `count()` helper and added `count` to the import; that would have broken `agents-keys-routes.test.ts` and `aoa-budget-autopause.test.ts`, whose `drizzle-orm` mocks export `sql` but not `count` (calling `count()` → `undefined()` at router build / handler run). Switching to `sql` means those two existing mocks need **no edit**. The mock proves the route *shape and wiring* (two queries, object response), not the SQL semantics — the integration alternative in note 1 would prove the SQL. This matches how the repo's other contract tests trade SQL-fidelity for portability.
3. **`mockResolvedValue([])` → object shape in all three `beforeEach` blocks.** If any `beforeEach` is missed, the hero KPI reads `undefined?.total ?? 0` (renders `0`, harmless) but it's cleaner to update all three; the find-and-replace-all in Task 5 covers them. Confirm the count of replacements is 3.
4. **`AoaRunsResponse.runs` typed as `unknown[]`.** This matches the existing untyped pattern (the client returned `unknown[]` before; consumers cast locally to `AoaRun[]`). A reviewer wanting stronger typing could import/define a shared run type, but that's out of scope for this minimal-change follow-up.
