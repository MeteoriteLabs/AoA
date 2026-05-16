# Runtime Preview Refresh and Viewer Openables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent-created app previews production-safe under concurrent workspace sessions, then verify the existing center viewer/openables behavior without rebuilding the viewer prematurely.

**Architecture:** Runtime preview health checks stay backend-owned and are triggered by runtime-services reads, but stale checks are guarded by a DB-backed TTL, per-process in-flight dedupe, and bounded probe concurrency. The center panel remains a tabbed viewer: sidebar rows and Viewer Home open concrete tabs; the `+` button opens Viewer Home/Browser/Logs without pretending it owns artifact creation.

**Tech Stack:** Express routes, Drizzle schema/migrations, Vitest unit tests, React Query, React Testing Library, Playwright for later E2E.

---

## Current Code Facts

- Runtime services are loaded by `server/src/routes/execution-workspaces.ts` via `GET /api/execution-workspaces/:id/runtime-services`.
- That route currently calls `refreshPersistedAdapterManagedPreviewRuntimeServices()` in `server/src/services/workspace-runtime.ts`.
- `refreshAdapterManagedPreviewRuntimeServiceRows()` currently probes all preview-only adapter-managed services immediately and in parallel.
- It only updates `updatedAt` when status changes, so a still-healthy service can be probed repeatedly on every refetch.
- `ui/src/components/workspace/sections/ServicesSection.tsx` refetches runtime services every 3 seconds while mounted.
- `ui/src/components/workspace/WorkspacePreviewPanel.tsx` already has center tabs: `home`, `browser`, `file`, `artifact`, `output`, and `logs`.
- Viewer Home already lists running services, latest artifact/output candidates, and logs.

## Decisions Locked For This Plan

- More than 5 previews must not be stopped or hidden. The limit applies only to simultaneous health-check probes.
- TTL is 30 seconds.
- Probe timeout remains 750ms.
- Probe concurrency is 5.
- Preview-only rows are exactly adapter-managed rows with `url`, no `command`, and no `providerRef`.
- Runtime app previews are interactive. HTML artifacts/outputs stay source-first for now.
- UI polling can remain 3 seconds because backend TTL makes most reads cheap.
- Existing test DB can be reset later; this plan does not include an existing-agent instruction migration.

---

## File Structure

- Modify `packages/db/src/schema/workspace_runtime_services.ts`
  - Add `healthCheckedAt`.
- Generate Drizzle migration via `pnpm db:generate`.
- Modify `server/src/services/workspace-runtime.ts`
  - Add TTL, concurrency limiting, and in-flight probe dedupe for adapter-managed preview refresh.
- Modify `server/src/__tests__/workspace-runtime.test.ts`
  - Add TTL/concurrency/in-flight tests.
- Modify `server/src/services/execution-workspaces.ts`
  - Include `healthCheckedAt` in API read model if needed.
- Modify `ui/src/api/execution-workspaces.ts`
  - Add `healthCheckedAt?: string | null` to `WorkspaceRuntimeService`.
- Modify `ui/src/components/workspace/WorkspacePreviewPanel.tsx`
  - Small copy/interaction polish only if tests show confusion. Do not rebuild the viewer.
- Modify `ui/src/__tests__/WorkspacePreviewPanel.test.tsx`
  - Verify Viewer Home/openables behavior with multiple services and unavailable services.
- Modify `ui/src/__tests__/ServicesSection.test.tsx`
  - Verify cached/unavailable preview display remains correct.
- Optional later: `tests/e2e/software-department-product.spec.ts`
  - Keep existing preview E2E as deferred local/CI work.

---

### Task 1: Add `healthCheckedAt` To Runtime Service Schema

**Files:**
- Modify: `packages/db/src/schema/workspace_runtime_services.ts`
- Generated: `packages/db/src/migrations/*`

- [ ] **Step 1: Add the schema field**

Add a nullable timestamp beside `healthStatus`:

