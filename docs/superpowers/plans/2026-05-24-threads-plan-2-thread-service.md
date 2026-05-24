# Threads — Plan 2: Thread Service & Lifecycle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Prerequisite: Plan 1 (data model) is merged.**

**Goal:** The backend brain of a thread — phase state machine, ownership ("owned-by-action"), visibility query-layer RBAC (private threads never appear for non-participants), Summary persistence, promote-to-goal, fork/merge, and auto-extraction on create.

**Architecture:** New `server/src/services/threads.ts` exporting **pure logic helpers** (phase/ownership/visibility — no DB, unit-tested directly) plus a `threadService(db)` factory that mirrors `discussionService(db)` in `server/src/services/discussions.ts`. New thread endpoints are added to `server/src/routes/discussions.ts`. RBAC follows the **"hide, don't 403"** rule: a thread a viewer can't see throws `notFound` (never reveal existence).

**Tech stack:** Express 5, Drizzle ORM, Vitest. Patterns to mirror:
- Service factory + Drizzle queries: `server/src/services/discussions.ts` (`discussionService(db)`; uses `and, eq, desc, sql, inArray` from `drizzle-orm`; `badRequest`/`notFound` from `../errors.js`; `publishLiveEvent` from `./live-events.js`; `logActivity` from `./activity-log.js`).
- Service tests with the sequence mock DB: mirror `server/src/__tests__/discussions-service.test.ts` + the helper in `server/src/__tests__/helpers/`.
- Pure-function tests: mirror existing pure tests (e.g. `formatRunSummary`).
- Promote-to-goal reuses `goalService(db)` (`server/src/routes/goals.ts` / `server/src/services/goals.ts`) + `project_goals`.

**Run tests:** `pnpm exec vitest run <path>`.

---

## Task 1: Pure lifecycle logic (phase · ownership · visibility)

These are pure functions — no DB — so they're unit-tested directly and reused by the service.

**Files:**
- Create: `server/src/services/threads.ts`
- Test: `server/src/__tests__/threads-logic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/threads-logic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  canAdvancePhase,
  resolveOwnerOnAction,
  canViewThread,
} from "../services/threads.js";

describe("canAdvancePhase", () => {
  it("allows forward by one step", () => {
    expect(canAdvancePhase("discuss", "scope")).toBe(true);
    expect(canAdvancePhase("scope", "assign")).toBe(true);
    expect(canAdvancePhase("assign", "done")).toBe(true);
  });
  it("allows backward jumps (override)", () => {
    expect(canAdvancePhase("done", "discuss")).toBe(true);
    expect(canAdvancePhase("assign", "scope")).toBe(true);
  });
  it("rejects forward skips and unknown phases", () => {
    expect(canAdvancePhase("discuss", "assign")).toBe(false);
    expect(canAdvancePhase("discuss", "bogus" as never)).toBe(false);
  });
});

describe("resolveOwnerOnAction (owned-by-action; agents never own)", () => {
  it("a human's first governance action claims an unclaimed thread", () => {
    expect(
      resolveOwnerOnAction({ ownerUserId: null }, { userId: "u1", isHuman: true }),
    ).toBe("u1");
  });
  it("leaves an already-owned thread unchanged", () => {
    expect(
      resolveOwnerOnAction({ ownerUserId: "u9" }, { userId: "u1", isHuman: true }),
    ).toBeNull();
  });
  it("never makes an agent the owner", () => {
    expect(
      resolveOwnerOnAction({ ownerUserId: null }, { userId: "a1", isHuman: false }),
    ).toBeNull();
  });
});

describe("canViewThread (hide private/unclaimed)", () => {
  const open = { ownerUserId: "u9", visibility: "open" as const };
  const priv = { ownerUserId: "u9", visibility: "private" as const };
  const unclaimed = { ownerUserId: null, visibility: "open" as const };

  it("founder sees everything", () => {
    expect(canViewThread(open, { role: "founder", hasScopeAccess: false, isParticipant: false })).toBe(true);
    expect(canViewThread(priv, { role: "founder", hasScopeAccess: false, isParticipant: false })).toBe(true);
    expect(canViewThread(unclaimed, { role: "founder", hasScopeAccess: false, isParticipant: false })).toBe(true);
  });
  it("open thread visible to anyone with scope access", () => {
    expect(canViewThread(open, { role: "team_member", hasScopeAccess: true, isParticipant: false })).toBe(true);
    expect(canViewThread(open, { role: "team_member", hasScopeAccess: false, isParticipant: false })).toBe(false);
  });
  it("private thread visible only to participants", () => {
    expect(canViewThread(priv, { role: "team_member", hasScopeAccess: true, isParticipant: false })).toBe(false);
    expect(canViewThread(priv, { role: "team_member", hasScopeAccess: false, isParticipant: true })).toBe(true);
  });
  it("unclaimed thread visible only to founder or a lead with scope access", () => {
    expect(canViewThread(unclaimed, { role: "team_lead", hasScopeAccess: true, isParticipant: false })).toBe(true);
    expect(canViewThread(unclaimed, { role: "team_member", hasScopeAccess: true, isParticipant: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/threads-logic.test.ts`
