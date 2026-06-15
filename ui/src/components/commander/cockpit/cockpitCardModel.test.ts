import { describe, it, expect } from "vitest";
import { selectVisibleCards, type CockpitCardDef } from "./cockpitCardModel";

const RUNNING_CARD: CockpitCardDef = { id: "running", title: "Running now", defaultOn: true };
const REGISTRY = [RUNNING_CARD];

describe("selectVisibleCards", () => {
  it("empty active -> no cards shown", () => {
    const result = selectVisibleCards({ registry: REGISTRY, hidden: [], order: [], active: {} });
    expect(result).toHaveLength(0);
  });

  it("active.running=true -> running card shown", () => {
    const result = selectVisibleCards({ registry: REGISTRY, hidden: [], order: [], active: { running: true } });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("running");
  });

  it("hidden:['running'] -> hidden even when active", () => {
    const result = selectVisibleCards({ registry: REGISTRY, hidden: ["running"], order: [], active: { running: true } });
    expect(result).toHaveLength(0);
  });

  it("order reorders multiple cards", () => {
    const cardA: CockpitCardDef = { id: "a", title: "A", defaultOn: true };
    const cardB: CockpitCardDef = { id: "b", title: "B", defaultOn: true };
    const result = selectVisibleCards({
      registry: [cardA, cardB],
      hidden: [],
      order: ["b", "a"],
      active: { a: true, b: true },
    });
    expect(result.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("defaultOn=false excludes card even when active", () => {
    const offCard: CockpitCardDef = { id: "off", title: "Off", defaultOn: false };
    const result = selectVisibleCards({
      registry: [offCard],
      hidden: [],
      order: [],
      active: { off: true },
    });
    expect(result).toHaveLength(0);
  });

  it("defaultOn=false card IS shown when its id is in enabled", () => {
    const offCard: CockpitCardDef = { id: "off", title: "Off", defaultOn: false };
    const result = selectVisibleCards({
      registry: [offCard],
      hidden: [],
      order: [],
      active: { off: true },
      enabled: ["off"],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("off");
  });
});
