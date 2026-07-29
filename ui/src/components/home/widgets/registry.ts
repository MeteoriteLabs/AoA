import type { WidgetDef, WidgetKey } from "./types";
import { ActionQueueWidget } from "./ActionQueueWidget";
import { SuggestionsWidget } from "./SuggestionsWidget";
import { ObjectivesWidget } from "./ObjectivesWidget";
import { ActivityFeedWidget } from "./ActivityFeedWidget";
import { AgentsNowWidget } from "./AgentsNowWidget";
import { BudgetWidget } from "./BudgetWidget";
import { ApprovalsWidget } from "./ApprovalsWidget";
import { MyTasksWidget } from "./MyTasksWidget";

export const widgetRegistry: Record<WidgetKey, WidgetDef> = {
  "action-queue": { key: "action-queue", title: "Action queue", Component: ActionQueueWidget },
  suggestions: { key: "suggestions", title: "Suggestions", Component: SuggestionsWidget },
  objectives: { key: "objectives", title: "Objectives", Component: ObjectivesWidget },
  "activity-feed": { key: "activity-feed", title: "Today's activity", Component: ActivityFeedWidget },
  "agents-now": { key: "agents-now", title: "Agents working now", Component: AgentsNowWidget },
  budget: { key: "budget", title: "Budget", Component: BudgetWidget },
  approvals: { key: "approvals", title: "Approvals & questions", Component: ApprovalsWidget },
  "my-tasks": { key: "my-tasks", title: "My tasks", Component: MyTasksWidget },
};
export function getWidget(key: WidgetKey): WidgetDef | undefined { return widgetRegistry[key]; }
export function listWidgets(): WidgetDef[] { return Object.values(widgetRegistry); }
