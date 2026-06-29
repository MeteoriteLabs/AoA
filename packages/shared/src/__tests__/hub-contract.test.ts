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

describe("hub contract", () => {
  it("every semantic type maps to exactly one valid lane", () => {
    for (const t of HUB_SEMANTIC_TYPES) {
      const lane = HUB_SEMANTIC_TO_LANE[t];
      expect(HUB_LANES, `${t} -> ${lane}`).toContain(lane);
      expect(laneForSemanticType(t)).toBe(lane);
    }
  });
  it("reserves the W5 runtime-decision type without a UI bridge yet", () => {
    expect(HUB_SEMANTIC_TYPES).toContain("agent_runtime_decision");
    expect(HUB_SEMANTIC_TO_LANE.agent_runtime_decision).toBe("waiting_on_you");
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
});
