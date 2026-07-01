# Marketplace secondary sidebar + AoA section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the marketplace's horizontal type-chip row with a floating secondary sidebar (Home / Skills / Plugins / Agents / Teams / AoA), and segregate AoA first-party items into the AoA entry (excluded from the main sections).

**Architecture:** A shared `useMarketplaceSidebar(activeKey)` hook computes counts from `useCatalog`, builds the `SecondarySidebar` sections, and pushes them to the persistent `LobbyLayout` via the Outlet context (same pattern as `InstanceSettingsPage`). AoA membership is a pure predicate `isAoaItem` (github owner ∈ AoA orgs). All 4 marketplace pages call the hook so the chrome is consistent.

**Tech Stack:** React + react-router-dom (`@/lib/router`), TailwindCSS v4, `SecondarySidebar`, `useCatalog`, vitest + @testing-library/react.

**Design doc:** `docs/aoa/plans/2026-07-01-marketplace-secondary-sidebar-design.md`

**Commands:**
- Unit (one file): `pnpm --filter @armyofagents/ui exec vitest run <path>`
- Typecheck: `pnpm --filter @armyofagents/ui typecheck`
- Full suite: `pnpm --filter @armyofagents/ui test:run`

**Deviation from design doc:** `isAoaItem` lives in `ui/src/lib/marketplace-constants.ts` (next to the existing `authorFromSource` it reuses), NOT a new `marketplace-aoa.ts` — colocated with the owner parser.

---

## Task 1: `isAoaItem` predicate

**Files:**
- Modify: `ui/src/lib/marketplace-constants.ts`
- Test: `ui/src/lib/__tests__/marketplace-aoa.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/__tests__/marketplace-aoa.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isAoaItem, AOA_OWNERS } from "../marketplace-constants";
import type { MarketplaceCatalogItem } from "@armyofagents/shared";

function item(url: string, provider?: { id?: string; name?: string }): MarketplaceCatalogItem {
  return { source: { url }, provider } as unknown as MarketplaceCatalogItem;
}

describe("isAoaItem", () => {
  it("matches AoA-org github owners (case-insensitive)", () => {
    expect(isAoaItem(item("https://github.com/aoa-curated/code-review"))).toBe(true);
    expect(isAoaItem(item("https://github.com/MeteoriteLabs/x"))).toBe(true);
    expect(isAoaItem(item("https://github.com/armyofagents/y"))).toBe(true);
    expect(isAoaItem(item("https://github.com/ArmyOfAgents/y"))).toBe(true);
  });
  it("does not match third-party owners", () => {
    expect(isAoaItem(item("https://github.com/garrytan/gstack"))).toBe(false);
    expect(isAoaItem(item("https://github.com/openai/x"))).toBe(false);
  });
  it("matches when provider id/name is an AoA org even if url is odd", () => {
    expect(isAoaItem(item("skills.sh/foo", { id: "aoa-curated" }))).toBe(true);
  });
  it("AOA_OWNERS is lowercase", () => {
    for (const o of AOA_OWNERS) expect(o).toBe(o.toLowerCase());
  });
});
```

- [ ] **Step 2: Run — expect FAIL (isAoaItem not exported)**

Run: `pnpm --filter @armyofagents/ui exec vitest run src/lib/__tests__/marketplace-aoa.test.ts`
Expected: FAIL (no `isAoaItem` export).

- [ ] **Step 3: Implement in `marketplace-constants.ts`**

Add (near `authorFromSource`, and import the item type at the top of the file):

```ts
import type { MarketplaceCatalogItem } from "@armyofagents/shared";

/** GitHub orgs (lowercased) whose marketplace items are AoA first-party. */
export const AOA_OWNERS = new Set(["aoa-curated", "meteoritelabs", "armyofagents"]);

/** True when an item is AoA's own (crew/teams/skills) — segregated into the
 *  marketplace "AoA" section and excluded from the general type sections. */
export function isAoaItem(item: MarketplaceCatalogItem): boolean {
  const owner = authorFromSource(item.source.url).toLowerCase();
  if (AOA_OWNERS.has(owner)) return true;
  const providerId = item.provider?.id?.toLowerCase();
  const providerName = item.provider?.name?.toLowerCase();
  return (
    (providerId !== undefined && AOA_OWNERS.has(providerId)) ||
    (providerName !== undefined && AOA_OWNERS.has(providerName))
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @armyofagents/ui exec vitest run src/lib/__tests__/marketplace-aoa.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/marketplace-constants.ts ui/src/lib/__tests__/marketplace-aoa.test.ts
git commit -m "feat(marketplace): isAoaItem predicate for first-party segregation"
```

