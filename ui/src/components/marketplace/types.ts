/**
 * Shared types for marketplace UI components.
 */

export interface SectionDiff {
  header: string;
  state: "unchanged" | "changed" | "added" | "removed";
  mine: string;
  theirs: string;
}
