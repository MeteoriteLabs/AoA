# Commander Skills Scoping + UI Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three Commander issues found in UAT — the session overflow menu opening at the top-left corner, the `+` "Use a skill" menu not opening the skill picker, and the skill picker / `use_skill` ignoring the Commander agent's curated skill selection.

**Architecture:** Two are small frontend fixes (a CSS anchor fix and a focus-race fix). The third makes `agents.skillKeys` the single enforced source of truth for the Commander's skills: a one-time backfill seeds a sensible default selection, the `use_skill` MCP tool rejects unselected skills, and a new Commander-scoped endpoint feeds the picker so it shows only the selected skills. Empty selection = no skills (explicit).

**Tech Stack:** React + Vite + TailwindCSS v4 (ui), Express + Drizzle ORM (server), Radix/shadcn primitives, Vitest.

---

## Background facts (verified — do not re-investigate)

- **Overflow trigger (Issue 1):** `ui/src/components/commander/SessionOverflowMenu.tsx:67-75` — the Radix `DropdownMenuTrigger` button uses `hidden group-hover:flex`. When the menu opens the row loses `:hover` → the trigger becomes `display:none` → its bounding rect collapses to 0×0 at the origin → Radix anchors `DropdownMenuContent` to the top-left corner.
- **Picker focus race (Issue 2):** `ui/src/components/InternalAgentPanel.tsx` — the input bar container is at line ~1003 (`<div className="shrink-0 border-t border-border p-3 relative">`), the `<SkillPicker>` at ~1005, the textarea `onBlur` at ~1020 runs `if (pickerOpen) closePicker()`, and `InputAddMenu`'s `onUseSkill` at ~1040 does `setSkillPickerOpen(true)` + `requestAnimationFrame(() => inputRef.current?.focus())`. After "Use a skill" is chosen, Radix restores focus to the `+` trigger, which blurs the textarea → `onBlur` closes the just-opened picker.
- **Skill selection storage (Issue 3):** `agents.skillKeys` is a jsonb column (`packages/db/src/schema/agents.ts:41`), `$type<string[]>().notNull().default([])`. It is edited today via the agent Skills tab (`ui/src/components/AgentInstructionsTab.tsx:391` passes `agent.skillKeys`; saved through the agent PATCH route which validates via `resolveSkillKeys`).
- **Commander prompt already scopes by skillKeys:** `server/src/services/company-skills.ts:2224 listCompactSkillEntries(companyId, agentId)` returns `[]` when `skillKeys` is empty, else filters company skills to `skillKeys`. Commander's agent id is resolved by `ensureCommanderAgent(db, companyId)` and stored in `internalAgentConfig.agentId`.
- **`use_skill` is unscoped today:** `server/src/mcp/tools/skill-tools.ts:12-46 handleUseSkill` looks up a skill by `companyId` + `key` only — no `skillKeys` check. `ToolContext` (`server/src/mcp/tools/types.ts:46,67`) exposes `companyId`, `db`, `actorType?`, `agentId?`. The Commander runs the MCP **bridge** path (`server/src/services/internal-agent/mcp-bridge.ts`) which sets `toolContext.actorType = "commander"` but does **not** set `agentId`. So enforcement resolves the Commander agent from `companyId` when `actorType === "commander"`.
- **Picker data source (Issue 3):** `ui/src/components/commander/SkillPicker.tsx:52-56` fetches `companySkillsApi.list(companyId)` = `GET /companies/:cid/skills` = ALL company skills. `AgentConfig` (`ui/src/api/internal-agent.ts:32-47`) does NOT expose the Commander agent id, so the picker uses a new Commander-scoped endpoint instead of resolving the agent client-side.
- **Default seeding:** `seedDefaultCommanderSkills` (`server/src/services/marketplace-install/default-skill-seeder.ts`) installs default skills into `company_skills` but does NOT set the Commander agent's `skillKeys`. `ensureCommanderAgent` (`server/src/services/internal-agent/aoa-agents/ensure-commander.ts`) creates the agent without `skillKeys` (defaults to `[]`) and runs on every chat (called from `agent-loop.ts:163`).

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `ui/src/components/commander/SessionOverflowMenu.tsx` | Modify | Keep the ⋮ trigger laid out (opacity, not display) so Radix anchors correctly |
| `ui/src/components/InternalAgentPanel.tsx` | Modify | Container-aware textarea `onBlur` so the `+`-menu focus bounce doesn't close the picker |
| `server/src/services/internal-agent/aoa-agents/ensure-commander.ts` | Modify | One-time backfill: initialize Commander `skillKeys` to currently-installed company skills |
| `server/src/mcp/tools/skill-tools.ts` | Modify | Enforce `skillKeys` in `use_skill` for the `commander` actor |
| `server/src/services/company-skills.ts` | Modify | Add `listSkillListItemsForAgent(companyId, agentId)` helper (agent-scoped list items) |
| `server/src/routes/internal-agent.ts` | Modify | New `GET /companies/:cid/internal-agent/skills` (Commander-scoped skill list) |
| `ui/src/api/internal-agent.ts` | Modify | Add `internalAgentApi.listSkills(companyId)` + `queryKeys` entry |
| `ui/src/lib/queryKeys.ts` | Modify | Add `commanderSkills(companyId)` key |
| `ui/src/components/commander/SkillPicker.tsx` | Modify | Fetch the Commander-scoped list instead of all company skills |
| `docs/superpowers/uat/2026-05-20-commander-uat.md` | Modify | Append Run 5 results |

