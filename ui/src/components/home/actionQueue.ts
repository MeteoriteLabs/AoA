import type { ElementType } from "react";
import { AlertCircle, Clock, Eye } from "lucide-react";
import type { HomeSummary } from "@armyofagents/shared";

export interface ActionGroupItem {
  key: string;
  label: string;
  sublabel?: string;
  to: string;
}

export interface ActionGroup {
  id: string;
  title: string;
  icon: ElementType;
  items: ActionGroupItem[];
}

export function buildActionGroups(data: HomeSummary): ActionGroup[] {
  const groups: ActionGroup[] = [];
  const needsReviewItems: ActionGroupItem[] = [];

  if (data.discussionsPendingReview > 0) {
    needsReviewItems.push({
      key: "discussions-review",
      label: `${data.discussionsPendingReview} discussion${data.discussionsPendingReview === 1 ? "" : "s"} pending review`,
      to: "/discussions",
    });
  }
  if (data.tasksInReview > 0) {
    needsReviewItems.push({
      key: "tasks-review",
      label: `${data.tasksInReview} task${data.tasksInReview === 1 ? "" : "s"} in review`,
      to: "/issues?status=in_review",
    });
  }
  if (needsReviewItems.length > 0) {
    groups.push({ id: "needs-review", title: "Needs Review", icon: Eye, items: needsReviewItems });
  }

  if (data.blockedTasks > 0) {
    groups.push({
      id: "blocked",
      title: "Blocked",
      icon: AlertCircle,
      items: [{
        key: "blocked-tasks",
        label: `${data.blockedTasks} blocked task${data.blockedTasks === 1 ? "" : "s"}`,
        to: "/issues?status=blocked",
      }],
    });
  }

  if (data.myTasksDueToday.length > 0) {
    groups.push({
      id: "due-today",
      title: "Due Today",
      icon: Clock,
      items: data.myTasksDueToday.map((task) => ({
        key: `due-${task.id}`,
        label: task.title,
        sublabel: task.status === "in_progress" ? "In progress" : task.status === "todo" ? "To do" : task.status,
        to: `/issues/${task.id}`,
      })),
    });
  }

  return groups;
}

export function getTotalActionCount(groups: ActionGroup[], suggestionCount: number): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0) + suggestionCount;
}
