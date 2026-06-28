# Provider-Switching UI Reconnect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Commander and Crew provider+model picks (onboarding + Settings) actually take effect by writing the live `internal_agent_config` fields and re-ensuring the crew on change.

**Architecture:** `internal_agent_config` is the single source of truth — `cliTool`+`model` drive Commander chat, `provider`+`crewModel` drive the AoA crew. A shared `provider-mapping` module is the one place UI and server agree on provider↔cliTool↔adapter. A single `ensureAllCrewAgents` entrypoint (de-duped from boot/create) is re-run on a provider/crewModel change so existing crew rows migrate via the already-merged `shouldRewriteCrewAdapter`/`mergeCrewAdapterConfig`. The dead `companies.*_adapter_config` columns are deprecated in place.

**Tech Stack:** TypeScript (ESM), React + Vite, Express 5, Drizzle ORM (Postgres), Vitest, Playwright, pnpm workspaces.

**Spec:** `docs/aoa/plans/2026-06-28-provider-switching-ui-reconnect-design.md`

**Conventions for every task below:**
- Worktree root: `C:/Users/TK/.aoa/wt/ps-reconnect` (branch `feat/provider-ui-reconnect`).
- Server unit tests: `cd server && pnpm vitest run <path>`. Shared tests: `cd packages/shared && pnpm vitest run <path>`. UI tests: `cd ui && pnpm vitest run <path>`.
- Typecheck before each commit: `pnpm -w typecheck` (or `pnpm --filter <pkg> typecheck`).
- Stage ONLY the files listed per task. Never `git add -A`.

---

## Task 1: Shared provider-mapping module + `AGENT_PROVIDERS` += opencode

**Files:**
- Create: `packages/shared/src/provider-mapping.ts`
- Modify: `packages/shared/src/constants.ts:931`
- Modify: `packages/shared/src/index.ts` (export the new module)
- Test: `packages/shared/src/__tests__/provider-mapping.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/provider-mapping.test.ts
import { describe, it, expect } from "vitest";
import {
  CREW_PROVIDERS,
  COMMANDER_PROVIDERS,
  providerToCliTool,
  providerToCrewAdapter,
} from "../provider-mapping.js";
import { AGENT_PROVIDERS } from "../constants.js";

describe("provider-mapping", () => {
  it("CREW_PROVIDERS has all four providers; COMMANDER_PROVIDERS excludes google", () => {
    expect([...CREW_PROVIDERS]).toEqual(["anthropic", "openai", "google", "opencode"]);
    expect([...COMMANDER_PROVIDERS]).toEqual(["anthropic", "openai", "opencode"]);
    expect(COMMANDER_PROVIDERS).not.toContain("google");
  });

  it("providerToCliTool maps each commander provider to its CLI", () => {
    expect(providerToCliTool("anthropic")).toBe("claude_cli");
    expect(providerToCliTool("openai")).toBe("codex");
    expect(providerToCliTool("opencode")).toBe("opencode");
  });

  it("providerToCrewAdapter maps each crew provider to its adapter", () => {
    expect(providerToCrewAdapter("anthropic")).toBe("claude_local");
    expect(providerToCrewAdapter("openai")).toBe("codex_local");
    expect(providerToCrewAdapter("google")).toBe("gemini_local");
    expect(providerToCrewAdapter("opencode")).toBe("opencode_local");
  });

  it("AGENT_PROVIDERS now includes opencode", () => {
    expect([...AGENT_PROVIDERS]).toEqual(["anthropic", "openai", "google", "opencode"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && pnpm vitest run src/__tests__/provider-mapping.test.ts`
Expected: FAIL — cannot find module `../provider-mapping.js`.

- [ ] **Step 3: Create the mapping module**

```ts
// packages/shared/src/provider-mapping.ts
//
// Single source of truth for AoA internal-agent provider mappings. UI and server
// both import these so the provider↔cliTool↔adapter relationship can never drift.
//
// Two surfaces:
//   - Commander (chat): driven by internal_agent_config.cliTool. cli-mode.ts only
//     speaks claude_cli / codex / opencode → no google (gemini has no chat path).
//   - Crew (8 AoA agents): driven by internal_agent_config.provider → crew adapter.
//     resolveCrewAdapterFor (server) is the runtime authority; providerToCrewAdapter
//     is the lightweight label map and MUST agree with it (asserted in a server test).

export const CREW_PROVIDERS = ["anthropic", "openai", "google", "opencode"] as const;
export type CrewProvider = (typeof CREW_PROVIDERS)[number];

export const COMMANDER_PROVIDERS = ["anthropic", "openai", "opencode"] as const;
export type CommanderProvider = (typeof COMMANDER_PROVIDERS)[number];

export type CliTool = "claude_cli" | "codex" | "opencode";
export type CrewAdapterType = "claude_local" | "codex_local" | "gemini_local" | "opencode_local";

/** provider → Commander cliTool (internal_agent_config.cliTool). */
export function providerToCliTool(p: CommanderProvider): CliTool {
  switch (p) {
    case "anthropic": return "claude_cli";
    case "openai": return "codex";
    case "opencode": return "opencode";
  }
}

/** provider → crew adapterType. Mirrors resolveCrewAdapterFor's adapter choice. */
export function providerToCrewAdapter(p: CrewProvider): CrewAdapterType {
  switch (p) {
    case "anthropic": return "claude_local";
    case "openai": return "codex_local";
    case "google": return "gemini_local";
    case "opencode": return "opencode_local";
  }
}
```

- [ ] **Step 4: Add opencode to `AGENT_PROVIDERS`**

In `packages/shared/src/constants.ts:931`, change:

```ts
export const AGENT_PROVIDERS = ["anthropic", "openai", "google"] as const;
```
to:
```ts
// NOTE: opencode is a first-class crew provider (resolveCrewAdapterFor handles it).
// AGENT_MODELS_BY_PROVIDER below is dead/unused (no live consumer) — do not extend it.
export const AGENT_PROVIDERS = ["anthropic", "openai", "google", "opencode"] as const;
```

- [ ] **Step 5: Export the module**

In `packages/shared/src/index.ts`, add alongside the other exports (near the `AGENT_PROVIDERS` export at ~line 217):

