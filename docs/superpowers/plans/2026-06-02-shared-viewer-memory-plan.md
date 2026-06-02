# Shared Viewer and Memory Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Workspace viewer renderer into a shared viewer core, adopt it in Memory file previews, and add a closeable Memory Home tab that can later host the network graph.

**Architecture:** Workspace remains the behavioral baseline. Shared code moves into `ui/src/components/viewers/` and domain wrappers feed it source-neutral viewer inputs. Memory keeps item editing, approval, source drawers, folders, and future graph logic domain-specific.

**Tech Stack:** React 19, TanStack Query, Vitest, Testing Library, existing `d3` only for future graph work, existing PDF/Markdown/Mermaid dependencies.

---

## Scope Decisions

- Workspace UI and behavior must not change. Tests should treat the first extraction as a compatibility move.
- Memory file previews should use the shared renderer; Memory item editing should remain in `MarkdownItemViewer`.
- Memory Home should become a real closeable tab opened by the viewer `+` button. The current central Memory Home dashboard can stay in the middle pane for now if no viewer tab is open.
- The graph should be reserved as a slot inside Memory Home, not implemented in this slice.
- No backend/schema changes are required for this slice.

## File Structure

Create:

- `ui/src/components/viewers/viewer-registry.ts` - source-neutral viewer resolver currently based on Workspace `output-viewer-registry`.
- `ui/src/components/viewers/SharedContentViewer.tsx` - source-neutral renderer currently based on Workspace `WorkProductViewer`.
- `ui/src/components/viewers/ViewerTabs.tsx` - generic closeable tab bar shared by Memory first, Workspace later only if safe.
- `ui/src/components/viewers/__tests__/viewer-registry.test.ts`
- `ui/src/components/viewers/__tests__/SharedContentViewer.test.tsx`
- `ui/src/components/viewers/__tests__/ViewerTabs.test.tsx`

Modify:

- `ui/src/components/workspace/output-viewer-registry.ts` - re-export from shared registry for compatibility during migration.
- `ui/src/components/workspace/WorkProductViewer.tsx` - become a thin compatibility wrapper around the shared renderer.
- `ui/src/components/workspace/WorkspacePreviewPanel.tsx` - update imports only; no behavior change.
- `ui/src/components/memory/MemoryViewer.tsx` - route asset tabs through shared content renderer and support Home tab.
- `ui/src/components/memory/MemoryViewerTabs.tsx` - become a Memory-specific wrapper around `ViewerTabs` and include `+`.
- `ui/src/components/memory/MemoryCollapsedTabStrip.tsx` - understand Home tab icon/title if tabs are collapsed.
- `ui/src/components/memory/MemoryHomeDashboard.tsx` - add viewer-friendly mode with graph slot.
- `ui/src/hooks/useMemoryTabs.ts` - add `home` tab kind and open-home helper.
- `ui/src/lib/memoryTabs.ts` - add `home` tab type.
- `ui/src/api/memoryAssets.ts` - no planned API change; use existing asset detail/content URLs.

Tests to update:

- `ui/src/__tests__/OutputViewerRegistry.test.ts`
- `ui/src/__tests__/WorkspacePreviewPanel.test.tsx`
- `ui/src/__tests__/MemoryExplorer.test.tsx`
- `ui/src/components/memory/__tests__/MemoryViewerTabs.test.tsx`
- `ui/src/components/memory/__tests__/MemoryCollapsedTabStrip.test.tsx`
- Add `ui/src/components/memory/__tests__/MemoryViewer.test.tsx` if not already present.

---

## Task 1: Move Viewer Registry Without Behavior Change

**Files:**

- Create: `ui/src/components/viewers/viewer-registry.ts`
- Create: `ui/src/components/viewers/__tests__/viewer-registry.test.ts`
- Modify: `ui/src/components/workspace/output-viewer-registry.ts`
- Modify: `ui/src/__tests__/OutputViewerRegistry.test.ts`
- Modify: `ui/src/__tests__/WorkspacePreviewPanel.test.tsx`

- [ ] **Step 1: Write compatibility tests for the new shared registry**

Move or duplicate the existing registry assertions so they import from the shared path:

```ts
import { resolveViewer } from "../components/viewers/viewer-registry";

describe("resolveViewer", () => {
  it("detects markdown, json, csv, media, pdf, sandbox markup, mermaid, canvas, and downloads", () => {
    expect(resolveViewer({ contentType: "text/markdown", filename: "note.md", assetId: "a" }).kind).toBe("markdown");
    expect(resolveViewer({ contentType: "application/json", filename: "data.json", assetId: "a" }).kind).toBe("json");
    expect(resolveViewer({ contentType: "text/csv", filename: "data.csv", assetId: "a" }).kind).toBe("table");
    expect(resolveViewer({ contentType: "image/png", filename: "image.png", assetId: "a" }).kind).toBe("image");
    expect(resolveViewer({ contentType: "video/mp4", filename: "video.mp4", assetId: "a" }).kind).toBe("video");
    expect(resolveViewer({ contentType: "audio/webm", filename: "audio.webm", assetId: "a" }).kind).toBe("audio");
    expect(resolveViewer({ contentType: "application/pdf", filename: "report.pdf", assetId: "a" }).kind).toBe("pdf");
    expect(resolveViewer({ contentType: "text/html", filename: "page.html", assetId: "a" }).kind).toBe("html_sandbox");
    expect(resolveViewer({ contentType: "image/svg+xml", filename: "diagram.svg", assetId: "a" }).kind).toBe("svg_sandbox");
    expect(resolveViewer({ contentType: "text/plain", filename: "diagram.mmd", assetId: "a" }).kind).toBe("mermaid");
    expect(resolveViewer({ contentType: "application/json", filename: "flow.aoa-canvas.json", assetId: "a" }).kind).toBe("canvas");
    expect(resolveViewer({ contentType: "application/zip", filename: "bundle.zip", assetId: "a" }).kind).toBe("download");
  });
});
```

- [ ] **Step 2: Run the new registry test to verify it fails before implementation**

Run:

```sh
pnpm --filter ui test -- viewer-registry.test.ts
```

Expected: fail because `ui/src/components/viewers/viewer-registry.ts` does not exist yet.

- [ ] **Step 3: Move the registry implementation**

Create `ui/src/components/viewers/viewer-registry.ts` by moving the current implementation from `ui/src/components/workspace/output-viewer-registry.ts`.

Define the public shared names:

```ts
export type ViewerKind =
  | "markdown"
  | "code"
  | "json"
  | "table"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "html_sandbox"
  | "svg_sandbox"
  | "mermaid"
  | "canvas"
  | "download";

export interface ViewerInput {
  contentType?: string | null;
  filename?: string | null;
  assetId?: string | null;
  assetUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ViewerResolution {
  kind: ViewerKind;
  label: string;
  assetUrl: string | null;
  url: string | null;
  canOpenDirectly: boolean;
  shouldExecuteInBrowser: boolean;
  requiresTextFetch: boolean;
  canShowSource: boolean;
}

export function resolveViewer(input: ViewerInput): ViewerResolution;
```

Keep backward-compatible exports too:

```ts
export type OutputViewerKind = ViewerKind;
export type OutputViewerResolution = ViewerResolution;
export const resolveOutputViewer = resolveViewer;
```

Then replace `ui/src/components/workspace/output-viewer-registry.ts` with:

```ts
export {
  resolveViewer,
  resolveOutputViewer,
  type ViewerKind,
  type ViewerResolution,
  type OutputViewerKind,
  type OutputViewerResolution,
} from "@/components/viewers/viewer-registry";
```

- [ ] **Step 4: Run registry and Workspace compatibility tests**

Run:

```sh
pnpm --filter ui test -- viewer-registry.test.ts OutputViewerRegistry.test.ts WorkspacePreviewPanel.test.tsx
```

Expected: pass.

---

## Task 2: Extract SharedContentViewer Without Workspace Behavior Change

**Files:**

- Create: `ui/src/components/viewers/SharedContentViewer.tsx`
- Create: `ui/src/components/viewers/__tests__/SharedContentViewer.test.tsx`
- Modify: `ui/src/components/workspace/WorkProductViewer.tsx`
- Modify: `ui/src/components/workspace/WorkspacePreviewPanel.tsx`
- Modify: `ui/src/__tests__/WorkspacePreviewPanel.test.tsx`

- [ ] **Step 1: Write shared renderer tests**

Create tests that cover:

- inline markdown renders without fetch
- text content fetches only when `requiresTextFetch` is true and no inline content exists
- HTML/SVG use sandboxed iframes
- download fallback renders an external open link
- PDF delegates to `PdfDocumentViewer`