---

## Task 1: Fix overflow-menu anchor (Issue 1)

**Files:**
- Modify: `ui/src/components/commander/SessionOverflowMenu.tsx:67-75`
- Test: `ui/src/__tests__/SessionOverflowMenu.test.tsx` (existing)

- [ ] **Step 1: Change the trigger className so it stays in layout**

Replace the trigger button (lines 67-75) with this — note it is always `flex` (real rect) but invisible + non-interactive until hover or menu-open (`data-[state=open]` is set by Radix on the trigger):

```tsx
          <button
            type="button"
            data-commander-touch
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-center p-0.5 rounded hover:bg-black/10 transition-colors shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto"
            title="More options"
          >
            <MoreVertical className="h-3.5 w-3.5 text-dim" />
          </button>
```

- [ ] **Step 2: Add a test asserting the trigger is not display-hidden**

Add to `ui/src/__tests__/SessionOverflowMenu.test.tsx` (follow the existing render/setup in that file; render `<SessionOverflowMenu>` with stub handlers and a `conversation` fixture):

```tsx
it("trigger stays in layout (not display:hidden) so the menu anchors to it", () => {
  renderMenu(); // existing helper in this file
  const trigger = screen.getByTitle("More options");
  // The bug was `hidden` (display:none) collapsing the anchor rect to 0,0.
  expect(trigger.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  expect(trigger.className).toContain("opacity-0");
  expect(trigger.className).toContain("group-hover:opacity-100");
  expect(trigger.className).toContain("data-[state=open]:opacity-100");
});
```

If `renderMenu` does not exist, render inline:

```tsx
import { render, screen } from "@testing-library/react";
import { SessionOverflowMenu } from "../components/commander/SessionOverflowMenu";

const conversation = {
  id: "c1", companyId: "co1", title: "Test", createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(), messageCount: 0, userId: "u1", pinned: false,
} as any;

it("trigger stays in layout (not display:hidden)", () => {
  render(<SessionOverflowMenu conversation={conversation} onPin={() => {}} onRename={() => {}} onArchive={() => {}} onDelete={() => {}} />);
  const trigger = screen.getByTitle("More options");
  expect(trigger.className).not.toMatch(/(^|\s)hidden(\s|$)/);
  expect(trigger.className).toContain("data-[state=open]:opacity-100");
});
```

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm --filter ui run test src/__tests__/SessionOverflowMenu.test.tsx` → Expected: PASS
Run: `pnpm --filter ui run typecheck` → Expected: clean

- [ ] **Step 4: Commit**

```bash
git add ui/src/components/commander/SessionOverflowMenu.tsx ui/src/__tests__/SessionOverflowMenu.test.tsx
git commit -m "fix(commander): anchor session overflow menu to its trigger (was opening top-left)"
```

---

## Task 2: Fix `+`-menu skill picker not opening (Issue 2)

**Files:**
- Modify: `ui/src/components/InternalAgentPanel.tsx` (input bar container ~1003, textarea `onBlur` ~1020)

- [ ] **Step 1: Add a ref to the input-bar container**

Find the input bar wrapper (the `<div className="shrink-0 border-t border-border p-3 relative">` at ~line 1003). Add a ref. First declare it near the other refs in `AgentPanelContent` (e.g. next to `inputRef`):

```tsx
  const inputBarRef = useRef<HTMLDivElement>(null);
