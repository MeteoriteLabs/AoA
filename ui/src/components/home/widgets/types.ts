import type { ComponentType } from "react";
import type { UserRole } from "@armyofagents/shared";

export type WidgetKey =
  | "action-queue"
  | "suggestions"
  | "objectives"
  | "activity-feed"
  | "agents-now"
  | "budget"
  | "approvals"
  | "my-tasks";

/** Props every widget receives. Widgets own their own data hooks internally. */
export interface WidgetProps {
  companyId: string;
  role: UserRole | null;
}

export interface WidgetDef {
  key: WidgetKey;
  title: string;
  requiresFounder?: boolean; // UX-only (future tray). Real authz is server-side.
  Component: ComponentType<WidgetProps>;
}