Representative test:

```tsx
import { render, screen } from "@testing-library/react";
import { SharedContentViewer } from "../SharedContentViewer";

it("renders inline markdown without fetching", () => {
  render(
    <SharedContentViewer
      viewer={{
        kind: "markdown",
        label: "Markdown preview",
        assetUrl: null,
        url: null,
        canOpenDirectly: false,
        shouldExecuteInBrowser: false,
        requiresTextFetch: true,
        canShowSource: true,
      }}
      filename="note.md"
      inlineTextContent="# Hello"
    />,
  );

  expect(screen.getByText("Hello")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails before implementation**

Run:

```sh
pnpm --filter ui test -- SharedContentViewer.test.tsx
```

Expected: fail because `SharedContentViewer` does not exist.

- [ ] **Step 3: Move renderer implementation**

Move the implementation from `ui/src/components/workspace/WorkProductViewer.tsx` into `ui/src/components/viewers/SharedContentViewer.tsx`.

Keep these behavior details unchanged:

- `ReactMarkdown` with `remarkGfm`
- HTML iframe `sandbox="allow-scripts"`
- Mermaid `securityLevel: "strict"`
- PDF uses `PdfDocumentViewer`
- CSV parsing remains lightweight for now
- Canvas JSON fallback remains source view on invalid JSON

Then make `WorkProductViewer.tsx` a compatibility wrapper:

```tsx
import { SharedContentViewer } from "@/components/viewers/SharedContentViewer";
import type { OutputViewerResolution } from "./output-viewer-registry";

interface WorkProductViewerProps {
  viewer: OutputViewerResolution;
  filename: string;
  inlineTextContent?: string | null;
}

export function WorkProductViewer(props: WorkProductViewerProps) {
  return <SharedContentViewer {...props} />;
}
```

- [ ] **Step 4: Run shared renderer and Workspace preview tests**

Run:

```sh
pnpm --filter ui test -- SharedContentViewer.test.tsx WorkspacePreviewPanel.test.tsx
```

Expected: pass with no visual or behavior changes in Workspace.

---

## Task 3: Add Generic ViewerTabs and Keep Memory Styling Stable

**Files:**

- Create: `ui/src/components/viewers/ViewerTabs.tsx`
- Create: `ui/src/components/viewers/__tests__/ViewerTabs.test.tsx`
- Modify: `ui/src/components/memory/MemoryViewerTabs.tsx`
- Modify: `ui/src/components/memory/__tests__/MemoryViewerTabs.test.tsx`

- [ ] **Step 1: Write generic tab behavior tests**

Cover:

- active tab receives selected styling and `aria-selected`
- close button calls `onClose`
- add button calls `onAdd`
- collapse button calls `onToggleCollapse`
- empty tabs still render the add button if provided

Representative API:

```tsx
<ViewerTabs
  tabs={[{ id: "item-1", kind: "memory_item", title: "Brand voice", icon: FileText }]}
  activeKey={{ id: "item-1", kind: "memory_item" }}
  onActivate={(tab) => {}}
  onClose={(tab) => {}}
  onAdd={() => {}}
  onToggleCollapse={() => {}}
