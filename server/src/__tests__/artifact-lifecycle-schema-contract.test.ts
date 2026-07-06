import { describe, it, expect } from "vitest";
import { artifactVersions } from "@armyofagents/db";

/** Drizzle column names off a table object (mirrors threads-schema-contract.test.ts). */
function getColumnNames(table: Record<string, unknown>): string[] {
  return Object.keys(table).filter(
    (key) =>
      typeof table[key] === "object" &&
      table[key] !== null &&
      "name" in (table[key] as Record<string, unknown>),
  );
}

describe("artifact_versions — file-metadata columns (Artifact Lifecycle P1)", () => {
  const cols = getColumnNames(artifactVersions);

  it("has the 7 additive file-metadata columns", () => {
    for (const c of ["storageKind", "assetId", "filename", "contentType", "extension", "byteSize", "sha256"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("preserves the existing version columns", () => {
    for (const c of ["id", "artifactId", "versionNumber", "source", "content", "fileUrl"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });
});
