# Crew Execution Hardening — Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make crew agent runs observable, hermetic, and correctly skilled — so a crew agent can actually complete a task, and Discussions/Workspace work end-to-end.

**Architecture:** Crew agents (`kind='aoa'`) execute via `runAoaAgent` → `adapter.execute` (claude_local). Today that path (a) discards all logs, (b) inherits the operator's entire `~/.claude` + the repo `CLAUDE.md`, (c) never passes `context.skills`, and (d) never enforces `skillKeys`. The org/heartbeat path already does (a) and (c) correctly — **we mirror the org path rather than invent new mechanisms**, then add hermeticity (which fixes org too) and skill enforcement.

**Tech Stack:** TypeScript (NodeNext, `.js` import specifiers), Express, Drizzle, Vitest. Server: `server/src/`. Adapter: `packages/adapters/claude-local/`.

**Non-goals (Phase 2/3):** marketplace crew provisioning, catalog authoring, agent-update flow, viewer/Office work.

---

## File map

| File | Responsibility | Change |
|---|---|---|
| `server/src/services/internal-agent/aoa-agents/runner.ts` | Crew run orchestration | Wire transcript logging (T1), skills (T3); it is the ONLY producer that must change |
| `server/src/services/internal-agent/aoa-agents/crew-run-log.ts` | **NEW** — crew transcript sink | Encapsulates run-log writing so `runner.ts` stays thin (T1) |
| `packages/adapters/claude-local/src/server/execute.ts` | claude CLI spawn | Hermetic config home + cwd (T2) |
| `packages/adapter-utils/src/execution-target.ts` | Execution-target helpers | Local targets get a managed home (T2) |
| `server/src/services/internal-agent/tools/skill-tools.ts` | `use_skill` tool | Enforce `skillKeys` for crew, not just Commander (T4) |
| `server/src/services/internal-agent/mcp-bridge.ts` | Bridge tool context | Carry a real `actorType` for crew (T4) |

---

## Task 1: Persist crew run transcripts (P1)

**Why first:** P5 (runs finish without `set_task_status`) is undiagnosable while crew runs log nothing. Every later task is verified through these transcripts.

**Files:**
- Read first: `server/src/services/run-log-store.ts`, and the heartbeat's usage of it (`git grep -n "run-log-store\|runLogStore\|appendRunLog" server/src`)
- Create: `server/src/services/internal-agent/aoa-agents/crew-run-log.ts`
- Modify: `server/src/services/internal-agent/aoa-agents/runner.ts` (the `adapter.execute` call, currently `onLog: async () => {}, onMeta: async () => {}` at ~L569)
- Test: `server/src/services/internal-agent/aoa-agents/__tests__/crew-run-log.test.ts`

- [ ] **Step 1: Read the existing run-log mechanism.** Open `server/src/services/run-log-store.ts` and find how the heartbeat writes a run transcript (the NDJSON path is built around `path.join(relDir, `${runId}.ndjson`)`). Note the exact exported function name(s), their parameters (companyId / agentId / runId / event shape), and how the heartbeat calls them. **Mirror this API exactly — do not invent a second logging mechanism.** Record the signature you found in your status report.

- [ ] **Step 2: Write the failing test** — `crew-run-log.test.ts`. It must assert the sink writes both stream chunks and the meta record, and that a sink failure never throws:

