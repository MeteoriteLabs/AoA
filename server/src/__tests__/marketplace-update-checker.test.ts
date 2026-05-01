import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../services/marketplace-notifications.js", () => ({
  marketplaceNotifications: {
    updateAvailable: vi.fn().mockResolvedValue(undefined),
  },
}));

import { compareVersions, isUpdateAvailable, upsertPendingUpdate } from "../services/marketplace-update-checker.js";
import { marketplaceNotifications } from "../services/marketplace-notifications.js";

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

describe("upsertPendingUpdate", () => {
  function makeDb(insertRows: Array<{ id: string }>) {
    return {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(insertRows),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    } as unknown as Parameters<typeof upsertPendingUpdate>[0];
  }

  beforeEach(() => {
    vi.mocked(marketplaceNotifications.updateAvailable).mockClear();
  });

  it("fires updateAvailable notification when a new row is inserted", async () => {
    const db = makeDb([{ id: "new-uuid" }]);
    await upsertPendingUpdate(db, "company-1", {
      catalogItemId: "item-1",
      catalogItemName: "My Skill",
      itemType: "skill",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
    });
    // Flush microtasks so the fire-and-forget promise runs
    await Promise.resolve();
    expect(marketplaceNotifications.updateAvailable).toHaveBeenCalledOnce();
    expect(marketplaceNotifications.updateAvailable).toHaveBeenCalledWith(
      db,
      "company-1",
      "My Skill",
      "1.0.0",
      "1.1.0",
    );
  });

  it("does NOT fire updateAvailable notification when the row already exists (conflict)", async () => {
    const db = makeDb([]); // onConflictDoNothing returned nothing
    await upsertPendingUpdate(db, "company-1", {
      catalogItemId: "item-1",
      catalogItemName: "My Skill",
      itemType: "skill",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
    });
    await Promise.resolve();
    expect(marketplaceNotifications.updateAvailable).not.toHaveBeenCalled();
  });

  it("does NOT call DB when latestVersion <= currentVersion", async () => {
    const db = makeDb([{ id: "should-not-be-called" }]);
    await upsertPendingUpdate(db, "company-1", {
      catalogItemId: "item-1",
      catalogItemName: "My Skill",
      itemType: "skill",
      currentVersion: "1.1.0",
      latestVersion: "1.0.0", // older — should early-return
    });
    await Promise.resolve();
    expect(marketplaceNotifications.updateAvailable).not.toHaveBeenCalled();
  });
});
