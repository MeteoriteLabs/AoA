// Pure scope-item grouping helper (no React dependency)
// All items are ExtractedItems from discussion entries.

export interface ScopeItem {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: "pending" | "approved" | "rejected" | "edited";
  conflictsWith: string | null;
  suggestedPriority: string | null;
  suggestedAssigneeId: string | null;
  suggestedDepartmentId: string | null;
  suggestedLayer: string | null;
  layer: string | null;
  dedupAction: string | null;
  resultTaskId: string | null;
  resultMemoryId: string | null;
  createdAt: string;
  /** IDs of scope items that this item depends on (blockers) */
  dependsOn?: string[];
}

export interface NeedsInputItem {
  item: ScopeItem;
  hasConflict: boolean;
}

export interface GroupedScope {
  /** Pending / edited items that need founder attention; flagged if there are conflicts */
  needsInput: NeedsInputItem[];
  /** Approved items that are not references or artifacts */
  confirmed: ScopeItem[];
  /** Approved items of type "reference" */
  references: ScopeItem[];
  /** Approved items of type "artifact" */
  artifacts: ScopeItem[];
}

/**
 * Group a flat list of scope items into four buckets:
 *  - needsInput (pending | edited, with hasConflict flag)
 *  - confirmed (approved, non-reference, non-artifact)
 *  - references (approved type=reference)
 *  - artifacts (approved type=artifact)
 *
 * Rejected items are silently dropped.
 */
export function groupScopeItems(items: ScopeItem[]): GroupedScope {
  const result: GroupedScope = {
    needsInput: [],
    confirmed: [],
    references: [],
    artifacts: [],
  };

  for (const item of items) {
    if (item.status === "rejected") {
      // Rejected items are skipped entirely
      continue;
    }

    if (item.status === "pending" || item.status === "edited") {
      result.needsInput.push({
        item,
        hasConflict: item.conflictsWith != null && item.conflictsWith !== "",
      });
      continue;
    }

    // item.status === "approved"
    if (item.type === "reference") {
      result.references.push(item);
    } else if (item.type === "artifact") {
      result.artifacts.push(item);
    } else {
      result.confirmed.push(item);
    }
  }

  return result;
}

/** Every extracted-item type the backend can emit
 *  (discussion_extracted_items.type — schema discussions.ts). */
export const ALL_SCOPE_TYPES = [
  "decision", "task", "insight", "context",
  "reference", "preference", "artifact", "spin_off_thread",
] as const;

export type ScopeItemType = (typeof ALL_SCOPE_TYPES)[number];

/** Group items by their exact type so EVERY type is surfaced.
 *  Unknown types fall under their raw string key. */
export function groupByType(items: ScopeItem[]): Record<string, ScopeItem[]> {
  const out: Record<string, ScopeItem[]> = {};
  for (const t of ALL_SCOPE_TYPES) out[t] = [];
  for (const item of items) {
    (out[item.type] ??= []).push(item);
  }
  return out;
}
