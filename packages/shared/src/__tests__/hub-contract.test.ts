// packages/shared/src/__tests__/hub-contract.test.ts
import { describe, it, expect } from "vitest";
import {
  HUB_LANES,
  HUB_ITEM_STATUSES,
  HUB_SEMANTIC_TYPES,
  HUB_SEMANTIC_TO_LANE,
  HUB_AUTHORITY_BY_TYPE,
  laneForSemanticType,
  authorityForSemanticType,
} from "../hub.js";
import { listHubItemsQuery } from "../validators/hub.js";

describe("hub contract", () => {
  it("every semantic type maps to exactly one valid lane", () => {
    for (const t of HUB_SEMANTIC_TYPES) {
      const lane = HUB_SEMANTIC_TO_LANE[t];
      expect(HUB_LANES, `${t} -> ${lane}`).toContain(lane);
      expect(laneForSemanticType(t)).toBe(lane);
    }
  });
  it("reserves the W5 runtime-decision type without a UI bridge yet", () => {
    // W5 reserve-don't-build boundary: the runtime-decision type exists in the
    // contract, lands in the "waiting_on_you" lane, and is gated to founder
    // authority — but W1a ships NO adapter bridge for it (master scope §10/§18).
    expect(HUB_SEMANTIC_TYPES).toContain("agent_runtime_decision");
    expect(HUB_SEMANTIC_TO_LANE.agent_runtime_decision).toBe("waiting_on_you");
    expect(HUB_AUTHORITY_BY_TYPE.agent_runtime_decision).toBe("founder");
    expect(authorityForSemanticType("agent_runtime_decision")).toBe("founder");
  });
  it("statuses are the three terminal-distinct lifecycle states + open", () => {
    expect(HUB_ITEM_STATUSES).toEqual(["open", "snoozed", "resolved", "archived"]);
  });
  it("every semantic type has an authority (HUB_AUTHORITY_BY_TYPE is total)", () => {
    for (const t of HUB_SEMANTIC_TYPES) {
      const authority = HUB_AUTHORITY_BY_TYPE[t];
      expect(["founder", "owner"], `${t} -> ${authority}`).toContain(authority);
      expect(authorityForSemanticType(t)).toBe(authority);
    }
  });
  it("approval_request requires founder authority", () => {
    expect(authorityForSemanticType("approval_request")).toBe("founder");
  });
  it("list query limit defaults to 50 and caps at 50", () => {
    expect(listHubItemsQuery.parse({}).limit).toBe(50);
    expect(listHubItemsQuery.parse({ limit: "25" }).limit).toBe(25);
    expect(() => listHubItemsQuery.parse({ limit: "51" })).toThrow();
  });
});
