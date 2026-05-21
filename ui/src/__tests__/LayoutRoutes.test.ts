import { describe, expect, it } from "vitest";
import { shouldUseFullBleedMain } from "../components/Layout";

describe("Layout route padding", () => {
  it("keeps top-level operational sections full bleed", () => {
    expect(shouldUseFullBleedMain("/AOA/settings", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/settings?tab=general", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/memory", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/skills", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/workspaces/abc-123", "AOA")).toBe(true);
  });

  it("does not make nested project tabs full bleed", () => {
    expect(shouldUseFullBleedMain("/AOA/projects/engineering/settings", "AOA")).toBe(false);
    expect(shouldUseFullBleedMain("/AOA/projects/engineering/workspaces", "AOA")).toBe(false);
    expect(shouldUseFullBleedMain("/AOA/projects/engineering/overview", "AOA")).toBe(false);
  });
});
