import { describe, it, expect } from "vitest";
import type { HomeBoardLayoutItem } from "@armyofagents/shared";
import { HOME_BOARD_LG_COLS } from "@armyofagents/shared";
import { buildDefaultLg, reconcileLg, projectToBreakpoint } from "../../components/home/gridLayout";
import { getDefaultLayout } from "../../components/home/defaultLayout";
import { widgetRegistry } from "../../components/home/widgets/registry";

function assertNoOverlap(layout: readonly HomeBoardLayoutItem[]) {
  for (let a = 0; a < layout.length; a++) {
    for (let b = a + 1; b < layout.length; b++) {
      const itemA = layout[a]!;
      const itemB = layout[b]!;
      const overlapsX = itemA.x < itemB.x + itemB.w && itemB.x < itemA.x + itemA.w;
      const overlapsY = itemA.y < itemB.y + itemB.h && itemB.y < itemA.y + itemA.h;
      expect(overlapsX && overlapsY).toBe(false);
    }
  }
}

function assertInBounds(layout: readonly HomeBoardLayoutItem[], cols: number) {
  for (const item of layout) {
    expect(item.x).toBeGreaterThanOrEqual(0);
    expect(item.y).toBeGreaterThanOrEqual(0);
    expect(item.x + item.w).toBeLessThanOrEqual(cols);
  }
}

describe("buildDefaultLg", () => {
  it("packs every widget from getDefaultLayout(role) with no overlaps, within 4-col bounds", () => {
    const lg = buildDefaultLg("founder");
    expect(lg.map((item) => item.i)).toEqual(getDefaultLayout("founder"));
    assertNoOverlap(lg);
    assertInBounds(lg, HOME_BOARD_LG_COLS);
  });

  it("packs the member board (a different key set/order) with no overlaps too", () => {
    const lg = buildDefaultLg("team_member");
    expect(lg.map((item) => item.i)).toEqual(getDefaultLayout("team_member"));
    assertNoOverlap(lg);
    assertInBounds(lg, HOME_BOARD_LG_COLS);
  });

  it("is deterministic — calling it twice for the same role gives an identical layout", () => {
    expect(buildDefaultLg("founder")).toEqual(buildDefaultLg("founder"));
    expect(buildDefaultLg("team_member")).toEqual(buildDefaultLg("team_member"));
  });

  it("places every widget at its registry defaultSize", () => {
    const lg = buildDefaultLg("founder");
    for (const item of lg) {
      const def = widgetRegistry[item.i];
      expect({ w: item.w, h: item.h }).toEqual(def.defaultSize);
    }
  });
});

describe("reconcileLg", () => {
  it("drops items whose key is not currently registered", () => {
    const saved: HomeBoardLayoutItem[] = [
      { i: "my-tasks", x: 0, y: 0, w: 2, h: 1 },
      { i: "retired-widget" as HomeBoardLayoutItem["i"], x: 2, y: 0, w: 2, h: 1 },
    ];
    const result = reconcileLg(saved, "founder");
    expect(result.map((item) => item.i)).toEqual(["my-tasks"]);
  });

  it("returns an empty layout (not the role default) when every saved key is unknown", () => {
    const saved: HomeBoardLayoutItem[] = [{ i: "nope" as HomeBoardLayoutItem["i"], x: 0, y: 0, w: 1, h: 1 }];
    expect(reconcileLg(saved, "founder")).toEqual([]);
  });

  it("clamps an out-of-range saved size to the nearest allowed size for that widget", () => {
    // agents-now only allows [{w:1,h:1},{w:2,h:1}] — {w:4,h:3} is not among them.
    const saved: HomeBoardLayoutItem[] = [{ i: "agents-now", x: 0, y: 0, w: 4, h: 3 }];
    const [result] = reconcileLg(saved, "founder");
    expect(result).toBeDefined();
    expect(widgetRegistry["agents-now"].allowedSizes).toContainEqual({ w: result!.w, h: result!.h });
  });

  it("clamps to the exact nearest entry (agents-now {w:2,h:2} -> {w:2,h:1}, not {w:1,h:1})", () => {
    const saved: HomeBoardLayoutItem[] = [{ i: "agents-now", x: 0, y: 0, w: 2, h: 2 }];
    const [result] = reconcileLg(saved, "founder");
    expect({ w: result!.w, h: result!.h }).toEqual({ w: 2, h: 1 });
  });

  it("leaves an already-allowed size untouched", () => {
    const saved: HomeBoardLayoutItem[] = [{ i: "budget", x: 1, y: 0, w: 1, h: 1 }];
    expect(reconcileLg(saved, "founder")).toEqual(saved);
  });

  it("never auto-adds a widget missing from the saved layout, even though the role default includes it", () => {
    const saved: HomeBoardLayoutItem[] = [{ i: "my-tasks", x: 0, y: 0, w: 2, h: 1 }];
    // founder's default board has 8 widgets; saved membership must win.
    const result = reconcileLg(saved, "founder");
    expect(result).toHaveLength(1);
    expect(result[0]!.i).toBe("my-tasks");
  });

  it("preserves saved position/size when clamping introduces no overlap", () => {
    const saved: HomeBoardLayoutItem[] = [
      { i: "my-tasks", x: 0, y: 0, w: 2, h: 1 },
      { i: "budget", x: 2, y: 0, w: 1, h: 1 },
    ];
    expect(reconcileLg(saved, "founder")).toEqual(saved);
  });

  it("re-packs deterministically (no overlap, in-bounds) when a clamp collides with a neighbor", () => {
    // budget's allowedSizes are [{w:1,h:1},{w:2,h:1}]; saving an invalid
    // {w:3,h:1} clamps to the nearest, {w:2,h:1}, which now overlaps the
    // neighboring agents-now tile at x:2.
    const saved: HomeBoardLayoutItem[] = [
      { i: "budget", x: 0, y: 0, w: 3, h: 1 },
      { i: "agents-now", x: 2, y: 0, w: 1, h: 1 },
    ];
    const result = reconcileLg(saved, "founder");
    expect(result.map((item) => item.i).sort()).toEqual(["agents-now", "budget"]);
    assertNoOverlap(result);
    assertInBounds(result, HOME_BOARD_LG_COLS);
    // Deterministic: re-running on the same input gives the same output.
    expect(reconcileLg(saved, "founder")).toEqual(result);
  });

  it("never adds a widget even when a clamp forces a re-pack", () => {
    const saved: HomeBoardLayoutItem[] = [
      { i: "budget", x: 0, y: 0, w: 3, h: 1 },
      { i: "agents-now", x: 2, y: 0, w: 1, h: 1 },
    ];
    const result = reconcileLg(saved, "founder");
    expect(result).toHaveLength(2);
  });
});

