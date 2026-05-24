import { describe, it, expect } from "vitest";
import { discussions } from "@armyofagents/db";

// Helper: get Drizzle column names from a table object.
function getColumnNames(table: Record<string, unknown>): string[] {
  return Object.keys(table).filter(
    (key) =>
      typeof table[key] === "object" &&
      table[key] !== null &&
      "name" in (table[key] as Record<string, unknown>),
  );
}

describe("discussions table — thread-container columns", () => {
  const cols = getColumnNames(discussions);

  it("has the thread origin/intent/phase columns", () => {
    for (const c of ["originSource", "originMedium", "intent", "phase"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("has goal-as-property + visibility + owner", () => {
    for (const c of ["goalId", "visibility", "ownerUserId"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("has autonomy + subtype + fork/merge lineage", () => {
    for (const c of ["autonomyLevel", "subtype", "forkedFromId", "mergedIntoId"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("has the Scribe summary fields", () => {
    for (const c of ["summaryText", "summaryNext", "summaryUpdatedAt"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });

  it("has entrySeq counter (for Plan 7 atomic seq assignment)", () => {
    expect(cols).toContain("entrySeq");
  });

  it("preserves existing discussion columns", () => {
    for (const c of ["id", "companyId", "title", "status", "scopeType", "tags"]) {
      expect(cols, `missing column: ${c}`).toContain(c);
    }
  });
});
