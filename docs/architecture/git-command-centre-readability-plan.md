# Git Command Centre — Map Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the trunk-and-arcs Git Command Centre Map readable on real repos — dots sit on their lines, open branches end cleanly, the trunk is unmistakable and animated, the view opens focused on HEAD, the canvas never page-scrolls, and a legend explains the glyphs.

**Architecture:** Introduce a single source of truth for each arc's path — an ordered array of `[x, y]` points (branch point → feature commit nodes → merge point or open stub). All consumers (line drawing, flow pulse, hit testing, fit bounds) read those points, so commit dots lie on the line by construction. Layer trunk emphasis + an always-on flow pulse, a HEAD-focused initial transform, a viewport-bounded canvas shell with a legend, and three data cleanups.

**Tech Stack:** React + Vite + TailwindCSS v4, D3 zoom, HTML5 Canvas, TypeScript, vitest + jsdom, esbuild (visual harness).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `ui/src/components/workspace/git-arc-layout.ts` | Pure layout math: `computeArcLayout`, bounds, fit, node Y. Owns the new `ArcDefinition.points` and `computeHeadFocusTransform`. | Modify |
| `ui/src/components/workspace/git-arc-draw.ts` | Canvas drawing. Owns new path helpers `strokeSmoothPath`, `polylinePointAt`, rewritten `drawArcLines`, `drawFlowPulse`, `drawTrunk`. | Modify |
| `ui/src/components/workspace/GitGraphCanvas.tsx` | React/D3/canvas wrapper: `redraw`, RAF loop, fit-on-load, pointer events, `hitTestArc`. | Modify |
| `ui/src/components/workspace/GitCommandCentre.tsx` | Toolbar + canvas container + zoom buttons + "+N more" chip. | Modify |
| `ui/src/components/workspace/GitGraphLegend.tsx` | **New** collapsible legend panel (pure presentational). | Create |
| `ui/src/pages/ProjectDetail.tsx` | Mounts GitCommandCentre in the Workspaces tab; height chain. | Modify |
| `ui/src/__tests__/GitArcLayout.test.ts` | Unit tests for pure layout/path functions. | Modify |
| `server/src/services/git.ts` | `getBranches` ref parsing. | Modify |
| `server/src/routes/project-git.ts` | Graph 25s cache; invalidate on workspace change. | Modify |
| `server/src/services/projects.ts` | `updateWorkspace`/`createWorkspace` — call cache invalidation. | Modify |
| `ui/dev-harness/arc-harness.ts` | Visual harness — keep in sync with draw/layout API. | Modify |

**Key invariant introduced:** `ArcDefinition.points[i]` for a feature commit equals that commit's `ArcCommitLayout` `{x, y}`. The line is stroked through `points`, so dots are always on the line. Tests assert this.

---

## Phase 0 — Commit the already-made fixes (prep)

Three fixes are live (via HMR) but uncommitted: the default filter now shows git-only branches capped at `MAX_DEFAULT_BRANCHES = 12` most-recent; `getLayoutBounds(layout, visibleBranchNames?)` bounds the fit to visible content; `visibleNamesRef` feeds that. There is also a new test (`getLayoutBounds … excludes hidden arcs`).

- [ ] **Step 1: Confirm the working tree matches expectations**

```bash
cd "C:/Users/TK/OneDrive/Desktop/Claude Data/Paperclip-AoA/AoA-2.5"
git status --short
```
Expected: modified `ui/src/components/workspace/git-arc-layout.ts`, `ui/src/components/workspace/GitGraphCanvas.tsx`, `ui/src/__tests__/GitArcLayout.test.ts`.

- [ ] **Step 2: TypeScript + tests green**

