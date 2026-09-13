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
  hydrateLayout,
  initialState,
  panelKey,
  panelReducer,
  viewportFromLayout,
  type Action,
  type AuthorizedLayoutSnapshot,
  type Panel,
  type Ref,
  type Scope,
  type State,
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
    const recovery = useRef<HTMLButtonElement>(null);
    const triggers = useRef(new Map<string, HTMLElement>());
    const pendingFocus = useRef<string | null>(null);
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

    const finishGesture = useCallback((cancelled = false) => {
      const entry = gesture.current;
      gesture.current = null;
      if (!alive.current) return;
      setShielded(false);
      if (!entry) return;
      const panel = current.current.panels[entry.key];
      if (panel?.generation !== entry.generation) return;
      history.current = commitGesture(history.current, {
        ...entry,
        after: panel.rect,
        cancelled,
      });
    }, []);
    const beginGesture = useCallback((panel: Panel) => {
      if (!alive.current || gesture.current) return;
      const actual = current.current.panels[panel.key];
      if (
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
    }, []);
    const dispatch = useCallback(
      (action: Action) => {
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
          pendingFocus.current = panelKey(before.scope, action.ref);
        }
        if (action.type === "restore") pendingFocus.current = action.key;
        current.current = next;
        setState(next);
        if (action.type === "minimize" || action.type === "close") {
          finishGesture(true);
          const trigger = triggers.current.get(action.key);
          (trigger?.isConnected ? trigger : recovery.current)?.focus();
          if (action.type === "close") triggers.current.delete(action.key);
        }
        // A defensive snapshot prevents observers from mutating the sole registry.
        callbacks.current.onStateChange?.(structuredClone(next));
      },
      [finishGesture]
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
    useLayoutEffect(() => {
      if (!pendingFocus.current) return;
      const section = [
        ...(root.current?.querySelectorAll<HTMLElement>("[data-panel-key]") ??
          []),
      ].find((element) => element.dataset.panelKey === pendingFocus.current);
      if (section) {
        section.querySelector<HTMLElement>(".universe-drag-handle")?.focus();
        pendingFocus.current = null;
      }
    }, [state, usable]);
    const updateViewport = (next: Viewport, commit = false) => {
      if (!alive.current || current.current.maximized || !validViewport(next))
        return;
      camera.current = { ...next };
      setCamera({ ...next });
      if (commit) callbacks.current.onViewportCommit?.({ ...next });
    };
    useImperativeHandle(forwardedRef, () => ({
      dispatch,
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
              entry && panelKey(state.scope, entry.ref) === key
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
      dispatch({
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
        <div className="universe-recovery">
          <button ref={recovery} type="button">
            Workspace controls
          </button>
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
                if (event) updateViewport(next, true);
              }}
              minZoom={0.25}
              maxZoom={2}
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
