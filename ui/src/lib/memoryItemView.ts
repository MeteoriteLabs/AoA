import type { MemoryItemCategory, MemoryItemLayer, MemoryItemStatus } from "@armyofagents/shared";
import type { Tone } from "../components/memory/MemoryChip";

/**
 * Status → tone for the quiet-chip atom. Five known statuses:
 * approved, pending, archived, rejected, draft.
 */
export const STATUS_TONE: Record<MemoryItemStatus, Tone> = {
  approved: "green",
  pending: "amber",
  archived: "slate",
  rejected: "magenta",
  draft: "slate",
};

/** Layer → tone. Same palette used by the layer headers in MemoryTree. */
export const LAYER_TONE: Record<MemoryItemLayer, Tone> = {
  identity: "indigo",
  domain: "teal",
  active_context: "amber",
  working: "magenta",
};

/** Optional: category → tone (used by viewer chips and item rows). */
export const CATEGORY_TONE: Record<MemoryItemCategory, Tone> = {
  decision: "indigo",
  reference: "teal",
  context: "magenta",
  insight: "amber",
  preference: "slate",
  procedure: "green",
  policy: "amber",
};