```ts
import { describe, it, expect, vi } from "vitest";
import { createCrewRunLogSink } from "../crew-run-log.js";

describe("createCrewRunLogSink", () => {
  it("forwards stdout/stderr chunks and the meta record to the run-log store", async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    const sink = createCrewRunLogSink(
      { companyId: "c1", agentId: "a1", runId: "r1" },
      { append },
    );
    await sink.onLog("stdout", "hello\n");
    await sink.onMeta({ adapterType: "claude_local", command: "claude", commandArgs: ["--print"] });
    expect(append).toHaveBeenCalledTimes(2);
    const kinds = append.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(kinds).toContain("log");
    expect(kinds).toContain("meta");
  });

  it("never throws when the underlying store fails (logging must not fail a run)", async () => {
    const append = vi.fn().mockRejectedValue(new Error("disk full"));
    const sink = createCrewRunLogSink({ companyId: "c1", agentId: "a1", runId: "r1" }, { append });
    await expect(sink.onLog("stderr", "boom")).resolves.toBeUndefined();
    await expect(sink.onMeta({ adapterType: "claude_local" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it and confirm it fails.** `pnpm test:run server/src/services/internal-agent/aoa-agents/__tests__/crew-run-log.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement `crew-run-log.ts`.** Adapt the store call to the real signature found in Step 1 (the `append` dependency below is the seam that lets the test inject a fake — keep it, and default it to the real store):

```ts
// server/src/services/internal-agent/aoa-agents/crew-run-log.ts
//
// Crew runs previously discarded ALL output (onLog/onMeta were no-ops), which
// made every crew failure undiagnosable. This sink mirrors what the org/
// heartbeat path already does: persist an NDJSON transcript per run.
// Logging is strictly best-effort — it must NEVER fail a run.

export interface CrewRunLogTarget {
  companyId: string;
  agentId: string;
  runId: string;
}

export interface CrewRunLogWriter {
  append: (record: Record<string, unknown>) => Promise<void>;
}

export function createCrewRunLogSink(target: CrewRunLogTarget, writer: CrewRunLogWriter) {
  const safeAppend = async (record: Record<string, unknown>): Promise<void> => {
    try {
      await writer.append({ ...target, ts: new Date().toISOString(), ...record });
    } catch {
      // Best-effort: a transcript failure must never fail the agent run.
    }
  };

  return {
    onLog: async (stream: "stdout" | "stderr", chunk: string): Promise<void> => {
      await safeAppend({ kind: "log", stream, chunk });
    },
    onMeta: async (meta: Record<string, unknown>): Promise<void> => {
      await safeAppend({ kind: "meta", meta });
    },
  };
}
```

- [ ] **Step 5: Run the test → PASS.** Same command as Step 3.

- [ ] **Step 6: Wire it into the crew runner.** In `runner.ts`, replace the no-op callbacks in the `adapter.execute({...})` call. Build the sink from the real run-log store (using the signature from Step 1) and the run's `companyId`/`agentId`/`runId`:

```ts
const crewLog = createCrewRunLogSink(
  { companyId, agentId, runId: runId ?? `aoa-${agentId}` },
  runLogWriterFor(/* real store — per Step 1 */),
);
// ...inside adapter.execute({...}):
onLog: crewLog.onLog,
onMeta: crewLog.onMeta,
```

Do NOT change any other argument of the `adapter.execute` call in this task.

- [ ] **Step 7: Verify + commit.** `pnpm --filter @armyofagents/server typecheck` and the crew suites (`pnpm test:run server/src/services/internal-agent/aoa-agents/__tests__ server/src/__tests__/aoa-runner-loopback.test.ts`) → PASS.

```bash
git add server/src/services/internal-agent/aoa-agents/crew-run-log.ts server/src/services/internal-agent/aoa-agents/__tests__/crew-run-log.test.ts server/src/services/internal-agent/aoa-agents/runner.ts
git commit -m "feat(crew): persist crew run transcripts (crew runs were a black box)"
```

- [ ] **Step 8: Capture a real transcript.** Dispatch one crew task on the live instance and confirm an NDJSON file appears under the run-logs directory for that agent. **Paste the first 30 lines into your status report** — this is the evidence Task 5 depends on.

---

## Task 2: Hermetic agent execution (P2)

**Why:** the operator's global `~/.claude` (superpowers `SessionStart` hook, gstack skills, plugins) and the repo `CLAUDE.md` currently load into every crew run and hijack the agent. Fixes org agents too.

