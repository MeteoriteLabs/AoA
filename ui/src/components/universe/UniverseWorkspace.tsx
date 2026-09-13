import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { PanelNode, type PanelFlowNode } from "./PanelNode";
import {
  displayRect,
  equalRect,
  hydrateLayout,
  initialState,
  openingRect,
  panelKey,
  panelReducer,
  validRef,
  viewportFromLayout,
  type Action,
  type AuthorizedLayoutSnapshot,
  type Panel,
  type Ref,
  type Scope,
  type State,
  type SizePolicy,
  type Viewport,
} from "./panel-state";
import {
  commitGesture,
  initialHistory,
  redoGeometry,
  scopeKey,
  undoGeometry,
  type GestureEntry,
} from "./panel-history";
import { resizeLimits } from "./panel-gestures";
import "@xyflow/react/dist/style.css";
import "./universe-panels.css";

export type ContentEntry = {
  ref: Ref;
  title: string;
  render: (onClose: () => void) => ReactNode;
};
export type WorkspaceProps = {
  scope: Scope;
  initialLayout: AuthorizedLayoutSnapshot;
  content: Record<string, ContentEntry>;
  onStateChange?: (state: State) => void;
  onViewportCommit?: (viewport: Viewport) => void;
};
/** Commands require caller authorization. The reducer's source field is not an authorization grant. */
export type WorkspaceHandle = {
  dispatch: (action: Action) => void;
  open: (
    entry: Pick<ContentEntry, "ref" | "title">,
    policy?: SizePolicy
  ) => void;
  getState: () => State;
  getViewport: () => Viewport;
  setViewport: (viewport: Viewport) => void;
  undo: () => void;
  redo: () => void;
};
const nodeTypes = { "universe-panel": PanelNode };
const validViewport = (v: Viewport) =>
  [v.x, v.y, v.zoom].every(Number.isFinite) &&
  Math.abs(v.x) <= 1e6 &&
  Math.abs(v.y) <= 1e6 &&
  v.zoom >= 0.25 &&
  v.zoom <= 2;
function Content({
  entry,
  close,
}: {
  entry: ContentEntry | undefined;
  close: () => void;
}) {
  return entry ? (
    entry.render(close)
  ) : (
    <p role="status">Content is unavailable or still loading.</p>
  );
}

