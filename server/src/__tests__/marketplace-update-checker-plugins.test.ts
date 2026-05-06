import { describe, it, expect } from "vitest";

// Import the pure compareVersions helper (already exists in update-checker)
import { compareVersions } from "../services/marketplace-update-checker.js";

describe("compareVersions", () => {
  it("returns 1 when latest is newer", () => {
    expect(compareVersions("1.0.0", "0.1.1")).toBe(1);
  });
  it("returns 0 when equal", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("returns -1 when latest is older", () => {
    expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
  });
});
