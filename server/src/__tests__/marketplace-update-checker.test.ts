import { describe, it, expect, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Install stubs before the SUT import to prevent the drizzle ESM cycle.

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) => {
    const cols: Record<string, symbol> = {};
    return new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") {
          if (!cols[prop]) cols[prop] = Symbol(`${name}.${prop}`);
          return cols[prop];
        }
        return undefined;
      },
    });
  };
  return {
    companies: makeTable("companies"),
    companySkills: makeTable("company_skills"),
    marketplacePendingUpdates: makeTable("marketplace_pending_updates"),
  };
});

import { compareVersions, isUpdateAvailable } from "../services/marketplace-update-checker.js";

describe("compareVersions", () => {
  it("returns 1 when latest > current", () => {
    expect(compareVersions("1.1.0", "1.0.0")).toBe(1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
  });

  it("returns 0 when equal", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("returns -1 when latest < current", () => {
    expect(compareVersions("1.0.0", "1.1.0")).toBe(-1);
  });
});

describe("isUpdateAvailable", () => {
  it("returns true when minor/patch update available for auto_minor policy", () => {
    expect(isUpdateAvailable("1.0.0", "1.1.0", "auto_minor")).toBe(true);
    expect(isUpdateAvailable("1.0.0", "1.0.1", "auto_minor")).toBe(true);
  });

  it("returns false when major update and policy is auto_minor", () => {
    expect(isUpdateAvailable("1.0.0", "2.0.0", "auto_minor")).toBe(false);
  });

  it("returns true for any update when policy is notify", () => {
    expect(isUpdateAvailable("1.0.0", "2.0.0", "notify")).toBe(true);
    expect(isUpdateAvailable("1.0.0", "1.1.0", "notify")).toBe(true);
  });

  it("auto_patch: allows patch, blocks minor and major", () => {
    // Patch update: same major.minor, different patch — allowed
    expect(isUpdateAvailable("1.0.0", "1.0.1", "auto_patch")).toBe(true);
    // Minor update: same major, different minor — blocked
    expect(isUpdateAvailable("1.0.0", "1.1.0", "auto_patch")).toBe(false);
    // Major update: blocked
    expect(isUpdateAvailable("1.0.0", "2.0.0", "auto_patch")).toBe(false);
  });

  it("returns false when versions are equal", () => {
    expect(isUpdateAvailable("1.0.0", "1.0.0", "notify")).toBe(false);
    expect(isUpdateAvailable("1.0.0", "1.0.0", "auto_minor")).toBe(false);
  });
});
