# Commander Chat Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar Commander chat a real assistant — seeded/editable persona bundle + attached/seeded skills + conversation memory with auto-compaction + relevance company-memory — by having `agent-loop.ts` assemble the full per-turn prompt (Option B), claude & codex, chat path only.

**Architecture:** `agent-loop.ts` becomes the orchestrator: it loads the Commander instruction bundle, the conversation history (since the summary marker) + rolling summary, the relevant approved company memory, and the resolved skills, assembles them into one prompt string, and substitutes that into `params.content` before calling the unchanged `cliService.chat(params, config)`. Because `cli-mode.ts` only ever sends `params.content` to the CLI (codex stdin / claude `-p`), the spawn shape stays byte-identical — only prompt content changes. Compaction summarizes via a thin, tool-less CLI summarizer (cheap model). Reuses `context-assembly.ts`, `conversation.ts`, `default-agent-instructions.ts`, `agent-instructions.ts`, `memory.ts`, `company-skills.ts`.

**Tech Stack:** TypeScript, Node, Express 5, Drizzle ORM (Postgres), Vitest. Repo: `AoA-2.5/.worktrees/commander-subagent-1` (branch `commander-subagent-1`).

**Spec:** `docs/superpowers/specs/2026-05-18-commander-chat-foundation-design.md` (commits `36c75d2b`, `24b5c914`).

---

## Spec deviations (plan-time refinements, grounded in verbatim code — all strictly safer)

1. **`cli-mode.ts` is NOT modified.** Spec file-map said "modify cli-mode to accept the assembled prompt". Verbatim `cli-mode.ts:331` (`prompt: params.content`) and `:396-398` (`safeContent = … params.content`) show `params.content` is the *only* user content sent to either CLI. `agent-loop` substituting `params.content` with the assembled prompt means cli-mode is untouched and the spawn shape is *provably* byte-identical. Strictly better than the spec.
2. **Skills are inlined into the assembled prompt**, not materialized as files in a `skillsDir`. The chat path has no cwd/`skillsDir` plumbing (only the heartbeat/adapter path does); inlining is adapter-uniform, preserves the byte-identical invariant, and is DRY with persona/memory/history (all one assembled string). User-visible outcome is identical (skills still attached via the Skills UI, seeded defaults still apply).
3. **`context-assembly.ts` receives memory results via dependency injection** (a `memorySearch` callback) rather than calling the DB directly, keeping the assembler a pure, unit-testable function. `agent-loop` supplies the real `memoryService(db).searchSemantic`.

These do not change scope or any product decision; they reduce blast radius.

## `[verify@exec]` preconditions (confirm against landed code before the task that needs them; expected shapes given so code stays concrete)

- **P1 — `memory.ts` search API.** Expected: `memoryService(db).searchSemantic(companyId: string, query: string, filters?: { layer?: string; departmentId?: string; limit?: number }) => Promise<MemoryItem[]>` — hard-filters `status='approved'`, default `limit=10`, internal keyword/`ilike` fallback when no embedding API key. Confirm the exact factory name + method names in `server/src/services/memory.ts` (the same `ctx.services.memory.searchSemantic` `memory-tools.ts:26` calls).
- **P2 — skills resolver.** Expected: `listRuntimeSkillEntries(companyId: string, agentId: string) => Promise<RuntimeSkillEntry[]>` where `RuntimeSkillEntry = { key: string; name: string; markdown: string; trustLevel: string; files?: {path:string;content:string}[] }`. Confirm exact export + import path in `server/src/services/company-skills.ts`.
- **P3 — no schema migration.** Seeding reuses the on-disk managed instructions bundle + `adapterConfig`. Confirm no Drizzle migration is required (if one *is*, add it under `packages/db/src/schema/` via `pnpm db:generate` — never raw SQL).
- **P4 — `agentInstructionsService()` shape.** Confirmed by read: `agentInstructionsService()` (no args) → `{ getBundle(agent), readFile(agent, relPath), ensureWritableBundle(agent, opts?), updateBundle(agent, input), … }`; `AgentLike = { id, companyId, name, adapterConfig }`; `ENTRY_FILE_DEFAULT = "AGENTS.md"`. Re-confirm `ensureWritableBundle` returns `{ adapterConfig, state }` and that writing files under `state.rootPath`/the managed root then persisting `adapterConfig` onto the `agents` row links the bundle.

## Test harness (use verbatim for every unit test)

