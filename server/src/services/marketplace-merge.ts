/**
 * @fileoverview Snapshot merge algorithm for skill/agent/team updates.
 * Strategy: split markdown by ## headers → compare section by section →
 * produce SectionDiff[] → UI shows per-section Accept mine / Accept theirs.
 */
import { diffWords } from "diff";

export interface Section {
  header: string; // '## Section Name' or '__preamble__' for content before first heading
  content: string;
}

export interface SectionDiff {
  header: string;
  state: "unchanged" | "changed" | "added" | "removed";
  mine: string;   // content from current version (empty if added)
  theirs: string; // content from upstream version (empty if removed)
  wordDiff?: ReturnType<typeof diffWords>; // only when state === "changed"
}

/**
 * Split a markdown document into sections by ## (h2) headings.
 * Content before the first ## goes into a __preamble__ section.
 */
export function splitSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentHeader = "__preamble__";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      // Flush previous section
      sections.push({ header: currentHeader, content: currentLines.join("\n") });
      currentHeader = line.slice(3).trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  // Flush last section
  sections.push({ header: currentHeader, content: currentLines.join("\n") });

  return sections;
}

/**
 * Make section headers unique within an array by appending " [2]", " [3]", etc.
 * to repeated headers. This ensures duplicate ## headings in a markdown file
 * are each independently tracked in the diff Map, rather than the later one
 * silently overwriting the earlier one.
 *
 * The n-th occurrence of a header in mine is matched against the n-th occurrence
 * in theirs, which is the best-effort alignment for docs with repeated headings.
 */
export function deduplicateHeaders(sections: Section[]): Section[] {
  const counts = new Map<string, number>();
  return sections.map((s) => {
    const count = (counts.get(s.header) ?? 0) + 1;
    counts.set(s.header, count);
    return count === 1 ? s : { ...s, header: `${s.header} [${count}]` };
  });
}

/**
 * Compute a section-level diff between two markdown documents.
 */
export function computeSectionDiff(mine: string, theirs: string): SectionDiff[] {
  const mineSections = new Map(deduplicateHeaders(splitSections(mine)).map((s) => [s.header, s]));
  const theirSections = new Map(deduplicateHeaders(splitSections(theirs)).map((s) => [s.header, s]));

  const result: SectionDiff[] = [];

  // Process sections in upstream order (theirs defines the new structure)
  for (const [header, theirSection] of theirSections) {
    const mySection = mineSections.get(header);

    if (!mySection) {
      result.push({ header, state: "added", mine: "", theirs: theirSection.content });
    } else if (mySection.content.trim() === theirSection.content.trim()) {
      result.push({ header, state: "unchanged", mine: mySection.content, theirs: theirSection.content });
    } else {
      result.push({
        header,
        state: "changed",
        mine: mySection.content,
        theirs: theirSection.content,
        wordDiff: diffWords(mySection.content, theirSection.content),
      });
    }
  }

  // Find sections in mine but not theirs (removed)
  for (const [header, mySection] of mineSections) {
    if (!theirSections.has(header)) {
      result.push({ header, state: "removed", mine: mySection.content, theirs: "" });
    }
  }

  return result;
}

/**
 * Apply merge decisions to produce the final merged document.
 * decisions: map of header → 'mine' | 'theirs'
 */
export function applyMergeDecisions(
  diff: SectionDiff[],
  decisions: Record<string, "mine" | "theirs">,
): string {
  const parts: string[] = [];
  for (const section of diff) {
    const decision = decisions[section.header] ?? (section.state === "added" ? "theirs" : "mine");
    if (section.state === "unchanged") {
      parts.push(section.mine);
    } else if (decision === "mine" && section.state !== "added") {
      parts.push(section.mine);
    } else if (decision === "theirs" && section.state !== "removed") {
      parts.push(section.theirs);
    }
    // If decision is "mine" and state is "added", section is dropped
    // If decision is "theirs" and state is "removed", section is dropped
  }
  return parts.join("\n\n").trim() + "\n";
}