describe("projectToBreakpoint", () => {
  it("clamps width to the column count and preserves lg order", () => {
    const lg: HomeBoardLayoutItem[] = [
      { i: "action-queue", x: 0, y: 0, w: 2, h: 1 },
      { i: "budget", x: 2, y: 0, w: 1, h: 1 },
    ];
    const md = projectToBreakpoint(lg, 2);
    expect(md.map((item) => item.i)).toEqual(["action-queue", "budget"]);
    assertNoOverlap(md);
    assertInBounds(md, 2);
  });

  it("a w:2 tile becomes w:1 on sm (cols=1)", () => {
    const lg: HomeBoardLayoutItem[] = [{ i: "action-queue", x: 0, y: 0, w: 2, h: 1 }];
    const sm = projectToBreakpoint(lg, 1);
    expect(sm).toEqual([{ i: "action-queue", x: 0, y: 0, w: 1, h: 1 }]);
  });

  it("re-flows the full founder board into 2 columns (md) with no overlaps", () => {
    const lg = buildDefaultLg("founder");
    const md = projectToBreakpoint(lg, 2);
    expect(md).toHaveLength(lg.length);
    expect(md.map((item) => item.i)).toEqual(lg.map((item) => item.i));
    assertNoOverlap(md);
    assertInBounds(md, 2);
  });

  it("re-flows the full founder board into 1 column (sm) with no overlaps", () => {
    const lg = buildDefaultLg("founder");
    const sm = projectToBreakpoint(lg, 1);
    expect(sm).toHaveLength(lg.length);
    assertNoOverlap(sm);
    assertInBounds(sm, 1);
    // Every tile stacks in its own row on a single column.
    for (const item of sm) expect(item.w).toBe(1);
  });

  it("is deterministic for a given lg + cols", () => {
    const lg = buildDefaultLg("founder");
    expect(projectToBreakpoint(lg, 2)).toEqual(projectToBreakpoint(lg, 2));
    expect(projectToBreakpoint(lg, 1)).toEqual(projectToBreakpoint(lg, 1));
  });
});

describe("canonical lg round-trip (Task D1)", () => {
  // Only the lg array is ever persisted (useHomeBoardLayout.save posts exactly
  // what useBoardEdit's draft holds, which is always lg-shaped). "Reload" is
  // simulated by feeding the saved lg straight back through reconcileLg, the
  // same step HomeBoard/useBoardEdit takes for a freshly-fetched saved
  // layout — the round trip must be lossless when nothing about the registry
  // has changed since save.
  it("save -> reload (reconcileLg) reproduces an identical lg for the founder default board", () => {
    const saved = buildDefaultLg("founder");
    const reloaded = reconcileLg(saved, "founder");
    expect(reloaded).toEqual(saved);
  });

  it("save -> reload (reconcileLg) reproduces an identical lg for a custom (subset/reordered) layout", () => {
    const saved: HomeBoardLayoutItem[] = [
      { i: "budget", x: 0, y: 0, w: 1, h: 1 },
      { i: "my-tasks", x: 1, y: 0, w: 2, h: 1 },
      { i: "agents-now", x: 3, y: 0, w: 1, h: 1 },
    ];
    const reloaded = reconcileLg(saved, "founder");
    expect(reloaded).toEqual(saved);
  });

  it("md/sm are pure derivations of lg — never persisted, always recomputed from the same lg", () => {
    const lg = buildDefaultLg("founder");

    // "Pure derivation" means: given the same lg + cols, the projection is
    // always the same value (no hidden state, no persistence round-trip
    // needed to reproduce it) — re-deriving from a round-tripped
    // (save->reload) lg gives byte-identical md/sm to deriving straight from
    // the original.
    const reloaded = reconcileLg(lg, "founder");
    expect(projectToBreakpoint(reloaded, 2)).toEqual(projectToBreakpoint(lg, 2));
    expect(projectToBreakpoint(reloaded, 1)).toEqual(projectToBreakpoint(lg, 1));
  });
});
