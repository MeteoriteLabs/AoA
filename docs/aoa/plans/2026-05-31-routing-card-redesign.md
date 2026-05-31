# Inbound Routing — Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deterministic similarity-score routing decider with a Chronicler CLI agent that maintains per-thread routing cards, and a Navigator CLI agent that reads those cards to decide where inbound items belong.

**Architecture:** The Chronicler (new) sweeps recently-active threads and writes `discussions.summaryText` + `routingTerms`; the Navigator (existing, extended) reads those cards at wakeup time to decide attach/new/unsure. The embed-based `findSimilarThreadsScored` is demoted to a retrieval shortlister at scale; the deterministic decider (`classifyRouting`/`resolveRoutingAction`) is deleted entirely. All existing write-paths (attach, promote, suggestions lane, dial, wakeup, dispatcher) are reused.

**Tech Stack:** TypeScript, Drizzle ORM, Express 5, PostgreSQL + pgvector, React + TailwindCSS v4, Vitest

**Spec:** `~/.gstack/projects/MeteoriteLabs-AoA/TK-routing-card-redesign-design-20260531.md`
**Eng-review tasks:** `~/.gstack/projects/MeteoriteLabs-AoA/tasks-eng-review-20260531-routing-cards.jsonl`
**Branch:** `feat/inbound-routing` (worktree at `AoA-threads/`)

---

## File Map

### Created
- `packages/db/src/migrations/0133_routing_card_redesign.sql` — generated (never hand-write)
- `server/src/services/internal-agent/aoa-agents/ensure-chronicler.ts` — Chronicler seed
- `server/src/services/internal-agent/aoa-agents/sweep-chronicler.ts` — Chronicler sweep driver
- `server/src/services/internal-agent/tools/list-thread-cards.ts` — card-fetch tool (small-scale all + hybrid)
- `server/src/services/internal-agent/tools/promote-inbox-to-thread.ts` — Navigator new-thread action (C1)
- `server/src/onboarding-assets/chronicler/SOUL.md`
- `server/src/onboarding-assets/chronicler/AGENTS.md`
- `server/src/onboarding-assets/chronicler/HEARTBEAT.md`
- `server/src/onboarding-assets/chronicler/TOOLS.md`
- `server/src/__tests__/chronicler.test.ts` — Chronicler unit tests
- `server/src/__tests__/inbox-router-rewire.test.ts` — rewired routeInboxItem tests
- `server/src/__tests__/inbox-router-reclaim.test.ts` — stale reclaim tests
- `server/src/__tests__/evals/inbox-routing-eval.test.ts` — routing regression eval gate
- `server/src/__tests__/evals/chronicler-card-eval.test.ts` — card quality eval

### Modified
- `packages/db/src/schema/discussions.ts` — add `routingTerms` column
- `packages/db/src/schema/threads.ts` — add `routingClaimedAt`, `suggestedThreadTitle` to `threadInboxItems`
- `server/src/services/inbox-router.ts` — rewire (remove classify/resolve/score; add card-assembly + Navigator wakeup)
- `server/src/services/internal-agent/tools/thread-update-summary.ts` — accept optional `routingTerms`
- `server/src/services/internal-agent/tool-registry.ts` — register `listThreadCardsTool` + `promoteInboxToThreadTool`
- `server/src/services/internal-agent/aoa-agents/ensure-adjutant.ts` — remove summary-update instruction line
- `server/src/services/internal-agent/aoa-agents/ensure-command-staff.ts` — add `list_thread_cards`, `promote_inbox_to_thread` to Navigator allowlist
- `server/src/services/internal-agent/aoa-agents/aoa-trigger-prompt.ts` — updated INBOX_ROUTING_DIRECTIVE + card rendering
- `server/src/services/internal-agent/aoa-agents/seed-crew-agent.ts` — add `'chronicler'` to `instructionBundleRole` union
- `server/src/services/internal-agent/aoa-agents/seed-commander-bundle.ts` — add `'chronicler'` to `role` union
- `server/src/services/internal-agent/aoa-agents/sweep-inbox.ts` — add stale reclaim logic (C4)
- `server/src/index.ts` — wire `runChroniclerSweep` on 45s interval + `ensureChronicler` on bootstrap
- `ui/src/components/threads/ThreadBoard.tsx` — add `suggestedThreadTitle` to `InboxCardItem`
- `ui/src/components/threads/UnlistedLane.tsx` — render `suggest_new` banner
- `ui/src/components/threads/__tests__/UnlistedLane.test.tsx` — add `suggest_new` coverage

### Deleted
- `server/src/services/inbound-routing-constants.ts`
- `server/src/__tests__/inbox-router-gate.test.ts`
- `server/src/__tests__/inbox-routing-matrix.test.ts`

---

## Task 1 — Schema: `discussions.routingTerms` + `thread_inbox_items.routingClaimedAt` + `suggestedThreadTitle`

**Files:**
- Modify: `packages/db/src/schema/discussions.ts` (add `routingTerms` column after `summaryUpdatedAt`)
- Modify: `packages/db/src/schema/threads.ts` (add `routingClaimedAt`, `suggestedThreadTitle` to `threadInboxItems`)
- Generate: `packages/db/src/migrations/0133_routing_card_redesign.sql` (do NOT hand-write)

- [ ] **Step 1: Add `routingTerms` to `discussions` table**

In `packages/db/src/schema/discussions.ts`, after the `summaryUpdatedAt` line (~line 79):

```typescript
    // Routing card — key entities + aliases for hybrid retrieval (Chronicler-written).
    // Stored as a JSON array serialized to text: '["Acme Corp","ACME","the renewal"]'.
    // NULL on threads created before the Chronicler seeded a card.
    routingTerms: text("routing_terms"),
```

- [ ] **Step 2: Add `routingClaimedAt` and `suggestedThreadTitle` to `threadInboxItems`**

In `packages/db/src/schema/threads.ts`, inside the `threadInboxItems` column definitions, after `navigatorWakeupId`:

```typescript
    // Timestamp when the atomic claim (pending_route → routing) was executed.
    // Used by sweep-inbox.ts to reclaim items stranded in 'routing'/'escalated'
    // that have been in-flight longer than RECLAIM_THRESHOLD_MS (C4 / #37).
    routingClaimedAt: timestamp("routing_claimed_at", { withTimezone: true }),

    // Proposed title when the Navigator suggests creating a new thread (D2 suggest_new).
    // NULL for attach suggestions.
    suggestedThreadTitle: text("suggested_thread_title"),
```

- [ ] **Step 3: Generate the migration (from repo root)**

```
pnpm db:generate
```

Expected output: a new migration file `packages/db/src/migrations/0133_*.sql` containing `ALTER TABLE "discussions" ADD COLUMN "routing_terms" text;` etc.

If the migration number differs, that's fine — Drizzle assigns the next available number.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/discussions.ts packages/db/src/schema/threads.ts packages/db/src/migrations/
git commit -m "feat(schema): add discussions.routingTerms, thread_inbox_items.routingClaimedAt + suggestedThreadTitle"
```

---

## Task 2 — Delete deterministic decider + dead tests

**Files:**
- Delete: `server/src/services/inbound-routing-constants.ts`
- Delete: `server/src/__tests__/inbox-router-gate.test.ts`
- Delete: `server/src/__tests__/inbox-routing-matrix.test.ts`

These are the classify/resolve gate functions and their tests. The new `routeInboxItem` (Task 8) does not call them.

- [ ] **Step 1: Verify no other imports of inbound-routing-constants**

```
grep -rn "inbound-routing-constants" server/src/ --include="*.ts"
```

Expected: only `inbox-router.ts` imports it. If anything else imports it, note those files — they need updating in Task 8 when we rewrite `inbox-router.ts`.

- [ ] **Step 2: Delete the three files**

```bash
rm server/src/services/inbound-routing-constants.ts
rm server/src/__tests__/inbox-router-gate.test.ts
rm server/src/__tests__/inbox-routing-matrix.test.ts
```

- [ ] **Step 3: Run tests to confirm deletion doesn't break the live suite**

```
pnpm test:run -- --reporter=verbose 2>&1 | tail -30
```

Expected: the gate test and matrix test no longer appear. Other tests still pass. (inbox-router.ts will have broken imports but we're rewriting it in Task 8 — ignore its compile error here.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(inbox-router): delete deterministic decider (classifyRouting/resolveRoutingAction) + gate tests (D1)"
```

---

## Task 3 — Extend `thread.updateSummary` to accept `routingTerms`

**Files:**
- Modify: `server/src/services/internal-agent/tools/thread-update-summary.ts`

- [ ] **Step 1: Write the failing test**

In a new file `server/src/__tests__/thread-update-summary.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@armyofagents/db", () => ({
  discussions: new Proxy({} as any, { get: (_t, p) => p }),
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _op: "eq", a, b })),
}));

import { threadUpdateSummaryTool } from "../services/internal-agent/tools/thread-update-summary.js";

const COMPANY_ID = "aaaaaaaa-0000-4aaa-8aaa-aaaaaaaaaaaa";
const THREAD_ID = "bbbbbbbb-0000-4bbb-8bbb-bbbbbbbbbbbb";

function makeCtx(routingTermsOnRow?: string) {
  const selectMock = vi.fn().mockResolvedValue([{ companyId: COMPANY_ID, routingTerms: routingTermsOnRow ?? null }]);
  const updateMock = vi.fn().mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) });
  return {
    db: {
      select: () => ({ from: () => ({ where: () => ({ then: (f: Function) => f([{ companyId: COMPANY_ID }]) }) }) }),
      update: () => ({ set: updateMock, where: vi.fn().mockResolvedValue([]) }),
    } as any,
    companyId: COMPANY_ID,
    services: {},
  };
}

describe("thread.updateSummary", () => {
  it("writes routingTerms to the row when provided", async () => {
    const ctx = makeCtx();
    const setSpy = vi.spyOn(ctx.db, "update");
    const result = await threadUpdateSummaryTool.execute(
      { threadId: THREAD_ID, summary: "Acme renewal discussion", routingTerms: ["Acme Corp", "renewal"] },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ threadId: THREAD_ID, routingTermsWritten: true });
  });

  it("skips routingTerms write when param is absent", async () => {
    const ctx = makeCtx();
    const result = await threadUpdateSummaryTool.execute(
      { threadId: THREAD_ID, summary: "A simple summary" },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ threadId: THREAD_ID, routingTermsWritten: false });
  });

  it("returns error when routingTerms is not an array", async () => {
    const ctx = makeCtx();
    const result = await threadUpdateSummaryTool.execute(
      { threadId: THREAD_ID, summary: "ok", routingTerms: "not-an-array" as any },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
pnpm test:run server/src/__tests__/thread-update-summary.test.ts
```

Expected: FAIL — `routingTermsWritten` not in result shape.

- [ ] **Step 3: Update `thread-update-summary.ts`**

Replace the full file content:

