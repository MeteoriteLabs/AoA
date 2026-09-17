import { describe, expect, it } from "vitest";
import {
  applyLayoutOp,
  applyLayoutOperations,
  hashLayoutOperations,
  type UniverseScope,
} from "../services/universe-layout-document.js";
import {
  emptyUniverseLayoutDocument,
  type LayoutOp,
} from "@armyofagents/shared";

const scope: UniverseScope = {
  companyId: "c1",
  userId: "u1",
  conversationId: "conv1",
};
const rect = { x: 0, y: 0, width: 300, height: 200 };
const openOp = (key: string): LayoutOp => ({
  type: "open",
  key,
  ref: { kind: "task", id: key },
  rect,
  title: key,
});

describe("universe layout reducer", () => {
  it("open creates a panel, foregrounds it and increments the ordinal", () => {
    const doc = applyLayoutOp(
      emptyUniverseLayoutDocument(),
      openOp("k1"),
      scope,
    );
    expect(doc.panels).toHaveLength(1);
    expect(doc.panels[0]).toMatchObject({
      key: "k1",
      ref: { companyId: "c1", kind: "task", id: "k1" },
      openedOrdinal: 1,
      placement: "auto",
    });
    expect(doc.order).toEqual(["k1"]);
    expect(doc.selected).toBe("k1");
    expect(doc.nextOpenedOrdinal).toBe(2);
  });

  it("re-opening un-minimizes and foregrounds without duplicating", () => {
    let doc = applyLayoutOperations(
      emptyUniverseLayoutDocument(),
      [openOp("k1"), openOp("k2")],
      scope,
    );
    doc = applyLayoutOp(doc, { type: "minimize", key: "k1", value: true }, scope);
    expect(doc.panels.find((p) => p.key === "k1")!.minimized).toBe(true);
    doc = applyLayoutOp(doc, openOp("k1"), scope);
    expect(doc.panels).toHaveLength(2);
    expect(doc.panels.find((p) => p.key === "k1")!.minimized).toBe(false);
    expect(doc.order.at(-1)).toBe("k1");
    expect(doc.selected).toBe("k1");
  });

  it("geometry, pin, minimize and close on an unknown panel are rejected", () => {
    const doc = emptyUniverseLayoutDocument();
    for (const op of [
      { type: "geometry", key: "x", rect },
      { type: "pin", key: "x", value: true },
      { type: "minimize", key: "x", value: true },
      { type: "close", key: "x" },
    ] as LayoutOp[])
      expect(() => applyLayoutOp(doc, op, scope)).toThrow();
  });

  it("close removes the panel and clears order/selection", () => {
    let doc = applyLayoutOperations(
      emptyUniverseLayoutDocument(),
      [openOp("k1"), openOp("k2")],
      scope,
    );
    doc = applyLayoutOp(doc, { type: "close", key: "k2" }, scope);
    expect(doc.panels.map((p) => p.key)).toEqual(["k1"]);
    expect(doc.order).toEqual(["k1"]);
    expect(doc.selected).toBeNull();
  });

  it("order must be an exact permutation of the open panels", () => {
    const doc = applyLayoutOperations(
      emptyUniverseLayoutDocument(),
      [openOp("k1"), openOp("k2")],
      scope,
    );
    expect(
      applyLayoutOp(doc, { type: "order", keys: ["k2", "k1"] }, scope).order,
    ).toEqual(["k2", "k1"]);
    for (const keys of [["k1"], ["k1", "k1"], ["k1", "x"]])
      expect(() =>
        applyLayoutOp(doc, { type: "order", keys }, scope),
      ).toThrow();
  });

  it("viewport updates the camera; hashing is stable and payload-sensitive", () => {
    const doc = applyLayoutOp(
      emptyUniverseLayoutDocument(),
      { type: "viewport", x: 5, y: 6, zoom: 2 },
      scope,
    );
    expect(doc.viewport).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(hashLayoutOperations([openOp("k1")])).toBe(
      hashLayoutOperations([openOp("k1")]),
    );
    expect(hashLayoutOperations([openOp("k1")])).not.toBe(
      hashLayoutOperations([openOp("k2")]),
    );
  });
});
