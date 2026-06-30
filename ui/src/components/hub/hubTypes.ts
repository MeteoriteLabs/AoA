import type { HubItemListRow } from "@/api/hub-items";
import type { HubGroupMode, HubLane, HubSemanticType } from "@armyofagents/shared";
import type { LucideIcon } from "lucide-react";

export type HubViewerKind =
  | "approval"
  | "discussion"
  | "task"
  | "notification"
  | "suggestion"
  | "reserved";

export interface HubRegistryEntry {
  semanticType: HubSemanticType;
  lane: HubLane;
  label: string;
  icon: LucideIcon;
  viewerKind: HubViewerKind;
  fullLink: (item: HubItemListRow) => string | null;
}

export type HubListEntry =
  | { kind: "item"; item: HubItemListRow }
  | {
      kind: "group";
      key: string;
      label: string;
      items: HubItemListRow[];
      unreadCount: number;
    };

export function buildHubListEntries(
  items: HubItemListRow[],
  groupMode: HubGroupMode,
): HubListEntry[] {
  if (groupMode === "none") return items.map((item) => ({ kind: "item", item }));

  const entries: HubListEntry[] = [];
  const grouped = new Map<string, HubItemListRow[]>();

  for (const item of items) {
    if (item.priority === "high" || item.priority === "urgent" || !item.groupKey) {
      entries.push({ kind: "item", item });
      continue;
    }
    const bucket = grouped.get(item.groupKey) ?? [];
    bucket.push(item);
    grouped.set(item.groupKey, bucket);
  }

  const emittedGroups = new Set<string>();
  for (const item of items) {
    if (item.priority === "high" || item.priority === "urgent" || !item.groupKey) continue;
    if (emittedGroups.has(item.groupKey)) continue;
    emittedGroups.add(item.groupKey);
    const groupItems = grouped.get(item.groupKey) ?? [];
    if (groupItems.length < 3) {
      entries.push(...groupItems.map((groupItem) => ({ kind: "item" as const, item: groupItem })));
      continue;
    }
    entries.push({
      kind: "group",
      key: item.groupKey,
      label: item.groupLabel ?? item.groupKey,
      items: groupItems,
      unreadCount: groupItems.filter((groupItem) => !groupItem.readAt).length,
    });
  }

  return entries;
}
