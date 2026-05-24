# Threads — Plan 5: Continuum nav (List + Board + Unlisted)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. **Prerequisites: Plans 1-2 + Plan 4 merged.**

**Goal:** The index "continuum" — a List view and a Board view (phase columns + a pinned **Unlisted** lane), sidebar search, and the Router/Unlisted triage surface. (Graph lens + Live lane = v1.1.)

**Architecture:** New `ui/src/pages/ThreadsList.tsx` (List ⟷ Board toggle), `ui/src/components/threads/ThreadBoard.tsx`, `UnlistedLane.tsx`. Pure grouping + Router-confidence helpers are unit-tested. Backend adds `thread_inbox_items` list + triage endpoints. cmd+K integration extends `CommandPalette.tsx`.

**Tech stack:** React 19, `@tanstack/react-query` v5, `@dnd-kit` (drag between phase columns), `cmdk`, Tailwind v4. Backend: Express 5 + Drizzle. Tests: Vitest (+ RTL for components, jsdom).

**Run tests:** UI `pnpm --filter @armyofagents/ui exec vitest run <path>`; server `pnpm exec vitest run <path>`.

---

## Task 1: Pure board-grouping helper

**Files:**
- Create: `ui/src/components/threads/boardModel.ts`
- Test: `ui/src/components/threads/__tests__/boardModel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { groupThreadsForBoard } from "../boardModel";

const t = (over: Partial<{ id: string; phase: string; ownerUserId: string | null }>) => ({
  id: "x", phase: "discuss", ownerUserId: "u1", title: "X", ...over,
});

describe("groupThreadsForBoard", () => {
  it("buckets threads into phase columns in order", () => {
    const g = groupThreadsForBoard([t({ phase: "scope" }), t({ phase: "done" }), t({ phase: "discuss" })]);
    expect(Object.keys(g.columns)).toEqual(["discuss", "scope", "assign", "done"]);
    expect(g.columns.scope).toHaveLength(1);
    expect(g.columns.done).toHaveLength(1);
  });
  it("Unclaimed threads (owner null) also surface in the Unlisted lane", () => {
    const g = groupThreadsForBoard([t({ ownerUserId: null, phase: "discuss" })]);
    expect(g.unlisted).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @armyofagents/ui exec vitest run src/components/threads/__tests__/boardModel.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { THREAD_PHASES, type ThreadPhase } from "@armyofagents/shared";

export interface BoardThread { id: string; phase: string; ownerUserId: string | null; title: string | null; }
export interface BoardModel {
  unlisted: BoardThread[];
  columns: Record<ThreadPhase, BoardThread[]>;
}

export function groupThreadsForBoard(threads: BoardThread[]): BoardModel {
  const columns = Object.fromEntries(THREAD_PHASES.map((p) => [p, [] as BoardThread[]])) as Record<ThreadPhase, BoardThread[]>;
  const unlisted: BoardThread[] = [];
  for (const th of threads) {
    if (th.ownerUserId == null) unlisted.push(th); // Unclaimed -> Unlisted lane
    const phase = (THREAD_PHASES as readonly string[]).includes(th.phase) ? (th.phase as ThreadPhase) : "discuss";
    columns[phase].push(th);
  }
  return { unlisted, columns };
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/threads/boardModel.ts ui/src/components/threads/__tests__/boardModel.test.ts
git commit -m "feat(threads-ui): pure board grouping (phase columns + Unlisted lane)"
```

---

## Task 2: Router-confidence label (no raw %)

SPEC §10: never show the raw confidence number. >0.8 = auto-routed; 0.4-0.8 = suggested; <0.4 = stays Unlisted.

**Files:**
- Create: `ui/src/components/threads/routerConfidence.ts`
- Test: `ui/src/components/threads/__tests__/routerConfidence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { routerBand } from "../routerConfidence";

describe("routerBand", () => {
  it("maps confidence to a band with no raw number", () => {
    expect(routerBand(0.92)).toBe("auto");
    expect(routerBand(0.6)).toBe("suggested");
    expect(routerBand(0.2)).toBe("unsorted");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
export type RouterBand = "auto" | "suggested" | "unsorted";
export function routerBand(confidence: number): RouterBand {
  if (confidence > 0.8) return "auto";
  if (confidence >= 0.4) return "suggested";
  return "unsorted";
}
```

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/threads/routerConfidence.ts ui/src/components/threads/__tests__/routerConfidence.test.ts
git commit -m "feat(threads-ui): router confidence band (no raw %)"
```

---

## Task 3: Unlisted backend (list + triage)

**Files:**
- Modify: `server/src/services/threads.ts` (inbox methods)
- Modify: `server/src/routes/discussions.ts` (inbox endpoints)
- Test: `server/src/__tests__/threads-inbox.test.ts`

- [ ] **Step 1: Write the failing test** — assert `listInbox` returns pending items and `attachInbox`/`dismissInbox` change status.

```ts
import { describe, it, expect } from "vitest";
import { threadService } from "../services/threads.js";
import { createSequenceDb } from "./helpers/drizzle-mock.js";

