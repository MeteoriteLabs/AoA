import { describe, it, expect } from "vitest";
import {
  groupCardsBySection,
  selectVisibleCards,
  selectVisibleSectionGroups,
  type CockpitCardDef,
} from "./cockpitCardModel";

const RUNNING_CARD: CockpitCardDef = {
  id: "running",
  title: "Running now",
  defaultOn: true,
  sectionId: "company_pulse",
};
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
    const cardA: CockpitCardDef = { id: "a", title: "A", defaultOn: true, sectionId: "needs_me" };
    const cardB: CockpitCardDef = { id: "b", title: "B", defaultOn: true, sectionId: "my_work" };
    const result = selectVisibleCards({
      registry: [cardA, cardB],
      hidden: [],
      order: ["b", "a"],
      active: { a: true, b: true },
    });
    expect(result.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("defaultOn=false excludes card even when active", () => {
    const offCard: CockpitCardDef = { id: "off", title: "Off", defaultOn: false, sectionId: "context" };
    const result = selectVisibleCards({
      registry: [offCard],
      hidden: [],
      order: [],
      active: { off: true },
    });
    expect(result).toHaveLength(0);
  });

  it("defaultOn=false card IS shown when its id is in enabled", () => {
    const offCard: CockpitCardDef = { id: "off", title: "Off", defaultOn: false, sectionId: "context" };
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

describe("Cockpit card sections", () => {
  const SECTION_REGISTRY: CockpitCardDef[] = [
    { id: "approvals", title: "Approvals", defaultOn: true, sectionId: "needs_me" },
    { id: "myTasks", title: "My tasks", defaultOn: true, sectionId: "my_work" },
    { id: "discussions", title: "Discussions", defaultOn: true, sectionId: "active_with_me" },
    { id: "running", title: "Running now", defaultOn: true, sectionId: "company_pulse" },
    { id: "pinned", title: "Pinned", defaultOn: true, sectionId: "context" },
  ];

  it("groups cards by the fixed cockpit section order", () => {
    const result = groupCardsBySection(SECTION_REGISTRY);
    expect(result.map((group) => group.section.id)).toEqual([
      "needs_me",
      "my_work",
      "active_with_me",
      "company_pulse",
      "context",
    ]);
    expect(result[0].cards.map((card) => card.id)).toEqual(["approvals"]);
  });

  it("selects visible card groups and skips empty sections", () => {
    const result = selectVisibleSectionGroups({
      registry: SECTION_REGISTRY,
      hidden: [],
      order: [],
      active: {
        approvals: false,
        myTasks: true,
        discussions: false,
        running: true,
        pinned: false,
      },
      enabled: [],
    });

    expect(result.map((group) => group.section.id)).toEqual(["my_work", "company_pulse"]);
    expect(result.flatMap((group) => group.cards.map((card) => card.id))).toEqual(["myTasks", "running"]);
  });
});