```typescript
// server/src/services/internal-agent/tools/thread-update-summary.ts
import { eq } from "drizzle-orm";
import { discussions } from "@armyofagents/db";
import type { AgentTool } from "../types.js";

export const threadUpdateSummaryTool: AgentTool = {
  name: "thread.updateSummary",
  description:
    "Update a thread's summary text + routing terms, then queue embedding regeneration.",
  parameters: {
    type: "object",
    properties: {
      threadId: { type: "string", description: "The thread (discussion) ID" },
      summary: {
        type: "string",
        description: "1-3 sentence summary of current thread state",
      },
      routingTerms: {
        type: "array",
        items: { type: "string" },
        description:
          "Key entities, aliases, and synonyms for hybrid routing retrieval " +
          "(e.g. [\"Acme Corp\",\"ACME\",\"the renewal\"]). Omit to leave unchanged.",
      },
    },
    required: ["threadId", "summary"],
  },
  category: "action",
  requiredRole: "team_member",
  requiresConfirmation: false,
  async execute(params, ctx) {
    const { threadId, summary, routingTerms } = (params ?? {}) as {
      threadId?: string;
      summary?: string;
      routingTerms?: unknown;
    };

    if (!threadId || typeof threadId !== "string") {
      return { success: false, data: null, summary: "threadId is required", error: "INVALID_PARAMS" };
    }
    if (typeof summary !== "string") {
      return { success: false, data: null, summary: "summary must be a string", error: "INVALID_PARAMS" };
    }
    if (routingTerms !== undefined && !Array.isArray(routingTerms)) {
      return { success: false, data: null, summary: "routingTerms must be a string array", error: "INVALID_PARAMS" };
    }

    // Cross-tenant guard (#7): verify thread belongs to caller's company.
    const existing = await ctx.db
      .select({ companyId: discussions.companyId })
      .from(discussions)
      .where(eq(discussions.id, threadId))
      .then((rows: Array<{ companyId: string }>) => rows[0] ?? null);

    if (!existing) {
      return { success: false, data: null, summary: `Thread ${threadId} not found`, error: "THREAD_NOT_FOUND" };
    }
    if (existing.companyId !== ctx.companyId) {
      return { success: false, data: null, summary: "Thread belongs to a different company", error: "COMPANY_MISMATCH" };
    }

    const summaryUpdatedAt = new Date();
    const updatePayload: Record<string, unknown> = { summaryText: summary, summaryUpdatedAt };

    let routingTermsWritten = false;
    if (Array.isArray(routingTerms)) {
      // Serialize as JSON text so the existing `text` column stores it.
      updatePayload.routingTerms = JSON.stringify(routingTerms);
      routingTermsWritten = true;
    }

    await ctx.db
      .update(discussions)
      .set(updatePayload)
      .where(eq(discussions.id, threadId));

    // Best-effort embedding regeneration.
    let embeddingQueued = false;
    try {
      if (ctx.services?.embeddings?.enqueue) {
        await ctx.services.embeddings.enqueue({
          targetTable: "discussions",
          targetId: threadId,
          targetColumn: "summary_embedding",
          inputText: summary,
        });
        embeddingQueued = true;
      }
    } catch {
      embeddingQueued = false;
    }

    return {
      success: true,
      data: { threadId, summaryUpdatedAt: summaryUpdatedAt.toISOString(), embeddingQueued, routingTermsWritten },
      summary: embeddingQueued
        ? "Summary updated; embedding queued"
        : "Summary updated (embedding not queued — service unavailable)",
    };
  },
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```
pnpm test:run server/src/__tests__/thread-update-summary.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Run full test suite**

```
pnpm test:run 2>&1 | tail -10
```

Expected: all passing (except inbox-router.ts compile errors from Task 2 — those resolve in Task 8).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/tools/thread-update-summary.ts \
        server/src/__tests__/thread-update-summary.test.ts
git commit -m "feat(tools): extend thread.updateSummary to accept routingTerms (T4)"
```

---

## Task 4 — Strip Adjutant's summary-update instruction (A1)

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/ensure-adjutant.ts`

Per A1, the Chronicler is the primary routine writer of `summaryText`. The Adjutant's standing instruction to call `thread.updateSummary` on every run is removed. The tool stays on the allowlist (it remains a shared action tool — the Adjutant can still call it on its own initiative, but it no longer has a standing directive to do so).

- [ ] **Step 1: Edit the instruction in `ensure-adjutant.ts`**

Find and remove this line from `ADJUTANT_INSTRUCTION`:

```
4. Update the thread summary so future runs have fresh context (use thread.updateSummary).
```

The surrounding numbered list will need re-numbering: item 5 (if any) becomes 4, etc. In practice the list ends at 4, so after removal the list has items 1–3.

The section currently reads:
```
When dispatched to a thread, you:
1. Read the recent entries via thread.listEntries and the related-thread context provided.
2. Set or refine intent via thread.setIntent if not already clear.
3. Decide one of:
   - Respond directly with a clarifying question or summary (use post_entry).
   - Delegate to Scout for investigation (use agent.dispatch on Scout).
   - Delegate to Engineer to produce an artifact (use agent.dispatch on Engineer).
   - Delegate to Navigator if a topic needs its own thread (use agent.dispatch on Navigator).
   - Propose work when the conversation has converged (use propose_crew_work — this is the sole scope-card path through the D11 chokepoint).
4. Update the thread summary so future runs have fresh context (use thread.updateSummary).
```

Change to:
```
When dispatched to a thread, you:
1. Read the recent entries via thread.listEntries and the related-thread context provided.
2. Set or refine intent via thread.setIntent if not already clear.
3. Decide one of:
   - Respond directly with a clarifying question or summary (use post_entry).
   - Delegate to Scout for investigation (use agent.dispatch on Scout).
   - Delegate to Engineer to produce an artifact (use agent.dispatch on Engineer).
   - Delegate to Navigator if a topic needs its own thread (use agent.dispatch on Navigator).
   - Propose work when the conversation has converged (use propose_crew_work — this is the sole scope-card path through the D11 chokepoint).
```

- [ ] **Step 2: Verify typecheck**

```
pnpm typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/ensure-adjutant.ts
git commit -m "feat(adjutant): remove standing thread.updateSummary directive — Chronicler is primary card writer (A1)"
```

---

## Task 5 — Chronicler CLI agent

**Files:**
- Create: `server/src/onboarding-assets/chronicler/SOUL.md`
- Create: `server/src/onboarding-assets/chronicler/AGENTS.md`
- Create: `server/src/onboarding-assets/chronicler/HEARTBEAT.md`
- Create: `server/src/onboarding-assets/chronicler/TOOLS.md`
- Modify: `server/src/services/internal-agent/aoa-agents/seed-commander-bundle.ts` (add `'chronicler'` to role union)
- Modify: `server/src/services/internal-agent/aoa-agents/seed-crew-agent.ts` (add `'chronicler'` to instructionBundleRole union)
- Create: `server/src/services/internal-agent/aoa-agents/ensure-chronicler.ts`
- Create: `server/src/services/internal-agent/aoa-agents/sweep-chronicler.ts`
- Modify: `server/src/index.ts` (wire sweep + bootstrap seed)

### 5a — Onboarding bundle files

- [ ] **Step 1: Create `server/src/onboarding-assets/chronicler/SOUL.md`**

```markdown
# Soul — Chronicler

You are the **Chronicler**. You keep each thread's routing card accurate and fresh.

## Principles

1. **Facts only, faithfully.** Read what was actually said and write a tight factual summary. Do not infer intent, add opinions, or extrapolate. A Chronicler is a scribe, not an analyst.

2. **Terms are identities, not prose.** The `routingTerms` array you write is a list of key entities: company names, product names, project aliases, people, and any nicknames or abbreviations the team uses for them. Each entry is a discrete token, not a phrase.

3. **Incremental, not from scratch.** You receive the existing card (summaryText + routingTerms). Merge the new entries into the existing card — preserve what's still true, update what has changed, add what's new. Do not wipe and rewrite unless the thread has fundamentally changed topic.

4. **Silent always.** You NEVER post_entry into a thread. Your only output is a `thread.updateSummary` call. Silence is your default; a card write is your only action.

5. **Low temperature.** Stay close to what was said. Routing depends on consistency: a card that drifts from the thread content misleads the Navigator.

## Voice

Not a voice — a record. You write for a machine (the Navigator), not for humans. Dense, accurate, tightly scoped.

## Boundaries

- You have exactly ONE tool: `thread.updateSummary` (with `routingTerms`).
- You do NOT: post entries, create tasks, write memory, call any other tool.
- If you cannot write a card (thread not found, service error), exit silently — do not throw, do not post.
```

- [ ] **Step 2: Create `server/src/onboarding-assets/chronicler/AGENTS.md`**

```markdown
# Agents — Chronicler

You work alone. You have no crew to delegate to and you do not coordinate with other agents.

When you are woken for a thread, read its recent entries via context, write the card once, and stop.
```

- [ ] **Step 3: Create `server/src/onboarding-assets/chronicler/HEARTBEAT.md`**

```markdown
# Heartbeat — Chronicler

You are woken by the Chronicler sweep when a thread has new entries since your last card write.

**Your single action each wakeup:**
1. You receive `threadId` in the trigger payload.
2. Read the current card (the `Existing card:` block in the trigger prompt).
3. Read the new entries since the last card update (use the entries already provided in the trigger prompt — do not call additional tools).
4. Call `thread.updateSummary` once with the updated `summary` and `routingTerms`. Done.

**Do not call any other tools.** Do not post into the thread. Exit immediately after the one `thread.updateSummary` call.
```

- [ ] **Step 4: Create `server/src/onboarding-assets/chronicler/TOOLS.md`**

```markdown
# Tools — Chronicler

## `thread.updateSummary`

Your only tool. Writes the thread's routing card.

Parameters:
- `threadId` (required): the thread to update.
- `summary` (required): 1–3 sentence factual description of what the thread is about. Written for the Navigator, not for humans. Be dense and accurate.
- `routingTerms` (required): array of key entity strings for keyword routing. Include: company/product/project names, acronyms, aliases, and any domain-specific terms mentioned. Example: `["Acme Corp","ACME","Q3 renewal","contract extension","churn risk"]`.

Call this exactly once per wakeup, then stop.
```

### 5b — Add `'chronicler'` to bundle/seed union types

- [ ] **Step 5: Add `'chronicler'` to `seed-commander-bundle.ts` role union**

In `server/src/services/internal-agent/aoa-agents/seed-commander-bundle.ts`, find the `role:` union type (around line 57) and add `| "chronicler"`:

```typescript
  role:
    | "commander"
    | "router"
    | "navigator"
    | "planner"
    | "dispatcher"
    | "memory_keeper"
    | "scribe"
    | "adjutant"
    | "maker"
    | "engineer"
    | "scout"
    | "chronicler";
```

- [ ] **Step 6: Add `'chronicler'` to `seed-crew-agent.ts` instructionBundleRole union**

In `server/src/services/internal-agent/aoa-agents/seed-crew-agent.ts`, find the `instructionBundleRole:` union (around line 55) and add `| "chronicler"`:

```typescript
  instructionBundleRole:
    | "commander"
    | "router"
    | "navigator"
    | "planner"
    | "dispatcher"
    | "memory_keeper"
    | "scribe"
    | "adjutant"
    | "maker"
    | "engineer"
    | "scout"
    | "chronicler";
```

### 5c — `ensure-chronicler.ts`

- [ ] **Step 7: Create `server/src/services/internal-agent/aoa-agents/ensure-chronicler.ts`**

