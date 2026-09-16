import { describe, expect, it } from "vitest";
import {
  layoutPatchSchema,
  layoutOpSchema,
  rectSchema,
  universeLayoutDocumentSchema,
  emptyUniverseLayoutDocument,
  UNIVERSE_LAYOUT_MAX_OPERATIONS,
  UNIVERSE_LAYOUT_MAX_ZOOM,
} from "../validators/universe-layout.js";

const rect = { x: 10, y: 20, width: 300, height: 200 };

describe("universe layout validators", () => {
  it("accepts a well-formed patch covering every operation kind", () => {
    const patch = {
      schemaVersion: 1,
      operationId: "op-1",
      expectedRevision: 0,
      operations: [
        { type: "open", key: "k1", ref: { kind: "task", id: "t1" }, rect },
        { type: "geometry", key: "k1", rect },
        { type: "pin", key: "k1", value: true },
        { type: "minimize", key: "k1", value: false },
        { type: "order", keys: ["k1", "k2"] },
        { type: "viewport", x: 5, y: 6, zoom: 1 },
        { type: "close", key: "k1" },
      ],
    };
    expect(layoutPatchSchema.safeParse(patch).success).toBe(true);
  });

  it("rejects unknown ops, extra keys, bad kinds and out-of-range geometry", () => {
    expect(layoutOpSchema.safeParse({ type: "resize", key: "k" }).success).toBe(
      false
    );
    expect(
      layoutOpSchema.safeParse({ type: "pin", key: "k", value: true, extra: 1 })
        .success
    ).toBe(false);
    expect(rectSchema.safeParse({ ...rect, width: 0 }).success).toBe(false);
    expect(rectSchema.safeParse({ ...rect, x: Infinity }).success).toBe(false);
    expect(
      layoutOpSchema.safeParse({
        type: "viewport",
        x: 0,
        y: 0,
        zoom: UNIVERSE_LAYOUT_MAX_ZOOM + 1,
      }).success
    ).toBe(false);
    expect(
      layoutOpSchema.safeParse({
        type: "open",
        key: "k",
        ref: { kind: "evil", id: "x" },
        rect,
      }).success
    ).toBe(false);
  });

  it("rejects an empty/oversized batch and a wrong schemaVersion", () => {
    const base = { schemaVersion: 1, operationId: "op", expectedRevision: 0 };
    expect(
      layoutPatchSchema.safeParse({ ...base, operations: [] }).success
    ).toBe(false);
    const many = Array.from({ length: UNIVERSE_LAYOUT_MAX_OPERATIONS + 1 }, () => ({
      type: "close",
      key: "k",
    }));
    expect(
      layoutPatchSchema.safeParse({ ...base, operations: many }).success
    ).toBe(false);
    expect(
      layoutPatchSchema.safeParse({
        ...base,
        schemaVersion: 2,
        operations: [{ type: "close", key: "k" }],
      }).success
    ).toBe(false);
  });

  it("validates the empty document and a populated one", () => {
    expect(
      universeLayoutDocumentSchema.safeParse(emptyUniverseLayoutDocument())
        .success
    ).toBe(true);
    const populated = {
      ...emptyUniverseLayoutDocument(),
      panels: [
        {
          ref: { companyId: "c", kind: "task", id: "t1" },
          title: "T",
          rect,
          openedOrdinal: 1,
          minimized: false,
          pinned: false,
          placement: "auto",
        },
      ],
      order: ["k1"],
    };
    expect(universeLayoutDocumentSchema.safeParse(populated).success).toBe(true);
  });
});
