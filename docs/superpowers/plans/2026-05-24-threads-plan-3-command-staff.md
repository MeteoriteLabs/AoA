# Threads — Plan 3: Command Staff + governance brakes

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. **Prerequisites: Plan 1 (data model) + Plan 2 (thread service) merged.**

**Goal:** Stand up the crew ("Command Staff") as Commander roles, build the missing trigger evaluators, and ship the **governance brakes** required before L2 autonomy is safe: real cost accounting, in-flight kill reaching crew runs, company/thread kill-switch, `autonomyLevel` enforcement, per-role model + extract/classify cost-caps.

**Architecture:** Each role is an `agents.kind='aoa'` row seeded idempotently (mirror `ensure-commander.ts` / `ensure-extraction-agent.ts`), with a `runtimeConfig.aoa.role`, a `toolAllowlist`, and `aoa_agent_triggers` rows. Trigger evaluators extend `triggers.ts` (today only `outbox`). Brakes are added as **pure, testable helpers** (cost, autonomy gate, kill-switch, caps) wired into `runner.ts`, `dispatcher.ts`, `budgets.ts`, and `heartbeat.ts`.

**Tech stack:** Express 5, Drizzle, Vitest. Key existing files (from the codebase map):
- Seeding: `server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts` (`ensureExtractionAgent`, `EXTRACTION_AGENT_NAME`, `EXTRACTION_AGENT_TOOL_ALLOWLIST`), `ensure-commander.ts` (`ensureCommanderAgent`), `seed-commander-bundle.ts` (`seedCommanderInstructionBundle`, `loadDefaultAgentInstructionsBundle`).
- Dispatch/triggers: `dispatcher.ts` (`runAoaDispatch`, 4 phases), `triggers.ts` (`listEnabledOutboxAgents`; kinds recognized: outbox|routine|event|mention — only outbox implemented), `runner.ts` (`runAoaAgent`; cost hardcoded `0¢` at line ~159 via `costService(db).createEvent`).
- Brakes: `budgets.ts` (`budgetService`, `getInvocationBlock` dead at ~314-364), `heartbeat.ts` (`cancelActiveForAgent` ~4802, `cancelBudgetScopeWork` ~4841 — heartbeat_runs only).
- SDK primitives: `providers/index.ts` (`getProviderApiKey`, `createProvider`).
- Locked decisions: agents never write identity/domain memory (#15/#16/#52); Memory Keeper proposes only (status pending).

**Run tests:** `pnpm exec vitest run <path>`.

---

## Task 1: Extend the extraction agent → Scribe

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts`
- Test: `server/src/__tests__/command-staff-seeding.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/__tests__/command-staff-seeding.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SCRIBE_AGENT_NAME,
  SCRIBE_TOOL_ALLOWLIST,
} from "../services/internal-agent/aoa-agents/ensure-extraction-agent.js";