```ts
export {
  CREW_PROVIDERS,
  COMMANDER_PROVIDERS,
  providerToCliTool,
  providerToCrewAdapter,
} from "./provider-mapping.js";
export type { CrewProvider, CommanderProvider, CliTool, CrewAdapterType } from "./provider-mapping.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/shared && pnpm vitest run src/__tests__/provider-mapping.test.ts`
Expected: PASS (4/4).

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter @armyofagents/shared typecheck
git add packages/shared/src/provider-mapping.ts packages/shared/src/constants.ts packages/shared/src/index.ts packages/shared/src/__tests__/provider-mapping.test.ts
git commit -m "feat(provider-switching): shared provider-mapping module + opencode in AGENT_PROVIDERS"
```

> ⚠️ Adding opencode to `AGENT_PROVIDERS` widens `AGENT_MODELS_BY_PROVIDER`'s `Record<AgentProvider, …>` type — it will now error for a missing `opencode` key. `AGENT_MODELS_BY_PROVIDER` is dead/unused; change its type annotation to `Partial<Record<AgentProvider, …>>` in the same commit to satisfy the compiler without inventing model lists. Verify with the typecheck step.

---

## Task 2: Add `crewModel` column to `internal_agent_config`

**Files:**
- Modify: `packages/db/src/schema/internal_agent.ts:38`
- Generated: `packages/db/src/migrations/<NNNN>_*.sql` (via `pnpm db:generate`)

- [ ] **Step 1: Add the column**

In `packages/db/src/schema/internal_agent.ts`, immediately after the `model` column (line 38) and its `cheapModel` sibling, add:

```ts
    // Crew model override (provider-switching reconnect). When set + valid for the
    // company's `provider`, resolveCrewAdapterFor uses it instead of the per-provider
    // default. Validated per provider (codex-model.ts) — an invalid value falls back
    // to the default, never breaks a run.
    crewModel: text("crew_model"),
```

Also fix the now-false comment on the `provider` column (lines ~33-37). Replace the "Legacy API-mode settings (dormant … Not read by the dispatch path.)" block with:

```ts
    // Crew provider (provider-switching). READ by resolveCrewAdapterForCompany to
    // pick the crew CLI adapter (claude_local/codex_local/gemini_local/opencode_local).
    // This is the live source of truth for the AoA crew — NOT dormant.
    provider: text("provider").default("anthropic"), // 'anthropic'|'openai'|'google'|'opencode'
    model: text("model").default("claude-sonnet-4-6"), // Commander cli-mode model (codex --model)
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `packages/db/src/migrations/<NNNN>_*.sql` containing
`ALTER TABLE "internal_agent_config" ADD COLUMN "crew_model" text;` and an updated snapshot.

- [ ] **Step 3: Verify the migration is additive-only**

Run: `git diff --stat packages/db/src/migrations`
Expected: one new `.sql` + one new meta snapshot + journal update. The `.sql` must contain ONLY the `ADD COLUMN "crew_model"` statement (no drops/renames). If it contains anything else, stop and investigate drift.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/internal_agent.ts packages/db/src/migrations
git commit -m "feat(provider-switching): add internal_agent_config.crew_model column"
```

---

## Task 3: Accept `opencode` provider + `crewModel` in both config validators

**Files:**
- Modify: `server/src/routes/internal-agent.ts:60-64` (route-local `updateConfigSchema`)
- Modify: `packages/shared/src/validators/internal-agent.ts:10-14` (shared schema)
- Test: `server/src/__tests__/internal-agent-config-validator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/__tests__/internal-agent-config-validator.test.ts
import { describe, it, expect } from "vitest";
import { updateInternalAgentConfigSchema } from "@armyofagents/shared";