```ts
healthStatus: text("health_status").notNull().default("unknown"),
healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 2: Generate migration**

Run:

```bash
pnpm db:generate
```

Expected:
- A new generated migration is created.
- No hand-written SQL migration is added.

- [ ] **Step 3: Typecheck DB package**

Run:

```bash
pnpm --filter @armyofagents/db typecheck
```

Expected: exit 0.

---

### Task 2: Write Backend TTL Tests First

**Files:**
- Modify: `server/src/__tests__/workspace-runtime.test.ts`

- [ ] **Step 1: Add a fresh-row test**

Add a test under `describe("refreshAdapterManagedPreviewRuntimeServiceRows", ...)`:

```ts
it("does not probe preview rows checked within the TTL", async () => {
  let probes = 0;
  const now = new Date("2026-05-17T10:00:30.000Z");
  const freshRow = {
    ...baseRow,
    healthCheckedAt: new Date("2026-05-17T10:00:10.000Z"),
  };

  const result = await refreshAdapterManagedPreviewRuntimeServiceRows({
    rows: [freshRow as any],
    now,
    ttlMs: 30_000,
    probeUrl: async () => {
      probes += 1;
      return false;
    },
  });

  expect(probes).toBe(0);
  expect(result.rows[0]).toBe(freshRow);
  expect(result.updates).toEqual([]);
});
```

- [ ] **Step 2: Add a stale-row test**

```ts
it("probes preview rows whose health check is stale", async () => {
  let probes = 0;
  const now = new Date("2026-05-17T10:01:00.000Z");
  const staleRow = {
    ...baseRow,
    healthCheckedAt: new Date("2026-05-17T10:00:00.000Z"),
  };

  const result = await refreshAdapterManagedPreviewRuntimeServiceRows({
    rows: [staleRow as any],
    now,
    ttlMs: 30_000,
    probeUrl: async () => {
      probes += 1;
      return true;
    },
  });

  expect(probes).toBe(1);
  expect(result.rows[0]).toMatchObject({
    status: "running",
    healthStatus: "healthy",
    healthCheckedAt: now,
    stoppedAt: null,
    updatedAt: now,
  });
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
pnpm test:run -- server/src/__tests__/workspace-runtime.test.ts
```

Expected:
- Fail because `ttlMs` and `healthCheckedAt` are not implemented yet.

---

### Task 3: Implement TTL And Health-Checked Updates

**Files:**
- Modify: `server/src/services/workspace-runtime.ts`

- [ ] **Step 1: Extend update type**

Update `PreviewRuntimeServiceUpdate`:

```ts
type PreviewRuntimeServiceUpdate = {
  id: string;
  status: string;
  healthStatus: string;
  stoppedAt: Date | null;
  healthCheckedAt: Date;
  updatedAt: Date;
};
```

- [ ] **Step 2: Add TTL helper**

```ts
function isPreviewHealthCheckStale(row: WorkspaceRuntimeServiceRow, now: Date, ttlMs: number): boolean {
  const checkedAt = dateTime(row.healthCheckedAt);
  if (checkedAt === null) return true;
  return now.getTime() - checkedAt >= ttlMs;
}
```

- [ ] **Step 3: Add `ttlMs` option and update unchanged probes**

Change function signature:

```ts
export async function refreshAdapterManagedPreviewRuntimeServiceRows(input: {
  rows: WorkspaceRuntimeServiceRow[];
  now?: Date;
  ttlMs?: number;
  maxConcurrency?: number;
  probeUrl?: (url: string) => Promise<boolean>;
}): Promise<{ rows: WorkspaceRuntimeServiceRow[]; updates: PreviewRuntimeServiceUpdate[] }> {
```

Use defaults:

```ts
const ttlMs = input.ttlMs ?? 30_000;
const maxConcurrency = input.maxConcurrency ?? 5;
```

For non-stale rows:

```ts
if (!isPreviewHealthCheckStale(row, now, ttlMs)) return row;
```

For stale rows, update `healthCheckedAt` even when status remains the same.

- [ ] **Step 4: Persist `healthCheckedAt`**

In `refreshPersistedAdapterManagedPreviewRuntimeServices()`, include:

```ts
healthCheckedAt: update.healthCheckedAt,
```

- [ ] **Step 5: Run TTL tests**

Run:

```bash
pnpm test:run -- server/src/__tests__/workspace-runtime.test.ts
```

Expected: TTL tests pass or reveal only concurrency gaps.

---

### Task 4: Add Probe Concurrency Limit

**Files:**
- Modify: `server/src/services/workspace-runtime.ts`
- Modify: `server/src/__tests__/workspace-runtime.test.ts`

- [ ] **Step 1: Add failing concurrency test**

```ts
it("limits concurrent preview probes without dropping previews", async () => {
  let active = 0;
  let maxActive = 0;
  let probes = 0;
  const now = new Date("2026-05-17T10:00:00.000Z");
  const rows = Array.from({ length: 12 }, (_, index) => ({
    ...baseRow,
    id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    serviceName: `localhost:${55000 + index}`,
    port: 55000 + index,
    url: `http://127.0.0.1:${55000 + index}/`,
    healthCheckedAt: null,
  }));

  const result = await refreshAdapterManagedPreviewRuntimeServiceRows({
    rows: rows as any,
    now,
    ttlMs: 30_000,
    maxConcurrency: 5,
    probeUrl: async () => {
      probes += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return true;
    },
  });

  expect(probes).toBe(12);
  expect(maxActive).toBeLessThanOrEqual(5);
  expect(result.rows).toHaveLength(12);
  expect(result.rows.every((row) => row.status === "running")).toBe(true);
});
```

- [ ] **Step 2: Implement local concurrency runner**

Add a helper in `workspace-runtime.ts`:

```ts
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await fn(items[currentIndex]!, currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}
```

Use it instead of `Promise.all(rows.map(...))`.

- [ ] **Step 3: Run concurrency test**

Run:

```bash
pnpm test:run -- server/src/__tests__/workspace-runtime.test.ts
```

Expected: concurrency test passes.

---

### Task 5: Add In-Flight Probe Dedupe

**Files:**
- Modify: `server/src/services/workspace-runtime.ts`
- Modify: `server/src/__tests__/workspace-runtime.test.ts`

- [ ] **Step 1: Add failing in-flight test**

```ts
it("deduplicates concurrent probes for the same preview service", async () => {
  let probes = 0;
  const now = new Date("2026-05-17T10:00:00.000Z");
  const row = {
    ...baseRow,
    healthCheckedAt: null,
  };

  const probeUrl = async () => {
    probes += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return true;
  };

  const [first, second] = await Promise.all([
    refreshAdapterManagedPreviewRuntimeServiceRows({
      rows: [row as any],
      now,
      ttlMs: 30_000,
      probeUrl,
    }),
    refreshAdapterManagedPreviewRuntimeServiceRows({
      rows: [row as any],
      now,
      ttlMs: 30_000,
      probeUrl,
    }),
  ]);

  expect(probes).toBe(1);
  expect(first.rows[0]?.healthStatus).toBe("healthy");
  expect(second.rows[0]?.healthStatus).toBe("healthy");
});
```

- [ ] **Step 2: Implement module-level in-flight map**

```ts
const previewProbeInFlight = new Map<string, Promise<boolean>>();

async function probePreviewUrlDeduped(input: {
  key: string;
  url: string;
  probeUrl: (url: string) => Promise<boolean>;
}): Promise<boolean> {
  const existing = previewProbeInFlight.get(input.key);
  if (existing) return existing;
  const promise = input.probeUrl(input.url).finally(() => {
    previewProbeInFlight.delete(input.key);
  });
  previewProbeInFlight.set(input.key, promise);
  return promise;
}
```

Use service `id` as key.

- [ ] **Step 3: Run in-flight test**

Run:

```bash
pnpm test:run -- server/src/__tests__/workspace-runtime.test.ts
```

Expected: in-flight dedupe passes.

---

### Task 6: Expose `healthCheckedAt` To UI Read Model

**Files:**
- Modify: `server/src/services/execution-workspaces.ts`
- Modify: `ui/src/api/execution-workspaces.ts`

- [ ] **Step 1: Check server read model**

If `toRuntimeService()` already spreads or explicitly maps all fields, ensure this is present:

```ts
healthCheckedAt: row.healthCheckedAt ?? null,
```

- [ ] **Step 2: Add UI type field**

In `WorkspaceRuntimeService`:

```ts
healthCheckedAt?: string | null;
```

- [ ] **Step 3: Typecheck**

Run:

```bash
pnpm -r typecheck
```

Expected: exit 0.

---

### Task 7: Verify Viewer/Openables Behavior Without Rebuild

**Files:**
- Modify: `ui/src/__tests__/WorkspacePreviewPanel.test.tsx`
- Modify: `ui/src/__tests__/ServicesSection.test.tsx`

- [ ] **Step 1: Add Viewer Home multiple-preview test**

```tsx
it("lists multiple running preview services in Viewer Home and opens the selected one", async () => {
  executionWorkspacesApiMock.runtimeServices.mockResolvedValue([
    { ...mockRunningService[0], id: "svc-1", serviceName: "web", url: "http://localhost:3000" },
    { ...mockRunningService[0], id: "svc-2", serviceName: "docs", url: "http://localhost:4173" },
  ]);
  artifactsApiMock.getByIssueId.mockResolvedValue(null);
  outputDetectionApiMock.listForIssue.mockResolvedValue([]);
  activityApiMock.runsForIssue.mockResolvedValue([]);
  const onOpenResolvedTab = vi.fn();

  render(
    <WorkspacePreviewPanel
      companyId="comp-1"
      tabs={[{ id: "home:issue-1", kind: "home", title: "Viewer", issueId: "issue-1" }]}
      activeTabId="home:issue-1"
      onSelectTab={() => {}}
      onCloseTab={() => {}}
      onOpenResolvedTab={onOpenResolvedTab}
      functionType="software_development"
      workspaceId="ws-1"
    />,
    { wrapper },
  );

  await waitFor(() => expect(screen.getByTestId("viewer-home-service-svc-2")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("viewer-home-service-svc-2"));
  expect(onOpenResolvedTab).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "browser", id: "browser:svc-2", url: "http://localhost:4173" }),
  );
});
```

- [ ] **Step 2: Verify unavailable previews are not offered as browser shortcuts**

Add a test confirming Viewer Home filters non-running/unhealthy preview rows from the Browser section.

- [ ] **Step 3: Verify ServicesSection still shows unavailable state**

Add or keep a test confirming:

```tsx
expect(row).toHaveTextContent("Preview");
expect(row).toHaveTextContent("Unavailable");
expect(screen.queryByTestId(`service-open-${service.id}`)).not.toBeInTheDocument();
```

- [ ] **Step 4: Run UI tests**

Run:

```bash
pnpm test:run -- ui/src/__tests__/WorkspacePreviewPanel.test.tsx ui/src/__tests__/ServicesSection.test.tsx
```

Expected: exit 0.

---

### Task 8: Manual Visual Verification

**Files:**
- No code files unless visual issues are found.

- [ ] **Step 1: Start dev server**

Run:

```bash
pnpm dev
```

Expected:
- App available at `http://localhost:3100`.

- [ ] **Step 2: Create or use a workspace with multiple preview rows**

Use either:
- A real agent run that emits `AOA_PREVIEW_URL=<url>`, or
- Existing test/dev data after DB reset.

- [ ] **Step 3: Verify Services card**

In the browser:
- Running preview shows `Preview`, port, URL, and `Open`.
- Stopped preview shows `Preview` + `Unavailable`.
- Preview rows do not show stop/restart/start buttons.
- Local process rows still show control buttons.

- [ ] **Step 4: Verify center panel**

In the browser:
- Click Services `Open`.
- Confirm a Browser tab opens in the center panel.
- Click the center panel `+`.
- Confirm Viewer Home opens or is available.
- Confirm Viewer Home lists running preview services.
- Click a service from Viewer Home and confirm the Browser tab opens.
- Confirm Logs still open.
- Confirm artifact/output rows still open their correct viewers.

- [ ] **Step 5: Observe network behavior**

Use browser dev tools or server logs:
- Multiple UI refetches within 30 seconds should not trigger repeated probes.
- After 30 seconds, a stale preview may be probed once.

---

### Task 9: Full Verification Before Commit

**Files:**
- All modified files.

- [ ] **Step 1: Run focused backend tests**

```bash
pnpm test:run -- server/src/__tests__/workspace-runtime.test.ts server/src/__tests__/runtime-service-preview-detection.test.ts
```

Expected: exit 0.

- [ ] **Step 2: Run focused UI tests**

```bash
pnpm test:run -- ui/src/__tests__/WorkspacePreviewPanel.test.tsx ui/src/__tests__/ServicesSection.test.tsx
```

Expected: exit 0.

- [ ] **Step 3: Run typecheck**

```bash
pnpm -r typecheck
```

Expected: exit 0.

- [ ] **Step 4: Run full tests**

```bash
pnpm test:run
```

Expected: exit 0. Warnings from existing tests may print, but no failed suites.

- [ ] **Step 5: Run build**

```bash
pnpm build
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/workspace_runtime_services.ts packages/db/src/migrations server/src/services/workspace-runtime.ts server/src/__tests__/workspace-runtime.test.ts server/src/services/execution-workspaces.ts ui/src/api/execution-workspaces.ts ui/src/components/workspace/WorkspacePreviewPanel.tsx ui/src/__tests__/WorkspacePreviewPanel.test.tsx ui/src/__tests__/ServicesSection.test.tsx
git commit -m "fix(workspace): throttle preview health checks"
```

Expected: clean commit with tests passing before commit.

---

## Plan Self-Review

- Spec coverage: TTL, concurrency, in-flight dedupe, UI behavior, visual verification, and full verification are covered.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `healthCheckedAt`, `ttlMs`, and `maxConcurrency` names are used consistently.
- Scope check: this is focused on preview refresh correctness and viewer verification, not a larger viewer redesign.
- Known deferred work: Playwright E2E for real agent-created previews remains deferred until local/GitHub DB setup is settled.

