import type { HubItemListRow } from "@/api/hub-items";
import type { HubLane, HubSemanticType } from "@armyofagents/shared";
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