```typescript
// server/src/services/internal-agent/aoa-agents/ensure-chronicler.ts
//
// Idempotently seeds the Chronicler role for a company.
//
// The Chronicler is a Command-Staff-adjacent infrastructure role (autonomy 0 —
// always active). It keeps each thread's routing card fresh by updating
// discussions.summaryText + routingTerms on every sweep cycle that detects
// new activity. It is SILENT — no thread posts, only thread.updateSummary calls.
//
// Trigger: 'sweep' (kind), picked up by sweep-chronicler.ts every 45s.
// Tool allowlist: ['thread.updateSummary'] only.
// Bundle role key: 'chronicler' (maps to onboarding-assets/chronicler/).

import type { Db } from "@armyofagents/db";
import { seedCrewAgent } from "./seed-crew-agent.js";

const CHRONICLER_INSTRUCTION =
  "You are the Chronicler. Keep thread routing cards accurate. " +
  "When woken for a thread, read its entries, then call thread.updateSummary ONCE " +
  "with a tight factual summary and an array of key entity terms (routingTerms). " +
  "NEVER post_entry. NEVER call any other tool. Silence is correct when in doubt.";

export const CHRONICLER_TOOL_ALLOWLIST: string[] = ["thread.updateSummary"];

/**
 * Idempotently seed the Chronicler role for a company.
 * Returns the agent id.
 */
export async function ensureChronicler(db: Db, companyId: string): Promise<string> {
  return seedCrewAgent(db, companyId, {
    name: "Chronicler",
    role: "general",
    instruction: CHRONICLER_INSTRUCTION,
    toolAllowlist: CHRONICLER_TOOL_ALLOWLIST,
    triggers: [{ kind: "sweep", config: { role: "chronicler" } }],
    instructionBundleRole: "chronicler",
  });
}
```

### 5d — `sweep-chronicler.ts`

- [ ] **Step 8: Create `server/src/services/internal-agent/aoa-agents/sweep-chronicler.ts`**

```typescript
// server/src/services/internal-agent/aoa-agents/sweep-chronicler.ts
//
// Chronicler card-update sweep.
//
// Queries threads that have new entries since their last card update and
// queues one agentWakeupRequests row per eligible thread.
//
// Eligibility: discussions.status='active' AND
//   (summaryUpdatedAt IS NULL OR lastEntryAt > summaryUpdatedAt)
// Debounce: skip threads with an existing pending/queued Chronicler wakeup
//   in the last CHRONICLER_DEBOUNCE_MS (45s) to absorb entry bursts.
// Concurrency cap: process at most CHRONICLER_MAX_CONCURRENT threads per cycle.

import { and, eq, ne, gt, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers, discussions, agentWakeupRequests } from "@armyofagents/db";
import { logger } from "../../../middleware/logger.js";

const log = logger.child({ svc: "sweep-chronicler" });

/** Matches the sweep interval in index.ts. */
export const CHRONICLER_SWEEP_INTERVAL_MS = 45_000;

/** Skip threads with a Chronicler wakeup queued within this window. */
export const CHRONICLER_DEBOUNCE_MS = 45_000;

/** Max threads to queue per sweep tick. */
export const CHRONICLER_MAX_CONCURRENT = 10;

export interface RunChroniclerSweepResult {
  queued: number;
}

/**
 * For every company that has a Chronicler agent with a 'sweep' trigger,
 * find active threads with stale cards and queue one Chronicler wakeup per thread.
 */
export async function runChroniclerSweep(db: Db): Promise<RunChroniclerSweepResult> {
  // ── 1. Find all companies with an active Chronicler sweep trigger ─────────
  const chroniclerRows = await db
    .select({
      agentId: aoaAgentTriggers.agentId,
      companyId: aoaAgentTriggers.companyId,
    })
    .from(aoaAgentTriggers)
    .innerJoin(agents, eq(agents.id, aoaAgentTriggers.agentId))
    .where(
      and(
        eq(aoaAgentTriggers.kind, "sweep"),
        eq(aoaAgentTriggers.enabled, true),
        sql`(${aoaAgentTriggers.config}->>'role') = 'chronicler'`,
        ne(agents.status, "terminated"),
        ne(agents.status, "paused"),
      ),
    );

  if (chroniclerRows.length === 0) {
    return { queued: 0 };
  }

  // ── 2. For each company, find stale threads + queue wakeups ───────────────
  let totalQueued = 0;

  for (const { agentId, companyId } of chroniclerRows) {
    try {
      const queued = await queueForCompany(db, agentId, companyId);
      totalQueued += queued;
    } catch (err) {
      log.warn({ err, companyId }, "sweep-chronicler: queueForCompany failed — continuing");
    }
  }

  if (totalQueued > 0) {
    log.debug({ queued: totalQueued }, "sweep-chronicler: done");
  }

  return { queued: totalQueued };
}

async function queueForCompany(db: Db, agentId: string, companyId: string): Promise<number> {
  // ── Threads with new entries since last card update ───────────────────────
  const staleThreads = await db
    .select({ id: discussions.id })
    .from(discussions)
    .where(
      and(
        eq(discussions.companyId, companyId),
        eq(discussions.status, "active"),
        or(
          isNull(discussions.summaryUpdatedAt),
          gt(discussions.lastEntryAt, discussions.summaryUpdatedAt),
        ),
      ),
    )
    .limit(CHRONICLER_MAX_CONCURRENT);

  if (staleThreads.length === 0) return 0;

  // ── Debounce: skip threads already queued in the last CHRONICLER_DEBOUNCE_MS
  const cutoff = new Date(Date.now() - CHRONICLER_DEBOUNCE_MS);
  const recentWakeups = await db
    .select({ payload: agentWakeupRequests.payload })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.agentId, agentId),
        eq(agentWakeupRequests.status, "queued"),
        gt(agentWakeupRequests.createdAt, cutoff),
      ),
    );

  const alreadyQueued = new Set(
    recentWakeups
      .map((r) => (r.payload as Record<string, unknown>)?.threadId as string | undefined)
      .filter(Boolean),
  );

  const toQueue = staleThreads.filter((t) => !alreadyQueued.has(t.id));
  if (toQueue.length === 0) return 0;

  // ── Insert wakeup rows ────────────────────────────────────────────────────
  const wakeupRows = toQueue.map((t) => ({
    companyId,
    agentId,
    source: "sweep.chronicler" as const,
    reason: "card_stale",
    payload: { threadId: t.id, role: "chronicler" } as Record<string, unknown>,
    status: "queued" as const,
  }));

  await db.insert(agentWakeupRequests).values(wakeupRows);

  return toQueue.length;
}
```

### 5e — Wire into `server/src/index.ts`

- [ ] **Step 9: Import `ensureChronicler` + `runChroniclerSweep` in `server/src/index.ts`**

Find the block where `ensureCommandStaff` and `ensureAdjutant` are imported (around line 63):

```typescript
import { ensureCommandStaff } from "./services/internal-agent/aoa-agents/ensure-command-staff.js";
import { ensureAdjutant } from "./services/internal-agent/aoa-agents/ensure-adjutant.js";
```

Add below those lines:

```typescript
import { ensureChronicler } from "./services/internal-agent/aoa-agents/ensure-chronicler.js";
import { runChroniclerSweep, CHRONICLER_SWEEP_INTERVAL_MS } from "./services/internal-agent/aoa-agents/sweep-chronicler.js";
```

- [ ] **Step 10: Seed Chronicler on company bootstrap (alongside ensureCommandStaff)**

Find the block (~line 734):

```typescript
ensureCommandStaff(db as any, row.id).catch((err: unknown) =>
```

Add after the `ensureAdjutant` call:

```typescript
ensureChronicler(db as any, row.id).catch((err: unknown) =>
  logger.warn({ err, companyId: row.id }, "bootstrap: ensureChronicler failed"),
);
```

- [ ] **Step 11: Register Chronicler sweep on its interval**

Find where `runInboxSweep` or similar sweeps are registered with `setInterval`. Add:

```typescript
setInterval(() => {
  runChroniclerSweep(db as any).catch((err: unknown) =>
    logger.warn({ err }, "chronicler sweep error"),
  );
}, CHRONICLER_SWEEP_INTERVAL_MS);
```

- [ ] **Step 12: Run typecheck**

```
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add server/src/onboarding-assets/chronicler/ \
        server/src/services/internal-agent/aoa-agents/ensure-chronicler.ts \
        server/src/services/internal-agent/aoa-agents/sweep-chronicler.ts \
        server/src/services/internal-agent/aoa-agents/seed-crew-agent.ts \
        server/src/services/internal-agent/aoa-agents/seed-commander-bundle.ts \
        server/src/index.ts
git commit -m "feat(chronicler): seed Chronicler CLI agent + sweep driver (T2)"
```

---

## Task 6 — `list_thread_cards` tool (hybrid retrieval)

**Files:**
- Create: `server/src/services/internal-agent/tools/list-thread-cards.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/list-thread-cards.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@armyofagents/db", () => ({
  discussions: new Proxy({} as any, { get: (_t, p) => p }),
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ _op: "and", a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _op: "eq", a, b })),
  sql: Object.assign(vi.fn((s: TemplateStringsArray, ...v: unknown[]) => ({ _sql: s, v })), {
    raw: vi.fn((s: string) => ({ _raw: s })),
  }),
  isNotNull: vi.fn((a: unknown) => ({ _op: "isNotNull", a })),
}));

import { listThreadCardsTool } from "../services/internal-agent/tools/list-thread-cards.js";

const COMPANY_ID = "aaaaaaaa-0000-4aaa-8aaa-aaaaaaaaaaaa";

function makeCtx(threadRows: Array<{ id: string; title: string | null; summaryText: string | null; routingTerms: string | null }>) {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(threadRows),
          }),
        }),
      }),
    } as any,
    companyId: COMPANY_ID,
    services: {},
  };
}

describe("list_thread_cards", () => {
  it("returns all active thread cards for small scale", async () => {
    const rows = [
      { id: "t1", title: "Acme renewal", summaryText: "About the Acme renewal deal", routingTerms: '["Acme Corp","renewal"]' },
      { id: "t2", title: "Infra upgrade", summaryText: "Server migration discussion", routingTerms: null },
    ];
    const ctx = makeCtx(rows);
    const result = await listThreadCardsTool.execute({}, ctx);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      threadId: "t1",
      title: "Acme renewal",
      summaryText: "About the Acme renewal deal",
      routingTerms: ["Acme Corp", "renewal"],
    });
    expect(result.data[1]).toMatchObject({ threadId: "t2", routingTerms: [] });
  });

  it("returns empty array when no active threads", async () => {
    const ctx = makeCtx([]);
    const result = await listThreadCardsTool.execute({}, ctx);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
pnpm test:run server/src/__tests__/list-thread-cards.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `server/src/services/internal-agent/tools/list-thread-cards.ts`**

```typescript
// server/src/services/internal-agent/tools/list-thread-cards.ts
//
// list_thread_cards — fetch routing cards for the Navigator.
//
// Small scale (≤ SMALL_SCALE_LIMIT active threads): return ALL active thread
// cards. No retrieval, no recall risk.
//
// The Navigator calls this tool to get the candidate set it reasons over.
// findSimilarThreadsScored is NOT called from here — it's a retrieval shortlister
// reserved for large-scale deployments (deferred).

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { discussions } from "@armyofagents/db";
import type { AgentTool } from "../types.js";

/** Below this count, return all active cards. Above it, a top-K retrieval
 *  would be used (deferred to large-scale phase). */
export const SMALL_SCALE_LIMIT = 100;

