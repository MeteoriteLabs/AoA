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

/**
 * Canonical short label for each layer. Consumers may append qualifiers
 * (e.g. "Identity (always in agent context)" inside the create-item dialog),
 * but the base label here is the source of truth — keeps capitalization
 * consistent across the viewer, list, tree, and dialogs.
 */
export const LAYER_LABELS: Record<MemoryItemLayer, string> = {
  identity: "Identity",
  domain: "Domain",
  active_context: "Active context",
  working: "Working",
};