/>
```

- [ ] **Step 2: Run test to verify it fails before implementation**

Run:

```sh
pnpm --filter ui test -- ViewerTabs.test.tsx
```

Expected: fail because `ViewerTabs` does not exist.

- [ ] **Step 3: Implement ViewerTabs**

Implement a small generic tab bar that accepts already-normalized tab presentation data:

```ts
export interface ViewerTabModel {
  id: string;
  kind: string;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  closeable?: boolean;
}
```

Keep layout dimensions aligned with the Memory/Workspace 42px header work:

- outer height `h-[42px]`
- add button `h-7 w-7`
- collapse button `h-7 w-7`
- no nested cards

- [ ] **Step 4: Wrap MemoryViewerTabs with ViewerTabs**

`MemoryViewerTabs` should convert Memory tabs into `ViewerTabModel` and pass through handlers. Do not migrate Workspace tab bar yet; that can be a later safe cleanup after Memory proves the generic component.

- [ ] **Step 5: Run Memory tab tests**

Run:

```sh
pnpm --filter ui test -- ViewerTabs.test.tsx MemoryViewerTabs.test.tsx MemoryCollapsedTabStrip.test.tsx
```

Expected: pass.

---

## Task 4: Add Memory Home Tab Type and New-Tab Behavior

**Files:**

- Modify: `ui/src/lib/memoryTabs.ts`
- Modify: `ui/src/hooks/useMemoryTabs.ts`
- Modify: `ui/src/components/memory/MemoryViewerTabs.tsx`
- Modify: `ui/src/components/memory/MemoryCollapsedTabStrip.tsx`
- Modify: `ui/src/pages/MemoryExplorer.tsx`
- Modify: `ui/src/__tests__/MemoryExplorer.test.tsx`
- Modify: `ui/src/components/memory/__tests__/MemoryViewerTabs.test.tsx`

- [ ] **Step 1: Write failing tests for Home tab behavior**

Add tests asserting:

- clicking the viewer `+` opens a `Memory Home` tab
- clicking `+` again activates the existing Home tab instead of duplicating it
- Home tab is closeable
- collapsed viewer rail can activate/expand Home

Representative assertion:

```tsx
await user.click(screen.getByRole("button", { name: /new memory viewer tab/i }));
expect(screen.getByRole("tab", { name: /memory home/i })).toBeInTheDocument();
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
pnpm --filter ui test -- MemoryExplorer.test.tsx MemoryViewerTabs.test.tsx MemoryCollapsedTabStrip.test.tsx
```

Expected: fail because Home tab kind and add behavior are not wired.

- [ ] **Step 3: Add Home tab kind**

Update `ui/src/lib/memoryTabs.ts`:

```ts
export type MemoryTabKind = "home" | "memory_item" | "asset";
```

Add a stable Home tab:

```ts
export const MEMORY_HOME_TAB = {
  id: "memory-home",
  kind: "home" as const,
  title: "Memory Home",
};
```

Update equality helpers so `home` uses the same `{ id, kind }` matching as other tabs.

- [ ] **Step 4: Add openHome helper**

Update `useMemoryTabs`:

```ts
function openHome() {
  openOrActivate(MEMORY_HOME_TAB);
}
```

Return `openHome`.

- [ ] **Step 5: Wire add button**

Pass `openHome` from `MemoryExplorer` into `MemoryViewer`, then into `MemoryViewerTabs`.

Button accessibility:

```tsx
aria-label="New memory viewer tab"
title="New memory viewer tab"
```

- [ ] **Step 6: Run Home tab tests**

Run:

```sh
pnpm --filter ui test -- MemoryExplorer.test.tsx MemoryViewerTabs.test.tsx MemoryCollapsedTabStrip.test.tsx
```

Expected: pass.

---

## Task 5: Render Memory Home Inside the Viewer

**Files:**

- Create: `ui/src/components/memory/MemoryViewerHome.tsx`
- Modify: `ui/src/components/memory/MemoryHomeDashboard.tsx`
- Modify: `ui/src/components/memory/MemoryViewer.tsx`
- Modify: `ui/src/__tests__/MemoryHomeDashboard.test.tsx`
- Modify: `ui/src/__tests__/MemoryExplorer.test.tsx`

- [ ] **Step 1: Write tests for viewer Home content**

Assert Home tab renders:

- quick jump/search control
- layer overview
- recents
- graph slot region

Representative assertion:

```tsx
expect(screen.getByTestId("memory-viewer-home")).toBeInTheDocument();
expect(screen.getByTestId("memory-home-graph-slot")).toBeInTheDocument();
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
pnpm --filter ui test -- MemoryHomeDashboard.test.tsx MemoryExplorer.test.tsx
```

Expected: fail because viewer Home content does not exist yet.

- [ ] **Step 3: Add MemoryViewerHome**

Implement:

```tsx
export function MemoryViewerHome({ companyId }: { companyId: string }) {
  return (
    <div className="h-full min-h-0 overflow-auto" data-testid="memory-viewer-home">
      <MemoryHomeDashboard companyId={companyId} variant="viewer" showQuickJump />
      <section data-testid="memory-home-graph-slot" className="border-t border-border p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Graph</div>
        <div className="mt-2 rounded-md border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
          Memory graph will appear here after relation and graph APIs are implemented.
        </div>
      </section>
    </div>
  );
}
```

Use a plain dashed region for the graph slot; no fake graph yet.

- [ ] **Step 4: Make MemoryHomeDashboard variant-aware**

Add:

```ts
interface MemoryHomeDashboardProps {
  companyId: string;
  showQuickJump?: boolean;
  variant?: "page" | "viewer";
}
```

For `variant="viewer"`:

- reduce outer max width if needed
- keep existing layer/recents content
- avoid creating another panel/card shell

- [ ] **Step 5: Render Home tab in MemoryViewer**

Add case:

```tsx
if (activeTab?.kind === "home") {
  inner = <MemoryViewerHome companyId={companyId} />;
}
```

Keep folder fallback and empty viewer behavior unchanged when no tab is active.

- [ ] **Step 6: Run Home content tests**

Run:

```sh
pnpm --filter ui test -- MemoryHomeDashboard.test.tsx MemoryExplorer.test.tsx
```

Expected: pass.

---

## Task 6: Route Memory Asset Tabs Through SharedContentViewer

**Files:**

- Modify: `ui/src/components/memory/MemoryViewer.tsx`
- Modify: `ui/src/components/memory/viewers/PdfFileViewer.tsx`
- Modify: `ui/src/components/memory/viewers/ImageFileViewer.tsx`
- Modify: `ui/src/components/memory/viewers/VideoFileViewer.tsx`
- Modify: `ui/src/components/memory/viewers/GenericFileViewer.tsx`
- Modify: `ui/src/components/memory/viewers/DocxFileViewer.tsx`
- Create or modify: `ui/src/components/memory/__tests__/MemoryViewer.test.tsx`

- [ ] **Step 1: Write tests for asset renderer routing**

Mock `memoryAssetsApi.get` and assert:

- PDF asset renders via shared PDF viewer path
- image asset renders via shared image path
- video asset renders via shared video path
- unknown file renders download fallback
- DOCX still uses `DocxFileViewer`

DOCX should remain Memory-specific because it depends on Memory asset render/extract behavior.

- [ ] **Step 2: Run test to verify current routing fails shared expectations**

Run:

```sh
pnpm --filter ui test -- MemoryViewer.test.tsx
```

Expected: fail or partially fail until routing is updated.

- [ ] **Step 3: Build Memory asset viewer adapter**

Inside `MemoryViewer.tsx`, convert asset rows into shared viewer input:

```ts
const assetUrl = `/api/companies/${companyId}/memory/assets/${assetId}/content`;
const viewer = resolveViewer({
  contentType: asset.mimeType,
  filename: asset.fileName,
  assetUrl,
  metadata: asset.metadata ?? null,
});
```

Then render:

```tsx
<SharedContentViewer viewer={viewer} filename={asset.fileName} />
```

Keep this exception:

```tsx
if (asset.mimeType === DOCX_MIME) {
  return <DocxFileViewer companyId={companyId} assetId={assetId} />;
}
```

- [ ] **Step 4: Remove or retire redundant simple file viewers**

After tests pass, decide whether to delete `PdfFileViewer`, `ImageFileViewer`, `VideoFileViewer`, and `GenericFileViewer`.

If they are no longer imported anywhere:

```sh
rg -n "PdfFileViewer|ImageFileViewer|VideoFileViewer|GenericFileViewer" ui/src
```

Expected: only their own files. Delete them if unused.

- [ ] **Step 5: Run Memory viewer tests**

Run:

```sh
pnpm --filter ui test -- MemoryViewer.test.tsx MemoryExplorer.test.tsx
```

Expected: pass.

---

## Task 7: Preserve Workspace With Regression Tests

**Files:**

- Modify only tests if needed:
  - `ui/src/__tests__/WorkspacePreviewPanel.test.tsx`
  - `ui/src/__tests__/WorkspaceView.test.tsx`

- [ ] **Step 1: Run Workspace viewer-focused tests**

Run:

```sh
pnpm --filter ui test -- WorkspacePreviewPanel.test.tsx WorkspaceView.test.tsx OutputViewerRegistry.test.ts
```

Expected: pass.

- [ ] **Step 2: Browser-verify Workspace viewer**

Use the app at `http://localhost:5173`.