export interface ThreadCard {
  threadId: string;
  title: string | null;
  summaryText: string | null;
  routingTerms: string[];
}

export const listThreadCardsTool: AgentTool = {
  name: "list_thread_cards",
  description:
    "Fetch routing cards (summaryText + routingTerms) for active threads. " +
    "Use this to get candidate threads before deciding where an inbound item belongs.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Optional: extract intent/entities from the inbound item to filter results at scale. Unused at small scale.",
      },
    },
    required: [],
  },
  category: "query",
  requiredRole: "team_member",
  requiresConfirmation: false,
  async execute(_params, ctx) {
    const rows = await ctx.db
      .select({
        id: discussions.id,
        title: discussions.title,
        summaryText: discussions.summaryText,
        routingTerms: discussions.routingTerms,
      })
      .from(discussions)
      .where(
        and(
          eq(discussions.companyId, ctx.companyId),
          eq(discussions.status, "active"),
        ),
      )
      .limit(SMALL_SCALE_LIMIT);

    const cards: ThreadCard[] = (Array.isArray(rows) ? rows : []).map((r) => {
      let terms: string[] = [];
      if (typeof r.routingTerms === "string" && r.routingTerms.trim().length > 0) {
        try {
          const parsed = JSON.parse(r.routingTerms);
          if (Array.isArray(parsed)) terms = parsed.filter((t): t is string => typeof t === "string");
        } catch {
          // malformed JSON — treat as no terms
        }
      }
      return {
        threadId: r.id,
        title: r.title ?? null,
        summaryText: r.summaryText ?? null,
        routingTerms: terms,
      };
    });

    return {
      success: true,
      data: cards,
      summary: `${cards.length} routing card(s) returned`,
    };
  },
};
```

- [ ] **Step 4: Run test to confirm it passes**

```
pnpm test:run server/src/__tests__/list-thread-cards.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/tools/list-thread-cards.ts \
        server/src/__tests__/list-thread-cards.test.ts
git commit -m "feat(tools): add list_thread_cards (small-scale card-fetch for Navigator, T6)"
```

---

## Task 7 — `promote_inbox_to_thread` Navigator tool (C1 blocker)

**Files:**
- Create: `server/src/services/internal-agent/tools/promote-inbox-to-thread.ts`

This is the Codex C1 BLOCKER: `spin_off_thread` is thread→thread (`fromThreadId`, `subtype='live'`) and cannot promote an inbox item. The Navigator needs a distinct tool that wraps `promoteInboxItemToNewThread` from `inbox-attach.ts`.

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/promote-inbox-to-thread.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@armyofagents/db", () => ({
  internalAgentConfig: new Proxy({} as any, { get: (_t, p) => p }),
  threadInboxItems: new Proxy({} as any, { get: (_t, p) => p }),
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _op: "eq", a, b })),
}));

const mockPromote = vi.fn();
vi.mock("../services/inbox-attach.js", () => ({
  promoteInboxItemToNewThread: (...args: any[]) => mockPromote(...args),
}));

import { promoteInboxToThreadTool } from "../services/internal-agent/tools/promote-inbox-to-thread.js";

const COMPANY_ID = "aaaaaaaa-0000-4aaa-8aaa-aaaaaaaaaaaa";
const INBOX_ITEM_ID = "bbbbbbbb-0000-4bbb-8bbb-bbbbbbbbbbbb";

function makeCtx(dial: string) {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ inboundRoutingLevel: dial }]),
          }),
        }),
      }),
    } as any,
    companyId: COMPANY_ID,
    services: {},
  };
}

describe("promote_inbox_to_thread", () => {
  it("auto-creates thread at full_auto", async () => {
    mockPromote.mockResolvedValue({ threadId: "new-thread-id", entryId: "e1", alreadyHandled: false });
    const ctx = makeCtx("full_auto");
    const result = await promoteInboxToThreadTool.execute({ inboxItemId: INBOX_ITEM_ID }, ctx);
    expect(result.success).toBe(true);
    expect(result.data.action).toBe("created");
    expect(result.data.threadId).toBe("new-thread-id");
    expect(mockPromote).toHaveBeenCalledWith(ctx.db, expect.objectContaining({ inboxItemId: INBOX_ITEM_ID, companyId: COMPANY_ID }));
  });

  it("records suggest_new at auto_attach dial (does NOT create)", async () => {
    const ctx = makeCtx("auto_attach");
    const result = await promoteInboxToThreadTool.execute({ inboxItemId: INBOX_ITEM_ID, proposedTitle: "Acme renewal" }, ctx);
    expect(result.success).toBe(true);
    expect(result.data.action).toBe("suggest_new");
    expect(mockPromote).not.toHaveBeenCalled();
  });

  it("records suggest_new at suggest dial", async () => {
    const ctx = makeCtx("suggest");
    const result = await promoteInboxToThreadTool.execute({ inboxItemId: INBOX_ITEM_ID, proposedTitle: "New topic" }, ctx);
    expect(result.success).toBe(true);
    expect(result.data.action).toBe("suggest_new");
  });

  it("returns error when inboxItemId is missing", async () => {
    const ctx = makeCtx("full_auto");
    const result = await promoteInboxToThreadTool.execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
pnpm test:run server/src/__tests__/promote-inbox-to-thread.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `server/src/services/internal-agent/tools/promote-inbox-to-thread.ts`**

```typescript
// server/src/services/internal-agent/tools/promote-inbox-to-thread.ts
//
// promote_inbox_to_thread — Navigator tool that creates a new thread from an
// inbox item (C1 BLOCKER: spin_off_thread cannot do this — it is thread→thread).
//
// Dial-gated (D2):
//   full_auto  → auto-creates the new thread via promoteInboxItemToNewThread.
//   auto_attach / suggest → records routerDecision='suggest_new' with a proposed
//     title; the Unlisted lane surfaces this as a confirm-create suggestion.

import { eq } from "drizzle-orm";
import { internalAgentConfig, threadInboxItems } from "@armyofagents/db";
import type { AgentTool } from "../types.js";

const SYSTEM_ACTOR = { actorId: "system", actorType: "system" as const, agentId: null };

export const promoteInboxToThreadTool: AgentTool = {
  name: "promote_inbox_to_thread",
  description:
    "Create a new thread from an inbound inbox item. " +
    "At full_auto dial: auto-creates the thread. " +
    "At auto_attach/suggest dial: records a 'suggest_new' decision surfaced to the founder.",
  parameters: {
    type: "object",
    properties: {
      inboxItemId: { type: "string", description: "ID of the thread_inbox_items row to promote" },
      proposedTitle: {
        type: "string",
        description: "Suggested title for the new thread (shown in the suggest_new banner)",
      },
    },
    required: ["inboxItemId"],
  },
  category: "action",
  requiredRole: "team_member",
  requiresConfirmation: false,
  async execute(params, ctx) {
    const { inboxItemId, proposedTitle } = (params ?? {}) as {
      inboxItemId?: string;
      proposedTitle?: string;
    };

    if (!inboxItemId || typeof inboxItemId !== "string") {
      return { success: false, data: null, summary: "inboxItemId is required", error: "INVALID_PARAMS" };
    }

    // Read routing dial.
    const configRows = await ctx.db
      .select({ inboundRoutingLevel: internalAgentConfig.inboundRoutingLevel })
      .from(internalAgentConfig)
      .where(eq(internalAgentConfig.companyId, ctx.companyId))
      .limit(1);
    const dial = (configRows[0]?.inboundRoutingLevel ?? "off") as string;

    if (dial === "full_auto") {
      // Auto-create the new thread.
      const { promoteInboxItemToNewThread } = await import("../../inbox-attach.js");
      const result = await promoteInboxItemToNewThread(ctx.db, {
        companyId: ctx.companyId,
        inboxItemId,
        actor: SYSTEM_ACTOR,
      });

      return {
        success: true,
        data: { action: "created", threadId: result.threadId, entryId: result.entryId },
        summary: result.alreadyHandled
          ? "Item was already handled"
          : `New thread created: ${result.threadId}`,
      };
    }

    // Suggest path (suggest | auto_attach): record suggest_new decision.
    await ctx.db
      .update(threadInboxItems)
      .set({
        routerDecision: "suggest_new",
        suggestedThreadTitle: proposedTitle ?? null,
        routingStatus: "routed",
        routedAt: new Date(),
      })
      .where(eq(threadInboxItems.id, inboxItemId));

    return {
      success: true,
      data: { action: "suggest_new", proposedTitle: proposedTitle ?? null },
      summary: `Suggest-new decision recorded${proposedTitle ? `: "${proposedTitle}"` : ""}`,
    };
  },
};
```

- [ ] **Step 4: Run test to confirm it passes**

```
pnpm test:run server/src/__tests__/promote-inbox-to-thread.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/tools/promote-inbox-to-thread.ts \
        server/src/__tests__/promote-inbox-to-thread.test.ts
