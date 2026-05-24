# Threads — Plan 4: Threads shell UI

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. **Prerequisites: Plans 1-2 merged** (data model + thread service/endpoints). Plan 3 (crew) can land in parallel.

**Goal:** The 3-pane **focus view** — origin card, Thread tab, Scope tab — over the reused right-viewer, plus the unified "New Thread" creation modal.

**Architecture:** New React pages/components under `ui/src/pages/ThreadDetail.tsx` + `ui/src/components/threads/`, a `ui/src/api/threads.ts` client mirroring `ui/src/api/discussions.ts`, and a `DialogContext` extension. The right pane **reuses** `WorkspacePreviewPanel` + `output-viewer-registry.ts`. Visual reference: `.superpowers/brainstorm/1347-1779468972/content/thread-detail-v13.html` and `docs/architecture/design-system.md`.

**Tech stack:** React 19 + Vite + Tailwind v4, `@tanstack/react-query` v5, `react-router-dom` v7, `react-resizable-panels` (3-pane), `lucide-react` icons. Tests: Vitest + `@testing-library/react` (jsdom).

**Run tests:** `pnpm --filter @armyofagents/ui exec vitest run <path-relative-to-ui>`. Typecheck: `pnpm --filter @armyofagents/ui typecheck`.

**RTL test wrapper** (reuse in every render test): components using React Query/router need providers. Create `ui/src/test/renderWithProviders.tsx` if it doesn't exist:

```tsx
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

export function renderWithProviders(ui: ReactElement, { route = "/" } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
```

---

## Task 1: `threads` API client

**Files:**
- Create: `ui/src/api/threads.ts`
- Test: verified by `typecheck` + exercised by later component tests.

- [ ] **Step 1: Implement** — mirror `ui/src/api/discussions.ts` (same fetch wrapper + base path `/companies/${companyId}/discussions`). Author:

```ts
import { discussionsApi, type DiscussionDetail, type DiscussionListItem } from "./discussions";

// Threads ARE discussions with thread fields; extend the existing types.
export interface ThreadFields {
  phase: "discuss" | "scope" | "assign" | "done";
  visibility: "open" | "private";
  ownerUserId: string | null;
  originSource: string | null;
  intent: string[] | null;
  goalId: string | null;
  autonomyLevel: number | null;
  summaryText: string | null;
  summaryNext: string | null;
}
export type ThreadListItem = DiscussionListItem & ThreadFields;
export type ThreadDetail = DiscussionDetail & ThreadFields;

// Reuse the same fetch helper discussionsApi uses (see ui/src/api/discussions.ts).
import { apiFetch } from "./client"; // adjust to the actual helper name/path used by discussions.ts

export const threadsApi = {
  list: (companyId: string, filters?: { phase?: string }) =>
    discussionsApi.list(companyId, filters as never) as Promise<ThreadListItem[]>,
  detail: (companyId: string, id: string) =>
    discussionsApi.detail(companyId, id) as unknown as Promise<ThreadDetail>,
  advancePhase: (companyId: string, id: string, phase: string) =>
    apiFetch(`/companies/${companyId}/discussions/${id}/phase`, { method: "PATCH", body: { phase } }),
  claim: (companyId: string, id: string) =>
    apiFetch(`/companies/${companyId}/discussions/${id}/claim`, { method: "POST" }),
  transfer: (companyId: string, id: string, toUserId: string) =>
    apiFetch(`/companies/${companyId}/discussions/${id}/transfer`, { method: "POST", body: { toUserId } }),
  addParticipant: (companyId: string, id: string, p: { principalType: "user" | "agent"; principalId: string; role: string }) =>
    apiFetch(`/companies/${companyId}/discussions/${id}/participants`, { method: "POST", body: p }),
  promoteToGoal: (companyId: string, id: string, body: { projectIds: string[]; level: string; parentId?: string }) =>
    apiFetch(`/companies/${companyId}/discussions/${id}/promote-to-goal`, { method: "POST", body }),
};
```

