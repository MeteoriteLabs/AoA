import { describe, it, expect } from "vitest";
import { queryCompanyArtifactsTool } from "../tools/artifact-query-company.js";

const rows = [
  { id: "a1", title: "Plan", type: "document", currentVersionId: "v1", status: "active", updatedAt: "2026-06-10" },
  { id: "a2", title: "Deck", type: "presentation", currentVersionId: "v2", status: "draft", updatedAt: "2026-06-09" },
  { id: "a3", title: "Notes", type: "document", currentVersionId: null, status: "archived", updatedAt: "2026-06-08" },
];

function ctxWith(list: unknown[]) {
  return {
    companyId: "c1",
    userId: "u1",
    userRole: "founder",
    services: { artifacts: { list: async (companyId: string) => (companyId === "c1" ? list : []) } },
  } as any;
}

describe("query_company_artifacts", () => {
  it("lists company artifacts in tool-row shape", async () => {
    const res = await queryCompanyArtifactsTool.execute({}, ctxWith(rows));
    expect(res.success).toBe(true);
    expect(res.data).toHaveLength(3);
    expect((res.data as any[])[0]).toEqual({
      artifactId: "a1", title: "Plan", type: "document",
      currentVersionId: "v1", status: "active", updatedAt: "2026-06-10",
    });
  });

  it("filters by type and status", async () => {
    const byType = await queryCompanyArtifactsTool.execute({ type: "document" }, ctxWith(rows));
    expect(byType.data).toHaveLength(2);
    const byStatus = await queryCompanyArtifactsTool.execute({ status: "draft" }, ctxWith(rows));
    expect(byStatus.data).toHaveLength(1);
  });

  it("caps limit at 50; limit 0 → default 20; negative → floor 1", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ ...rows[0], id: `a${i}` }));
    const res = await queryCompanyArtifactsTool.execute({ limit: 999 }, ctxWith(many));
    expect(res.data).toHaveLength(50);
    const one = await queryCompanyArtifactsTool.execute({ limit: 0 }, ctxWith(many));
    expect(one.data).toHaveLength(20); // limit 0 → default 20 (|| catches falsy), not floor
    const neg = await queryCompanyArtifactsTool.execute({ limit: -5 }, ctxWith(many));
    expect(neg.data).toHaveLength(1);
  });

  it("ignores invalid filter values", async () => {
    const res = await queryCompanyArtifactsTool.execute({ type: "DROP TABLE" }, ctxWith(rows));
    expect(res.data).toHaveLength(3);
  });

  it("summary signals truncation when capped", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...rows[0], id: `a${i}` }));
    const res = await queryCompanyArtifactsTool.execute({}, ctxWith(many));
    expect(res.summary).toContain("Showing 20 of 30");
  });

  it("summary notes ignored invalid filters", async () => {
    const res = await queryCompanyArtifactsTool.execute({ type: "DROP TABLE" }, ctxWith(rows));
    expect(res.summary).toContain("ignored invalid filter");
  });
});