Check:

- Workspace viewer panel still opens existing output tabs.
- `+` tab behavior in Workspace still works.
- HTML/SVG/Markdown/JSON previews still render.
- Collapsed viewer rail still restores tabs.

Expected: no visible difference from before extraction.

---

## Task 8: Browser-Verify Memory Viewer Flow

**Files:** none unless verification finds bugs.

- [ ] **Step 1: Open Memory Explorer**

Navigate to:

```txt
http://localhost:5173/EBQ/memory/explore
```

- [ ] **Step 2: Verify Memory Home tab**

Actions:

- click the viewer `+`
- confirm `Memory Home` tab opens
- confirm graph slot appears
- close Home tab
- click `+` again

Expected:

- no duplicate Home tabs
- Home is closeable
- `+` reopens Home

- [ ] **Step 3: Verify Memory file tabs**

Actions:

- select image/PDF/video/generic file if available
- confirm tab opens
- confirm preview renders through shared renderer
- close tab

Expected:

- no console errors
- correct preview per file type

- [ ] **Step 4: Verify Memory item tabs**

Actions:

- select memory item
- confirm item viewer still supports preview/edit behavior
- confirm approval/source actions still appear when applicable

Expected:

- Memory item lifecycle behavior unchanged.

- [ ] **Step 5: Verify collapsed rails**

