import { describe, it, expect } from "vitest";
import {
  MEMORY_ITEM_STATUSES,
  MEMORY_ITEM_LAYERS,
  MEMORY_ITEM_CATEGORIES,
} from "@armyofagents/shared";
import { STATUS_TONE, LAYER_TONE, CATEGORY_TONE } from "../memoryItemView";

describe("memoryItemView tone maps", () => {
  it("STATUS_TONE covers every shared status", () => {
    for (const status of MEMORY_ITEM_STATUSES) {
      expect(STATUS_TONE[status]).toBeDefined();
    }
  });

  it("LAYER_TONE covers every shared layer", () => {
    for (const layer of MEMORY_ITEM_LAYERS) {
      expect(LAYER_TONE[layer]).toBeDefined();
    }
  });

  it("CATEGORY_TONE covers every shared category", () => {
    for (const cat of MEMORY_ITEM_CATEGORIES) {
      expect(CATEGORY_TONE[cat]).toBeDefined();
    }
  });
});
