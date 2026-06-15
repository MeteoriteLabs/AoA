/**
 * Cockpit data contract — Phase 3b/3c/3d.
 *
 * ONE batched payload returned by GET /companies/:cid/cockpit.
 * The frontend's useCockpit() hook imports these types from @armyofagents/shared.
 */

// Phase 3d: Pinned card types
export type CockpitPinnedEntityType = "task" | "artifact" | "goal";

export interface CockpitPinnedItem {
  entityType: CockpitPinnedEntityType;
  entityId: string;
  title: string;
  status: string;       // task/goal status, or artifact status
  identifier?: string | null; // task identifier (e.g. TEAM-12)
}

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
  /** Phase 3d: user-pinned entities (tasks / artifacts / goals). */
  pinned: CockpitPinnedItem[];
  /** Opt-in card: Goals currently at_risk status (company-scoped). */
  goalsAtRisk: CockpitGoalsAtRiskItem[];
  /** Opt-in card: Budget pulse for the current month (founder-only; null for non-founders or no budget). */
  budgetPulse: CockpitBudgetPulseItem | null;
  /** Opt-in card: Tasks completed today (founder→company-wide; else→own). */
  doneToday: CockpitDoneTodayItem[];
}

// ── Opt-in card types (added for the cockpit opt-in cards feature) ────────────

export interface CockpitGoalsAtRiskItem {
  id: string;
  title: string;
  level: string;
  ownerAgentId: string | null;
}

export interface CockpitBudgetPulseItem {
  limitCents: number;
  spentCents: number;
  percentUsed: number;        // always > 0; the whole item is null when no budget is configured (limitCents === 0)
  openIncidentCount: number;
}

export interface CockpitDoneTodayItem {
  id: string;
  identifier: string | null;
  title: string;
}