const ScopedWorkspace = forwardRef<WorkspaceHandle, WorkspaceProps>(
  function ScopedWorkspace(props, forwardedRef) {
    const [state, setState] = useState(() =>
      hydrateLayout(initialState(props.scope), props.initialLayout)
    );
    const current = useRef(state);
    const [viewport, setCamera] = useState(() =>
      viewportFromLayout(props.initialLayout)
    );
    const camera = useRef(viewport);
    const callbacks = useRef(props);
    callbacks.current = props;
    const alive = useRef(true);
    const root = useRef<HTMLDivElement>(null);
    const recovery = useRef<HTMLDivElement>(null);
    const triggers = useRef(new Map<string, HTMLElement>());
    const pendingFocus = useRef<{ key: string; generation: number } | null>(
      null
    );
    const history = useRef(initialHistory(state.scope));
    const gesture = useRef<GestureEntry | null>(null);
    const serial = useRef(0);
    const [shielded, setShielded] = useState(false);
    const [usable, setUsable] = useState({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });

    const finishGesture = useCallback((cancelled = false, notify = true) => {
      const entry = gesture.current;
      gesture.current = null;
      if (!alive.current) return;
      setShielded(false);
      if (!entry) return;
      const panel = current.current.panels[entry.key];
      if (panel?.generation !== entry.generation) return;
      if (cancelled) {
        // Roll back only this gesture's last accepted rectangle; a concurrent edit wins.
        const next = panelReducer(current.current, {
          type: "geometry",
          key: entry.key,
          generation: entry.generation,
          rect: entry.before,
          expectedRect: entry.after,
          source: "human",
        });
        if (next !== current.current) {
          current.current = next;
          setState(next);
          if (notify) callbacks.current.onStateChange?.(structuredClone(next));
        }
        return;
      }
      // A synchronous observer may have superseded the last accepted sample.
      // Only a still-owned result can become human history or clear prior redo.
      if (equalRect(panel.rect, entry.after))
        history.current = commitGesture(history.current, entry);
    }, []);
    const applyAction = useCallback(
      (action: Action, owner?: GestureEntry) => {
        if (!alive.current) return;
        const before = current.current;
        const next = panelReducer(before, action);
        if (next === before) return;
        if (action.type === "open") {
          const element = document.activeElement;
          if (
            element instanceof HTMLElement &&
            !element.closest(".universe-panel")
          )
            triggers.current.set(panelKey(before.scope, action.ref), element);
          const key = panelKey(before.scope, action.ref);
          pendingFocus.current = {
            key,
            generation: next.panels[key].generation,
          };
        }
        if (action.type === "restore")
          pendingFocus.current = {
            key: action.key,
            generation: action.generation,
          };
        if (
          action.type === "close" ||
          action.type === "minimize" ||
          action.type === "focus"
        )
          pendingFocus.current = null;
        current.current = next;
        // Capture this accepted sample before an observer can issue another command.
        if (owner && owner === gesture.current && action.type === "geometry") {
          owner.after = { ...next.panels[action.key].rect };
        }
        setState(next);
        if (action.type === "minimize" || action.type === "close") {
          // Publish lifecycle and any rollback together, after both are accepted.
          finishGesture(true, false);
          const trigger = triggers.current.get(action.key);
          (trigger?.isConnected ? trigger : recovery.current)?.focus();
          if (action.type === "close") triggers.current.delete(action.key);
        }
        // A defensive snapshot prevents observers from mutating the sole registry.
        callbacks.current.onStateChange?.(structuredClone(current.current));
      },
      [finishGesture]
    );

    const dispatch = useCallback(
      (action: Action) => applyAction(action),
      [applyAction]
    );

    const beginGesture = useCallback(
      (panel: Panel) => {
        if (!alive.current || gesture.current) return;
        dispatch({
          type: "focus",
          key: panel.key,
          generation: panel.generation,
        });
        // Focus observers may issue commands too; capture the still-current incarnation.
        const actual = current.current.panels[panel.key];
        if (
          !alive.current ||
          gesture.current ||
          actual?.generation !== panel.generation ||
          actual.minimized ||
          current.current.maximized === panel.key
        )
          return;
        gesture.current = {
          scopeKey: scopeKey(current.current.scope),
          gestureId: String(++serial.current),
          key: panel.key,
          generation: panel.generation,
          before: { ...actual.rect },
          after: { ...actual.rect },
          source: "human",
        };
        setShielded(true);
      },
      [dispatch]
    );

    // Library callbacks are valid only while their captured incarnation owns a gesture.
    // Public dispatch remains independent for authorized external commands.
    const gestureDispatch = useCallback(
      (action: Action) => {
        const active = gesture.current;
        if (
          action.type !== "geometry" ||
          !active ||
          active.key !== action.key ||
          active.generation !== action.generation
        )
          return;
        applyAction(action, active);
      },
      [applyAction]
    );

    useLayoutEffect(() => {
      alive.current = true;
      const observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (
          Number.isFinite(width) &&
          Number.isFinite(height) &&
          width > 0 &&
          height > 0
        )
          setUsable({ left: 0, top: 0, width, height });
      });
      if (root.current) observer.observe(root.current);
      const release = () => finishGesture();
      const cancel = () => finishGesture(true);
      window.addEventListener("pointerup", release);
      window.addEventListener("mouseup", release);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("blur", cancel);
      window.addEventListener("lostpointercapture", cancel);
      return () => {
        alive.current = false;
        gesture.current = null;
        observer.disconnect();
        window.removeEventListener("pointerup", release);
        window.removeEventListener("mouseup", release);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", cancel);
        window.removeEventListener("lostpointercapture", cancel);
      };
    }, [finishGesture]);
    const headerReady = useCallback((panel: Panel, header: HTMLElement) => {
      const pending = pendingFocus.current;
      const actual = current.current.panels[panel.key];
      if (
        !alive.current ||
        !pending ||
        pending.key !== panel.key ||
        pending.generation !== panel.generation ||
        actual?.generation !== panel.generation ||
        actual.minimized ||
        current.current.selected !== panel.key
      )
        return true;
      if (
        !header.isConnected ||
        header.closest("[inert]") ||
        getComputedStyle(header).visibility === "hidden"
      )
        return false;
      header.focus({ preventScroll: true });
      // Consume only confirmed focus; wrapper attribute changes signal readiness.
      if (document.activeElement !== header) return false;
      pendingFocus.current = null;
      return true;
    }, []);
    const updateViewport = (next: Viewport, commit = false) => {
      if (!alive.current || current.current.maximized || !validViewport(next))
        return;
      camera.current = { ...next };
      setCamera({ ...next });
      if (commit) callbacks.current.onViewportCommit?.({ ...next });
    };
    useImperativeHandle(forwardedRef, () => ({
      dispatch,
      open: (
        entry,
        policy = {
          width: 520,
          height: 360,
          minWidth: entry.ref.kind === "browser" ? 400 : 320,
          minHeight: 240,
        }
      ) => {
        if (!alive.current || usable.width <= 0 || usable.height <= 0) return;
        const existing =
          current.current.panels[panelKey(current.current.scope, entry.ref)];
        const rect =
          existing?.rect ??
          openingRect(
            policy,
            usable,
            camera.current,
            current.current.nextOpenedOrdinal
          );
        dispatch({ type: "open", ...entry, rect });
      },
      getState: () => structuredClone(current.current),
      getViewport: () => ({ ...camera.current }),
      setViewport: (next) => updateViewport(next, true),
      undo: () => replay("undo"),
      redo: () => replay("redo"),
    }));
    function replay(direction: "undo" | "redo") {
      if (!alive.current || gesture.current) return;
      const proposal = (direction === "undo" ? undoGeometry : redoGeometry)(
        current.current,
        history.current
      );
      if (!proposal.action) return;
      const before = current.current;
      dispatch(proposal.action);
      if (current.current !== before) history.current = proposal.history;
    }

    const nodes: PanelFlowNode[] =
      usable.width && usable.height
        ? state.order.map((key, index) => {
            const panel = state.panels[key];
            const rect = displayRect(panel, state, viewport, usable);
            const entry = Object.hasOwn(props.content, key)
              ? props.content[key]
              : undefined;
            const matchingEntry =
              entry &&
              validRef(entry.ref, state.scope) &&
              panelKey(state.scope, entry.ref) === key
                ? entry
                : undefined;
            return {
              id: key,
              type: "universe-panel",
              position: { x: rect.x, y: rect.y },
              selected: state.selected === key,
              width: rect.width,
              height: rect.height,
              zIndex: index,
              draggable: !panel.minimized && state.maximized === null,
              selectable: false,
              dragHandle: ".universe-drag-handle",
              style: {
                width: rect.width,
                height: rect.height,
                visibility: panel.minimized ? "hidden" : "visible",
                pointerEvents: panel.minimized ? "none" : "auto",
              },
              data: {
                panel,
                selected: state.selected === key,
                maximized: state.maximized === key,
                limits: resizeLimits(panel.ref.kind, viewport.zoom, usable),
                zoom: viewport.zoom,
                dispatch,
                headerReady,
                gestureDispatch,
                shielded,
                beginGesture,
                endGesture: () => finishGesture(),
                content: (
                  <Content
                    key={`${key}:${panel.generation}`}
                    entry={matchingEntry}
                    close={() =>
                      dispatch({
                        type: "close",
                        key,
                        generation: panel.generation,
                      })
                    }
                  />
                ),
              },
            };
          })
        : [];
    const drag = (_event: unknown, node: PanelFlowNode) => {
      gestureDispatch({
        type: "geometry",
        key: node.id,
        generation: node.data.panel.generation,
        source: "human",
        rect: {
          ...node.data.panel.rect,
          x: node.position.x,
          y: node.position.y,
        },
      });
    };
    const maximized = state.maximized !== null;
    return (
      <div className="universe-workspace">
        <div
          className="universe-recovery"
          ref={recovery}
          role="group"
          aria-label="Workspace controls"
          tabIndex={-1}
        >
          <span>Workspace controls</span>
          {state.order
            .filter((key) => state.panels[key].minimized)
            .map((key) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  dispatch({
                    type: "restore",
                    key,
                    generation: state.panels[key].generation,
                  })
                }
              >
                Restore {state.panels[key].title}
              </button>
            ))}
        </div>
        <div
          className="universe-canvas"
          ref={root}
          data-testid="universe-canvas"
        >
          {usable.width > 0 && usable.height > 0 && (
            <ReactFlow<PanelFlowNode>
              nodes={nodes}
              edges={[]}
              nodeTypes={nodeTypes}
              viewport={viewport}
              onViewportChange={(next) => updateViewport(next)}
              onMoveEnd={(event, next) => {
                // Controlled viewport synchronization also emits a truthy { sync: true }
                // end event. A delayed native end can also predate a newer pan.
                // Completion commits only the live camera; it never replays old samples.
                if (
                  event instanceof Event &&
                  next.x === camera.current.x &&
                  next.y === camera.current.y &&
                  next.zoom === camera.current.zoom
                )
                  updateViewport(next, true);
              }}
              minZoom={0.25}
              maxZoom={2}
              nodeDragThreshold={0}
              onNodesChange={() => {}}
              onNodeDragStart={(_event, node) => beginGesture(node.data.panel)}
              onNodeDrag={drag}
              onNodeDragStop={(event, node) => {
                drag(event, node);
                finishGesture();
              }}
              nodesConnectable={false}
              nodesFocusable={false}
              panActivationKeyCode={null}
              zoomActivationKeyCode={null}
              elementsSelectable={false}
              elevateNodesOnSelect={false}
              selectionOnDrag={false}
              selectionKeyCode={null}
              multiSelectionKeyCode={null}
              deleteKeyCode={null}
              panOnDrag={!maximized}
              panOnScroll={!maximized}
              zoomOnScroll={!maximized}
              zoomOnPinch={!maximized}
              zoomOnDoubleClick={false}
              autoPanOnNodeDrag={!maximized}
              autoPanOnNodeFocus={false}
              preventScrolling={!maximized}
            />
          )}
        </div>
      </div>
    );
  }
);
export const UniverseWorkspace = forwardRef<WorkspaceHandle, WorkspaceProps>(
  function UniverseWorkspace(props, ref) {
    return (
      <ReactFlowProvider key={scopeKey(props.scope)}>
        <ScopedWorkspace {...props} ref={ref} />
      </ReactFlowProvider>
    );
  }
);