Expected: FAIL — `Cannot find module '../services/threads.js'`.

- [ ] **Step 3: Create the pure helpers**

Create `server/src/services/threads.ts`:

```ts
import { THREAD_PHASES, type ThreadPhase, type ThreadVisibility } from "@armyofagents/shared";

/** Forward by exactly one phase (auto-advance) or any backward jump (founder override). */
export function canAdvancePhase(current: ThreadPhase, target: ThreadPhase): boolean {
  const ci = THREAD_PHASES.indexOf(current);
  const ti = THREAD_PHASES.indexOf(target);
  if (ci < 0 || ti < 0) return false;
  return ti === ci + 1 || ti < ci;
}

/**
 * "Owned by action": returns the userId that should become owner after a
 * governance action, or null to leave ownership unchanged.
 * - already owned -> null (no change)
 * - actor is an agent -> null (agents never own; accountability is human)
 * - unclaimed + human actor -> that human
 */
export function resolveOwnerOnAction(
  thread: { ownerUserId: string | null },
  actor: { userId: string; isHuman: boolean },
): string | null {
  if (thread.ownerUserId != null) return null;
  if (!actor.isHuman) return null;
  return actor.userId;
}

export interface ThreadViewer {
  role: "founder" | "team_lead" | "team_member";
  hasScopeAccess: boolean; // viewer has access to the thread's department/project/company scope
  isParticipant: boolean; // viewer is a participant (owner/co_owner/collaborator/viewer)
}

/** Pure RBAC predicate. The service computes hasScopeAccess/isParticipant from the DB. */
export function canViewThread(
  thread: { ownerUserId: string | null; visibility: ThreadVisibility },
  viewer: ThreadViewer,
): boolean {
  if (viewer.role === "founder") return true;
  // Unclaimed: only a lead with scope access (founder already returned true).
  if (thread.ownerUserId == null) {
    return viewer.role === "team_lead" && viewer.hasScopeAccess;
  }
  if (thread.visibility === "private") return viewer.isParticipant;
  // open
  return viewer.hasScopeAccess || viewer.isParticipant;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run server/src/__tests__/threads-logic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/__tests__/threads-logic.test.ts
git commit -m "feat(threads): pure lifecycle helpers (phase, ownership, visibility)"
```

---

## Task 2: `threadService(db)` — read path with visibility enforcement

**Files:**
- Modify: `server/src/services/threads.ts`
- Test: `server/src/__tests__/threads-service.test.ts`

- [ ] **Step 1: Write the failing test** — mirror `server/src/__tests__/discussions-service.test.ts` (same sequence-mock helper). Create `server/src/__tests__/threads-service.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { threadService } from "../services/threads.js";

// Mirror the sequence-mock DB helper used by discussions-service.test.ts
// (server/src/__tests__/helpers/). Each select/update/insert returns the next
// pre-configured result.
import { createSequenceDb } from "./helpers/drizzle-mock.js";

describe("threadService.getById", () => {
  it("returns null when the row is missing", async () => {
    const db = createSequenceDb([[]]); // first select -> no rows
    const svc = threadService(db);
    const result = await svc.getById("co1", "missing", {
      userId: "u1",
      role: "founder",
    });
    expect(result).toBeNull();
  });

  it("throws notFound when the viewer cannot see a private thread", async () => {
    const db = createSequenceDb([
      [{ id: "t1", companyId: "co1", visibility: "private", ownerUserId: "u9", scopeType: null, scopeId: null }], // thread row
      [], // participants -> not a participant
    ]);
    const svc = threadService(db);
    await expect(
      svc.getById("co1", "t1", { userId: "u1", role: "team_member" }),
    ).rejects.toThrow(/not found/i);
  });
});
```

