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
// Mock live-events to avoid side-effect imports
vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: () => undefined,
}));

import {
  getSeedFoldersForFunctionType,
  COMPANY_SEED_FOLDERS,
} from "../services/memory-folder-seeds.js";
import { seedFoldersOnDepartmentCreate } from "../services/memory-folders.js";

describe("memory-folder-seeds", () => {
  it("returns engineering seed folders for software_development", () => {
    const seeds = getSeedFoldersForFunctionType("software_development");
    expect(seeds.map((s) => s.displayName)).toEqual([
      "Decisions",
      "Playbooks",
      "References",
      "Architecture",
      "Files",
    ]);
  });

  it("returns marketing seed folders", () => {
    const seeds = getSeedFoldersForFunctionType("marketing");
    expect(seeds.map((s) => s.displayName)).toEqual([
      "Decisions",
      "Brand",
      "Campaigns",
      "References",
      "Files",
    ]);
  });

  it("returns support seed folders", () => {
    const seeds = getSeedFoldersForFunctionType("customer_support");
    expect(seeds.map((s) => s.displayName)).toEqual([
      "Playbooks",
      "Macros",
      "References",
      "Files",
    ]);
  });

  it("returns generic seed folders for unknown function type", () => {
    const seeds = getSeedFoldersForFunctionType("totally_unknown");
    expect(seeds.map((s) => s.displayName)).toEqual([
      "Decisions",
      "Policies",
      "References",
      "Files",
    ]);
  });

  it("returns generic seed folders when functionType is null", () => {
    const seeds = getSeedFoldersForFunctionType(null);
    expect(seeds.map((s) => s.displayName)).toEqual([
      "Decisions",
      "Policies",
      "References",
      "Files",
    ]);
  });

  it("each seed has a stable seedKey for collision-safe creation", () => {
    const seeds = getSeedFoldersForFunctionType("software_development");
    expect(seeds.find((s) => s.displayName === "Decisions")?.seedKey).toBe(
      "software_development.decisions",
    );
  });

  it("COMPANY_SEED_FOLDERS exposes the company-root folder", () => {
    expect(COMPANY_SEED_FOLDERS).toEqual([
      { path: "Company", displayName: "Company", seedKey: "company.root", icon: "🏛️" },
    ]);
  });
});

describe("seedFoldersOnDepartmentCreate", () => {
  it("seeds folders for newly-created department", async () => {
    const seedSpy = vi.fn(async () => []);
    const fakeSvc = { seedForDepartment: seedSpy };
    await seedFoldersOnDepartmentCreate(fakeSvc as never, {
      companyId: "co-1",
      project: {
        id: "p-1",
        type: "department",
        name: "Engineering",
        urlKey: "engineering",
        functionType: "software_development",
      },
    });
    expect(seedSpy).toHaveBeenCalledWith({
      companyId: "co-1",
      departmentId: "p-1",
      departmentSlug: "engineering",
      functionType: "software_development",
    });
  });

  it("does NOT seed folders for non-department projects", async () => {
    const seedSpy = vi.fn();
    const fakeSvc = { seedForDepartment: seedSpy };
    await seedFoldersOnDepartmentCreate(fakeSvc as never, {
      companyId: "co-1",
      project: { id: "p-1", type: "project", name: "X", urlKey: "x", functionType: null },
    });
    expect(seedSpy).not.toHaveBeenCalled();
  });
});