---

## Task 2: `useMarketplaceSidebar` hook

**Files:**
- Create: `ui/src/components/marketplace/useMarketplaceSidebar.tsx`
- Test: `ui/src/components/marketplace/__tests__/useMarketplaceSidebar.test.tsx`

The hook computes counts (AoA-excluded for types), builds the two-section sidebar
(main types + AoA below a divider), pushes it to the LobbyLayout Outlet context, and
returns `pillItems` for the mobile row. Navigation via `useNavigate`.

- [ ] **Step 1: Write the failing test**

Create `ui/src/components/marketplace/__tests__/useMarketplaceSidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import { useMarketplaceSidebar } from "../useMarketplaceSidebar";

const CATALOG = {
  items: [
    { id: "1", type: "skill", name: "a", description: "", source: { url: "https://github.com/garrytan/x" } },
    { id: "2", type: "skill", name: "b", description: "", source: { url: "https://github.com/aoa-curated/y" } },
    { id: "3", type: "agent", name: "c", description: "", source: { url: "https://github.com/openai/z" } },
  ],
};
vi.mock("@/hooks/useCatalog", () => ({ useCatalog: () => ({ data: CATALOG }) }));

function Harness({ activeKey }: { activeKey: any }) {
  const { pillItems } = useMarketplaceSidebar(activeKey);
  return <div data-testid="pills">{pillItems.map((p) => `${p.id}:${p.count}`).join(",")}</div>;
}

function Captor() {
  return <div />;
}

function renderHook(activeKey: any) {
  let captured: ReactNode = null;
  render(
    <MemoryRouter initialEntries={["/marketplace"]}>
      <Routes>
        <Route
          element={<Outlet context={{ setSecondarySidebar: (n: ReactNode) => { captured = n; } }} />}
        >
          <Route path="/marketplace" element={<Harness activeKey={activeKey} />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return { getCaptured: () => captured };
}

describe("useMarketplaceSidebar", () => {
  it("type counts exclude AoA items; AoA count is the AoA items", () => {
    renderHook("home");
    // skill: 1 non-aoa (garrytan) — the aoa-curated skill is excluded; agent: 1; aoa: 1
    expect(screen.getByTestId("pills").textContent).toContain("skill:1");
    expect(screen.getByTestId("pills").textContent).toContain("agent:1");
    expect(screen.getByTestId("pills").textContent).toContain("aoa:1");
  });

  it("home count is the non-AoA total", () => {
    renderHook("home");
    expect(screen.getByTestId("pills").textContent).toContain("home:2");
  });

  it("pushes a SecondarySidebar node to the outlet context", () => {
    const { getCaptured } = renderHook("skill");
    expect(getCaptured()).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `pnpm --filter @armyofagents/ui exec vitest run src/components/marketplace/__tests__/useMarketplaceSidebar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

Create `ui/src/components/marketplace/useMarketplaceSidebar.tsx`:

```tsx
import { useLayoutEffect, useState } from "react";
import { Bot, Home, Puzzle, Sparkles, Users } from "lucide-react";
import type { MarketplaceItemType } from "@armyofagents/shared";
import { useNavigate, useOutletContext } from "@/lib/router";
import { useCatalog } from "@/hooks/useCatalog";
import { isAoaItem } from "@/lib/marketplace-constants";
import {
  SecondarySidebar,
  type SecondarySidebarItem,
  type SecondarySidebarSection,
} from "@/components/SecondarySidebar";
import type { LobbyOutletContext } from "@/components/LobbyLayout";

export type MarketplaceSidebarKey = "home" | MarketplaceItemType | "aoa";

/**
 * Builds the marketplace floating secondary sidebar (Home / Skills / Plugins /
 * Agents / Teams | AoA), pushes it to the persistent LobbyLayout via the outlet
 * context, and returns `pillItems` for the mobile sub-nav (§8.6). Counts come
 * from the catalog with AoA items excluded from the type counts; the AoA entry
 * counts the AoA-first-party items. Called by every marketplace page so the
 * sidebar chrome is consistent.
 */
export function useMarketplaceSidebar(activeKey: MarketplaceSidebarKey): {
  pillItems: SecondarySidebarItem[];
} {
  const { setSecondarySidebar } = useOutletContext<LobbyOutletContext>();
  const navigate = useNavigate();
  const { data: catalog } = useCatalog();
  const [collapsed, setCollapsed] = useState(false);

  const items = catalog?.items ?? [];
  const aoaCount = items.filter(isAoaItem).length;
  const main = items.filter((i) => !isAoaItem(i));
  const c = {
    home: main.length,
    skill: main.filter((i) => i.type === "skill").length,
    plugin: main.filter((i) => i.type === "plugin").length,
    agent: main.filter((i) => i.type === "agent").length,
    team: main.filter((i) => i.type === "team").length,
    aoa: aoaCount,
  };

  const go = (key: MarketplaceSidebarKey) => {
    if (key === "home") navigate("/marketplace");
    else if (key === "aoa") navigate("/marketplace?view=aoa");
    else navigate(`/marketplace?type=${key}`);
  };

  const mk = (
    id: MarketplaceSidebarKey,
    label: string,
    icon: SecondarySidebarItem["icon"],
    count: number,
  ): SecondarySidebarItem => ({
    id,
    label,
    icon,
    count,
    active: activeKey === id,
    onClick: () => go(id),
  });

  const mainItems: SecondarySidebarItem[] = [
    mk("home", "Home", <Home />, c.home),
    mk("skill", "Skills", <Sparkles />, c.skill),
    mk("plugin", "Plugins", <Puzzle />, c.plugin),
    mk("agent", "Agents", <Bot />, c.agent),
    mk("team", "Teams", <Users />, c.team),
  ];
  const aoaItem = mk("aoa", "AoA", <Sparkles className="text-brand" />, c.aoa);
  const sections: SecondarySidebarSection[] = [{ items: mainItems }, { items: [aoaItem] }];

  useLayoutEffect(() => {
    setSecondarySidebar(
      <SecondarySidebar
        sections={sections}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        floating
      />,
    );
    return () => setSecondarySidebar(null);
    // Rebuild when the active row, collapse state, or any count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSecondarySidebar, activeKey, collapsed, c.home, c.skill, c.plugin, c.agent, c.team, c.aoa]);

  return { pillItems: [...mainItems, aoaItem] };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @armyofagents/ui exec vitest run src/components/marketplace/__tests__/useMarketplaceSidebar.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/marketplace/useMarketplaceSidebar.tsx ui/src/components/marketplace/__tests__/useMarketplaceSidebar.test.tsx
git commit -m "feat(marketplace): useMarketplaceSidebar hook (sections + counts + outlet handoff)"
```

---

## Task 3: Wire the sidebar into `Marketplace.tsx` (browse page)

**Files:**
- Modify: `ui/src/pages/Marketplace.tsx`
- Test: `ui/src/__tests__/Marketplace.test.tsx`

- [ ] **Step 1: Derive the active key + AoA view; split items; drop the chips**

In `Marketplace.tsx`:
1. Read `view` alongside `type`:
   ```tsx
   const isAoaView = searchParams.get("view") === "aoa";
   const activeKey: MarketplaceSidebarKey = isAoaView
     ? "aoa"
     : (selectedType ?? "home");
   ```
2. Call the hook and get pill items:
   ```tsx
   const { pillItems } = useMarketplaceSidebar(activeKey);
   ```
