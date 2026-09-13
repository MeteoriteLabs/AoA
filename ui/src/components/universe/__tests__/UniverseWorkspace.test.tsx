import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { UniverseWorkspace, type WorkspaceHandle } from "../UniverseWorkspace";
import { panelKey, type AuthorizedLayoutSnapshot } from "../panel-state";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        this.callback(
          [
            {
              target: element,
              contentRect: { width: 1200, height: 900 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver
        );
      }
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22 = 1;
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

const scope = { companyId: "a", userId: "u", conversationId: "c" };
const ref = { companyId: "a", kind: "task" as const, id: "t" };
const key = panelKey(scope, ref);
const layout: AuthorizedLayoutSnapshot = {
  scope,
  schemaVersion: 1,
  revision: 1,
  nextOpenedOrdinal: 2,
  viewport: { x: 30, y: 40, zoom: 0.5 },
  panels: [
    {
      ref,
      title: "Task fixture",
      rect: { x: 20, y: 30, width: 600, height: 400 },
      openedOrdinal: 1,
      minimized: false,
      pinned: false,
    },
  ],
  order: [key],
  selected: key,
  maximized: null,
};

function setup() {
  const handle = createRef<WorkspaceHandle>();
  const changed = vi.fn();
  const camera = vi.fn();
  const result = render(
    <UniverseWorkspace
      ref={handle}
      scope={scope}
      initialLayout={layout}
      content={{
        [key]: {
          ref,
          title: "Task fixture",
          render: () => <textarea aria-label="Draft" defaultValue="original" />,
        },
      }}
      onStateChange={changed}
      onViewportCommit={camera}
    />
  );
  return { handle, changed, camera, ...result };
}

describe("controlled workspace", () => {
  it("routes actual frame actions through registry and preserves minimized drafts", () => {
    const { handle, camera } = setup();
    const draft = screen.getByLabelText("Draft");
    fireEvent.change(draft, { target: { value: "kept" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin panel" }));
    expect(handle.current!.getState().panels[key].pinned).toBe(true);
    const normal = handle.current!.getState().panels[key].rect;
    fireEvent.click(screen.getByRole("button", { name: "Maximize panel" }));
    expect(handle.current!.getState().maximized).toBe(key);
    expect(handle.current!.getState().panels[key].rect).toEqual(normal);
    fireEvent.click(screen.getByRole("button", { name: "Minimize panel" }));
    expect(handle.current!.getState().panels[key].minimized).toBe(true);
    expect(draft.isConnected).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Restore Task fixture" })
    );
    expect(screen.getByLabelText("Draft")).toBe(draft);
    expect(draft).toHaveValue("kept");
    expect(camera).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(handle.current!.getState().panels[key]).toBeUndefined();
    expect(draft.isConnected).toBe(false);
  });

  it("keeps eight resize affordances and records header geometry for undo", () => {
    const { handle, container } = setup();
    expect(
      container.querySelectorAll(".react-flow__resize-control")
    ).toHaveLength(8);
    const header = screen.getByLabelText("Task fixture panel controls");
    const before = handle.current!.getState().panels[key].rect;
    fireEvent.keyDown(header, { key: "ArrowRight", altKey: true });
    expect(handle.current!.getState().panels[key].rect.x).toBe(before.x + 20);
    act(() => handle.current!.undo());
    expect(handle.current!.getState().panels[key].rect).toEqual(before);
    act(() => handle.current!.redo());
    expect(handle.current!.getState().panels[key].rect.x).toBe(before.x + 20);
    fireEvent.keyDown(screen.getByLabelText("Draft"), {
      key: "ArrowRight",
      altKey: true,
    });
    expect(handle.current!.getState().panels[key].rect.x).toBe(before.x + 20);
  });

  it("rejects invalid and maximized camera changes and returns defensive state", () => {
    const { handle, changed, camera } = setup();
    expect(changed).not.toHaveBeenCalled();
    const snapshot = handle.current!.getState();
    snapshot.panels[key].rect.x = 999;
    expect(handle.current!.getState().panels[key].rect.x).toBe(20);
    act(() => handle.current!.setViewport({ x: NaN, y: 0, zoom: 1 }));
    expect(camera).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Maximize panel" }));
    act(() => handle.current!.setViewport({ x: 0, y: 0, zoom: 2 }));
    expect(camera).not.toHaveBeenCalled();
    expect(handle.current!.getViewport()).toEqual(layout.viewport);
  });

  it("rejects retained callbacks after a scope switch", () => {
    const { handle, rerender, changed } = setup();
    const old = handle.current!;
    const other = { ...scope, conversationId: "new" };
    rerender(
      <UniverseWorkspace
        ref={handle}
        scope={other}
        initialLayout={{
          ...layout,
          scope: other,
          panels: [],
          order: [],
          selected: null,
        }}
        content={{}}
        onStateChange={changed}
      />
    );
    act(() => old.dispatch({ type: "close", key, generation: 1 }));
    expect(handle.current!.getState().scope).toEqual(other);
    expect(changed).not.toHaveBeenCalled();
  });
});
