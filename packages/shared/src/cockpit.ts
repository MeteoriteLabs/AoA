/**
 * Cockpit data contract — Phase 3b/3c.
 *
 * ONE batched payload returned by GET /companies/:cid/cockpit.
 * The frontend's useCockpit() hook imports these types from @armyofagents/shared.
 */

// Phase 3c: Approvals card types
export type CockpitApprovalSource = "approval" | "memory" | "discussion_item";

export interface CockpitApprovalItem {
  source: CockpitApprovalSource;
  /** approval id | memory item id | discussion extracted-item id */
  id: string;
  /** discussion_item only — needed for the batched approveItems endpoint */
  discussionId?: string;
  title: string;
  subtitle: string;
}

export interface CockpitTaskItem {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  dueDate: string | null;
}

export interface CockpitRunItem {
  id: string;
  agentName: string | null;
  status: string;
  startedAt: string | null;
  issueId: string | null;
}

export interface CockpitReminderItem {
  id: string;
  content: string;
  triggerAt: string;
}

export interface CockpitDiscussionItem {
  id: string;
  title: string | null;
  pendingItemCount: number;
  reason: "pending_items" | "extraction_failed";
}

export interface CockpitData {
  running: CockpitRunItem[];
  review: CockpitTaskItem[];
  myTasks: CockpitTaskItem[];
  today: {
    reminders: CockpitReminderItem[];
    dueTasks: CockpitTaskItem[];
  };
  discussions: CockpitDiscussionItem[];
  /** Phase 3c: unified approvals queue (founder-only; [] for non-founders). */
  approvals: CockpitApprovalItem[];
}