**Files:**
- Modify: `packages/adapter-utils/src/execution-target.ts` (~L816-820 `adapterExecutionTargetUsesManagedHome`, and the local branch of `prepareAdapterExecutionTargetRuntime` ~L297-303 which returns `runtimeRootDir: null`)
- Modify: `packages/adapters/claude-local/src/server/execute.ts` (~L177 cwd; ~L402-404 managed home)
- Test: `packages/adapters/claude-local/src/__tests__/execute-hermetic.test.ts`

- [ ] **Step 1: Write the failing test.** Assert that for a LOCAL target the spawn env pins a per-run config home and does not inherit the operator's:

```ts
import { describe, it, expect } from "vitest";
import { buildHermeticEnv } from "../server/hermetic-env.js";

describe("buildHermeticEnv", () => {
  it("pins CLAUDE_CONFIG_DIR, HOME and USERPROFILE to the per-run home", () => {
    const env = buildHermeticEnv({ runtimeRootDir: "C:\\rt\\run1" }, { HOME: "C:\\Users\\op", USERPROFILE: "C:\\Users\\op" });
    expect(env.CLAUDE_CONFIG_DIR).toBe("C:\\rt\\run1\\.claude");
    expect(env.HOME).toBe("C:\\rt\\run1");
    expect(env.USERPROFILE).toBe("C:\\rt\\run1");
  });

  it("drops ambient CLAUDE_*/ANTHROPIC_* vars that would leak operator config", () => {
    const env = buildHermeticEnv({ runtimeRootDir: "/rt/run1" }, { CLAUDE_CONFIG_DIR: "/home/op/.claude", ANTHROPIC_API_KEY: "sk-leak" });
    expect(env.CLAUDE_CONFIG_DIR).toBe("/rt/run1/.claude");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it → FAIL** (module not found). `pnpm test:run packages/adapters/claude-local/src/__tests__/execute-hermetic.test.ts`

- [ ] **Step 3: Implement `packages/adapters/claude-local/src/server/hermetic-env.ts`:**

```ts
// Agent runs must not inherit the operator's Claude environment. On Windows the
// claude CLI resolves its config via CLAUDE_CONFIG_DIR else USERPROFILE (NOT
// HOME), so all three are pinned. Ambient CLAUDE_*/ANTHROPIC_* are dropped so a
// developer shell can't leak credentials or config into an agent run.
import path from "node:path";

const LEAKY_PREFIXES = ["CLAUDE_", "ANTHROPIC_"];

export function buildHermeticEnv(
  opts: { runtimeRootDir: string },
  parentEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (LEAKY_PREFIXES.some((p) => k.startsWith(p))) continue;
    out[k] = v;
  }
  out.HOME = opts.runtimeRootDir;
  out.USERPROFILE = opts.runtimeRootDir;
  out.CLAUDE_CONFIG_DIR = path.join(opts.runtimeRootDir, ".claude");
  return out;
}
```

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Give LOCAL targets a managed home.** In `packages/adapter-utils/src/execution-target.ts`: make `adapterExecutionTargetUsesManagedHome` return true for `local` as well, AND make the local branch of `prepareAdapterExecutionTargetRuntime` return a real per-run `runtimeRootDir` (a directory under the instance data dir, created if missing) instead of `null`. Seed `<runtimeRootDir>/.claude/` with ONLY what AoA provides — copy the credentials file from the operator's config home so the CLI stays authenticated, and write NO settings.json, NO plugins, NO user skills.
  **Verification note:** a clean config home was proven to work in live testing — claude ran authenticated with the superpowers hook absent.

- [ ] **Step 6: Apply the hermetic env + neutral cwd in `execute.ts`.** Replace the `if (runtimeRootDir && adapterExecutionTargetUsesManagedHome(...)) { env.HOME = runtimeRootDir; }` block with a call to `buildHermeticEnv`, and change the cwd fallback (`const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();`) so a workspace-less agent run uses a **neutral scratch dir** (e.g. `<runtimeRootDir>/cwd`) rather than `process.cwd()` — which is the AoA repo and drags in its `CLAUDE.md`.

- [ ] **Step 7: Verify + commit.** `pnpm --filter @armyofagents/adapter-claude-local typecheck`, `pnpm --filter @armyofagents/adapter-utils typecheck`, plus the claude-local test suite → PASS.

```bash
git commit -m "fix(agents): hermetic agent execution — per-run config home, env allowlist, neutral cwd (no operator ~/.claude leak)"
```

- [ ] **Step 8: Live-verify.** Dispatch one crew task; in the Task-1 transcript confirm the run shows **no** superpowers `SessionStart` hook and **no** operator/gstack skills. Paste the evidence.

---

## Task 3: Deliver company skills to crew agents (P3)

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/runner.ts` (the `context` object in `adapter.execute`)
- Pattern to mirror: `server/src/services/heartbeat.ts:4003-4013`
- Resolver (do not change): `server/src/services/company-skills.ts:2203-2219` `listRuntimeSkillEntries`
- Test: `server/src/services/internal-agent/aoa-agents/__tests__/crew-skills-context.test.ts`

