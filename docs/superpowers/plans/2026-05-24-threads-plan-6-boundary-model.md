# Threads — Plan 6: Boundary model

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. **Prerequisites: Plans 1-5 merged.**

**Goal:** The cross-boundary mechanics — participants + @mention (human notify / agent invoke), ownership UI (Claim/transfer/manage), visibility UI (open/private), per-item department + assignee routing (agent|human), spin-off threads, and cross-thread links + dependencies (graduating to `task_dependencies` on Assign).

**Architecture:** Backend extends `server/src/services/threads.ts` (mention dispatch, links, dependency graduation, spin-off, per-item routing) reusing the existing wakeup path (`delegate-to-subagent` → `agent_wakeup_requests` → dispatcher Phase 3 → `runAoaAgent`) and `notifications`. UI adds `MentionInput`, `OwnershipMenu`, `VisibilityToggle` to `OriginCard`, and per-item routing/dependency/conflict UI to `ScopeTab`. Pure helpers (mention extraction, dependency graduation) are unit-tested.

**Tech stack:** Express 5 + Drizzle (server), React 19 + React Query (ui). Tests: Vitest (+ RTL).

**Run tests:** server `pnpm exec vitest run <path>`; ui `pnpm --filter @armyofagents/ui exec vitest run <path>`.

---

## Task 1: Pure @mention extraction

**Files:**
- Modify: `server/src/services/threads.ts` (export `extractMentionHandles`)
- Test: `server/src/__tests__/threads-mentions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { extractMentionHandles } from "../services/threads.js";

describe("extractMentionHandles", () => {
  it("pulls @handles out of free text", () => {
    expect(extractMentionHandles("hey @maria and @design-bot ship it")).toEqual(["maria", "design-bot"]);
  });
  it("returns [] when there are no mentions", () => {
    expect(extractMentionHandles("no mentions here")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run server/src/__tests__/threads-mentions.test.ts` → FAIL.

- [ ] **Step 3: Implement** — add to `server/src/services/threads.ts`:

```ts
export function extractMentionHandles(text: string): string[] {
  return [...text.matchAll(/@([a-z0-9_-]+)/gi)].map((m) => m[1]);
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/__tests__/threads-mentions.test.ts
git commit -m "feat(threads): pure @mention handle extraction"
```

---

## Task 2: @mention dispatch (human notify / agent invoke)

**Files:**
- Modify: `server/src/services/threads.ts` (`handleMentions`)
- Modify: `server/src/routes/discussions.ts` (call `handleMentions` on entry create)
- Test: `server/src/__tests__/threads-mention-dispatch.test.ts`

- [ ] **Step 1: Write the failing test** — assert an @agent mention enqueues a wakeup and an @human mention inserts a notification (capture inserts via the sequence mock).

```ts
import { describe, it, expect } from "vitest";
import { threadService } from "../services/threads.js";
import { createSequenceDb } from "./helpers/drizzle-mock.js";

describe("handleMentions", () => {
  it("@agent -> wakeup request; @human -> notification", async () => {
    const db = createSequenceDb([
      // resolve handles -> roster: one agent ("design-bot"), one user ("maria")
      [{ principalType: "agent", principalId: "a1", handle: "design-bot" }, { principalType: "user", principalId: "u2", handle: "maria" }],
      [], // agent_wakeup_requests insert
      [], // notifications insert
    ]);
    const res = await threadService(db).handleMentions("co1", "t1", "ping @design-bot @maria", { userId: "u1", role: "founder" });
    expect(res.agentsInvoked).toContain("a1");
    expect(res.humansNotified).toContain("u2");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add `handleMentions` to `threadService`. Resolve handles against the thread participants + company agents/users; for each agent → enqueue an `agent_wakeup_requests` row (the same shape `delegate-to-subagent` writes — the dispatcher's Phase 3 drains it → `runAoaAgent` on the thread); for each human → insert a `notifications` row (`type: "thread.mention"`). @human never triggers a crew run.

```ts
    handleMentions: async (companyId: string, threadId: string, text: string, actor: Actor) => {
      const handles = extractMentionHandles(text);
      if (handles.length === 0) return { agentsInvoked: [], humansNotified: [] };
      const roster = await resolveHandles(db, companyId, threadId, handles); // join participants + agents + users
      const agentsInvoked: string[] = [];
      const humansNotified: string[] = [];
      for (const m of roster) {
        if (m.principalType === "agent") {
          await db.insert(agentWakeupRequests).values({
            companyId, agentId: m.principalId, reason: "thread_mention", relatedEntityType: "discussion", relatedEntityId: threadId,
          });
          agentsInvoked.push(m.principalId);
        } else {
          await db.insert(notifications).values({
            companyId, userId: m.principalId, type: "thread.mention", payload: { threadId, by: actor.userId },
          });
          humansNotified.push(m.principalId);
        }
      }
      return { agentsInvoked, humansNotified };
    },
