import type { RecentActivityItem } from "@armyofagents/shared";
export function formatAction(item: RecentActivityItem): string {
  return item.action.replace(/[._]/g, " ").replace(/\bissue\b/g, "task");
}
export function activityEntityName(item: RecentActivityItem): string {
  const details = item.details as Record<string, unknown> | null;
  if (details?.title && typeof details.title === "string") return details.title;
  if (details?.name && typeof details.name === "string") return details.name;
  return item.entityType === "issue" ? "task" : item.entityType;
}
