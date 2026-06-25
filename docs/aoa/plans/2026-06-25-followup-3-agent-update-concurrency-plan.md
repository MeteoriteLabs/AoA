# Agent-Update Optimistic Concurrency (Follow-up #3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OPTIONAL optimistic concurrency to agent updates so two concurrent editors can't silently clobber each other. The token is the existing `updatedAt` (no DB migration). When the client sends `expectedUpdatedAt` and the row changed underneath, the write returns HTTP **409** (with the current `updatedAt` in the body so the client can refetch). When `expectedUpdatedAt` is absent, behavior is unchanged last-write-wins (full back-compat). Scope is the whole `agents` row.

**Architecture:** Token = `agents.updatedAt` (`timestamptz`, stamped on every write — no version column, no migration). The check is a **race-free atomic guarded UPDATE**: `where(and(eq(agents.id, id), eq(agents.updatedAt, expected)))`. Zero rows returned *while the row still exists* → throw `conflict()` (the existing 409 `HttpError`, with `details: { currentUpdatedAt }`); zero rows with no row → 404 (unchanged `null` return). A pre-read compare is explicitly rejected — that is TOCTOU; the guard lives in the WHERE clause. This follows the locked precedent in `server/src/services/issues.ts` `checkout` (atomic conditional UPDATE → re-read → conflict). The token rides in the PATCH body (`expectedUpdatedAt`, optional ISO datetime) through the shared zod validator; the route's existing error propagation maps the thrown 409 automatically via `middleware/error-handler.ts`. UI opts in first in Skills + Config: each caller captures `agent.updatedAt` from the query cache, sends it, and on 409 invalidates/refetches + toasts "changed elsewhere".

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL), Express 5, zod (shared validators), React + @tanstack/react-query, Vitest. Drizzle ORM only — no raw SQL. AoA is not open source — no OSS headers. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

Files touched (exact paths):

```
packages/shared/src/validators/agent.ts                       # add expectedUpdatedAt to updateAgentSchema
packages/shared/src/__tests__/agent-validators.test.ts        # NEW — validator contract test (or extend if present)
server/src/services/agents.ts                                 # thread expectedUpdatedAt → guarded UPDATE → conflict()
server/src/__tests__/agents-update-concurrency.test.ts        # NEW — service guarded-update + 409/404/back-compat
server/src/routes/agents.ts                                   # forward expectedUpdatedAt to svc.update (no new mapping needed)
server/src/__tests__/agents-update-concurrency-route.test.ts  # NEW — route maps thrown 409 / passes token through
ui/src/api/agents.ts                                          # (no signature change — body passthrough; documented)
ui/src/components/agent-detail/AgentSkillsTab.tsx             # optional expectedUpdatedAt prop + 409 branch in catch
ui/src/components/agent-detail/__tests__/AgentSkillsTab.test.tsx  # update payload assertions + add 409 test
ui/src/pages/AgentDetail.tsx                                  # pass agent.updatedAt to AgentSkillsTab; 409 onError on config save
ui/src/pages/AoaAgentDetail.tsx                               # pass agent.updatedAt to AgentSkillsTab; 409 onError on config save
ui/src/components/AgentConfigForm.tsx                          # inject expectedUpdatedAt: agent.updatedAt into save patch
ui/src/components/__tests__/AgentConfigForm.concurrency.test.tsx  # NEW — patch carries expectedUpdatedAt
docs/architecture/decisions.md                                # NEW Decision #104 (locked pattern)
```

**Test commands (verified against repo):**
- Server suite (single file): `pnpm --filter @armyofagents/server exec vitest run src/__tests__/agents-update-concurrency.test.ts`
- Server suite (all): `pnpm --filter @armyofagents/server exec vitest run`
- Shared suite (single file): `pnpm --filter @armyofagents/shared exec vitest run src/__tests__/agent-validators.test.ts`
- UI suite (single file): `pnpm --filter @armyofagents/ui exec vitest run src/components/agent-detail/__tests__/AgentSkillsTab.test.tsx`
- UI suite (all): `pnpm --filter @armyofagents/ui exec vitest run`
- Typecheck (whole workspace): `pnpm typecheck`

> Note: `server/package.json` has **no** `test` script — tests are driven by `vitest` at the root or per-package via `pnpm --filter <pkg> exec vitest run`. Use the per-package `exec vitest` form above. (Verified: root `package.json` defines `"test": "vitest"` / `"test:run": "vitest run"`; the per-package configs are `server/vitest.config.ts`, `packages/shared/vitest.config.ts`, `ui/vitest.config.ts`.)

---

## Task 0 — Branch off main

**Files:** none (git only).

- [ ] From the worktree `C:/Users/TK/.aoa/wt/agent-page-followups` (== main), create the working branch: `git checkout -b feat/agent-update-optimistic-concurrency`
- [ ] Confirm clean base: `git status` shows only the (already-present) plan/design docs as untracked; no source changes.

---

## Task 1 — Shared validator: optional `expectedUpdatedAt`

**Files:**
- `packages/shared/src/validators/agent.ts` — `updateAgentSchema` is at lines **55-64** (built from `createAgentSchema.omit({permissions}).partial().extend({...})`).
- `packages/shared/src/__tests__/agent-validators.test.ts` — NEW (no existing agent-validators test file; create one). Follow the contract-test style used in `packages/shared/src/__tests__/environment-validators.test.ts`.

TDD steps:

