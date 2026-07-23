# Crew Execution Hardening — Phase 1: Foundation — Implementation Plan (v2, Codex-revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make crew agent runs observable, hermetic, correctly-skilled and correctly-scoped — so a crew agent can complete a task and Discussions/Workspace work end-to-end.

**Architecture:** Crew agents (`kind='aoa'`) run via `runAoaAgent` → `adapter.execute` (claude_local). The org/heartbeat path already does transcripts + skill injection correctly; we **mirror it rather than invent mechanisms**, then add isolation, workspace resolution, and skill scoping. **Isolation ships crew-only first** and expands to org only after auth/workspace/toolchain tests pass.

**Tech Stack:** TypeScript (NodeNext, `.js` specifiers), Express, Drizzle, Vitest.

**Non-goals:** marketplace crew provisioning + catalog authoring (Phase 2), viewer/Office (Phase 3).

---

## v2 revision log (what Codex caught in v1)

| # | v1 defect | v2 fix |
|---|---|---|
| 1 | `actorType:"aoa"` invented — real vocabulary is `actorType:"agent"` + `agentKind:"aoa"`; `ask_human` requires it (`ask-human-tool.ts:33`), so v1 would have **forbidden `ask_human` for Scout/Engineer** | T8 uses `"agent"`+`agentKind` |
| 2 | `use_skill` rewrite gated on `ctx.agentId`, which **silently disables Commander** (production Commander bridges have no `agentId`; it resolves via `internalAgentConfig.agentId`, `skill-tools.ts:86`). v1's own test masked it | T9 keeps Commander's resolution, adds a separate agent-backed branch |
| 3 | "T3 before T4 prevents lockout" was **false** — `skillKeys` defaults `[]` (`agents.ts:43`) and crew seeding never sets it, so delivery *and* enforcement are both dead on arrival | Surfaced explicitly; **D17** then settled it — Phase 1 ships no defaults and T7 proves the founder-assigned path instead |
| 4 | Pinned `HOME`/`USERPROFILE` → breaks git/SSH/npm for tools the agent launches | T2 isolates **`CLAUDE_CONFIG_DIR` only**; home relocation is an explicit, separately-tested decision |
| 5 | Neutral cwd assumed to give crew a workspace — crew tasks aren't workspace-backed; scratch cwd means they **can't touch the repo** and breaks session resume (`execute.ts:450`) | New T5 (explicit workspace resolution) |
| 6 | Neutral cwd claimed to satisfy "no repo CLAUDE.md" — false for real workspace runs | New T4 uses documented `CLAUDE_CODE_DISABLE_CLAUDE_MDS` / `CLAUDE_CODE_DISABLE_AUTO_MEMORY` + an explicit policy |
| 7 | Blind whole-run retry → duplicate comments/artifacts (`post-task-comment-tool.ts:82`, `attach-task-artifact-tool.ts:121` are non-idempotent) | T10 diagnoses only; retry deferred behind idempotency |
| 8 | Missed that `createToolCallHandler` applies **Commander policy to every actor** (`mcp-bridge.ts:143`) while listing gates it correctly (`tool-registry.ts:199`) | T8 fixes the coupling + adds bridge-level tests |
| 9 | Wrong harness (`aoa-runner-loopback.test.ts` never calls `runAoaAgent`) | Use `aoa-runner-task-execution.test.ts:149` |
| 10 | T4 pseudocode wouldn't compile (`agents` is a Drizzle table, not a service) | Use `ctx.services.agents.getById` + company check |
| 11 | Raw `onMeta` persists **full prompts/context** (`execute.ts:583`) | T1 redacts + defines retention/access |
| 12 | `aoa-${agentId}` log-id fallback risks collisions | Use the run UUID (`runner.ts:168`); missing = invariant failure |
| 13 | Changing shared `execution-target.ts` claims all local adapters use a managed home | Claude-specific opt-in |

---

## Task 1: Crew run transcripts (P1) — with redaction + real run id

**Files:** read `server/src/services/run-log-store.ts` + heartbeat's usage; create `server/src/services/internal-agent/aoa-agents/crew-run-log.ts`; modify `runner.ts` (~L569 no-op callbacks); test `.../aoa-agents/__tests__/crew-run-log.test.ts`.

