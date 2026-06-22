import { describe, it, expect } from "vitest";
import { splitSections, computeSectionDiff, applyMergeDecisions } from "../services/marketplace-merge.js";

describe("splitSections", () => {
  it("returns a preamble section for content before first ##", () => {
    const md = "intro text\n## Section A\ncontent A";
    const sections = splitSections(md);
    expect(sections[0].header).toBe("__preamble__");
    expect(sections[0].content).toBe("intro text");
    expect(sections[1].header).toBe("Section A");
  });

  it("returns ALL sections including duplicates", () => {
    const md = "## Examples\nfirst\n## Examples\nsecond";
    const sections = splitSections(md);
    expect(sections).toHaveLength(3); // preamble + 2 × Examples
    expect(sections[1].header).toBe("Examples");
    expect(sections[2].header).toBe("Examples");
  });

  it("returns single preamble when no ## headers", () => {
    const md = "just text here";
    const sections = splitSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].header).toBe("__preamble__");
  });
});

describe("computeSectionDiff — unique headers", () => {
  it("marks unchanged sections correctly", () => {
    const mine = "## Overview\nSame text";
    const theirs = "## Overview\nSame text";
    const diff = computeSectionDiff(mine, theirs);
    const overview = diff.find((d) => d.header === "Overview" || d.header.startsWith("Overview"));
    expect(overview?.state).toBe("unchanged");
  });

  it("marks changed sections correctly", () => {
    const mine = "## Overview\nOld text";
    const theirs = "## Overview\nNew text";
    const diff = computeSectionDiff(mine, theirs);
    const overview = diff.find((d) => d.header === "Overview" || d.header.startsWith("Overview"));
    expect(overview?.state).toBe("changed");
    expect(overview?.mine).toContain("Old text");
    expect(overview?.theirs).toContain("New text");
  });

  it("marks added sections (in theirs but not mine)", () => {
    const mine = "## Overview\ntext";
    const theirs = "## Overview\ntext\n## Usage\nnew section";
    const diff = computeSectionDiff(mine, theirs);
    const usage = diff.find((d) => d.header === "Usage" || d.header.startsWith("Usage"));
    expect(usage?.state).toBe("added");
  });

  it("marks removed sections (in mine but not theirs)", () => {
    const mine = "## Overview\ntext\n## Deprecated\nold stuff";
    const theirs = "## Overview\ntext";
    const diff = computeSectionDiff(mine, theirs);
    const deprecated = diff.find((d) => d.header === "Deprecated" || d.header.startsWith("Deprecated"));
    expect(deprecated?.state).toBe("removed");
  });
});

describe("computeSectionDiff — duplicate headers (the bug)", () => {
  it("preserves BOTH sections when mine has two sections with the same header", () => {
    const mine = "## Examples\nfirst example\n## Examples\nsecond example";
    const theirs = "## Examples\nfirst example\n## Examples\nthird example";
    const diff = computeSectionDiff(mine, theirs);

    // Should have 3 entries: preamble (unchanged/added) + Examples + Examples [2]
    // The first Examples should be unchanged, the second should be changed
    const exampleDiffs = diff.filter((d) => d.header.startsWith("Examples"));
    expect(exampleDiffs).toHaveLength(2);

    const first = exampleDiffs[0];
    const second = exampleDiffs[1];

    expect(first.state).toBe("unchanged");
    expect(second.state).toBe("changed");
    expect(second.mine).toContain("second example");
    expect(second.theirs).toContain("third example");
  });

  it("does NOT drop the first section when theirs has a single version of a duplicate header", () => {
    // mine has two ## Examples; theirs has one. First should match, second should be "removed".
    const mine = "## Examples\nfirst\n## Examples\nsecond";
    const theirs = "## Examples\nfirst";
    const diff = computeSectionDiff(mine, theirs);

    // preamble diff + Examples (unchanged) + Examples [2] (removed)
    const exampleDiffs = diff.filter((d) => d.header.startsWith("Examples"));
    expect(exampleDiffs).toHaveLength(2);
    expect(exampleDiffs[0].state).toBe("unchanged");
    expect(exampleDiffs[1].state).toBe("removed");
  });
});

describe("applyMergeDecisions", () => {
  it("keeps mine when decision is 'mine'", () => {
    const mine = "## Overview\nmy content";
    const theirs = "## Overview\ntheir content";
    const diff = computeSectionDiff(mine, theirs);
    const result = applyMergeDecisions(diff, { Overview: "mine" });
    expect(result).toContain("my content");
    expect(result).not.toContain("their content");
  });

  it("keeps theirs when decision is 'theirs'", () => {
    const mine = "## Overview\nmy content";
    const theirs = "## Overview\ntheir content";
    const diff = computeSectionDiff(mine, theirs);
    const result = applyMergeDecisions(diff, { Overview: "theirs" });
    expect(result).toContain("their content");
    expect(result).not.toContain("my content");
  });
});

describe("applyMergeDecisions — section ordering (A-M15)", () => {
  // Helper: extract the ## section headers from a merged markdown doc, in order.
  const headerOrder = (md: string): string[] =>
    md
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim());

  it("preserves user section order when upstream drops a middle section (B removed)", () => {
    // mine = [A, B, C]; theirs = [A, C] (B removed upstream).
    // B is a user-retained section (defaults to 'mine'/kept) and must stay in its
    // original slot — output must be A, B, C, NOT A, C, B.
    const mine = "## A\nbody a\n## B\nbody b\n## C\nbody c";
    const theirs = "## A\nbody a\n## C\nbody c";
    const diff = computeSectionDiff(mine, theirs);
    const merged = applyMergeDecisions(diff, {});
    expect(headerOrder(merged)).toEqual(["A", "B", "C"]);
  });

  it("places an upstream-added section at its anchor relative to surviving neighbors", () => {
    // mine = [A, C]; theirs = [A, D, C] (D added upstream between A and C).
    // D should land between A and C → output A, D, C.
    const mine = "## A\nbody a\n## C\nbody c";
    const theirs = "## A\nbody a\n## D\nbody d\n## C\nbody c";
    const diff = computeSectionDiff(mine, theirs);
    const merged = applyMergeDecisions(diff, {});
    expect(headerOrder(merged)).toEqual(["A", "D", "C"]);
  });
});