> Open `ui/src/api/discussions.ts` first and copy its exact fetch-helper import (the `apiFetch`/`api` call style + how it sets method/body). Match it.

- [ ] **Step 2: Verify** — `pnpm --filter @armyofagents/ui typecheck` → no errors.

- [ ] **Step 3: Commit**

```bash
git add ui/src/api/threads.ts
git commit -m "feat(threads-ui): threads API client over the discussions endpoints"
```

---

## Task 2: Pure Scope-grouping helper

The Scope tab groups extracted items into **Needs input** (pending, incl. conflicts) / **Confirmed** / **References** / **Artifacts**.

**Files:**
- Create: `ui/src/components/threads/scopeGrouping.ts`
- Test: `ui/src/components/threads/__tests__/scopeGrouping.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { groupScopeItems } from "../scopeGrouping";

const item = (over: Partial<{ type: string; status: string; conflictsWith: unknown }>) => ({
  id: Math.random().toString(), type: "task", status: "pending", conflictsWith: null, title: "x", ...over,
});

describe("groupScopeItems", () => {
  it("pending items (and conflicts) go to Needs input", () => {
    const g = groupScopeItems([item({ status: "pending" }), item({ status: "pending", conflictsWith: [{}] })]);
    expect(g.needsInput).toHaveLength(2);
    expect(g.needsInput[1].hasConflict).toBe(true);
  });
  it("approved tasks/decisions go to Confirmed", () => {
    const g = groupScopeItems([item({ status: "approved", type: "task" })]);
    expect(g.confirmed).toHaveLength(1);
  });
  it("references and artifacts split into their own groups", () => {
    const g = groupScopeItems([item({ type: "reference", status: "approved" }), item({ type: "artifact", status: "approved" })]);
    expect(g.references).toHaveLength(1);
    expect(g.artifacts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @armyofagents/ui exec vitest run src/components/threads/__tests__/scopeGrouping.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
export interface ScopeItem {
  id: string;
  type: string; // ExtractionItemType
  status: string; // pending|approved|rejected|edited
  title: string;
  conflictsWith?: unknown;
}
export interface GroupedScope {
  needsInput: (ScopeItem & { hasConflict: boolean })[];
  confirmed: ScopeItem[];
  references: ScopeItem[];
  artifacts: ScopeItem[];
}

export function groupScopeItems(items: ScopeItem[]): GroupedScope {
  const g: GroupedScope = { needsInput: [], confirmed: [], references: [], artifacts: [] };
  for (const it of items) {
    if (it.status === "rejected") continue;
    if (it.status === "pending" || it.status === "edited") {
      g.needsInput.push({ ...it, hasConflict: Array.isArray(it.conflictsWith) && it.conflictsWith.length > 0 });
      continue;
    }
    // approved
    if (it.type === "reference") g.references.push(it);
    else if (it.type === "artifact") g.artifacts.push(it);
    else g.confirmed.push(it);
  }
  return g;
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/threads/scopeGrouping.ts ui/src/components/threads/__tests__/scopeGrouping.test.ts
git commit -m "feat(threads-ui): pure scope-item grouping helper"
```

---

## Task 3: 3-pane ThreadDetail shell

**Files:**
- Create: `ui/src/pages/ThreadDetail.tsx`
- Modify: the app router (add `/:companyPrefix/threads/:threadId` → `ThreadDetail`) — find the route table (where `DiscussionDetail` is routed) and add the thread route.
- Test: `ui/src/pages/__tests__/ThreadDetail.test.tsx`

- [ ] **Step 1: Write the failing render test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { ThreadDetail } from "../ThreadDetail";

vi.mock("../../api/threads", () => ({
  threadsApi: { detail: vi.fn().mockResolvedValue({ id: "t1", title: "Launch plan", phase: "discuss", visibility: "open", ownerUserId: "u1", entries: [], items: [] }) },
}));