```bash
cd ui && npx tsc --noEmit && npx vitest run src/__tests__/GitArcLayout.test.ts
```
Expected: 0 tsc errors; 29 tests pass.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/workspace/git-arc-layout.ts ui/src/components/workspace/GitGraphCanvas.tsx ui/src/__tests__/GitArcLayout.test.ts
git commit -m "fix(git-graph): show git-only branches (capped) and bound fit to visible content"
```

---

## Batch 1 — Readability core

### Task 1.1 — Add `points` path to each arc (foundation for dots-on-line)

**Files:**
- Modify: `ui/src/components/workspace/git-arc-layout.ts` (the `ArcDefinition` interface + the arc-build loop, currently lines ~183-195 and ~277-322)
- Test: `ui/src/__tests__/GitArcLayout.test.ts`

- [ ] **Step 1: Add `points` to the `ArcDefinition` interface**

In `git-arc-layout.ts`, find `export interface ArcDefinition {` and add a `points` field at the end of the interface, before the closing brace:

```typescript
  isOpen: boolean;
  color: string;
  isDone: boolean;
  /**
   * Ordered path points in layout space: branch point on the trunk → each
   * feature commit node (ascending x) → merge point on the trunk (closed) or
   * the tip node (open). The line is stroked through these, so commit dots
   * always lie on the line. Length >= 2.
   */
  points: Array<[number, number]>;
```

- [ ] **Step 2: Build `points` in the arc-build loop**

In `computeArcLayout`, the loop `for (const fb of featureBranches) { … }` currently pushes the arc then pre-computes `shaToArcY`. Replace the `arcs.push({ … })` block AND the `// Pre-compute Y for each feature commit` block with this single block (it computes node Y first, collects the ordered points, then pushes the arc with `points`):

```typescript
    // Compute each feature commit's (x, y) ONCE: record Y by sha (for the
    // node-build pass) and collect the ordered node points (for the arc path).
    const featureNodeXY: Array<[number, number]> = [];
    for (const sha of featureCommitShas) {
      shaToArcBranch.set(sha, fb.name);
      const cx = commitXMap.get(sha) ?? branchPointX;
      let cy: number;
      if (mergePointX != null && mergePointX > branchPointX) {
        const t = (cx - branchPointX) / (mergePointX - branchPointX);
        cy = closedArcY(Math.max(0, Math.min(1, t)), TRUNK_Y, apexY);
      } else {
        cy = openArcY(cx, branchPointX, railStartX, TRUNK_Y, apexY);
      }
      shaToArcY.set(sha, cy);
      featureNodeXY.push([cx, cy]);
    }
    featureNodeXY.sort((a, b) => a[0] - b[0]); // oldest → newest along the arc

    // Assemble the ordered path: branch point → feature nodes → end
    const points: Array<[number, number]> = [[branchPointX, TRUNK_Y]];
    for (const xy of featureNodeXY) points.push(xy);
    if (mergePointX != null && mergePointX > branchPointX) {
      points.push([mergePointX, TRUNK_Y]); // closed arc returns to trunk
    } else if (featureNodeXY.length > 0) {
      // open arc: extend a short flat run past the tip (dashed at draw time)
      const [tipX, tipY] = featureNodeXY[featureNodeXY.length - 1]!;
      points.push([tipX + OPEN_ARC_STUB, tipY]);
    } else {
      // degenerate (no feature commits): a tiny stub off the branch point
      points.push([branchPointX + OPEN_ARC_STUB, apexY]);
    }

    arcs.push({
      branchName: fb.name,
      direction,
      branchPointX,
      mergePointX,
      apexY,
      isOpen: mergePointX == null,
      color,
      isDone,
      points,
    });
```

- [ ] **Step 3: Add the `OPEN_ARC_STUB` constant**

Near the other layout constants at the top of `git-arc-layout.ts` (after `MAX_ARC_HEIGHT`), add:

```typescript
/** How far an open branch's line extends past its tip before the dashed stub. */
export const OPEN_ARC_STUB = 40;
```

- [ ] **Step 4: Add a test asserting dots lie on the path**

In `ui/src/__tests__/GitArcLayout.test.ts`, inside the existing `describe("computeArcLayout", …)` block, add:

```typescript
  it("each feature commit node lies on its arc's points path", () => {
    const graph = makeGraph();
    const branches = makeBranches();
    const result = computeArcLayout(graph, branches);
    const arc = result.arcs.find((a) => a.branchName === "feat/x")!;
    // f1 and f2 nodes must each appear as a point on the arc path.
    const f1 = result.nodes.find((n) => n.sha === "f1")!;
    const f2 = result.nodes.find((n) => n.sha === "f2")!;
    const onPath = (x: number, y: number) =>
      arc.points.some((p) => Math.abs(p[0] - x) < 0.001 && Math.abs(p[1] - y) < 0.001);
    expect(onPath(f1.x, f1.y)).toBe(true);
    expect(onPath(f2.x, f2.y)).toBe(true);
  });

  it("closed arc path starts and ends on the trunk", () => {
    const graph = makeGraph();
    const branches = makeBranches();
    const result = computeArcLayout(graph, branches);
    const arc = result.arcs.find((a) => a.branchName === "feat/x")!;
    expect(arc.points[0]![1]).toBe(result.trunkY);
    expect(arc.points[arc.points.length - 1]![1]).toBe(result.trunkY);
  });
```

- [ ] **Step 5: Run tests**

```bash
cd ui && npx vitest run src/__tests__/GitArcLayout.test.ts
```
Expected: all pass (31 tests).

- [ ] **Step 6: TypeScript check**

```bash
cd ui && npx tsc --noEmit
```
Expected: 0 errors. (`git-arc-draw.ts` still compiles; it ignores the new `points` field for now.)

- [ ] **Step 7: Commit**

```bash
git add ui/src/components/workspace/git-arc-layout.ts ui/src/__tests__/GitArcLayout.test.ts
git commit -m "feat(git-graph): add unified points path to ArcDefinition"
```

---

### Task 1.2 — Draw arcs through `points` + dashed open stub (#6 + #2)

**Files:**
- Modify: `ui/src/components/workspace/git-arc-draw.ts` (`drawArcLines`, currently ~325-385; plus new helpers)

- [ ] **Step 1: Add `strokeSmoothPath` + `polylinePointAt` helpers**

At the top of `git-arc-draw.ts` (after the imports, before `drawCommitNode`), add:

```typescript
/**
 * Stroke a smooth Catmull-Rom curve that PASSES THROUGH every point. Because it
 * passes through (not near) the points, commit dots placed at those points are
 * always on the line. Falls back to a straight line for < 3 points.
 */
export function strokeSmoothPath(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number]>,
) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0]![0], points[0]![1]);
  if (points.length === 2) {
    ctx.lineTo(points[1]![0], points[1]![1]);
    ctx.stroke();
    return;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    // Catmull-Rom → cubic bezier control points
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
  ctx.stroke();
}

/**
 * Point at parameter t ∈ [0,1] along a polyline (linear interpolation by
 * cumulative segment length). Used by the flow pulse and hit testing so they
 * follow the exact same path the line is drawn on.
 */
export function polylinePointAt(
  points: Array<[number, number]>,
  t: number,
): [number, number] {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0]!;
  const clamped = Math.max(0, Math.min(1, t));
  let total = 0;
  const segLen: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1]![0] - points[i]![0];
    const dy = points[i + 1]![1] - points[i]![1];
    const len = Math.hypot(dx, dy);
    segLen.push(len);
    total += len;
  }
  if (total === 0) return points[0]!;
  let target = clamped * total;
  for (let i = 0; i < segLen.length; i++) {
    if (target <= segLen[i]!) {
      const f = segLen[i] === 0 ? 0 : target / segLen[i]!;
      return [
        points[i]![0] + (points[i + 1]![0] - points[i]![0]) * f,
        points[i]![1] + (points[i + 1]![1] - points[i]![1]) * f,
      ];
    }
    target -= segLen[i]!;
  }
  return points[points.length - 1]!;
}
```

- [ ] **Step 2: Rewrite `drawArcLines` to use `points`**

Replace the entire body of `drawArcLines` (keep the signature) with:

```typescript
export function drawArcLines(
  ctx: CanvasRenderingContext2D,
  arcs: ArcDefinition[],
  visibleNames: Set<string>,
  _canvasRightInLayout: number, // no longer used (open arcs end with a stub); kept for call-site stability
  _trunkY: number,
) {
  for (const arc of arcs) {
    if (!visibleNames.has(arc.branchName)) continue;
    if (arc.points.length < 2) continue;

    ctx.save();
    ctx.strokeStyle = arc.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = arc.isDone ? 0.4 : 0.7;
    ctx.setLineDash([]);

    if (arc.isOpen) {
      // Solid through all but the stub point; dashed for the final stub segment.
      const solid = arc.points.slice(0, -1);
      const tail = arc.points[arc.points.length - 1]!;
      strokeSmoothPath(ctx, solid);
      const lastSolid = solid[solid.length - 1]!;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(lastSolid[0], lastSolid[1]);
      ctx.lineTo(tail[0], tail[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      strokeSmoothPath(ctx, arc.points);
    }
    ctx.restore();
  }
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd ui && npx tsc --noEmit
```
Expected: 0 errors. (`drawFlowPulse`/`hitTestArc` still use old geometry — fixed in Task 1.3. The `_canvasRightInLayout`/`_trunkY` params are now unused but keep the call site unchanged.)

- [ ] **Step 4: Rebuild the harness and visually verify dots-on-line**

```bash
cd "C:/Users/TK/OneDrive/Desktop/Claude Data/Paperclip-AoA/AoA-2.5"
npx esbuild ui/dev-harness/arc-harness.ts --bundle --format=iife --outfile=ui/dev-harness/arc-harness.bundle.js
```
Then open `file://./ui/dev-harness/arc-harness.html` in the browser (`/browse` skill), screenshot scenarios 1–4, and confirm: every commit dot sits exactly on its arc line; open branches end with a short dashed stub (not a rail to the edge).

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/workspace/git-arc-draw.ts
git commit -m "fix(git-graph): stroke arcs through node points; open branches end with a stub"
```

---

### Task 1.3 — Flow pulse + hit testing follow `points` (consistency)

**Files:**
- Modify: `ui/src/components/workspace/git-arc-draw.ts` (`drawFlowPulse`, currently ~478-598)
- Modify: `ui/src/components/workspace/GitGraphCanvas.tsx` (`hitTestArc`)

- [ ] **Step 1: Replace the arc-pulse math in `drawFlowPulse`**

In `drawFlowPulse`, delete the inner `closedArcPoint` helper and the per-arc `if (!arc.isOpen …) … else { open-arc curve … }` block that computes `dotX/dotY`. Replace the per-arc loop body (the part after `const dotColor = isRunning ? "#4FB67E" : "#D9A938";`) with:

```typescript
    const dotColor = isRunning ? "#4FB67E" : "#D9A938";
    const [dotX, dotY] = polylinePointAt(arc.points, t);

    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fillStyle = dotColor; ctx.fill();
    ctx.beginPath(); ctx.arc(dotX, dotY, 7, 0, Math.PI * 2);
    ctx.fillStyle = dotColor + "30"; ctx.fill();
```

(The trunk-pulse portion of `drawFlowPulse` is unchanged here; it is reworked in Task 1.4.)

- [ ] **Step 2: Replace `hitTestArc` sampling**

In `GitGraphCanvas.tsx`, replace the body of `hitTestArc` (the per-arc point sampling that builds `points` from bezier math) with sampling along `arc.points`:

```typescript
function hitTestArc(
  arcs: ArcDefinition[],
  visibleNames: Set<string>,
  cx: number,
  cy: number,
  _trunkY: number,
  threshold = 8,
  _railExtentX = 400,
): ArcDefinition | null {
  let best: ArcDefinition | null = null;
  let bestDist = threshold;
  for (const arc of arcs) {
    if (!visibleNames.has(arc.branchName)) continue;
    if (arc.isDone) continue;
    for (let i = 0; i <= 24; i++) {
      const [px, py] = polylinePointAt(arc.points, i / 24);
      const d = Math.hypot(cx - px, cy - py);
      if (d < bestDist) {
        bestDist = d;
        best = arc;
      }
    }
  }
  return best;
}
```

Add `polylinePointAt` to the import from `./git-arc-draw` at the top of `GitGraphCanvas.tsx`.

- [ ] **Step 3: TypeScript check**

```bash
cd ui && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Rebuild harness; verify pulse rides the line**

```bash
cd "C:/Users/TK/OneDrive/Desktop/Claude Data/Paperclip-AoA/AoA-2.5"
npx esbuild ui/dev-harness/arc-harness.ts --bundle --format=iife --outfile=ui/dev-harness/arc-harness.bundle.js
```
Open the harness; on a running branch (scenario 8) confirm the pulse dot travels along the arc line itself. In the live app, hover an arc and confirm the hover card still triggers.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/workspace/git-arc-draw.ts ui/src/components/workspace/GitGraphCanvas.tsx
git commit -m "fix(git-graph): flow pulse and hit testing follow the arc points path"
```

---

### Task 1.4 — Trunk highlight + always-on left→right pulse (#1)

**Files:**
- Modify: `ui/src/components/workspace/git-arc-draw.ts` (`drawTrunk`, currently ~343-363; `drawFlowPulse` trunk section)
- Modify: `ui/src/components/workspace/GitGraphCanvas.tsx` (RAF loop condition + redraw trunk-pulse call)

- [ ] **Step 1: Make the trunk fatter, brighter, labeled**

Replace `drawTrunk`'s body with:

```typescript
export function drawTrunk(
  ctx: CanvasRenderingContext2D,
  nodes: ArcCommitLayout[],
  trunkY: number,
  color: string,
  defaultBranch: string,
) {
  const trunkNodes = nodes.filter((n) => n.isTrunk);
  if (trunkNodes.length < 2) return;
  const minX = Math.min(...trunkNodes.map((n) => n.x));
  const maxX = Math.max(...trunkNodes.map((n) => n.x));
  ctx.save();
  // Glow underlay
  ctx.beginPath();
  ctx.moveTo(minX, trunkY);
  ctx.lineTo(maxX, trunkY);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 8;
  ctx.setLineDash([]);
  ctx.stroke();
  // Solid trunk
  ctx.beginPath();
  ctx.moveTo(minX, trunkY);
  ctx.lineTo(maxX, trunkY);
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // Label at the left end
  ctx.globalAlpha = 0.85;
  ctx.font = `bold 9px "Courier New", monospace`;
  ctx.fillStyle = color;
  ctx.fillText(defaultBranch, minX, trunkY - 8);
  ctx.restore();
}
```

- [ ] **Step 2: Add an always-on trunk flow pulse**

Replace the trunk-pulse portion of `drawFlowPulse` (the `// Trunk pulse for default branch` block that gates on `defaultInfo.linkedIssueStatus`) with an unconditional travelling highlight:

```typescript
  // Always-on trunk pulse: a bright dot travels left→right along the trunk.
  if (trunkNodes.length >= 2) {
    const minX = Math.min(...trunkNodes.map((n) => n.x));
    const maxX = Math.max(...trunkNodes.map((n) => n.x));
    const dotX = minX + t * (maxX - minX);
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(dotX, trunkY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.beginPath(); ctx.arc(dotX, trunkY, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff22"; ctx.fill();
    ctx.globalAlpha = 1;
  }
```

`drawFlowPulse`'s signature already receives `trunkNodes` and `trunkY`; no signature change. Remove the now-unused `defaultBranch`/`branchByName` trunk-status lookups for the trunk dot (arc pulses still use `branchByName`).

- [ ] **Step 3: Update the `drawTrunk` call site**

In `GitGraphCanvas.tsx` `redraw`, update the `drawTrunk(...)` call to pass `graph.defaultBranch`:

```typescript
      drawTrunk(ctx, layout.nodes, layout.trunkY, trunkColor, graph.defaultBranch);
```

- [ ] **Step 4: Run the RAF loop whenever the Map is visible (not only for active tasks)**

In `GitGraphCanvas.tsx`, the RAF `useEffect` currently early-returns when `!hasActiveNodes`. Replace the guard so it always animates while the tab is visible:

```typescript
    useEffect(() => {
      function tick() {
        if (document.visibilityState === "hidden") {
          rafRef.current = null;
          return;
        }
        animPhaseRef.current += 0.05;
        redraw();
        rafRef.current = requestAnimationFrame(tick);
      }
      rafRef.current = requestAnimationFrame(tick);
      return () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, [redraw]);
```

Also handle resuming after the tab becomes visible again: add a `visibilitychange` listener effect:

```typescript
    useEffect(() => {
      const onVis = () => {
        if (document.visibilityState === "visible" && rafRef.current === null) {
          rafRef.current = requestAnimationFrame(function tick() {
            if (document.visibilityState === "hidden") { rafRef.current = null; return; }
            animPhaseRef.current += 0.05;
            redraw();
            rafRef.current = requestAnimationFrame(tick);
          });
        }
      };
      document.addEventListener("visibilitychange", onVis);
      return () => document.removeEventListener("visibilitychange", onVis);
    }, [redraw]);
```

Remove the now-redundant "Static redraw when no animation" effect (the one that calls `redraw()` only when `!hasActiveNodes`), since the RAF loop now always drives drawing.

- [ ] **Step 5: TypeScript check**

```bash
cd ui && npx tsc --noEmit
```
Expected: 0 errors. (If `hasActiveNodes` becomes unused, leave it — it may still gate other code; if tsc flags it as unused, delete the memo.)

- [ ] **Step 6: Rebuild harness + live verify**

```bash
cd "C:/Users/TK/OneDrive/Desktop/Claude Data/Paperclip-AoA/AoA-2.5"
npx esbuild ui/dev-harness/arc-harness.ts --bundle --format=iife --outfile=ui/dev-harness/arc-harness.bundle.js
```
In the harness the trunk should read as a thick glowing line labeled `main`. In the live app (SeaMaster on Engineering), confirm a white dot continuously sweeps left→right along the trunk and the trunk is clearly distinct from branch lines.

- [ ] **Step 7: Commit**

```bash
git add ui/src/components/workspace/git-arc-draw.ts ui/src/components/workspace/GitGraphCanvas.tsx
git commit -m "feat(git-graph): emphasize trunk with glow, label, and an always-on flow pulse"
```

---

### Task 1.5 — Open zoomed-in near HEAD (#8)

**Files:**
- Modify: `ui/src/components/workspace/git-arc-layout.ts` (new `computeHeadFocusTransform`)
- Modify: `ui/src/components/workspace/GitGraphCanvas.tsx` (initial-fit effect)
- Test: `ui/src/__tests__/GitArcLayout.test.ts`

- [ ] **Step 1: Add `computeHeadFocusTransform`**

In `git-arc-layout.ts`, after `computeFitTransform`, add:

```typescript
/**
 * Initial transform that opens the Map zoomed near HEAD: scales on height so
 * arcs are readable, then positions the default-branch tip at ~70% of the
 * viewport width so HEAD + nearby active branches are prominent and older
 * history pans off to the left. Falls back to computeFitTransform when there
 * is no default tip.
 */
export function computeHeadFocusTransform(
  layout: ArcLayoutResult,
  defaultBranch: string,
  viewportW: number,
  viewportH: number,
  pad = 32,
): { k: number; x: number; y: number } {
  const headNode = layout.nodes.find(
    (n) => n.isDefault && n.branchName === defaultBranch,
  );
  if (!headNode || viewportW <= 0 || viewportH <= 0) {
    return computeFitTransform(getLayoutBounds(layout), viewportW, viewportH, pad);
  }
  // Height-fit so the trunk ± arc heights are visible.
  const contentH = MAX_ARC_HEIGHT * 2 + 160; // trunk band + cards/labels
  const k = Math.max(0.4, Math.min((viewportH - 2 * pad) / contentH, 1.2));
  // Put HEAD at 70% width; center the trunk vertically.
  const x = viewportW * 0.7 - headNode.x * k;
  const y = viewportH / 2 - layout.trunkY * k;
  return { k, x, y };
}
```

- [ ] **Step 2: Use it for the initial transform**

In `GitGraphCanvas.tsx`, the ResizeObserver currently sets the initial transform with `getLayoutBounds` + `computeFitTransform`. Replace those two lines with the HEAD-focus transform:

```typescript
          const fit = computeHeadFocusTransform(
            layoutRef.current,
            graph.defaultBranch,
            w,
            h,
          );
          const t = d3.zoomIdentity.translate(fit.x, fit.y).scale(fit.k);
```

Update the import in `GitGraphCanvas.tsx` to add `computeHeadFocusTransform` (and keep `getLayoutBounds`/`computeFitTransform` — the latter is still the fallback inside the new function; `getLayoutBounds` may now be unused in the component, remove it from the import if tsc flags it).

- [ ] **Step 3: Add tests**

In `GitArcLayout.test.ts`, add a new describe block:

```typescript
describe("computeHeadFocusTransform", () => {
  it("positions the default-branch tip near 70% of viewport width", () => {
    const graph = makeGraph();
    const branches = makeBranches();
    const layout = computeArcLayout(graph, branches);
    const head = layout.nodes.find((n) => n.isDefault && n.branchName === "main")!;
    const t = computeHeadFocusTransform(layout, "main", 1000, 600);
    const headScreenX = head.x * t.k + t.x;
    expect(headScreenX).toBeCloseTo(700, 0);
  });

  it("falls back to a finite transform when there is no default tip", () => {
    const graph = makeGraph();
    const branches = makeBranches();
    const layout = computeArcLayout(graph, branches);
    const t = computeHeadFocusTransform(layout, "does-not-exist", 1000, 600);
    expect(Number.isFinite(t.k)).toBe(true);
    expect(Number.isFinite(t.x)).toBe(true);
  });
});
```

Add `computeHeadFocusTransform` to the imports at the top of the test file.

- [ ] **Step 4: Run tests + tsc**

```bash
cd ui && npx tsc --noEmit && npx vitest run src/__tests__/GitArcLayout.test.ts
```
Expected: 0 tsc errors; all tests pass.

- [ ] **Step 5: Live verify**

Reload the Engineering Map (SeaMaster). On arrival the view should be zoomed in with HEAD on the right-ish, active branches around it, and history extending off the left (pannable). Zoom/reset buttons still work.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/workspace/git-arc-layout.ts ui/src/components/workspace/GitGraphCanvas.tsx ui/src/__tests__/GitArcLayout.test.ts
git commit -m "feat(git-graph): open the Map zoomed-in focused on HEAD"
```

---

## Batch 2 — Layout chrome

### Task 2.1 — Viewport-bounded canvas, buttons always visible (#7a)

**Files:**
- Modify: `ui/src/pages/ProjectDetail.tsx:1056`
- Modify: `ui/src/components/workspace/GitCommandCentre.tsx:306,408`

- [ ] **Step 1: Add `min-h-0` to the tab-content wrapper**

In `ProjectDetail.tsx`, the Workspaces tab wraps the canvas in `<div className="flex-1 flex flex-col overflow-hidden">` (line ~1056). A `flex-1` child of a flex column will not shrink below its content unless `min-h-0` is set. Change it to:

```tsx
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
```

- [ ] **Step 2: Make the GitCommandCentre root + canvas area shrink-safe**

In `GitCommandCentre.tsx`, the root is `<div className="flex flex-col h-full">` (line ~306). Change to:

```tsx
    <div className="flex flex-col h-full min-h-0">
```

And the canvas content area `<div className="flex-1 relative overflow-hidden bg-[#0a0a0a]">` (line ~408) → add `min-h-0`:

```tsx
      <div className="flex-1 relative overflow-hidden bg-[#0a0a0a] min-h-0">
```

- [ ] **Step 3: Confirm the page route gives a bounded height**

Verify the ProjectDetail page root (the outermost returned `<div>`) participates in a viewport-bounded flex column (the app shell should already constrain it to `h-screen`/`h-dvh`). If the page root is not height-bounded, wrap the tab area in a container with `flex-1 min-h-0` under the shell. Confirm by reading the page root container class and the app layout that mounts the route.

- [ ] **Step 4: Browser verification at multiple sizes**

Using the `/browse` skill, set the viewport to `1440x900`, then `1280x720`, then `1024x600`. After each, load the Engineering Map and confirm: no page scrollbar; the `+ / − / ⊡` buttons are fully visible at the bottom-right of the canvas; the canvas fills the area between toolbar and viewport bottom.

```bash
# in the browse session, for each size:
#   <browse> viewport 1280x720
#   <browse> goto http://127.0.0.1:3100/AOA/projects/engineering/workspaces
#   <browse> screenshot /tmp/h7-<size>.png
```

- [ ] **Step 5: Commit**

```bash
git add ui/src/pages/ProjectDetail.tsx ui/src/components/workspace/GitCommandCentre.tsx
git commit -m "fix(git-graph): bound the Map canvas to the viewport so zoom controls stay visible"
```

---

### Task 2.2 — Left-side legend (#7b)

**Files:**
- Create: `ui/src/components/workspace/GitGraphLegend.tsx`
- Modify: `ui/src/components/workspace/GitCommandCentre.tsx` (mount the legend over the canvas)

- [ ] **Step 1: Create the legend component**

Create `ui/src/components/workspace/GitGraphLegend.tsx`:

```tsx
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Collapsible legend explaining the Map's glyphs and status colors. */
export function GitGraphLegend() {
  const [open, setOpen] = useState(true);

  const statusRows: Array<{ color: string; label: string }> = [
    { color: "#4FB67E", label: "In progress" },
    { color: "#D9A938", label: "In review" },
    { color: "#ef4444", label: "Blocked" },
    { color: "#7E8AA8", label: "Done / cancelled" },
  ];

  return (
    <div className="absolute top-3 left-3 z-10 select-none">
      <button
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#1e1d1c]/90 border border-[#2e2c2a] text-[11px] text-[#7E8AA8] hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[10px]">{open ? "▾" : "▸"}</span> Legend
      </button>
      {open && (
        <div className="mt-1 p-2.5 rounded bg-[#141312]/95 border border-[#2e2c2a] text-[11px] text-[#ccc] space-y-2 w-44">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-[#7E8AA8]">Task status</div>
            {statusRows.map((r) => (
              <div key={r.label} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: r.color }} />
                {r.label}
              </div>
            ))}
          </div>
          <div className="space-y-1 pt-1 border-t border-[#2e2c2a]">
            <div className="text-[10px] uppercase tracking-wide text-[#7E8AA8]">Graph</div>
            <div className="flex items-center gap-2"><span className="inline-block w-5 h-[3px] bg-white rounded shrink-0" /> Trunk (main)</div>
            <div className="flex items-center gap-2"><span className="inline-block w-5 h-[2px] bg-[#4FB67E] rounded shrink-0" /> Branch arc</div>
            <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rotate-45 bg-[#6470DC] shrink-0" /> Merge commit</div>
            <div className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-full border border-[#7E8AA8] shrink-0" /> Branch tip</div>
            <div className="flex items-center gap-2"><span className="inline-block w-5 border-t border-dashed border-[#7E8AA8] shrink-0" /> Open branch (more ahead)</div>
          </div>
          <div className="space-y-1 pt-1 border-t border-[#2e2c2a]">
            <div className="text-[10px] uppercase tracking-wide text-[#7E8AA8]">Badges</div>
            <div className="flex items-center gap-2"><span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#4FB67E] text-[7px] text-white shrink-0">✓</span> CI passing</div>
            <div className="flex items-center gap-2"><span className="inline-flex items-center justify-center px-1 h-3.5 rounded bg-[#6470DC]/30 border border-[#6470DC] text-[7px] text-[#8490e8] shrink-0">PR</span> Pull request</div>
            <div className="flex items-center gap-2"><span className="text-[#ffa040] shrink-0">⚠</span> Conflicts</div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount the legend inside the canvas content area**

In `GitCommandCentre.tsx`, import it and render it as a sibling of `<GitGraphCanvas>` inside the `flex-1 relative …` content div (so it overlays the canvas top-left):

```tsx
import { GitGraphLegend } from "./GitGraphLegend";
```

Inside the canvas content `<div className="flex-1 relative overflow-hidden bg-[#0a0a0a] min-h-0">`, add `<GitGraphLegend />` right after the `<GitGraphCanvas … />` element (before the zoom-controls div).

- [ ] **Step 3: TypeScript check**

```bash
cd ui && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Browser verify**

Load the Map; the legend appears top-left, collapsible. Confirm rows match what's drawn (status dots, trunk vs branch line, merge diamond, branch-tip circle, dashed open-branch stub, CI/PR/conflict badges).

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/workspace/GitGraphLegend.tsx ui/src/components/workspace/GitCommandCentre.tsx
git commit -m "feat(git-graph): add a collapsible legend to the Map"
```

---

## Batch 3 — Cleanups

### Task 3.1 — Filter the `origin` pseudo-branch (#4)

**Files:**
- Modify: `server/src/services/git.ts` (the for-each-ref parse loop, ~648-652)
- Test: add to the nearest git-service test or a contract test (see Step 3)

**Why:** `git for-each-ref --format='%(refname:short)' refs/remotes/origin/HEAD` yields the bare remote name `origin` (not `origin/HEAD`), so the existing `if (localName === "HEAD") continue;` does not catch it and `origin` shows up as a branch.

- [ ] **Step 1: Skip the remote symbolic HEAD ref**

In `git.ts`, find:

```typescript
    const isRemote = refShort.startsWith("origin/");
    const localName = isRemote ? refShort.slice("origin/".length) : refShort;

    // Skip remote HEAD pointer
    if (localName === "HEAD") continue;
```

Replace with:

```typescript
    const isRemote = refShort.startsWith("origin/");
    const localName = isRemote ? refShort.slice("origin/".length) : refShort;

    // Skip remote HEAD pointers in both forms:
    //  - "refs/remotes/origin/HEAD" → short "origin"  (bare remote name)
    //  - any "<remote>/HEAD"        → localName "HEAD"
    if (localName === "HEAD" || refShort === "origin" || refShort.endsWith("/HEAD")) {
      continue;
    }
```

- [ ] **Step 2: TypeScript check (server)**

```bash
cd server && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Add a parse test**

If `server/src/__tests__/` has a git-service parse test, add a case; otherwise create `server/src/__tests__/git-branch-parse.test.ts` testing the skip rule via a small exported helper. Minimal contract test:

```typescript
import { describe, it, expect } from "vitest";

// Mirrors the skip rule in getBranches' parse loop.
function isSkippableRef(refShort: string): boolean {
  const isRemote = refShort.startsWith("origin/");
  const localName = isRemote ? refShort.slice("origin/".length) : refShort;
  return localName === "HEAD" || refShort === "origin" || refShort.endsWith("/HEAD");
}

describe("branch ref skip rule", () => {
  it("skips the bare remote HEAD symref 'origin'", () => {
    expect(isSkippableRef("origin")).toBe(true);
  });
  it("skips origin/HEAD and main/HEAD", () => {
    expect(isSkippableRef("origin/HEAD")).toBe(true);
    expect(isSkippableRef("upstream/HEAD")).toBe(true);
  });
  it("keeps real branches", () => {
    expect(isSkippableRef("main")).toBe(false);
    expect(isSkippableRef("origin/main")).toBe(false);
    expect(isSkippableRef("feat/notifications-page")).toBe(false);
  });
});
```

```bash
cd server && npx vitest run src/__tests__/git-branch-parse.test.ts
```
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/services/git.ts server/src/__tests__/git-branch-parse.test.ts
git commit -m "fix(git): drop the bare 'origin' remote-HEAD symref from branch list"
```

---

### Task 3.2 — "+N more → Pipeline" chip (#5)

**Files:**
- Modify: `ui/src/components/workspace/GitGraphCanvas.tsx` (expose the hidden count)
- Modify: `ui/src/components/workspace/GitCommandCentre.tsx` (render the chip)

- [ ] **Step 1: Expose the hidden-branch count from the canvas**

`MAX_DEFAULT_BRANCHES` lives in `GitGraphCanvas.tsx`. Rather than thread a callback, compute the count in `GitCommandCentre.tsx` where `branches` and the cap are both available. Export the cap from the canvas module so the toolbar can reuse it. In `GitGraphCanvas.tsx` change:

```typescript
const MAX_DEFAULT_BRANCHES = 12;
```
to:
```typescript
export const MAX_DEFAULT_BRANCHES = 12;
```

- [ ] **Step 2: Render the chip in the toolbar**

In `GitCommandCentre.tsx`, import the cap and compute how many non-done branches exist beyond the cap; show a chip only in the default (`all`) filter when there's overflow. Add the import:

```typescript
import { GitGraphCanvas, type GitGraphCanvasHandle, MAX_DEFAULT_BRANCHES } from "./GitGraphCanvas";
```

Just before the `return`, derive:

```typescript
  const nonDoneCount = branches.filter(
    (b) =>
      b.name !== graphData?.graph.defaultBranch &&
      b.linkedIssueStatus !== "done" &&
      b.linkedIssueStatus !== "cancelled",
  ).length;
  const hiddenCount = filter === "all" ? Math.max(0, nonDoneCount - MAX_DEFAULT_BRANCHES) : 0;
```

In the toolbar JSX, next to the filter chips, render:

```tsx
        {hiddenCount > 0 && (
          <button
            className="px-2.5 py-1 rounded-full text-[11px] border border-[#2e2c2a] text-[#7E8AA8] hover:text-foreground transition-colors"
            title="Showing the most recent branches. Open the Pipeline tab for the full list."
            onClick={() => setView("pipeline")}
          >
            +{hiddenCount} more
          </button>
        )}
```

(`setView` is the existing view-mode setter that switches Map/Pipeline. Confirm its name in the component and match it.)

- [ ] **Step 3: TypeScript check**

```bash
cd ui && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Browser verify**

On SeaMaster (≈125 branches) the chip should read roughly "+110 more" and clicking it switches to the Pipeline tab.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/workspace/GitGraphCanvas.tsx ui/src/components/workspace/GitCommandCentre.tsx
git commit -m "feat(git-graph): show a '+N more' chip linking to the Pipeline when branches are capped"
```

---

### Task 3.3 — Invalidate the graph cache on workspace change (#9)

**Files:**
- Modify: `server/src/routes/project-git.ts` (export an invalidation function)
- Modify: `server/src/services/projects.ts` (call it from `updateWorkspace`/`createWorkspace`)

**Why:** `project-git.ts` caches the graph + enrich responses for 25s keyed by `(companyId, projectId)`. Changing a project workspace's `cwd`/`repoUrl` does not clear it, so the Map serves the old repo for up to 25s.

- [ ] **Step 1: Export a cache-invalidation helper**

In `project-git.ts`, near the cache maps (`graphCache`, `enrichCache`), add and export:

```typescript
/** Clear cached graph + enrich responses for a project (call on workspace change). */
export function invalidateProjectGitCache(companyId: string, projectId: string): void {
  const key = graphCacheKey(companyId, projectId);
  graphCache.delete(key);
  enrichCache.delete(key);
}
```

(If `graphCacheKey` is not module-scoped, reuse the same string-build logic: `` `${companyId}:${projectId}` ``.)

- [ ] **Step 2: Call it from the workspace mutations**

In `server/src/services/projects.ts`, import the helper at the top:

```typescript
import { invalidateProjectGitCache } from "../routes/project-git";
```

In `createWorkspace`, after the successful transaction returns `created`, add:

```typescript
      if (created) invalidateProjectGitCache(project.companyId, projectId);
```

In `updateWorkspace`, after the transaction returns `updated`, add:

```typescript
      if (updated) invalidateProjectGitCache(existing.companyId, projectId);
```

(If importing a route into a service creates an undesirable cycle, instead move the two cache `Map`s + `invalidateProjectGitCache` into a tiny new module `server/src/services/project-git-cache.ts` and import it from both `project-git.ts` and `projects.ts`. Prefer the simple import first; only split if tsc/eslint flags a cycle.)

- [ ] **Step 3: TypeScript check (server)**

```bash
cd server && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Manual verify**

With the dev server running, PATCH the Engineering workspace `cwd` to a different repo and immediately GET `/api/companies/:cid/projects/:pid/git/graph`; the new repo's `defaultBranch`/branches should appear without waiting ~25s.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/project-git.ts server/src/services/projects.ts
git commit -m "fix(git): invalidate the project graph cache when a workspace repo changes"
```

---

## Final verification

- [ ] **Step 1: Full type + test sweep**

```bash
cd ui && npx tsc --noEmit && echo "UI OK"
cd ../server && npx tsc --noEmit && echo "SERVER OK"
cd ../ui && npx vitest run 2>&1 | tail -6
```
Expected: both "OK"; full UI suite green (no new failures).

- [ ] **Step 2: Rebuild harness, screenshot all 8 scenarios**

```bash
cd "C:/Users/TK/OneDrive/Desktop/Claude Data/Paperclip-AoA/AoA-2.5"
npx esbuild ui/dev-harness/arc-harness.ts --bundle --format=iife --outfile=ui/dev-harness/arc-harness.bundle.js
```
Open the harness; confirm dots-on-line and clean open stubs across scenarios 1–8.

- [ ] **Step 3: Live visual checklist (SeaMaster on Engineering Map)**

```
- [ ] Commit dots sit exactly on their arc lines (no floating dots)
- [ ] Open branches end with a short dashed stub, not a rail to the edge
- [ ] Trunk is thick/glowing, labeled "main", with a white pulse sweeping left→right
- [ ] View opens zoomed-in near HEAD; history pans to the left
- [ ] No page scrollbar at 1440x900, 1280x720, 1024x600; +/−/⊡ always visible
- [ ] Legend (top-left) is present, collapsible, and matches the glyphs
- [ ] No "origin" pseudo-branch in the graph
- [ ] "+N more" chip shows and switches to Pipeline
- [ ] Switching the workspace repo updates the Map immediately (no 25s stale)
- [ ] npx tsc --noEmit (ui + server) = 0 errors; vitest green
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore(git-graph): Map readability pass complete"
```

---

## Self-review notes

**Spec coverage:** #1 trunk highlight+pulse (1.4) ✓; #2 lines-not-ending (1.1+1.2) ✓; #4 origin filter (3.1) ✓; #5 +N chip (3.2) ✓; #6 dots-on-line (1.1+1.2+1.3) ✓; #7a viewport height (2.1) ✓; #7b legend (2.2) ✓; #8 zoom-to-HEAD (1.5) ✓; #9 cache invalidation (3.3) ✓; Phase 0 commits the prior fixes ✓. (#3 task cards deferred by agreement — not in scope.)

**Type consistency:** `ArcDefinition.points: Array<[number, number]>` defined in 1.1 and consumed identically by `strokeSmoothPath`/`polylinePointAt` (1.2), `drawFlowPulse`/`hitTestArc` (1.3). `computeHeadFocusTransform` signature in 1.5 matches its call site. `MAX_DEFAULT_BRANCHES` exported in 3.2 matches its toolbar import. `drawTrunk` gains a `defaultBranch` param in 1.4 with the call site updated in the same task.

**Risk notes:** Task 1.1 Step 2 keeps the existing `shaToArcY` population (used by the node-build pass) AND adds the `points` assembly from the same per-commit Y math, so nodes and path agree by construction. The always-on RAF (1.4) increases idle CPU on the Map view; it pauses on `visibilitychange` hidden. The cache-invalidation import direction (3.3) may need the small-module split if a cycle appears.