describe("threadService inbox (Unlisted)", () => {
  it("lists pending inbox items for the company", async () => {
    const db = createSequenceDb([[{ id: "i1", status: "pending", rawContent: "hi" }]]);
    const rows = await threadService(db).listInbox("co1");
    expect(rows).toHaveLength(1);
  });
  it("dismiss sets status=dismissed", async () => {
    const db = createSequenceDb([[]]); // update
    const res = await threadService(db).dismissInbox("co1", "i1");
    expect(res.status).toBe("dismissed");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add to `threadService` (import `threadInboxItems` from `@armyofagents/db`):

```ts
    listInbox: async (companyId: string) =>
      db.select().from(threadInboxItems)
        .where(and(eq(threadInboxItems.companyId, companyId), eq(threadInboxItems.status, "pending")))
        .orderBy(desc(threadInboxItems.createdAt)),

    dismissInbox: async (companyId: string, id: string) => {
      await db.update(threadInboxItems).set({ status: "dismissed" })
        .where(and(eq(threadInboxItems.id, id), eq(threadInboxItems.companyId, companyId)));
      return { status: "dismissed" as const };
    },

    attachInbox: async (companyId: string, id: string, targetThreadId: string, actor: Actor) => {
      // create a discussion_entry on the target thread from the inbox raw content, then mark attached
      const item = await db.select().from(threadInboxItems)
        .where(and(eq(threadInboxItems.id, id), eq(threadInboxItems.companyId, companyId)))
        .then((r) => r[0] ?? null);
      if (!item) throw notFound("Inbox item not found");
      await db.insert(discussionEntries).values({
        discussionId: targetThreadId, inputType: "integration", rawContent: item.rawContent, createdBy: actor.userId,
      });
      await db.update(threadInboxItems).set({ status: "attached" }).where(eq(threadInboxItems.id, id));
      publishLiveEvent(companyId, { type: "thread.entry.created", threadId: targetThreadId });
      return { status: "attached" as const };
    },
```

Add routes in `server/src/routes/discussions.ts`:
- `GET  /companies/:companyId/thread-inbox` → `listInbox`
- `POST /companies/:companyId/thread-inbox/:id/attach` (body `{ targetThreadId }`) → `attachInbox`
- `POST /companies/:companyId/thread-inbox/:id/dismiss` → `dismissInbox`

(Import `discussionEntries`, `threadInboxItems` where needed.)

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/routes/discussions.ts server/src/__tests__/threads-inbox.test.ts
git commit -m "feat(threads): Unlisted inbox list + attach/dismiss triage"
```

---

## Task 4: ThreadsList — List view

**Files:**
- Create: `ui/src/pages/ThreadsList.tsx`
- Modify: app router (`/:companyPrefix/threads` → `ThreadsList`)
- Test: `ui/src/pages/__tests__/ThreadsList.test.tsx`

- [ ] **Step 1: Write the failing render test** — mock `threadsApi.list`, assert rows render with title + phase + owner, and a List/Board toggle exists.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — `ThreadsList.tsx`: a `useQuery(['threads', companyId, filters], () => threadsApi.list(...))`, a List/Board view toggle (`useState`), filter controls (phase, owner, scope), and the card spec (origin icon · title · type/intent chip · dept · ⚑ goal · owner · last activity · unread · pending-scope count). Each row links to `/…/threads/:id` (Plan 4 focus view). Reuse the existing `Discussions.tsx` list styling/patterns.

- [ ] **Step 4: Run to verify it passes + typecheck.**

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/ThreadsList.tsx ui/src/pages/__tests__/ThreadsList.test.tsx
git commit -m "feat(threads-ui): ThreadsList index (List view + filters)"
```

---

## Task 5: ThreadBoard + Unlisted lane

**Files:**
- Create: `ui/src/components/threads/ThreadBoard.tsx`
- Create: `ui/src/components/threads/UnlistedLane.tsx`
- Test: `ui/src/components/threads/__tests__/ThreadBoard.test.tsx`

- [ ] **Step 1: Write the failing render test** — feed mixed threads, assert four phase columns render with the right cards (via `groupThreadsForBoard`) and the Unlisted lane shows Unclaimed/inbox items.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement ThreadBoard** — uses `groupThreadsForBoard` (Task 1) to render four phase columns; cards link to the focus view; dragging a card across columns calls `threadsApi.advancePhase` (use `@dnd-kit`, mirror the Commander `SessionsSidebar` dnd setup). Render `UnlistedLane` pinned at the left (amber), fed by `threadsApi`/`threadInbox` list; clicking an Unlisted item opens triage (Make thread / Add to ▾ / Dismiss) — NOT the focus view (no thread yet). Use `routerBand` (Task 2) for the confidence chip; never show a raw %.

- [ ] **Step 4: Wire into ThreadsList** — the Board toggle renders `ThreadBoard`.

- [ ] **Step 5: Run to verify it passes + typecheck.**

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/threads/ThreadBoard.tsx ui/src/components/threads/UnlistedLane.tsx ui/src/components/threads/__tests__/ThreadBoard.test.tsx ui/src/pages/ThreadsList.tsx
git commit -m "feat(threads-ui): Board view (phase columns + Unlisted lane + triage)"
```

---

## Task 6: cmd+K Threads results

**Files:**
- Modify: `ui/src/components/CommandPalette.tsx`
- Test: covered by typecheck + an RTL interaction test if the existing palette has one.

- [ ] **Step 1: Implement** — in `CommandPalette.tsx`, add a THREADS result group (the global search backend already returns discussions/briefs; ensure threads are included — if the server search service has a discussions group, label it "Threads" and route results to `/…/threads/:id`). Reuse the existing `searchApi` grouping; add the THREADS group with the thread phase + owner badges.

- [ ] **Step 2: Verify** — `pnpm --filter @armyofagents/ui typecheck`; run the app, press cmd+K, search a thread title, confirm it appears under THREADS and navigates to the focus view.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/CommandPalette.tsx
git commit -m "feat(threads-ui): threads in cmd+K global search"
```

---

## Done criteria (Plan 5)

- `pnpm --filter @armyofagents/ui exec vitest run src/components/threads src/pages/__tests__/ThreadsList.test.tsx` — PASS.
- `pnpm exec vitest run server/src/__tests__/threads-inbox.test.ts` — PASS.
- Typechecks clean (ui + server).
- The Threads index renders as List and Board (phase columns + Unlisted lane); Unlisted triage attaches/dismisses; cmd+K finds threads.

Hand-off: Plan 6 adds the boundary mechanics (participants/@mention, ownership UI, per-item routing, cross-thread deps); Plan 7 adds real-time.

---

## Design-Review Amendments (2026-05-24)

Inherits the a11y baseline + token citations from Plan 4's Design-Review Amendments.

**States (D2):**

| Surface | Loading | Empty | Error |
|---------|---------|-------|-------|
| List | skeleton rows | "No threads yet." + a prominent **+ New Thread** | "Couldn't load threads." + Retry |
| Board column | skeleton cards | quiet per-column "Nothing in {phase}" | column-level error + Retry |
| Unlisted lane | skeleton | **positive**: "Inbox clear — nothing to triage." (not a sad empty) | lane error + Retry |
| Filtered list | — | "No threads match — clear filters" (with a clear-filters action) | — |

**A11y (D3):** Board drag-between-columns uses the **dnd-kit keyboard sensor** (mirror the Commander `SessionsSidebar` DnD: Space to lift, arrows to move across phase columns, Space to drop) with an `aria-live` region announcing the move. Cards are real links (Tab-focusable, Enter to open). Unlisted triage actions (Make thread / Add to ▾ / Dismiss) are buttons, not click handlers on a div.

**Router confidence band:** the band chip (auto / suggested / unsorted, from `routerBand`) carries a **text label**, not color alone (color-blind safe). No raw % ever (SPEC §10).

**Mobile:** List is the default mobile view; Board is available behind the view toggle but horizontally scrolls phase columns (snap per column). Unlisted stays pinned as the first column.

---

## Codex Outside-Voice Amendments (2026-05-24)

**#1 — Threads index = the Discussions destination.** `ThreadsList` is what the existing **Discussions** nav opens (label stays "Discussions" per SPEC §13). It is not a new top-level "Threads" section. Mount at the existing discussions route (revise Task 4's router note).

**#5 — RBAC + company boundary on Unlisted writes.** `attachInbox(companyId, id, targetThreadId, actor)` must verify the actor can view AND edit `targetThreadId` (`assertCanView` + `assertCanEdit`) and that both the inbox item and the target thread belong to `companyId` — reject cross-company or non-permitted targets with `notFound`. `dismissInbox` stays company-scoped. Log both to `activity_log`.