3. Split the catalog and choose the base list per view. Replace the `visible`
   base so Home/type views use non-AoA items and the AoA view uses AoA items:
   ```tsx
   const aoaItems = useMemo(() => items.filter(isAoaItem), [items]);
   const mainItems = useMemo(() => items.filter((i) => !isAoaItem(i)), [items]);
   const base = isAoaView ? aoaItems : mainItems;
   ```
   Then in the `visible` memo use `base` instead of `items` as the starting list,
   and in `typeCounts` use `mainItems` instead of `items`. When `isAoaView`, ignore
   `selectedType` (show all AoA types).
4. Remove the `<MarketplaceFilterChips .../>` render (the sidebar replaces it) and
   its import.
5. Add the mobile pill row (md:hidden), mirroring InstanceSettingsPage, driven by
   `pillItems`:
   ```tsx
   <div className="md:hidden mb-5 -mx-4 overflow-x-auto px-4 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
     <div className="flex gap-1.5 w-max">
       {pillItems.map((p) => (
         <button
           key={p.id}
           type="button"
           data-active={p.active ? "true" : undefined}
           onClick={p.onClick}
           className={cn(
             "inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12.5px] font-medium border whitespace-nowrap shrink-0 transition-colors",
             p.active
               ? "bg-brand/[0.08] text-[hsl(15_60%_75%)] border-brand/[0.25]"
               : "bg-card border-border text-foreground/[0.78] hover:bg-card-2 hover:text-foreground",
           )}
         >
           {p.icon}
           {p.label}
         </button>
       ))}
     </div>
   </div>
   ```
   (Import `useMarketplaceSidebar`, `type MarketplaceSidebarKey` from the hook,
   `isAoaItem` from marketplace-constants, and `cn` if not already imported.)
6. When `isAoaView`, the section heading area should render all AoA types (reuse the
   existing `SECTION_ORDER`/`grouped` render path against the AoA `base`); the
   "packages" rows (skill packages) render only on non-AoA views for v1 (guard the
   package render with `!isAoaView`). Item-level exclusion is already handled by `base`.

- [ ] **Step 2: Update `Marketplace.test.tsx`**

The chip-row tests (`renders the filter chip row with all 5 chips`, `clicking the
Skills chip filters…`, `renders the sub-filter chip row…` if it asserted the type
chips) must move to sidebar assertions. Because the page now needs the Outlet
context, render it under a minimal `LobbyLayout`-style wrapper (mirror the
`renderSettings` helper in `InstanceSettingsPage-signout.test.tsx`):

```tsx
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
function renderMarketplace(path = "/marketplace") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={{ setSecondarySidebar: () => {} }} />}>
          <Route path="/marketplace" element={<Marketplace />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
```

Keep the catalog/hero/error tests. Add: on `/marketplace?view=aoa` the grid shows
AoA items and excludes a known non-AoA item; on `/marketplace` (home) a known
AoA-owned item is NOT in the grid. Use the existing test catalog fixture; if it has
no aoa-curated item, add one inline to the mock.

- [ ] **Step 3: Typecheck + run Marketplace test**

Run: `pnpm --filter @armyofagents/ui typecheck`
Run: `pnpm --filter @armyofagents/ui exec vitest run src/__tests__/Marketplace.test.tsx`
Expected: typecheck clean; Marketplace tests pass.

- [ ] **Step 4: Commit**

```bash
git add ui/src/pages/Marketplace.tsx ui/src/__tests__/Marketplace.test.tsx
git commit -m "feat(marketplace): secondary sidebar + AoA view on the browse page"
```

---

## Task 4: Persist the sidebar on the other marketplace pages

**Files:**
- Modify: `ui/src/pages/MarketplaceDetail.tsx`, `MarketplaceSearch.tsx`, `MarketplacePackageDetail.tsx`
- Tests: the three `Marketplace*.test.tsx` (add the Outlet wrapper)

- [ ] **Step 1: Call the hook on each page with a derived active key**

For each page, add `useMarketplaceSidebar(<key>)` near the top of the component:
- `MarketplaceDetail.tsx` (route `/marketplace/:type/:slug`): derive from the item /
  `useParams().type` when it is a valid `MarketplaceItemType`, else `"home"`:
  ```tsx
  const params = useParams();
  const key = (["skill","plugin","agent","team"] as const).includes(params.type as any)
    ? (params.type as MarketplaceSidebarKey)
    : "home";
  useMarketplaceSidebar(key);
  ```
