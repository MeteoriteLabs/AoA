export const COMPANY_STATUSES = ["active", "paused", "archived"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const DEPLOYMENT_MODES = ["local_trusted", "authenticated"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export const DEPLOYMENT_EXPOSURES = ["private", "public"] as const;
export type DeploymentExposure = (typeof DEPLOYMENT_EXPOSURES)[number];

export const AUTH_BASE_URL_MODES = ["auto", "explicit"] as const;
export type AuthBaseUrlMode = (typeof AUTH_BASE_URL_MODES)[number];

export const AGENT_STATUSES = [
  "active",
  "paused",
  "idle",
  "running",
  "error",
  "pending_approval",
  "terminated",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_ADAPTER_TYPES = [
  "process",
  "http",
  "claude_local",
  "codex_local",
  "opencode_local",
  "cursor",
  "openclaw",
  "claude_api",
  "openai_api",
  "gemini_api",
  "hermes_local",
  "gemini_local",
] as const;
export type AgentAdapterType = (typeof AGENT_ADAPTER_TYPES)[number];

export const AGENT_ROLES = [
  "ceo",
  "cto",
  "cmo",
  "cfo",
  "engineer",
  "designer",
  "pm",
  "qa",
  "devops",
  "researcher",
  "general",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_ICON_NAMES = [
  "bot",
  "cpu",
  "brain",
  "zap",
  "rocket",
  "code",
  "terminal",
  "shield",
  "eye",
  "search",
  "wrench",
  "hammer",
  "lightbulb",
  "sparkles",
  "star",
  "heart",
  "flame",
  "bug",
  "cog",
  "database",
  "globe",
  "lock",
  "mail",
  "message-square",
  "file-code",
  "git-branch",
  "package",
  "puzzle",
  "target",
  "wand",
  "atom",
  "circuit-board",
  "radar",
  "swords",
  "telescope",
  "microscope",
  "crown",
  "gem",
  "hexagon",
  "pentagon",
  "fingerprint",
] as const;
export type AgentIconName = (typeof AGENT_ICON_NAMES)[number];

export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const ISSUE_SOURCES = ["manual", "brief", "agent_proposal", "mcp"] as const;
export type IssueSource = (typeof ISSUE_SOURCES)[number];

export const GOAL_LEVELS = ["company", "team", "agent", "task"] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];

export const GOAL_STATUSES = ["planned", "active", "at_risk", "achieved", "cancelled"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const PROJECT_TYPES = ["department", "project"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
] as const;

export const APPROVAL_TYPES = ["hire_agent", "approve_ceo_strategy", "budget_override_required"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = [
  "pending",
  "revision_requested",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const SECRET_PROVIDERS = [
  "local_encrypted",
  "aws_secrets_manager",
  "gcp_secret_manager",
  "vault",
] as const;
export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

export const STORAGE_PROVIDERS = ["local_disk", "s3"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export const HEARTBEAT_INVOCATION_SOURCES = [
  "timer",
  "assignment",
  "on_demand",
  "automation",
] as const;
export type HeartbeatInvocationSource = (typeof HEARTBEAT_INVOCATION_SOURCES)[number];

export const WAKEUP_TRIGGER_DETAILS = ["manual", "ping", "callback", "system"] as const;
export type WakeupTriggerDetail = (typeof WAKEUP_TRIGGER_DETAILS)[number];

export const WAKEUP_REQUEST_STATUSES = [
  "queued",
  "deferred_issue_execution",
  "claimed",
  "coalesced",
  "skipped",
  "completed",
  "failed",
  "cancelled",
] as const;
export type WakeupRequestStatus = (typeof WAKEUP_REQUEST_STATUSES)[number];

export const HEARTBEAT_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type HeartbeatRunStatus = (typeof HEARTBEAT_RUN_STATUSES)[number];

export const LIVE_EVENT_TYPES = [
  "heartbeat.run.queued",
  "heartbeat.run.status",
  "heartbeat.run.event",
  "heartbeat.run.log",
  "heartbeat.run.outputs_detected",
  "agent.status",
  "activity.logged",
  // V2.5: Discussions
  "discussion.entry.created",
  "discussion.extraction.completed",
  "discussion.extraction.failed",
  // V2.5: Internal Agent
  "internal_agent.greeting",
  "internal_agent.reminder",
  "internal_agent.notification",
  "internal_agent.message",
  "internal_agent.run.status",
  // Budget
  "budget.policy_created",
  "budget.policy_updated",
  "budget.incident_created",
  "budget.incident_resolved",
] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export const PRINCIPAL_TYPES = ["user", "agent"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const MEMBERSHIP_STATUSES = ["pending", "active", "suspended"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const INSTANCE_USER_ROLES = ["instance_admin"] as const;
export type InstanceUserRole = (typeof INSTANCE_USER_ROLES)[number];

export const INVITE_TYPES = ["company_join", "bootstrap_ceo"] as const;
export type InviteType = (typeof INVITE_TYPES)[number];

export const INVITE_JOIN_TYPES = ["human", "agent", "both"] as const;
export type InviteJoinType = (typeof INVITE_JOIN_TYPES)[number];

export const JOIN_REQUEST_TYPES = ["human", "agent"] as const;
export type JoinRequestType = (typeof JOIN_REQUEST_TYPES)[number];

export const JOIN_REQUEST_STATUSES = ["pending_approval", "approved", "rejected"] as const;
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number];

export const MEMORY_ITEM_CATEGORIES = [
  "decision",
  "reference",
  "context",
  "insight",
  "preference",
] as const;
export type MemoryItemCategory = (typeof MEMORY_ITEM_CATEGORIES)[number];

export const MEMORY_ITEM_SOURCES = [
  "brief",
  "founder",
  "agent",
  "mcp",
  "document",
] as const;
export type MemoryItemSource = (typeof MEMORY_ITEM_SOURCES)[number];

export const MEMORY_ITEM_STATUSES = [
  "draft",
  "pending",
  "approved",
  "archived",
  "rejected",
] as const;
export type MemoryItemStatus = (typeof MEMORY_ITEM_STATUSES)[number];

export const MEMORY_ITEM_LAYERS = [
  "identity",
  "domain",
  "active_context",
  "working",
] as const;
export type MemoryItemLayer = (typeof MEMORY_ITEM_LAYERS)[number];

export const MEMORY_ITEM_VISIBILITY = ["scoped", "shared"] as const;
export type MemoryItemVisibility = (typeof MEMORY_ITEM_VISIBILITY)[number];

export const DEBRIEF_INPUT_TYPES = ["paste", "write", "mcp", "voice"] as const;
export type DebriefInputType = (typeof DEBRIEF_INPUT_TYPES)[number];

export const DEBRIEF_STATUSES = [
  "processing",
  "processing_failed",
  "ready",
  "archived",
] as const;
export type DebriefStatus = (typeof DEBRIEF_STATUSES)[number];

export const BRIEF_STATUSES = [
  "draft",
  "ready",
  "reviewed",
  "approved",
  "rejected",
  "partially_approved",
] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

export const BRIEF_ITEM_TYPES = [
  "decision",
  "task",
  "insight",
  "context",
  "reference",
  "preference",
] as const;
export type BriefItemType = (typeof BRIEF_ITEM_TYPES)[number];

export const BRIEF_ITEM_STATUSES = ["pending", "approved", "rejected", "edited"] as const;
export type BriefItemStatus = (typeof BRIEF_ITEM_STATUSES)[number];

export const BRIEF_DEDUP_ACTIONS = [
  "update_existing",
  "create_separate",
  "replace",
] as const;
export type BriefDedupAction = (typeof BRIEF_DEDUP_ACTIONS)[number];

export const PERMISSION_KEYS = [
  "agents:create",
  "users:invite",
  "users:manage_permissions",
  "tasks:assign",
  "tasks:assign_scope",
  "joins:approve",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// ── V2: RBAC ───────────────────────────────────────────────────────────

export const USER_ROLES = ["founder", "team_lead", "team_member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

// ── V2: Artifacts ──────────────────────────────────────────────────────

export const ARTIFACT_TYPES = [
  "document",
  "presentation",
  "code",
  "design",
  "report",
  "other",
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_STATUSES = ["draft", "active", "archived"] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const ARTIFACT_VERSION_SOURCES = [
  "agent",
  "founder",
  "mcp",
  "teammate",
  "external",
] as const;
export type ArtifactVersionSource = (typeof ARTIFACT_VERSION_SOURCES)[number];

// ── V2: Suggestions ────────────────────────────────────────────────────

export const SUGGESTION_CATEGORIES = [
  "goal_gap",
  "pipeline_bottleneck",
  "memory_gap",
  "pattern_detected",
  "budget_optimization",
  "recurring_work",
  "risk_flag",
  "workload_balance",
  "agent_proposal",
] as const;
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

export const SUGGESTION_STATUSES = [
  "pending",
  "accepted",
  "dismissed",
  "expired",
] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const SUGGESTION_ACTION_TYPES = [
  "create_task",
  "flag_risk",
  "suggest_memory",
  "archive_memory",
  "merge_memory",
  "adjust_budget",
  "rebalance_workload",
  "create_goal",
] as const;
export type SuggestionActionType = (typeof SUGGESTION_ACTION_TYPES)[number];

// ── V2: Memory Feedback Patterns ────────────────────────────────────────

export const MEMORY_FEEDBACK_PATTERN_TYPES = [
  "tone_correction",
  "format_change",
  "content_addition",
  "content_removal",
  "structure_change",
  "terminology_change",
] as const;
export type MemoryFeedbackPatternType = (typeof MEMORY_FEEDBACK_PATTERN_TYPES)[number];

export const MEMORY_FEEDBACK_PATTERN_STATUSES = [
  "detected",
  "suggested",
  "accepted",
  "dismissed",
] as const;
export type MemoryFeedbackPatternStatus = (typeof MEMORY_FEEDBACK_PATTERN_STATUSES)[number];

// ── V2: Detected Output Statuses ────────────────────────────────────────

export const DETECTED_OUTPUT_STATUSES = ["pending", "confirmed", "dismissed"] as const;
export type DetectedOutputStatus = (typeof DETECTED_OUTPUT_STATUSES)[number];

export const DETECTED_OUTPUT_SOURCES = ["diff", "hint", "both"] as const;
export type DetectedOutputSource = (typeof DETECTED_OUTPUT_SOURCES)[number];

// ── V2: Memory Item Versions ────────────────────────────────────────────

export const MEMORY_ITEM_VERSION_STATUSES = [
  "draft",
  "pending",
  "approved",
  "archived",
  "rejected",
] as const;
export type MemoryItemVersionStatus = (typeof MEMORY_ITEM_VERSION_STATUSES)[number];

export const SEARCH_ENTITY_TYPES = [
  "tasks",
  "goals",
  "agents",
  "memory",
] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

// ── V2.5: Discussions ─────────────────────────────────────────────────

export const DISCUSSION_STATUSES = ["active", "archived"] as const;
export type DiscussionStatus = (typeof DISCUSSION_STATUSES)[number];

export const DISCUSSION_SCOPE_TYPES = ["department", "project", "goal"] as const;
export type DiscussionScopeType = (typeof DISCUSSION_SCOPE_TYPES)[number];

export const DISCUSSION_ENTRY_INPUT_TYPES = ["paste", "write", "voice", "mcp"] as const;
export type DiscussionEntryInputType = (typeof DISCUSSION_ENTRY_INPUT_TYPES)[number];

export const EXTRACTION_STATUSES = ["pending", "processing", "completed", "failed", "skipped"] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const EXTRACTION_ITEM_TYPES = ["decision", "task", "insight", "context", "reference", "preference"] as const;
export type ExtractionItemType = (typeof EXTRACTION_ITEM_TYPES)[number];

export const EXTRACTION_ITEM_STATUSES = ["pending", "approved", "rejected", "edited"] as const;
export type ExtractionItemStatus = (typeof EXTRACTION_ITEM_STATUSES)[number];

// ── V2.5: Internal Agent ──────────────────────────────────────────────

export const AGENT_CAPABILITIES = [
  "discussion_processing",
  "proactive_suggestions",
  "organizational_queries",
  "system_actions",
  "context_briefing",
  "memory_management",
  "conflict_detection",
  "budget_awareness",
  "workflow_coaching",
  "workflow_discovery",
  "cross_department_coordination",
  "department_personas",
] as const;
export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export const AGENT_EXECUTION_MODES = ["api", "cli"] as const;
export type AgentExecutionMode = (typeof AGENT_EXECUTION_MODES)[number];

export const AGENT_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const AGENT_MODELS_BY_PROVIDER: Record<AgentProvider, { value: string; label: string }[]> = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  ],
  google: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
};

export const CLI_TOOLS = [
  { value: "claude_cli", label: "Claude CLI" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
] as const;

export const NOTIFICATION_PREFERENCES = ["silent", "digest", "realtime"] as const;
export type NotificationPreference = (typeof NOTIFICATION_PREFERENCES)[number];

export const TRIGGER_TYPES = ["conversation", "proactive", "event", "sub_agent"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const TRIGGER_SOURCES = [
  "user_message",
  "discussion_entry",
  "proactive_scan",
  "event_hook",
  "reminder_fire",
  "sub_agent_dispatch",
] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

export const IA_RUN_STATUSES = ["running", "completed", "failed"] as const;
export type IaRunStatus = (typeof IA_RUN_STATUSES)[number];

export const IA_MESSAGE_ROLES = ["user", "assistant", "system", "tool_call", "tool_result"] as const;
export type IaMessageRole = (typeof IA_MESSAGE_ROLES)[number];

export const IA_CONVERSATION_STATUSES = ["active", "archived"] as const;
export type IaConversationStatus = (typeof IA_CONVERSATION_STATUSES)[number];

export const REMINDER_STATUSES = ["pending", "fired", "cancelled"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "discussion.extraction_complete",
  "discussion.extraction_failed",
  "internal_agent.reminder",
  "internal_agent.proactive",
  "internal_agent.action_result",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