describe("updateInternalAgentConfigSchema", () => {
  it("accepts provider=opencode", () => {
    const r = updateInternalAgentConfigSchema.safeParse({ provider: "opencode" });
    expect(r.success).toBe(true);
  });
  it("accepts a crewModel string", () => {
    const r = updateInternalAgentConfigSchema.safeParse({ crewModel: "openai/gpt-5.2-codex" });
    expect(r.success).toBe(true);
  });
  it("accepts null crewModel (clear override)", () => {
    const r = updateInternalAgentConfigSchema.safeParse({ crewModel: null });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown provider", () => {
    const r = updateInternalAgentConfigSchema.safeParse({ provider: "mistral" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm vitest run src/__tests__/internal-agent-config-validator.test.ts`
Expected: FAIL — `crewModel` accepted? No; `provider=opencode` rejected by current `z.enum(AGENT_PROVIDERS)` only after Task 1… Task 1 already added opencode to `AGENT_PROVIDERS`, so the shared schema accepts opencode; the `crewModel` cases FAIL (unknown key is stripped, not validated — assert presence instead). To make the crewModel assertion meaningful, change the test to assert the parsed output carries it (see Step 1 already uses `success`; add `expect(r.data?.crewModel)` below). Concretely the test fails because `crewModel` is unknown and the shared schema has no such key yet.

- [ ] **Step 3: Add `crewModel` to the shared schema**

In `packages/shared/src/validators/internal-agent.ts`, inside `updateInternalAgentConfigSchema` (after the `model` line ~13), add:

```ts
  crewModel: z.string().optional().nullable(),
```

(The `provider: z.enum(AGENT_PROVIDERS)` line already picks up `opencode` from Task 1.)

- [ ] **Step 4: Fix the route-local schema**

In `server/src/routes/internal-agent.ts`, replace the inline enum + add crewModel. Change lines 62-63:

```ts
  provider: z.enum(["anthropic", "openai", "google"]).optional(),
  model: z.string().optional(),
```
to:
```ts
  provider: z.enum(AGENT_PROVIDERS).optional(),
  model: z.string().optional(),
  crewModel: z.string().nullable().optional(),
```

Add the import at the top of the file (alongside the existing shared imports):

```ts
import { AGENT_PROVIDERS } from "@armyofagents/shared";
```

(If `@armyofagents/shared` is already imported, add `AGENT_PROVIDERS` to that import list instead of a new line.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && pnpm vitest run src/__tests__/internal-agent-config-validator.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @armyofagents/shared typecheck && pnpm --filter @armyofagents/server typecheck
git add server/src/routes/internal-agent.ts packages/shared/src/validators/internal-agent.ts server/src/__tests__/internal-agent-config-validator.test.ts
git commit -m "feat(provider-switching): validators accept opencode provider + crewModel"
```

---

## Task 4: `resolveCrewAdapterFor` model override + read `crewModel`

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/resolve-crew-adapter.ts:31-100`
- Test: `server/src/__tests__/resolve-crew-adapter-model-override.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/__tests__/resolve-crew-adapter-model-override.test.ts
import { describe, it, expect } from "vitest";
import { resolveCrewAdapterFor } from "../services/internal-agent/aoa-agents/resolve-crew-adapter.js";
import { DEFAULT_CODEX_CHAT_MODEL } from "../services/internal-agent/codex-model.js";

describe("resolveCrewAdapterFor model override", () => {
  it("applies a shell-safe claude override for anthropic", () => {
    expect(resolveCrewAdapterFor("anthropic", "claude-opus-4-1").adapterConfig.model).toBe("claude-opus-4-1");
  });
  it("falls back to the anthropic default for a shell-UNSAFE override", () => {
    expect(resolveCrewAdapterFor("anthropic", "evil; rm -rf").adapterConfig.model).toBe("claude-sonnet-4-5-20250929");
  });
  it("applies a codex-compatible override for openai", () => {
    expect(resolveCrewAdapterFor("openai", "gpt-5.5").adapterConfig.model).toBe("gpt-5.5");
  });
  it("rejects a codex-INCOMPATIBLE override (gpt-4o) → openai default", () => {
    expect(resolveCrewAdapterFor("openai", "gpt-4o").adapterConfig.model).toBe(DEFAULT_CODEX_CHAT_MODEL);
  });
  it("requires slash form for opencode override; bare → default", () => {
    expect(resolveCrewAdapterFor("opencode", "anthropic/claude-sonnet-4").adapterConfig.model).toBe("anthropic/claude-sonnet-4");
    expect(resolveCrewAdapterFor("opencode", "gpt-5.5").adapterConfig.model).toBe("openai/gpt-5.2-codex");
  });
  it("applies a shell-safe gemini override for google", () => {
    expect(resolveCrewAdapterFor("google", "gemini-2.0-flash").adapterConfig.model).toBe("gemini-2.0-flash");
  });
  it("no override → unchanged per-provider defaults", () => {
    expect(resolveCrewAdapterFor("anthropic").adapterConfig.model).toBe("claude-sonnet-4-5-20250929");
    expect(resolveCrewAdapterFor("google").adapterConfig.model).toBe("gemini-2.5-pro");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm vitest run src/__tests__/resolve-crew-adapter-model-override.test.ts`
Expected: FAIL — `resolveCrewAdapterFor` ignores the 2nd argument (defaults applied always).

- [ ] **Step 3: Implement the override**

In `server/src/services/internal-agent/aoa-agents/resolve-crew-adapter.ts`, update the import line (currently `import { DEFAULT_CODEX_CHAT_MODEL, isCodexCompatibleModel } from "../codex-model.js";`) to:

```ts
import { DEFAULT_CODEX_CHAT_MODEL, isCodexCompatibleModel, isShellSafeModel, SAFE_MODEL_RE } from "../codex-model.js";
```

Replace the body of `resolveCrewAdapterFor` (lines 30-86) with:

```ts
export function resolveCrewAdapterFor(
  provider: string | null | undefined,
  modelOverride?: string | null,
): CrewAdapter {
  const ov = modelOverride?.trim() || "";
  switch (provider) {
    case "anthropic":
      return {
        adapterType: "claude_local",
        adapterConfig: {
          model: SAFE_MODEL_RE.test(ov) ? ov : "claude-sonnet-4-5-20250929",
          dangerouslySkipPermissions: true,
        },
      };
    case "google":
      return {
        adapterType: "gemini_local",
        adapterConfig: {
          model: SAFE_MODEL_RE.test(ov) ? ov : "gemini-2.5-pro",
        },
      };
    case "opencode":
      return {
        adapterType: "opencode_local",
        adapterConfig: {
          // opencode ids are slash-format `provider/model`; require a slash so a
          // bare codex id can't reach opencode. isShellSafeModel validates each segment.
          model: ov.includes("/") && isShellSafeModel(ov) ? ov : "openai/gpt-5.2-codex",
        },
      };
    case "openai":
    default:
      return {
        adapterType: "codex_local",
        adapterConfig: {
          // codex models must pass isCodexCompatibleModel (rejects gpt-4o, *-codex).
          model: isCodexCompatibleModel(ov) ? ov : DEFAULT_CODEX_CHAT_MODEL,
          dangerouslyBypassApprovalsAndSandbox: true,
        },
      };
  }
}
```

> Preserve the existing block comments above each case (the `dangerouslySkipPermissions` / `dangerouslyBypassApprovalsAndSandbox` rationale). They explain WHY the flags exist and must not be deleted.

- [ ] **Step 4: Read `crewModel` in `resolveCrewAdapterForCompany`**

Replace the `resolveCrewAdapterForCompany` select (lines ~94-99) with:

```ts
  const rows = await db
    .select({ provider: internalAgentConfig.provider, crewModel: internalAgentConfig.crewModel })
    .from(internalAgentConfig)
    .where(eq(internalAgentConfig.companyId, companyId))
    .limit(1);
  return resolveCrewAdapterFor(rows[0]?.provider, rows[0]?.crewModel);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && pnpm vitest run src/__tests__/resolve-crew-adapter-model-override.test.ts`
Expected: PASS (7/7).

- [ ] **Step 6: Run the existing resolve-crew-adapter suites (no regression)**

Run: `cd server && pnpm vitest run src/__tests__/resolve-crew-adapter.test.ts src/__tests__/resolve-crew-adapter-opencode.test.ts`
Expected: PASS (unchanged behavior with no override).

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter @armyofagents/server typecheck
git add server/src/services/internal-agent/aoa-agents/resolve-crew-adapter.ts server/src/__tests__/resolve-crew-adapter-model-override.test.ts
git commit -m "feat(provider-switching): resolveCrewAdapterFor honors a validated crew model override"
```

---

## Task 5: `ensureAllCrewAgents` helper + de-dupe boot/create

**Files:**
- Create: `server/src/services/internal-agent/aoa-agents/ensure-all-crew.ts`
- Modify: `server/src/index.ts:709-768` (boot loop)
- Modify: `server/src/services/companies.ts:158-193` (create path)
- Test: `server/src/__tests__/ensure-all-crew.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/__tests__/ensure-all-crew.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
vi.mock("../services/internal-agent/aoa-agents/ensure-commander.js", () => ({ ensureCommanderAgent: vi.fn(async () => { calls.push("commander"); return "c"; }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-command-staff.js", () => ({ ensureCommandStaff: vi.fn(async () => { calls.push("staff"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-adjutant.js", () => ({ ensureAdjutant: vi.fn(async () => { calls.push("adjutant"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-scout.js", () => ({ ensureScout: vi.fn(async () => { calls.push("scout"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-engineer.js", () => ({ ensureEngineer: vi.fn(async () => { calls.push("engineer"); }) }));
vi.mock("../services/internal-agent/aoa-agents/ensure-chronicler.js", () => ({ ensureChronicler: vi.fn(async () => { calls.push("chronicler"); }) }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));

import { ensureAllCrewAgents } from "../services/internal-agent/aoa-agents/ensure-all-crew.js";

describe("ensureAllCrewAgents", () => {
  beforeEach(() => { calls.length = 0; });

  it("runs all six crew ensures", async () => {
    await ensureAllCrewAgents({} as any, "co-1");
    expect(calls.sort()).toEqual(["adjutant", "chronicler", "commander", "engineer", "scout", "staff"]);
  });

  it("one failing ensure does not abort the rest", async () => {
    const mod = await import("../services/internal-agent/aoa-agents/ensure-scout.js");
    (mod.ensureScout as any).mockRejectedValueOnce(new Error("boom"));
    await ensureAllCrewAgents({} as any, "co-1");
    // scout threw, but the other five still ran
    expect(calls).toContain("commander");
    expect(calls).toContain("engineer");
    expect(calls.length).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm vitest run src/__tests__/ensure-all-crew.test.ts`
Expected: FAIL — cannot find `ensure-all-crew.js`.

- [ ] **Step 3: Create the helper**

```ts
// server/src/services/internal-agent/aoa-agents/ensure-all-crew.ts
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents } from "@armyofagents/db";
import { logger } from "../../../middleware/logger.js";
import { ensureCommanderAgent } from "./ensure-commander.js";
import { ensureCommandStaff } from "./ensure-command-staff.js";
import { ensureAdjutant } from "./ensure-adjutant.js";
import { ensureScout } from "./ensure-scout.js";
import { ensureEngineer } from "./ensure-engineer.js";
import { ensureChronicler } from "./ensure-chronicler.js";

/**
 * True when this company's AoA crew is governed by an installed marketplace
 * package (non-`@legacy` templateOrigin). When so, the legacy ensure-*
 * seeders must NOT run — the marketplace owns the crew. Mirrors the gate
 * previously inlined in index.ts (boot) and companies.ts (create).
 */
export async function isCrewMarketplaceManaged(db: Db, companyId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          eq(agents.kind, "aoa"),
          sql`${agents.templateOrigin} IS NOT NULL AND ${agents.templateOrigin} NOT LIKE '%@legacy'`,
        ),
      )
      .limit(1);
    return !!row;
  } catch (err) {
    logger.warn({ err, companyId }, "isCrewMarketplaceManaged check failed — defaulting to NOT managed");
    return false;
  }
}

/**
 * Idempotently (re-)seed the full AoA crew for a company. Sequential (not
 * Promise.all) so ensureEngineer's Maker→Engineer rename can never race the
 * other seeds on the unique name index. Each step is independently
 * error-tolerant — one failure must not abort the rest (matches boot/create).
 *
 * Re-running this after a provider/crewModel change migrates existing rows to
 * the newly-resolved adapter via shouldRewriteCrewAdapter + mergeCrewAdapterConfig
 * inside each ensure-*.
 *
 * Callers are responsible for the marketplace gate (isCrewMarketplaceManaged).
 */
export async function ensureAllCrewAgents(db: Db, companyId: string): Promise<void> {
  const steps: Array<readonly [string, () => Promise<unknown>]> = [
    ["commander", () => ensureCommanderAgent(db, companyId)],
    ["command staff", () => ensureCommandStaff(db, companyId)],
    ["adjutant", () => ensureAdjutant(db, companyId)],
    ["scout", () => ensureScout(db, companyId)],
    ["engineer", () => ensureEngineer(db, companyId)],
    ["chronicler", () => ensureChronicler(db, companyId)],
  ];
  for (const [label, fn] of steps) {
    try {
      await fn();
    } catch (err) {
      logger.warn({ err, companyId }, `ensureAllCrewAgents: ${label} failed`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm vitest run src/__tests__/ensure-all-crew.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Refactor the boot loop** (`server/src/index.ts`)

Replace the marketplace-gate-and-`Promise.all` block (the `try { … marketplaceInstalled … } … if (marketplaceInstalled) { … continue; } await Promise.all([ ensureCommandStaff … ensureCommanderAgent … ]);` region, lines ~709-768) with:

```ts
        if (await isCrewMarketplaceManaged(db as any, row.id)) {
          logger.debug({ companyId: row.id }, "crew startup backfill: skipping — marketplace governs");
          continue;
        }
        await ensureAllCrewAgents(db as any, row.id);
```

Add the import near the other aoa-agents imports at the top of `index.ts`:

```ts
import { ensureAllCrewAgents, isCrewMarketplaceManaged } from "./services/internal-agent/aoa-agents/ensure-all-crew.js";
```

Remove the now-unused individual `ensureCommandStaff/ensureAdjutant/ensureChronicler/ensureScout/ensureEngineer/ensureCommanderAgent` imports from `index.ts` **only if** they are not referenced elsewhere in the file (search first: `grep -n "ensureCommandStaff\|ensureAdjutant\|ensureChronicler\|ensureScout\|ensureEngineer\|ensureCommanderAgent" server/src/index.ts`). Keep any that remain referenced.

- [ ] **Step 6: Refactor the create path** (`server/src/services/companies.ts`)

Replace the `if (!mktInstalled) { … six ensure calls … }` block (lines ~158-193) with:

```ts
        if (!mktInstalled) {
          await ensureInternalAgentConfig(db, company.id).catch((err: unknown) => {
            logger.warn({ err, companyId: company.id }, "internal_agent_config seeding failed");
          });
          await ensureAllCrewAgents(db, company.id);
        }
```

Add the import alongside the existing `ensureCommanderAgent` import in `companies.ts`:

```ts
import { ensureAllCrewAgents } from "./internal-agent/aoa-agents/ensure-all-crew.js";
```

Remove the now-unused `ensureCommandStaff/ensureAdjutant/ensureScout/ensureEngineer/ensureChronicler/ensureCommanderAgent` imports from `companies.ts` **only if** unreferenced elsewhere (grep first as in Step 5).

- [ ] **Step 7: Typecheck + run server build sanity + commit**

```bash
pnpm --filter @armyofagents/server typecheck
cd server && pnpm vitest run src/__tests__/ensure-all-crew.test.ts && cd ..
git add server/src/services/internal-agent/aoa-agents/ensure-all-crew.ts server/src/index.ts server/src/services/companies.ts server/src/__tests__/ensure-all-crew.test.ts
git commit -m "refactor(provider-switching): single ensureAllCrewAgents entrypoint; de-dupe boot/create"
```

---

## Task 6: Re-ensure the crew on a provider/crewModel change (config PATCH)

**Files:**
- Modify: `server/src/routes/internal-agent.ts:788-818` (the config PATCH handler)
- Test: `server/src/__tests__/internal-agent-config-reensure.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/__tests__/internal-agent-config-reensure.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const ensureAll = vi.fn(async () => {});
const isManaged = vi.fn(async () => false);
vi.mock("../services/internal-agent/aoa-agents/ensure-all-crew.js", () => ({
  ensureAllCrewAgents: ensureAll,
  isCrewMarketplaceManaged: isManaged,
}));

import { maybeReensureCrewOnConfigChange } from "../routes/internal-agent.js";

describe("maybeReensureCrewOnConfigChange", () => {
  beforeEach(() => { ensureAll.mockClear(); isManaged.mockClear(); isManaged.mockResolvedValue(false); });

  it("re-ensures when provider changed", async () => {
    await maybeReensureCrewOnConfigChange({} as any, "co-1", { provider: "anthropic", crewModel: null }, { provider: "openai", crewModel: null });
    expect(ensureAll).toHaveBeenCalledWith({}, "co-1");
  });
  it("re-ensures when crewModel changed", async () => {
    await maybeReensureCrewOnConfigChange({} as any, "co-1", { provider: "openai", crewModel: null }, { provider: "openai", crewModel: "gpt-5.5" });
    expect(ensureAll).toHaveBeenCalledTimes(1);
  });
  it("does NOT re-ensure when neither changed", async () => {
    await maybeReensureCrewOnConfigChange({} as any, "co-1", { provider: "openai", crewModel: "gpt-5.5" }, { provider: "openai", crewModel: "gpt-5.5" });
    expect(ensureAll).not.toHaveBeenCalled();
  });
  it("skips when marketplace-managed", async () => {
    isManaged.mockResolvedValue(true);
    await maybeReensureCrewOnConfigChange({} as any, "co-1", { provider: "anthropic", crewModel: null }, { provider: "openai", crewModel: null });
    expect(ensureAll).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm vitest run src/__tests__/internal-agent-config-reensure.test.ts`
Expected: FAIL — `maybeReensureCrewOnConfigChange` is not exported.

- [ ] **Step 3: Add the exported helper + wire it into the PATCH handler**

In `server/src/routes/internal-agent.ts`, add this exported pure-ish helper near the top of the module (after imports, before the router factory). It is exported so it can be unit-tested directly:

```ts
import { ensureAllCrewAgents, isCrewMarketplaceManaged } from "../services/internal-agent/aoa-agents/ensure-all-crew.js";
import type { Db } from "@armyofagents/db";

/**
 * Re-seed the crew after a config PATCH iff the crew-affecting fields changed
 * (provider or crewModel) and the crew isn't marketplace-managed. The actual
 * row migration happens inside the ensure-* helpers via shouldRewriteCrewAdapter
 * + mergeCrewAdapterConfig.
 */
export async function maybeReensureCrewOnConfigChange(
  db: Db,
  companyId: string,
  before: { provider: string | null; crewModel: string | null },
  after: { provider: string | null; crewModel: string | null },
): Promise<void> {
  const changed = before.provider !== after.provider || before.crewModel !== after.crewModel;
  if (!changed) return;
  if (await isCrewMarketplaceManaged(db, companyId)) return;
  await ensureAllCrewAgents(db, companyId);
}
```

Now modify the PATCH handler (lines ~806-816). Replace:

```ts
      const [updated] = await db
        .update(internalAgentConfig)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(internalAgentConfig.companyId, companyId))
        .returning();

      if (!updated) {
        throw notFound("Internal agent config not found");
      }

      res.json(updated);
```

with:

```ts
      // Read the crew-affecting fields BEFORE the update so we can detect a change.
      const [prior] = await db
        .select({ provider: internalAgentConfig.provider, crewModel: internalAgentConfig.crewModel })
        .from(internalAgentConfig)
        .where(eq(internalAgentConfig.companyId, companyId))
        .limit(1);

      const [updated] = await db
        .update(internalAgentConfig)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(internalAgentConfig.companyId, companyId))
        .returning();

      if (!updated) {
        throw notFound("Internal agent config not found");
      }

      // Migrate existing crew rows to the newly-resolved adapter when the crew
      // provider/model actually changed (no-op otherwise). Best-effort: a crew
      // re-seed failure must not fail the settings save.
      try {
        await maybeReensureCrewOnConfigChange(
          db,
          companyId,
          { provider: prior?.provider ?? null, crewModel: prior?.crewModel ?? null },
          { provider: updated.provider ?? null, crewModel: updated.crewModel ?? null },
        );
      } catch (err) {
        logger.warn({ err, companyId }, "crew re-ensure after config PATCH failed");
      }

      res.json(updated);
```

Ensure `logger` is imported in this file (it is used elsewhere in routes; if not, add `import { logger } from "../middleware/logger.js";`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm vitest run src/__tests__/internal-agent-config-reensure.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Run the existing internal-agent route contract test (no regression)**

Run: `cd server && pnpm vitest run src/__tests__/internal-agent-routes-contract.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @armyofagents/server typecheck
git add server/src/routes/internal-agent.ts server/src/__tests__/internal-agent-config-reensure.test.ts
git commit -m "feat(provider-switching): re-ensure crew when config PATCH changes provider/crewModel"
```

---

## Task 7: `rateModelForCliTool` opencode case

**Files:**
- Modify: `server/src/services/internal-agent/run-cost.ts:32-43`
- Test: `server/src/__tests__/run-cost-rate-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/__tests__/run-cost-rate-model.test.ts
import { describe, it, expect } from "vitest";
import { rateModelForCliTool } from "../services/internal-agent/run-cost.js";

describe("rateModelForCliTool", () => {
  it("opencode is priced as openai, not anthropic", () => {
    const r = rateModelForCliTool("opencode", null);
    expect(r.provider).toBe("openai");
  });
  it("codex stays openai", () => {
    expect(rateModelForCliTool("codex", null).provider).toBe("openai");
  });
  it("claude_cli stays anthropic and honors a configured model", () => {
    expect(rateModelForCliTool("claude_cli", "claude-opus-4-1")).toEqual({ provider: "anthropic", model: "claude-opus-4-1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm vitest run src/__tests__/run-cost-rate-model.test.ts`
Expected: FAIL — opencode falls through `default` → provider `anthropic`.

- [ ] **Step 3: Add the opencode case**

In `server/src/services/internal-agent/run-cost.ts`, in `rateModelForCliTool`'s switch (line ~36), add a case before `claude_cli`:

```ts
    case "opencode":
      return { provider: "openai", model: "gpt-5.2-codex" };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm vitest run src/__tests__/run-cost-rate-model.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @armyofagents/server typecheck
git add server/src/services/internal-agent/run-cost.ts server/src/__tests__/run-cost-rate-model.test.ts
git commit -m "fix(provider-switching): price opencode Commander runs as openai, not anthropic"
```

---

## Task 8: Deprecate the dead `companies.*_adapter_config` columns (comments only)

**Files:**
- Modify: `packages/db/src/schema/companies.ts:24-45`

- [ ] **Step 1: Update the comments (no migration, no behavior change)**

In `packages/db/src/schema/companies.ts`, replace the comment block above `commanderAdapterConfig`/`crewAdapterConfig` (the lines that currently describe the "Task D6" reader, ~24-30) with:

```ts
    // @deprecated NEVER READ at runtime (the "Task D6" reader was never built).
    // Superseded by internal_agent_config.{cliTool,model,provider,crewModel}, which
    // is the live source of truth for Commander + crew. Kept (not dropped) for
    // rollback safety per AoA convention; onboarding no longer writes them.
    commanderAdapterConfig: jsonb("commander_adapter_config")
```

(Leave the column definitions, defaults, and the `crewAdapterConfig` jsonb exactly as they are — comment change only.)

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @armyofagents/db typecheck
git add packages/db/src/schema/companies.ts
git commit -m "docs(provider-switching): mark companies.*_adapter_config columns deprecated (never read)"
```

---

## Task 9: UI API types — `crewModel` on config

**Files:**
- Modify: `ui/src/api/internal-agent.ts:36-45` (the `InternalAgentConfig` response interface)
- Test: `ui/src/api/__tests__/internal-agent-types.test.ts` (type-level)

- [ ] **Step 1: Write the failing test**

```ts
// ui/src/api/__tests__/internal-agent-types.test.ts
import { describe, it, expect } from "vitest";
import type { InternalAgentConfig } from "../internal-agent";
import type { UpdateInternalAgentConfig } from "@armyofagents/shared";

describe("internal-agent config types carry crewModel", () => {
  it("InternalAgentConfig has provider + crewModel", () => {
    const c: Pick<InternalAgentConfig, "provider" | "crewModel"> = { provider: "openai", crewModel: "gpt-5.5" };
    expect(c.provider).toBe("openai");
    expect(c.crewModel).toBe("gpt-5.5");
  });
  it("UpdateInternalAgentConfig accepts crewModel", () => {
    const u: UpdateInternalAgentConfig = { provider: "opencode", crewModel: "openai/gpt-5.2-codex" };
    expect(u.crewModel).toBe("openai/gpt-5.2-codex");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && pnpm vitest run src/api/__tests__/internal-agent-types.test.ts`
Expected: FAIL — `InternalAgentConfig` has no `crewModel` (compile error / `tsc` failure under vitest).

- [ ] **Step 3: Add `crewModel` to the response interface**

In `ui/src/api/internal-agent.ts`, in the `InternalAgentConfig` interface (it already has `provider: string | null` at line ~39 and `cliTool: string | null` at ~41), add:

```ts
  crewModel: string | null;
```

(`UpdateInternalAgentConfig` comes from `@armyofagents/shared` and already gained `crewModel` in Task 3 — no UI change needed there.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && pnpm vitest run src/api/__tests__/internal-agent-types.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter ui typecheck
git add ui/src/api/internal-agent.ts ui/src/api/__tests__/internal-agent-types.test.ts
git commit -m "feat(provider-switching): UI config type carries crewModel"
```

---

## Task 10: Onboarding writes the live fields (and drops Google from Commander)

**Files:**
- Modify: `ui/src/components/OnboardingWizard.tsx:79-104, 444-475, 891-906`
- Modify: `ui/src/components/__tests__/OnboardingWizard.test.tsx:220-260`

- [ ] **Step 1: Update the onboarding test premise (failing)**

In `ui/src/components/__tests__/OnboardingWizard.test.tsx`, replace the existing
"POSTs /companies with both commanderAdapterConfig and crewAdapterConfig" test
(~lines 220-260) with one asserting the NEW behavior: create is called WITHOUT the
adapter-config keys, and a config PATCH carries the live fields. Use the existing
mock setup in the file; the new assertion body:

```ts
  it("writes live config (cliTool/provider/model/crewModel) via PATCH after create", async () => {
    // ... existing setup that drives the wizard to the Crew step and submits ...
    // create payload must NOT contain the dead adapter-config columns:
    const createPayload = createMock.mock.calls.at(-1)![1];
    expect(createPayload).not.toHaveProperty("commanderAdapterConfig");
    expect(createPayload).not.toHaveProperty("crewAdapterConfig");
    // a config PATCH carries the live fields (commander OpenAI → codex, crew Google → google):
    expect(updateConfigMock).toHaveBeenCalledWith(expect.any(String), {
      cliTool: "codex",
      model: "gpt-5.5",
      provider: "google",
      crewModel: "gemini-2.5-pro",
    });
  });
```

Add `internalAgentApi.updateConfig` to the component's mocked API surface (the test
file already mocks `companiesApi`; mock `internalAgentApi.updateConfig` the same way
and capture it as `updateConfigMock`). Drive step 3 with provider `openai` model
`gpt-5.5` and step 4 with provider `google` model `gemini-2.5-pro`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && pnpm vitest run src/components/__tests__/OnboardingWizard.test.tsx`
Expected: FAIL — wizard still POSTs adapter-config columns and never PATCHes config.

- [ ] **Step 3: Use the shared mapping + drop Google from the Commander picker**

In `ui/src/components/OnboardingWizard.tsx`:

Replace the local `Provider`/`PROVIDER_OPTIONS`/`PROVIDER_LABELS`/`providerToAdapter`
block (lines ~79-104) with imports from shared + a label map for the crew set:

```ts
import {
  CREW_PROVIDERS,
  COMMANDER_PROVIDERS,
  providerToCliTool,
  providerToCrewAdapter,
} from "@armyofagents/shared";
import type { CrewProvider } from "@armyofagents/shared";

type Provider = CrewProvider; // crew supports all four; commander is a subset
const PROVIDER_LABELS: Record<CrewProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (Codex)",
  google: "Google (Gemini)",
  opencode: "OpenCode (multi-provider)",
};
```

`providerToCrewAdapter` replaces the deleted local `providerToAdapter` everywhere
it was used in this file (the step-5 agent default still uses `crewProvider`
mapping — keep that call, just point it at `providerToCrewAdapter`).

In the Commander picker (step 3, line ~901) change the option source from
`PROVIDER_OPTIONS` to `COMMANDER_PROVIDERS`:

```tsx
                      {COMMANDER_PROVIDERS.map((p) => (
                        <option key={p} value={p}>
                          {PROVIDER_LABELS[p]}
                        </option>
                      ))}
```

In the Crew picker (step 4) use `CREW_PROVIDERS` as the option source (same `.map`
shape, all four).

- [ ] **Step 4: PATCH the live fields after create; stop writing dead columns**

In `handleStep4Next` (lines ~452-475), change the `companiesApi.create` call to drop
the adapter-config keys, then add a config PATCH:

```ts
      const company = await companiesApi.create({
        name: companyName.trim(),
      });
      setCreatedCompanyId(company.id);
      setCreatedCompanyPrefix(company.issuePrefix);
      setSelectedCompanyId(company.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });

      // Provider-switching: write the LIVE internal_agent_config fields. Commander
      // (cliTool+model) is a subset of providers (no google — no gemini chat path);
      // crew (provider+crewModel) supports all four. The server re-ensures the crew
      // to the chosen adapter when provider changes from the seeded default.
      await internalAgentApi.updateConfig(company.id, {
        cliTool: providerToCliTool(commanderProvider as Exclude<Provider, "google">),
        model: commanderModel.trim() || null,
        provider: crewProvider as Provider,
        crewModel: crewModel.trim() || null,
      });
```

Add `import { internalAgentApi } from "@/api/internal-agent";` if not already present.

> The Commander picker only offers `COMMANDER_PROVIDERS` (no google), so
> `commanderProvider` is never `"google"` at this point; the `Exclude<…,"google">`
> cast documents that invariant for `providerToCliTool`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ui && pnpm vitest run src/components/__tests__/OnboardingWizard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter ui typecheck
git add ui/src/components/OnboardingWizard.tsx ui/src/components/__tests__/OnboardingWizard.test.tsx
git commit -m "feat(provider-switching): onboarding writes live config; Commander picker drops Google"
```

---

## Task 11: Settings — Crew provider + model controls (and Commander model)

**Files:**
- Modify: `ui/src/components/settings/sections/CommanderSection.tsx:158-340, 691-861`
- Test: `ui/src/components/settings/sections/__tests__/CommanderSection.execution.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// ui/src/components/settings/sections/__tests__/CommanderSection.execution.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
// Reuse the project's standard test providers (QueryClient + CompanyContext).
// Mock internalAgentApi.updateConfig and getConfig.
import { internalAgentApi } from "@/api/internal-agent";
import { CommanderSection } from "../CommanderSection";
import { renderWithProviders } from "@/test/render"; // existing helper

vi.mock("@/api/internal-agent", async (orig) => {
  const mod = await (orig as any)();
  return {
    ...mod,
    internalAgentApi: {
      ...mod.internalAgentApi,
      getConfig: vi.fn(async () => ({
        cliTool: "claude_cli", provider: "anthropic", model: null, crewModel: null,
        enabledCapabilities: [], notificationPreference: "realtime", contextTokenBudget: 8000,
        budgetMonthlyCents: 5000, spentMonthlyCents: 0, proactiveIntervalMinutes: 240,
        runtimeApprovalsEnabled: true, runtimeAllowAlwaysEnabled: true, vendorCliBypassEnabled: true,
      })),
      updateConfig: vi.fn(async () => ({})),
    },
  };
});

describe("CommanderSection execution tab — crew provider", () => {
  it("saves provider + crewModel when the crew control changes", async () => {
    renderWithProviders(<CommanderSection />);
    await screen.findByLabelText(/crew provider/i);
    fireEvent.change(screen.getByLabelText(/crew provider/i), { target: { value: "openai" } });
    fireEvent.change(screen.getByLabelText(/crew model/i), { target: { value: "gpt-5.5" } });
    fireEvent.click(screen.getAllByRole("button", { name: /save/i })[0]);
    await waitFor(() =>
      expect(internalAgentApi.updateConfig).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        provider: "openai", crewModel: "gpt-5.5",
      })),
    );
  });
});
```

> If the repo has no `@/test/render` helper, follow the pattern in an existing
> `CommanderSection` test (the file's sibling tests already wrap in
> `QueryClientProvider` + `CompanyContext`); reuse that exact wrapper.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && pnpm vitest run src/components/settings/sections/__tests__/CommanderSection.execution.test.tsx`
Expected: FAIL — no "Crew provider" control exists.

- [ ] **Step 3: Add crew + commander-model state and extend the save**

In `CommanderSection.tsx`, add state (near the `cliTool` state, line ~158):

```tsx
  const [commanderModel, setCommanderModel] = useState<string>("");
  const [crewProvider, setCrewProvider] = useState<string>("anthropic");
  const [crewModel, setCrewModel] = useState<string>("");
```

Hydrate them in the `useEffect` that syncs from `config` (line ~294):

```tsx
    setCommanderModel(config.model ?? "");
    if (config.provider) setCrewProvider(config.provider);
    setCrewModel(config.crewModel ?? "");
```

Extend `saveExecution` (line ~332):

```tsx
  function saveExecution() {
    saveMutation.mutate({
      executionMode: "cli",
      cliTool,
      model: commanderModel.trim() || null,
      provider: crewProvider as "anthropic" | "openai" | "google" | "opencode",
      crewModel: crewModel.trim() || null,
      runtimeApprovalsEnabled,
      runtimeAllowAlwaysEnabled,
      vendorCliBypassEnabled,
    });
  }
```

- [ ] **Step 4: Render the controls in the Execution tab**

Pass the new state into `ExecutionTabContent` (the `{active === "execution" && (<ExecutionTabContent … />)}` block, line ~433) and add the props to its interface + signature (lines ~691-723). Then, inside `ExecutionTabContent`'s JSX, after the existing "CLI Tool" `<div>` (line ~751), add a Commander-model field and a Crew block:

```tsx
      {/* Commander model (optional) */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block" htmlFor="commander-model">
          Commander model (optional)
        </label>
        <input
          id="commander-model"
          className="w-full max-w-xs rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          placeholder="leave blank for the CLI default"
          value={commanderModel}
          onChange={(e) => setCommanderModel(e.target.value)}
        />
      </div>

      {/* Crew (the 8 AoA agents) */}
      <div className="rounded-md border border-border p-3 space-y-3 max-w-xl">
        <p className="text-xs font-medium text-muted-foreground">AoA Crew</p>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block" htmlFor="crew-provider">
            Crew provider
          </label>
          <Select value={crewProvider} onValueChange={setCrewProvider}>
            <SelectTrigger id="crew-provider" aria-label="Crew provider" className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CREW_PROVIDERS.map((p) => (
                <SelectItem key={p} value={p}>{CREW_PROVIDER_LABELS[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block" htmlFor="crew-model">
            Crew model (optional)
          </label>
          <input
            id="crew-model"
            aria-label="Crew model"
            className="w-full max-w-xs rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            placeholder="leave blank for the provider default"
            value={crewModel}
            onChange={(e) => setCrewModel(e.target.value)}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Governs the AoA crew agents. Changing the provider re-provisions the crew
          on the new CLI. Google/Gemini is crew-only (Commander has no Gemini chat path).
        </p>
      </div>
```

Add imports + a label map at the top of `CommanderSection.tsx`:

```tsx
import { CREW_PROVIDERS } from "@armyofagents/shared";
const CREW_PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (Codex)",
  google: "Google (Gemini)",
  opencode: "OpenCode",
};
```

Wire the new props through `ExecutionTabContentProps` (add `commanderModel`,
`setCommanderModel`, `crewProvider`, `setCrewProvider`, `crewModel`, `setCrewModel`)
and the call site.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ui && pnpm vitest run src/components/settings/sections/__tests__/CommanderSection.execution.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the existing CommanderSection suite (no regression)**

Run: `cd ui && pnpm vitest run src/components/settings/sections`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter ui typecheck
git add ui/src/components/settings/sections/CommanderSection.tsx ui/src/components/settings/sections/__tests__/CommanderSection.execution.test.tsx
git commit -m "feat(provider-switching): Settings crew provider+model controls + Commander model"
```

---

## Task 12: Commander model on claude_cli + opencode (`cli-mode.ts`) — RISKIEST, do last

> **Risk note:** the `claude_cli` branch is marked "BYTE-UNCHANGED". Only ADD a
> `--model` argument when `config.model` is set AND shell-safe; when it's empty the
> emitted argv must be byte-identical to today. If review judges this too sensitive,
> this task may be deferred without affecting Tasks 1-11 (codex Commander model
> already honors `config.model`).

**Files:**
- Modify: `server/src/services/internal-agent/cli-mode.ts` (claude_cli branch ~374-436; opencode branch)
- Test: `server/src/__tests__/cli-mode-commander-model.test.ts`

- [ ] **Step 1: Write the failing test (pure arg-builder)**

Identify the smallest pure helper that builds the claude/opencode argv. If
`translateCliInvocation` (the per-CLI translator, ~line 356) is exported, test it
directly; if not, export a tiny `claudeModelArgs(model)` / `opencodeModelArgs(model)`
helper and use it inside the branch. Test:

```ts
// server/src/__tests__/cli-mode-commander-model.test.ts
import { describe, it, expect } from "vitest";
import { claudeModelArgs, opencodeModelArgs } from "../services/internal-agent/cli-mode.js";

describe("Commander model args", () => {
  it("claude: empty model → no args (byte-identical default path)", () => {
    expect(claudeModelArgs(null)).toEqual([]);
    expect(claudeModelArgs("")).toEqual([]);
  });
  it("claude: shell-safe model → --model <model>", () => {
    expect(claudeModelArgs("claude-opus-4-1")).toEqual(["--model", "claude-opus-4-1"]);
  });
  it("claude: shell-UNSAFE model → no args (never interpolate unsafe)", () => {
    expect(claudeModelArgs("evil; rm -rf")).toEqual([]);
  });
  it("opencode: slash model → --model; bare/unsafe → none", () => {
    expect(opencodeModelArgs("anthropic/claude-sonnet-4")).toEqual(["--model", "anthropic/claude-sonnet-4"]);
    expect(opencodeModelArgs("bare")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm vitest run src/__tests__/cli-mode-commander-model.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Add the helpers and use them in the branches**

At the top of `cli-mode.ts` (after the codex-model import on line ~20, which already
imports `resolveCodexChatModel`), extend the import to include the validators and add
the helpers:

```ts
import { resolveCodexChatModel, SAFE_MODEL_RE, isShellSafeModel } from "./codex-model.js";

/** claude CLI: pass --model only for a shell-safe non-empty model; else nothing
 *  (keeps the default path byte-identical). */
export function claudeModelArgs(model: string | null | undefined): string[] {
  const m = model?.trim() ?? "";
  return m && SAFE_MODEL_RE.test(m) ? ["--model", m] : [];
}

/** opencode: pass --model only for a shell-safe slash-form id; else nothing. */
export function opencodeModelArgs(model: string | null | undefined): string[] {
  const m = model?.trim() ?? "";
  return m && m.includes("/") && isShellSafeModel(m) ? ["--model", m] : [];
}
```

In the `claude_cli` branch's returned `args` array (the `--print`/`--output-format`
block, ~line 426-435), splice the model args in BEFORE `--print`:

```tsx
          args: [
            "--mcp-config", configPath,
            "--system-prompt-file", safeSystemPromptPath,
            ...claudeModelArgs((config as { model?: string | null }).model),
            ...claudeBypassArgs,
            "--print",
            "--output-format", "stream-json",
            "--include-partial-messages",
            "--verbose",
          ],
```

Thread `config.model` into `translateCliInvocation` if it isn't already available in
that scope (the codex path already receives `codexModel: config.model` — pass the same
value to the claude/opencode helpers). Apply the analogous one-line splice in the
opencode branch's args array using `opencodeModelArgs`. Also apply the same
`claudeModelArgs` splice to the **plain** (non-`systemSplit`) claude path so both
claude branches honor the model.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm vitest run src/__tests__/cli-mode-commander-model.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Run the cli-mode suite (no regression on the byte-sensitive paths)**

Run: `cd server && pnpm vitest run src/__tests__ -t "cli-mode"`
Expected: PASS. If any snapshot/contract test asserts the claude default argv, confirm
it is unchanged for the empty-model case.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @armyofagents/server typecheck
git add server/src/services/internal-agent/cli-mode.ts server/src/__tests__/cli-mode-commander-model.test.ts
git commit -m "feat(provider-switching): honor Commander model on claude_cli + opencode (shell-safe)"
```

---

## Task 13: e2e — provider switch takes effect through the UI

**Files:**
- Modify: `tests/e2e/provider-switching.spec.ts`

- [ ] **Step 1: Add the assertions**

Extend `tests/e2e/provider-switching.spec.ts` (which already drives the onboarding
wizard via `seedCompanyViaWizard`) with two cases. Use the existing API helper to
read crew agents (or add a small `GET /api/companies/:id/agents?kind=aoa` fetch):

```ts
test("onboarding as OpenAI crew → crew agents are codex_local", async ({ page, request }) => {
  const { companyId } = await seedCompanyViaWizard(page, {
    commanderProvider: "anthropic",
    crewProvider: "openai", crewModel: "",
  });
  const crew = await getAoaCrew(request, companyId);
  expect(crew.length).toBeGreaterThan(0);
  expect(crew.every((a) => a.adapterType === "codex_local")).toBe(true);
});

test("Settings crew provider change re-ensures the crew", async ({ page, request }) => {
  const { companyId } = await seedCompanyViaWizard(page, {
    commanderProvider: "anthropic", crewProvider: "anthropic", crewModel: "",
  });
  // change crew provider to opencode via the Settings → Commander → Execution tab
  await openCommanderExecutionTab(page, companyId);
  await page.getByLabel(/crew provider/i).selectOption("opencode");
  await page.getByRole("button", { name: /save/i }).first().click();
  await expect.poll(async () => {
    const crew = await getAoaCrew(request, companyId);
    return crew.every((a) => a.adapterType === "opencode_local");
  }).toBe(true);
});
```

Add the `getAoaCrew(request, companyId)` and `openCommanderExecutionTab(page, companyId)`
helpers at the top of the spec (or in `tests/e2e/helpers/`), mirroring the existing
helper style. Extend `seedCompanyViaWizard`'s options to accept
`commanderProvider`/`crewProvider`/`crewModel` and select them in steps 3/4.

- [ ] **Step 2: Run locally (win32 embedded-postgres override)**

Temporarily flip the `WINDOWS_WITH_EMBEDDED_POSTGRES` guard in
`tests/e2e/playwright.config.ts:15` to `false && …` (LOCAL ONLY — do NOT commit this
flip), then:

Run: `cd tests/e2e && pnpm exec playwright test provider-switching.spec.ts`
Expected: PASS (existing + 2 new cases). Restore the guard before committing.

- [ ] **Step 3: Commit (spec only; NOT the config flip)**

```bash
git add tests/e2e/provider-switching.spec.ts tests/e2e/helpers
git commit -m "test(provider-switching): e2e — onboarding + settings provider switch reach the crew"
```

---

## Final verification (after all tasks)

- [ ] **Full typecheck:** `pnpm -w typecheck` → 0 errors.
- [ ] **Server unit suite:** `cd server && pnpm vitest run` → green.
- [ ] **Shared + UI suites:** `cd packages/shared && pnpm vitest run` and `cd ui && pnpm vitest run` → green.
- [ ] **Migration check:** `pnpm db:generate` produces NO new diff (schema and migrations in sync).
- [ ] **Live smoke (isolated instance):** onboard as OpenAI crew → `GET /api/companies/:id/agents?kind=aoa` shows `codex_local`; change crew provider in Settings → re-fetch shows the new adapter; Commander chat still responds.
- [ ] Hand off to `superpowers:finishing-a-development-branch` (push + PR).

---

## Spec coverage map (self-review)

| Spec § | Task |
|---|---|
| §4 centralized mapping + AGENT_PROVIDERS opencode | T1 |
| §5.5 crew model override + read crewModel | T2 (col), T4 (logic) |
| §5.3 validators (opencode + crewModel) | T3 |
| §5.4 ensureAllCrewAgents + boot/create de-dupe + re-ensure | T5, T6 |
| §5.1 onboarding writes live fields; Commander drops google | T10 |
| §5.2 Settings crew control + Commander model | T11 |
| §5.6 Commander model on claude_cli/opencode | T12 |
| §5.7 cost opencode | T7 |
| §5.8 deprecate dead columns + comment fixes | T8 (companies), T2 (internal_agent comment) |
| §8 testing (unit/integration/e2e) | per-task tests + T13 |
| UI types | T9 |
