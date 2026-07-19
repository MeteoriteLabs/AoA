import { describe, expect, it } from "vitest";
import { shouldUseFullBleedMain } from "../components/Layout";

describe("Layout route padding", () => {
  it("keeps top-level operational sections full bleed", () => {
    expect(shouldUseFullBleedMain("/AOA/settings", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/settings?tab=general", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/memory", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/skills", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/team", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/team?tab=aoa&aoaTab=tasks", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/workspaces/abc-123", "AOA")).toBe(true);
    // Threads continuum (browse + detail) is edge-to-edge.
    expect(shouldUseFullBleedMain("/AOA/discussions", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/discussions/abc-123", "AOA")).toBe(true);
    expect(shouldUseFullBleedMain("/AOA/threads/abc-123", "AOA")).toBe(true);
  });

  it("does not make nested project tabs full bleed", () => {
    expect(shouldUseFullBleedMain("/AOA/projects/engineering/settings", "AOA")).toBe(false);
    expect(shouldUseFullBleedMain("/AOA/projects/engineering/workspaces", "AOA")).toBe(false);
    expect(shouldUseFullBleedMain("/AOA/projects/engineering/overview", "AOA")).toBe(false);
    expect(shouldUseFullBleedMain("/AOA/team/local-board", "AOA")).toBe(false);
    expect(shouldUseFullBleedMain("/AOA/team/teams/founding", "AOA")).toBe(false);
    expect(shouldUseFullBleedMain("/AOA/team/aoa/agent-1", "AOA")).toBe(false);
  });

  it("WS9: Home is full-bleed only while the first-run takeover is active", () => {
    expect(shouldUseFullBleedMain("/AOA/home", "AOA")).toBe(false);
    expect(shouldUseFullBleedMain("/AOA/home", "AOA", { firstRunHomeActive: false })).toBe(false);
    expect(shouldUseFullBleedMain("/AOA/home", "AOA", { firstRunHomeActive: true })).toBe(true);
    // `firstRunHomeActive` only affects the "home" section — it doesn't
    // spuriously full-bleed unrelated, already-non-full-bleed sections.
    expect(shouldUseFullBleedMain("/AOA/tasks", "AOA", { firstRunHomeActive: true })).toBe(false);
  });
});