describe("ThreadDetail", () => {
  it("renders the three panes (origin card, thread/scope center, viewer)", async () => {
    renderWithProviders(<ThreadDetail />, { route: "/acme/threads/t1" });
    expect(await screen.findByText("Launch plan")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /thread/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /scope/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement** — `ui/src/pages/ThreadDetail.tsx` using `react-resizable-panels` for the 3-pane layout (left: nav/index rail; center: OriginCard + Thread|Scope tabs; right: viewer). Real skeleton:

```tsx
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useState } from "react";
import { threadsApi, type ThreadDetail as ThreadDetailData } from "../api/threads";
import { OriginCard } from "../components/threads/OriginCard";
import { ThreadTab } from "../components/threads/ThreadTab";
import { ScopeTab } from "../components/threads/ScopeTab";
import { WorkspacePreviewPanel } from "../components/workspace/WorkspacePreviewPanel";
import { useCompany } from "../hooks/useCompany"; // reuse however other pages read the active company

export function ThreadDetail() {
  const { threadId } = useParams();
  const companyId = useCompany().id; // adjust to the real company-context hook
  const [tab, setTab] = useState<"thread" | "scope">("thread");
  const { data } = useQuery<ThreadDetailData>({
    queryKey: ["thread", companyId, threadId],
    queryFn: () => threadsApi.detail(companyId, threadId!),
    enabled: !!threadId,
  });

  if (!data) return <div className="p-6 text-sm text-muted-foreground">Loading thread…</div>;

  return (
    <PanelGroup direction="horizontal" className="h-full">
      <Panel defaultSize={58} minSize={30} className="flex flex-col">
        <OriginCard thread={data} />
        <div role="tablist" className="flex gap-1 border-b px-4">
          <button role="tab" aria-selected={tab === "thread"} onClick={() => setTab("thread")}>Thread</button>
          <button role="tab" aria-selected={tab === "scope"} onClick={() => setTab("scope")}>Scope</button>
        </div>
        <div className="flex-1 overflow-auto">
          {tab === "thread" ? <ThreadTab thread={data} /> : <ScopeTab thread={data} />}
        </div>
      </Panel>
      <PanelResizeHandle className="w-px bg-border" />
      <Panel defaultSize={42} minSize={20}>
        <WorkspacePreviewPanel companyId={companyId} /* thread viewer mode — see Task 6 */ />
      </Panel>
    </PanelGroup>
  );
}
```

> Reuse the real company-context hook (search how `DiscussionDetail.tsx` reads `companyId`). Match the design-system tab styling (don't ship raw buttons — use the existing tab/pill classes; reference `thread-detail-v13.html`).

- [ ] **Step 4: Run to verify it passes** — PASS. Then `pnpm --filter @armyofagents/ui typecheck`.

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/ThreadDetail.tsx ui/src/test/renderWithProviders.tsx ui/src/pages/__tests__/ThreadDetail.test.tsx
git commit -m "feat(threads-ui): 3-pane ThreadDetail shell with Thread|Scope tabs"
```

---

## Task 4: OriginCard

**Files:**
- Create: `ui/src/components/threads/OriginCard.tsx`
- Test: `ui/src/components/threads/__tests__/OriginCard.test.tsx`

- [ ] **Step 1: Write the failing render test** — assert it shows the title, the phase pills (discuss/scope/assign/done with the current one active), and the owner/Unclaimed state.

```tsx
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test/renderWithProviders";
import { OriginCard } from "../OriginCard";

describe("OriginCard", () => {
  it("shows phase pills with the current phase active", () => {
    renderWithProviders(<OriginCard thread={{ id: "t1", title: "X", phase: "scope", visibility: "open", ownerUserId: "u1" } as never} />);
    const active = screen.getByRole("button", { name: /scope/i });
    expect(active).toHaveattribute?.("aria-current", "true");
  });
  it("shows Unclaimed when ownerUserId is null", () => {
    renderWithProviders(<OriginCard thread={{ id: "t1", title: "X", phase: "discuss", visibility: "open", ownerUserId: null } as never} />);
    expect(screen.getByText(/unclaimed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module missing).

- [ ] **Step 3: Implement** — `OriginCard.tsx` with: title, origin/intent chips, participants (avatars) + @mention entry point (the input itself is Plan 6), the phase pill bar (clickable → `threadsApi.advancePhase`, with confirm), the autonomy (L1/L2/L3) crew popover trigger, and owner/Unclaimed + visibility (open/private) display. Use `lucide-react` icons and design-system classes. Phase pills: render `THREAD_PHASES` from `@armyofagents/shared`, mark current with `aria-current="true"`.

- [ ] **Step 4: Run to verify it passes + typecheck** — PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/threads/OriginCard.tsx ui/src/components/threads/__tests__/OriginCard.test.tsx
git commit -m "feat(threads-ui): OriginCard (chips, participants, phase pills, autonomy)"
```

---

## Task 5: ThreadTab (timeline)

**Files:**
- Create: `ui/src/components/threads/ThreadTab.tsx`
- Test: `ui/src/components/threads/__tests__/ThreadTab.test.tsx`

- [ ] **Step 1: Write the failing render test** — assert entries render in order with author + content (reuse the entry-rendering already in `DiscussionDetail.tsx` — extract a shared `EntryRow` component if the existing markup is inline, or import it).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — `ThreadTab.tsx` renders `thread.entries` (the timeline). Reuse the entry rendering from `DiscussionDetail.tsx`: if it's inline JSX there, extract it into `ui/src/components/threads/EntryRow.tsx` and use it in both places (DRY). Add the composer at the bottom (reuse the existing discussion entry composer). Nested replies (`parentEntryId`, 2-deep) render indented.

- [ ] **Step 4: Run to verify it passes + typecheck.**

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/threads/ThreadTab.tsx ui/src/components/threads/EntryRow.tsx ui/src/components/threads/__tests__/ThreadTab.test.tsx
git commit -m "feat(threads-ui): ThreadTab timeline (shared EntryRow)"
```

---

## Task 6: ScopeTab + right-viewer reuse

**Files:**
- Create: `ui/src/components/threads/ScopeTab.tsx`
- Modify: `ui/src/components/workspace/WorkspacePreviewPanel.tsx` (accept a thread-viewer mode — image/md/pdf/code/static-HTML, no workspace required)
- Test: `ui/src/components/threads/__tests__/ScopeTab.test.tsx`

- [ ] **Step 1: Write the failing render test** — render a thread with mixed items and assert the four groups appear with the right items (use `groupScopeItems` from Task 2). Assert Summary line + Plan section render.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement ScopeTab** — Summary (from `thread.summaryText`/`summaryNext`), the Plan section (ordered steps; v1 read-only render of `thread_plan_steps`, interactivity in Plan 6), then Items via `groupScopeItems(thread.items)`: Needs input (with conflict cards), Confirmed, References, Artifacts. Clicking a pre-task opens the pre-filled Task form in the viewer (Task form parity = NewIssueDialog; wire the click to open it).

- [ ] **Step 4: Reuse the viewer** — extend `WorkspacePreviewPanel` (or wrap it) so the right pane can render a thread artifact via the existing `resolveOutputViewer` registry (`output-viewer-registry.ts`) WITHOUT a workspace: pass an artifact/asset URL + kind. For external URLs use an unfurl card / sandboxed iframe; for static HTML use a sandboxed iframe (`srcdoc` + `sandbox`). Live-app browser stays workspace-bound (SPEC §6.1).

- [ ] **Step 5: Run to verify it passes + typecheck.**

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/threads/ScopeTab.tsx ui/src/components/workspace/WorkspacePreviewPanel.tsx ui/src/components/threads/__tests__/ScopeTab.test.tsx
git commit -m "feat(threads-ui): ScopeTab (Summary/Plan/Items) + viewer reuse"
```

---

## Task 7: `openNewThread` + NewThreadDialog

**Files:**
- Modify: `ui/src/context/DialogContext.tsx`
- Create: `ui/src/components/NewThreadDialog.tsx`
- Test: `ui/src/components/threads/__tests__/newThreadModel.test.ts` (pure branching) + a render test

- [ ] **Step 1: Write the failing pure test** — the modal's type → backend branching is pure. Create `ui/src/components/threads/newThreadModel.ts` consumers' test:

```ts
import { describe, it, expect } from "vitest";
import { resolveCreateTarget } from "../newThreadModel";

describe("resolveCreateTarget", () => {
  it("Goal type routes to goals.create with required fields", () => {
    expect(resolveCreateTarget("goal")).toEqual({ backend: "goal", requires: ["level", "projectIds"] });
  });
  it("Idea/Discussion/Transcript/Document route to discussions.create", () => {
    for (const t of ["idea", "discussion", "transcript", "document"] as const) {
      expect(resolveCreateTarget(t).backend).toBe("discussion");
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement the pure model**

```ts
export type NewThreadType = "idea" | "discussion" | "goal" | "transcript" | "document";
export function resolveCreateTarget(type: NewThreadType): { backend: "goal" | "discussion"; requires: string[] } {
  if (type === "goal") return { backend: "goal", requires: ["level", "projectIds"] };
  return { backend: "discussion", requires: [] };
}
```

- [ ] **Step 4: Extend DialogContext** — in `ui/src/context/DialogContext.tsx`, add `openNewThread(defaults?)`, `newThreadOpen`, `newThreadDefaults`, `closeNewThread()` mirroring the existing `openNewIssue`/`openDiscussionCapture` members. Render `<NewThreadDialog/>` from the provider like the other dialogs.

- [ ] **Step 5: Implement NewThreadDialog** — adaptive form: a type chooser (Idea/Discussion/Goal/Transcript/Document) → fields adapt via `resolveCreateTarget`; Goal type reuses NewGoalDialog fields (level, parent/sub-goal, ≥1 project). "Relate to ▾" / "Add to existing thread" options. On submit, branch to `goalsApi.create` or `discussionsApi.create`. Render test: switching to Goal reveals the project field.

- [ ] **Step 6: Run to verify it passes + typecheck.**

- [ ] **Step 7: Commit**

```bash
git add ui/src/context/DialogContext.tsx ui/src/components/NewThreadDialog.tsx ui/src/components/threads/newThreadModel.ts ui/src/components/threads/__tests__/newThreadModel.test.ts
git commit -m "feat(threads-ui): openNewThread + adaptive NewThreadDialog"
```

---

## Task 8: Sidebar Threads nav

**Files:**
- Modify: `ui/src/components/Sidebar.tsx`
- Test: covered by `typecheck` + existing Sidebar tests if present.

- [ ] **Step 1: Implement** — in `Sidebar.tsx` WORK section, add a `SidebarNavItem` for Threads (route `/:companyPrefix/threads`), icon from `lucide-react`, with the pending-count badge (reuse `sidebarBadges?.pendingDiscussions`). Place it adjacent to the existing Discussions item.

- [ ] **Step 2: Verify** — `pnpm --filter @armyofagents/ui typecheck`; run the app (`pnpm dev`) and confirm the nav item routes to the Threads index (Plan 5).

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Sidebar.tsx
git commit -m "feat(threads-ui): add Threads to the sidebar WORK section"
```

---

## Done criteria (Plan 4)

- `pnpm --filter @armyofagents/ui exec vitest run src/components/threads src/pages/__tests__/ThreadDetail.test.tsx` — PASS.
- `pnpm --filter @armyofagents/ui typecheck` — no errors.
- Opening `/…/threads/:id` shows the 3-pane focus view; Thread/Scope tabs switch; Scope groups render; New Thread creates via the existing backends.

Hand-off: Plan 5 adds the index (List + Board) that links into this focus view.

---

## Design-Review Amendments (2026-05-24)

Visual reference: the approved mock `.superpowers/brainstorm/1347-1779468972/content/thread-detail-v13.html` + `docs/architecture/design-system.md`. Build to these; the specs below fill the gaps the plan left implicit.

**D1 — Mobile (3-pane → tabs).** On mobile, collapse the 3 panes into a tab bar `[Origin] [Thread] [Scope] [Viewer]` using **CSS `hidden` (not conditional render)**, mirroring `WorkspaceLayout`'s `[Tasks][Timeline][Preview][Context]` (CLAUDE.md → Workspace System) and the design-system mobile sub-nav (§8.6). Same breakpoint as the workspace. Desktop keeps the resizable `PanelGroup`.

**D2 — Interaction-state matrix** (focus view + Scope). Every surface specifies all three:

| Surface | Loading | Empty | Error |
|---------|---------|-------|-------|
| Focus view | skeleton: origin-card block + 3 timeline lines | n/a (a thread always has an origin) | "Couldn't load this thread." + Retry |
| Thread tab | skeleton entries | "No posts yet — start the discussion." + composer auto-focused | "Couldn't load posts." + Retry |
| Scope tab | skeleton group headers | warm: "Nothing to scope yet. Scribe surfaces items as the discussion grows." | per-group inline error + Retry |
| Summary | shimmer line | "Scribe will summarize once there's enough to go on." | hide line on error |
| Plan | skeleton steps | "No plan yet — advance to Scope to build one." | inline error |

Empty states get warmth + name the agent (Scribe) + a primary action where one exists. Add render tests asserting the empty + error branches, not just populated.

**D3 — A11y baseline** (applies to all Threads UI; Plans 5–7 inherit it):
- Center tabs: ARIA `tablist`/`tab`/`tabpanel`, roving tabindex, Left/Right arrow to switch (use Radix Tabs or wire it by hand).
- Phase pills: real `<button>`s with `aria-current="true"` on the active phase; jump-to-phase opens a focus-trapped confirm (Radix AlertDialog).
- 3-pane resize handles: keyboard-operable (react-resizable-panels supports arrow-key resize) with `aria-label`.
- On thread open, move focus to the center pane heading; the viewer iframe has a `title`.
- Touch targets ≥ 44px; body text ≥ 16px; contrast ≥ 4.5:1 (design-system neutrals already pass).

**Design-system tokens (cite, don't reinvent).** Brand red `--brand` (#b82d1c per v13), warm neutrals, data palette `--d1..--d6`, `--teal`; card chrome per design-system §9.13–9.18; the `--token-skill` colored-atomic-token pattern for the autonomy/skill chips in OriginCard (it already exists for Commander skill tokens). Threads runs inside in-company chrome (not LobbyShell).

**IA.** Match v13's within-center hierarchy: origin card compact at top, tab bar, content dominant; the viewer is the secondary surface (smaller default panel).

---

## Codex Outside-Voice Amendments (2026-05-24)

**#1 — Honor the locked naming/IA: Discussions IS the Threads surface (revise Task 8).** Do NOT add a separate "Threads" sidebar item. SPEC §13 locks: the sidebar label stays **"Discussions"**, each item is a **"Thread."** The existing **Discussions** nav entry stays (label unchanged) and its destination becomes the new Threads index (Plan 5 List/Board) + this focus view. Repoint the existing discussions route to the new shell; do not introduce a parallel `/threads` top-level nav. Internally we say "thread," the user sees "Discussions."

**#2 — "Goal" creation must create a thread, not a bare goal (revise Task 7).** In `NewThreadDialog`, the Goal type creates a **thread (discussion) + a linked goal** so it lives in the continuum (goal-as-property). Flow: create the discussion, then create the goal + set `discussions.goal_id` + write `project_goals` (reuse `threadService.promoteToGoal`). Do NOT call `goalsApi.create` alone — that orphans a goal outside Threads. `resolveCreateTarget("goal")` returns `{ backend: "thread+goal", requires: ["level","projectIds"] }`; update the Task 7 test accordingly.