describe("Scribe (extended extraction agent)", () => {
  it("is named Scribe", () => {
    expect(SCRIBE_AGENT_NAME).toBe("Scribe");
  });
  it("can submit extracted items but cannot write memory directly", () => {
    expect(SCRIBE_TOOL_ALLOWLIST).toContain("submit_extracted_items");
    expect(SCRIBE_TOOL_ALLOWLIST).not.toContain("create_memory");
    expect(SCRIBE_TOOL_ALLOWLIST).not.toContain("update_memory");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run server/src/__tests__/command-staff-seeding.test.ts` → FAIL (exports don't exist).

- [ ] **Step 3: Implement** — in `ensure-extraction-agent.ts`, rename the public constants to the Scribe identity while keeping the seeding idempotent (the agent row's `name` lookup must remain stable; if you change the stored name, add a one-time migration of the existing row by old name → new name inside `ensureExtractionAgent`). Export:

```ts
export const SCRIBE_AGENT_NAME = "Scribe";
// Back-compat: the previously-seeded row was named "Discussion Extraction".
export const LEGACY_EXTRACTION_AGENT_NAME = "Discussion Extraction";
export const SCRIBE_TOOL_ALLOWLIST = ["submit_extracted_items"] as const;
```

In `ensureExtractionAgent(db, companyId)`: look up the agent by `SCRIBE_AGENT_NAME` OR `LEGACY_EXTRACTION_AGENT_NAME` (rename the legacy row's `name` → `Scribe` on first run); keep the existing D2 toolAllowlist backfill. Extend the seeded instruction to add the Scribe responsibilities (office-hours interrogate, task-vs-spin-off classification, per-item department tagging, conflict + goal detection) — append these to the instruction string; do not remove existing extraction behaviour.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/ensure-extraction-agent.ts server/src/__tests__/command-staff-seeding.test.ts
git commit -m "feat(command-staff): extend extraction agent into Scribe role"
```

---

## Task 2: Seed Router / Planner / Dispatcher / Memory Keeper

**Files:**
- Create: `server/src/services/internal-agent/aoa-agents/ensure-command-staff.ts`
- Test: `server/src/__tests__/command-staff-seeding.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
import {
  COMMAND_STAFF_ROLES,
  roleToolAllowlist,
} from "../services/internal-agent/aoa-agents/ensure-command-staff.js";

describe("Command Staff roster", () => {
  it("defines the four new roles", () => {
    expect(COMMAND_STAFF_ROLES.map((r) => r.key)).toEqual([
      "router",
      "planner",
      "dispatcher",
      "memory_keeper",
    ]);
  });
  it("Memory Keeper can propose memory but never write identity/domain directly", () => {
    const allow = roleToolAllowlist("memory_keeper");
    expect(allow).toContain("suggest_memory");
    expect(allow).not.toContain("create_memory");
    expect(allow).not.toContain("update_memory");
  });
  it("Dispatcher can create tasks + assign, not write memory", () => {
    const allow = roleToolAllowlist("dispatcher");
    expect(allow).toContain("create_task");
    expect(allow).toContain("assign_task");
    expect(allow).not.toContain("create_memory");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement** — create `ensure-command-staff.ts`, mirroring the seed structure of `ensure-commander.ts` (atomic insert `agents.kind='aoa'` + `runtimeConfig.aoa.role` + `toolAllowlist`; insert `aoa_agent_triggers`; seed an instruction file via the `loadDefaultAgentInstructionsBundle(<role>)` + `seedCommanderInstructionBundle`-style pattern; idempotent D2 backfill). Define the roster + per-role allowlists (default-deny):

```ts
export const COMMAND_STAFF_ROLES = [
  { key: "router", name: "Router", trigger: "mention" },
  { key: "planner", name: "Planner", trigger: "phase-advance" },
  { key: "dispatcher", name: "Dispatcher", trigger: "phase-advance" },
  { key: "memory_keeper", name: "Memory Keeper", trigger: "outbox" },
] as const;

export type CommandStaffRoleKey = (typeof COMMAND_STAFF_ROLES)[number]["key"];

export function roleToolAllowlist(role: CommandStaffRoleKey): string[] {
  switch (role) {
    case "router":
      return ["search_discussions", "query_departments"]; // classify only; no writes
    case "planner":
      return ["search_discussions", "query_tasks", "query_dependency_chain"];
    case "dispatcher":
      return ["create_task", "assign_task", "add_task_dependency", "wakeup_agent", "query_agents"];
    case "memory_keeper":
      return ["suggest_memory", "find_similar_memory", "detect_conflicts"]; // PROPOSE only
  }
}

export async function ensureCommandStaff(db: Db, companyId: string): Promise<void> {
  for (const role of COMMAND_STAFF_ROLES) {
    await ensureRole(db, companyId, role); // mirror ensureCommanderAgent's idempotent insert+backfill
  }
}
```

Implement `ensureRole` following `ensure-commander.ts` exactly (atomic `ON CONFLICT DO NOTHING`, D2 toolAllowlist backfill, instruction bundle seed, trigger row insert). Call `ensureCommandStaff(db, companyId)` from the same place `ensureCommanderAgent`/`ensureExtractionAgent` are called during company bootstrap (find the call site and add it alongside).

> `suggest_memory` must be a tool that writes `memory_items` with `status='pending'` only (never `approved`, never identity/domain). If a `suggest_memory` tool doesn't exist yet, add it mirroring `submit-extracted-items.ts` (a `category:"memory"` tool, `requiredRole:"founder"` for the subagent session) that inserts a pending memory suggestion. Verify against `server/src/services/internal-agent/tools/`.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/ensure-command-staff.ts server/src/__tests__/command-staff-seeding.test.ts
git commit -m "feat(command-staff): seed Router/Planner/Dispatcher/Memory-Keeper roles"
```

---

## Task 3: Memory Keeper proposes-only guard (locked decision #15/#16/#52)

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/ensure-command-staff.ts` (export pure guard)
- Test: `server/src/__tests__/command-staff-memory-guard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { assertCrewMemoryWrite } from "../services/internal-agent/aoa-agents/ensure-command-staff.js";

describe("crew memory write guard", () => {
  it("allows a pending proposal in any layer", () => {
    expect(() => assertCrewMemoryWrite({ layer: "domain", status: "pending" })).not.toThrow();
    expect(() => assertCrewMemoryWrite({ layer: "identity", status: "pending" })).not.toThrow();
  });
  it("rejects any non-pending crew memory write", () => {
    expect(() => assertCrewMemoryWrite({ layer: "working", status: "approved" })).toThrow(/propose/i);
    expect(() => assertCrewMemoryWrite({ layer: "domain", status: "approved" })).toThrow(/propose/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`assertCrewMemoryWrite` missing).

- [ ] **Step 3: Implement** — add the pure guard to `ensure-command-staff.ts`:

```ts
/**
 * Locked decisions #15/#16/#52: the crew can only PROPOSE memory (status 'pending').
 * The founder (or team_lead for active_context) approves. Agents never write
 * identity/domain directly. Throws on any non-pending crew memory write.
 */
export function assertCrewMemoryWrite(item: { layer: string; status: string }): void {
  if (item.status !== "pending") {
    throw new Error(
      `Crew may only propose memory (status 'pending'); refused status '${item.status}' for layer '${item.layer}'`,
    );
  }
}
```

Call `assertCrewMemoryWrite(...)` inside the `suggest_memory` tool's `execute` before insert.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/ensure-command-staff.ts server/src/__tests__/command-staff-memory-guard.test.ts
git commit -m "feat(command-staff): proposes-only memory guard (#15/#16/#52)"
```

---

## Task 4: `autonomyLevel` enforcement (which roles are on duty)

**Files:**
- Create: `server/src/services/internal-agent/aoa-agents/autonomy.ts`
- Test: `server/src/__tests__/crew-autonomy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isRoleActiveAtAutonomy } from "../services/internal-agent/aoa-agents/autonomy.js";

describe("autonomy gate (L1/L2/L3 = crew activation)", () => {
  it("L1: Scribe + Memory Keeper + Curator on; Router/Planner/Dispatcher off", () => {
    expect(isRoleActiveAtAutonomy("scribe", 1)).toBe(true);
    expect(isRoleActiveAtAutonomy("memory_keeper", 1)).toBe(true);
    expect(isRoleActiveAtAutonomy("curator", 1)).toBe(true);
    expect(isRoleActiveAtAutonomy("router", 1)).toBe(false);
    expect(isRoleActiveAtAutonomy("dispatcher", 1)).toBe(false);
  });
  it("L2: adds Router/Planner/Dispatcher", () => {
    expect(isRoleActiveAtAutonomy("router", 2)).toBe(true);
    expect(isRoleActiveAtAutonomy("planner", 2)).toBe(true);
    expect(isRoleActiveAtAutonomy("dispatcher", 2)).toBe(true);
  });
  it("L0 (off): nothing auto-runs", () => {
    expect(isRoleActiveAtAutonomy("scribe", 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement** — create `autonomy.ts`:

```ts
export type CrewRole = "scribe" | "memory_keeper" | "curator" | "router" | "planner" | "dispatcher";

/** Minimum autonomy level at which each role auto-runs. */
const ROLE_MIN_AUTONOMY: Record<CrewRole, number> = {
  scribe: 1,
  memory_keeper: 1,
  curator: 1,
  router: 2,
  planner: 2,
  dispatcher: 2,
};

export function isRoleActiveAtAutonomy(role: CrewRole, level: number): boolean {
  return level >= ROLE_MIN_AUTONOMY[role];
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Wire into dispatch** — in `dispatcher.ts` (`runAoaDispatch`) and the new trigger evaluators (Task 5), before invoking a role, resolve the effective autonomy level (`discussions.autonomyLevel ?? internalAgentConfig.autonomyLevel`) and skip the role if `!isRoleActiveAtAutonomy(role, level)`. (This is the gate that makes the stored `autonomyLevel` actually do something — today it's inert.)

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/autonomy.ts server/src/services/internal-agent/aoa-agents/dispatcher.ts server/src/__tests__/crew-autonomy.test.ts
git commit -m "feat(command-staff): enforce autonomyLevel as crew activation gate"
```

---

## Task 5: Trigger evaluators — mention / phase-advance / routine

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/triggers.ts`
- Modify: `server/src/services/internal-agent/aoa-agents/dispatcher.ts`
- Test: `server/src/__tests__/crew-triggers.test.ts`

- [ ] **Step 1: Write the failing test** — for the pure trigger-matching logic. Create `server/src/__tests__/crew-triggers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { triggerMatchesEvent } from "../services/internal-agent/aoa-agents/triggers.js";

describe("triggerMatchesEvent", () => {
  it("mention trigger fires on an @agent mention event", () => {
    expect(triggerMatchesEvent({ kind: "mention" }, { type: "thread.mention", targetType: "agent" })).toBe(true);
  });
  it("mention trigger does NOT fire on an @human mention", () => {
    expect(triggerMatchesEvent({ kind: "mention" }, { type: "thread.mention", targetType: "user" })).toBe(false);
  });
  it("phase-advance trigger fires on phase change", () => {
    expect(triggerMatchesEvent({ kind: "phase-advance" }, { type: "thread.phase.changed" })).toBe(true);
  });
  it("routine trigger fires on a scheduled tick", () => {
    expect(triggerMatchesEvent({ kind: "routine" }, { type: "routine.tick" })).toBe(true);
  });
  it("outbox trigger is unaffected", () => {
    expect(triggerMatchesEvent({ kind: "outbox" }, { type: "thread.mention", targetType: "agent" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`triggerMatchesEvent` missing).

- [ ] **Step 3: Implement the pure matcher** — add to `triggers.ts`:

```ts
export type TriggerEventInput =
  | { type: "thread.mention"; targetType: "agent" | "user" }
  | { type: "thread.phase.changed" }
  | { type: "routine.tick" }
  | { type: string; targetType?: string };

export function triggerMatchesEvent(trigger: { kind: string }, event: TriggerEventInput): boolean {
  switch (trigger.kind) {
    case "mention":
      return event.type === "thread.mention" && event.targetType === "agent";
    case "phase-advance":
      return event.type === "thread.phase.changed";
    case "routine":
      return event.type === "routine.tick";
    case "outbox":
      return false; // outbox is drained by the durable poll, not event-matched
    default:
      return false;
  }
}
```

- [ ] **Step 4: Wire evaluators into dispatch** — in `dispatcher.ts`, add a phase that, on a thread event, loads enabled triggers (extend `listEnabledOutboxAgents` into a general `listEnabledTriggers(db, companyId)` returning `{ agentId, kind, role }`), filters with `triggerMatchesEvent`, applies the `isRoleActiveAtAutonomy` gate (Task 4), and enqueues `runAoaAgent` for matches. @agent mentions already flow via `delegate-to-subagent` → `agent_wakeup_requests` → Phase 3; the mention evaluator routes a mention to the right worker. @human mentions create a `notifications` row only (no crew run).

- [ ] **Step 5: Run to verify it passes** — PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/triggers.ts server/src/services/internal-agent/aoa-agents/dispatcher.ts server/src/__tests__/crew-triggers.test.ts
git commit -m "feat(command-staff): mention/phase-advance/routine trigger evaluators"
```

---

## Task 6: Real cost accounting (the §4.1 zero-cost stub)

**Files:**
- Create: `server/src/services/internal-agent/cost-model.ts`
- Modify: `server/src/services/internal-agent/aoa-agents/runner.ts` (~line 159)
- Modify: `server/src/services/internal-agent/providers/index.ts` (meter SDK calls)
- Test: `server/src/__tests__/crew-cost-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeCostCents } from "../services/internal-agent/cost-model.js";

describe("computeCostCents", () => {
  it("prices a known model by input/output tokens", () => {
    const c = computeCostCents("anthropic", "claude-sonnet-4-20250514", 1_000_000, 1_000_000);
    expect(c).toBeGreaterThan(0);
  });
  it("returns 0 for zero tokens", () => {
    expect(computeCostCents("anthropic", "claude-sonnet-4-20250514", 0, 0)).toBe(0);
  });
  it("falls back to a default rate for an unknown model (never throws)", () => {
    expect(computeCostCents("anthropic", "unknown-model", 1000, 1000)).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement the pure cost model** — create `cost-model.ts`:

```ts
// Cents per 1M tokens. Extend as models are added; unknown -> DEFAULT_RATE.
const RATES: Record<string, { inputCentsPerM: number; outputCentsPerM: number }> = {
  "claude-sonnet-4-20250514": { inputCentsPerM: 300, outputCentsPerM: 1500 },
  "gpt-4o-mini": { inputCentsPerM: 15, outputCentsPerM: 60 },
};
const DEFAULT_RATE = { inputCentsPerM: 300, outputCentsPerM: 1500 };

export function computeCostCents(
  _provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = RATES[model] ?? DEFAULT_RATE;
  const cents =
    (inputTokens / 1_000_000) * rate.inputCentsPerM +
    (outputTokens / 1_000_000) * rate.outputCentsPerM;
  return Math.round(cents);
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Wire real cost into the SDK path** — in `providers/index.ts`, after each provider chat/extract/classify call that returns token usage, compute `computeCostCents(provider, model, usage.inputTokens, usage.outputTokens)` and record it via `costService(db).createEvent(...)`. In `runner.ts` (~line 159), replace the hardcoded `inputTokens: 0, outputTokens: 0, costCents: 0` with the real usage when the adapter/SDK returns it; for pure CLI-subscription runs with no token usage, record the run with `costCents: 0` but a real `durationMs` (subscription billing has no per-token cost — document this inline). This closes the "budgets never accumulate from crew" gap for the metered SDK primitives.

> Confirm the token-usage shape returned by `createProvider(...)`'s chat method and by the adapter result; use whatever fields exist (e.g., `usage.input_tokens` / `usage.output_tokens`). Do not invent a shape — read the provider return type.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/cost-model.ts server/src/services/internal-agent/aoa-agents/runner.ts server/src/services/internal-agent/providers/index.ts server/src/__tests__/crew-cost-model.test.ts
git commit -m "feat(command-staff): real cost accounting for crew SDK calls (#4.1)"
```

---

## Task 7: In-flight cancellation reaches crew runs

**Files:**
- Modify: `server/src/services/heartbeat.ts` (`cancelActiveForAgent`, `cancelBudgetScopeWork`)
- Test: `server/src/__tests__/crew-cancellation.test.ts`

- [ ] **Step 1: Write the failing test** — a contract test asserting the cancel functions also target `internal_agent_runs`. Create `server/src/__tests__/crew-cancellation.test.ts` mirroring the sequence-mock pattern; assert that `cancelBudgetScopeWork({ companyId, scopeType: "company" })` issues an UPDATE against `internal_agent_runs` (status → cancelled) in addition to `heartbeat_runs`. (Use the mock DB to capture the tables updated.)

- [ ] **Step 2: Run to verify it fails** — FAIL (only `heartbeat_runs` is touched today).

- [ ] **Step 3: Implement** — in `heartbeat.ts`, extend both `cancelActiveForAgent(agentId)` and `cancelBudgetScopeWork(scope)` so that, in addition to cancelling `heartbeat_runs`, they:
  1. UPDATE `internal_agent_runs` SET status='cancelled' for matching `running` crew runs (by agentId / by companyId for the company scope).
  2. Signal the dispatcher's running subprocess for those runs (reuse the existing SIGTERM mechanism already used for heartbeat runs — apply it to the crew run's tracked child process).

Keep the return value (count of cancelled) inclusive of both run types.

> Read the existing SIGTERM/process-tracking code in `heartbeat.ts` and replicate it for crew runs (the dispatcher must track crew subprocess handles so they can be signalled — if it doesn't yet, add a registry in `dispatcher.ts` keyed by run id).

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/heartbeat.ts server/src/services/internal-agent/aoa-agents/dispatcher.ts server/src/__tests__/crew-cancellation.test.ts
git commit -m "feat(command-staff): in-flight cancellation reaches internal_agent_runs"
```

---

## Task 8: Company + thread kill-switch

**Files:**
- Create: `server/src/services/internal-agent/aoa-agents/kill-switch.ts`
- Modify: `server/src/services/internal-agent/aoa-agents/dispatcher.ts`
- Modify: `server/src/routes/discussions.ts` + `server/src/routes/agents.ts` (or company route) — expose toggles
- Test: `server/src/__tests__/crew-killswitch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isCrewPaused } from "../services/internal-agent/aoa-agents/kill-switch.js";

describe("isCrewPaused", () => {
  it("paused when the company crew halt is on", () => {
    expect(isCrewPaused({ companyPaused: true, threadPaused: false })).toBe(true);
  });
  it("paused when the specific thread's crew is paused", () => {
    expect(isCrewPaused({ companyPaused: false, threadPaused: true })).toBe(true);
  });
  it("runs when neither is paused", () => {
    expect(isCrewPaused({ companyPaused: false, threadPaused: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement** — create `kill-switch.ts`:

```ts
export function isCrewPaused(state: { companyPaused: boolean; threadPaused: boolean }): boolean {
  return state.companyPaused || state.threadPaused;
}
```

Persist the flags: company-level on `internal_agent_config` (add a `crewPaused` boolean — schema change, fold into a small migration or reuse an existing config jsonb field), thread-level on `discussions` (reuse a metadata field or add `crew_paused boolean`). In `dispatcher.ts`, before invoking any crew role, load both flags and skip if `isCrewPaused(...)`. Expose two endpoints: `POST /companies/:companyId/crew/pause` (company halt) and `POST /companies/:companyId/discussions/:id/crew/pause` (thread). On company pause, also call `cancelBudgetScopeWork({ companyId, scopeType: "company" })` (Task 7) to stop in-flight runs.

> If you add boolean columns, follow Plan 1's pattern (text/boolean column + `pnpm db:generate`) and keep the migration in this plan's commit.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/kill-switch.ts server/src/services/internal-agent/aoa-agents/dispatcher.ts server/src/routes/discussions.ts server/src/__tests__/crew-killswitch.test.ts
git commit -m "feat(command-staff): company + thread crew kill-switch"
```

---

## Task 9: Per-role model + extract/classify cost-caps

**Files:**
- Create: `server/src/services/internal-agent/cost-caps.ts`
- Modify: `server/src/services/internal-agent/providers/index.ts` (read per-role model + enforce cap)
- Test: `server/src/__tests__/crew-cost-caps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { capExceeded, resolveRoleModel } from "../services/internal-agent/cost-caps.js";

describe("cost caps + per-role model", () => {
  it("capExceeded compares spend vs the per-call cap", () => {
    expect(capExceeded(50, 100)).toBe(false);
    expect(capExceeded(150, 100)).toBe(true);
    expect(capExceeded(10, null)).toBe(false); // no cap configured
  });
  it("resolveRoleModel prefers the role's model, then the company default", () => {
    expect(resolveRoleModel({ roleModel: "gpt-4o-mini", companyDefault: "claude-sonnet-4-20250514" })).toBe("gpt-4o-mini");
    expect(resolveRoleModel({ roleModel: null, companyDefault: "claude-sonnet-4-20250514" })).toBe("claude-sonnet-4-20250514");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement** — create `cost-caps.ts`:

```ts
export function capExceeded(estimatedCents: number, capCents: number | null): boolean {
  if (capCents == null) return false;
  return estimatedCents > capCents;
}

export function resolveRoleModel(input: { roleModel: string | null; companyDefault: string }): string {
  return input.roleModel ?? input.companyDefault;
}
```

Wire `resolveRoleModel(...)` into the extraction/classify call site (read the role's model from `agents.adapterConfig`/`runtimeConfig`, fall back to `internalAgentConfig.model`). Before a metered SDK call, estimate cost with `computeCostCents(...)` (Task 6) on the prompt size and refuse with a clear error if `capExceeded(estimate, roleCapCents)` — `roleCapCents` from config. High-volume batching stays deferred (infra #5).

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/cost-caps.ts server/src/services/internal-agent/providers/index.ts server/src/__tests__/crew-cost-caps.test.ts
git commit -m "feat(command-staff): per-role model choice + extract/classify cost-caps"
```

---

## Done criteria (Plan 3)

- All five roles (Scribe, Router, Planner, Dispatcher, Memory Keeper) seed idempotently; Curator reused.
- `pnpm exec vitest run server/src/__tests__/command-staff-seeding.test.ts crew-autonomy.test.ts crew-triggers.test.ts crew-cost-model.test.ts crew-killswitch.test.ts crew-cost-caps.test.ts command-staff-memory-guard.test.ts crew-cancellation.test.ts` — all PASS.
- `pnpm --filter @armyofagents/server typecheck` — no errors.
- The four §4.1 brakes work: real cost on SDK calls · in-flight kill reaches `internal_agent_runs` · company/thread kill-switch · `autonomyLevel` gate. Memory Keeper proposes-only.

Hand-off: the crew is ready; UI plans (4-7) surface it.

---

## Eng-Review Amendments (2026-05-24)

**D2 — Extraction is core, NOT autonomy-gated.** In Task 4, set Scribe/Memory-Keeper/Curator to always-on; gate only the agentic roles. The autonomy dial controls delegation (route/plan/dispatch), never the text→structure engine.

```ts
const ROLE_MIN_AUTONOMY: Record<CrewRole, number> = {
  scribe: 0,        // core: extraction always runs
  memory_keeper: 0, // core: proposals always run
  curator: 0,       // core: proactive scan always runs
  router: 2,
  planner: 2,
  dispatcher: 2,
};
```

Update the Task 4 test: assert `isRoleActiveAtAutonomy("scribe"|"memory_keeper"|"curator", level)` is `true` for `level` in `{0,1,2}`; agentic roles `false` at 0/1, `true` at 2. (Removes the old "L0: nothing auto-runs" assertion — that was the bug: it would have killed extraction at the default setting.)

**D3 — Run-rate brake for $0 CLI runs.** Cost-based budgets never accumulate for subscription CLI runs, so the cost cap can't stop a runaway loop. Add a run-count brake in Task 9's `cost-caps.ts`:

```ts
/**
 * D3: CLI subscription runs cost $0, so capExceeded can't brake a runaway loop.
 * Cap crew runs per thread per rolling window instead. True => caller skips the run.
 */
export function runRateExceeded(runsInWindow: number, maxRunsPerWindow: number): boolean {
  return runsInWindow >= maxRunsPerWindow;
}
```

Test: `runRateExceeded(3,5)===false`, `runRateExceeded(5,5)===true`. Wire into `dispatcher.ts` before invoking any crew role: count this thread's crew `internal_agent_runs` in the window (e.g., last 10 min) and skip + log if `runRateExceeded(count, cap)`. Default cap is conservative (e.g., 10/10min) and configurable on `internal_agent_config`. This + the company/thread kill-switch (Task 8) are the real brakes for CLI; SDK cost metering (Task 6) handles the $ side.
