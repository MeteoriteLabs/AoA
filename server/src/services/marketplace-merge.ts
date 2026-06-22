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
 *
 * Ordering: the diff is built in MINE (current/user) order for retained
 * (unchanged/changed) and removed sections, so user-authored ordering — and
 * user-retained sections upstream has dropped — is preserved. Upstream-only
 * ("added") sections are interleaved at their anchor: each lands immediately
 * before the surviving mine-section it precedes in theirs, and any added
 * sections trailing the last shared section are appended at the end.
 */
export function computeSectionDiff(mine: string, theirs: string): SectionDiff[] {
  const mineSections = deduplicateHeaders(splitSections(mine));
  const theirSectionList = deduplicateHeaders(splitSections(theirs));
  const theirSections = new Map(theirSectionList.map((s) => [s.header, s]));
  // Upstream index per header, used to anchor "added" sections relative to
  // surviving mine-sections.
  const theirIndex = new Map(theirSectionList.map((s, i) => [s.header, i]));

  const result: SectionDiff[] = [];

  // "Added" sections (in theirs, not in mine), kept in upstream order so they
  // are flushed at their correct anchor as we walk mine.
  const added = theirSectionList.filter((s) => !mineSections.some((m) => m.header === s.header));
  let addedCursor = 0;

  // Flush all added sections whose upstream index is < the given boundary.
  const flushAddedBefore = (boundary: number) => {
    while (addedCursor < added.length && (theirIndex.get(added[addedCursor].header) ?? 0) < boundary) {
      const s = added[addedCursor];
      result.push({ header: s.header, state: "added", mine: "", theirs: s.content });
      addedCursor += 1;
    }
  };

  // Walk mine in order; classify each section, interleaving added sections that
  // anchor before the current surviving section.
  for (const mySection of mineSections) {
    const theirSection = theirSections.get(mySection.header);

    if (theirSection) {
      // Shared section: flush any added sections anchored before it upstream.
      flushAddedBefore(theirIndex.get(mySection.header) ?? Number.MAX_SAFE_INTEGER);
      if (mySection.content.trim() === theirSection.content.trim()) {
        result.push({ header: mySection.header, state: "unchanged", mine: mySection.content, theirs: theirSection.content });
      } else {
        result.push({
          header: mySection.header,
          state: "changed",
          mine: mySection.content,
          theirs: theirSection.content,
          wordDiff: diffWords(mySection.content, theirSection.content),
        });
      }
    } else {
      // Removed section (in mine, not theirs): keep it in its original mine slot.
      result.push({ header: mySection.header, state: "removed", mine: mySection.content, theirs: "" });
    }
  }

  // Append any remaining added sections (anchored after the last shared section).
  flushAddedBefore(Number.MAX_SAFE_INTEGER);

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
