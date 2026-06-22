# Threads — Plan 7: Real-time

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. **Prerequisites: Plans 1-6 merged.**

**Goal:** Real-time foundations — thread event types, reliability (per-thread `seq`, catch-up, reconnect-refetch), **per-thread scoping + envelope RBAC** (a viewer never receives even a poke about a thread they can't see), and human presence/typing. Keep the **refetch-on-poke** model (push content deltas + Redis are v1.1 / infra).

**Architecture:** Extend the in-process WS bus (`server/src/services/live-events.ts`, published via `publishLiveEvent`) with thread event types, a **per-thread subscription registry**, and an **envelope-RBAC filter at fan-out** that reuses `canViewThread` (Plan 2). Add a per-thread monotonic `seq` on `discussion_entries` + a catch-up endpoint. The frontend `LiveUpdatesProvider` subscribes to the open thread and invalidates React Query on thread events; presence/typing is an ephemeral in-memory channel.

**Tech stack:** Express 5 + `ws` (server), React 19 + React Query (ui), Drizzle. Tests: Vitest (+ RTL).

**Run tests:** server `pnpm exec vitest run <path>`; ui `pnpm --filter @armyofagents/ui exec vitest run <path>`. Migration (Task 3): `pnpm db:generate`.

---

## Task 1: Thread event types on the bus

**Files:**
- Modify: `server/src/services/live-events.ts`
- Test: `server/src/__tests__/thread-events.test.ts`

- [ ] **Step 1: Write the failing test** — assert `publishLiveEvent` accepts the thread event types and that a registered listener receives a `thread.entry.created` event (use the bus's existing subscribe/emit API — read `live-events.ts` for it).

```ts
import { describe, it, expect, vi } from "vitest";
import { publishLiveEvent, subscribeToCompany } from "../services/live-events.js"; // match real exports

describe("thread events", () => {
  it("delivers thread.entry.created to a company subscriber", () => {
    const received: unknown[] = [];
    const unsub = subscribeToCompany("co1", (e) => received.push(e));
    publishLiveEvent("co1", { type: "thread.entry.created", threadId: "t1" });
    unsub();
    expect(received).toContainEqual({ type: "thread.entry.created", threadId: "t1" });
  });
});
```

> Match the real subscribe export in `live-events.ts` (it may be named differently). The point: the new `thread.*` event types are valid and flow through the bus.

- [ ] **Step 2: Run to verify it fails** — FAIL (thread types not in the event union).

- [ ] **Step 3: Implement** — in `live-events.ts`, extend the `LiveEvent` union with: `thread.entry.created`, `thread.scope.changed`, `thread.phase.changed`, `thread.summary.updated`, `thread.participant.changed`, `thread.presence` (each carries `threadId`). These are already published by Plans 2/5/6 via `publishLiveEvent`; this task just makes the types first-class.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/live-events.ts server/src/__tests__/thread-events.test.ts
git commit -m "feat(threads-rt): thread event types on the live-events bus"
```

---

## Task 2: Per-thread scoping + envelope-RBAC fan-out

**Files:**
- Modify: `server/src/services/live-events.ts` (subscription registry + RBAC filter)
- Test: `server/src/__tests__/thread-event-rbac.test.ts`

- [ ] **Step 1: Write the failing test** — the pure fan-out filter reuses `canViewThread`. Assert a private thread's event is delivered only to participants.

```ts
import { describe, it, expect } from "vitest";
import { filterThreadEventRecipients } from "../services/live-events.js";

describe("filterThreadEventRecipients (envelope RBAC)", () => {
  const priv = { ownerUserId: "u9", visibility: "private" as const };
  const subs = [
    { id: "s1", role: "team_member" as const, hasScopeAccess: true, isParticipant: false },
    { id: "s2", role: "team_member" as const, hasScopeAccess: true, isParticipant: true },
    { id: "s3", role: "founder" as const, hasScopeAccess: false, isParticipant: false },
  ];
  it("delivers a private thread event only to participants (+ founder)", () => {
    const out = filterThreadEventRecipients(priv, subs).map((s) => s.id);
    expect(out).toContain("s2");
    expect(out).toContain("s3");
    expect(out).not.toContain("s1");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (function missing).

- [ ] **Step 3: Implement** — add the pure filter to `live-events.ts` (reuse the Plan 2 predicate):

```ts
import { canViewThread, type ThreadViewer } from "./threads.js";

export function filterThreadEventRecipients<T extends ThreadViewer>(
  thread: { ownerUserId: string | null; visibility: "open" | "private" },
  subscribers: T[],
): T[] {
  return subscribers.filter((s) => canViewThread(thread, s));
}
```

Then add a **per-thread subscription registry** (`Map<threadId, Set<connection>>`): the WS handler accepts a `{ subscribe: threadId }` message; on a `thread.*` event, look up subscribers, compute each subscriber's `{ role, hasScopeAccess, isParticipant }` (cache per connection), run `filterThreadEventRecipients`, and send only to the survivors. A subscriber who can't see the thread receives nothing — closing the metadata leak. (Company-wide non-thread events keep their current behaviour.)

> Read `live-events.ts` + the `/events/ws` handler to wire the subscribe message + per-connection identity. The RBAC inputs (`hasScopeAccess`, `isParticipant`) are computed the same way as `threadService.assertCanView` (Plan 2) — extract that into a shared helper if practical (DRY).

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/live-events.ts server/src/__tests__/thread-event-rbac.test.ts
git commit -m "feat(threads-rt): per-thread scoping + envelope-RBAC fan-out"
```

---

## Task 3: Per-thread `seq` + catch-up endpoint

**Files:**
- Modify: `packages/db/src/schema/discussions.ts` (`seq` on `discussion_entries`)
- Modify: `server/src/services/discussions.ts` (assign `seq` on entry insert)
- Modify: `server/src/routes/discussions.ts` (catch-up endpoint)
- Test: `server/src/__tests__/threads-catchup.test.ts`
- Generated: `packages/db/src/migrations/01xx_*.sql`

- [ ] **Step 1: Write the failing test** — pure `nextSeq` + a route-contract test for `GET …/discussions/:id/entries?sinceSeq=N`.

```ts
import { describe, it, expect } from "vitest";
import { nextSeq } from "../services/threads.js";

describe("nextSeq", () => {
  it("increments from the current max (0-based start)", () => {
    expect(nextSeq(null)).toBe(1);
    expect(nextSeq(7)).toBe(8);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`nextSeq` missing).

- [ ] **Step 3: Add the column + helper** — in `discussions.ts` schema add to `discussionEntries`:

```ts
    seq: integer("seq").notNull().default(0), // per-thread monotonic ordering for catch-up
```

Add the pure helper to `server/src/services/threads.ts`:

```ts
export function nextSeq(currentMax: number | null): number {
  return (currentMax ?? 0) + 1;
}
```

In `discussions.ts` service `createEntry`, set `seq = nextSeq(maxSeqForThread)` (select `max(seq)` for the thread inside the insert transaction). Add the catch-up route:
`GET /companies/:companyId/discussions/:id/entries?sinceSeq=N` → return entries with `seq > N` ordered by `seq` (RBAC via `threadService.getById` first).

- [ ] **Step 4: Generate the migration** — `pnpm db:generate`; verify it adds `seq` to `discussion_entries`.

- [ ] **Step 5: Run to verify it passes** — PASS; `pnpm --filter @armyofagents/db typecheck`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/discussions.ts packages/db/src/migrations/ server/src/services/discussions.ts server/src/services/threads.ts server/src/routes/discussions.ts server/src/__tests__/threads-catchup.test.ts
git commit -m "feat(threads-rt): per-thread seq + catch-up endpoint"
```

---

## Task 4: Frontend live thread updates

**Files:**
- Modify: `ui/src/context/LiveUpdatesProvider.tsx`
- Modify: `ui/src/pages/ThreadDetail.tsx` (subscribe to the open thread)
- Test: `ui/src/context/__tests__/threadLiveUpdates.test.ts`

- [ ] **Step 1: Write the failing test** — pure event→invalidation mapping. Create the mapper in `LiveUpdatesProvider` (or a sibling module) and test it:

```ts
import { describe, it, expect } from "vitest";
import { threadEventToInvalidations } from "../LiveUpdatesProvider";

describe("threadEventToInvalidations", () => {
  it("maps a thread event to the right query keys", () => {
    const keys = threadEventToInvalidations({ type: "thread.scope.changed", threadId: "t1" }, "co1");
    expect(keys).toContainEqual(["thread", "co1", "t1"]);
    expect(keys).toContainEqual(["threads", "co1"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** —
  - Export `threadEventToInvalidations(event, companyId)` returning the query keys to invalidate (`['thread', companyId, threadId]` + `['threads', companyId]`).
  - In `LiveUpdatesProvider`, handle `thread.*` events by invalidating those keys (keep the refetch model — RBAC stays in REST).
  - In `ThreadDetail`, send `{ subscribe: threadId }` over the WS on mount and unsubscribe on unmount (the server registry from Task 2). On WS **reconnect**, invalidate the active thread query (refetch-on-reconnect; or call the Task 3 catch-up endpoint with the last-seen `seq`).
  - Reuse `agent.status` / `heartbeat.run.*` events for the agent "working" indicator on the thread.

- [ ] **Step 4: Run to verify it passes + typecheck.**

- [ ] **Step 5: Commit**

```bash
git add ui/src/context/LiveUpdatesProvider.tsx ui/src/pages/ThreadDetail.tsx ui/src/context/__tests__/threadLiveUpdates.test.ts
git commit -m "feat(threads-rt): live thread updates (refetch-on-poke) + reconnect"
```

---

## Task 5: Presence + typing (ephemeral)

**Files:**
- Modify: `server/src/services/live-events.ts` (presence channel + prune)
- Modify: `ui/src/components/threads/OriginCard.tsx` (presence avatars + typing)
- Test: `server/src/__tests__/thread-presence.test.ts`

- [ ] **Step 1: Write the failing test** — pure presence prune.

```ts
import { describe, it, expect } from "vitest";
import { prunePresence } from "../services/live-events.js";

describe("prunePresence", () => {
  it("drops entries older than the TTL", () => {
    const now = 10_000;
    const out = prunePresence(
      [{ userId: "u1", lastSeen: 9_000 }, { userId: "u2", lastSeen: 1_000 }],
      now,
      5_000,
    );
    expect(out.map((e) => e.userId)).toEqual(["u1"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** —

```ts
export interface PresenceEntry { userId: string; lastSeen: number; }
export function prunePresence(entries: PresenceEntry[], now: number, ttlMs: number): PresenceEntry[] {
  return entries.filter((e) => now - e.lastSeen <= ttlMs);
}
```

Add an ephemeral per-thread presence map (in-memory; `Map<threadId, PresenceEntry[]>`), updated on a `{ presence: threadId }` heartbeat from the client and on typing; broadcast `thread.presence` events (through the same RBAC fan-out from Task 2) and sweep with `prunePresence` on a short interval. In `OriginCard`, show presence avatars + a "typing…" indicator from `thread.presence` events. Presence is **not** persisted (no DB).

- [ ] **Step 4: Run to verify it passes + typecheck (server + ui).**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/live-events.ts ui/src/components/threads/OriginCard.tsx server/src/__tests__/thread-presence.test.ts
git commit -m "feat(threads-rt): ephemeral presence + typing indicators"
```

---

## Done criteria (Plan 7)

- `pnpm exec vitest run server/src/__tests__/thread-events.test.ts thread-event-rbac.test.ts threads-catchup.test.ts thread-presence.test.ts` — PASS.
- `pnpm --filter @armyofagents/ui exec vitest run src/context/__tests__/threadLiveUpdates.test.ts` — PASS.
- Typechecks clean; `pnpm db:generate` migration adds `seq`.
- A non-participant never receives events for a private/Unclaimed thread (envelope RBAC); the open thread updates live (refetch); reconnect catches up; presence/typing shows.

---

## v1 complete

With Plans 1-7 merged, the Threads v1 cut is shipped: the discussions backbone is the Threads container; the Command Staff runs with real governance brakes; the focus view + continuum nav are live; ownership/visibility/boundary mechanics work; and changes update in real time, leak-safe. Deferred to v1.1 / infra per `INFRA-FOLLOWUP.md`: Graph lens, Live integrations, push content deltas, Redis pub-sub, preview proxy, embeddings provider strategy, Watch/Follow toggle.

---

## Eng-Review Amendments (2026-05-24)

**D1 — `seq` is assigned by an atomic counter, not `max(seq)+1`.** The `max+1` approach races: two concurrent inserts on one thread get the same seq, corrupting `?sinceSeq=N`. Use the `entry_seq` counter on `discussions` (added in Plan 1 amendment A2).

In Task 3, replace the assignment: on entry insert, in the **same transaction**, run

```ts
const [{ entrySeq }] = await tx
  .update(discussions)
  .set({ entrySeq: sql`${discussions.entrySeq} + 1` })
  .where(eq(discussions.id, threadId))
  .returning({ entrySeq: discussions.entrySeq });
// use entrySeq as the new discussion_entries.seq
```

The `UPDATE ... RETURNING` is atomic per row, so concurrent inserts serialize on the discussions row and each gets a distinct seq. Add a **unique index** on `discussion_entries (discussion_id, seq)` as a backstop:

```ts
  (table) => ({
    threadSeqUniq: uniqueIndex("discussion_entries_thread_seq_uniq").on(table.discussionId, table.seq),
  }),
```

(`nextSeq` stays as a pure doc helper, but the DB does the increment.) Update the Task 3 test to assert the unique index exists / that two inserts get distinct seqs.

**Fix — RBAC fan-out: recompute per event for v1, do not cache.** Caching each connection's `{role, hasScopeAccess, isParticipant}` needs invalidation when a thread goes private or a participant is removed — get that wrong and you leak events. At founding-team scale, recompute per event (cheap). Caching + invalidation is an infra-phase concern (revisit with the pub-sub backbone). Note this inline in Task 2.

---

## Design-Review Amendments (2026-05-24)

Inherits Plan 4's a11y baseline + tokens.

**Presence + typing visual (Task 5).** Stacked avatars (max 3 + "+N" overflow) on the OriginCard with a name tooltip; "typing…" as a subtle line under the composer. The **agent "working" indicator** is visually distinct from human presence (reuse the `agent.status` pulse used elsewhere), so a founder can tell "Scribe is extracting" apart from "Maria is here."

**Connection states (D2).** Connection lost → a subtle non-blocking "Reconnecting…" pill at the top of the thread (does not cover content); restored → the pill clears and the thread refetches (catch-up via `sinceSeq`). Offline → the composer is disabled with a "You're offline" hint rather than failing silently on send.

**A11y (D3).** Presence/typing updates announce via `aria-live="polite"` (never `assertive` — it must not spam screen readers on every keystroke). The "Reconnecting…" pill is also polite-announced once, not on every retry.
