import { describe, expect, it } from "vitest";
import {
  COMPANY_BRAIN_DERIVED_EDGE_KINDS,
  COMPANY_BRAIN_EDITABLE_EDGE_KINDS,
  COMPANY_BRAIN_EDGE_EDITABILITY_BY_KIND,
  COMPANY_BRAIN_NODE_TYPES,
} from "../../constants.js";
import {
  companyBrainNeighborQuerySchema,
  companyBrainNeighborsResponseSchema,
  companyBrainNodeRefSchema,
  createCompanyBrainSemanticEdgeSchema,
  updateCompanyBrainSemanticEdgeSchema,
} from "../company-brain-graph.js";

describe("companyBrainNodeRefSchema", () => {
  it("accepts graph node references with uuid or principal-style ids", () => {
    expect(companyBrainNodeRefSchema.safeParse({
      type: "memory_item",
      id: "00000000-0000-0000-0000-000000000001",
    }).success).toBe(true);

    expect(companyBrainNodeRefSchema.safeParse({
      type: "human",
      id: "founder@example.com",
    }).success).toBe(true);
  });

  it("rejects unknown node types and empty ids", () => {
    expect(companyBrainNodeRefSchema.safeParse({
      type: "run",
      id: "00000000-0000-0000-0000-000000000001",
    }).success).toBe(false);

    expect(companyBrainNodeRefSchema.safeParse({
      type: "memory_item",
      id: "",
    }).success).toBe(false);
  });
});

describe("companyBrainNeighborQuerySchema", () => {
  it("defaults to depth 1 and coerces query-string depth", () => {
    expect(companyBrainNeighborQuerySchema.parse({})).toEqual({ depth: 1 });
    expect(companyBrainNeighborQuerySchema.parse({ depth: "1" })).toEqual({ depth: 1 });
  });

  it("rejects depth greater than the first-slice graph contract", () => {
    expect(companyBrainNeighborQuerySchema.safeParse({ depth: "3" }).success).toBe(false);
  });

  it("accepts a comma-separated edge kind filter", () => {
    const result = companyBrainNeighborQuerySchema.parse({ kinds: "belongs_to,related_to" });
    expect(result.kinds).toEqual(["belongs_to", "related_to"]);
  });
});

describe("company brain semantic edge schemas", () => {
  it("accepts editable semantic links", () => {
    const result = createCompanyBrainSemanticEdgeSchema.safeParse({
      from: { type: "memory_item", id: "00000000-0000-0000-0000-000000000001" },
      to: { type: "memory_item", id: "00000000-0000-0000-0000-000000000002" },
      kind: "supports",
      confidence: 0.87,
      evidence: "Same launch decision.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects derived or append-only links in human-editable payloads", () => {
    const result = createCompanyBrainSemanticEdgeSchema.safeParse({
      from: { type: "memory_item", id: "00000000-0000-0000-0000-000000000001" },
      to: { type: "memory_item", id: "00000000-0000-0000-0000-000000000002" },
      kind: "derived_from",
    });
    expect(result.success).toBe(false);
  });

  it("keeps updates partial but still limited to editable semantic links", () => {
    expect(updateCompanyBrainSemanticEdgeSchema.safeParse({ evidence: null }).success).toBe(true);
    expect(updateCompanyBrainSemanticEdgeSchema.safeParse({ kind: "assigned_to" }).success).toBe(false);
  });
});

describe("companyBrainNeighborsResponseSchema", () => {
  it("validates a minimal neighbor graph response", () => {
    const center = {
      type: "memory_item",
      id: "00000000-0000-0000-0000-000000000001",
      companyId: "00000000-0000-0000-0000-000000000010",
      label: "Launch positioning",
    };

    const result = companyBrainNeighborsResponseSchema.safeParse({
      center,
      nodes: [
        center,
        {
          type: "department",
          id: "00000000-0000-0000-0000-000000000020",
          companyId: "00000000-0000-0000-0000-000000000010",
          label: "Marketing",
          scope: { isCompanyWide: false, visibility: "shared" },
        },
      ],
      edges: [
        {
          id: "derived:memory_item:00000000-0000-0000-0000-000000000001:department:00000000-0000-0000-0000-000000000020",
          companyId: "00000000-0000-0000-0000-000000000010",
          from: { type: "memory_item", id: "00000000-0000-0000-0000-000000000001" },
          to: { type: "department", id: "00000000-0000-0000-0000-000000000020" },
          kind: "belongs_to",
          sourceClass: "derived",
          editability: "source_row_only",
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});

describe("company brain constants", () => {
  it("models product graph nodes without adding run nodes to the default graph", () => {
    expect(COMPANY_BRAIN_NODE_TYPES).toContain("memory_item");
    expect(COMPANY_BRAIN_NODE_TYPES).toContain("human");
    expect(COMPANY_BRAIN_NODE_TYPES).toContain("agent");
    expect(COMPANY_BRAIN_NODE_TYPES).not.toContain("run");
  });

  it("separates source-row edges from editable semantic edges", () => {
    expect(COMPANY_BRAIN_DERIVED_EDGE_KINDS).toContain("belongs_to");
    expect(COMPANY_BRAIN_EDITABLE_EDGE_KINDS).toContain("supports");
    expect(COMPANY_BRAIN_EDGE_EDITABILITY_BY_KIND.belongs_to).toBe("source_row_only");
    expect(COMPANY_BRAIN_EDGE_EDITABILITY_BY_KIND.derived_from).toBe("append_only");
    expect(COMPANY_BRAIN_EDGE_EDITABILITY_BY_KIND.supports).toBe("editable");
  });
});
