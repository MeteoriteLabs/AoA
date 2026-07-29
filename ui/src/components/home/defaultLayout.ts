import type { UserRole } from "@armyofagents/shared";
import type { WidgetKey } from "./widgets/types";

// Plan 1 preserves today's exact section order for EVERY role (behavior-preserving —
// today's Home renders the same order for everyone). Role-aware ordering is a Plan 3
// concern, introduced with the customizable board.
const DEFAULT_ORDER: WidgetKey[] = ["action-queue", "suggestions", "objectives", "activity-feed"];

export function getDefaultLayout(_role: UserRole | null): WidgetKey[] {
  return DEFAULT_ORDER;
}