```

Then attach it:

```tsx
      {/* Input bar */}
      <div ref={inputBarRef} className="shrink-0 border-t border-border p-3 relative">
```

- [ ] **Step 2: Make the textarea `onBlur` container-aware**

Replace the textarea `onBlur` (~line 1020) with a guard that only closes the picker when focus leaves the entire input bar (the `+` button, picker rows, and textarea all live inside `inputBarRef`, so a focus bounce among them no longer closes it):

```tsx
            onBlur={(e) => {
              // Only close when focus leaves the whole input bar. Radix restores
              // focus to the `+` trigger after "Use a skill"; that target is inside
              // inputBarRef, so we must NOT close in that case. Skill-row clicks use
              // onMouseDown+preventDefault and never blur the textarea.
              const next = e.relatedTarget as Node | null;
              if (pickerOpen && !inputBarRef.current?.contains(next)) {
                closePicker();
              }
            }}
```

- [ ] **Step 3: Verify the menu-open path keeps the rAF focus**

Confirm `InputAddMenu`'s `onUseSkill` (~line 1040) still focuses the textarea (leave as-is):

```tsx
              onUseSkill={() => {
                setPickerIndex(0);
                setSkillPickerOpen(true);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
```

(No change — the Step 2 guard makes this reliable regardless of focus-restore ordering.)

- [ ] **Step 4: Typecheck + existing tests**

Run: `pnpm --filter ui run typecheck` → Expected: clean
Run: `pnpm --filter ui run test` → Expected: all pass (no test regressions)

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/InternalAgentPanel.tsx
git commit -m "fix(commander): + menu reliably opens skill picker (container-aware blur)"
```

> Browser verification of this fix happens in Task 7 (the focus race can't be exercised reliably in jsdom).

---

## Task 3: Backfill Commander skill selection (Issue 3a)

**Files:**
- Modify: `server/src/services/internal-agent/aoa-agents/ensure-commander.ts`
- Test: `server/src/__tests__/ensure-commander-skill-backfill.test.ts` (create)

- [ ] **Step 1: Add the one-time backfill in `ensureCommanderAgent`**

In `ensure-commander.ts`, add `companySkills` to the db import:

```ts
import { agents, internalAgentConfig, companySkills } from "@armyofagents/db";
```

Then, immediately AFTER the `seedDefaultCommanderSkills` try/catch (after line ~113, before the `internalAgentConfig` update at line ~114), insert:

```ts
  // Initialize the Commander's curated skill selection ONCE (sensible default =
  // all currently-installed company skills). Flag-guarded via metadata so a
  // founder who later clears the selection is respected (we never re-backfill).
  try {
    const [row] = await db
      .select({ skillKeys: agents.skillKeys, metadata: agents.metadata })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    const meta = (row?.metadata as Record<string, unknown> | null) ?? {};
    if (!meta.commanderSkillsInitialized) {
      const installed = await db
        .select({ key: companySkills.key })
        .from(companySkills)
        .where(eq(companySkills.companyId, companyId));
      await db
        .update(agents)
        .set({
          skillKeys: installed.map((s) => s.key),
          metadata: { ...meta, commanderSkillsInitialized: true },
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agentId));
    }
  } catch {
    // Non-fatal: a backfill failure must not block Commander provisioning.
  }
```

- [ ] **Step 2: Write a contract test (source-string style, matches repo convention)**

Create `server/src/__tests__/ensure-commander-skill-backfill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const src = readFileSync(
  join(__dirname, "../services/internal-agent/aoa-agents/ensure-commander.ts"),
  "utf-8",
);

describe("ensureCommanderAgent skill backfill", () => {
  it("guards the backfill with a one-time metadata flag", () => {
    expect(src).toContain("commanderSkillsInitialized");
  });
  it("initializes skillKeys from installed company skills", () => {
    expect(src).toMatch(/skillKeys:\s*installed\.map/);
    expect(src).toContain("companySkills");
  });
  it("imports companySkills from the db package", () => {
    expect(src).toMatch(/import\s*\{[^}]*companySkills[^}]*\}\s*from\s*"@armyofagents\/db"/);
  });
});
```

- [ ] **Step 3: Run test + typecheck**

Run: `pnpm vitest run server/src/__tests__/ensure-commander-skill-backfill.test.ts` → Expected: PASS
Run: `pnpm --filter @armyofagents/server run typecheck` → Expected: clean

- [ ] **Step 4: Commit**

```bash
git add server/src/services/internal-agent/aoa-agents/ensure-commander.ts server/src/__tests__/ensure-commander-skill-backfill.test.ts
git commit -m "feat(commander): one-time backfill of Commander skillKeys (sensible default)"
```

---

## Task 4: Enforce skillKeys in `use_skill` (Issue 3b)

**Files:**
- Modify: `server/src/mcp/tools/skill-tools.ts`
- Test: `server/src/__tests__/use-skill-enforcement.test.ts` (create)

- [ ] **Step 1: Add skillKeys enforcement for the commander actor**

Replace the whole body of `handleUseSkill` in `server/src/mcp/tools/skill-tools.ts` with the version below. It keeps the existing company lookup, then — when the caller is the Commander actor — rejects skills not in the Commander agent's `skillKeys`. Update the imports at the top of the file:

```ts
import { z } from "zod";
import { companySkills, agents, internalAgentConfig } from "@armyofagents/db";
import { and, eq } from "drizzle-orm";
import {
  type ToolContext,
  type ToolHandler,
  type ToolResult,
  notFoundResult,
  ok,
} from "./types.js";

async function handleUseSkill(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z.object({ key: z.string().min(1) }).parse(args);

  const [skill] = await ctx.db
    .select({
      key: companySkills.key,
      name: companySkills.name,
      description: companySkills.description,
      markdown: companySkills.markdown,
    })
    .from(companySkills)
    .where(
      and(
        eq(companySkills.companyId, ctx.companyId),
        eq(companySkills.key, parsed.key),
      ),
    )
    .limit(1);

  if (!skill) {
    return notFoundResult(
      `Skill '${parsed.key}' not found for this company. Use list_skills to see available skills.`,
    );
  }

  // Curated-source-of-truth enforcement: the Commander may only use skills that
  // are selected for it (agents.skillKeys). The bridge sets actorType
  // "commander" but not agentId, so resolve the Commander agent from companyId.
  if (ctx.actorType === "commander") {
    const [cfg] = await ctx.db
      .select({ agentId: internalAgentConfig.agentId })
      .from(internalAgentConfig)
      .where(eq(internalAgentConfig.companyId, ctx.companyId))
      .limit(1);
    if (cfg?.agentId) {
      const [agent] = await ctx.db
        .select({ skillKeys: agents.skillKeys })
        .from(agents)
        .where(eq(agents.id, cfg.agentId))
        .limit(1);
      const allowed: string[] = Array.isArray(agent?.skillKeys) ? agent.skillKeys : [];
      if (!allowed.includes(parsed.key)) {
        return notFoundResult(
          `Skill '${parsed.key}' is not enabled for Commander. Enable it in Settings → Commander → Skills.`,
        );
      }
    }
  }

  return ok({
    key: skill.key,
    name: skill.name,
    description: skill.description ?? null,
    content: skill.markdown ?? `Skill '${parsed.key}' has no markdown content.`,
  });
}

export const skillToolHandlers: Record<string, ToolHandler> = {
  "use_skill": handleUseSkill,
};
```

- [ ] **Step 2: Write a contract test (source-string style)**

Create `server/src/__tests__/use-skill-enforcement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const src = readFileSync(join(__dirname, "../mcp/tools/skill-tools.ts"), "utf-8");

describe("use_skill skillKeys enforcement", () => {
  it("enforces only for the commander actor", () => {
    expect(src).toContain('ctx.actorType === "commander"');
  });
  it("resolves the commander agent via internalAgentConfig.agentId", () => {
    expect(src).toContain("internalAgentConfig");
    expect(src).toMatch(/agentId:\s*internalAgentConfig\.agentId/);
  });
  it("rejects skills not present in the agent's skillKeys", () => {
    expect(src).toMatch(/allowed\.includes\(parsed\.key\)/);
    expect(src).toContain("not enabled for Commander");
  });
});
```

- [ ] **Step 3: Run test + typecheck**

Run: `pnpm vitest run server/src/__tests__/use-skill-enforcement.test.ts` → Expected: PASS
Run: `pnpm --filter @armyofagents/server run typecheck` → Expected: clean

- [ ] **Step 4: Commit**

```bash
git add server/src/mcp/tools/skill-tools.ts server/src/__tests__/use-skill-enforcement.test.ts
git commit -m "feat(commander): enforce Commander skillKeys in use_skill"
```

---

## Task 5: Commander-scoped skills endpoint (Issue 3c — backend)

**Files:**
- Modify: `server/src/services/company-skills.ts` (add `listSkillListItemsForAgent`)
- Modify: `server/src/routes/internal-agent.ts` (new GET route)
- Test: `server/src/__tests__/internal-agent-routes-contract.test.ts` (existing — extend)

- [ ] **Step 1: Add an agent-scoped list-items helper to the company-skills service**

In `server/src/services/company-skills.ts`, add this function next to `listCompactSkillEntries` (~line 2245), and export it in the returned object (the object at ~line 2451 that already lists `listCompactSkillEntries, resolveSkillKeys, ...`):

```ts
  /**
   * Returns full CompanySkillListItem rows scoped to an agent's skillKeys.
   * Empty skillKeys → empty list (explicit: no skills selected). Used by the
   * Commander skill picker so it shows exactly the curated selection.
   */
  async function listSkillListItemsForAgent(
    companyId: string,
    agentId: string,
  ): Promise<CompanySkillListItem[]> {
    const agent = await agents.getById(agentId);
    if (!agent || agent.companyId !== companyId) return [];
    const skillKeys: string[] = Array.isArray((agent as any).skillKeys)
      ? (agent as any).skillKeys
      : [];
    if (skillKeys.length === 0) return [];
    const keySet = new Set(skillKeys);
    const all = await listSkills(companyId); // existing list-items method (returns CompanySkillListItem[])
    return all.filter((s) => keySet.has(s.key));
  }
```

Add to the returned service object:

```ts
    listSkillListItemsForAgent,
```

> **Note for implementer:** Confirm the existing list-items method name. The route `GET /companies/:companyId/skills` (`company-skills.ts` route file) returns `CompanySkillListItem[]` via a service method — find it (likely `listSkills` or `list`) and call that inside `listSkillListItemsForAgent` so the shape matches `companySkillsApi.list`. If the only available method is `listFull`, map its rows to the `CompanySkillListItem` shape `{ id, companyId, key, slug, name, description, sourceType, ... }` to match what the picker already renders. Also confirm `CompanySkillListItem` is imported at the top of the service file; if not, add it from `@armyofagents/shared`.

- [ ] **Step 2: Add the Commander-scoped route**

In `server/src/routes/internal-agent.ts`, add this route (place it near the other internal-agent GET routes; it follows the same `assertCompanyAccess` pattern used throughout the file). Resolve the Commander agent via `ensureCommanderAgent` so it works even before the first chat:

```ts
  // ── Commander skills: the agent's curated selection (for the chat skill picker) ──
  router.get(
    "/companies/:companyId/internal-agent/skills",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const agentId = await ensureCommanderAgent(db, companyId);
      const skills = await companySkillService(db).listSkillListItemsForAgent(
        companyId,
        agentId,
      );
      res.json(skills);
    },
  );
```

Ensure these imports exist at the top of `internal-agent.ts` (add any missing):

```ts
import { ensureCommanderAgent } from "../services/internal-agent/aoa-agents/ensure-commander.js";
import { companySkillService } from "../services/index.js";
```

> **Note for implementer:** `companySkillService` may already be reachable via the existing services import in this file — check before adding a duplicate import. `ensureCommanderAgent` is async and idempotent (safe to call per-request).

- [ ] **Step 3: Extend the routes contract test**

In `server/src/__tests__/internal-agent-routes-contract.test.ts`, add the new path to the expected-routes list and bump the route count constant if the test asserts a total. Add:

```ts
it("registers the Commander-scoped skills route", () => {
  expect(routeSrc).toContain('"/companies/:companyId/internal-agent/skills"');
});
it("scopes the skills route to the commander agent", () => {
  // The handler resolves the commander agent and returns its curated skills.
  expect(routeSrc).toContain("ensureCommanderAgent");
  expect(routeSrc).toContain("listSkillListItemsForAgent");
});
```

(Use the same source-read variable the existing tests use — e.g. `routeSrc`/`src`. If the test counts routes, increment the expected number by 1.)

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run server/src/__tests__/internal-agent-routes-contract.test.ts` → Expected: PASS
Run: `pnpm --filter @armyofagents/server run typecheck` → Expected: clean

- [ ] **Step 5: Commit**

```bash
git add server/src/services/company-skills.ts server/src/routes/internal-agent.ts server/src/__tests__/internal-agent-routes-contract.test.ts
git commit -m "feat(commander): Commander-scoped skills endpoint for the picker"
```

---

## Task 6: Point the picker at the Commander-scoped endpoint (Issue 3c — frontend)

**Files:**
- Modify: `ui/src/api/internal-agent.ts` (add `internalAgentApi.listSkills`)
- Modify: `ui/src/lib/queryKeys.ts` (add `commanderSkills`)
- Modify: `ui/src/components/commander/SkillPicker.tsx` (use the new fetch)
- Test: `ui/src/__tests__/skillPickerUtils.test.ts` (existing — unaffected; add nothing unless needed)

- [ ] **Step 1: Add the API method**

In `ui/src/api/internal-agent.ts`, add to the `internalAgentApi` object (it returns `CompanySkillListItem[]`; import the type at the top if not present — `import type { CompanySkillListItem } from "@armyofagents/shared";`):

```ts
  listSkills: (companyId: string) =>
    api.get<CompanySkillListItem[]>(`/companies/${companyId}/internal-agent/skills`),
```

- [ ] **Step 2: Add the query key**

In `ui/src/lib/queryKeys.ts`, add (near `agentConfig`):

```ts
  commanderSkills: (companyId: string) => ["commander-skills", companyId] as const,
```

- [ ] **Step 3: Point SkillPicker at the scoped fetch**

In `ui/src/components/commander/SkillPicker.tsx`, change the import and the `useQuery` (lines ~6 and ~52-56):

Replace the import:

```tsx
import { internalAgentApi } from "../../api/internal-agent";
```

(remove the `companySkillsApi` import if it becomes unused)

Replace the query:

```tsx
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.commanderSkills(companyId),
    queryFn: () => internalAgentApi.listSkills(companyId),
    enabled: open && !!companyId,
  });
```

The empty-state copy already reads `skills.length === 0 ? "No skills available." : "No skills match."` — with scoping, "No skills available." now correctly means "no skills selected for Commander," which is the intended explicit-empty behavior. Leave it.

- [ ] **Step 4: Typecheck + tests**

Run: `pnpm --filter ui run typecheck` → Expected: clean
Run: `pnpm --filter ui run test` → Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add ui/src/api/internal-agent.ts ui/src/lib/queryKeys.ts ui/src/components/commander/SkillPicker.tsx
git commit -m "feat(commander): skill picker shows only the Commander's selected skills"
```

---

## Task 7: UAT Run 5 — browser verification

**Files:**
- Modify: `docs/superpowers/uat/2026-05-20-commander-uat.md` (append Run 5)

> The dev server (port 3100, this worktree, `dev:watch`) hot-reloads. Apply the `pinned` migration is already done; this plan adds no DB migration. Use the gstack `/browse` binary in **atomic single-call sequences** (connect → goto → act → screenshot) because the headed daemon resets between separate tool calls. Disable Git Bash path mangling for `/` arguments with `MSYS_NO_PATHCONV=1`.

- [ ] **Step 1: Verify Issue 1 — overflow menu anchors to the row**

At desktop width, open a session row's ⋮ menu and confirm the dropdown appears next to the button (not at top-left). Capture a screenshot.

- [ ] **Step 2: Verify Issue 2 — `+` menu opens the picker**

Click the `+` add button → click "Use a skill" → confirm the skill picker (`[role=listbox][aria-label="Company skills"]`) is visible and stays open. Capture a screenshot.

- [ ] **Step 3: Verify Issue 3 — picker shows only selected skills + enforcement**

- In Settings → Commander → Skills, note the selected skills. In the Commander chat, type `/` and confirm the picker lists ONLY those skills (not all company skills).
- Deselect a skill in the Skills tab, return to chat, `/` again → confirm it's gone from the picker.
- Optionally: send a message asking Commander to use a deselected skill and confirm `use_skill` returns "not enabled for Commander" (best-effort; requires a live model turn).

- [ ] **Step 4: Append Run 5 results + commit**

```bash
git add -f docs/superpowers/uat/2026-05-20-commander-uat.md
git commit -m "docs(uat): Run 5 — overflow anchor, + menu picker, Commander skill scoping"
```

---

## Tests

- Task 1: SessionOverflowMenu trigger not `display:hidden` (unit).
- Task 3: backfill flag + skillKeys-from-installed (contract).
- Task 4: use_skill enforces skillKeys for commander actor (contract).
- Task 5: Commander-scoped skills route registered + scoped (contract).
- Tasks 2, 6: covered by typecheck + the Task 7 browser UAT (focus race + scoped fetch are integration behaviors).

Baseline: `pnpm --filter ui run test` (was 234 files / 1675) and `pnpm vitest run server/src/__tests__` (was 392 files / 3548, 10/37 skipped) stay green; both typechecks clean.

---

## Execution

`superpowers:subagent-driven-development`, tasks in order. Tasks 3 → 4 → 5 → 6 are the Issue-3 chain (backfill before enforcement is safe; endpoint before the picker consumes it). Tasks 1 and 2 are independent and can go first. Estimated ~2-3 hours at subagent pace.

---

## Self-review notes

- **Spec coverage:** Issue 1 → Task 1. Issue 2 → Task 2. Issue 3a (backfill/seed) → Task 3. Issue 3b (enforce) → Task 4. Issue 3c (scoped picker) → Tasks 5 (backend) + 6 (frontend). Empty = no skills → enforced by `listSkillListItemsForAgent` (empty→[]) + `use_skill` rejection + the picker's "No skills available." copy. UAT → Task 7.
- **Open implementer confirmations (flagged inline, not placeholders):** the exact existing service method that returns `CompanySkillListItem[]` (Task 5 Step 1), and whether `companySkillService`/`CompanySkillListItem` are already imported in the touched files. These are name-confirmations against existing code, with a documented fallback (map `listFull`).
- **Type consistency:** `listSkillListItemsForAgent` returns `CompanySkillListItem[]`; `internalAgentApi.listSkills` types the same; `SkillPicker` already renders `CompanySkillListItem` (`{name, key, description}`). `skillKeys` is `string[]` everywhere. `actorType === "commander"` matches the bridge's `toolContext.actorType` value.

---

## Follow-on work shipped beyond the original 3 issues

After the Issue 1–3 chain landed, additional Commander UX work shipped on the
same branch (`commander-subagent-1`). Recorded here so this plan reflects what
actually went out.

### Skill-command "no response" root cause (post-QA)
`claude_cli` emits the post-`use_skill` answer as plain text, but the stream-JSON
parser `JSON.parse`d every line and silently dropped non-JSON → the answer never
rendered. Fixes (commit `ef4951c9`): parser emits non-JSON lines as text;
`use_skill` flexible key resolution (handles a dropped `skill:` prefix / slug /
name); `cli-mode` logs subprocess stderr instead of swallowing it.

### Batch 1 — UI polish (`0b9f7f70`)
Centered, closeable skill picker (440px); rounded session rows + stronger hover;
cleaner skill rows (name + source badge + description); slash-removal closes the
picker.

### Batch 3 — contenteditable rich input + colored skill tokens (`6b367bf5`, `6d038d61`)
Replaced the textarea with an uncontrolled contenteditable (`CommanderInput.tsx`
+ `commanderInputModel.ts`). Selecting a skill inserts a blue atomic token (just
the name) that expands to the full `use_skill` directive on send. Backspace
deletes the whole token; Shift+Enter newline; paste-as-plain; placeholder is
React-driven so it survives re-renders. Token color system via `--token-skill`.

### Batch 2 — session drag-and-drop reorder (`cbc46d77`, `3a96fc7f`)
Nullable `internal_agent_conversations.sort_order` (migration `0104`). Default
view keeps date groups; the first drag collapses the non-pinned list into one
flat "Arranged" order (Reset restores recency). Pinned stays on top, not
draggable. Routes `PATCH …/conversations/reorder` + `DELETE …/conversations/order`,
both owner-scoped. dnd-kit sortable list.

### Post-audit fixes (`bdd24164`)
- **Touch drag:** rows have `touch-action: manipulation`, so PointerSensor alone
  lost finger-drags to scrolling. Switched to Mouse (distance) + Touch
  (long-press) + Keyboard sensors.
- **Skill token hover card:** hovering a token shows name + description + key
  (description stashed on the token at insertion; never sent in the directive).

### Deferred (intentional)
`@mention`, voice input, and attach-file remain disabled "Coming soon"
placeholders in the composer.
