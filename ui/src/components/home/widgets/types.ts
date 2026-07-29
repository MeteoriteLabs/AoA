import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { HomeBoardWidgetKey, UserRole } from "@armyofagents/shared";

/** One union, defined in shared (server + UI both need the widget-key set). */
export type WidgetKey = HomeBoardWidgetKey;

/** A grid footprint in {lg} columns/rows. Mirrors HOME_BOARD_ALLOWED_SIZES entries. */
export interface WidgetSize {
  w: number;
  h: number;
}

/** Props every widget receives. Widgets own their own data hooks internally. */
export interface WidgetProps {
  companyId: string;
  role: UserRole | null;
  /** Current grid footprint (columns × rows) the tile is rendered at. */
  size: WidgetSize;
  /** True while the Home board is in edit mode (suppresses header navigation). */
  editing?: boolean;
}

export interface WidgetDef {
  key: WidgetKey;
  title: string;
  icon: LucideIcon;
  requiresFounder?: boolean; // UX-only (future tray). Real authz is server-side.
  Component: ComponentType<WidgetProps>;
  /** Allowed desktop {w,h} footprints — references HOME_BOARD_ALLOWED_SIZES[key] (never copied). */
  allowedSizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
}