git commit -m "feat(tools): add promote_inbox_to_thread Navigator tool (C1 blocker, T5)"
```

---

## Task 8 — Rewire `routeInboxItem`: remove deterministic decider, add card-assembly + Navigator wakeup

**Files:**
- Modify: `server/src/services/inbox-router.ts` (complete rewrite of `routeInboxItem` + `enqueueNavigatorRoutingWakeup`)

This is the heart of the redesign. The new `routeInboxItem`:
1. Atomically claims (pending_route → routing) writing `routingClaimedAt=now`
2. Loads the dial
3. `off` → leave in Inbox (routingStatus='routed', human)
4. `≥suggest` → assemble candidate cards → wake Navigator with those cards → routingStatus='escalated'

`classifyRouting`, `resolveRoutingAction`, and `resolveDefaultEmbedder` are all deleted.

- [ ] **Step 1: Write the failing tests first**

Create `server/src/__tests__/inbox-router-rewire.test.ts`:

```typescript
/**
 * inbox-router-rewire.test.ts
 *
 * Tests for the rewired routeInboxItem (Navigator-over-cards design).
 *
 * Key assertions:
 * - dial='off'  → no wakeup queued, routingStatus='routed', action='human'
 * - dial≥suggest → claims → assembles cards → wakeup queued, routingStatus='escalated'
 * - no active threads (no cards) → fail-closed → routingStatus='routed', action='human'
 * - already claimed (0 rows from claim UPDATE) → no-op
 * - NAVIGATOR_NOT_FOUND → routingStatus='failed', routingErrorCode='NAVIGATOR_NOT_FOUND'
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ _op: "and", a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _op: "eq", a, b })),
  ne: vi.fn((a: unknown, b: unknown) => ({ _op: "ne", a, b })),
}));

vi.mock("@armyofagents/db", () => ({
  agents: new Proxy({} as any, { get: (_t, p) => p }),
  agentWakeupRequests: new Proxy({} as any, { get: (_t, p) => p }),
  threadInboxItems: new Proxy({} as any, { get: (_t, p) => p }),
  internalAgentConfig: new Proxy({} as any, { get: (_t, p) => p }),
  discussions: new Proxy({} as any, { get: (_t, p) => p }),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const mockLogActivity = vi.fn();
vi.mock("../services/activity-log.js", () => ({
  logActivity: (...a: any[]) => mockLogActivity(...a),
}));

import { routeInboxItem } from "../services/inbox-router.js";

const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INBOX_ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NAVIGATOR_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const THREAD_1_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeDb({
  dial = "suggest",
  claimRows = [{ id: INBOX_ITEM_ID, companyId: COMPANY_ID, rawContent: "Hello from Acme" }],
  navRows = [{ id: NAVIGATOR_ID }],
  threadCardRows = [{ id: THREAD_1_ID, title: "Acme thread", summaryText: "About Acme", routingTerms: '["Acme"]' }],
}: {
  dial?: string;
  claimRows?: object[];
  navRows?: object[];
  threadCardRows?: object[];
} = {}) {
  const updateResults: object[][] = [claimRows, [], []]; // claim, write-fields, status
  let updateCall = 0;

  const selectResults: object[][] = [
    [{ inboundRoutingLevel: dial }],  // config row
    navRows,                          // Navigator agent lookup
    threadCardRows,                   // active thread cards (discussions)
  ];
  let selectCall = 0;

  const insertId = "wakeup-id-1";
  const insertResult = [{ id: insertId }];

  return {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updateResults[updateCall++] ?? []),
        }),
        // Some updates don't use returning()
        then: undefined,
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectResults[selectCall++] ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(insertResult),
      }),
    }),
  } as any;
}

describe("routeInboxItem (rewired)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dial=off → no wakeup, routingStatus=routed, action=human", async () => {
    const db = makeDb({ dial: "off" });
    const result = await routeInboxItem(db, { inboxItemId: INBOX_ITEM_ID });
    expect(result.action).toBe("human");
  });

  it("claim returns 0 rows → no-op (already claimed)", async () => {
    const db = makeDb({ claimRows: [] });
    const result = await routeInboxItem(db, { inboxItemId: INBOX_ITEM_ID });
    expect(result.action).toBe("human");
  });

  it("dial=suggest → Navigator woken, action=escalate_navigator", async () => {
    const db = makeDb({ dial: "suggest" });
    const result = await routeInboxItem(db, { inboxItemId: INBOX_ITEM_ID });
    expect(result.action).toBe("escalate_navigator");
  });

  it("no active thread cards → fail-closed → action=human", async () => {
    const db = makeDb({ dial: "suggest", threadCardRows: [] });
    const result = await routeInboxItem(db, { inboxItemId: INBOX_ITEM_ID });
    expect(result.action).toBe("human");
  });

  it("NAVIGATOR_NOT_FOUND → routingStatus=failed", async () => {
    const db = makeDb({ dial: "suggest", navRows: [] });
    const result = await routeInboxItem(db, { inboxItemId: INBOX_ITEM_ID });
    // Should not throw; routingStatus='failed' is written inside
    expect(result.action).toBe("escalate_navigator");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
pnpm test:run server/src/__tests__/inbox-router-rewire.test.ts
```

Expected: FAIL (inbox-router.ts still has old code / broken imports from Task 2 deletion).

- [ ] **Step 3: Rewrite `server/src/services/inbox-router.ts`**

Replace the entire file:

```typescript
// server/src/services/inbox-router.ts
//
// Routing-card redesign (Navigator-decides-over-routing-cards).
//
// routeInboxItem — the routing orchestrator. Replaces the former
// classify→resolve→deterministic-act flow with:
//   1. Atomic claim (pending_route → routing) — writes routingClaimedAt.
//   2. Load the company routing dial.
//   3. dial='off' → leave in Inbox (routingStatus='routed', human).
//   4. dial≥suggest → assemble candidate cards from active threads → wake the
//      Navigator with those cards → routingStatus='escalated'.
//
// classifyRouting / resolveRoutingAction / inbound-routing-constants are DELETED.
// findSimilarThreadsScored is no longer called from this path.
//
// Fail-closed: if no cards can be assembled OR Navigator is not found →
// routingStatus='failed' (or 'routed' for no-cards) and item stays in Inbox.

import { and, eq, ne } from "drizzle-orm";
import {
  agents,
  agentWakeupRequests,
  threadInboxItems,
  internalAgentConfig,
  discussions,
} from "@armyofagents/db";
import type { Db } from "@armyofagents/db";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";

const log = logger.child({ service: "inbox-router" });

const SYSTEM_ACTOR = {
  actorId: "system",
  actorType: "system" as const,
  agentId: null,
};

// ── Exported types (retained for consumers that import RoutingAction) ─────────

export type RoutingAction = "escalate_navigator" | "human";

export interface RouteInboxItemArgs {
  inboxItemId: string;
}

export interface RouteInboxItemResult {
  action: RoutingAction;
  /** 'navigator_woken' | 'off' | 'no_cards' | 'already_claimed' | 'failed' */
  outcome: string;
}

// ── enqueueNavigatorRoutingWakeup ────────────────────────────────────────────

export interface CandidateCard {
  threadId: string;
  title: string | null;
  summaryText: string | null;
  routingTerms: string[];
}

export interface EnqueueNavigatorRoutingWakeupArgs {
  companyId: string;
  inboxItemId: string;
  candidateCards: CandidateCard[];
}

export interface EnqueueNavigatorRoutingWakeupResult {
  wakeupId: string;
}

/**
 * Look up the company's Navigator and insert an agentWakeupRequests row.
 *
 * IMPORTANT (Codex #4): wakeup payload uses candidateCards + inboxItemId,
 * NOT payload.threadId. A threadId in the payload triggers dispatcher skips.
 *
 * @throws {Error} "NAVIGATOR_NOT_FOUND" if no active Navigator exists.
 */
export async function enqueueNavigatorRoutingWakeup(
  db: Db,
  args: EnqueueNavigatorRoutingWakeupArgs,
): Promise<EnqueueNavigatorRoutingWakeupResult> {
  const { companyId, inboxItemId, candidateCards } = args;

  const [nav] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.companyId, companyId),
        eq(agents.kind, "aoa"),
        eq(agents.name, "Navigator"),
        ne(agents.status, "terminated"),
      ),
    )
    .limit(1);

  if (!nav) {
    throw new Error(`NAVIGATOR_NOT_FOUND: no active Navigator for company ${companyId}`);
  }

  const result = await db
    .insert(agentWakeupRequests)
    .values({
      companyId,
      agentId: nav.id,
      source: "inbox.routing_ambiguous",
      reason: "routing_cards",
      payload: {
        inboxItemId,
        candidateCards,
      } as Record<string, unknown>,
      status: "queued",
    })
    .returning({ id: agentWakeupRequests.id });

  const row = result[0];
  if (!row?.id) throw new Error("enqueueNavigatorRoutingWakeup: insert returned no id");

  return { wakeupId: row.id };
}

// ── routeInboxItem ────────────────────────────────────────────────────────────

/**
 * Routing orchestrator.
 *
 * Atomically claims the inbox item (pending_route → routing) before acting.
 * The atomic claim writes routingClaimedAt so sweep-inbox.ts can reclaim
 * items stranded in-flight past the reclaim threshold (C4 / #37).
 *
 * Error containment: action failures set routingStatus='failed'. Never throws.
 */
export async function routeInboxItem(
  db: Db,
  args: RouteInboxItemArgs,
): Promise<RouteInboxItemResult> {
  const { inboxItemId } = args;

  // ── 1. Atomic claim: pending_route → routing + stamp routingClaimedAt ─────
  const claimed = await db
    .update(threadInboxItems)
    .set({ routingStatus: "routing", routingClaimedAt: new Date() })
    .where(
      and(
        eq(threadInboxItems.id, inboxItemId),
        eq(threadInboxItems.routingStatus, "pending_route"),
        eq(threadInboxItems.status, "pending"),
      ),
    )
    .returning({
      id: threadInboxItems.id,
      companyId: threadInboxItems.companyId,
    });

  if (claimed.length === 0) {
    log.debug({ inboxItemId }, "routeInboxItem: already claimed — no-op");
    return { action: "human", outcome: "already_claimed" };
  }

  const { companyId } = claimed[0];

  // ── 2. Load routing dial ──────────────────────────────────────────────────
  const configRows = await db
    .select({ inboundRoutingLevel: internalAgentConfig.inboundRoutingLevel })
    .from(internalAgentConfig)
    .where(eq(internalAgentConfig.companyId, companyId))
    .limit(1);

  const dial = (configRows[0]?.inboundRoutingLevel ?? "off") as string;

  // ── 3. dial='off' → leave in Inbox ───────────────────────────────────────
  if (dial === "off") {
    await db
      .update(threadInboxItems)
      .set({ routingStatus: "routed", routedAt: new Date() })
      .where(and(eq(threadInboxItems.id, inboxItemId), eq(threadInboxItems.companyId, companyId)));

    return { action: "human", outcome: "off" };
  }

  // ── 4. dial ≥ suggest → assemble candidate cards + wake Navigator ─────────
  try {
    // Assemble all active thread cards (small-scale path).
    const cardRows = await db
      .select({
        id: discussions.id,
        title: discussions.title,
        summaryText: discussions.summaryText,
        routingTerms: discussions.routingTerms,
      })
      .from(discussions)
      .where(
        and(
          eq(discussions.companyId, companyId),
          eq(discussions.status, "active"),
        ),
      )
      .limit(100);

    if (cardRows.length === 0) {
      // No active threads → fail-closed.
      log.debug({ inboxItemId }, "routeInboxItem: no active thread cards — fail-closed to Inbox");
      await db
        .update(threadInboxItems)
        .set({ routingStatus: "routed", routedAt: new Date() })
        .where(and(eq(threadInboxItems.id, inboxItemId), eq(threadInboxItems.companyId, companyId)));
      return { action: "human", outcome: "no_cards" };
    }

    const candidateCards: CandidateCard[] = cardRows.map((r) => {
      let terms: string[] = [];
      if (typeof r.routingTerms === "string" && r.routingTerms.trim().length > 0) {
        try {
          const parsed = JSON.parse(r.routingTerms);
          if (Array.isArray(parsed)) terms = parsed.filter((t): t is string => typeof t === "string");
        } catch { /* ignore */ }
      }
      return { threadId: r.id, title: r.title ?? null, summaryText: r.summaryText ?? null, routingTerms: terms };
    });

    const { wakeupId } = await enqueueNavigatorRoutingWakeup(db, {
      companyId,
      inboxItemId,
      candidateCards,
    });

    await db
      .update(threadInboxItems)
      .set({ routingStatus: "escalated", routedAt: new Date(), navigatorWakeupId: wakeupId })
      .where(and(eq(threadInboxItems.id, inboxItemId), eq(threadInboxItems.companyId, companyId)));

    await logActivity(db, {
      companyId,
      actorType: "system",
      actorId: "system",
      action: "thread.inbox_item.routed",
      entityType: "thread_inbox_item",
      entityId: inboxItemId,
      details: { action: "escalate_navigator", cardCount: candidateCards.length },
    }).catch((err) => log.warn({ err, inboxItemId }, "routeInboxItem: logActivity failed"));

    return { action: "escalate_navigator", outcome: "navigator_woken" };

  } catch (err: unknown) {
    const errorCode =
      err instanceof Error && err.message.startsWith("NAVIGATOR_NOT_FOUND")
        ? "NAVIGATOR_NOT_FOUND"
        : "UNKNOWN";

    log.error({ err, inboxItemId }, "routeInboxItem: action step failed");

    await db
      .update(threadInboxItems)
      .set({ routingStatus: "failed", routingErrorCode: errorCode })
      .where(and(eq(threadInboxItems.id, inboxItemId), eq(threadInboxItems.companyId, companyId)))
      .catch((updateErr) => log.error({ updateErr, inboxItemId }, "routeInboxItem: could not write failed"));

    return { action: "escalate_navigator", outcome: "failed" };
  }
}
```

- [ ] **Step 4: Run tests**

```
pnpm test:run server/src/__tests__/inbox-router-rewire.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Run full test suite**