Tests live in `server/src/__tests__/`. Command (proven in prior phases): `cd server && npx vitest run src/__tests__/<file>.test.ts` (repo-root alternative: `pnpm test:run server/src/__tests__/<file>.test.ts`). Mock harness pattern (from `server/src/__tests__/aoa-ensure-commander.test.ts:1-6`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
const { eqMock, andMock } = vi.hoisted(() => ({ eqMock: vi.fn((a:unknown,b:unknown)=>({eq:[a,b]})), andMock: vi.fn((...a:unknown[])=>({and:a})) }));
vi.mock("drizzle-orm", () => ({ and: andMock, eq: eqMock }));
vi.mock("@armyofagents/db", () => { const t=(n:string)=>new Proxy({},{get:(_x,p)=>typeof p==="string"?Symbol(`${n}.${p}`):undefined}); return { agents:t("agents"), internalAgentConfig:t("iac") }; });
// import the unit under test AFTER the mocks
function sel(rows:unknown[]){const c:any={};c.from=()=>c;c.where=()=>c;c.then=(r:(v:unknown[])=>unknown)=>Promise.resolve(rows).then(r);return c;}
```
`db = { select:()=>sel([...]), insert:()=>({values:(_v:unknown)=>({returning:()=>Promise.resolve([{id:"a1"}])})}), update:()=>({set:(_v:unknown)=>({where:()=>Promise.resolve([])})}) }`.

---

## Milestone M1 — Commander instruction bundle (seed files + loader + seed-on-ensure)

### Task 1.1: Commander onboarding-assets bundle files

**Files:**
- Create: `server/src/onboarding-assets/commander/AGENTS.md`
- Create: `server/src/onboarding-assets/commander/SOUL.md`
- Create: `server/src/onboarding-assets/commander/TOOLS.md`
- Create: `server/src/onboarding-assets/commander/HEARTBEAT.md`

- [ ] **Step 1: Create `AGENTS.md` (entry file)**

```markdown
# Commander

You are **Commander**, the always-on AI assistant built into AoA (Army of Agents) for this company. You help the founding team coordinate their AI agents and human collaborators from one chat.

## What you are
- A conversational assistant in the AoA sidebar. You remember this conversation (history is given to you each turn; older parts arrive as a summary).
- You act through tools (querying tasks/goals/agents/departments, delegating to sub-agents, proposing memory). You are not omniscient — look things up rather than guessing.

## Operating rules
- Be concise and actionable. Reference tasks/goals/agents by name.
- Before a consequential write, say what you will do. Respect the user's role and permissions.
- If unsure, ask the user rather than guessing.

See `SOUL.md` (principles), `TOOLS.md` (how to use your tools incl. memory), `HEARTBEAT.md` (proactive behavior).
```

- [ ] **Step 2: Create `SOUL.md`**

```markdown
# Commander — Principles

- The founding team is in charge. You extend the team; you do not replace its judgment.
- Company memory is founder-governed: you may *propose* memory items (they are created `pending`), but only the founder/team-lead approves them. Never imply a memory write is final.
- Prefer the smallest action that moves the work forward. Surface options with trade-offs instead of deciding large scope alone.
- Truth over confidence: if you don't know, look it up with a tool or ask.
```

- [ ] **Step 3: Create `TOOLS.md`**

```markdown
# Commander — Tools

You have query, action, memory, workflow, coordination, analysis, file, and delegation tools (the exact allowlist is enforced by the platform).

## Memory tools
- `query_memory` / `find_similar_memory`: search the company knowledge base by meaning. Use these to ground answers in approved company memory before answering "how do we…/what did we decide…" questions.
- `create_memory` / `update_memory`: these create **pending** suggestions. Tell the user the item needs founder approval; never claim it is saved.
- The most relevant approved memory is already provided in your context each turn — search for more only when that is insufficient.

## Delegation
- `delegate_to_subagent`: hand a scoped job to a sub-agent when the work is theirs (e.g. discussion extraction). Summarize back to the user.
```

- [ ] **Step 4: Create `HEARTBEAT.md`**

```markdown
# Commander — Proactive Behavior

When you run proactively (not in direct chat), scan for: blocked tasks, budget thresholds, stale work, dependency gaps, memory conflicts, workload imbalance. Surface findings to the founder's Inbox as concise, actionable notifications. Do not take consequential write actions proactively without the founder — propose them.
```

- [ ] **Step 5: Commit**

```bash
git add server/src/onboarding-assets/commander/AGENTS.md server/src/onboarding-assets/commander/SOUL.md server/src/onboarding-assets/commander/TOOLS.md server/src/onboarding-assets/commander/HEARTBEAT.md
git commit -m "feat(commander): seed commander instruction bundle assets"
```

### Task 1.2: Register the `commander` bundle role in default-agent-instructions

**Files:**
- Modify: `server/src/services/default-agent-instructions.ts:3-15,42-46`
- Test: `server/src/__tests__/default-agent-instructions-commander.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { loadDefaultAgentInstructionsBundle } from "../services/default-agent-instructions.js";

describe("commander default bundle", () => {
  it("loads the 4-file commander bundle", async () => {
    const bundle = await loadDefaultAgentInstructionsBundle("commander");
    expect(Object.keys(bundle).sort()).toEqual(
      ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
    );
    expect(bundle["AGENTS.md"]).toContain("You are **Commander**");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/default-agent-instructions-commander.test.ts`
Expected: FAIL — `"commander"` not assignable / file not found.

- [ ] **Step 3: Implement — add `commander` to the file/dir maps**

In `server/src/services/default-agent-instructions.ts` change the `DEFAULT_AGENT_BUNDLE_FILES` (lines 3-7) and `DEFAULT_AGENT_BUNDLE_DIRS` (lines 11-15):

```ts
const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  cxo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  lead: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
  commander: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

const DEFAULT_AGENT_BUNDLE_DIRS: Record<DefaultAgentBundleRole, string> = {
  default: "default",
  cxo: "cxo",
  lead: "lead",
  commander: "commander",
};
```

(Do **not** change `resolveDefaultAgentInstructionsBundleRole` — Commander is seeded by explicit `"commander"`, not via the free-form role string, so cxo/lead/default mapping stays byte-identical.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/default-agent-instructions-commander.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing default-agent-instructions tests (regression)**

Run: `cd server && npx vitest run src/__tests__/agent-instructions-routes.test.ts`
Expected: PASS (cxo/lead/default unaffected).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/default-agent-instructions.ts server/src/__tests__/default-agent-instructions-commander.test.ts
git commit -m "feat(commander): register commander default bundle role"
```

### Task 1.3: `seedCommanderInstructionBundle` helper (idempotent, never clobbers edits)

**Files:**
- Create: `server/src/services/internal-agent/aoa-agents/seed-commander-bundle.ts`
- Test: `server/src/__tests__/seed-commander-bundle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

const writes: Record<string, string> = {};
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(async () => undefined),
    stat: vi.fn(async (p: string) => (writes[p] ? { isFile: () => true } : Promise.reject(new Error("ENOENT")))),
    writeFile: vi.fn(async (p: string, c: string) => { writes[p] = c; }),
  },
}));

import { seedCommanderInstructionBundle } from "../services/internal-agent/aoa-agents/seed-commander-bundle.js";

function fakeService() {
  return {
    ensureWritableBundle: vi.fn(async () => ({
      adapterConfig: { instructionsBundle: { mode: "managed", rootPath: "/root", entryFile: "AGENTS.md" } },
      state: { rootPath: "/root", entryFile: "AGENTS.md" },
    })),
  };
}

describe("seedCommanderInstructionBundle", () => {
  it("writes the 4 commander files and returns the linked adapterConfig", async () => {
    const svc = fakeService();
    const cfg = await seedCommanderInstructionBundle({
      agent: { id: "a1", companyId: "c1", name: "Commander", adapterConfig: {} },
      service: svc as any,
    });
    expect(svc.ensureWritableBundle).toHaveBeenCalled();
    expect(Object.keys(writes).some((p) => p.endsWith("AGENTS.md"))).toBe(true);
    expect(cfg).toEqual({ instructionsBundle: { mode: "managed", rootPath: "/root", entryFile: "AGENTS.md" } });
  });

  it("does not overwrite a file that already exists (preserves user edits)", async () => {
    writes["/root/SOUL.md"] = "USER EDITED";
    const svc = fakeService();
    await seedCommanderInstructionBundle({ agent: { id: "a1", companyId: "c1", name: "Commander", adapterConfig: {} }, service: svc as any });
    expect(writes["/root/SOUL.md"]).toBe("USER EDITED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/seed-commander-bundle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `server/src/services/internal-agent/aoa-agents/seed-commander-bundle.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { loadDefaultAgentInstructionsBundle } from "../../default-agent-instructions.js";

interface SeedArgs {
  agent: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null };
  // agentInstructionsService() instance (no-arg factory); injected for testability.
  service: { ensureWritableBundle: (agent: unknown, opts?: { clearLegacyPromptTemplate?: boolean }) => Promise<{ adapterConfig: Record<string, unknown>; state: { rootPath?: string | null; entryFile: string } }> };
}

/**
 * Idempotently seed the Commander instruction bundle. Provisions a managed
 * bundle root via ensureWritableBundle, then writes each default commander
 * file ONLY if it does not already exist (never clobbers user edits — the
 * back-fill/idempotency requirement). Returns the adapterConfig to persist
 * on the agents row so the bundle is linked.
 */
export async function seedCommanderInstructionBundle(args: SeedArgs): Promise<Record<string, unknown>> {
  const { agent, service } = args;
  const { adapterConfig, state } = await service.ensureWritableBundle(agent, { clearLegacyPromptTemplate: true });
  const root = state.rootPath;
  if (!root) return adapterConfig;
  const files = await loadDefaultAgentInstructionsBundle("commander");
  await fs.mkdir(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const dest = path.join(root, name);
    const exists = await fs.stat(dest).then((s) => s.isFile()).catch(() => false);
    if (!exists) await fs.writeFile(dest, content, "utf8");
  }
  return adapterConfig;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/seed-commander-bundle.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/seed-commander-bundle.ts server/src/__tests__/seed-commander-bundle.test.ts
git commit -m "feat(commander): idempotent instruction-bundle seeding helper"
```

### Task 1.4: Wire seeding into `ensureCommanderAgent` (create + back-fill, persist adapterConfig)

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/ensure-commander.ts:56-89`
- Test: `server/src/__tests__/aoa-ensure-commander.test.ts` (extend existing)

- [ ] **Step 1: Write the failing test (append to the existing file)**

```ts
it("seeds the commander instruction bundle and persists the linked adapterConfig", async () => {
  const seeded: string[] = [];
  vi.doMock("../services/internal-agent/aoa-agents/seed-commander-bundle.js", () => ({
    seedCommanderInstructionBundle: vi.fn(async (a: any) => { seeded.push(a.agent.id); return { instructionsBundle: { mode: "managed" } }; }),
  }));
  const setCalls: unknown[] = [];
  const db = {
    select: () => sel([{ id: "cmd1", runtimeConfig: { aoa: { toolAllowlist: ["x"] } } }]),
    update: () => ({ set: (v: unknown) => { setCalls.push(v); return { where: () => Promise.resolve([]) }; } }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "cmd1" }]) }) }),
  };
  const { ensureCommanderAgent } = await import("../services/internal-agent/aoa-agents/ensure-commander.js");
  const id = await ensureCommanderAgent(db as any, "c1");
  expect(id).toBe("cmd1");
  expect(seeded).toContain("cmd1");
  // adapterConfig from seeding is persisted onto the agents row
  expect(setCalls.some((c: any) => c.adapterConfig?.instructionsBundle)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/aoa-ensure-commander.test.ts`
Expected: FAIL — seeding not invoked / adapterConfig not persisted.

- [ ] **Step 3: Implement — call the seeder after `agentId` is resolved, persist adapterConfig**

In `server/src/services/internal-agent/aoa-agents/ensure-commander.ts`, add imports at top:

```ts
import { agentInstructionsService } from "../../agent-instructions.js";
import { seedCommanderInstructionBundle } from "./seed-commander-bundle.js";
```

Then, immediately before the final `internalAgentConfig` update (`await db.update(internalAgentConfig)…` at line 86), insert:

```ts
  // Seed the editable instruction bundle (idempotent; never clobbers edits).
  // Runs for BOTH the just-created and the pre-existing (back-fill) paths.
  try {
    const row = await db
      .select({ id: agents.id, companyId: agents.companyId, name: agents.name, adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((r: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null }[]) => r[0]);
    if (row) {
      const nextAdapterConfig = await seedCommanderInstructionBundle({
        agent: { id: row.id, companyId: row.companyId, name: row.name, adapterConfig: row.adapterConfig },
        service: agentInstructionsService(),
      });
      await db.update(agents).set({ adapterConfig: nextAdapterConfig, updatedAt: new Date() }).where(eq(agents.id, agentId));
    }
  } catch {
    // Seeding failure must not block Commander provisioning (graceful: the
    // chat falls back to the SYSTEM_INSTRUCTIONS constant — M2).
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/aoa-ensure-commander.test.ts`
Expected: PASS (all cases incl. the prior idempotent-backfill ones).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/ensure-commander.ts server/src/__tests__/aoa-ensure-commander.test.ts
git commit -m "feat(commander): seed + back-fill instruction bundle in ensureCommanderAgent"
```

---

## Milestone M2 — Persona into the chat (assembler input + agent-loop wiring, constant fallback)

### Task 2.1: `assembleContext` accepts a `systemInstructions` override

**Files:**
- Modify: `server/src/services/internal-agent/context-assembly.ts:38-67`
- Test: `server/src/__tests__/context-assembly-system-instructions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { contextAssemblyService } from "../services/internal-agent/context-assembly.js";

const db: any = { select: () => ({ from: () => ({ where: () => ({ then: (r: any) => Promise.resolve([]).then(r) }) }) }) };

describe("assembleContext systemInstructions override", () => {
  it("uses the provided systemInstructions instead of the default constant", async () => {
    const out = await contextAssemblyService(db).assembleContext("c1", { systemInstructions: "ROLE: Commander persona X" });
    expect(out.systemPrompt).toContain("ROLE: Commander persona X");
    expect(out.systemPrompt).not.toContain("You are the internal AI assistant for this company");
  });
  it("falls back to the default constant when systemInstructions is empty/absent", async () => {
    const out = await contextAssemblyService(db).assembleContext("c1", {});
    expect(out.systemPrompt).toContain("You are the internal AI assistant for this company");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/context-assembly-system-instructions.test.ts`
Expected: FAIL — option ignored.

- [ ] **Step 3: Implement — honor `options.systemInstructions`**

In `server/src/services/internal-agent/context-assembly.ts`, extend the `options` type (around line 40-45) with `systemInstructions?: string;`, and change the first section (line 67) from:

```ts
      addSection("Instructions", SYSTEM_INSTRUCTIONS);
```

to:

```ts
      const persona = options.systemInstructions && options.systemInstructions.trim().length > 0
        ? options.systemInstructions
        : SYSTEM_INSTRUCTIONS;
      addSection("Instructions", persona);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/context-assembly-system-instructions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/context-assembly.ts server/src/__tests__/context-assembly-system-instructions.test.ts
git commit -m "feat(commander): assembleContext accepts systemInstructions override"
```

### Task 2.2: `commanderContext` helper — load bundle text with constant fallback

**Files:**
- Create: `server/src/services/internal-agent/commander-context.ts`
- Test: `server/src/__tests__/commander-context-bundle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { loadCommanderPersona } from "../services/internal-agent/commander-context.js";

describe("loadCommanderPersona", () => {
  it("concatenates the bundle files in AGENTS,SOUL,TOOLS,HEARTBEAT order", async () => {
    const service = {
      readFile: vi.fn(async (_a: unknown, rel: string) => ({ content: `<<${rel}>>` })),
    } as any;
    const out = await loadCommanderPersona({ agent: { id: "a1", companyId: "c1", name: "Commander", adapterConfig: {} }, service });
    expect(out).toBe("<<AGENTS.md>>\n\n<<SOUL.md>>\n\n<<TOOLS.md>>\n\n<<HEARTBEAT.md>>");
  });
  it("returns null when the bundle is unreadable (caller falls back to the constant)", async () => {
    const service = { readFile: vi.fn(async () => { throw new Error("no bundle"); }) } as any;
    const out = await loadCommanderPersona({ agent: { id: "a1", companyId: "c1", name: "Commander", adapterConfig: {} }, service });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/commander-context-bundle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/src/services/internal-agent/commander-context.ts`:

```ts
const BUNDLE_ORDER = ["AGENTS.md", "SOUL.md", "TOOLS.md", "HEARTBEAT.md"] as const;

interface LoadArgs {
  agent: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null };
  service: { readFile: (agent: unknown, relativePath: string) => Promise<{ content: string }> };
}

/**
 * Concatenate the Commander instruction bundle into one persona string
 * (AGENTS → SOUL → TOOLS → HEARTBEAT). Returns null if the bundle cannot be
 * read so the caller can fall back to the SYSTEM_INSTRUCTIONS constant.
 */
export async function loadCommanderPersona(args: LoadArgs): Promise<string | null> {
  const { agent, service } = args;
  try {
    const parts: string[] = [];
    for (const name of BUNDLE_ORDER) {
      const f = await service.readFile(agent, name).catch(() => null);
      if (f && f.content && f.content.trim().length > 0) parts.push(f.content);
    }
    if (parts.length === 0) return null;
    return parts.join("\n\n");
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/commander-context-bundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/commander-context.ts server/src/__tests__/commander-context-bundle.test.ts
git commit -m "feat(commander): persona loader (bundle concat, constant fallback)"
```

### Task 2.3: agent-loop assembles persona into the prompt and substitutes `params.content`

**Files:**
- Modify: `server/src/services/internal-agent/agent-loop.ts:1-6,73-128`
- Test: `server/src/__tests__/agent-loop-assembled-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({ eq: vi.fn((a:any,b:any)=>({eq:[a,b]})), and: vi.fn((...a:any[])=>({and:a})) }));
vi.mock("@armyofagents/db", () => ({ internalAgentConfig: {}, agents: {} }));

const cliCalls: any[] = [];
vi.mock("../services/internal-agent/cli-mode.js", () => ({
  cliModeService: () => ({ chat: async function* (p: any) { cliCalls.push(p); yield { type: "text", delta: "hi" }; } }),
}));
vi.mock("../services/internal-agent/conversation.js", () => ({
  conversationService: () => ({
    getOrCreateActive: async () => ({ id: "conv1", summarizedContext: null, summarizedUpToMessageId: null }),
    appendMessage: async () => ({ id: "m1" }),
  }),
}));
vi.mock("../services/internal-agent/commander-context.js", () => ({
  loadCommanderPersona: async () => "ROLE: Commander persona",
}));

import { agentLoopService } from "../services/internal-agent/agent-loop.js";

describe("agent-loop assembled prompt", () => {
  it("substitutes params.content with the assembled prompt (persona + user message)", async () => {
    const db: any = { select: () => ({ from: () => ({ where: () => ({ then: (r:any)=>Promise.resolve([{ cliTool: "claude_cli" }]).then(r) }) }) }) };
    const gen = agentLoopService(db).chat({ companyId: "c1", userId: "u1", userRole: "founder", enabledCapabilities: [], content: "hello there" });
    for await (const _ of gen) { /* drain */ }
    expect(cliCalls).toHaveLength(1);
    expect(cliCalls[0].content).toContain("ROLE: Commander persona");
    expect(cliCalls[0].content).toContain("hello there");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/agent-loop-assembled-prompt.test.ts`
Expected: FAIL — cli receives raw `"hello there"`.

- [ ] **Step 3: Implement — assemble in `chat()` and pass substituted content**

In `server/src/services/internal-agent/agent-loop.ts` add imports (after line 6):

```ts
import { agents } from "@armyofagents/db";
import { agentInstructionsService } from "../agent-instructions.js";
import { contextAssemblyService } from "./context-assembly.js";
import { loadCommanderPersona } from "./commander-context.js";
import { ensureCommanderAgent } from "./aoa-agents/ensure-commander.js";
```

Inside `chat()`, after the config load + `if (!config)` guard (line ~107) and before the `for await (const chunk of cliService.chat(params, config))` loop (line 125), insert:

```ts
        // Assemble the per-turn prompt (Option B). cli-mode is UNCHANGED:
        // it sends params.content verbatim, so substituting content here
        // keeps the spawn shape byte-identical (content-only change).
        let assembledContent = params.content;
        try {
          const commanderAgentId = await ensureCommanderAgent(db, params.companyId);
          const agentRow = await db
            .select({ id: agents.id, companyId: agents.companyId, name: agents.name, adapterConfig: agents.adapterConfig })
            .from(agents)
            .where(eq(agents.id, commanderAgentId))
            .then((r: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null }[]) => r[0] ?? null);
          const persona = agentRow
            ? await loadCommanderPersona({ agent: agentRow, service: agentInstructionsService() })
            : null;
          const assembled = await contextAssemblyService(db).assembleContext(params.companyId, {
            ...(persona ? { systemInstructions: persona } : {}),
            ...(params.pageContext ? { pageContext: params.pageContext } : {}),
            ...(params.departmentContext ? { departmentContext: params.departmentContext } : {}),
            contextTokenBudget: (config as { contextTokenBudget?: number }).contextTokenBudget,
          });
          assembledContent = `${assembled.systemPrompt}\n\n## User Message\n${params.content}`;
        } catch {
          // Any assembly failure → send the raw message (never hard-fail).
          assembledContent = params.content;
        }

        const cliParams = { ...params, content: assembledContent };
```

Then change the loop (line 125) from `cliService.chat(params, config)` to `cliService.chat(cliParams, config)`. **Do not** change what gets persisted: keep `convService.appendMessage(... role:"user", content: params.content ...)` using the ORIGINAL `params.content` (we store the user's real message, not the assembled prompt).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/agent-loop-assembled-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression — existing agent-loop / chat-persist tests stay green**

Run: `cd server && npx vitest run src/__tests__/agent-loop.test.ts` (and any `*chat-persist*` file present)
Expected: PASS — user/assistant persistence unchanged (still uses original `params.content`).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/agent-loop.ts server/src/__tests__/agent-loop-assembled-prompt.test.ts
git commit -m "feat(commander): agent-loop assembles persona into the prompt (Option B, cli-mode untouched)"
```

---

## Milestone M3 — Conversation history into the chat

### Task 3.1: `getMessagesSince` on conversationService

**Files:**
- Modify: `server/src/services/internal-agent/conversation.ts:75-83`
- Test: `server/src/__tests__/conversation-messages-since.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
vi.mock("drizzle-orm", () => ({ and: vi.fn((...a:any)=>({and:a})), eq: vi.fn((a:any,b:any)=>({eq:[a,b]})), desc: vi.fn((x:any)=>x), gt: vi.fn((a:any,b:any)=>({gt:[a,b]})), sql: Object.assign(()=>({}), { raw:()=>({}) }) }));
vi.mock("@armyofagents/db", () => ({ internalAgentConversations: {}, internalAgentMessages: { conversationId: "cid", id: "id", createdAt: "createdAt" } }));
import { conversationService } from "../services/internal-agent/conversation.js";

describe("getMessagesSince", () => {
  it("returns chronological messages strictly after the marker id", async () => {
    const captured: any = {};
    const db: any = { select: () => ({ from: () => ({ where: (w:any)=>{ captured.where = w; return { orderBy: () => ({ limit: () => ({ then: (r:any)=>Promise.resolve([{id:"m2"},{id:"m3"}]).then(r) }) }) }; } }) }) };
    const out = await conversationService(db).getMessagesSince("conv1", "m1", 50);
    expect(out.map((m:any)=>m.id)).toEqual(["m2","m3"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/conversation-messages-since.test.ts`
Expected: FAIL — `getMessagesSince` undefined.

- [ ] **Step 3: Implement — add the method after `getRecentMessages` (line 83)**

Add `gt` to the existing `drizzle-orm` import at `conversation.ts:1`. Then add inside the returned object (after `getRecentMessages`, before `summarizeIfNeeded`):

```ts
    async getMessagesSince(conversationId: string, sinceMessageId: string | null, limit = 50) {
      const base = db
        .select()
        .from(internalAgentMessages)
        .where(
          sinceMessageId
            ? and(eq(internalAgentMessages.conversationId, conversationId), gt(internalAgentMessages.id, sinceMessageId))
            : eq(internalAgentMessages.conversationId, conversationId),
        );
      // Chronological; cap at `limit` most-recent then re-sort ascending.
      const rows = await base
        .orderBy(desc(internalAgentMessages.createdAt), desc(internalAgentMessages.id))
        .limit(limit)
        .then((r: any[]) => r.reverse());
      return rows;
    },
```

> `[verify@exec]`: confirm `internalAgentMessages.id` is monotonic with insertion order (uuid v7 / serial) so `gt(id, marker)` == "after marker". If ids are random uuids, switch the predicate to `gt(createdAt, <marker.createdAt>)` by first loading the marker row's `createdAt`. The expected schema is monotonic; verify in `packages/db/src/schema/` for `internal_agent_messages`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/conversation-messages-since.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/conversation.ts server/src/__tests__/conversation-messages-since.test.ts
git commit -m "feat(commander): conversationService.getMessagesSince (history pairing with summary marker)"
```

### Task 3.2: agent-loop includes history + rolling summary in the assembled prompt

**Files:**
- Modify: `server/src/services/internal-agent/agent-loop.ts` (the assembly block from Task 2.3)
- Test: `server/src/__tests__/agent-loop-history.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
vi.mock("drizzle-orm", () => ({ eq: vi.fn((a:any,b:any)=>({eq:[a,b]})), and: vi.fn((...a:any)=>({and:a})) }));
vi.mock("@armyofagents/db", () => ({ internalAgentConfig: {}, agents: {} }));
const cliCalls:any[]=[];
vi.mock("../services/internal-agent/cli-mode.js", () => ({ cliModeService: () => ({ chat: async function*(p:any){ cliCalls.push(p); yield {type:"text",delta:"ok"}; } }) }));
vi.mock("../services/internal-agent/conversation.js", () => ({
  conversationService: () => ({
    getOrCreateActive: async () => ({ id: "conv1", summarizedContext: "PRIOR SUMMARY", summarizedUpToMessageId: "m1" }),
    appendMessage: async () => ({ id: "mX" }),
    getMessagesSince: async () => ([{ role: "user", content: "older Q" }, { role: "assistant", content: "older A" }]),
  }),
}));
vi.mock("../services/internal-agent/commander-context.js", () => ({ loadCommanderPersona: async () => "PERSONA" }));
import { agentLoopService } from "../services/internal-agent/agent-loop.js";

describe("agent-loop history", () => {
  it("includes the rolling summary and prior turns in the assembled prompt", async () => {
    const db:any = { select: () => ({ from: () => ({ where: () => ({ then: (r:any)=>Promise.resolve([{ cliTool:"claude_cli" }]).then(r) }) }) }) };
    const gen = agentLoopService(db).chat({ companyId:"c1", userId:"u1", userRole:"founder", enabledCapabilities:[], content:"new Q" });
    for await (const _ of gen) {}
    const sent = cliCalls[0].content as string;
    expect(sent).toContain("PRIOR SUMMARY");
    expect(sent).toContain("older Q");
    expect(sent).toContain("older A");
    expect(sent).toContain("new Q");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/agent-loop-history.test.ts`
Expected: FAIL — summary/history absent.

- [ ] **Step 3: Implement — pass summary + history into the assembler**

In the assembly block (Task 2.3), the `conversation` row from `getOrCreateActive` carries `summarizedContext` and `summarizedUpToMessageId`. Load history and pass the summary in. Replace the `assembled = await contextAssemblyService(...)` call with:

```ts
          const history = await convService.getMessagesSince(
            conversation.id,
            (conversation as { summarizedUpToMessageId?: string | null }).summarizedUpToMessageId ?? null,
            50,
          );
          const historyText = history
            .map((m: { role: string; content?: string | null }) => (m.content ? `${m.role}: ${m.content}` : null))
            .filter(Boolean)
            .join("\n");
          const assembled = await contextAssemblyService(db).assembleContext(params.companyId, {
            ...(persona ? { systemInstructions: persona } : {}),
            ...((conversation as { summarizedContext?: string | null }).summarizedContext
              ? { conversationSummary: (conversation as { summarizedContext?: string | null }).summarizedContext }
              : {}),
            ...(params.pageContext ? { pageContext: params.pageContext } : {}),
            ...(params.departmentContext ? { departmentContext: params.departmentContext } : {}),
            contextTokenBudget: (config as { contextTokenBudget?: number }).contextTokenBudget,
          });
          assembledContent =
            `${assembled.systemPrompt}` +
            (historyText ? `\n\n## Conversation So Far\n${historyText}` : "") +
            `\n\n## User Message\n${params.content}`;
```

(`assembleContext` already renders `conversationSummary` as its "Conversation Summary" section — verified `context-assembly.ts:133-136`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/agent-loop-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression**

Run: `cd server && npx vitest run src/__tests__/agent-loop-assembled-prompt.test.ts`
Expected: PASS (still works with no summary/empty history).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/agent-loop.ts server/src/__tests__/agent-loop-history.test.ts
git commit -m "feat(commander): include rolling summary + prior turns in the assembled prompt"
```

---

## Milestone M4 — Compaction (tool-less CLI summarizer + post-turn trigger)

### Task 4.1: tool-less CLI summarizer

**Files:**
- Create: `server/src/services/internal-agent/cli-summarizer.ts`
- Test: `server/src/__tests__/cli-summarizer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
const spawnArgs:any[]=[];
vi.mock("node:child_process", () => ({
  spawn: vi.fn((bin:string,args:string[]) => { spawnArgs.push({bin,args});
    return { stdin:{ write(){}, end(){} }, stdout:{ on(ev:string,cb:any){ if(ev==="data") cb(Buffer.from("SUMMARY TEXT")); } }, stderr:{ on(){} }, on(ev:string,cb:any){ if(ev==="close") cb(0); } };
  }),
}));
import { summarizeViaCli } from "../services/internal-agent/cli-summarizer.js";

describe("summarizeViaCli", () => {
  it("returns the model output and never attaches the MCP bridge", async () => {
    const out = await summarizeViaCli({ cliTool: "claude_cli", cheapModel: "claude-haiku-4-5", transcript: "user: hi\nassistant: yo" });
    expect(out).toBe("SUMMARY TEXT");
    const a = spawnArgs[0].args.join(" ");
    expect(a).not.toContain("--mcp-config");
    expect(a).not.toContain("mcp");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/cli-summarizer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (claude & codex; tool-less; cheap model)**

Create `server/src/services/internal-agent/cli-summarizer.ts`:

```ts
import { spawn } from "node:child_process";
import { platform } from "node:os";

interface SummarizeArgs { cliTool: string; cheapModel?: string | null; transcript: string; }

const PROMPT_PREFIX =
  "Summarize this conversation history concisely, preserving key decisions, action items, and context. Output ONLY the summary:\n\n";

/**
 * Summarize a transcript via the SAME CLI the chat uses, with NO MCP bridge
 * / tool surface (a summary must never trigger tool calls). One-shot, plain
 * prompt, cheap model. Throws on non-zero exit / empty output (caller treats
 * any failure as "skip compaction this turn").
 */
export async function summarizeViaCli(args: SummarizeArgs): Promise<string> {
  const isWin = platform() === "win32";
  const prompt = PROMPT_PREFIX + args.transcript;
  let bin: string;
  let argv: string[];
  let useStdin = false;
  if (args.cliTool === "codex") {
    bin = "codex";
    argv = ["exec", "--json", "-"];
    useStdin = true;
  } else {
    bin = "claude";
    argv = ["-p", isWin ? `"${prompt.replace(/"/g, '""').replace(/%/g, "%%").replace(/\^/g, "^^")}"` : prompt, "--output-format", "text"];
  }
  if (args.cheapModel) argv = [...argv, "--model", args.cheapModel];
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, argv, { stdio: ["pipe", "pipe", "pipe"], shell: isWin });
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.on("close", (code: number) => {
      if (code === 0 && out.trim().length > 0) resolve(out.trim());
      else reject(new Error(`summarizer exit ${code}`));
    });
    child.on("error", reject);
    if (useStdin) { child.stdin.write(prompt); child.stdin.end(); }
  });
}
```

> `[verify@exec]`: confirm `claude --model <id>` / `codex … --model <id>` is the correct cheap-model flag for the installed CLIs; if codex takes the prompt only via stdin (it does — `cli-mode.ts:240-242`), the `--model` placement is after `exec --json` and before `-`. Adjust argv order if the installed codex rejects it. Output parsing for codex is JSONL — if `out` is JSONL, route it through the existing `parseCodexJsonl` (from `@armyofagents/adapter-codex-local/server`) and return its `summary`. Keep claude as plain text.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/cli-summarizer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/cli-summarizer.ts server/src/__tests__/cli-summarizer.test.ts
git commit -m "feat(commander): tool-less CLI summarizer (cheap model, no MCP bridge)"
```

### Task 4.2: refactor `summarizeIfNeeded` to take an injectable summarize fn

**Files:**
- Modify: `server/src/services/internal-agent/conversation.ts:85-152`
- Test: `server/src/__tests__/conversation-summarize-injectable.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn(), desc: vi.fn(), gt: vi.fn(), sql: Object.assign((s?:any)=>s,{ }) }));
vi.mock("@armyofagents/db", () => ({ internalAgentConversations: {}, internalAgentMessages: {} }));
import { conversationService } from "../services/internal-agent/conversation.js";

describe("summarizeIfNeeded injectable summarizer", () => {
  it("calls the injected summarize() with the old-message transcript and stores the result", async () => {
    let updated:any=null;
    const old = Array.from({length:25},(_,i)=>({ id:`m${i}`, role:"user", content:`msg${i}` }));
    const db:any = {
      select: (proj?:any) => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ then:(r:any)=>Promise.resolve(old.slice(0,5)).then(r) }) }), then:(r:any)=>Promise.resolve(proj?[{count:25}]:old).then(r) }) }) }),
      update: () => ({ set:(v:any)=>{ updated=v; return { where: ()=>Promise.resolve([]) }; } }),
    };
    const summarize = vi.fn(async (t:string)=>`SUM(${t.length})`);
    await conversationService(db).summarizeIfNeeded("conv1", summarize);
    expect(summarize).toHaveBeenCalled();
    expect(updated.summarizedContext).toMatch(/^SUM\(/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/conversation-summarize-injectable.test.ts`
Expected: FAIL — signature still `(conversationId, provider, config)`.

- [ ] **Step 3: Implement — replace the provider dependency with a `summarize` fn**

In `conversation.ts`, change `summarizeIfNeeded` signature (line 85-89) to:

```ts
    async summarizeIfNeeded(
      conversationId: string,
      summarize: (transcript: string) => Promise<string>,
    ) {
```

Delete the `provider.chat(...)` block (lines ~123-141) and replace with:

```ts
      const summary = await summarize(transcript);
      if (!summary || !summary.trim()) return;
```

Keep the count/threshold/oldMessages/transcript build (lines 90-121) and the final `db.update(...).set({ summarizedContext: summary, summarizedUpToMessageId: lastOldMessage.id, … })` (lines 143-151) unchanged. Remove the now-unused `LLMProvider`/`ChatMessage` import if it becomes unused (check; `MessageInput` etc. stay).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/conversation-summarize-injectable.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression — typecheck (the old caller signature changed)**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`
Expected: PASS — no remaining `summarizeIfNeeded(id, provider, config)` callers (agent-loop.ts:62-69 doc already states it is orphaned/unused; confirm grep finds no live call).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/conversation.ts server/src/__tests__/conversation-summarize-injectable.test.ts
git commit -m "refactor(commander): summarizeIfNeeded takes an injectable summarize fn (no API provider)"
```

### Task 4.3: agent-loop triggers compaction post-turn (graceful)

**Files:**
- Modify: `server/src/services/internal-agent/agent-loop.ts` (after assistant persist, ~line 140)
- Test: `server/src/__tests__/agent-loop-compaction.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@armyofagents/db", () => ({ internalAgentConfig:{}, agents:{} }));
vi.mock("../services/internal-agent/cli-mode.js", () => ({ cliModeService: () => ({ chat: async function*(){ yield {type:"text",delta:"reply"}; } }) }));
const summarizeIfNeeded = vi.fn(async ()=>{});
vi.mock("../services/internal-agent/conversation.js", () => ({
  conversationService: () => ({
    getOrCreateActive: async () => ({ id:"conv1", summarizedContext:null, summarizedUpToMessageId:null }),
    appendMessage: async () => ({ id:"m1" }),
    getMessagesSince: async () => [],
    summarizeIfNeeded,
  }),
}));
vi.mock("../services/internal-agent/commander-context.js", () => ({ loadCommanderPersona: async () => "P" }));
vi.mock("../services/internal-agent/cli-summarizer.js", () => ({ summarizeViaCli: vi.fn(async ()=> "S") }));
import { agentLoopService } from "../services/internal-agent/agent-loop.js";

describe("agent-loop compaction", () => {
  it("calls summarizeIfNeeded after a clean turn and never throws when it fails", async () => {
    summarizeIfNeeded.mockRejectedValueOnce(new Error("boom"));
    const db:any = { select: () => ({ from: () => ({ where: () => ({ then:(r:any)=>Promise.resolve([{ cliTool:"claude_cli", cheapModel:"claude-haiku-4-5" }]).then(r) }) }) }) };
    const gen = agentLoopService(db).chat({ companyId:"c1", userId:"u1", userRole:"founder", enabledCapabilities:[], content:"q" });
    const chunks:any[]=[]; for await (const c of gen) chunks.push(c);
    expect(summarizeIfNeeded).toHaveBeenCalled();
    expect(chunks.some(c=>c.type==="text")).toBe(true); // reply still delivered despite summarize throw
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/agent-loop-compaction.test.ts`
Expected: FAIL — `summarizeIfNeeded` never called.

- [ ] **Step 3: Implement — post-turn compaction**

In `agent-loop.ts`, add import: `import { summarizeViaCli } from "./cli-summarizer.js";`. After the assistant message is appended (the `if (accumulatedAssistant.trim()) { await convService.appendMessage(...) }` block, ~line 140), add:

```ts
        // Post-turn compaction (graceful: never blocks/raises into the turn).
        try {
          await convService.summarizeIfNeeded(conversation.id, (transcript) =>
            summarizeViaCli({
              cliTool: (config as { cliTool?: string }).cliTool ?? "claude_cli",
              cheapModel: (config as { cheapModel?: string | null }).cheapModel ?? null,
              transcript,
            }),
          );
        } catch {
          // swallow — a failed compaction must never affect the delivered reply
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/agent-loop-compaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/agent-loop.ts server/src/__tests__/agent-loop-compaction.test.ts
git commit -m "feat(commander): post-turn compaction via tool-less CLI summarizer (graceful)"
```

---

## Milestone M5 — Company memory relevance injection

### Task 5.1: assembleContext memory section via injected semantic search (approved identity+domain, keyword fallback)

**Files:**
- Modify: `server/src/services/internal-agent/context-assembly.ts:69-131` (the Company Identity + Department memory blocks)
- Test: `server/src/__tests__/context-assembly-memory-relevance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { contextAssemblyService } from "../services/internal-agent/context-assembly.js";

const db:any = { select: () => ({ from: () => ({ where: () => ({ then:(r:any)=>Promise.resolve([]).then(r) }) }) }) };

describe("assembleContext relevance memory", () => {
  it("includes only the injected relevant approved items, not a blind dump", async () => {
    const memorySearch = vi.fn(async (_q:string)=>([{ title:"Refund policy", content:"30 day window", layer:"domain" }]));
    const out = await contextAssemblyService(db).assembleContext("c1", {
      systemInstructions: "P",
      relevanceQuery: "how do refunds work",
      memorySearch,
    });
    expect(memorySearch).toHaveBeenCalledWith("how do refunds work");
    expect(out.systemPrompt).toContain("Refund policy");
    expect(out.systemPrompt).toContain("30 day window");
  });
  it("omits the memory section when search yields nothing / throws (graceful)", async () => {
    const out = await contextAssemblyService(db).assembleContext("c1", {
      systemInstructions:"P", relevanceQuery:"x", memorySearch: async ()=>{ throw new Error("no key"); },
    });
    expect(out.systemPrompt).toContain("P");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/context-assembly-memory-relevance.test.ts`
Expected: FAIL — options ignored.

- [ ] **Step 3: Implement — DI memory search; preserve approved identity+domain scope**

In `context-assembly.ts` add to `options`: `relevanceQuery?: string;` and `memorySearch?: (query: string) => Promise<Array<{ title?: string; content?: string; layer?: string }>>;`. Replace the **Company Identity memory-items query** (lines ~81-98) and the **Department domain memory-items query** (lines ~113-129) so that, when `options.memorySearch` is provided, the assembler uses it instead of the blind DB dump:

```ts
      // Relevance-ranked approved memory (identity + department domain).
      // Falls back to nothing on error — never hard-fail (DI hides the
      // pgvector-or-keyword decision; memory.ts handles the no-API-key case).
      if (options.memorySearch && options.relevanceQuery) {
        try {
          const items = await options.memorySearch(options.relevanceQuery);
          const scoped = items.filter((m) => m.layer === "identity" || m.layer === "domain");
          if (scoped.length > 0) {
            addSection(
              "Relevant Company Memory",
              scoped.map((m) => `${m.title ?? "Memory"}: ${m.content ?? ""}`).join("\n"),
            );
          }
        } catch {
          // omit the section; the rest of the prompt is unaffected
        }
      } else {
        // Legacy path retained for non-Commander callers (byte-identical):
        // <keep the existing company-identity + department blocks exactly>
      }
```

Move the existing vision/mission + identity-items + department blocks verbatim into the `else` branch (do not delete them — non-Commander callers and the no-`memorySearch` path must keep the prior behavior). The vision/mission lines stay outside this conditional (they are company fields, not memory).

> `[verify@exec] P1`: `memory.ts` `searchSemantic` already hard-filters `status='approved'`; the `.layer` field name on returned items must match (`identity`/`domain`). Confirm the returned item shape exposes `title`, `content`, `layer`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/context-assembly-memory-relevance.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression — existing context-assembly + system-instructions tests green**

Run: `cd server && npx vitest run src/__tests__/context-assembly-system-instructions.test.ts`
Expected: PASS (legacy `else` path unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/internal-agent/context-assembly.ts server/src/__tests__/context-assembly-memory-relevance.test.ts
git commit -m "feat(commander): relevance-ranked approved memory injection (DI, keyword fallback, legacy path preserved)"
```

### Task 5.2: agent-loop wires the real memory search into the assembler

**Files:**
- Modify: `server/src/services/internal-agent/agent-loop.ts` (assembly block)
- Test: `server/src/__tests__/agent-loop-memory-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@armyofagents/db", () => ({ internalAgentConfig:{}, agents:{} }));
const cliCalls:any[]=[];
vi.mock("../services/internal-agent/cli-mode.js", () => ({ cliModeService: () => ({ chat: async function*(p:any){ cliCalls.push(p); yield {type:"text",delta:"x"}; } }) }));
vi.mock("../services/internal-agent/conversation.js", () => ({ conversationService: () => ({ getOrCreateActive: async()=>({id:"c",summarizedContext:null,summarizedUpToMessageId:null}), appendMessage: async()=>({id:"m"}), getMessagesSince: async()=>[], summarizeIfNeeded: async()=>{} }) }));
vi.mock("../services/internal-agent/commander-context.js", () => ({ loadCommanderPersona: async()=>"P" }));
const searchSemantic = vi.fn(async ()=>[{ title:"T", content:"C", layer:"domain" }]);
vi.mock("../services/memory.js", () => ({ memoryService: () => ({ searchSemantic }) }));
import { agentLoopService } from "../services/internal-agent/agent-loop.js";

describe("agent-loop memory wiring", () => {
  it("passes the user's message as the relevance query and injects results", async () => {
    const db:any = { select:()=>({ from:()=>({ where:()=>({ then:(r:any)=>Promise.resolve([{cliTool:"claude_cli"}]).then(r) }) }) }) };
    for await (const _ of agentLoopService(db).chat({ companyId:"c1", userId:"u1", userRole:"founder", enabledCapabilities:[], content:"refund question" })) {}
    expect(searchSemantic).toHaveBeenCalled();
    expect(cliCalls[0].content).toContain("T");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/agent-loop-memory-wiring.test.ts`
Expected: FAIL — memory not wired.

- [ ] **Step 3: Implement — supply `memorySearch` + `relevanceQuery`**

In `agent-loop.ts` add `import { memoryService } from "../memory.js";` `[verify@exec P1: confirm factory + method name]`. In the `assembleContext` options object add:

```ts
            relevanceQuery: params.content,
            memorySearch: (q: string) =>
              memoryService(db).searchSemantic(params.companyId, q, { limit: 8 }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/agent-loop-memory-wiring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/internal-agent/agent-loop.ts server/src/__tests__/agent-loop-memory-wiring.test.ts
git commit -m "feat(commander): wire real semantic memory search into the assembler"
```

---

## Milestone M6 — Skills inlined into the assembled prompt

### Task 6.1: resolve + inline Commander skills (graceful skip on failure)

**Files:**
- Create: `server/src/services/internal-agent/commander-skills.ts`
- Modify: `server/src/services/internal-agent/agent-loop.ts` (assembly block)
- Test: `server/src/__tests__/commander-skills-inline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { buildSkillsSection } from "../services/internal-agent/commander-skills.js";

describe("buildSkillsSection", () => {
  it("renders each resolved skill's markdown under a Skills heading", async () => {
    const resolve = vi.fn(async () => ([{ key:"k1", name:"Refunds", markdown:"# Refunds\nDo X" }]));
    const out = await buildSkillsSection({ companyId:"c1", agentId:"a1", resolve });
    expect(out).toContain("## Skills");
    expect(out).toContain("Refunds");
    expect(out).toContain("Do X");
  });
  it("returns empty string and never throws when resolution fails", async () => {
    const out = await buildSkillsSection({ companyId:"c1", agentId:"a1", resolve: async()=>{ throw new Error("bad"); } });
    expect(out).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/__tests__/commander-skills-inline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the section builder**

Create `server/src/services/internal-agent/commander-skills.ts`:

```ts
interface RuntimeSkillEntry { key: string; name: string; markdown: string; trustLevel?: string; }
interface BuildArgs {
  companyId: string;
  agentId: string;
  resolve: (companyId: string, agentId: string) => Promise<RuntimeSkillEntry[]>;
  maxChars?: number;
}

/**
 * Build a "## Skills" prompt section from the agent's resolved skills.
 * Inlined into the assembled prompt (the chat path has no skillsDir/cwd
 * plumbing; inlining is adapter-uniform and keeps the spawn byte-stable).
 * Any resolution failure → empty string (never blocks the turn).
 */
export async function buildSkillsSection(args: BuildArgs): Promise<string> {
  try {
    const entries = await args.resolve(args.companyId, args.agentId);
    if (!entries || entries.length === 0) return "";
    const cap = args.maxChars ?? 12000;
    let body = "";
    for (const e of entries) {
      const block = `### ${e.name}\n${e.markdown}\n`;
      if (body.length + block.length > cap) break;
      body += block;
    }
    return body.trim() ? `## Skills\n${body.trim()}` : "";
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/__tests__/commander-skills-inline.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into agent-loop assembly block**

Add `import { buildSkillsSection } from "./commander-skills.js";` and `import { listRuntimeSkillEntries } from "../company-skills.js";` `[verify@exec P2: confirm export name + signature]`. In the assembly block, after `persona` is loaded, build the section and append it before the user message:

```ts
          const skillsSection = await buildSkillsSection({
            companyId: params.companyId,
            agentId: commanderAgentId,
            resolve: (cid, aid) => listRuntimeSkillEntries(cid, aid),
          });
```

and in the `assembledContent` string insert `+ (skillsSection ? \`\n\n${skillsSection}\` : "")` after `assembled.systemPrompt` and before the history section.

- [ ] **Step 6: Run regression (assembled-prompt + history tests still green)**

Run: `cd server && npx vitest run src/__tests__/agent-loop-history.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/internal-agent/commander-skills.ts server/src/services/internal-agent/agent-loop.ts server/src/__tests__/commander-skills-inline.test.ts
git commit -m "feat(commander): inline resolved skills into the assembled prompt (graceful)"
```

---

## Milestone M7 — Regression, degradation, integration

### Task 7.1: spawn-shape byte-identical regression contract test

**Files:**
- Test: `server/src/__tests__/commander-cli-mode-untouched.test.ts`

- [ ] **Step 1: Write the test (this is the invariant guard)**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("cli-mode spawn shape invariant", () => {
  it("cli-mode.ts still sends params.content verbatim and is not modified by this feature", () => {
    const src = readFileSync("src/services/internal-agent/cli-mode.ts", "utf8");
    // claude argv still uses safeContent (= params.content); codex still prompt:params.content
    expect(src).toContain('"-p", safeContent, "--output-format", "text"');
    expect(src).toContain("prompt: params.content");
    // no skillsDir / assembledPrompt plumbing leaked into cli-mode
    expect(src).not.toContain("skillsDir");
    expect(src).not.toContain("assembledPrompt");
  });
});
```

- [ ] **Step 2: Run — expected PASS immediately** (this asserts we did NOT touch cli-mode)

Run: `cd server && npx vitest run src/__tests__/commander-cli-mode-untouched.test.ts`
Expected: PASS. If it FAILS, a prior task wrongly modified cli-mode — revert that change (agent-loop substitution is the only correct seam).

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/commander-cli-mode-untouched.test.ts
git commit -m "test(commander): guard cli-mode spawn-shape byte-identical invariant"
```

### Task 7.2: §17 / runner-untouched regression

- [ ] **Step 1: Run the existing AoA runner + extraction suites unchanged**

Run: `cd server && npx vitest run src/__tests__/aoa-realoutput.integration.test.ts src/__tests__/aoa-submit-extracted-items.test.ts`
Expected: PASS / skip exactly as before this branch (no task in this plan modifies `runner.ts`, extraction, or the §17 path — verify via `git diff --name-only main...HEAD` that none of `runner.ts`/`extraction*`/`aoa-agents/dispatcher.ts` appear from THIS feature's commits).

- [ ] **Step 2: Commit (no-op if clean) — record the verification in the milestone**

(No code change; this is a gate. If anything in the runner/extraction path changed, STOP and escalate — it is out of scope.)

### Task 7.3: consolidated degradation unit test

**Files:**
- Test: `server/src/__tests__/commander-degradation.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it, vi } from "vitest";
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@armyofagents/db", () => ({ internalAgentConfig:{}, agents:{} }));
vi.mock("../services/internal-agent/cli-mode.js", () => ({ cliModeService: () => ({ chat: async function*(){ yield {type:"text",delta:"reply"}; } }) }));
vi.mock("../services/internal-agent/conversation.js", () => ({ conversationService: () => ({ getOrCreateActive: async()=>({id:"c",summarizedContext:null,summarizedUpToMessageId:null}), appendMessage: async()=>({id:"m"}), getMessagesSince: async()=>[], summarizeIfNeeded: async()=>{ throw new Error("sum fail"); } }) }));
vi.mock("../services/internal-agent/commander-context.js", () => ({ loadCommanderPersona: async()=> null })); // missing bundle
vi.mock("../services/memory.js", () => ({ memoryService: () => ({ searchSemantic: async()=>{ throw new Error("no key"); } }) }));
vi.mock("../services/company-skills.js", () => ({ listRuntimeSkillEntries: async()=>{ throw new Error("skill fail"); } }));
import { agentLoopService } from "../services/internal-agent/agent-loop.js";

describe("commander graceful degradation", () => {
  it("missing bundle + no memory key + skill fail + summarize throw → still replies", async () => {
    const db:any = { select:()=>({ from:()=>({ where:()=>({ then:(r:any)=>Promise.resolve([{cliTool:"claude_cli"}]).then(r) }) }) }) };
    const chunks:any[]=[];
    for await (const c of agentLoopService(db).chat({ companyId:"c1", userId:"u1", userRole:"founder", enabledCapabilities:[], content:"q" })) chunks.push(c);
    expect(chunks.some(c=>c.type==="text" && c.delta==="reply")).toBe(true);
    expect(chunks.some(c=>c.type==="error")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expected PASS** (every degradation path is swallowed in earlier tasks)

Run: `cd server && npx vitest run src/__tests__/commander-degradation.test.ts`
Expected: PASS. If any path throws into the turn, fix the corresponding try/catch (M2.3 assembly catch, M4.3 compaction catch, M5.1 memory catch, M6 skills catch).

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/commander-degradation.test.ts
git commit -m "test(commander): consolidated graceful-degradation guarantee"
```

### Task 7.4: integration (Linux-authoritative, win32-skipped)

**Files:**
- Test: `server/src/__tests__/commander-chat-foundation.integration.test.ts`

- [ ] **Step 1: Write the integration test (gated)**

```ts
import { describe, expect, it } from "vitest";
import { platform } from "node:os";

const skip = platform() === "win32" || process.env.AOA_ACCEPTANCE_CLI !== "1";

describe.skipIf(skip)("Commander chat foundation (real CLI)", () => {
  it("a real claude turn carries persona + relevant memory + history; crossing 20 msgs compacts", async () => {
    // Uses the same harness/preconditions as docs/guides/board-operator/aoa-agents-acceptance.md:
    // a running DB (DATABASE_URL), authenticated claude CLI. Drive agentLoopService.chat
    // across >20 turns; assert: (1) the assembled prompt seen by a spy cli-mode contains the
    // Commander persona + an injected approved memory item + prior turns; (2) after >20
    // messages internal_agent_conversations.summarizedContext is non-null and
    // summarizedUpToMessageId advanced; (3) the chat keeps replying post-compaction.
    expect(skip).toBe(false);
  });
});
```

- [ ] **Step 2: Run (skips on Windows/without flag — that is the honest precondition)**

Run: `cd server && npx vitest run src/__tests__/commander-chat-foundation.integration.test.ts`
Expected: SKIPPED on Windows / without `AOA_ACCEPTANCE_CLI=1` (Linux CI with creds runs it).

- [ ] **Step 3: Commit**

```bash
git add server/src/__tests__/commander-chat-foundation.integration.test.ts
git commit -m "test(commander): Linux-authoritative integration (persona+memory+history+compaction)"
```

### Task 7.5: full server suite + typecheck gate

- [ ] **Step 1: Typecheck**

Run: `cd server && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (0 errors).

- [ ] **Step 2: Full server unit/contract suite**

Run: `cd server && npx vitest run`
Expected: All green / pre-existing skips only (no new failures; the prior baseline was 0 failed). If any pre-existing test regressed, fix the cause (do not weaken the test).

- [ ] **Step 3: Update the acceptance doc**

Add a "Commander Chat Foundation" subsection to `docs/guides/board-operator/aoa-agents-acceptance.md` describing the manual check: open the sidebar Commander, send a message that references something said 25+ messages ago, confirm it remembers (history+compaction) and that it answers using an approved company-memory note (relevance injection). Plain `git add` (this file is tracked under docs/guides).

```bash
git add docs/guides/board-operator/aoa-agents-acceptance.md
git commit -m "docs(acceptance): Commander Chat Foundation manual check"
```

---

## Self-review (run by the plan author before handoff)

- **Spec coverage:** Spec Section 1 (bundle/persona) → M1+M2; Section 2 (skills) → M6; Section 3 (conversation memory/compaction) → M3+M4; Section 4 (company memory) → M5; Section 5 (prompt wiring, byte-stable) → M2.3 + M7.1; Section 6 (error handling) → M7.3 + the per-task catches; Section 7 (testing/regression) → M7. Spec "Open items" P1–P5 → carried as `[verify@exec]` gates. All covered.
- **Type consistency:** `loadCommanderPersona`, `seedCommanderInstructionBundle`, `buildSkillsSection`, `summarizeViaCli`, `getMessagesSince`, `summarizeIfNeeded(id, summarize)`, `assembleContext(options.systemInstructions|conversationSummary|relevanceQuery|memorySearch)` are used with identical signatures across tasks.
- **No placeholders:** every code/test step has real code; the only deferred items are explicit `[verify@exec]` signature confirmations (P1/P2 + the id-monotonicity + cheap-model flag), each with the expected shape stated so code stays concrete (consistent with the spec's established `[verify@exec]` discipline).
- **Deviations from spec:** documented in "Spec deviations" (cli-mode untouched; skills inlined; memory DI) — all strictly safer; no scope/product change.
