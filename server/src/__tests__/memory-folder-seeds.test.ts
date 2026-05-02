import { describe, it, expect } from "vitest";
import {
  getSeedFoldersForFunctionType,
  COMPANY_SEED_FOLDERS,
} from "../services/memory-folder-seeds.js";

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
