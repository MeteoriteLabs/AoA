import { describe, it, expect } from "vitest";
import { splitSections, computeSectionDiff, applyMergeDecisions } from "../services/marketplace-merge.js";

const DOC_A = `# Title
Content A

## Section One
Section one content A

## Section Two
Section two content (same)
`;

const DOC_B = `# Title
Content A

## Section One
Section one content B — changed

## Section Two
Section two content (same)

## Section Three
Brand new section
`;

describe("splitSections", () => {
  it("splits markdown by ## headers", () => {
    const sections = splitSections(DOC_A);
    expect(sections).toHaveLength(3); // preamble + Section One + Section Two
    expect(sections[0]!.header).toBe("__preamble__");
    expect(sections[1]!.header).toBe("Section One");
    expect(sections[2]!.header).toBe("Section Two");
  });
});

describe("computeSectionDiff", () => {
  it("marks unchanged sections", () => {
    const diff = computeSectionDiff(DOC_A, DOC_A);
    expect(diff.every((s) => s.state === "unchanged")).toBe(true);
  });

  it("detects changed and added sections", () => {
    const diff = computeSectionDiff(DOC_A, DOC_B);
    const changed = diff.find((s) => s.header === "Section One");
    const added = diff.find((s) => s.header === "Section Three");
    expect(changed?.state).toBe("changed");
    expect(added?.state).toBe("added");
  });
});

describe("applyMergeDecisions", () => {
  const diff = [
    { header: "__preamble__", state: "unchanged" as const, mine: "Intro text", theirs: "Intro text" },
    { header: "Section One", state: "changed" as const, mine: "Old content", theirs: "New content" },
    { header: "Section Two", state: "added" as const, mine: "", theirs: "Brand new section" },
    { header: "Section Three", state: "removed" as const, mine: "Gone content", theirs: "" },
  ];

  it("unchanged sections always appear in output regardless of decision", () => {
    const result = applyMergeDecisions(diff, { "__preamble__": "mine", "Section One": "mine", "Section Two": "theirs", "Section Three": "mine" });
    expect(result).toContain("Intro text");
  });

  it("accepts 'mine' for a changed section", () => {
    const result = applyMergeDecisions(diff, { "__preamble__": "mine", "Section One": "mine", "Section Two": "theirs", "Section Three": "mine" });
    expect(result).toContain("Old content");
    expect(result).not.toContain("New content");
  });

  it("accepts 'theirs' for a changed section", () => {
    const result = applyMergeDecisions(diff, { "__preamble__": "mine", "Section One": "theirs", "Section Two": "theirs", "Section Three": "mine" });
    expect(result).toContain("New content");
    expect(result).not.toContain("Old content");
  });

  it("includes 'added' section when decision is 'theirs'", () => {
    const result = applyMergeDecisions(diff, { "__preamble__": "mine", "Section One": "mine", "Section Two": "theirs", "Section Three": "mine" });
    expect(result).toContain("Brand new section");
  });

  it("drops 'added' section when decision is 'mine'", () => {
    const result = applyMergeDecisions(diff, { "__preamble__": "mine", "Section One": "mine", "Section Two": "mine", "Section Three": "mine" });
    expect(result).not.toContain("Brand new section");
  });

  it("includes 'removed' section when decision is 'mine'", () => {
    const result = applyMergeDecisions(diff, { "__preamble__": "mine", "Section One": "mine", "Section Two": "theirs", "Section Three": "mine" });
    expect(result).toContain("Gone content");
  });

  it("drops 'removed' section when decision is 'theirs'", () => {
    const result = applyMergeDecisions(diff, { "__preamble__": "mine", "Section One": "mine", "Section Two": "theirs", "Section Three": "theirs" });
    expect(result).not.toContain("Gone content");
  });
});
