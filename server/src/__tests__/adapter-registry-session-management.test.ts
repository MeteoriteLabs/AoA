import { describe, expect, it } from "vitest";
import { findServerAdapter, listServerAdapters } from "../adapters/registry.js";

describe("adapter registry session management", () => {
  it("normalizes known sessioned built-ins with adapter-utils defaults", () => {
    const claude = findServerAdapter("claude_local");
    expect(claude?.sessionManagement?.supportsSessionResume).toBe(true);
  });

  it("does not invent session management for non-sessioned adapters", () => {
    const process = findServerAdapter("process");
    expect(process?.sessionManagement).toBeUndefined();
  });

  it("listServerAdapters returns normalized built-ins", () => {
    const claude = listServerAdapters().find((adapter) => adapter.type === "claude_local");
    expect(claude?.sessionManagement?.nativeContextManagement).toBe("confirmed");
  });
});