Actions:

- collapse viewer
- activate Home/item/file from collapsed rail
- expand viewer

Expected:

- active tab state survives collapse.
- rail icons/titles make sense for Home, memory item, and asset.

---

## Task 9: Full Verification

Run:

```sh
pnpm --filter ui test -- viewer-registry.test.ts SharedContentViewer.test.tsx ViewerTabs.test.tsx MemoryViewer.test.tsx MemoryViewerTabs.test.tsx MemoryCollapsedTabStrip.test.tsx MemoryHomeDashboard.test.tsx MemoryExplorer.test.tsx WorkspacePreviewPanel.test.tsx WorkspaceView.test.tsx OutputViewerRegistry.test.ts
pnpm --filter ui typecheck
```

Expected: all pass.

If this slice is considered complete enough for branch handoff, also run:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

Expected: all pass. If full repo verification is too slow or blocked by unrelated worktree state, report that clearly.

---

## Engineering Review

### Findings

1. **Do not migrate Workspace tabs to generic tabs in the first pass.**
   `WorkspacePreviewPanel` has many task-output-specific modes and tests. Moving its tab bar at the same time as renderer extraction would enlarge the blast radius without improving Memory. Keep Workspace tab UI untouched except imports.

2. **DOCX should stay Memory-specific for now.**
   Memory DOCX rendering depends on Memory asset render/extract routes and may not map cleanly to the generic renderer yet. Keep it as an explicit exception.

3. **Home tab should be a real tab, not hidden state.**
   Using a stable `home` tab kind makes close/reopen/collapse behavior testable and gives the future graph a natural host.

4. **The graph slot must stay honest.**
   Add a reserved graph region but no fake graph. Real graph work depends on relation APIs and graph DTOs from the later graph plan.

5. **Shared renderer must not know company authorization.**
   The shared viewer receives URLs and content hints. Domain wrappers construct company-scoped URLs so RBAC and route semantics stay outside the renderer.

### Test Coverage Review

- Unit tests cover viewer resolution, renderer selection, Home tab behavior, and tab chrome behavior.
- Workspace regression tests cover behavior preservation.
- Browser verification covers the visual/collapse flow that unit tests cannot fully prove.
- No server tests are needed because this slice does not change backend behavior.

### Performance Review

- Renderer extraction does not add network calls if inline content and `requiresTextFetch` behavior are preserved.
- Memory asset detail lookup already happens in `MemoryViewer`; shared rendering should not duplicate asset detail fetches.
- Graph implementation is deferred; no D3/Sigma runtime cost enters this slice.

### Product Review

- Viewer-first is the right order because graph can become a Home tab later.
- Closeable Home tab with `+` matches the Workspace mental model while keeping Memory exploration discoverable.
- Memory item edit/approval remains domain-native, which avoids making the shared viewer too abstract too early.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `manual plan review` | Architecture & tests | 1 | CLEAR | 5 findings folded into the task sequence |
| Design Review | `manual design review` | UI/UX gaps | 1 | CLEAR_WITH_SCOPE | Viewer chrome stays consistent; graph deferred to honest slot |
| Codex Review | `self-review` | Independent consistency pass | 1 | CLEAR | No backend/schema work needed; Workspace migration risk reduced |

- **UNRESOLVED:** none.
- **VERDICT:** ENG + DESIGN CLEARED for viewer implementation; graph relation/API plan remains separate.