- [ ] **Step 1: Read the real API.** Find the run-log store's exported functions + how heartbeat calls them (begin/append/finalize semantics — note `begin()` truncates an existing path). Record signatures in your report. **Mirror it; do not invent a second mechanism.**

- [ ] **Step 2: Decide + record the ID + lifecycle invariant.** Use the run row's UUID assigned at `runner.ts:168`. **Do NOT use an `aoa-${agentId}` fallback** — it collides across runs. If the run id is missing, throw (invariant failure), don't silently degrade.

- [ ] **Step 3: Write the failing test** covering forwarding, redaction, and never-throwing:

```ts
import { describe, it, expect, vi } from "vitest";
import { createCrewRunLogSink, redactMeta } from "../crew-run-log.js";

describe("crew run log", () => {
  it("forwards stdout/stderr chunks and a REDACTED meta record", async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    const sink = createCrewRunLogSink({ companyId: "c1", agentId: "a1", runId: "11111111-1111-1111-1111-111111111111" }, { append });
    await sink.onLog("stdout", "hello\n");
    await sink.onMeta({ adapterType: "claude_local", command: "claude", commandArgs: ["--print"], prompt: "SECRET PROMPT", context: { payload: "SECRET" } });
    const kinds = append.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(kinds).toEqual(["log", "meta"]);
    const meta = append.mock.calls[1][0] as { meta: Record<string, unknown> };
    expect(meta.meta.command).toBe("claude");
    expect(meta.meta.prompt).toBeUndefined();   // prompt must never be persisted raw
    expect(meta.meta.context).toBeUndefined();
    expect(meta.meta.promptChars).toBe(13);     // length only, for debugging
  });

  it("never throws when the store fails", async () => {
    const append = vi.fn().mockRejectedValue(new Error("disk full"));
    const sink = createCrewRunLogSink({ companyId: "c1", agentId: "a1", runId: "r-uuid" }, { append });
    await expect(sink.onLog("stderr", "boom")).resolves.toBeUndefined();
    await expect(sink.onMeta({ adapterType: "claude_local" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run → FAIL.** `pnpm test:run server/src/services/internal-agent/aoa-agents/__tests__/crew-run-log.test.ts`

- [ ] **Step 5: Implement `crew-run-log.ts`.** Include `redactMeta`, which keeps operational fields (`adapterType`, `command`, `commandArgs`, `cwd`, `exitCode`) and **drops `prompt`/`context`**, substituting `promptChars`/`contextKeys` for debuggability. `env` is already redacted upstream but re-assert it. Keep the injected-`append` seam. All appends best-effort (never throw).

- [ ] **Step 6: Wire into `runner.ts`** — replace `onLog: async () => {}, onMeta: async () => {}` with the sink, using the run UUID. Change nothing else in that call.

- [ ] **Step 7: Discoverability decision (record it).** `internal_agent_runs` has **no** log columns, unlike `heartbeat_runs` (`heartbeat_runs.ts:26`), and crew live-run projections omit logs (`agents-live-runs.ts:46`). For Phase 1, transcripts are **filesystem-only at a deterministic path**; surfacing them in the run API/UI is explicitly deferred to a follow-up (note it in the plan's Phase-2 backlog). Do not silently pretend the UI will show them.

- [ ] **Step 8: Verify + commit.** Server typecheck + crew suites PASS.
```bash
git commit -m "feat(crew): persist redacted crew run transcripts (crew runs were a black box)"
```

- [ ] **Step 9: Capture evidence.** Dispatch one crew task; confirm the NDJSON appears. **Report a redaction-safe summary (event kinds, counts, exit code) — do NOT paste raw transcript lines.**

---

## Task 2: Ambient Claude-config isolation (crew-only opt-in)

**Scope discipline:** isolate **Claude's config** — do NOT relocate `HOME`/`USERPROFILE` (that breaks git/SSH/npm for tools the agent launches).

**Files:** create `packages/adapters/claude-local/src/server/hermetic-env.ts`; modify `execute.ts` env assembly (~L251/L402-404); test `packages/adapters/claude-local/src/__tests__/hermetic-env.test.ts`.

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect } from "vitest";
import { buildIsolatedClaudeEnv } from "../server/hermetic-env.js";

describe("buildIsolatedClaudeEnv", () => {
  it("pins CLAUDE_CONFIG_DIR to the per-run home and drops ambient CLAUDE_*/ANTHROPIC_*", () => {
    const env = buildIsolatedClaudeEnv({ configDir: "/rt/run1/.claude" }, {
      CLAUDE_CONFIG_DIR: "/home/op/.claude", ANTHROPIC_API_KEY: "sk-leak", PATH: "/usr/bin",
    });
    expect(env.CLAUDE_CONFIG_DIR).toBe("/rt/run1/.claude");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");            // toolchain preserved
  });

  it("does NOT relocate HOME or USERPROFILE (git/ssh/npm must keep working)", () => {
    const env = buildIsolatedClaudeEnv({ configDir: "/rt/run1/.claude" }, { HOME: "/home/op", USERPROFILE: "C:\\Users\\op" });
    expect(env.HOME).toBe("/home/op");
    expect(env.USERPROFILE).toBe("C:\\Users\\op");
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `buildIsolatedClaudeEnv(opts,{parentEnv})`: copy parent env, delete keys matching `CLAUDE_*`/`ANTHROPIC_*`, then set `CLAUDE_CONFIG_DIR = opts.configDir`. Document why HOME is untouched.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Apply in `execute.ts` behind a Claude-specific opt-in.** Do **not** broaden `adapterExecutionTargetUsesManagedHome` (shared by pi/cursor/codex). Gate on an explicit adapter-level flag so **crew runs opt in first**; org/heartbeat keeps current behavior until T11's expansion gate.
- [ ] **Step 6: Verify + commit.** claude-local + adapter-utils typechecks and suites PASS; **org/heartbeat suites must stay green** (they are unaffected by design).
```bash
git commit -m "feat(agents): isolate Claude config dir per run (crew opt-in); drop ambient CLAUDE_*/ANTHROPIC_*"
```

---

## Task 3: Per-run Claude config home provisioning (auth)

**Files:** `packages/adapters/claude-local/src/server/` (a `provisionClaudeConfigHome` helper) + wherever the per-run root is created; test alongside.

- [ ] **Step 1: Determine the auth mode.** Read `login.ts` (`resolveClaudeConfigHome`) and inspect a real config home to confirm credentials live in a **file** (`.credentials.json`) vs an OS keychain. **Record the finding** — if credentials are keychain-backed on any target platform, isolation must not assume file copy.
  *(Live-verified on Windows during investigation: a config dir containing only `.credentials.json` authenticated successfully and loaded no operator hooks/skills.)*
- [ ] **Step 2: Failing test** — provisioning creates `<root>/.claude` containing the credentials and **no** `settings.json`, **no** `plugins/`, **no** user `skills/`.
- [ ] **Step 3: Implement** `provisionClaudeConfigHome(rootDir)`: mkdir, copy only the credentials file from the resolved source config home, and assert nothing else is copied. Fail loudly with an actionable error if credentials are absent (an unauthenticated agent must not silently run).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Lifecycle.** Decide and implement cleanup (per-run temp dir removed after the run, mirroring `buildSkillsDir`'s cleanup at `execute.ts:745`). Record the retention choice.
- [ ] **Step 6: Verify + commit.**
```bash
git commit -m "feat(agents): provision a minimal per-run Claude config home (credentials only)"
```

---

## Task 4: Claude-instruction isolation (the `CLAUDE.md` policy)

**Decision required before coding — record it in `docs/architecture/decisions.md`:** a project workspace that is a real repo will still load its `CLAUDE.md`. Choose:
- **(A) Enforce D9 globally** — set `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` for agent runs, so ONLY AoA's `--append-system-prompt-file` instructions apply. *(Recommended: matches D9 "agents see only AoA-provisioned instructions".)*
- **(B) Allow project `CLAUDE.md`** as legitimate context for a trusted workspace, and accept that repo instructions influence agents.

- [ ] **Step 1: Record the decision** (A or B) with rationale.
- [ ] **Step 2: Failing test** asserting the chosen env vars are (or are not) set for a crew run.
- [ ] **Step 3: Implement** in the env builder from T2.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Verify + commit.**
```bash
git commit -m "feat(agents): explicit Claude-instruction isolation policy for agent runs"
```

---

## Task 5: Crew workspace resolution (crew tasks must be workspace-backed)

**Why:** crew tasks are **not** workspace-backed today — the crew runner never sets `context.paperclipWorkspace` (heartbeat resolves it at `heartbeat.ts:1549` → `:3628`). Without this, a crew agent has no repo to work in, and a scratch cwd also breaks Claude session resume (`execute.ts:450` requires identical cwd).

**Files:** `runner.ts` (context assembly); mirror `heartbeat.ts:1549-3628`; test `server/src/__tests__/crew-workspace-resolution.test.ts`.

- [ ] **Step 1: Read heartbeat's workspace resolution** and record exactly which inputs it uses (project, `executionWorkspacePolicy`, `functionType`, existing workspace reuse).
- [ ] **Step 2: Failing test** — a crew task on a `software_development` project resolves a workspace and passes `context.paperclipWorkspace`; a task with no project/policy resolves none and does **not** fabricate one.
- [ ] **Step 3: Implement** resolution in the crew runner, mirroring heartbeat. Preserve precedence: workspace cwd > configured cwd > fallback.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Verify + commit.**
```bash
git commit -m "feat(crew): resolve execution workspaces for crew tasks (mirrors heartbeat resolution)"
```

---

## Task 6: Deliver company skills to crew (P3) — warning-grade

**Files:** `runner.ts`; mirror `heartbeat.ts:4003-4013`; **harness pattern: `server/src/__tests__/aoa-runner-task-execution.test.ts:149`** (NOT `aoa-runner-loopback.test.ts`, which never calls `runAoaAgent`); test `server/src/__tests__/crew-skills-context.test.ts`.

- [ ] **Step 1: Failing tests** — (a) resolved skills land on `context.skills`; (b) empty list ⇒ key omitted entirely (so the adapter's `dbSkills.length > 0` branch is unchanged); (c) a resolver failure logs a **warning** and does not fail the run.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — resolve via `companySkillService(db).listRuntimeSkillEntries(companyId, agentId)`; set `context.skills` only when non-empty. **Do not swallow errors silently** — mirror heartbeat's warn-then-continue so broken skill storage is visible:

```ts
let agentSkills: RuntimeSkillEntry[] = [];
try {
  agentSkills = await companySkillService(db).listRuntimeSkillEntries(companyId, agentId);
} catch (err) {
  log.warn({ err, companyId, agentId }, "crew skill resolution failed; continuing without skills");
}
const context: Record<string, unknown> = { aoaInstruction: instruction, payload };
if (agentSkills.length > 0) context.skills = agentSkills;
```

- [ ] **Step 4: Run → PASS.** **Step 5: Verify + commit.**
```bash
git commit -m "feat(crew): deliver company/marketplace skills to crew agents at runtime"
```

---

## Task 7: Prove the founder-assigned skill path end-to-end (no defaults — D17)

**Why the shape changed.** v2 originally proposed seeding default `skillKeys` per role. **D17 rejects that:** Commander's skills are Commander's job, and each crew agent's real set is declared in its marketplace agent template (D6) — which Phase 2 delivers. Inventing a Phase-1 map is guesswork Phase 2 deletes.

**So Phase 1 assigns NO defaults.** That is not a regression (crew agents get zero skills today) and it *does* close P4's hole. What Phase 1 must prove is that a skill a founder attaches in the Skills tab is **actually delivered (T6) and actually enforced (T9)** — making the tab honest (P7) and leaving Phase 2 to populate it from templates.

**Files:** integration test only — `server/src/__tests__/crew-skill-assignment-e2e.test.ts`. No seeder change.

- [ ] **Step 1: Confirm the assignment route works** — `PATCH …/agents/:id` validates `skillKeys` against the company's installed skills and 422s on unknown/ambiguous keys (`agents.ts:1514-1516`). Record the exact request shape; do not modify it.
- [ ] **Step 2: Write the failing integration test** spanning assignment → delivery → enforcement:
  - assign one installed skill to a crew agent via the route;
  - `listRuntimeSkillEntries(companyId, agentId)` returns exactly that skill;
  - the crew runner puts it on `context.skills` (T6);
  - `use_skill` with that key succeeds, and with a *different* installed key returns `NOT_ENABLED` (T9);
  - clearing `skillKeys` returns the agent to delivering nothing.
- [ ] **Step 3: Run → FAIL** until T6 and T9 are both in.
- [ ] **Step 4: Run after T9 → PASS.** No implementation of its own; this task is the seam that proves the other two.
- [ ] **Step 5: Fix the UI copy (P7).** `AgentSkillsTab.tsx:273-275` claims *"Skills injected into this agent's context on every run"* — true only once T6 ships, and only for attached skills. Reword to state that only attached skills are injected.
- [ ] **Step 6: Commit.**
```bash
git commit -m "test(crew): prove founder-assigned skills are delivered and enforced end-to-end"
```

---

## Task 8: Correct crew actor identity + bridge policy coupling

**Files:** `runner.ts` (~L337-354 bridge params), `mcp-bridge.ts` (~L143 `createToolCallHandler`, ~L291/327 context reconstruction), `authorize-tool.ts` (reference: crew is distinguished by `agentKind`, `:52`); tests at the **bridge** level.

- [ ] **Step 1: Failing tests** — (a) a crew bridge call presents `actorType:"agent"` + `agentKind:"aoa"`; (b) **`ask_human` is permitted for crew** (it requires exactly that combination, `ask-human-tool.ts:33`); (c) a crew tool call is **not** subjected to Commander-only policy.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Set `actorType: "agent"` (+ ensure `agentKind: "aoa"` and `agentId` flow) in the crew bridge params — **never `"aoa"` as an actorType**. Then make `createToolCallHandler` apply `resolveCommanderToolPolicy` **only for `actorType === "commander"`**, matching how tool *listing* already gates it (`tool-registry.ts:199`), so crew tools can't be advertised then rejected.
- [ ] **Step 4: Run → PASS.** **Step 5:** Update the stale `ToolContext`/`McpConfigParams` comments that describe only Commander/board actors.
- [ ] **Step 6: Verify + commit.**
```bash
git commit -m "fix(crew): correct crew actor identity (agent+aoa) and stop applying Commander policy to crew tool calls"
```

---

## Task 9: Enforce `skillKeys` scoping (P4 — the security boundary)

**Depends on T8** (correct identity). T7 is the harness that proves T6+T9 together — write it before, run it after.

**On the "lockout" concern:** enforcing while `skillKeys` is empty denies every skill to every crew agent. Under D17 that is the *intended* Phase-1 state — crew agents receive no skills today, so nothing regresses, and the open-library hole (D7/P4) closes immediately. Founder-assigned skills are the escape hatch, proven by T7.

**Files:** `server/src/services/internal-agent/tools/skill-tools.ts` (~L86-112); tests at both tool and bridge level.

- [ ] **Step 1: Failing tests** — (a) crew agent denied a skill not in its `skillKeys` (`NOT_ENABLED`); (b) crew agent allowed one that is; (c) **Commander's existing gate still works with NO `ctx.agentId`** (resolved via `internalAgentConfig.agentId`) — this is the regression v1 would have shipped; (d) an agent from another company cannot be resolved.
- [ ] **Step 2: Run → the crew tests FAIL, Commander test PASSES** (proving no regression baseline).
- [ ] **Step 3: Implement — keep Commander's path, add an agent branch.** Do **not** collapse them into one `ctx.agentId` check:

```ts
// The skillKeys allowlist is the security boundary for an intentionally OPEN
// skill library (D7): anyone may install skills from any source, so an agent
// must only invoke skills deliberately attached to it (D8).
// Commander resolves its agent id from internalAgentConfig (its bridge has no
// ctx.agentId) — that path must be preserved exactly.
let scopedAgentId: string | null = null;
if (ctx.actorType === "commander") {
  scopedAgentId = await resolveCommanderAgentId(ctx);        // existing behavior
} else if (ctx.actorType === "agent" && ctx.agentKind === "aoa" && ctx.agentId) {
  scopedAgentId = ctx.agentId;                                // crew
}
if (scopedAgentId) {
  const agent = await ctx.services.agents.getById(scopedAgentId);
  if (!agent || agent.companyId !== ctx.companyId) {          // getById is NOT company-scoped
    return { success: false, error: "NOT_ENABLED: agent not found in this company", summary: "" };
  }
  const allowed: string[] = Array.isArray(agent.skillKeys) ? agent.skillKeys : [];
  if (!allowed.includes(skill.key)) {
    return { success: false, error: `NOT_ENABLED: skill '${skill.key}' is not attached to this agent`, summary: "" };
  }
}
```

- [ ] **Step 4: Run → all PASS.** **Step 5:** Add a **bridge-level** test (not just direct `execute`) so policy/authorization coupling is covered.
- [ ] **Step 6: Verify + commit.**
```bash
git commit -m "fix(crew): enforce per-agent skillKeys for crew use_skill (Commander path preserved, company-scoped)"
```

---

## Task 10: Diagnose crew completion (P5) — **no blind retry**

**Blocked on T1.** Guard hit: `runner.ts:644` ("completed without moving the task").

- [ ] **Step 1: Reproduce with a transcript** (post T1–T9). Answer from the log: did the CLI start? were the AoA MCP tools listed (is `set_task_status` present)? was any tool called? any error? **Record before changing code.**
- [ ] **Step 2: Classify** as exactly one of: (a) MCP bridge not connected → agent never saw `set_task_status`; (b) tool visible but not called → prompt/instruction problem (fix the crew trigger prompt to state the completion contract); (c) CLI failed early (auth/model/args).
- [ ] **Step 3: Write a regression test** for the identified cause; fix; confirm PASS.
- [ ] **Step 4: Live-verify** a crew task completes and moves to `in_review`/`done`.
- [ ] **Step 5: Retry is OUT OF SCOPE here.** `post_task_comment` (`post-task-comment-tool.ts:82`) and `attach_task_artifact` (`attach-task-artifact-tool.ts:121`) are **non-idempotent**, so a whole-run retry duplicates comments/artifacts. File a follow-up: "idempotency keys / checkpoint-aware retry for crew runs" — a prerequisite for any automatic retry.
- [ ] **Step 6: Commit.**
```bash
git commit -m "fix(crew): <root cause> — crew runs complete and move the task"
```

---

## Task 11: Completion gate + docs reconciliation

- [ ] `pnpm -r typecheck`, the touched suites, and `pnpm build` → PASS. **Org/heartbeat suites explicitly included** (T2 is crew-opt-in, so they must be unchanged).
- [ ] **Live end-to-end** on the isolated instance: Discussion → scope → dispatch → (1) transcript persisted, (2) no operator hooks/skills present, (3) only the agent's attached skills, (4) task **completes**, (5) **"Run finished"** entry with clickable chips, (6) each chip opens the right Thread body.
- [ ] **Denied-skill check:** a crew agent invoking an unattached skill gets `NOT_ENABLED`. **`ask_human` still works for crew** (T8 regression guard).
- [ ] **Org-expansion gate (explicit):** only after auth + workspace + toolchain tests pass, decide whether to extend T2/T3/T4 isolation to org/heartbeat runs. Record the decision; do **not** flip it silently.
- [ ] **Docs:** update `docs/architecture/decisions.md` (hermetic execution + the T4 CLAUDE.md policy) **and reconcile `CLAUDE.md:212`**, which currently states `use_skill` is board/Commander-only and `ask_human` is heartbeat-only — both now inaccurate for crew.

---

## Self-review

**Coverage:** P1→T1, P2→T2+T3+T4, P7b→T5, P3→T6, P7c→T7 (proof harness), P4b→T8, P4→T9, P5→T10, P7→T7 Step 5, P6 deferred (re-run ergonomics are not on the critical path to a completing crew run).

**Ordering:** T1 → T2 → T3 → T4 → T5 → T6 → T7 (write) → T8 → T9 → T7 (run) → T10 → T11. T9 **must** follow T8 (else wrong actor identity). T10 **must** follow T1 (else undiagnosable).

**Deliberate Phase-1 end state:** crew agents hold no default skills (D17). Real per-agent sets arrive in Phase 2 from marketplace agent templates (D6). Phase 1's job is that the *machinery* is correct and the founder-assigned path works.

**Blast radius:** T2/T3/T4 ship **crew-only**; org/heartbeat is untouched until the T11 expansion gate. T8's bridge-policy change affects all non-Commander actors — bridge-level tests are mandatory, not optional.

**Known unknowns, stated honestly:** T10's root cause is unknown until a transcript exists (diagnose-then-classify, no pretend fix). T3's auth-mode assumption is file-based credentials — verified on Windows, must be re-checked per platform.

**Deferred (tracked, not dropped):** crew log discoverability in the run API/UI; crew re-run ergonomics; idempotent/checkpoint-aware retry.