> If `createSequenceDb`'s exact name/signature differs, open `server/src/__tests__/discussions-service.test.ts` and copy its import + setup verbatim — this file must use the same mock harness.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/threads-service.test.ts`
Expected: FAIL — `threadService` has no `getById`.

- [ ] **Step 3: Add the factory + read methods**

Append to `server/src/services/threads.ts`:

```ts
import { and, eq, desc, or } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  discussions,
  threadParticipants,
  userRoles,
} from "@armyofagents/db";
import { notFound } from "../errors.js";

interface Actor {
  userId: string;
  role: "founder" | "team_lead" | "team_member";
}

export function threadService(db: Db) {
  /** Compute the viewer's scope access + participant status, then apply canViewThread. */
  async function assertCanView(
    companyId: string,
    thread: { id: string; scopeType: string | null; scopeId: string | null; ownerUserId: string | null; visibility: string },
    actor: Actor,
  ): Promise<void> {
    if (actor.role === "founder") return; // fast path

    const participantRows = await db
      .select({ id: threadParticipants.id })
      .from(threadParticipants)
      .where(
        and(
          eq(threadParticipants.threadId, thread.id),
          eq(threadParticipants.principalType, "user"),
          eq(threadParticipants.principalId, actor.userId),
        ),
      );
    const isParticipant = participantRows.length > 0;

    // hasScopeAccess: founder handled above; team_lead/member need a user_roles row
    // covering the thread's department scope (company-scoped threads -> any member).
    let hasScopeAccess = thread.scopeType == null; // company-wide
    if (!hasScopeAccess && thread.scopeId) {
      const roleRows = await db
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(and(eq(userRoles.userId, actor.userId), eq(userRoles.departmentId, thread.scopeId)));
      hasScopeAccess = roleRows.length > 0;
    }

    const ok = canViewThread(
      { ownerUserId: thread.ownerUserId, visibility: thread.visibility as ThreadVisibility },
      { role: actor.role, hasScopeAccess, isParticipant },
    );
    if (!ok) throw notFound("Thread not found"); // hide, don't 403
  }

  return {
    getById: async (companyId: string, id: string, actor: Actor) => {
      const thread = await db
        .select()
        .from(discussions)
        .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!thread) return null;
      await assertCanView(companyId, thread, actor);
      return thread;
    },

    /** List threads the actor may see. Founder: all; others: open-with-scope OR participant. */
    list: async (companyId: string, actor: Actor, filters: { phase?: string } = {}) => {
      const conditions = [eq(discussions.companyId, companyId)];
      if (filters.phase) conditions.push(eq(discussions.phase, filters.phase));
      const rows = await db
        .select()
        .from(discussions)
        .where(and(...conditions))
        .orderBy(desc(discussions.lastEntryAt));
      if (actor.role === "founder") return rows;
      // Filter in-app via the pure predicate (participant/scope computed per row).
      const visible = [];
      for (const t of rows) {
        try {
          await assertCanView(companyId, t, actor);
          visible.push(t);
        } catch {
          /* hidden */
        }
      }
      return visible;
    },
  };
}
```

> Confirm the exact export names `userRoles` (table) + its `userId`/`departmentId` columns in `packages/db/src/schema/` (the RBAC table is `user_roles`). Adjust column names to match. The list filter above is correctness-first; a later optimization can push the predicate into SQL.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run server/src/__tests__/threads-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/__tests__/threads-service.test.ts
git commit -m "feat(threads): threadService read path with visibility RBAC"
```

---

## Task 3: Thread create defaults

When a thread (discussion) is created, set origin, `phase=discuss`, visibility from the department default, and owner (creator if human, else null = Unclaimed).

**Files:**
- Modify: `server/src/services/threads.ts` (add `create`)
- Test: `server/src/__tests__/threads-service.test.ts` (append)

- [ ] **Step 1: Write the failing test** — add to `threads-service.test.ts`:

```ts
import { computeCreateDefaults } from "../services/threads.js";