```

Import `agentWakeupRequests`, `notifications` from `@armyofagents/db`. Implement `resolveHandles` to match handles to participants/agents/users (confirm the agent/user "handle" column — agents have a name/slug; users have a handle/name — adapt the join to real columns). Call `handleMentions` from the entry-create route after the entry is saved.

> Confirm the exact `agent_wakeup_requests` column names + how `delegate-to-subagent` writes them (`server/src/services/internal-agent/tools/`), and match that shape exactly so Phase 3 picks it up.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/routes/discussions.ts server/src/__tests__/threads-mention-dispatch.test.ts
git commit -m "feat(threads): @mention dispatch (agent invoke / human notify)"
```

---

## Task 3: Cross-thread links

**Files:**
- Modify: `server/src/services/threads.ts` (`linkThreads`, `listLinks`)
- Modify: `server/src/routes/discussions.ts`
- Test: `server/src/__tests__/threads-links.test.ts`

- [ ] **Step 1: Write the failing test** — `linkThreads` inserts a `thread_links` row with the chosen kind; `listLinks` returns links for a thread (both directions).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add to `threadService`:

```ts
    linkThreads: async (companyId: string, fromId: string, toId: string, kind: string, actor: Actor) => {
      await db.insert(threadLinks).values({ companyId, fromThreadId: fromId, toThreadId: toId, kind, createdBy: actor.userId });
      return { ok: true };
    },
    listLinks: async (companyId: string, threadId: string) =>
      db.select().from(threadLinks)
        .where(and(eq(threadLinks.companyId, companyId), or(eq(threadLinks.fromThreadId, threadId), eq(threadLinks.toThreadId, threadId)))),
```

Routes: `POST /companies/:companyId/discussions/:id/links` (body `{ toThreadId, kind }`), `GET /companies/:companyId/discussions/:id/links`.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/routes/discussions.ts server/src/__tests__/threads-links.test.ts
git commit -m "feat(threads): cross-thread links (@[Thread] / goal-cluster)"
```

---

## Task 4: Scope-item dependencies + graduation to `task_dependencies`

**Files:**
- Modify: `server/src/services/threads.ts` (`addScopeDependency`, pure `graduateDependencies`)
- Test: `server/src/__tests__/threads-dependencies.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { graduateDependencies } from "../services/threads.js";

