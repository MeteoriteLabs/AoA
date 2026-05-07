import { describe, it, expect } from "vitest";
import { PLUGIN_CAPABILITIES, CAPABILITY_DESCRIPTIONS } from "../constants.js";
import type { PluginCapability } from "../constants.js";

describe("CAPABILITY_DESCRIPTIONS", () => {
  it("has a description for every capability in PLUGIN_CAPABILITIES", () => {
    for (const cap of PLUGIN_CAPABILITIES) {
      expect(
        CAPABILITY_DESCRIPTIONS[cap],
        `Missing description for capability: ${cap}`
      ).toBeTruthy();
    }
  });

  it("has no extra keys beyond PLUGIN_CAPABILITIES", () => {
    const capSet = new Set<string>(PLUGIN_CAPABILITIES);
    for (const key of Object.keys(CAPABILITY_DESCRIPTIONS)) {
      expect(capSet.has(key), `Unexpected key in CAPABILITY_DESCRIPTIONS: ${key}`).toBe(true);
    }
  });
});