- [ ] **Step 1: Write the failing test** — the crew runner must put the agent's resolved skills on `context.skills`:

```ts
it("passes the agent's company skills to the adapter as context.skills", async () => {
  const execute = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  const listRuntimeSkillEntries = vi.fn().mockResolvedValue([
    { key: "code-review", name: "Code Review", markdown: "# Code Review", trustLevel: "verified" },
  ]);
  await runCrewOnce({ execute, listRuntimeSkillEntries /* per the harness */ });
  const ctx = execute.mock.calls[0][0].context;
  expect(ctx.skills).toHaveLength(1);
  expect(ctx.skills[0].key).toBe("code-review");
});

it("omits context.skills entirely when the agent has no skillKeys", async () => {
  const execute = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  const listRuntimeSkillEntries = vi.fn().mockResolvedValue([]);
  await runCrewOnce({ execute, listRuntimeSkillEntries });
  expect(execute.mock.calls[0][0].context.skills).toBeUndefined();
});
```

Mirror the existing crew-runner test harness (see `server/src/__tests__/aoa-runner-loopback.test.ts` for how `runAoaAgent` is driven with mocks).

- [ ] **Step 2: Run → FAIL** (`context.skills` undefined in the first test).

- [ ] **Step 3: Implement.** In `runner.ts`, before the `adapter.execute` call, resolve skills exactly as heartbeat does, and set the key **only when non-empty** (matching heartbeat's `if (agentSkills.length > 0)` semantics so the adapter's `dbSkills.length > 0` branch behaves identically):

```ts
// Crew agents previously received NO company skills: listRuntimeSkillEntries had
// exactly one caller (the heartbeat/org path), and crew agents are barred from
// the heartbeat. Mirror the org path so a crew agent's `skillKeys` are honored.
const skillSvc = companySkillService(db);
const agentSkills = await skillSvc
  .listRuntimeSkillEntries(companyId, agentId)
  .catch(() => []);            // skill resolution must never fail a run

const context: Record<string, unknown> = { aoaInstruction: instruction, payload };
if (agentSkills.length > 0) context.skills = agentSkills;
```

then pass that `context` into `adapter.execute`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Verify + commit.** `pnpm --filter @armyofagents/server typecheck` + crew suites → PASS.

```bash
git commit -m "feat(crew): deliver company/marketplace skills to crew agents at runtime (context.skills)"
```

- [ ] **Step 6: Live-verify.** Attach a skill to a crew agent in the UI (Team → Commander Team → Roster → agent → Skills), dispatch a task, and confirm from the Task-1 transcript that the skill file was materialized. **This is what makes the Skills tab (P7) honest.**

---

## Task 4: Enforce `skillKeys` scoping for crew agents (P4 — the security boundary)

**Why:** the company skill library is intentionally OPEN (any GitHub/URL). Curating which skills a crew agent gets is only meaningful if it is ENFORCED. Today `use_skill` checks `skillKeys` only when `actorType === "commander"`, and the crew bridge runs as `"board"` — so a crew agent can invoke ANY installed skill, including one a teammate pulled from an arbitrary repo.