describe("graduateDependencies", () => {
  it("maps scope-item deps to task deps once both items have tasks", () => {
    const out = graduateDependencies(
      [{ blockerItemId: "i1", blockedItemId: "i2" }, { blockerItemId: "i3", blockedItemId: "i2" }],
      { i1: "task1", i2: "task2" }, // i3 has no task yet
    );
    expect(out).toEqual([{ blockerIssueId: "task1", blockedIssueId: "task2" }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — pure helper + the service method:

```ts
export function graduateDependencies(
  deps: { blockerItemId: string; blockedItemId: string }[],
  itemToTask: Record<string, string>,
): { blockerIssueId: string; blockedIssueId: string }[] {
  const out: { blockerIssueId: string; blockedIssueId: string }[] = [];
  for (const d of deps) {
    const b = itemToTask[d.blockerItemId];
    const k = itemToTask[d.blockedItemId];
    if (b && k) out.push({ blockerIssueId: b, blockedIssueId: k });
  }
  return out;
}
```

`addScopeDependency(companyId, blockerItemId, blockedItemId)` inserts a `scope_item_dependencies` row. On **Assign** (when Scope items become `issues`), call `graduateDependencies(...)` with the item→task map and insert the resulting `task_dependencies` rows (reuse the existing task-dependency insert in `server/src/routes/issues.ts`). Import `scopeItemDependencies`, `taskDependencies` from `@armyofagents/db`.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/__tests__/threads-dependencies.test.ts
git commit -m "feat(threads): scope-item deps graduate to task_dependencies on Assign"
```

---

## Task 5: Spin-off thread creation

**Files:**
- Modify: `server/src/services/threads.ts` (`spinOff`)
- Test: `server/src/__tests__/threads-spinoff.test.ts`

- [ ] **Step 1: Write the failing test** — `spinOff` creates a new child thread on a target department, seeded with parent context, linked back with `kind="spinoff"`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add to `threadService`:

```ts
    spinOff: async (
      companyId: string,
      parentId: string,
      input: { title: string; departmentId: string; seedContext: string },
      actor: Actor,
    ) => {
      const child = await db.insert(discussions).values({
        companyId, title: input.title, scopeType: "department", scopeId: input.departmentId,
        phase: "discuss", visibility: "open", ownerUserId: null /* Unclaimed on target board */,
        originSource: "agent", createdBy: actor.userId,
      }).returning({ id: discussions.id }).then((r) => r[0]);
      await db.insert(discussionEntries).values({
        discussionId: child.id, inputType: "agent", rawContent: input.seedContext, createdBy: actor.userId,
      });
      await db.insert(threadLinks).values({
        companyId, fromThreadId: child.id, toThreadId: parentId, kind: "spinoff", createdBy: actor.userId,
      });
      publishLiveEvent(companyId, { type: "thread.entry.created", threadId: child.id });
      return { id: child.id };
    },
```

The Dispatcher creates confirmed spin-offs (founder-gated at < L3) via this method.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/__tests__/threads-spinoff.test.ts
git commit -m "feat(threads): spin-off thread creation (linked child on target dept)"
```

---

## Task 6: Per-item routing (department + assignee agent|human)

**Files:**
- Modify: `server/src/services/threads.ts` (`routeScopeItem`)
- Modify: `server/src/routes/discussions.ts`
- Test: `server/src/__tests__/threads-item-routing.test.ts`

- [ ] **Step 1: Write the failing test** — `routeScopeItem` writes the committed routing columns (`departmentId`, `assigneeAgentId` OR `assigneeUserId`) on a `discussion_extracted_items` row; rejects setting both assignees.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — add to `threadService`:

```ts
    routeScopeItem: async (
      companyId: string,
      itemId: string,
      routing: { departmentId?: string; assigneeAgentId?: string; assigneeUserId?: string },
    ) => {
      if (routing.assigneeAgentId && routing.assigneeUserId) {
        throw badRequest("An item is assigned to an agent OR a human, not both");
      }
      await db.update(discussionExtractedItems)
        .set({
          departmentId: routing.departmentId ?? null,
          assigneeAgentId: routing.assigneeAgentId ?? null,
          assigneeUserId: routing.assigneeUserId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(discussionExtractedItems.id, itemId));
      return { ok: true };
    },
```

Route: `PATCH /companies/:companyId/discussions/:id/items/:itemId/routing`. **Writing the task/memory stays founder-gated** — routing only sets the committed fields; the actual `issues` creation happens in the existing approve path (Decision: per-item routing founder-gated). Import `discussionExtractedItems`.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add server/src/services/threads.ts server/src/routes/discussions.ts server/src/__tests__/threads-item-routing.test.ts
git commit -m "feat(threads): per-item department + agent|human routing"
```

---

## Task 7: OriginCard — @mention, ownership, visibility UI

**Files:**
- Modify: `ui/src/components/threads/OriginCard.tsx`
- Create: `ui/src/components/threads/MentionInput.tsx`, `OwnershipMenu.tsx`, `VisibilityToggle.tsx`
- Test: `ui/src/components/threads/__tests__/OwnershipMenu.test.tsx`

- [ ] **Step 1: Write the failing render test** — `OwnershipMenu` shows "Claim" when Unclaimed and "Transfer" + participant management when owned; `VisibilityToggle` flips open↔private and calls the API.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** —
  - `MentionInput`: a contenteditable/text input that suggests participants + agents on `@` (reuse the Commander `CommanderInput` token pattern if practical); on submit, posts an entry (server runs `handleMentions`).
  - `OwnershipMenu`: Claim (`threadsApi.claim`) when `ownerUserId == null`; else Transfer (`threadsApi.transfer`) + add/remove participants (`threadsApi.addParticipant`).
  - `VisibilityToggle`: open/private switch (`@radix-ui/react-switch`), calls a visibility PATCH (add `threadsApi.setVisibility` + the corresponding endpoint if not present).
  Wire all three into `OriginCard`. Invalidate the `['thread', companyId, threadId]` query on success.

- [ ] **Step 4: Run to verify it passes + typecheck.**

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/threads/OriginCard.tsx ui/src/components/threads/MentionInput.tsx ui/src/components/threads/OwnershipMenu.tsx ui/src/components/threads/VisibilityToggle.tsx ui/src/components/threads/__tests__/OwnershipMenu.test.tsx
git commit -m "feat(threads-ui): @mention + ownership + visibility controls"
```

---

## Task 8: ScopeTab — per-item routing, dependency badges, conflict cards

**Files:**
- Modify: `ui/src/components/threads/ScopeTab.tsx`
- Create: `ui/src/components/threads/ConflictCard.tsx`
- Test: `ui/src/components/threads/__tests__/ConflictCard.test.tsx`

- [ ] **Step 1: Write the failing render test** — a Needs-input item with `conflictsWith` renders a `ConflictCard` (A vs B + Keep A / Keep B / Merge / Keep both); a routed item shows its department + assignee; a blocked item shows a dependency badge.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** —
  - `ConflictCard`: side-by-side A/B with sources + the four human actions (Keep A / Keep B / Merge-edit / Keep both); loser archived "superseded by X". (Memory conflicts: Keeper only proposed; founder approves — reflect that the action is human.)
  - In `ScopeTab`, each item row gets a per-item routing control (department picker + assignee agent|human, calling `routeScopeItem`) and a dependency badge (from `scope_item_dependencies`). Add the spin-off item type rendering ("Open as thread").
  Invalidate the thread query on mutations.

- [ ] **Step 4: Run to verify it passes + typecheck.**

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/threads/ScopeTab.tsx ui/src/components/threads/ConflictCard.tsx ui/src/components/threads/__tests__/ConflictCard.test.tsx
git commit -m "feat(threads-ui): per-item routing + dependency badges + conflict cards"
```

---

## Done criteria (Plan 6)

- `pnpm exec vitest run server/src/__tests__/threads-mentions.test.ts threads-mention-dispatch.test.ts threads-links.test.ts threads-dependencies.test.ts threads-spinoff.test.ts threads-item-routing.test.ts` — PASS.
- `pnpm --filter @armyofagents/ui exec vitest run src/components/threads` — PASS.
- Typechecks clean (server + ui).
- @mention invokes agents / notifies humans; ownership + visibility controls work; per-item routing + cross-thread deps + spin-offs function; deps graduate to `task_dependencies` on Assign.

Hand-off: Plan 7 makes all of this update live.

---

## Design-Review Amendments (2026-05-24)

Inherits Plan 4's a11y baseline + tokens.

**ConflictCard visual (Task 8).** Two columns `A | B` with a clear divider, each showing the item text + its source attribution. Four actions as real buttons: **Keep A · Keep B · Merge-edit · Keep both**. On resolve, the losing side collapses to a one-line "superseded by {winner}" note (struck through). The card is a labelled `group`; focus moves to the result note after a choice. For memory conflicts, the actions read as the founder's decision (Memory Keeper only proposed).

**States (D2):**
- @mention: pending ("Notifying…" inline), success (toast via `sonner`), error (Retry).
- Per-item routing: dept/assignee pickers show a loading state; failure shows an inline error and reverts the control.
- Participants: empty reads "Just you so far." (warm, not blank).

**A11y (D3):**
- `MentionInput`: combobox pattern — the `@` suggestion list is an ARIA `listbox`, arrow keys + Enter to select, Escape to dismiss; the contenteditable has an accessible label. (Reuse the Commander `CommanderInput` token model where practical.)
- `OwnershipMenu` / `VisibilityToggle`: Radix primitives (focusable, labelled); the visibility switch announces open/private state.
- Dependency badges + conflict actions reachable and operable by keyboard.

---

## Codex Outside-Voice Amendments (2026-05-24)

**#5 — RBAC + company boundary on every boundary mutation.**
- `linkThreads`: assert the actor can view BOTH `fromThreadId` and `toThreadId`, and both are in `companyId`.
- `routeScopeItem`: assert the actor can edit the item's thread (owner|co_owner|founder) and that `departmentId`/assignee belong to the company. (Routing only sets committed fields; the issue is created in Plan 2's Assign task, founder-gated.)
- `handleMentions` / `spinOff` / `addScopeDependency`: `assertCanView` the thread first; resolve mention targets only within the company.
- Log each mutation to `activity_log` (mentions, links, dependency add, spin-off, routing).