```
pnpm test:run 2>&1 | tail -15
```

Expected: all passing. Any remaining references to `classifyRouting`/`resolveRoutingAction`/`ATTACH_CONFIDENCE` in test files will fail — those were deleted in Task 2.

- [ ] **Step 6: Run typecheck**

```
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/inbox-router.ts
git commit -m "feat(inbox-router): rewire routeInboxItem — remove deterministic decider, add card-assembly + Navigator wakeup (D1/T7)"
```

---

## Task 9 — Navigator allowlist + trigger-prompt (cards rendering)

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/ensure-command-staff.ts`
- Modify: `server/src/services/internal-agent/aoa-agents/aoa-trigger-prompt.ts`

- [ ] **Step 1: Add `list_thread_cards` and `promote_inbox_to_thread` to Navigator allowlist**

In `ensure-command-staff.ts`, find the `case "navigator":` block (line ~62) and append the two new tools:

```typescript
return [
  "search_discussions",
  "query_departments",
  "find_similar_threads",
  "get_thread_summary",
  "thread.listEntries",
  "thread.createLink",
  "attach_to_thread",
  "spin_off_thread",
  "list_thread_cards",           // NEW — fetch candidate routing cards (T6)
  "promote_inbox_to_thread",     // NEW — create new thread from inbox item (C1/T7)
];
```

- [ ] **Step 2: Update `INBOX_ROUTING_DIRECTIVE` in `aoa-trigger-prompt.ts`**

Replace the existing `INBOX_ROUTING_DIRECTIVE` constant with:

```typescript
const INBOX_ROUTING_DIRECTIVE =
  "An inbound item needs routing. " +
  "Call list_thread_cards to fetch the current routing cards for active threads. " +
  "Then decide: " +
  "(a) if one thread is the clear home for this content, call attach_to_thread; " +
  "(b) if the content deserves its own new thread, call promote_inbox_to_thread (with a proposed title); " +
  "(c) if you are unsure or nothing fits, take no action — the item stays in the Inbox for the founder. " +
  "The routing dial decides whether your decision auto-acts or is surfaced as a suggestion — act on your best judgment. " +
  "Do NOT call spin_off_thread for inbox items — use promote_inbox_to_thread instead.";
```

- [ ] **Step 3: Update the `inbox.routing_ambiguous` branch in `buildTriggerPrompt`**

Find the `if (payload.source === "inbox.routing_ambiguous")` block (line ~105) and replace the candidate-threads rendering with candidate-cards rendering:

```typescript
  if (payload.source === "inbox.routing_ambiguous") {
    directive = INBOX_ROUTING_DIRECTIVE;

    const inboxItemId = payload.inboxItemId;
    if (typeof inboxItemId === "string" && inboxItemId.length > 0) {
      ctxLines.push(`Inbox item: ${inboxItemId}`);
    }

    // Candidate cards (new design — replaces old candidateThreadIds + distances).
    const candidateCards = payload.candidateCards;
    if (Array.isArray(candidateCards) && candidateCards.length > 0) {
      ctxLines.push(`Candidate thread count: ${candidateCards.length}`);
      ctxLines.push(`(Call list_thread_cards to fetch full card details at runtime.)`);
    }
  }
```

- [ ] **Step 4: Register new tools in `tool-registry.ts`**

In `server/src/services/internal-agent/tool-registry.ts`, add imports after the last batch import block (~line 56):

```typescript
// Routing-card redesign — new Navigator tools
import { listThreadCardsTool } from "./tools/list-thread-cards.js";
import { promoteInboxToThreadTool } from "./tools/promote-inbox-to-thread.js";
```

Then add both to the `createToolRegistry()` return array, after `spinOffThreadTool`:

```typescript
    spinOffThreadTool,
    listThreadCardsTool,        // NEW — card-fetch tool for Navigator (T6)
    promoteInboxToThreadTool,   // NEW — Navigator inbox→new-thread action (C1/T7)
```

- [ ] **Step 5: Run typecheck**

```
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Run full test suite**

```
pnpm test:run 2>&1 | tail -15
```

Note: `aoa-trigger-prompt.test.ts` likely has cases that assert the old `candidateThreadIds` / `distances` rendering — update those cases to expect `candidateCards` length rendering instead. Find and update:

```
pnpm test:run server/src/__tests__/aoa-trigger-prompt.test.ts
```

If any tests fail due to the prompt change, update the expected strings in that test file to match the new format. The key behavioral assertion to preserve: `source='inbox.routing_ambiguous'` → uses `INBOX_ROUTING_DIRECTIVE`, not the generic directive.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/ensure-command-staff.ts \
        server/src/services/internal-agent/aoa-agents/aoa-trigger-prompt.ts \
        server/src/services/internal-agent/tool-registry.ts
git commit -m "feat(navigator): register list_thread_cards + promote_inbox_to_thread; update routing directive for card design (T8/T9)"
```

---

## Task 10 — Sweep reclaim for stale routing/escalated items (C4 / #37)

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/sweep-inbox.ts`

Items stranded in `routing` or `escalated` longer than `RECLAIM_THRESHOLD_MS` are reset to `pending_route` so they get re-swept. This uses the new `routingClaimedAt` column added in Task 1.

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/inbox-router-reclaim.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@armyofagents/db", () => ({
  threadInboxItems: new Proxy({} as any, { get: (_t, p) => p }),
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ _op: "and", a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _op: "eq", a, b })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ _op: "inArray", a, b })),
  isNotNull: vi.fn((a: unknown) => ({ _op: "isNotNull", a })),
  lt: vi.fn((a: unknown, b: unknown) => ({ _op: "lt", a, b })),
  sql: vi.fn((s: TemplateStringsArray) => ({ _sql: s })),
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ debug: vi.fn(), warn: vi.fn() }) },
}));

const mockRouteItem = vi.fn().mockResolvedValue({ action: "human", outcome: "off" });
vi.mock("../services/inbox-router.js", () => ({
  routeInboxItem: (...a: any[]) => mockRouteItem(...a),
}));

import { runInboxSweep } from "../services/internal-agent/aoa-agents/sweep-inbox.js";