**Files:**
- Modify: `server/src/services/internal-agent/tools/skill-tools.ts` (~L90-112, the commander-only gate)
- Modify: `server/src/services/internal-agent/aoa-agents/runner.ts` (~L337-354 bridge params — set a crew `actorType`)
- Modify: `server/src/services/internal-agent/mcp-bridge.ts` (~L291 `actorType` fallback)
- Test: `server/src/services/internal-agent/tools/__tests__/skill-tools-crew-scope.test.ts`

- [ ] **Step 1: Write the failing tests:**

```ts
it("denies a crew agent a skill that is not in its skillKeys", async () => {
  const ctx = makeToolContext({ actorType: "aoa", agentId: "a1" });
  withAgent({ id: "a1", skillKeys: ["allowed-skill"] });
  const res = await useSkillTool.execute({ key: "other-skill" }, ctx);
  expect(res.success).toBe(false);
  expect(res.error).toContain("NOT_ENABLED");
});

it("allows a crew agent a skill that IS in its skillKeys", async () => {
  const ctx = makeToolContext({ actorType: "aoa", agentId: "a1" });
  withAgent({ id: "a1", skillKeys: ["allowed-skill"] });
  const res = await useSkillTool.execute({ key: "allowed-skill" }, ctx);
  expect(res.success).toBe(true);
});

it("still enforces the existing commander gate (no regression)", async () => {
  const ctx = makeToolContext({ actorType: "commander", agentId: "cmd" });
  withAgent({ id: "cmd", skillKeys: [] });
  const res = await useSkillTool.execute({ key: "any" }, ctx);
  expect(res.success).toBe(false);
});
```

- [ ] **Step 2: Run → the crew-denial test FAILS** (crew is currently ungated).

- [ ] **Step 3: Implement.** (a) In `runner.ts`, include `actorType: "aoa"` in the MCP bridge params so the bridge no longer falls back to `"board"`. (b) In `mcp-bridge.ts`, pass that through into the reconstructed `toolContext`. (c) In `skill-tools.ts`, broaden the gate from commander-only to **any agent-backed actor** — i.e. enforce whenever the context has an `agentId` (commander and crew alike), leaving genuine board/human callers unrestricted:

```ts
// The skillKeys allowlist is the security boundary for an OPEN skill library:
// anyone may install skills from any source, so an agent must only be able to
// invoke the skills deliberately attached to it. Enforce for every agent-backed
// actor (commander AND crew), not just commander.
const enforcesSkillScope = ctx.actorType === "commander" || ctx.actorType === "aoa";
if (enforcesSkillScope && ctx.agentId) {
  const agent = await agents.getById(ctx.agentId);
  const allowed: string[] = Array.isArray(agent?.skillKeys) ? agent.skillKeys : [];
  if (!allowed.includes(skill.key)) {
    return { success: false, error: `NOT_ENABLED: skill '${skill.key}' is not attached to this agent`, summary: "" };
  }
}
```

- [ ] **Step 4: Run → all three PASS.**

- [ ] **Step 5: Verify + commit.** Server typecheck + the skill-tool and crew suites → PASS.

```bash
git commit -m "fix(crew): enforce per-agent skillKeys scoping for crew use_skill (open library requires enforced curation)"
```

> **Ordering note:** Task 3 must land before Task 4 in the live environment. Enforcing scope while crew agents still have empty `skillKeys` would deny every skill. Phase 2 assigns skills from marketplace templates; until then, attach skills via the UI to test.

---

## Task 5: Diagnose and fix crew completion (P5)

**Blocked on Task 1** — do not start until a real transcript exists.

**Files:** determined by the diagnosis. Guard being hit: `runner.ts:644` (`"crew task run completed without moving the task (no set_task_status call)"`).

- [ ] **Step 1: Reproduce with a transcript.** Dispatch a crew task on the live instance (post-Tasks 1–3). Read the NDJSON transcript and answer: did the claude CLI start? Did it list the AoA MCP tools (is `set_task_status` present)? Did it call any tool? Did it error? **Record the answer before changing any code.**