- `MarketplacePackageDetail.tsx` (skill packages): `useMarketplaceSidebar("skill")`.
- `MarketplaceSearch.tsx`: `useMarketplaceSidebar("home")`.

(Each page already renders under `LobbyLayout`, so `useOutletContext` resolves.)

- [ ] **Step 2: Update the three page tests to wrap in the Outlet context**

Each of `MarketplaceDetail.test.tsx`, `MarketplaceSearch.test.tsx`,
`MarketplacePackageDetail.test.tsx` renders the page directly. Wrap the render in the
same minimal Outlet-context wrapper as Task 3 Step 2 (a `setSecondarySidebar: () => {}`
context), because the page now calls `useOutletContext`. Keep all existing assertions.

- [ ] **Step 3: Typecheck + run the three tests**

Run: `pnpm --filter @armyofagents/ui typecheck`
Run: `pnpm --filter @armyofagents/ui exec vitest run src/__tests__/MarketplaceDetail.test.tsx src/__tests__/MarketplaceSearch.test.tsx src/__tests__/MarketplacePackageDetail.test.tsx`
Expected: clean + all pass.

- [ ] **Step 4: Retire `MarketplaceFilterChips` if unused**

Run: `grep -rn "MarketplaceFilterChips" ui/src --include=*.tsx | grep -v __tests__`
If no non-test references remain, delete `ui/src/components/marketplace/MarketplaceFilterChips.tsx`
and its test `ui/src/components/marketplace/__tests__/MarketplaceFilterChips.test.tsx`
(if present). If still referenced, leave it.

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/MarketplaceDetail.tsx ui/src/pages/MarketplaceSearch.tsx ui/src/pages/MarketplacePackageDetail.tsx ui/src/__tests__/MarketplaceDetail.test.tsx ui/src/__tests__/MarketplaceSearch.test.tsx ui/src/__tests__/MarketplacePackageDetail.test.tsx
git commit -m "feat(marketplace): persist secondary sidebar across detail/search/package pages"
```

---

## Task 5: Full verification + live check

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter @armyofagents/ui typecheck` → expect clean.

- [ ] **Step 2: Full UI suite**

Run: `pnpm --filter @armyofagents/ui test:run` → expect all green.

- [ ] **Step 3: Live-verify on :3281** (uses the `feat/lobby-empty-state` instance)

Using the gstack browse binary:
- `goto http://127.0.0.1:3281/marketplace` → secondary sidebar renders (Home / Skills /
  Plugins / Agents / Teams | AoA), primary rail auto-collapsed, horizontal chips gone.
  Screenshot; `console --errors` clean.
- Click **AoA** → URL `?view=aoa`, grid shows AoA items only; click **Skills** →
  `?type=skill`, AoA items absent; **Home** → `/marketplace`, AoA items absent.
- Drill into an item → the sidebar persists (Task 4).
- Narrow viewport → mobile pill row shows; sidebar hidden.

Expected: all correct, zero console errors, AoA items segregated.

- [ ] **Step 4: Screenshot proof** — save + share the browse page with the sidebar.

---

## Self-review notes

- **Spec coverage:** M1 outlet handoff → Task 2; M2 entries → hook; M3 Home=All + `?type=` → hook `go`/Task 3; M4 AoA `?view=aoa` → Task 3; M5 `isAoaItem` → Task 1; M6 exclusion → Task 3 `base`/counts; M7 remove chips → Task 3; M8 all pages → Task 4; M9 mobile pills → Task 3.
- **Placeholder scan:** none — concrete code/commands throughout.
- **Type consistency:** `MarketplaceSidebarKey` used across hook + pages; `isAoaItem`/`AOA_OWNERS` signatures stable; `SecondarySidebarItem`/`Section` from the real component; `useCatalog().data.items` shape matches Marketplace.tsx usage.
- **Known caveat (documented):** skill-*packages* rows are AoA-excluded only via the `!isAoaView` guard in v1; item-level exclusion (the hard requirement) is fully handled by `base`. Package-owner exclusion on Home is a follow-up if the mixed packages row looks wrong in the live check.
