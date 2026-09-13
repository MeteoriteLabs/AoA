import { describe, expect, it } from "vitest";
import {
  initialState,
  panelKey,
  panelReducer,
  hydrateLayout,
  viewportFromLayout,
  reconcileOpeningAck,
  displayRect,
  openingRect,
  type AuthorizedLayoutSnapshot,
  type Action,
  type Ref,
} from "../panel-state";
const scope = { companyId: "c", userId: "u", conversationId: "chat" };
const ref: Ref = { companyId: "c", kind: "task", id: "a" };
const rect = { x: 100, y: 120, width: 640, height: 480 };
const open: Action = { type: "open", ref, title: "A", rect };
const key = panelKey(scope, ref);
const opened = () => panelReducer(initialState(scope), open);
const snapshot = (): AuthorizedLayoutSnapshot => ({
  scope,
  schemaVersion: 1,
  revision: 4,
  nextOpenedOrdinal: 12,
  viewport: { x: 22, y: -30, zoom: 0.5 },
  panels: [
    {
      ref,
      title: "A",
      rect,
      openedOrdinal: 11,
      minimized: false,
      pinned: true,
    },
  ],
  order: [key],
  selected: key,
  maximized: key,
});
describe("panel lifecycle", () => {
  it("deduplicates opens and preserves normal geometry, incarnation and ordinal", () => {
    const s = opened();
    const n = panelReducer(s, { ...open, rect: { ...rect, x: 900 } });
    expect(n.panels[key]).toEqual(s.panels[key]);
    expect(n.order).toEqual([key]);
  });
  it("focus order is independent of overview ordinal; reopen allocates both identities", () => {
    let s = panelReducer(opened(), { ...open, ref: { ...ref, id: "b" } });
    s = panelReducer(s, { type: "focus", key, generation: 1 });
    expect(s.order.at(-1)).toBe(key);
    expect(s.panels[key].openedOrdinal).toBe(1);
    s = panelReducer(s, { type: "close", key, generation: 1 });
    s = panelReducer(s, open);
    expect(s.panels[key].openedOrdinal).toBe(3);
    expect(s.panels[key].generation).toBe(3);
    for (const type of [
      "focus",
      "close",
      "minimize",
      "restore",
      "maximize",
    ] as const)
      expect(panelReducer(s, { type, key, generation: 1 })).toBe(s);
  });
  it("pin fences commander but permits human geometry", () => {
    const s = panelReducer(opened(), {
      type: "pin",
      key,
      generation: 1,
      value: true,
    });
    const a: Action = {
      type: "geometry",
      key,
      generation: 1,
      rect: { ...rect, x: 200 },
      source: "commander",
    };
    expect(panelReducer(s, a)).toBe(s);
    expect(panelReducer(s, { ...a, source: "human" }).panels[key].rect.x).toBe(
      200
    );
  });
  it("max/min/restore preserves normal rect and never leaves orphan selection", () => {
    let s = opened();
    for (let n = 0; n < 100; n++) {
      s = panelReducer(s, { type: "maximize", key, generation: 1 });
      expect(
        displayRect(
          s.panels[key],
          s,
          { x: 10, y: 20, zoom: 0.5 },
          { left: 20, top: 60, width: 900, height: 600 }
        )
      ).toEqual({ x: 20, y: 80, width: 1800, height: 1200 });
      expect(
        panelReducer(s, {
          type: "geometry",
          key,
          generation: 1,
          rect: { ...rect, x: 200 },
          source: "human",
        })
      ).toBe(s);
      s = panelReducer(s, { type: "minimize", key, generation: 1 });
      expect(s.selected).toBeNull();
      s = panelReducer(s, { type: "restore", key, generation: 1 });
      expect(s.panels[key].rect).toEqual(rect);
    }
    s = panelReducer(s, { type: "close", key, generation: 1 });
    expect(s.order).toEqual([]);
    expect(s.maximized).toBeNull();
  });
  it.each([NaN, Infinity, -1, 0, 8193])("rejects invalid size %s", (width) => {
    const s = initialState(scope);
    expect(panelReducer(s, { ...open, rect: { ...rect, width } })).toBe(s);
  });
  it("validates boundaries, ref runtime shape, inherited keys and exhaustion", () => {
    const s = initialState(scope);
    for (const bad of [
      { ...ref, companyId: "other" },
      { ...ref, id: 4 },
      { ...ref, version: null },
      { ...ref, kind: "evil" },
    ])
      expect(panelReducer(s, { ...open, ref: bad } as Action)).toBe(s);
    expect(
      panelReducer(s, {
        ...open,
        rect: { x: 1e6, y: -1e6, width: 8192, height: 1 },
      }).order
    ).toHaveLength(1);
    expect(panelReducer(s, { ...open, rect: { ...rect, x: 1e6 + 1 } })).toBe(s);
    expect(
      panelReducer(s, { type: "close", key: "__proto__", generation: 1 })
    ).toBe(s);
    for (const field of ["nextGeneration", "nextOpenedOrdinal"]) {
      const exhausted = { ...s, [field]: Number.MAX_SAFE_INTEGER };
      expect(panelReducer(exhausted, open)).toBe(exhausted);
    }
  });
  it("keys include user, conversation and version", () => {
    expect(panelKey({ ...scope, userId: "v" }, ref)).not.toBe(key);
    expect(panelKey({ ...scope, conversationId: "v" }, ref)).not.toBe(key);
    expect(panelKey(scope, { ...ref, version: "v" })).not.toBe(key);
  });
  it("opening geometry fits zoomed usable bounds and rejects invalid policies/views", () => {
    const policy = { width: 640, height: 520, minWidth: 360, minHeight: 280 };
    const bounds = { left: 0, top: 64, width: 390, height: 600 };
    const view = { x: 80, y: -20, zoom: 0.5 };
    const r = openingRect(policy, bounds, view, 3);
    expect(r.width * 0.5).toBe(390);
    expect((r.y + r.height) * 0.5 - 20).toBeLessThanOrEqual(664);
    expect(() => openingRect(policy, { ...bounds, width: 0 }, view, 0)).toThrow(
      RangeError
    );
    expect(() =>
      openingRect({ ...policy, width: NaN }, bounds, view, 0)
    ).toThrow(RangeError);
  });
});
describe("authorized hydration", () => {
  it("round trips presentation, camera and nonsequential ordinals with fresh generations", () => {
    const s = hydrateLayout(opened(), snapshot());
    expect(s.panels[key]).toMatchObject({
      generation: 2,
      openedOrdinal: 11,
      rect,
      pinned: true,
    });
    expect(s.nextOpenedOrdinal).toBe(12);
    expect(s.maximized).toBe(key);
    expect(viewportFromLayout(snapshot())).toEqual({
      x: 22,
      y: -30,
      zoom: 0.5,
    });
    expect(panelReducer(s, { type: "close", key, generation: 1 })).toBe(s);
  });
  it.each([
    "scope",
    "counter",
    "duplicate",
    "order",
    "selected",
    "maximized",
    "viewport",
    "ref",
    "revision",
  ])("rejects invalid %s atomically", (kind) => {
    const snap = snapshot();
    if (kind === "scope") snap.scope = { ...scope, userId: "other" };
    if (kind === "counter") snap.nextOpenedOrdinal = 11;
    if (kind === "duplicate") snap.panels.push({ ...snap.panels[0] });
    if (kind === "order") snap.order = [];
    if (kind === "selected") snap.selected = "missing";
    if (kind === "maximized") snap.selected = null;
    if (kind === "viewport") snap.viewport.zoom = 0;
    if (kind === "ref")
      snap.panels[0] = {
        ...snap.panels[0],
        ref: { ...ref, companyId: "other" },
      };
    if (kind === "revision") snap.revision = 0.5;
    const s = opened();
    expect(() => hydrateLayout(s, snap)).toThrow(RangeError);
    expect(s.panels[key].rect).toEqual(rect);
  });
});
describe("opening receipts", () => {
  const pending = [
    { scope, operationId: "op", operationIndex: 0, key, generation: 1 },
  ];
  const ack = {
    scope,
    operationId: "op",
    revision: 5,
    nextOpenedOrdinal: 22,
    opened: [{ operationIndex: 0, key, openedOrdinal: 21 }],
  };
  it("reconciles canonical ordinal without touching geometry/selection/generation and replay is inert", () => {
    const s = opened();
    const n = reconcileOpeningAck(s, ack, pending);
    expect(n.panels[key]).toEqual({ ...s.panels[key], openedOrdinal: 21 });
    expect(n.nextOpenedOrdinal).toBe(22);
    expect(n.selected).toBe(s.selected);
    expect(reconcileOpeningAck(n, ack, pending)).toBe(n);
  });
  it("rejects unknown, scope-mismatched and malformed mappings", () => {
    const s = opened();
    for (const bad of [
      { ...ack, scope: { ...scope, userId: "other" } },
      { ...ack, operationId: "unknown" },
      { ...ack, opened: [...ack.opened, ...ack.opened] },
      { ...ack, nextOpenedOrdinal: 21 },
    ])
      expect(reconcileOpeningAck(s, bad, pending)).toBe(s);
    expect(
      reconcileOpeningAck(s, ack, [
        { ...pending[0], scope: { ...scope, conversationId: "other" } },
      ])
    ).toBe(s);
  });
  it("old receipt cannot mutate reopened incarnation; same batch indexes disambiguate reopen", () => {
    let s = panelReducer(opened(), { type: "close", key, generation: 1 });
    s = panelReducer(s, open);
    expect(reconcileOpeningAck(s, ack, pending).panels[key]).toEqual(
      s.panels[key]
    );
    const n = reconcileOpeningAck(
      s,
      {
        ...ack,
        opened: [...ack.opened, { operationIndex: 2, key, openedOrdinal: 23 }],
        nextOpenedOrdinal: 24,
      },
      [...pending, { ...pending[0], operationIndex: 2, generation: 2 }]
    );
    expect(n.panels[key].openedOrdinal).toBe(23);
  });
  it("two concurrent optimistic opens retain counter above both and stale revisions are inert", () => {
    let s = panelReducer(opened(), { ...open, ref: { ...ref, id: "b" } });
    s = reconcileOpeningAck(s, ack, pending);
    expect(s.nextOpenedOrdinal).toBe(22);
    expect(s.panels[panelKey(scope, { ...ref, id: "b" })].openedOrdinal).toBe(
      2
    );
    expect(
      reconcileOpeningAck(s, { ...ack, operationId: "old", revision: 4 }, [
        { ...pending[0], operationId: "old" },
      ])
    ).toBe(s);
  });
});
it("focusing another panel exits maximize without altering either normal rectangle", () => {
  let s = panelReducer(opened(), { ...open, ref: { ...ref, id: "b" } });
  s = panelReducer(s, { type: "maximize", key, generation: 1 });
  const b = panelKey(scope, { ...ref, id: "b" });
  s = panelReducer(s, { type: "focus", key: b, generation: 2 });
  expect(s.maximized).toBeNull();
  expect(s.panels[key].rect).toEqual(rect);
  expect(s.panels[b].rect).toEqual(rect);
});
it("hydration detaches snapshot inputs and fences old revisions and generation exhaustion", () => {
  const snap = snapshot();
  const s = hydrateLayout(initialState(scope), snap);
  snap.panels[0].rect = { ...rect, x: 999 };
  snap.order.length = 0;
  expect(s.panels[key].rect).toEqual(rect);
  expect(s.order).toEqual([key]);
  expect(() => hydrateLayout(s, { ...snapshot(), revision: 3 })).toThrow(
    RangeError
  );
  expect(() =>
    hydrateLayout({ ...s, nextGeneration: Number.MAX_SAFE_INTEGER }, snapshot())
  ).toThrow(RangeError);
});
it("receipt mappings reject canonical/optimistic collisions instead of overwriting another panel", () => {
  const s = panelReducer(opened(), { ...open, ref: { ...ref, id: "b" } });
  const pending = [
    { scope, operationId: "op", operationIndex: 0, key, generation: 1 },
  ];
  const ack = {
    scope,
    operationId: "op",
    revision: 5,
    nextOpenedOrdinal: 3,
    opened: [{ operationIndex: 0, key, openedOrdinal: 2 }],
  };
  expect(reconcileOpeningAck(s, ack, pending)).toBe(s);
});
it("receipt requires complete ordered indexes including repeated existing opens", () => {
  const s = opened();
  const pending = [0, 2].map((operationIndex) => ({
    scope,
    operationId: "op",
    operationIndex,
    key,
    generation: 1,
  }));
  const ack = {
    scope,
    operationId: "op",
    revision: 5,
    nextOpenedOrdinal: 22,
    opened: [0, 2].map((operationIndex) => ({
      operationIndex,
      key,
      openedOrdinal: 21,
    })),
  };
  expect(reconcileOpeningAck(s, ack, pending).panels[key].openedOrdinal).toBe(
    21
  );
  expect(
    reconcileOpeningAck(
      s,
      { ...ack, opened: [...ack.opened].reverse() },
      pending
    )
  ).toBe(s);
  expect(
    reconcileOpeningAck(s, { ...ack, opened: ack.opened.slice(0, 1) }, pending)
  ).toBe(s);
});
it("prototype-bearing snapshots cannot fake order membership", () => {
  expect(() =>
    hydrateLayout(initialState(scope), {
      ...snapshot(),
      order: ["__proto__"],
      selected: "__proto__",
      maximized: "__proto__",
    })
  ).toThrow(RangeError);
});
it("receipt journal cannot smuggle a key from another scope or an invalid key", () => {
  const s = opened();
  for (const badKey of [
    "__proto__",
    panelKey({ ...scope, userId: "other" }, ref),
  ]) {
    const pending = [
      {
        scope,
        operationId: "op",
        operationIndex: 0,
        key: badKey,
        generation: 1,
      },
    ];
    const ack = {
      scope,
      operationId: "op",
      revision: 5,
      nextOpenedOrdinal: 22,
      opened: [{ operationIndex: 0, key: badKey, openedOrdinal: 21 }],
    };
    expect(reconcileOpeningAck(s, ack, pending)).toBe(s);
  }
});