- [ ] **Step 2: Classify the root cause** into exactly one of:
  - (a) **MCP bridge not connected** → the agent never saw `set_task_status`. Fix the crew `--mcp-config` / bridge handshake.
  - (b) **Agent saw the tool but didn't call it** → prompt/instruction problem. Fix the crew trigger prompt to state the completion contract explicitly.
  - (c) **CLI failed early** (auth/model/args) → fix the invocation.

- [ ] **Step 3: Write a regression test** that fails for the identified cause, then fix it, then confirm the test passes.

- [ ] **Step 4: Live-verify** a crew task runs to completion and the task moves to `in_review`/`done`.

- [ ] **Step 5: Add retry.** A run that finishes without moving the task should be retried once with backoff before being marked failed; the failure card only posts after the retry is exhausted. Test both paths (first-attempt success after retry; terminal failure posts one card).

- [ ] **Step 6: Commit.**

```bash
git commit -m "fix(crew): <root cause> — crew runs now complete and move the task; add single retry"
```

---

## Task 6: Crew dispatch / re-run ergonomics (P6)

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/dispatcher.ts` (wakeup drain, ~L277) and/or `server/src/routes/issues.ts` (wakeup enqueue)
- Test: `server/src/__tests__/crew-redispatch.test.ts`

- [ ] **Step 1: Write the failing test** — a crew task that previously failed and was released to `todo` can be re-dispatched by a single explicit action, without unassign→reassign gymnastics:

```ts
it("re-enqueues a crew wakeup for a previously-failed task on explicit re-run", async () => {
  const task = await seedCrewTask({ status: "todo", workMode: "standard", assigneeAgentId: "eng-1" });
  await requestCrewRerun(task.id);
  const wakeups = await listPendingWakeups("eng-1");
  expect(wakeups.map((w) => w.issueId)).toContain(task.id);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** an explicit re-run path that enqueues a crew wakeup for `(agent, issue)` regardless of which field last changed. Reuse the existing enqueue helper (`enqueueIssueAssigneeWakeup`) rather than writing a second mechanism.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Verify + commit.**

```bash
git commit -m "feat(crew): explicit crew task re-run (re-enqueues wakeup without reassignment)"
```

---

## Task 7: Phase-1 completion gate

- [ ] `pnpm -r typecheck` → PASS
- [ ] `pnpm test:run` across the touched suites (crew runner, crew-run-log, crew-skills-context, skill-tools, claude-local, dispatcher) → PASS
- [ ] `pnpm build` → PASS
- [ ] **Live end-to-end:** on the isolated instance — create a Discussion, scope it, dispatch a crew task, and confirm: (1) a transcript is persisted, (2) the transcript shows **no** operator hooks/skills, (3) only the agent's attached skills are present, (4) the task **completes**, (5) the **"Run finished"** entry appears in the thread with clickable ref chips, and (6) each chip opens the right Thread viewer body.
- [ ] **Verify a denied skill:** a crew agent invoking a skill not in its `skillKeys` gets `NOT_ENABLED`.
- [ ] Update `docs/architecture/decisions.md` with the hermetic-execution decision (agent runs never inherit the operator's Claude environment).

---

## Self-review

**Spec coverage:** P1→T1, P2→T2, P3→T3, P4→T4, P5→T5, P6→T6, P7 (honest Skills tab) is satisfied by T3+T4. Phase-2/3 problems (P8–P19) are explicitly out of scope here and carried in the master scope.

**Ordering risk:** T4 (enforcement) after T3 (delivery) is mandatory — enforcing an empty allowlist would deny everything. T5 is hard-blocked on T1.

**Blast radius:** T2 changes execution for **org agents too**. That is intended (it fixes their identical leak) but means the org/heartbeat suites must stay green — include them in T2's verification.

**Known unknown:** T5's fix is genuinely unknown until a transcript exists; the task is written as a diagnose-then-fix with a forced classification step rather than a pretend-solution.
