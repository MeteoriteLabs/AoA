# E1.1 — canvas and shared panel controller coding plan

> September 12 correction: this is an unapproved coding-plan draft requiring independent review. Implementation was premature and is paused; no test result grants approval. [Planning reset](../planning-reset.md) controls current work. Reassess this reference plan independently of the isolated code, then obtain explicit approval before implementation.

**Goal:** One content-keyed panel controller consistently handles open/focus/move/resize/pin/minimize/maximize/restore/close through all entry routes.

**Architecture:** AoA owns panel identity, normal geometry and lifecycle; React Flow is a controlled visual adapter. Screen-space chrome remains outside its transformed viewport. Keep content/draft/session ownership above visual lifetime. Maximize changes projected display geometry without reparenting content or overwriting normal geometry.

**Tech stack:** React 19/TypeScript, candidate exact `@xyflow/react@12.11.6`, existing lucide icons, Vitest/jsdom and Playwright. [NodeResizer](https://reactflow.dev/api-reference/components/node-resizer) supplies resize callbacks; [utility classes](https://reactflow.dev/learn/customization/utility-classes) exclude nested inputs from gestures. Package/API compatibility must still pass the actual UI build.

**Spec:** [First-batch baseline](../first-batch-readiness.md), [UI states](../ui-state-review.md), [UI decisions](../ui-review-decisions.md), [canvas contract](../canvas-interaction-contract.md), [motion](../motion-and-interaction.md), [E1.1 scope](../slice-plans/e1-1.md).

## Global constraints and boundary

- First slice is a controlled UI library plus internal component/browser harness, not the entire public Universe route. Normal navigation/tray is E1.4; real TaskDetail adaptation is E2.4; state/drafts are E1.2–3. These consumers use the interface below.
- No new DB schema, API authority, provider credential or task execution route belongs to this slice. Company checking in the reducer is defense in depth, never authorization. Resolve content through existing authorized clients before passing it in.
- No mock inline handlers, copied preview controls, nested window shells or unrelated Home layout storage. Preview is a read-only projection of registry metadata/content.
- All new files below are currently absent in replatform; recheck collisions at execution. Add package manifest and generated lockfile together. No production branch has been created in this planning pass.
- Numeric defaults are initial qualification values: zoom 0.25–2, finite coordinates bounded to ±10,000,000 canvas units and sizes 1–8192 canvas units. Renderer minimums are stronger and viewport-aware. These guards prevent corrupt state; they do not advertise supported performance limits.

## Planned file map

| File | Responsibility |
|---|---|
| `ui/src/components/universe/panel-state.ts` | Pure types, stable identity, generation-fenced reducer, normal/max display geometry and initial placement; code below |
| `ui/src/components/universe/PanelNode.tsx` | Shared frame, title/action buttons, body exclusions and NodeResizer; reference binding below |
| `ui/src/components/universe/UniverseWorkspace.tsx` | Controlled ReactFlow, viewport and usable bounds; adapts authorized content registry into nodes |
| `ui/src/components/universe/panel-gestures.ts` | Keyboard move/resize and current manipulation ownership; geometry actions fenced by instance generation |
| `ui/src/components/universe/universe-panels.css` | Header-only selection, focus visibility, edge cursors/hit targets; no selection outline or blob styling changes |
| `ui/src/components/universe/__tests__/panel-state.test.ts` | Contract scenarios below using Vitest and Node strict assertions |
| `ui/src/components/universe/__tests__/PanelNode.test.tsx` | Real frame controls with resizer boundary stub; verifies actual dispatch, not visual animation |
| `ui/src/components/universe/__tests__/UniverseWorkspace.test.tsx` | Controlled-node mapping, scope reset, stale event fencing and content lifetime |
| `tests/e2e/universe-panels.spec.ts` | Real browser pointer/keyboard/zoom/resize lifecycle on internal harness; actual task entry route acceptance is repeated with E2.4 |
| `ui/package.json`, `pnpm-lock.yaml` | Qualified exact dependency and generated resolution |

Do not edit TaskDetail just to insert a second frame. Its workspace mode already has view chrome; E2.4 owns the appropriate content adaptation.

## Task 1 — pure panel contract

Consumes a scope, already-authorized content reference and validated geometry. Produces State via panelReducer. One reference/version per conversation has one key; generation identifies an incarnation of that key. A late resize or close from an old incarnation cannot affect a reopened panel.

- [ ] Add the regression cases below as Vitest tests and confirm failure because the production module is absent.
- [ ] Create panel-state.ts from this reviewed reference and run focused tests.
- [ ] Validate maximum/invalid geometry boundaries and rapid transitions; review rejected actions with the consumer so UI feedback remains useful.

**Complete reference module:**

```ts
export type Rect = { x: number; y: number; width: number; height: number };
export type Scope = { companyId: string; userId: string; conversationId: string };
export type Ref = { companyId: string; kind: "task" | "artifact" | "browser"; id: string; version?: string };
export type Panel = {
  key: string; generation: number; ref: Ref; title: string; rect: Rect;
  minimized: boolean; pinned: boolean;
};
export type State = {
  scope: Scope; nextGeneration: number; panels: Record<string, Panel>; order: string[];
  selected: string | null; maximized: string | null;
};
export type Action =
  | { type: "open"; ref: Ref; title: string; rect: Rect }
  | { type: "focus" | "minimize" | "restore" | "maximize" | "close"; key: string; generation: number }
  | { type: "pin"; key: string; generation: number; value: boolean }
  | { type: "geometry"; key: string; generation: number; rect: Rect; source: "human" | "commander" };

export const panelKey = (scope: Scope, ref: Ref): string =>
  JSON.stringify([scope.companyId, scope.userId, scope.conversationId, ref.kind, ref.id, ref.version ?? null]);

export const initialState = (scope: Scope): State =>
  ({ scope, nextGeneration: 1, panels: {}, order: [], selected: null, maximized: null });

const validRect = (r: Rect): boolean =>
  [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
  Math.abs(r.x) <= 1e7 && Math.abs(r.y) <= 1e7 &&
  r.width >= 1 && r.height >= 1 && r.width <= 8192 && r.height <= 8192;

function foreground(s: State, key: string): State {
  return {
    ...s,
    selected: key,
    order: [...s.order.filter(k => k !== key), key],
    maximized: s.maximized === key ? key : null,
  };
}
function nextVisible(s: State): string | null {
  return [...s.order].reverse().find(k => !s.panels[k].minimized) ?? null;
}

export function panelReducer(s: State, a: Action): State {
  if (a.type === "open") {
    if (a.ref.companyId !== s.scope.companyId || !a.ref.id || !validRect(a.rect)) return s;
    const key = panelKey(s.scope, a.ref);
    const existing = s.panels[key];
    const panel: Panel = existing
      ? { ...existing, minimized: false }
      : { key, generation: s.nextGeneration, ref: { ...a.ref }, title: a.title, rect: { ...a.rect }, minimized: false, pinned: false };
    return foreground({ ...s, nextGeneration: existing ? s.nextGeneration : s.nextGeneration + 1,
      panels: { ...s.panels, [key]: panel } }, key);
  }
  const panel = s.panels[a.key];
  if (!panel || panel.generation !== a.generation) return s; // Fence closed/reopened instances.
  switch (a.type) {
    case "geometry":
      if (panel.minimized || s.maximized === a.key ||
          (panel.pinned && a.source === "commander") || !validRect(a.rect)) return s;
      return { ...s, panels: { ...s.panels, [a.key]: { ...panel, rect: { ...a.rect } } } };
    case "pin":
      return { ...s, panels: { ...s.panels, [a.key]: { ...panel, pinned: a.value } } };
    case "focus":
      return panel.minimized ? s : foreground(s, a.key);
    case "maximize": {
      const next = foreground({
        ...s, panels: { ...s.panels, [a.key]: { ...panel, minimized: false } },
      }, a.key);
      return { ...next, maximized: a.key };
    }
    case "restore": {
      const next = foreground({
        ...s, panels: { ...s.panels, [a.key]: { ...panel, minimized: false } },
      }, a.key);
      return { ...next, maximized: null };
    }
    case "minimize": {
      const next: State = {
        ...s,
        panels: { ...s.panels, [a.key]: { ...panel, minimized: true } },
        maximized: s.maximized === a.key ? null : s.maximized,
      };
      return { ...next, selected: s.selected === a.key ? nextVisible(next) : s.selected };
    }
    case "close": {
      const panels = { ...s.panels };
      delete panels[a.key];
      const next: State = {
        ...s, panels, order: s.order.filter(k => k !== a.key),
        maximized: s.maximized === a.key ? null : s.maximized,
      };
      return { ...next, selected: s.selected === a.key ? nextVisible(next) : s.selected };
    }
  }
}

export type Viewport = { x: number; y: number; zoom: number };
export type Bounds = { left: number; top: number; width: number; height: number };
function validateView(view: Viewport, usable: Bounds): void {
  if (![view.x, view.y, view.zoom, usable.left, usable.top, usable.width, usable.height].every(Number.isFinite) ||
      view.zoom < 0.25 || view.zoom > 2 || usable.width <= 0 || usable.height <= 0)
    throw new RangeError("Unavailable or invalid canvas viewport");
}
export function displayRect(panel: Panel, state: State, view: Viewport, usable: Bounds): Rect {
  validateView(view, usable);
  if (state.maximized !== panel.key) return panel.rect;
  return {
    x: (usable.left - view.x) / view.zoom,
    y: (usable.top - view.y) / view.zoom,
    width: usable.width / view.zoom,
    height: usable.height / view.zoom,
  };
}
export type SizePolicy = { width: number; height: number; minWidth: number; minHeight: number };
export function openingRect(policy: SizePolicy, usable: Bounds, view: Viewport, ordinal: number): Rect {
  validateView(view, usable);
  // Desired sizes are CSS pixels at the current zoom, converted to canvas units once.
  const width = Math.min(policy.width, usable.width);
  const height = Math.min(policy.height, usable.height);
  const dx = Math.min((ordinal % 4) * 20, Math.max(0, (usable.width - width) / 2));
  const dy = Math.min((ordinal % 4) * 20, Math.max(0, (usable.height - height) / 2));
  return {
    x: (usable.left + (usable.width - width) / 2 + dx - view.x) / view.zoom,
    y: (usable.top + (usable.height - height) / 2 + dy - view.y) / view.zoom,
    width: width / view.zoom, height: height / view.zoom,
  };
}
```

Minimize from maximized returns that panel to its preserved normal geometry when restored. Clicking a different panel exits maximize without deleting/restyling either panel's normal geometry. These choices make the prior failed maximize/minimize chains deterministic and should be reviewed in the connected UI.

The reducer does not mutate transcript/draft/session state, request camera movement, or authorize a Commander command. A Commander layout adapter checks pins and active user interaction before dispatch; its source marker is a behavioral distinction, not a security credential.

## Task 2 — frame and React Flow binding

- [ ] Qualify/install the candidate package in the isolated implementation tree; regenerate the lockfile and verify a frozen install. Inspect installed declaration types against this plan before connecting callbacks.
- [ ] Add real frame-button tests: Pin dispatches pin(value=true), Maximize dispatches maximize, Minimize dispatches minimize and Close dispatches close, each with the same key and generation. Testing Library should click by accessible name, matching the existing task-focus test convention.
- [ ] Implement the frame below and its controlled-node mapping. Verify no close handler falls through to a separate task/preview handler.
- [ ] Add styling and actual pointer tests for all eight edges/corners. Resizer callbacks commit geometry; animation completion is never the state-changing callback.

**Reference frame module:**

```tsx
import type { Dispatch, ReactNode } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { Pin, PinOff, Maximize2, Minimize2, Minus, X } from "lucide-react";
import type { Action, Panel } from "./panel-state";

export type PanelNodeData = {
  panel: Panel; selected: boolean; maximized: boolean;
  minWidth: number; minHeight: number; maxWidth: number; maxHeight: number;
  dispatch: Dispatch<Action>; content: ReactNode;
};
export type PanelFlowNode = Node<PanelNodeData, "universe-panel">;

export function PanelNode({ data }: NodeProps<PanelFlowNode>) {
  const { panel, dispatch } = data;
  const act = (type: "focus" | "minimize" | "restore" | "maximize" | "close") =>
    dispatch({ type, key: panel.key, generation: panel.generation });
  const geometry = (_event: unknown, r: { x: number; y: number; width: number; height: number }) =>
    dispatch({ type: "geometry", key: panel.key, generation: panel.generation, rect: r, source: "human" });
  return (
    <section
      className="universe-panel"
      data-selected={data.selected}
      aria-label={panel.title}
      onPointerDownCapture={() => act("focus")}
    >
      {!panel.minimized && !data.maximized && (
        <NodeResizer
          minWidth={data.minWidth} minHeight={data.minHeight}
          maxWidth={data.maxWidth} maxHeight={data.maxHeight}
          onResize={geometry} onResizeEnd={geometry}
          handleClassName="universe-resize-corner"
          lineClassName="universe-resize-edge"
        />
      )}
      <header className="universe-drag-handle" tabIndex={0} aria-label={panel.title + " panel controls"}>
        <span className="universe-panel-title">{panel.title}</span>
        <div className="nodrag nopan universe-panel-actions">
          <button type="button" aria-label={panel.pinned ? "Unpin panel" : "Pin panel"}
            aria-pressed={panel.pinned}
            onClick={() => dispatch({ type: "pin", key: panel.key, generation: panel.generation, value: !panel.pinned })}>
            {panel.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button type="button" aria-label={data.maximized ? "Restore panel" : "Maximize panel"}
            onClick={() => act(data.maximized ? "restore" : "maximize")}>
            {data.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" aria-label="Minimize panel" onClick={() => act("minimize")}><Minus size={14} /></button>
          <button type="button" aria-label="Close panel" onClick={() => act("close")}><X size={14} /></button>
        </div>
      </header>
      <div className="nodrag nopan nowheel universe-panel-body">{data.content}</div>
    </section>
  );
}
```

The frame's button hit regions are 32 px, with icon art 14 px. Header has a flex title and one action row. Body is flex:1, min-height:0, overflow:auto; task composer remains fixed inside its owning content renderer. Frame fills node width/height. Selection uses only an accent-mixed header background and brighter title/actions. Keyboard focus indication remains visible independently of selected styling.

Resizer edges/corners remain hittable when visually quiet: transparent 8 px pointer regions and appropriate directional cursors; highlight only the hovered/focused affordance, never a permanent panel border. Touch hit targets expand to 24 px. Maximize hides resize controls and leaves normal geometry untouched.

### Controlled workspace interface

```ts
import type { ReactNode } from "react";
import type { Scope, Ref, State, Rect } from "./panel-state";

export type ContentEntry = {
  ref: Ref;
  title: string;
  render: (onClose: () => void) => ReactNode;
};
export type WorkspaceProps = {
  scope: Scope;
  initialPanels: Array<{ ref: Ref; title: string; rect: Rect }>;
  content: Record<string, ContentEntry>;
  onStateChange?: (state: State) => void;
};
```

content is keyed by panelKey; its absence renders an unavailable/loading body while frame controls continue to function. Key the top workspace provider by company/user/conversation to discard old private view state; E1.2–3 restore only authorized snapshots. Every launch path calls the same open action, never queries a DOM element by title.

### Exact visual mapping and callback ownership

| React Flow binding | Required value / adapter behavior |
|---|---|
| Node identity/type | id=panel.key; type=universe-panel; nodeTypes registered outside render |
| Content incarnation | Key renderer boundary by panel.key + generation; generation stays stable across minimize/maximize |
| Position and size | displayRect(panel,state,viewport,usable) → node.position and style.width/style.height; do not persist library measurement fields |
| Drag handle | `.universe-drag-handle`; action/body nodrag/nopan; scrolling body nowheel |
| Visibility | Minimized wrapper style visibility:hidden and pointerEvents:none with inert content; do not clone or destroy the panel to animate it. Frame state/drafts remain separately owned. |
| Z order | index in state.order; maximized panel foreground; elevateNodesOnSelect=false so AoA owns ordering |
| Selection | node.selected mirrors selected key; multiSelectionKeyCode=null; disable graph connection/deletion shortcuts and connection handles |
| Graph defaults | edges=[], nodesConnectable=false, deleteKeyCode=null, no edges/handles. Disable built-in selection drag grouping. |
| Controlled camera | viewport and onViewportChange; validate finite values and zoom range; do not fitView on every open/update |
| onNodesChange | Never apply remove/select wholesale to canonical registry. Explicit frame/launch operations own lifecycle; accept measured dimensions only for rendering, not normal saved geometry. |
| onNodeDrag | Dispatch geometry using node.position + current normal width/height and the callback node's generation. Ignore if maximized/minimized; do not reread generation for an old callback. |
| onNodeDragStop | Flush the last valid geometry; pointer cancellation also releases any drag shield. E1.2 later persists only acknowledged operations. |
| NodeResizer | onResize/onResizeEnd dispatch the provided x/y/width/height once; library callbacks already account for canvas zoom |
| Resize bounds | minWidth/minHeight from type minimum divided by zoom, capped to usable size; max is min(8192, usable dimension/zoom) for manual resize. Preserve existing offscreen saved geometry until user requests a change. |
| Maximize | Project usable rectangle through inverse camera without reparenting. Disable canvas pan/zoom/autoPan during maximize; restore camera remains unchanged. ResizeObserver updates display projection only. |
| Focus or restore | Resolve registry state immediately; later E1.6 explicitly brings an offscreen reference into view. No background camera stealing. |

Validate measured usable bounds before computing projections; defer render initialization when width/height is zero. Never commit an infinity/NaN from an unmeasured hidden tab. Normal geometry must not be overwritten by React Flow dimensions emitted for the maximized display.

## Task 3 — gestures, focus and content lifetime

- [ ] On the focused header only, Alt+arrows move by 10 CSS px; Alt+Shift+arrows resize by 10 CSS px. Translate once by camera.zoom, clamp to type/viewport minima and reducer limits, and dispatch generation-bound geometry(source=human). Do not intercept input/contentEditable events.
- [ ] During header drag/resize across an iframe, show a temporary pointer shield owned by the active gesture. Remove on pointerup, pointercancel, lost capture, blur, close, scope change and unmount. It does not grant browser control.
- [ ] On minimize/close restore focus to the triggering overview/tray item, or workspace recovery control if it is absent. On restore focus the panel header without stealing an editor's selection during ordinary pointer focus.
- [ ] Preserve a content-instance counter and draft fixture through minimize/maximize/restore, then ensure close tears down only that view. Authority/session lifetime stays with the owning service.
- [ ] Route all five future entry points through open; keep actual E2.4 route tests explicitly outstanding until those entry points exist.

## Task 4 — qualification and connected evidence

Run the real pointer journey for task/chat, artifact and iframe-like fixtures at camera zoom 0.5, 1 and 2; every resize edge/corner, header drag, text selection, body scroll, overlap focus, pin → human move → Commander arrange rejection, maximize → minimize → restore, close/reopen and stale callback. Repeat with pointer release outside the viewport, reduced motion and narrow bounds. Unit tests alone cannot close this task.

Use the existing Playwright config's isolated instance only when it truly runs tests. On the Windows host, its embedded-Postgres skip rule must be handled with a suitable configured test environment; do not accept a skipped report as success. A component harness can qualify generic frame behavior first, but actual authenticated task routes and embedded-host delivery require separate observed evidence in E2.4/E1.0.

## Reference contract checks

These are executable Node assertions for the reference module, not tests of a running Universe. For the production Vitest file, import the module functions, Node strict assert and Vitest it; register each check as it(name,fn). The standalone validation in this planning pass executes the checks against transpiled reference code.

```js
const scope = { companyId: "c", userId: "u", conversationId: "chat" };
const ref = { companyId: "c", kind: "task", id: "task" };
const rect = { x: 100, y: 120, width: 640, height: 480 };
const open = { type: "open", ref, title: "Launch design", rect };
const key = panelKey(scope, ref);
let checks = 0;
const check = (name, fn) => { fn(); checks++; };
check("all entries resolve to one panel without moving it", () => {
  let s = panelReducer(initialState(scope), open);
  s = panelReducer(s, { ...open, rect: { ...rect, x: 900 } });
  assert.equal(s.order.length, 1);
  assert.deepEqual(s.panels[key].rect, rect);
});
check("human can move pinned panel; Commander cannot", () => {
  let s = panelReducer(initialState(scope), open);
  s = panelReducer(s, { type: "pin", key, generation: 1, value: true });
  const moved = { ...rect, x: 250 };
  assert.equal(panelReducer(s, { type: "geometry", key, generation: 1, rect: moved, source: "commander" }), s);
  s = panelReducer(s, { type: "geometry", key, generation: 1, rect: moved, source: "human" });
  assert.deepEqual(s.panels[key].rect, moved);
});
check("maximize projects usable workspace and restore preserves geometry", () => {
  let s = panelReducer(initialState(scope), open);
  s = panelReducer(s, { type: "maximize", key, generation: 1 });
  assert.deepEqual(displayRect(s.panels[key], s, { x: 10, y: 20, zoom: 0.5 },
    { left: 20, top: 60, width: 900, height: 600 }), { x: 20, y: 80, width: 1800, height: 1200 });
  assert.equal(panelReducer(s, { type: "geometry", key, generation: 1, rect: { ...rect, width: 1800 }, source: "human" }), s);
  s = panelReducer(s, { type: "restore", key, generation: 1 });
  assert.equal(s.maximized, null);
  assert.deepEqual(s.panels[key].rect, rect);
});
check("minimize changes state immediately and restore is normal geometry", () => {
  let s = panelReducer(initialState(scope), open);
  s = panelReducer(s, { type: "maximize", key, generation: 1 });
  s = panelReducer(s, { type: "minimize", key, generation: 1 });
  assert.equal(s.panels[key].minimized, true);
  assert.equal(s.selected, null);
  assert.equal(s.maximized, null);
  assert.equal(s.order.length, 1);
  s = panelReducer(s, { type: "restore", key, generation: 1 });
  assert.equal(s.panels[key].minimized, false);
  assert.deepEqual(s.panels[key].rect, rect);
});
check("close only removes target and late events are ignored", () => {
  let s = panelReducer(initialState(scope), open);
  const other = { ...ref, id: "other" };
  s = panelReducer(s, { ...open, ref: other });
  s = panelReducer(s, { type: "close", key, generation: 1 });
  assert.equal(s.order.length, 1);
  assert.equal(s.selected, panelKey(scope, other));
  assert.equal(panelReducer(s, { type: "maximize", key, generation: 1 }), s);
});
check("invalid geometry and cross-company opening rejected", () => {
  const s = initialState(scope);
  assert.equal(panelReducer(s, { ...open, ref: { ...ref, companyId: "other" } }), s);
  assert.equal(panelReducer(s, { ...open, rect: { ...rect, width: NaN } }), s);
});
check("version and conversation are distinct identities", () => {
  assert.notEqual(key, panelKey(scope, { ...ref, version: "v2" }));
  assert.notEqual(key, panelKey({ ...scope, conversationId: "other" }, ref));
});
check("new panel appears bounded in current view", () => {
  const r = openingRect({ width: 640, height: 520, minWidth: 360, minHeight: 280 },
    { left: 0, top: 64, width: 390, height: 600 }, { x: 80, y: -20, zoom: 0.5 }, 3);
  assert.equal(r.width * 0.5, 390);
  assert.ok(r.y * 0.5 - 20 >= 64);
  assert.ok((r.y + r.height) * 0.5 - 20 <= 664);
});
check("focus changes stacking without geometry change", () => {
  let s = panelReducer(initialState(scope), open);
  s = panelReducer(s, { ...open, ref: { ...ref, id: "other" } });
  s = panelReducer(s, { type: "focus", key, generation: 1 });
  assert.equal(s.order.at(-1), key);
  assert.deepEqual(s.panels[key].rect, rect);
});
check("rapid operations converge with no orphan selection", () => {
  let s = panelReducer(initialState(scope), open);
  for (let n = 0; n < 100; n++) {
    s = panelReducer(s, { type: "maximize", key, generation: 1 });
    s = panelReducer(s, { type: "minimize", key, generation: 1 });
    s = panelReducer(s, { type: "restore", key, generation: 1 });
  }
  s = panelReducer(s, { type: "close", key, generation: 1 });
  assert.deepEqual(s.order, []);
  assert.equal(s.selected, null);
  assert.equal(s.maximized, null);
});
check("closed instance cannot mutate a reopened panel", () => {
  let s = panelReducer(initialState(scope), open);
  s = panelReducer(s, { type: "close", key, generation: 1 });
  s = panelReducer(s, open);
  assert.equal(s.panels[key].generation, 2);
  assert.equal(panelReducer(s, { type: "minimize", key, generation: 1 }), s);
});
check("zero viewport cannot emit corrupt panel geometry", () => {
  assert.throws(() => openingRect({ width: 640, height: 480, minWidth: 360, minHeight: 280 },
    { left: 0, top: 0, width: 0, height: 600 }, { x: 0, y: 0, zoom: 1 }, 0), RangeError);
});
console.log(JSON.stringify({ contractChecks: checks, result: "passed" }));
```

## Commands at implementation time

```sh
pnpm --filter @armyofagents/ui add --save-exact @xyflow/react@12.11.6
pnpm install --frozen-lockfile
pnpm exec vitest run ui/src/components/universe/__tests__/panel-state.test.ts ui/src/components/universe/__tests__/PanelNode.test.tsx ui/src/components/universe/__tests__/UniverseWorkspace.test.tsx
pnpm exec playwright test --config=tests/e2e/playwright.config.ts tests/e2e/universe-panels.spec.ts
pnpm -r typecheck
pnpm test:run
pnpm build
```

The proposed tests/package install above have not been run as production changes. Before coding, use the actual installed exports to typecheck PanelNode and controlled React Flow callbacks. A provider/body fixture is not evidence of real task/browser integration.

## Merge, rollback and definition of done

Review reducer/frame and consumers together in small branches against the verified Universe integration base. Keep slice progress separate from release approval. Rollback disables the new UI entry; it never deletes canonical work, drafts or artifacts. No migration rollback is needed for this UI-only slice.

Close E1.1 only when the actual library integration passes full pointer/keyboard/resize/overlap and scope-switch checks, with final code/tests, supported limits and host evidence recorded. Keep E1.0 visual review, E1.2–3 persistence, E2.4 task content and E3/E6 transport gates separate. This plan's reference code and assertions make state semantics concrete; they do not certify all rendering code executable before the package/build check.