describe("computeCreateDefaults", () => {
  it("human creator owns it; phase=discuss", () => {
    const d = computeCreateDefaults({
      origin: { source: "human", medium: "text" },
      creator: { userId: "u1", isHuman: true },
      departmentDefaultVisibility: "open",
    });
    expect(d.phase).toBe("discuss");
    expect(d.ownerUserId).toBe("u1");
    expect(d.visibility).toBe("open");
    expect(d.originSource).toBe("human");
  });
  it("non-human creator -> Unclaimed (owner null); inherits dept private default", () => {
    const d = computeCreateDefaults({
      origin: { source: "agent", medium: "api" },
      creator: { userId: "agent1", isHuman: false },
      departmentDefaultVisibility: "private",
    });
    expect(d.ownerUserId).toBeNull();
    expect(d.visibility).toBe("private");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run server/src/__tests__/threads-service.test.ts`
Expected: FAIL — `computeCreateDefaults` is not exported.

- [ ] **Step 3: Add the pure helper** — in `server/src/services/threads.ts` (near the other pure helpers):

```ts
import type { ThreadOriginSource, ThreadOriginMedium } from "@armyofagents/shared";

export function computeCreateDefaults(input: {
  origin: { source: ThreadOriginSource; medium: ThreadOriginMedium };
  creator: { userId: string; isHuman: boolean };
  departmentDefaultVisibility: ThreadVisibility;
}): {
  phase: ThreadPhase;
  originSource: ThreadOriginSource;
  originMedium: ThreadOriginMedium;
  visibility: ThreadVisibility;
  ownerUserId: string | null;
} {
  return {
    phase: "discuss",
    originSource: input.origin.source,
    originMedium: input.origin.medium,
    visibility: input.departmentDefaultVisibility,
    ownerUserId: input.creator.isHuman ? input.creator.userId : null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes** — `pnpm exec vitest run server/src/__tests__/threads-service.test.ts` → PASS.

- [ ] **Step 5: Wire it into discussion creation** — in `server/src/services/discussions.ts`, in the `create` method, call `computeCreateDefaults(...)` and persist the returned fields on the new `discussions` row (look up the department's `defaultThreadVisibility` from `projects` when `scopeType==='department'`, else `'open'`). Keep existing behaviour for non-thread callers (defaults are backward-compatible: `phase` defaults to `discuss`, `visibility` to `open`).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/threads.ts server/src/services/discussions.ts server/src/__tests__/threads-service.test.ts
git commit -m "feat(threads): thread create defaults (origin/phase/visibility/owner)"
```

---

## Task 4: `advancePhase` + `updateSummary`

**Files:**
- Modify: `server/src/services/threads.ts`
- Test: `server/src/__tests__/threads-service.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
describe("threadService.advancePhase", () => {
  it("rejects an illegal forward skip", async () => {
    const db = createSequenceDb([
      [{ id: "t1", companyId: "co1", phase: "discuss", visibility: "open", ownerUserId: "u1", scopeType: null, scopeId: null }],
    ]);
    await expect(
      threadService(db).advancePhase("co1", "t1", "assign", { userId: "u1", role: "founder" }),
    ).rejects.toThrow(/cannot advance/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run server/src/__tests__/threads-service.test.ts` → FAIL (`advancePhase` undefined).

- [ ] **Step 3: Implement** — add to the `threadService` return object:

```ts
    advancePhase: async (companyId: string, id: string, target: ThreadPhase, actor: Actor) => {
      const thread = await db
        .select()
        .from(discussions)
        .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!thread) throw notFound("Thread not found");
      await assertCanView(companyId, thread, actor);
      if (!canAdvancePhase(thread.phase as ThreadPhase, target)) {
        throw badRequest(`Cannot advance phase ${thread.phase} -> ${target}`);
      }
      // owned-by-action: advancing a phase is a governance action
      const newOwner = resolveOwnerOnAction(
        { ownerUserId: thread.ownerUserId },
        { userId: actor.userId, isHuman: true },
      );
      await db
        .update(discussions)
        .set({ phase: target, ...(newOwner ? { ownerUserId: newOwner } : {}), updatedAt: new Date() })
        .where(eq(discussions.id, id));
      publishLiveEvent(companyId, { type: "thread.phase.changed", threadId: id, phase: target });
      return { id, phase: target };
    },

    updateSummary: async (companyId: string, id: string, summary: { text: string; next: string | null }) => {
      await db
        .update(discussions)
        .set({ summaryText: summary.text, summaryNext: summary.next, summaryUpdatedAt: new Date() })
        .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)));
      publishLiveEvent(companyId, { type: "thread.summary.updated", threadId: id });
      return { id };
    },
```

Add the needed imports at the top of `threads.ts`: `badRequest` from `../errors.js`, `publishLiveEvent` from `./live-events.js`.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/__tests__/threads-service.test.ts
git commit -m "feat(threads): advancePhase state machine + summary persistence"
```

---

## Task 5: Ownership (claim/transfer) + participants (add/remove)

**Files:**
- Modify: `server/src/services/threads.ts`
- Test: `server/src/__tests__/threads-service.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
describe("threadService ownership + participants", () => {
  it("claim sets owner only when unclaimed", async () => {
    const db = createSequenceDb([
      [{ id: "t1", companyId: "co1", ownerUserId: null, visibility: "open", scopeType: null, scopeId: null }],
      [], // update
      [], // participant upsert
    ]);
    const res = await threadService(db).claim("co1", "t1", { userId: "u1", role: "team_member" });
    expect(res.ownerUserId).toBe("u1");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`claim` undefined).

- [ ] **Step 3: Implement** — add to the `threadService` return object:

```ts
    claim: async (companyId: string, id: string, actor: Actor) => {
      const thread = await db
        .select()
        .from(discussions)
        .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!thread) throw notFound("Thread not found");
      const newOwner = resolveOwnerOnAction(
        { ownerUserId: thread.ownerUserId },
        { userId: actor.userId, isHuman: true },
      );
      if (!newOwner) return { ownerUserId: thread.ownerUserId }; // already owned
      await db.update(discussions).set({ ownerUserId: newOwner, updatedAt: new Date() }).where(eq(discussions.id, id));
      await db.insert(threadParticipants).values({
        companyId, threadId: id, principalType: "user", principalId: newOwner, role: "owner",
      });
      publishLiveEvent(companyId, { type: "thread.participant.changed", threadId: id });
      return { ownerUserId: newOwner };
    },

    transferOwnership: async (companyId: string, id: string, toUserId: string, actor: Actor) => {
      const thread = await db
        .select()
        .from(discussions)
        .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!thread) throw notFound("Thread not found");
      // only the current owner or a founder may transfer
      if (actor.role !== "founder" && thread.ownerUserId !== actor.userId) {
        throw notFound("Thread not found");
      }
      await db.update(discussions).set({ ownerUserId: toUserId, updatedAt: new Date() }).where(eq(discussions.id, id));
      await db.insert(threadParticipants).values({
        companyId, threadId: id, principalType: "user", principalId: toUserId, role: "owner",
      });
      publishLiveEvent(companyId, { type: "thread.participant.changed", threadId: id });
      return { ownerUserId: toUserId };
    },

    addParticipant: async (
      companyId: string,
      id: string,
      p: { principalType: "user" | "agent"; principalId: string; role: string },
    ) => {
      await db.insert(threadParticipants).values({ companyId, threadId: id, ...p });
      publishLiveEvent(companyId, { type: "thread.participant.changed", threadId: id });
      return { ok: true };
    },

    removeParticipant: async (companyId: string, id: string, participantId: string) => {
      await db.delete(threadParticipants).where(eq(threadParticipants.id, participantId));
      publishLiveEvent(companyId, { type: "thread.participant.changed", threadId: id });
      return { ok: true };
    },
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/__tests__/threads-service.test.ts
git commit -m "feat(threads): ownership claim/transfer + participant management"
```

---

## Task 6: `promoteToGoal`

**Files:**
- Modify: `server/src/services/threads.ts`
- Test: `server/src/__tests__/threads-service.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
describe("threadService.promoteToGoal", () => {
  it("creates a goal, links it on the thread, and carries the owner", async () => {
    const db = createSequenceDb([
      [{ id: "t1", companyId: "co1", title: "Launch", ownerUserId: "u1", goalId: null }], // thread
      [{ id: "g1" }], // goal insert returning
      [], // project_goals insert
      [], // discussions update
    ]);
    const res = await threadService(db).promoteToGoal("co1", "t1", { projectIds: ["p1"], level: "company" }, { userId: "u1", role: "founder" });
    expect(res.goalId).toBe("g1");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`promoteToGoal` undefined).

- [ ] **Step 3: Implement** — reuse `goalService(db)` for goal creation + `project_goals` for the ≥1-project requirement (Decision #13). Add to the return object:

```ts
    promoteToGoal: async (
      companyId: string,
      id: string,
      goalInput: { projectIds: string[]; level: string; parentId?: string },
      actor: Actor,
    ) => {
      if (goalInput.projectIds.length < 1) throw badRequest("A goal needs at least one project (Decision #13)");
      const thread = await db
        .select()
        .from(discussions)
        .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!thread) throw notFound("Thread not found");
      if (thread.goalId) throw badRequest("Thread already has a goal");

      // Create the goal via goalService (mirror server/src/services/goals.ts create()).
      const goals = goalService(db);
      const goal = await goals.create(companyId, {
        title: thread.title ?? "Untitled goal",
        level: goalInput.level,
        parentId: goalInput.parentId ?? null,
        projectIds: goalInput.projectIds, // writes project_goals
      });

      await db.update(discussions).set({ goalId: goal.id, updatedAt: new Date() }).where(eq(discussions.id, id));
      publishLiveEvent(companyId, { type: "thread.scope.changed", threadId: id });
      return { goalId: goal.id };
    },
```

Add `import { goalService } from "./goals.js";` at the top of `threads.ts`.

> Confirm `goalService(db).create(...)` signature in `server/src/services/goals.ts` (it must accept `projectIds` and write `project_goals`; if the existing signature differs, adapt this call to it — do not duplicate goal-creation logic).

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/__tests__/threads-service.test.ts
git commit -m "feat(threads): promote thread to goal (goal-as-property)"
```

---

## Task 7: Fork / merge skeleton (lineage via `thread_links`)

**Files:**
- Modify: `server/src/services/threads.ts`
- Test: `server/src/__tests__/threads-service.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
describe("threadService.fork", () => {
  it("creates a child thread linked back with kind=fork", async () => {
    const db = createSequenceDb([
      [{ id: "t1", companyId: "co1", title: "Parent", scopeType: null, scopeId: null }], // source
      [{ id: "t2" }], // new discussion insert returning
      [], // thread_links insert
    ]);
    const res = await threadService(db).fork("co1", "t1", { userId: "u1", role: "founder" });
    expect(res.id).toBe("t2");
    expect(res.forkedFromId).toBe("t1");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`fork` undefined).

- [ ] **Step 3: Implement** — add `fork` and `merge` to the return object:

```ts
    fork: async (companyId: string, id: string, actor: Actor) => {
      const src = await db
        .select()
        .from(discussions)
        .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!src) throw notFound("Thread not found");
      const child = await db
        .insert(discussions)
        .values({
          companyId,
          title: `${src.title ?? "Thread"} (fork)`,
          scopeType: src.scopeType,
          scopeId: src.scopeId,
          phase: "discuss",
          visibility: src.visibility,
          forkedFromId: src.id,
          ownerUserId: actor.userId,
          createdBy: actor.userId,
        })
        .returning({ id: discussions.id })
        .then((rows) => rows[0]);
      await db.insert(threadLinks).values({
        companyId, fromThreadId: child.id, toThreadId: src.id, kind: "fork", createdBy: actor.userId,
      });
      return { id: child.id, forkedFromId: src.id };
    },

    merge: async (companyId: string, fromId: string, intoId: string, actor: Actor) => {
      await db.update(discussions).set({ mergedIntoId: intoId, status: "archived", updatedAt: new Date() }).where(eq(discussions.id, fromId));
      await db.insert(threadLinks).values({
        companyId, fromThreadId: fromId, toThreadId: intoId, kind: "merge", createdBy: actor.userId,
      });
      // NOTE: full Scope reconciliation (union -> Scribe re-dedup -> conflict cards) is v1.1 (SPEC §10).
      return { mergedInto: intoId };
    },
```

Add `import { threadLinks } from "@armyofagents/db";` to the existing db import.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/__tests__/threads-service.test.ts
git commit -m "feat(threads): fork/merge skeleton with thread_links lineage"
```

---

## Task 8: Auto-extraction on create + wire routes

**Files:**
- Modify: `server/src/services/discussions.ts` (auto-extraction gate)
- Modify: `server/src/routes/discussions.ts` (thread endpoints)
- Test: `server/src/__tests__/threads-routes-contract.test.ts`

- [ ] **Step 1: Write the failing route-contract test** — mirror `server/src/__tests__/discussions-routes-contract.test.ts`. Create `server/src/__tests__/threads-routes-contract.test.ts` asserting the new endpoints are registered (status, shape) using `supertest` against the app, following the existing route-contract pattern. Assert these routes exist and require auth:
  - `PATCH /companies/:companyId/discussions/:id/phase`
  - `POST  /companies/:companyId/discussions/:id/claim`
  - `POST  /companies/:companyId/discussions/:id/transfer`
  - `POST  /companies/:companyId/discussions/:id/participants`
  - `POST  /companies/:companyId/discussions/:id/promote-to-goal`

- [ ] **Step 2: Run to verify it fails** — routes 404.

- [ ] **Step 3: Auto-extraction on create** — in `server/src/services/discussions.ts` `createEntry` (the path that inserts a `discussion_entries` row with `extractionStatus='pending'`), ensure the durable dispatcher is poked so extraction runs without a manual "Reprocess". The durable outbox (`runAoaDispatch` in `server/src/services/internal-agent/aoa-agents/dispatcher.ts`, Phase 2 drains `pending`) already does this on its tick — confirm the create path does not set a flag that suppresses it, and remove any UI/route requirement for manual reprocessing. (No new dispatch code; just verify the gate is on.)

- [ ] **Step 4: Wire the thread endpoints** — in `server/src/routes/discussions.ts`, add handlers that resolve the `Actor` from the request auth context (the same way existing handlers read the authenticated user + role) and delegate to `threadService(db)`:

```ts
import { threadService } from "../services/threads.js";

// inside the router, alongside the existing discussion routes:
router.patch("/:id/phase", async (req, res) => {
  const actor = getActor(req); // reuse the existing auth-context helper used by other handlers
  const out = await threadService(db).advancePhase(req.params.companyId, req.params.id, req.body.phase, actor);
  res.json(out);
});

router.post("/:id/claim", async (req, res) => {
  res.json(await threadService(db).claim(req.params.companyId, req.params.id, getActor(req)));
});

router.post("/:id/transfer", async (req, res) => {
  res.json(await threadService(db).transferOwnership(req.params.companyId, req.params.id, req.body.toUserId, getActor(req)));
});

router.post("/:id/participants", async (req, res) => {
  res.json(await threadService(db).addParticipant(req.params.companyId, req.params.id, req.body));
});

router.post("/:id/promote-to-goal", async (req, res) => {
  res.json(await threadService(db).promoteToGoal(req.params.companyId, req.params.id, req.body, getActor(req)));
});
```

> Use the exact auth-context accessor the existing discussion handlers use to get `{ userId, role }` (search `server/src/routes/discussions.ts` for how the current handlers read the user). Mount points must match the existing `/companies/:companyId/discussions` base.

- [ ] **Step 5: Run to verify it passes** — PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/discussions.ts server/src/routes/discussions.ts server/src/__tests__/threads-routes-contract.test.ts
git commit -m "feat(threads): thread lifecycle endpoints + auto-extraction on create"
```

---

## Done criteria (Plan 2)

- `pnpm exec vitest run server/src/__tests__/threads-logic.test.ts` — PASS.
- `pnpm exec vitest run server/src/__tests__/threads-service.test.ts` — PASS.
- `pnpm exec vitest run server/src/__tests__/threads-routes-contract.test.ts` — PASS.
- `pnpm --filter @armyofagents/server typecheck` — no errors.
- Private/Unclaimed threads are filtered from `list`/`getById` for non-permitted viewers (hide-don't-403).
- Ownership follows owned-by-action; agents never own.

Hand-off: Plan 3 (Command Staff) and Plan 4 (UI shell) build on this service.

---

## Eng-Review Amendments (2026-05-24)

**D4 — `list` must not be N+1.** Replace the per-row `assertCanView` loop in Task 2's `list` with a batched read: pull the candidate threads, then **two** queries (the actor's participant rows for those thread ids; the actor's `user_roles` dept ids), then filter in memory with the pure `canViewThread`. 2 queries total, not 2N.

```ts
    list: async (companyId: string, actor: Actor, filters: { phase?: string } = {}) => {
      const conditions = [eq(discussions.companyId, companyId)];
      if (filters.phase) conditions.push(eq(discussions.phase, filters.phase));
      const rows = await db.select().from(discussions).where(and(...conditions)).orderBy(desc(discussions.lastEntryAt));
      if (actor.role === "founder") return rows;
      const ids = rows.map((r) => r.id);
      const myParts = ids.length === 0 ? [] : await db
        .select({ threadId: threadParticipants.threadId })
        .from(threadParticipants)
        .where(and(
          eq(threadParticipants.principalType, "user"),
          eq(threadParticipants.principalId, actor.userId),
          inArray(threadParticipants.threadId, ids),
        ));
      const partSet = new Set(myParts.map((p) => p.threadId));
      const myDepts = await db
        .select({ departmentId: userRoles.departmentId })
        .from(userRoles)
        .where(eq(userRoles.userId, actor.userId));
      const deptSet = new Set(myDepts.map((d) => d.departmentId));
      return rows.filter((t) =>
        canViewThread(
          { ownerUserId: t.ownerUserId, visibility: t.visibility as ThreadVisibility },
          { role: actor.role, hasScopeAccess: t.scopeType == null || (t.scopeId != null && deptSet.has(t.scopeId)), isParticipant: partSet.has(t.id) },
        ),
      );
    },
```

Add `inArray` to the `drizzle-orm` import. (`assertCanView` stays as-is for single-row `getById`/`advancePhase` — those are 2 queries for one row, which is fine.)

**Fix — `isHuman` must come from the actor, not be hardcoded.** Add `isHuman: boolean` to the `Actor` interface. Route handlers set `isHuman: true`; crew/subagent callers set `isHuman: false`. In `claim` and `advancePhase`, pass `actor.isHuman` to `resolveOwnerOnAction` instead of a literal `true`, so an agent-driven governance action never sets ownership to a synthetic user.

**Fix — `claim`/`addParticipant` upsert.** Insert participant rows with `.onConflictDoNothing()` (against the Plan 1 `thread_participants_unique` index) so re-claiming or re-adding never creates duplicate rows.

```ts
      await db.insert(threadParticipants)
        .values({ companyId, threadId: id, principalType: "user", principalId: newOwner, role: "owner" })
        .onConflictDoNothing();
```

---

## Codex Outside-Voice Amendments (2026-05-24)

**#7 — NEW Task: Assign (confirmed Scope items → `issues`). This is the core loop and was underspecified.** Add `threadService.assignScopeItems(companyId, threadId, actor)` + a `POST …/discussions/:id/assign` endpoint:
- `assertCanView` + require can-edit (owner/co_owner/founder); **founder-gated write** (locked decision).
- In a transaction, for each `discussion_extracted_items` row with `status='approved'` AND `result_task_id IS NULL` (idempotency — skip already-created):
  - create an `issues` row via the existing issues service, mapping committed routing (`assignee_agent_id` | `assignee_user_id`, `department_id`, priority via `ISSUE_PRIORITIES`); honor planning **`work_mode`** so it does NOT auto-dispatch (D8 `shouldDispatchIssueWakeup`) and the **concurrency clamp** (D5);
  - set `result_task_id` to the new issue id.
  - For `type='spin_off_thread'` items, call `spinOff` instead of creating an issue.
- After issue creation, call `graduateDependencies(scopeDeps, itemToTaskMap)` (Plan 6) and insert the resulting `task_dependencies`.
- Advance `phase` to `assign` only after items are created. Re-running is a no-op (idempotent via `result_task_id`).
- Tests: idempotent re-run creates no dupes; planning `work_mode` suppresses dispatch; deps graduate; spin-off items branch.

**#4 — `transferOwnership` must demote the previous owner** (else two `role='owner'` rows). Inside `transferOwnership`, before setting the new owner:
```ts
if (thread.ownerUserId) {
  await db.update(threadParticipants).set({ role: "collaborator" }).where(and(
    eq(threadParticipants.threadId, id),
    eq(threadParticipants.principalType, "user"),
    eq(threadParticipants.principalId, thread.ownerUserId),
    eq(threadParticipants.role, "owner"),
  ));
}
```

**#5 — RBAC on every write path.** `addParticipant` / `removeParticipant` / `advancePhase` / `transferOwnership` / `claim` / `updateSummary` / `promoteToGoal` / `fork` / `merge` / `assignScopeItems` all `assertCanView` first; membership/visibility/assign mutations additionally require owner|co_owner|founder via an `assertCanEdit` helper. Every method filters by `companyId` (company boundary) — keep that on all of them.

**#6 — Activity logging on every mutation.** Call `logActivity` (from `./activity-log.js`) for: phase change, claim, transfer, participant add/remove, summary, promote-to-goal, fork, merge, assign, visibility change. `activity_log` is the repo audit trail — no silent mutations.

**#8 — Enforce one-level sub-goals server-side.** In `promoteToGoal` (and reused by the goal create path), reject when the chosen parent is itself a sub-goal:
```ts
const parent = parentId
  ? await db.select({ parentId: goals.parentId }).from(goals).where(eq(goals.id, parentId)).then((r) => r[0] ?? null)
  : null;
if (parent?.parentId) throw badRequest("Sub-goals are one level deep (#20)");
```
Add a test for the rejection. (Do not rely on the UI guard alone.)
