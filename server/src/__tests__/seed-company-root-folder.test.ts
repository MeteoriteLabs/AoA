import { describe, it, expect, vi } from "vitest";

// Mock drizzle dependencies so importing memory-folders.ts doesn't trigger the ESM cycle.
vi.mock("@armyofagents/db", () => ({
  memoryFolders: new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  isNull: (a: unknown) => ({ op: "isNull", a }),
}));
vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: () => undefined,
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ info: () => undefined, warn: () => undefined }) },
}));

import { seedCompanyRootFolder } from "../services/memory-folders.js";

describe("seedCompanyRootFolder", () => {
  it("creates the Company folder for a new company", async () => {
    const createSpy = vi.fn(async () => ({ id: "f-1", path: "Company" }));
    const fakeSvc = { create: createSpy };
    await seedCompanyRootFolder(fakeSvc as never, { companyId: "co-1" });
    expect(createSpy).toHaveBeenCalledWith({
      companyId: "co-1",
      departmentId: null,
      path: "Company",
      displayName: "Company",
      icon: "🏛️",
      seedKey: "company.root",
    });
  });

  it("is idempotent — does not throw on duplicate seed", async () => {
    // The unique index on (companyId, path) will reject the second insert; the
    // helper catches and treats as "already seeded".
    const createSpy = vi.fn(async () => {
      throw new Error("duplicate key value violates unique constraint \"memory_folders_unique_path_per_company\"");
    });
    const fakeSvc = { create: createSpy };
    // Should not throw.
    await expect(
      seedCompanyRootFolder(fakeSvc as never, { companyId: "co-1" }),
    ).resolves.toBeUndefined();
  });
});
