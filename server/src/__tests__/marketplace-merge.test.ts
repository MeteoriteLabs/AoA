import { describe, it, expect } from "vitest";
import { splitSections, computeSectionDiff } from "../services/marketplace-merge.js";

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