- [ ] **Write failing test.** Create `packages/shared/src/__tests__/agent-validators.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { updateAgentSchema } from "../validators/agent.js";

  describe("updateAgentSchema — expectedUpdatedAt (optimistic concurrency token)", () => {
    it("accepts an absent token (back-compat: last-write-wins path)", () => {
      const parsed = updateAgentSchema.parse({ title: "New title" });
      expect(parsed).not.toHaveProperty("expectedUpdatedAt");
    });

    it("accepts a valid ISO datetime token", () => {
      const iso = new Date("2026-06-25T12:00:00.000Z").toISOString();
      const parsed = updateAgentSchema.parse({ title: "x", expectedUpdatedAt: iso });
      expect(parsed.expectedUpdatedAt).toBe(iso);
    });

    it("rejects a non-datetime token", () => {
      const res = updateAgentSchema.safeParse({ expectedUpdatedAt: "not-a-date" });
      expect(res.success).toBe(false);
    });
  });
  ```
- [ ] **Run, expect FAIL:** `pnpm --filter @armyofagents/shared exec vitest run src/__tests__/agent-validators.test.ts` → fails (the `.parse` either errors on an unknown key or the type field doesn't exist yet — depending on `.passthrough()`; either way the "rejects a non-datetime token" case will not yet behave correctly because there is no field to validate).
- [ ] **Implement REAL code.** In `packages/shared/src/validators/agent.ts`, extend `updateAgentSchema` (lines 55-64). The field is an **optional ISO datetime string**:
  ```ts
  export const updateAgentSchema = createAgentSchema
    .omit({ permissions: true })
    .partial()
    .extend({
      permissions: z.never().optional(),
      status: z.enum(AGENT_STATUSES).optional(),
      spentMonthlyCents: z.number().int().nonnegative().optional(),
      skillKeys: z.array(z.string()).optional(),
      defaultEnvironmentId: z.string().uuid().optional().nullable(),
      // Optimistic-concurrency token. OPTIONAL: when present, the update is
      // guarded against `agents.updatedAt` (atomic conditional UPDATE → 409 on
      // mismatch). When absent, the write is last-write-wins (full back-compat).
      // Token = the agent row's `updatedAt`, round-tripped as an ISO string.
      expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
    });
  ```
  > `z.string().datetime({ offset: true })` accepts the `Z`-suffixed and `+00:00` forms that `Date.prototype.toISOString()` and JSON-serialized `Date` columns produce. Do NOT make it `.nullable()` — absent (`undefined`) is the back-compat signal; `null` adds no value.
- [ ] **Run, expect PASS:** same command → green.
- [ ] **Typecheck:** `pnpm --filter @armyofagents/shared exec tsc --noEmit` (or `pnpm typecheck`) → clean.
- [ ] **Commit:** `feat(agents): add optional expectedUpdatedAt token to updateAgentSchema` (with the Co-Authored-By trailer).

---

## Task 2 — Service: thread the token into the guarded UPDATE → 409

**Files:**
- `server/src/services/agents.ts`:
  - `UpdateAgentOptions` interface at lines **90-92** (currently `{ recordRevision?: RevisionMetadata }`).
  - `updateAgent(id, data, options?)` at lines **275-370**. The current guarded write is lines **343-348**:
    ```ts
    const updated = await db
      .update(agents)
      .set({ ...normalizedPatch, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning()
      .then((rows) => rows[0] ?? null);
    ```
  - `getById` at lines **229-236** (the re-read source).
  - `and`, `eq` are already imported (line 2: `import { and, desc, eq, inArray, isNull, isNotNull, ne } from "drizzle-orm";`).
  - `conflict` is already imported (line 20: `import { conflict, notFound, unprocessable } from "../errors.js";`).

TDD steps:

- [ ] **Write failing test.** Create `server/src/__tests__/agents-update-concurrency.test.ts`. Use the existing `createAgentDb` sequence-DB helper (`./helpers/mock-db.js`) + the table/operator mocks (`./helpers/drizzle-mock.js`), matching the pattern in `agents-lifecycle-routes.test.ts`. The service's `updateAgent` issues, in order: (1) a `select` for `getById(id)` → existing row; (2) the guarded `update`; on zero-row results when a token was supplied, (3) a second `select` for the re-read. Sequence the mock results to drive each branch.
  ```ts
  import { describe, it, expect, beforeEach, vi } from "vitest";
  import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";
  import { createAgentDb } from "./helpers/mock-db.js";

  vi.mock("drizzle-orm", () => drizzleOperatorStubs());
  vi.mock("@armyofagents/db", () => ({
    agents: makeTableProxy("agents"),
    agentConfigRevisions: makeTableProxy("agent_config_revisions"),
  }));

  // org-hierarchy is constructed inside agentService(); stub it so the parent
  // branches in updateAgent are inert for these patches (we patch `title` only).
  vi.mock("../services/org-hierarchy.js", () => ({
    orgHierarchyService: () => ({
      ensureParent: vi.fn(),
      assertNoCycle: vi.fn(),
    }),
  }));

  import { agentService } from "../services/agents.js";

  const T0 = new Date("2026-06-25T12:00:00.000Z"); // stored updatedAt
  const T1 = new Date("2026-06-25T12:05:00.000Z"); // changed-underneath updatedAt
  const existing = {
    id: "a1", companyId: "c1", name: "Atlas", role: "general", kind: "org",
    status: "idle", reportsTo: null, parentType: null, parentId: null,
    adapterType: "process", adapterConfig: {}, runtimeConfig: {},
    budgetMonthlyCents: 0, spentMonthlyCents: 0, permissions: {},
    skillKeys: [], metadata: null, createdAt: T0, updatedAt: T0,
  };

  beforeEach(() => vi.clearAllMocks());

  it("no token → last-write-wins update succeeds (back-compat)", async () => {
    const db = createAgentDb({
      selects: [[existing]],                         // getById
      updates: [[{ ...existing, title: "X", updatedAt: T1 }]], // guarded update hits 1 row
    });
    const svc = agentService(db as never);
    const res = await svc.update("a1", { title: "X" });
    expect(res?.title).toBe("X");
  });

  it("matching token → update succeeds", async () => {
    const db = createAgentDb({
      selects: [[existing]],
      updates: [[{ ...existing, title: "X", updatedAt: T1 }]],
    });
    const svc = agentService(db as never);
    const res = await svc.update("a1", { title: "X" }, { expectedUpdatedAt: T0.toISOString() });
    expect(res?.title).toBe("X");
  });

  it("stale token (row changed) → throws 409 conflict with current updatedAt", async () => {
    const db = createAgentDb({
      selects: [[existing], [{ ...existing, updatedAt: T1 }]], // getById, then re-read shows it still exists
      updates: [[]],                                            // guarded update matched 0 rows
    });
    const svc = agentService(db as never);
    await expect(
      svc.update("a1", { title: "X" }, { expectedUpdatedAt: T0.toISOString() }),
    ).rejects.toMatchObject({
      status: 409,
      details: { currentUpdatedAt: T1.toISOString() },
    });
  });

  it("token for a vanished row → returns null (route maps to 404, not 409)", async () => {
    const db = createAgentDb({
      selects: [[existing], []], // getById finds it, but the re-read finds nothing (deleted concurrently)
      updates: [[]],             // guarded update matched 0 rows
    });
    const svc = agentService(db as never);
    const res = await svc.update("a1", { title: "X" }, { expectedUpdatedAt: T0.toISOString() });
    expect(res).toBeNull();
  });
  ```
  > If `createAgentDb` ordering proves awkward for the dual-select sequence (initial `getById` + post-conflict re-read), declare a small local sequence-DB inline (the repo sanctions per-test local DBs — see the note in `helpers/drizzle-mock.ts`). Keep the assertions identical.
- [ ] **Run, expect FAIL:** `pnpm --filter @armyofagents/server exec vitest run src/__tests__/agents-update-concurrency.test.ts` → the stale-token and back-compat tests fail (the service ignores the token today and the WHERE is id-only).
- [ ] **Implement REAL code — step A: extend options.** Lines 90-92:
  ```ts
  interface UpdateAgentOptions {
    recordRevision?: RevisionMetadata;
    /**
     * Optimistic-concurrency token (the agent row's `updatedAt`, as an ISO
     * string). When present, the write is an atomic conditional UPDATE guarded
     * against `agents.updatedAt`; a mismatch (row changed underneath, while it
     * still exists) throws `conflict()` (409). When absent, last-write-wins.
     */
    expectedUpdatedAt?: string;
  }
  ```
- [ ] **Implement REAL code — step B: guarded UPDATE + conflict.** Replace the write at lines 343-348:
  ```ts
  const expectedAt =
    options?.expectedUpdatedAt != null ? new Date(options.expectedUpdatedAt) : null;
  const guard =
    expectedAt != null
      ? and(eq(agents.id, id), eq(agents.updatedAt, expectedAt))
      : eq(agents.id, id);

  const updated = await db
    .update(agents)
    .set({ ...normalizedPatch, updatedAt: new Date() })
    .where(guard)
    .returning()
    .then((rows) => rows[0] ?? null);

  // Optimistic-concurrency: a token was supplied but the guarded write matched
  // no row. Distinguish "row changed underneath" (409) from "row gone" (404):
  // re-read by id. A pre-read compare would be TOCTOU — the guard above is the
  // atomic check; this re-read only classifies the miss. (Precedent: issues.ts
  // `checkout`.)
  if (!updated && expectedAt != null) {
    const current = await getById(id);
    if (current) {
      throw conflict(
        "This agent was changed by someone else. Reload and re-apply your change.",
        { currentUpdatedAt: current.updatedAt },
      );
    }
    return null; // row vanished concurrently → caller/route maps to 404
  }
  ```
  > `current.updatedAt` is a JS `Date`. `HttpError.details` is serialized to JSON by `middleware/error-handler.ts` (line 34: `...(err.details ? { details: err.details } : {})`), and `JSON.stringify(Date)` yields the ISO string — matching the test's `{ currentUpdatedAt: T1.toISOString() }`. Keep it a `Date` in the service; the JSON boundary stringifies it.
  >
  > Leave the existing `recordRevision` block (lines 350-367) untouched — it already keys off `normalizedUpdated`, which is `null` on a conflict-miss return, so no revision is recorded for a clobbered write. Good.
- [ ] **Run, expect PASS:** same command → all four cases green.
- [ ] **Typecheck:** `pnpm --filter @armyofagents/server exec tsc --noEmit` → clean.
- [ ] **Commit:** `feat(agents): guard agent update with optional expectedUpdatedAt token (409 on conflict)`.

---

## Task 3 — Route: forward the token; confirm 409/404 mapping

**Files:**
- `server/src/routes/agents.ts` — the PATCH handler at lines **1269-1365**. Key spots:
  - `existing = await svc.getById(id)` (1271); 404 if missing (1272-1274).
  - `const patchData = { ...(req.body as Record<string, unknown>) };` (1283).
  - `const agent = await svc.update(id, patchData, { recordRevision: {...} });` (1333-1339).
  - post-update `if (!agent) { res.status(404)... }` (1347-1350).

TDD steps:

- [ ] **Write failing test.** Create `server/src/__tests__/agents-update-concurrency-route.test.ts`, modeled on `agents-lifecycle-routes.test.ts` (mount `agentRoutes` on an express app with an injected board actor + `errorHandler`, mock `agentService` via `vi.mock("../services/index.js", ...)`). Assert:
  1. **Token forwarded:** when the body carries `expectedUpdatedAt`, the mocked `svc.update` is called with that value in its options object.
  2. **409 propagation:** when `svc.update` rejects with `conflict("…", { currentUpdatedAt })`, the response is `409` and the JSON body is `{ error, details: { currentUpdatedAt } }`.
  3. **404 on vanished row:** when `svc.update` resolves `null` (token-miss on a deleted row), the response is `404` (existing branch).
  4. **Back-compat:** a PATCH with no token still 200s and calls `svc.update` with options that have no `expectedUpdatedAt`.
  ```ts
  // ... (mock scaffolding mirrors agents-lifecycle-routes.test.ts) ...
  import { conflict } from "../errors.js";

  it("forwards expectedUpdatedAt into svc.update options", async () => {
    mockAgentService.getById.mockResolvedValue({ id: AGENT_ID, companyId: "company-A" });
    mockAgentService.update.mockResolvedValue({ id: AGENT_ID, companyId: "company-A", title: "X" });
    const iso = new Date("2026-06-25T12:00:00.000Z").toISOString();
    const res = await request(makeApp(companyAActor))
      .patch(`/api/agents/${AGENT_ID}`)
      .send({ title: "X", expectedUpdatedAt: iso });
    expect(res.status).toBe(200);
    expect(mockAgentService.update).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({ title: "X" }),
      expect.objectContaining({ expectedUpdatedAt: iso }),
    );
  });

  it("maps a service conflict to 409 with currentUpdatedAt", async () => {
    mockAgentService.getById.mockResolvedValue({ id: AGENT_ID, companyId: "company-A" });
    const t1 = new Date("2026-06-25T12:05:00.000Z");
    mockAgentService.update.mockRejectedValue(
      conflict("This agent was changed by someone else. Reload and re-apply your change.", {
        currentUpdatedAt: t1,
      }),
    );
    const res = await request(makeApp(companyAActor))
      .patch(`/api/agents/${AGENT_ID}`)
      .send({ title: "X", expectedUpdatedAt: "2026-06-25T12:00:00.000Z" });
    expect(res.status).toBe(409);
    expect(res.body.details.currentUpdatedAt).toBe(t1.toISOString());
  });

  it("back-compat: no token still updates (200, no token in options)", async () => {
    mockAgentService.getById.mockResolvedValue({ id: AGENT_ID, companyId: "company-A" });
    mockAgentService.update.mockResolvedValue({ id: AGENT_ID, companyId: "company-A", title: "X" });
    const res = await request(makeApp(companyAActor)).patch(`/api/agents/${AGENT_ID}`).send({ title: "X" });
    expect(res.status).toBe(200);
    const opts = mockAgentService.update.mock.calls.at(-1)![2];
    expect(opts).not.toHaveProperty("expectedUpdatedAt");
  });
  ```
  > The route's mocked-service tests need the same `vi.mock` shims that `agents-lifecycle-routes.test.ts` uses (services/index, adapters/index, the four adapter packages, `@armyofagents/db`, `drizzle-orm`). Copy that block verbatim; add `update` results per case. Use the **board** actor (`companyAActor`) so authz passes.
- [ ] **Run, expect FAIL:** `pnpm --filter @armyofagents/server exec vitest run src/__tests__/agents-update-concurrency-route.test.ts` → the "forwards expectedUpdatedAt" case fails (the route doesn't pass the token yet).
- [ ] **Implement REAL code.** In `server/src/routes/agents.ts`:
  - The validator already strips unknown keys via `validate(updateAgentSchema)`, so `req.body.expectedUpdatedAt` is present only when valid. Pull it out **before** building `patchData`, and do not let it leak into the column patch:
    ```ts
    const { expectedUpdatedAt, ...bodyRest } = req.body as Record<string, unknown>;
    const patchData = { ...bodyRest };
    ```
    (Replace the current line 1283 `const patchData = { ...(req.body as Record<string, unknown>) };`. Everything downstream that reads `patchData.adapterConfig`/`patchData.skillKeys`/etc. is unaffected — those keys are still in `bodyRest`.)
  - Thread the token into the `svc.update` options (lines 1333-1339):
    ```ts
    const agent = await svc.update(id, patchData, {
      recordRevision: {
        createdByAgentId: actor.agentId,
        createdByUserId: actor.actorType === "user" ? actor.actorId : null,
        source: "patch",
      },
      ...(typeof expectedUpdatedAt === "string" ? { expectedUpdatedAt } : {}),
    });
    ```
  - **No new 409 mapping is needed.** A thrown `conflict()` is an `HttpError(409, …, details)`; the route has no try/catch around `svc.update`, so it propagates to `middleware/error-handler.ts`, which emits `{ error, details }` at status 409 (verified: error-handler lines 21-36). The existing `if (!agent) { res.status(404) }` branch (1347-1350) already covers the vanished-row null return. The `summarizeAgentUpdateDetails(patchData)` activity-log call is unaffected (token was never in `patchData`).
- [ ] **Run, expect PASS:** same command → all route cases green.
- [ ] **Run the existing agent route suites** to prove no regression: `pnpm --filter @armyofagents/server exec vitest run src/__tests__/agents-lifecycle-routes.test.ts src/__tests__/agents-adapter-validation.contract.test.ts` → green.
- [ ] **Typecheck:** `pnpm --filter @armyofagents/server exec tsc --noEmit` → clean.
- [ ] **Commit:** `feat(agents): forward expectedUpdatedAt from PATCH /agents/:id to the guarded service update`.

---

## Task 4 — UI: Skills tab opts in (token + 409 handling) + payload-test reconciliation

**Background (verified):** `AgentSkillsTab` (`ui/src/components/agent-detail/AgentSkillsTab.tsx`) today takes only `{ agentId, companyId, skillKeys, skillsRoute }` — it does **not** receive `updatedAt`. Both parents render the shared component with the full `agent` object available: `AgentDetail.tsx:677-681` and `AoaAgentDetail.tsx:321-325` (the local `AoaSkillsTab` at `AoaAgentDetail.tsx:520` is **dead code** — not rendered). The existing test `ui/src/components/agent-detail/__tests__/AgentSkillsTab.test.tsx` asserts the **exact** payload `agentsApi.update("a1", { skillKeys: [...] })` (no token) in three cases (lines 50, 121, 160, 177).

**Payload-test reconciliation decision (RESOLVED):** Make the token **conditional on having a cached `updatedAt`**, threaded via a new **optional** prop `expectedUpdatedAt?: string`.
- When the prop is **absent** (the prop's default in the existing tests, which render `<AgentSkillsTab ... />` with no `expectedUpdatedAt`), the payload stays exactly `{ skillKeys: [...] }` — so the three existing payload assertions **pass unchanged**.
- When the prop is **present** (production: parents pass `agent.updatedAt`), the payload becomes `{ skillKeys: [...], expectedUpdatedAt }`.
- One **new** test renders with the prop and asserts the token is included + the 409 branch. This keeps the public-payload contract test stable while exercising the opt-in path. (Chosen over "always send the token" because that would force rewriting 3 stable assertions for no behavioral gain — and the prop-absent default is exactly what those tests render.)

**Files:**
- `ui/src/components/agent-detail/AgentSkillsTab.tsx` — props (17-28), `handleToggle` (58-93), the `catch` (84-92).
- `ui/src/components/agent-detail/__tests__/AgentSkillsTab.test.tsx`.
- `ui/src/lib/toast.ts` — `toast.error(title, { description })` (verified signature).
- `ui/src/api/client.ts` — `ApiError` has `.status` (line 10) and `.body` (line 11); a 409 is `error instanceof ApiError && error.status === 409`.

TDD steps:

- [ ] **Write failing test.** Add to `AgentSkillsTab.test.tsx`:
  ```ts
  import { ApiError } from "../../../api/client";
  import { toast } from "../../../lib/toast";
  vi.mock("../../../lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

  it("includes expectedUpdatedAt in the payload when the prop is provided", async () => {
    vi.mocked(agentsApi.update).mockResolvedValue({} as never);
    renderWithProviders(
      <AgentSkillsTab agentId="a1" companyId="c1" skillKeys={[]} expectedUpdatedAt="2026-06-25T12:00:00.000Z" />,
    );
    await screen.findByText("Skill A");
    fireEvent.click(row("Skill A"));
    await waitFor(() => expect(agentsApi.update).toHaveBeenCalledTimes(1));
    expect(agentsApi.update).toHaveBeenCalledWith("a1", {
      skillKeys: ["skill-a"],
      expectedUpdatedAt: "2026-06-25T12:00:00.000Z",
    });
  });

  it("on a 409, rolls back and toasts 'changed elsewhere'", async () => {
    vi.mocked(agentsApi.update).mockRejectedValue(
      new ApiError("changed", 409, { error: "changed", details: { currentUpdatedAt: "…" } }),
    );
    renderWithProviders(
      <AgentSkillsTab agentId="a1" companyId="c1" skillKeys={[]} expectedUpdatedAt="2026-06-25T12:00:00.000Z" />,
    );
    await screen.findByText("Skill A");
    fireEvent.click(row("Skill A"));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // optimistic toggle rolled back
    expect(row("Skill A")).toHaveAttribute("aria-pressed", "false");
  });

  it("back-compat: no expectedUpdatedAt prop → payload omits the token", async () => {
    vi.mocked(agentsApi.update).mockResolvedValue({} as never);
    renderWithProviders(<AgentSkillsTab agentId="a1" companyId="c1" skillKeys={[]} />);
    await screen.findByText("Skill A");
    fireEvent.click(row("Skill A"));
    await waitFor(() => expect(agentsApi.update).toHaveBeenCalledWith("a1", { skillKeys: ["skill-a"] }));
  });
  ```
- [ ] **Run, expect FAIL:** `pnpm --filter @armyofagents/ui exec vitest run src/components/agent-detail/__tests__/AgentSkillsTab.test.tsx` → the three new tests fail (prop unknown / token not sent / no 409 branch).
- [ ] **Implement REAL code.** In `AgentSkillsTab.tsx`:
  - Add the optional prop to the signature (17-28):
    ```ts
    export function AgentSkillsTab({
      agentId,
      companyId,
      skillKeys: initialSkillKeys,
      skillsRoute = "/skills",
      expectedUpdatedAt,
    }: {
      agentId: string;
      companyId: string;
      skillKeys: string[];
      skillsRoute?: string;
      /**
       * Optimistic-concurrency token (the agent row's `updatedAt`, ISO string).
       * When provided, each skill PATCH is guarded against concurrent edits and
       * a 409 surfaces a "changed elsewhere" toast. When omitted, the save is
       * last-write-wins (back-compat — and the payload omits the token).
       */
      expectedUpdatedAt?: string;
    }) {
    ```
  - Import the 409 detector + toast at the top:
    ```ts
    import { ApiError } from "../../api/client";
    import { toast } from "../../lib/toast";
    ```
  - In `handleToggle`, build the payload conditionally and add the 409 branch inside the existing `catch` (84-92):
    ```ts
    try {
      const payload: Record<string, unknown> = { skillKeys: next };
      if (expectedUpdatedAt) payload.expectedUpdatedAt = expectedUpdatedAt;
      await agentsApi.update(agentId, payload as never);
      latestSkillKeys.current = next;
      void queryClient.invalidateQueries({ queryKey: ["agents", "detail"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.companySkills.list(companyId) });
    } catch (e) {
      // Roll back the optimistic change to the freshest server-known set.
      setLocalKeys(latestSkillKeys.current);
      if (e instanceof ApiError && e.status === 409) {
        // Concurrent edit: the agent changed under us. Refetch + tell the user
        // to redo their toggle against the reloaded state (Decision #104).
        void queryClient.invalidateQueries({ queryKey: ["agents", "detail"] });
        toast.error("This agent changed elsewhere", {
          description: "Reloaded the latest version — please redo your change.",
        });
      } else {
        setError(e instanceof Error ? e.message : "Failed to update skills");
      }
    } finally {
      setPendingKey(null);
    }
    ```
    > The prop-absent branch keeps `payload === { skillKeys: next }` (a plain object literal, not a superset) so the three existing `toHaveBeenCalledWith("a1", { skillKeys: [...] })` assertions still match exactly.
- [ ] **Run, expect PASS:** same command → all AgentSkillsTab tests green (the three original payload assertions + the three new ones).
- [ ] **Wire the parents to pass the token.** No new tests required for these one-line prop additions (covered by the component test + the page smoke tests), but make the edits:
  - `ui/src/pages/AgentDetail.tsx:677-681`:
    ```tsx
    <AgentSkillsTab
      agentId={agent.id}
      companyId={resolvedCompanyId}
      skillKeys={(agent as any).skillKeys ?? []}
      expectedUpdatedAt={agent.updatedAt ? new Date(agent.updatedAt).toISOString() : undefined}
    />
    ```
  - `ui/src/pages/AoaAgentDetail.tsx:321-325`: same `expectedUpdatedAt` prop addition.
  > `agent.updatedAt` is typed `Date` on the `Agent` shared type but arrives over JSON as a string; `new Date(agent.updatedAt).toISOString()` normalizes either form to the exact ISO the server stored (ms precision preserved). Guard with the ternary so a (theoretically) absent value sends no token rather than `"Invalid Date"`.
- [ ] **Typecheck:** `pnpm --filter @armyofagents/ui exec tsc --noEmit` → clean.
- [ ] **Commit:** `feat(agents-ui): opt Skills tab into optimistic concurrency (token + 409 toast)`.

---

## Task 5 — UI: Config save opts in (token + 409 handling)

**Background (verified):** Both config-save paths use the same shape — a `useMutation` wrapping `agentsApi.update(agent.id, data, companyId)` with `onSuccess` invalidation, feeding `<AgentConfigForm onSave={(patch) => updateAgent.mutate(patch)} agent={agent} ... />`:
- Worker page: `ui/src/pages/AgentDetail.tsx:1355-1382`.
- AoA page: `ui/src/pages/AoaAgentDetail.tsx:486-513`.
`AgentConfigForm.handleSave` (`ui/src/components/AgentConfigForm.tsx:292-333`) builds `patch` from the dirty overlay and calls `props.onSave(patch)`; `props.agent` (with `agent.updatedAt`) is in scope.

**Approach:** Inject the token in `AgentConfigForm.handleSave` (it owns the patch + has `props.agent`), then add a 409 `onError` to **both** `updateAgent` mutations (they own the toast/refetch + react-query error surface).

**Files:**
- `ui/src/components/AgentConfigForm.tsx` — `handleSave` (292-333), specifically the final `props.onSave(patch)` (332).
- `ui/src/pages/AgentDetail.tsx` — `updateAgent` mutation (1355-1362).
- `ui/src/pages/AoaAgentDetail.tsx` — `updateAgent` mutation (486-494).
- NEW: `ui/src/components/__tests__/AgentConfigForm.concurrency.test.tsx`.

TDD steps:

- [ ] **Write failing test.** Create `ui/src/components/__tests__/AgentConfigForm.concurrency.test.tsx`. Render `AgentConfigForm` in `mode="edit"` with a stub `agent` (include `updatedAt`), make a field dirty (e.g. change `title`), invoke the exposed save action, and assert the `onSave` patch includes `expectedUpdatedAt` equal to `new Date(agent.updatedAt).toISOString()`. Mirror the render/provider setup of any existing `AgentConfigForm` test if one exists; otherwise use `renderWithProviders` from `ui/src/__tests__/test-utils` and drive the save via the `onSaveActionChange` callback (the form registers its save fn through it — see lines 338-341).
  ```ts
  it("includes expectedUpdatedAt in the save patch", async () => {
    const onSave = vi.fn();
    let save: (() => void) | null = null;
    const agent = { id: "a1", /* …minimal Agent… */, title: "Old", updatedAt: "2026-06-25T12:00:00.000Z" } as never;
    renderWithProviders(
      <AgentConfigForm
        mode="edit" agent={agent} onSave={onSave} isSaving={false}
        onSaveActionChange={(fn) => { save = fn; }}
        onDirtyChange={() => {}} onCancelActionChange={() => {}}
      />,
    );
    // make `title` dirty via the identity input, then:
    save?.();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUpdatedAt: "2026-06-25T12:00:00.000Z" }),
    ));
  });
  ```
  > Driving the dirty state requires interacting with the identity field; reuse the field selectors from an existing AgentConfigForm test if present (search `ui/src/components/__tests__/` for `AgentConfigForm`). If none exists, set the dirty field via the rendered input by label/placeholder. Keep the assertion on the `expectedUpdatedAt` key.
- [ ] **Run, expect FAIL:** `pnpm --filter @armyofagents/ui exec vitest run src/components/__tests__/AgentConfigForm.concurrency.test.tsx` → fails (patch has no token yet).
- [ ] **Implement REAL code — form.** In `AgentConfigForm.tsx` `handleSave`, just before `props.onSave(patch)` (line 332):
  ```ts
  // Optimistic-concurrency token: guard this whole-row save against a concurrent
  // edit. `agent.updatedAt` is the row version the user was editing. (Decision #104)
  if (agent.updatedAt) {
    patch.expectedUpdatedAt = new Date(agent.updatedAt).toISOString();
  }

  props.onSave(patch);
  ```
  > Only set it when a save actually fires (the early `if (isCreate || !isDirty) return;` at line 293 already gates create/no-op). Create mode never sends a token (no row to guard).
- [ ] **Implement REAL code — mutation 409 handlers.** Add an `onError` to **both** `updateAgent` mutations. They both already have `useQueryClient` and import paths for toast/ApiError are available in the page modules (add imports if absent: `import { toast } from "@/lib/toast";` and `import { ApiError } from "@/api/client";` — verify the page's existing alias style; both pages already import from `@/...` or `../`).
  - `ui/src/pages/AoaAgentDetail.tsx:486-494`:
    ```ts
    const updateAgent = useMutation({
      mutationFn: (data: Record<string, unknown>) => agentsApi.update(agent.id, data, companyId),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
        if (agent.urlKey) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.urlKey) });
        }
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
          if (agent.urlKey) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.urlKey) });
          }
          toast.error("This agent changed elsewhere", {
            description: "Reloaded the latest version — please redo your change.",
          });
        }
      },
    });
    ```
  - `ui/src/pages/AgentDetail.tsx:1355-1362`: same `onError` (it also invalidates `configRevisions(agent.id)` in `onSuccess` — keep that; mirror the detail invalidations in `onError`).
- [ ] **Run, expect PASS:** `pnpm --filter @armyofagents/ui exec vitest run src/components/__tests__/AgentConfigForm.concurrency.test.tsx` → green.
- [ ] **Run the broader UI agent suites** for regression: `pnpm --filter @armyofagents/ui exec vitest run src/pages/__tests__/AoaAgentDetail.test.tsx src/components/agent-detail/__tests__/AgentSkillsTab.test.tsx` (and any `AgentDetail` page test) → green. If a page test asserts an exact config-save payload without a token, update it to `expect.objectContaining(...)` or add `expectedUpdatedAt` (same reconciliation rule as Task 4 — be explicit and consistent).
- [ ] **Typecheck:** `pnpm --filter @armyofagents/ui exec tsc --noEmit` → clean.
- [ ] **Commit:** `feat(agents-ui): opt Config save into optimistic concurrency (token + 409 toast)`.

---

## Task 6 — Governance: record the locked decision

**Files:**
- `docs/architecture/decisions.md` — append a new section. The latest decision is **#103** (file ends at line 798 with the `[#197]`/`[#198]`/`[#203]` link-reference footer). The next number is **#104**. Recent decisions use the `## Decision #NNN — Title (date)` prose format (see #92–#103).

Steps (no test — docs):

- [ ] **Append the decision.** Insert a new `## Decision #104` section **before** the trailing link-reference footer block (the three `[#NNN]:` lines at the end), so the link refs stay last:
  ```md
  ## Decision #104 — Optimistic concurrency for agent updates: optional `updatedAt` token → 409 (2026-06-25)

  Agent updates (`PATCH /api/agents/:id` → `agentService.update`) were pure
  last-write-wins (guarded by `id` only). Two concurrent human editors of the same
  agent (two tabs / two board members) silently clobbered each other. This is
  hardening, not a live fire — no MCP/automated path writes agents today — but the
  fix is cheap and aligns with **Decision #45** ("founder picks winner — surface
  conflicts, no auto-merge").

  **Locked pattern:**
  - **Token = the existing `agents.updatedAt`** (stamped on every write). No version
    column, **no DB migration**.
  - **Optional / opt-in.** `updateAgentSchema` gains `expectedUpdatedAt?` (ISO
    datetime). Absent → last-write-wins (full back-compat; no caller breaks).
    Present → enforced.
  - **Race-free atomic guard.** The check lives in the WHERE clause of the UPDATE —
    `where(and(eq(agents.id, id), eq(agents.updatedAt, expected)))` — never a
    pre-read compare (that is TOCTOU). Zero rows matched **while the row still
    exists** → `conflict()` (HTTP **409**) with `details.currentUpdatedAt` so the
    client can refetch. Zero rows + row gone → `null` → 404. Precedent: the atomic
    conditional UPDATE in `issues.ts` `checkout`.
  - **Scope = whole row.** The token guards the entire `agents` row (Skills vs
    Config conflicts included). False-positive 409s on non-overlapping fields are
    acceptable — a refetch resolves them. Field-level reconciliation via
    `agent_config_revisions.changedKeys` is a possible v2, not now.
  - **UI opt-in (first wave):** Skills tab + Config save send `agent.updatedAt`
    from the query cache; on 409 they invalidate/refetch and toast "changed
    elsewhere — reloaded, please redo." Other editors can opt in later by passing
    the token.

  Refs: `packages/shared/src/validators/agent.ts`, `server/src/services/agents.ts`,
  `server/src/routes/agents.ts`, `ui/src/components/agent-detail/AgentSkillsTab.tsx`,
  `ui/src/components/AgentConfigForm.tsx`;
  `docs/aoa/plans/2026-06-25-followup-3-agent-update-concurrency-plan.md`.
  ```
- [ ] **Verify placement:** the three `[#197]:` / `[#198]:` / `[#203]:` reference lines remain the last lines of the file; the new `## Decision #104` section sits immediately above them.
- [ ] **Commit:** `docs(decisions): record Decision #104 — optimistic concurrency for agent updates`.

---

## Task 7 — Full-suite verification + finish

**Files:** none (verification + git).

- [ ] **Server suite (all):** `pnpm --filter @armyofagents/server exec vitest run` → green.
- [ ] **Shared suite (all):** `pnpm --filter @armyofagents/shared exec vitest run` → green.
- [ ] **UI suite (all):** `pnpm --filter @armyofagents/ui exec vitest run` → green.
- [ ] **Workspace typecheck:** `pnpm typecheck` → clean.
- [ ] **Self-review the diff:** `git diff main...HEAD` — confirm: no raw SQL, no schema/migration files, no OSS headers, every commit has the Co-Authored-By trailer, the token is optional everywhere (no caller is forced to send it), and the three original `AgentSkillsTab` payload assertions are untouched.
- [ ] **Use superpowers:finishing-a-development-branch** to open the PR off `main` (own branch `feat/agent-update-optimistic-concurrency`). PR body ends with the `🤖 Generated with [Claude Code]` line; verify `ci-required` is green.

---

## Definition of done

- [ ] `updateAgentSchema` accepts an optional ISO `expectedUpdatedAt`; an invalid value is rejected; an absent value parses (back-compat). (Task 1)
- [ ] `agentService.update`: no token → last-write-wins; matching token → succeeds; stale token (row exists) → throws 409 `conflict()` carrying `currentUpdatedAt`; token + vanished row → returns `null` (404). The guard is the atomic WHERE, not a pre-read compare. (Task 2)
- [ ] `PATCH /api/agents/:id` forwards `expectedUpdatedAt` into `svc.update` options; a thrown conflict surfaces as HTTP 409 with `{ details: { currentUpdatedAt } }` via the existing error middleware; the vanished-row null still 404s; no-token PATCH still 200s. (Task 3)
- [ ] Skills tab sends the token only when the `expectedUpdatedAt` prop is provided, handles 409 (rollback + refetch + toast), and the three pre-existing exact-payload assertions still pass unchanged. (Task 4)
- [ ] Config save injects the token from `agent.updatedAt`; both worker + AoA `updateAgent` mutations handle 409 (refetch + toast). (Task 5)
- [ ] **Decision #104** recorded in `docs/architecture/decisions.md`. (Task 6)
- [ ] Server + shared + UI suites green; `pnpm typecheck` clean; back-compat (no-token) path tested at every layer. (Task 7)

---

## Self-review

- **Race-safety:** the only correctness-critical line is the guarded WHERE (`and(eq(id), eq(updatedAt, expected))`). I verified `and`/`eq` are already imported in `agents.ts` and that `conflict()` already yields a 409 `HttpError` whose `details` the error middleware serializes — so no route try/catch and no new error plumbing is required (the existing `conflict("Terminated agents cannot be resumed")` calls already propagate the same way). The re-read after a zero-row miss only *classifies* 409-vs-404; it is not the concurrency check.
- **Back-compat is load-bearing and tested at all four layers** (validator absent-token, service no-token, route no-token-in-options, UI prop-absent payload). The `AgentSkillsTab` payload-test question is resolved by an **optional prop** whose absent default is exactly what the three existing tests render — so they stay byte-identical; a new prop-present test covers the opt-in. This avoids churning stable assertions.
- **Things to double-check during execution:** (1) `createAgentDb`'s FIFO `selects` ordering for the dual-select sequence (initial `getById` + post-conflict re-read) — if it fights the helper, drop to a small inline sequence-DB (sanctioned by the repo). (2) Whether a page-level test for `AgentDetail`/`AoaAgentDetail` asserts an exact config-save payload — if so it needs the same `expect.objectContaining` relaxation (grep before Task 5's broad run). (3) The `@/lib/toast` vs `../../lib/toast` import alias must match each file's existing convention (Skills tab uses relative `../..`; pages may use `@/`). (4) `z.string().datetime({ offset: true })` must accept the exact form `new Date().toISOString()` emits — confirm in the validator test (it does: `…Z` is offset-compatible).