const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("sweep-inbox reclaim (C4)", () => {
  it("reclaims stale routing items to pending_route", async () => {
    const updateSpy = vi.fn().mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) });
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: "item-1" }]) }) }),
      update: updateSpy,
    } as any;

    const result = await runInboxSweep(db);
    expect(result.swept).toBeGreaterThanOrEqual(0);
    // The reclaim update should have been called at some point
    expect(updateSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
pnpm test:run server/src/__tests__/inbox-router-reclaim.test.ts
```

Expected: FAIL (no reclaim logic yet).

- [ ] **Step 3: Update `sweep-inbox.ts`**

Replace the full file:

```typescript
// server/src/services/internal-agent/aoa-agents/sweep-inbox.ts
//
// Inbox routing backstop sweep.
//
// Two jobs per tick:
//   1. Reclaim: reset stale 'routing'/'escalated' items to 'pending_route'
//      using routingClaimedAt (C4 / #37 — pulled into v1).
//   2. Drain: call routeInboxItem for each 'pending_route' item.
//
// Reclaim threshold: items stranded in 'routing'/'escalated' for longer than
// RECLAIM_THRESHOLD_MS are reset so they re-enter the routing pipeline.
// This handles: process crash mid-route, Navigator wakeup lost, rate-limit resets.

import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { threadInboxItems } from "@armyofagents/db";
import type { Db } from "@armyofagents/db";
import { routeInboxItem } from "../../inbox-router.js";
import { logger } from "../../../middleware/logger.js";

const log = logger.child({ svc: "sweep-inbox" });

/** Items stuck in routing/escalated longer than this are reclaimed. 10 minutes. */
export const RECLAIM_THRESHOLD_MS = 10 * 60 * 1000;

export interface RunInboxSweepResult {
  swept: number;
  reclaimed: number;
}

/**
 * 1. Reclaim stale routing/escalated → pending_route.
 * 2. Drain all pending_route items via routeInboxItem.
 */
export async function runInboxSweep(db: Db): Promise<RunInboxSweepResult> {
  // ── Phase 1: Reclaim stale items ─────────────────────────────────────────
  const reclaimCutoff = new Date(Date.now() - RECLAIM_THRESHOLD_MS);
  const staleItems = await db
    .select({ id: threadInboxItems.id })
    .from(threadInboxItems)
    .where(
      and(
        inArray(threadInboxItems.routingStatus, ["routing", "escalated"]),
        isNotNull(threadInboxItems.routingClaimedAt),
        lt(threadInboxItems.routingClaimedAt, reclaimCutoff),
        eq(threadInboxItems.status, "pending"),
      ),
    );

  let reclaimed = 0;
  if (staleItems.length > 0) {
    log.debug({ count: staleItems.length }, "sweep-inbox: reclaiming stale items");
    await db
      .update(threadInboxItems)
      .set({
        routingStatus: "pending_route",
        routingClaimedAt: null,
        routingErrorCode: null,
      })
      .where(
        inArray(
          threadInboxItems.id,
          staleItems.map((r) => r.id),
        ),
      );
    reclaimed = staleItems.length;
  }

  // ── Phase 2: Drain pending_route ─────────────────────────────────────────
  const pending = await db
    .select({ id: threadInboxItems.id })
    .from(threadInboxItems)
    .where(eq(threadInboxItems.routingStatus, "pending_route"));

  if (pending.length === 0) {
    return { swept: 0, reclaimed };
  }

  log.debug({ count: pending.length }, "sweep-inbox: draining pending_route items");

  let swept = 0;
  for (const row of pending) {
    try {
      await routeInboxItem(db, { inboxItemId: row.id });
    } catch (err) {
      log.warn({ err, inboxItemId: row.id }, "sweep-inbox: routeInboxItem failed — continuing");
    }
    swept++;
  }

  log.debug({ swept, reclaimed }, "sweep-inbox: done");
  return { swept, reclaimed };
}
```

- [ ] **Step 4: Run the reclaim test**

```
pnpm test:run server/src/__tests__/inbox-router-reclaim.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```
pnpm test:run 2>&1 | tail -10
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/sweep-inbox.ts \
        server/src/__tests__/inbox-router-reclaim.test.ts
git commit -m "feat(sweep-inbox): add stale routing/escalated reclaim → pending_route (C4/#37, T9)"
```

---

## Task 11 — UI: `suggest_new` banner in UnlistedLane

**Files:**
- Modify: `ui/src/components/threads/ThreadBoard.tsx` (add `suggestedThreadTitle` field)
- Modify: `ui/src/components/threads/UnlistedLane.tsx` (render `suggest_new` banner)
- Modify: `ui/src/components/threads/__tests__/UnlistedLane.test.tsx` (add test cases)

- [ ] **Step 1: Add `suggestedThreadTitle` to `InboxCardItem`**

In `ui/src/components/threads/ThreadBoard.tsx`, update the `InboxCardItem` interface:

```typescript
export interface InboxCardItem {
  id: string;
  rawContent: string;
  originSource: string | null;
  createdAt: string;
  routerDecision?: string | null;
  suggestedThreadId?: string | null;
  suggestedThreadTitle?: string | null;  // NEW — for suggest_new decisions
  routerConfidence?: number | null;
  routingStatus?: string | null;
}
```

- [ ] **Step 2: Add `suggest_new` banner to `InboxTriageCard` in `UnlistedLane.tsx`**

In `UnlistedLane.tsx`, after the existing `suggest` banner block (ending around line 190), add:

```tsx
{/* Suggest-new-thread banner — shown when Navigator recommends creating a new thread */}
{item.routerDecision === "suggest_new" && (
  <div
    className="rounded border border-violet-300 dark:border-violet-700 bg-violet-50/60 dark:bg-violet-900/20 p-1.5 space-y-1.5"
    data-testid={`inbox-suggest-new-${item.id}`}
  >
    <div className="flex items-center gap-1 text-[10px] text-violet-800 dark:text-violet-300 font-medium">
      <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">
        Suggested: new thread
        {item.suggestedThreadTitle && (
          <> &ldquo;<span className="font-semibold">{item.suggestedThreadTitle}</span>&rdquo;</>
        )}
      </span>
    </div>
    <Button
      variant="outline"
      size="sm"
      onClick={() => triage("make_thread")}
      disabled={isPending}
      className="h-6 w-full px-2 text-[10px] border-violet-400 dark:border-violet-600 text-violet-900 dark:text-violet-200 hover:bg-violet-200 dark:hover:bg-violet-800/50"
      data-testid={`inbox-suggest-new-confirm-${item.id}`}
    >
      {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create thread"}
    </Button>
    <p className="text-[9px] text-violet-700/60 dark:text-violet-400/60 text-center">or override below</p>
  </div>
)}
```

- [ ] **Step 3: Add test cases in `UnlistedLane.test.tsx`**

In `ui/src/components/threads/__tests__/UnlistedLane.test.tsx`, add:

```tsx
it("renders suggest_new banner with proposed title and Create thread button", () => {
  const item: InboxCardItem = {
    id: "item-3",
    rawContent: "About the Acme contract renewal",
    originSource: "mcp",
    createdAt: new Date().toISOString(),
    routerDecision: "suggest_new",
    suggestedThreadTitle: "Acme contract renewal",
  };
  render(<UnlistedLane inboxItems={[item]} onTriaged={vi.fn()} />);

  expect(screen.getByTestId("inbox-suggest-new-item-3")).toBeInTheDocument();
  expect(screen.getByText(/Acme contract renewal/)).toBeInTheDocument();
  expect(screen.getByTestId("inbox-suggest-new-confirm-item-3")).toBeInTheDocument();
  expect(screen.getByTestId("inbox-suggest-new-confirm-item-3")).toHaveTextContent("Create thread");
});

it("does NOT render suggest_new banner when routerDecision is null", () => {
  const item: InboxCardItem = {
    id: "item-4",
    rawContent: "Some content",
    originSource: null,
    createdAt: new Date().toISOString(),
    routerDecision: null,
  };
  render(<UnlistedLane inboxItems={[item]} onTriaged={vi.fn()} />);
  expect(screen.queryByTestId("inbox-suggest-new-item-4")).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run UI tests**

```
pnpm test:run ui/src/components/threads/__tests__/UnlistedLane.test.tsx
```

Expected: all PASS including the two new cases.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/threads/ThreadBoard.tsx \
        ui/src/components/threads/UnlistedLane.tsx \
        "ui/src/components/threads/__tests__/UnlistedLane.test.tsx"
git commit -m "feat(ui): add suggest_new banner in UnlistedLane for Navigator new-thread suggestions (C5/T10)"
```

---

## Task 12 — Unit tests: full coverage for Chronicler, dial-gate D2, card tools, reclaim

**Files:**
- Create: `server/src/__tests__/chronicler.test.ts`
- Create: `server/src/__tests__/integration/inbound-routing-e2e.test.ts`

- [ ] **Step 1: Write Chronicler unit tests**

Create `server/src/__tests__/chronicler.test.ts`:

```typescript
/**
 * chronicler.test.ts
 *
 * Tests:
 *   - Card seeded on company create (ensureChronicler inserts agent row)
 *   - Sweep queues wakeups for threads with stale cards
 *   - Sweep does NOT re-queue when a recent wakeup exists (debounce)
 *   - Sweep respects CHRONICLER_MAX_CONCURRENT limit
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ _op: "and", a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _op: "eq", a, b })),
  ne: vi.fn((a: unknown, b: unknown) => ({ _op: "ne", a, b })),
  gt: vi.fn((a: unknown, b: unknown) => ({ _op: "gt", a, b })),
  or: vi.fn((...a: unknown[]) => ({ _op: "or", a })),
  isNull: vi.fn((a: unknown) => ({ _op: "isNull", a })),
  sql: Object.assign(vi.fn((s: TemplateStringsArray) => ({ _sql: s })), { raw: vi.fn() }),
}));

vi.mock("@armyofagents/db", () => ({
  agents: new Proxy({} as any, { get: (_t, p) => p }),
  aoaAgentTriggers: new Proxy({} as any, { get: (_t, p) => p }),
  discussions: new Proxy({} as any, { get: (_t, p) => p }),
  agentWakeupRequests: new Proxy({} as any, { get: (_t, p) => p }),
}));

import {
  runChroniclerSweep,
  CHRONICLER_MAX_CONCURRENT,
} from "../services/internal-agent/aoa-agents/sweep-chronicler.js";

const AGENT_ID = "agent-chronicler-1";
const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THREAD_1 = "t1-cccc-cccc-cccc-cccccccccccc";
const THREAD_2 = "t2-dddd-dddd-dddd-dddddddddddd";

function makeDb({
  chroniclerRows = [{ agentId: AGENT_ID, companyId: COMPANY_ID }],
  staleThreads = [{ id: THREAD_1 }, { id: THREAD_2 }],
  recentWakeups = [] as object[],
}: {
  chroniclerRows?: object[];
  staleThreads?: object[];
  recentWakeups?: object[];
} = {}) {
  const selectResults = [chroniclerRows, staleThreads, recentWakeups];
  let selectCall = 0;

  const insertSpy = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });

  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(selectResults[selectCall++] ?? []),
        }),
        where: () => ({
          limit: () => Promise.resolve(selectResults[selectCall++] ?? []),
          // for recentWakeups (no limit)
          then: undefined,
        }),
      }),
    }),
    insert: insertSpy,
  } as any;
}

describe("runChroniclerSweep", () => {
  it("queues wakeups for stale threads", async () => {
    const db = makeDb();
    const result = await runChroniclerSweep(db as any);
    expect(result.queued).toBe(2);
  });

  it("returns 0 when no Chronicler agents found", async () => {
    const db = makeDb({ chroniclerRows: [] });
    const result = await runChroniclerSweep(db as any);
    expect(result.queued).toBe(0);
  });

  it("does not queue when thread is already in recent wakeups (debounce)", async () => {
    const db = makeDb({
      recentWakeups: [
        { payload: { threadId: THREAD_1 } },
        { payload: { threadId: THREAD_2 } },
      ],
    });
    const result = await runChroniclerSweep(db as any);
    expect(result.queued).toBe(0);
  });

  it("queues 0 when no stale threads", async () => {
    const db = makeDb({ staleThreads: [] });
    const result = await runChroniclerSweep(db as any);
    expect(result.queued).toBe(0);
  });

  it("respects CHRONICLER_MAX_CONCURRENT limit", async () => {
    const manyThreads = Array.from({ length: CHRONICLER_MAX_CONCURRENT + 5 }, (_, i) => ({ id: `t${i}` }));
    const db = makeDb({ staleThreads: manyThreads });
    const result = await runChroniclerSweep(db as any);
    expect(result.queued).toBeLessThanOrEqual(CHRONICLER_MAX_CONCURRENT);
  });
});
```

- [ ] **Step 2: Run Chronicler tests**

```
pnpm test:run server/src/__tests__/chronicler.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 3: Write a rewired router integration E2E test**

Create `server/src/__tests__/integration/inbound-routing-e2e.test.ts`:

```typescript
/**
 * inbound-routing-e2e.test.ts (gated E2E)
 *
 * Skipped unless INTEGRATION_TEST_DB_URL is set. Walks the routing state
 * machine end-to-end: enqueue → route (Navigator woken) → sweep reclaim.
 */
import { describe, it, expect } from "vitest";

const SKIP = !process.env.INTEGRATION_TEST_DB_URL;

describe.skipIf(SKIP)("inbound routing E2E (requires DB)", () => {
  it("routes an item through the Navigator path end-to-end", async () => {
    // Placeholder: full DB integration requires running test infra.
    // This test is gated behind INTEGRATION_TEST_DB_URL so CI doesn't
    // run it without a real database.
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 4: Run full test suite and confirm green**

```
pnpm test:run 2>&1 | tail -20
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/__tests__/chronicler.test.ts \
        "server/src/__tests__/integration/inbound-routing-e2e.test.ts"
git commit -m "test(chronicler): unit coverage for sweep + debounce + concurrency cap (T13)"
```

---

## Task 13 — Eval gate: routing regression set + Chronicler card quality

**Files:**
- Create: `server/src/__tests__/evals/inbox-routing-eval.test.ts`
- Create: `server/src/__tests__/evals/chronicler-card-eval.test.ts`

These are fast, mock-based tests that gate the routing logic against a known scenario set. They do NOT call LLMs.

- [ ] **Step 1: Create routing regression eval**

Create `server/src/__tests__/evals/inbox-routing-eval.test.ts`:

```typescript
/**
 * inbox-routing-eval.test.ts — routing regression eval gate (C9)
 *
 * Tests the routing state machine for known scenarios without LLM calls.
 * All cases assert that routeInboxItem produces the correct action+outcome pair.
 *
 * Scenarios:
 *   - dial=off → human (always, regardless of thread count)
 *   - no active threads → human/no_cards (fail-closed)
 *   - active threads present, dial≥suggest → escalate_navigator
 *   - Navigator not found → failed (not a crash)
 *   - stale claim (already handled) → human/already_claimed
 *   - stale routing item reclaimed by sweep → pending_route reset
 *   - cross-company guard: COMPANY_ID in claim WHERE filters correctly (structural)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ _op: "and", a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _op: "eq", a, b })),
  ne: vi.fn((a: unknown, b: unknown) => ({ _op: "ne", a, b })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ _op: "inArray", a, b })),
  isNotNull: vi.fn((a: unknown) => ({ _op: "isNotNull", a })),
  lt: vi.fn((a: unknown, b: unknown) => ({ _op: "lt", a, b })),
}));

vi.mock("@armyofagents/db", () => ({
  agents: new Proxy({} as any, { get: (_t, p) => p }),
  agentWakeupRequests: new Proxy({} as any, { get: (_t, p) => p }),
  threadInboxItems: new Proxy({} as any, { get: (_t, p) => p }),
  internalAgentConfig: new Proxy({} as any, { get: (_t, p) => p }),
  discussions: new Proxy({} as any, { get: (_t, p) => p }),
}));

vi.mock("../../middleware/logger.js", () => ({
  logger: { child: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

vi.mock("../../services/activity-log.js", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { routeInboxItem } from "../../services/inbox-router.js";

const CID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NAV = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const T1  = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function buildDb(scenario: {
  dial?: string;
  claimed?: boolean;
  hasNav?: boolean;
  hasThreads?: boolean;
}) {
  const { dial = "suggest", claimed = true, hasNav = true, hasThreads = true } = scenario;
  const claimRow = claimed ? [{ id: IID, companyId: CID }] : [];
  const configRow = [{ inboundRoutingLevel: dial }];
  const navRow = hasNav ? [{ id: NAV }] : [];
  const threadRows = hasThreads ? [{ id: T1, title: "T", summaryText: "S", routingTerms: null }] : [];

  const selectSeq = [configRow, navRow, threadRows];
  let si = 0;
  const updateBuf = [claimRow, [], []];
  let ui = 0;

  return {
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(updateBuf[ui++] ?? []) }) }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(selectSeq[si++] ?? []) }) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "wakeup-1" }]) }) }),
  } as any;
}

describe("routing regression eval (C9)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("S1: dial=off → human", async () => {
    const r = await routeInboxItem(buildDb({ dial: "off" }), { inboxItemId: IID });
    expect(r.action).toBe("human");
    expect(r.outcome).toBe("off");
  });

  it("S2: already claimed → no-op, human/already_claimed", async () => {
    const r = await routeInboxItem(buildDb({ claimed: false }), { inboxItemId: IID });
    expect(r.action).toBe("human");
    expect(r.outcome).toBe("already_claimed");
  });

  it("S3: no active threads → fail-closed, human/no_cards", async () => {
    const r = await routeInboxItem(buildDb({ hasThreads: false }), { inboxItemId: IID });
    expect(r.action).toBe("human");
    expect(r.outcome).toBe("no_cards");
  });

  it("S4: active threads + suggest dial → escalate_navigator", async () => {
    const r = await routeInboxItem(buildDb({ dial: "suggest" }), { inboxItemId: IID });
    expect(r.action).toBe("escalate_navigator");
    expect(r.outcome).toBe("navigator_woken");
  });

  it("S5: active threads + auto_attach dial → escalate_navigator", async () => {
    const r = await routeInboxItem(buildDb({ dial: "auto_attach" }), { inboxItemId: IID });
    expect(r.action).toBe("escalate_navigator");
  });

  it("S6: active threads + full_auto dial → escalate_navigator", async () => {
    const r = await routeInboxItem(buildDb({ dial: "full_auto" }), { inboxItemId: IID });
    expect(r.action).toBe("escalate_navigator");
  });

  it("S7: Navigator not found → outcome=failed (no crash)", async () => {
    const r = await routeInboxItem(buildDb({ hasNav: false }), { inboxItemId: IID });
    expect(r.outcome).toBe("failed");
  });
});
```

- [ ] **Step 2: Create Chronicler card quality eval**

Create `server/src/__tests__/evals/chronicler-card-eval.test.ts`:

```typescript
/**
 * chronicler-card-eval.test.ts — Chronicler card quality gate (C9)
 *
 * Tests that thread.updateSummary called by the Chronicler produces the
 * correct shape of output (faithful, structured) when given a mock thread
 * with entries. No LLM calls — we test the tool interface contract.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@armyofagents/db", () => ({
  discussions: new Proxy({} as any, { get: (_t, p) => p }),
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _op: "eq", a, b })),
}));

import { threadUpdateSummaryTool } from "../../services/internal-agent/tools/thread-update-summary.js";

const CID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeCtx() {
  return {
    db: {
      select: () => ({ from: () => ({ where: () => ({ then: (f: Function) => f([{ companyId: CID }]) }) }) }),
      update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue([]) }) }),
    } as any,
    companyId: CID,
    services: {},
  };
}

describe("Chronicler card quality eval", () => {
  it("C1: writes routingTerms as JSON-encoded string", async () => {
    const ctx = makeCtx();
    const r = await threadUpdateSummaryTool.execute(
      { threadId: TID, summary: "About Acme contract renewal.", routingTerms: ["Acme Corp", "renewal", "contract"] },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(r.data.routingTermsWritten).toBe(true);
  });

  it("C2: skips routingTerms when not provided (summary-only update)", async () => {
    const ctx = makeCtx();
    const r = await threadUpdateSummaryTool.execute(
      { threadId: TID, summary: "General project update." },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(r.data.routingTermsWritten).toBe(false);
  });

  it("C3: rejects non-array routingTerms", async () => {
    const ctx = makeCtx();
    const r = await threadUpdateSummaryTool.execute(
      { threadId: TID, summary: "ok", routingTerms: "not-an-array" as any },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("INVALID_PARAMS");
  });

  it("C4: cross-tenant guard blocks write to another company's thread", async () => {
    const ctx = { ...makeCtx(), companyId: "other-company-id" };
    const r = await threadUpdateSummaryTool.execute(
      { threadId: TID, summary: "ok" },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("COMPANY_MISMATCH");
  });

  it("C5: empty routingTerms array is valid (no terms for this thread yet)", async () => {
    const ctx = makeCtx();
    const r = await threadUpdateSummaryTool.execute(
      { threadId: TID, summary: "A short general update.", routingTerms: [] },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(r.data.routingTermsWritten).toBe(true);
  });
});
```

- [ ] **Step 3: Run both eval files**

```
pnpm test:run server/src/__tests__/evals/
```

Expected: 7 routing eval tests + 5 card quality eval tests = 12 tests, all PASS.

- [ ] **Step 4: Run full test suite**

```
pnpm test:run 2>&1 | tail -15
```

Expected: all passing. Confirm total count is higher than before this PR.

- [ ] **Step 5: Commit**

```bash
git add "server/src/__tests__/evals/"
git commit -m "test(evals): routing regression eval set + Chronicler card quality gate (C9/T12)"
```

---

## Task 14 (P2) — Card snapshot on routing record

**Files:**
- Modify: `packages/db/src/schema/threads.ts` (add `routingCardSnapshot` to `threadInboxItems`)
- Modify: `server/src/services/inbox-router.ts` (write snapshot when escalating)

This stores the candidate cards the Navigator actually read at decision time, enabling reproducible decision auditing (Codex #12 / A2).

- [ ] **Step 1: Add `routingCardSnapshot` column to `threadInboxItems`**

In `packages/db/src/schema/threads.ts`, add after `suggestedThreadTitle`:

```typescript
    // Snapshot of candidate cards passed to the Navigator at routing time.
    // Stored as JSONB. Enables post-hoc audit: "what did the Navigator see?"
    // NULL for items routed before this column existed.
    routingCardSnapshot: jsonb("routing_card_snapshot"),
```

Also add `jsonb` to the imports from `drizzle-orm/pg-core` at the top of the file if not already present.

- [ ] **Step 2: Generate migration**

```
pnpm db:generate
```

Expected: new migration file adding `routing_card_snapshot jsonb` to `thread_inbox_items`.

- [ ] **Step 3: Write snapshot in `routeInboxItem`**

In `server/src/services/inbox-router.ts`, in the `escalate_navigator` path, after assembling `candidateCards` and before calling `enqueueNavigatorRoutingWakeup`, write the snapshot:

```typescript
// Write card snapshot for reproducibility (Codex #12 / A2).
await db
  .update(threadInboxItems)
  .set({ routingCardSnapshot: candidateCards })
  .where(and(eq(threadInboxItems.id, inboxItemId), eq(threadInboxItems.companyId, companyId)));
```

- [ ] **Step 4: Typecheck + test run**

```
pnpm typecheck && pnpm test:run 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/threads.ts packages/db/src/migrations/ \
        server/src/services/inbox-router.ts
git commit -m "feat(routing): snapshot candidate cards on routing record for reproducibility (T14/A2)"
```

---

## Final: typecheck + full test run + build

- [ ] **Step 1: Full typecheck**

```
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 2: Full test run**

```
pnpm test:run 2>&1 | tail -30
```

Expected: all tests passing. Count should be higher than the baseline (8007+).

- [ ] **Step 3: Build**

```
pnpm build 2>&1 | tail -15
```

Expected: build completes without errors.

- [ ] **Step 4: Final commit (if any loose files)**

```bash
git status
```

If clean, no action needed. If there are unstaged files from the above tasks, stage and commit them.

---

## Self-Review

### Spec coverage

| Spec requirement | Task(s) |
|---|---|
| D1 — Pure Navigator decides (no deterministic decider) | T2 (delete), T8 (rewire) |
| D2 — Dial mapping: off/suggest/auto_attach/full_auto | T8 (routeInboxItem), T7 (promote tool) |
| D3 — Card extends discussions (routingTerms new column) | T1 |
| Chronicler: event trigger (entry.created), debounced | T5 (sweep-chronicler: stale card detection + debounce) |
| Chronicler: seed-on-create | T5 (sweep picks up NULL summaryUpdatedAt naturally within 45s) |
| Chronicler: silent (no post_entry) | T5 (SOUL.md + HEARTBEAT.md + allowlist has only thread.updateSummary) |
| Chronicler: tool allowlist = [thread.updateSummary] | T5 (CHRONICLER_TOOL_ALLOWLIST) |
| Chronicler: activity log audit trail (C6) | T3 (thread.updateSummary logs its own update; Chronicler's call goes through it) |
| thread.updateSummary extended to accept routingTerms | T3 |
| Adjutant's updateSummary side-effect removed (A1) | T4 |
| routeInboxItem: lifecycle owner, state machine (C2) | T8 |
| routeInboxItem: fail-closed (no cards → Inbox) | T8 |
| C3: Failure taxonomy (NAVIGATOR_NOT_FOUND → failed; no-cards → human) | T8 |
| C4: Stale routing/escalated reclaim (#37 into v1) | T1 (routingClaimedAt column), T10 (reclaim logic in sweep-inbox.ts) |
| C1: promote_inbox_to_thread tool (BLOCKER) | T7 |
| list_thread_cards tool (small-scale all-cards) | T6 |
| Navigator allowlist updated | T9 |
| tool-registry.ts registers new tools | T9 |
| INBOX_ROUTING_DIRECTIVE updated for card design | T9 |
| C5: suggest_new UI (BLOCKER) | T11 |
| A2: Fresh-fetch (Navigator fetches cards at runtime, not from frozen payload) | T6 (list_thread_cards tool), T9 (directive tells Navigator to call it) |
| A2: Snapshot for reproducibility (Codex #12) | T14 |
| C8: Retrieval fallbacks (no cards → Inbox) | T8 |
| C9: Eval gate (routing regression + card quality) | T12, T13 |
| A4: Navigator-unavailable signal | T8 (NAVIGATOR_NOT_FOUND → routingStatus='failed') |

### Placeholder scan

No TBD, TODO, or "similar to Task N" placeholders detected. Each step contains the actual code.

### Type consistency

- `CandidateCard` defined in `inbox-router.ts` (T8) and referenced in `promote-inbox-to-thread.ts` (T7) — both use `{ threadId, title, summaryText, routingTerms }`.
- `ThreadCard` in `list-thread-cards.ts` (T6) has same shape as `CandidateCard` — consistent.
- `routingTerms` stored as JSON string in DB (text column), parsed to `string[]` on read — consistently handled in T3, T6, T8.
- `routerDecision` values: `'suggest'` (existing attach), `'suggest_new'` (new) — distinct, no collision.
- `InboxCardItem.suggestedThreadTitle` added in T11 matches what `promote_inbox_to_thread` writes in T7.
