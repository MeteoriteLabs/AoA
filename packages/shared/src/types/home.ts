export interface GoalProgress {
  id: string;
  title: string;
  status: string;
  totalTasks: number;
  doneTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  progressPercent: number;
}

export interface RecentActivityItem {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface HomeSummary {
  companyId: string;
  briefsAwaitingReview: number;
  tasksInReview: number;
  myTasksDueToday: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    assigneeAgentId: string | null;
    assigneeUserId: string | null;
  }[];
  blockedTasks: number;
  pendingMemoryItems: number;
  recentActivity: RecentActivityItem[];
  goalProgress: GoalProgress[];
}
