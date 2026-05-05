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
  "hermes_local",
  "gemini_local",
] as const;
export type AgentAdapterType = (typeof AGENT_ADAPTER_TYPES)[number];

// 3-tier model:
//   - cxo:     apex executive. Apex CXO (no agent parent) is the de-facto
//              "Chief of Staff" — computed live in the org-tree UI, not
//              stored. CXO agents bypass the canCreateAgents permission
//              gate and load the 4-file `cxo/` onboarding bundle.
//   - lead:    manages a team or function. Loads the 4-file `lead/`
//              onboarding bundle. Permission gate still enforced.
//   - general: individual contributor. Loads the single `default/AGENTS.md`.
//
// Constraint: a `cxo` agent can only report to a user or root (enforced
// in `services/agents.ts`). Mid-tier executives that real companies would
// call CTO/CMO/CFO map to `lead` in this model.
export const AGENT_ROLES = ["cxo", "lead", "general"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_ROLE_LABELS: Record<string, string> = {
  cxo: "Executive",
  lead: "Lead",
  general: "General",
} as const;

export function displayAgentRole(role: string): string {
  return AGENT_ROLE_LABELS[role] ?? role.toUpperCase();
}

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
  // Phase 6: Memory page real-time updates
  "memory.item.created",
  "memory.item.updated",
  "memory.item.moved",
  "memory.item.deleted",
  "memory.item.layer-changed",
  "memory.asset.created",
  "memory.asset.updated",
  "memory.asset.deleted",
  "memory.folder.created",
  "memory.folder.updated",
  "memory.folder.deleted",
  "memory.import.progress",
  // Marketplace install (M.2)
  "marketplace.install.started",
  "marketplace.install.completed",
  "marketplace.install.failed",
  "marketplace.install_requested",
  // Marketplace update (M.4)
  "marketplace.update.completed",
  "marketplace.update.failed",
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
  "procedure",
  "policy",
] as const;
export type MemoryItemCategory = (typeof MEMORY_ITEM_CATEGORIES)[number];

// V2.6: relations between memory items (graph edges).
export const MEMORY_RELATION_KINDS = [
  "supersedes",
  "related_to",
  "applies_to",
  "conflicts_with",
  "derived_from",
] as const;
export type MemoryRelationKind = (typeof MEMORY_RELATION_KINDS)[number];

// V2.6: per-call retrieval audit triggers.
export const MEMORY_RETRIEVAL_TRIGGERS = [
  "auto",                  // pre-run injection at heartbeat start
  "agent_search",          // worker agent called memory.search
  "agent_get",             // worker agent called memory.get
  "skill_materialize",     // pinned-item skill synthesis
  "commander_query",       // commander tool query
] as const;
export type MemoryRetrievalTrigger = (typeof MEMORY_RETRIEVAL_TRIGGERS)[number];

// V2.6: extraction pipeline input types.
export const MEMORY_EXTRACTION_INPUT_TYPES = [
  "text",
  "pdf",
  "docx",
  "url",
  "audio",
  "image",
  "video",
] as const;
export type MemoryExtractionInputType = (typeof MEMORY_EXTRACTION_INPUT_TYPES)[number];

// V2.6: extraction job status.
export const MEMORY_EXTRACTION_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type MemoryExtractionStatus = (typeof MEMORY_EXTRACTION_STATUSES)[number];

// V2.6: extraction batch status (groups multi-file uploads).
export const MEMORY_EXTRACTION_BATCH_STATUSES = [
  "queued",
  "running",
  "completed",
  "cancelled",
] as const;
export type MemoryExtractionBatchStatus = (typeof MEMORY_EXTRACTION_BATCH_STATUSES)[number];

// V2.6: MCP actor types — controls which tools an actor can call.
//   "board"     — founder session (existing)
//   "agent"     — worker agent CLI subprocess (new)
//   "commander" — internal-agent + sub-agents (new, when commander goes CLI)
//   "mcp"       — external MCP API key (existing)
export const MCP_ACTOR_TYPES = ["board", "agent", "commander", "mcp"] as const;
export type McpActorType = (typeof MCP_ACTOR_TYPES)[number];

// V2.6: per-agent memory profile — controls scope filtering and skill materialization.
// Stored under agent.runtimeConfig.memoryProfile. See memoryProfileSchema in validators/memory.ts.
export const MEMORY_RECALL_BUDGETS = ["low", "mid", "high"] as const;
export type MemoryRecallBudget = (typeof MEMORY_RECALL_BUDGETS)[number];

export const MEMORY_RECALL_BUDGET_LIMITS: Record<MemoryRecallBudget, number> = {
  low: 3,
  mid: 10,
  high: 25,
};

export const MEMORY_SCOPE_FILTERS = ["self", "department", "all"] as const;
export type MemoryScopeFilter = (typeof MEMORY_SCOPE_FILTERS)[number];

// V2.6: future-reserved write capability scopes (curator-class agents).
export const MEMORY_WRITE_SCOPES = ["department", "task_chain", "active_context"] as const;
export type MemoryWriteScope = (typeof MEMORY_WRITE_SCOPES)[number];

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

// "write" kept for backward compat with existing entries — UI now uses "paste" for both paste and write
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
  "marketplace.install_completed",
  "marketplace.install_failed",
  "marketplace.install_requested",
  "marketplace.update_available",
  "marketplace.update_completed",
  "marketplace.update_failed",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// ── Routines ──────────────────────────────────────────────────────────

export const ISSUE_ORIGIN_KINDS = ["routine_execution"] as const;
export type IssueOriginKind = (typeof ISSUE_ORIGIN_KINDS)[number];

export const ROUTINE_STATUSES = ["active", "paused", "archived"] as const;
export type RoutineStatus = (typeof ROUTINE_STATUSES)[number];

export const ROUTINE_CONCURRENCY_POLICIES = [
  "coalesce_if_active",
  "always_enqueue",
  "skip_if_active",
] as const;
export type RoutineConcurrencyPolicy = (typeof ROUTINE_CONCURRENCY_POLICIES)[number];

export const ROUTINE_CATCH_UP_POLICIES = [
  "skip_missed",
  "enqueue_missed_with_cap",
] as const;
export type RoutineCatchUpPolicy = (typeof ROUTINE_CATCH_UP_POLICIES)[number];

export const ROUTINE_TRIGGER_KINDS = ["schedule", "webhook", "api"] as const;
export type RoutineTriggerKind = (typeof ROUTINE_TRIGGER_KINDS)[number];

export const ROUTINE_TRIGGER_SIGNING_MODES = ["bearer", "hmac_sha256"] as const;
export type RoutineTriggerSigningMode = (typeof ROUTINE_TRIGGER_SIGNING_MODES)[number];

export const ROUTINE_RUN_STATUSES = [
  "received",
  "issue_created",
  "coalesced",
  "skipped",
  "completed",
  "failed",
] as const;
export type RoutineRunStatus = (typeof ROUTINE_RUN_STATUSES)[number];

export const ROUTINE_RUN_SOURCES = ["schedule", "manual", "api", "webhook"] as const;
export type RoutineRunSource = (typeof ROUTINE_RUN_SOURCES)[number];

export const ROUTINE_VARIABLE_TYPES = ["text", "textarea", "number", "boolean", "select"] as const;
export type RoutineVariableType = (typeof ROUTINE_VARIABLE_TYPES)[number];

// ---------------------------------------------------------------------------
// Plugin system constants
// ---------------------------------------------------------------------------

export const PLUGIN_API_VERSION = 1 as const;

export const PLUGIN_STATUSES = [
  "installed",
  "ready",
  "disabled",
  "error",
  "upgrade_pending",
  "uninstalled",
] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

export const PLUGIN_CATEGORIES = [
  "connector",
  "ui",
  "automation",
  "workspace",
] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

export const PLUGIN_CAPABILITIES = [
  // Data read
  "companies.read",
  "projects.read",
  "project.workspaces.read",
  "issues.read",
  "issue.comments.read",
  "issue.documents.read",
  "agents.read",
  "goals.read",
  "activity.read",
  "costs.read",
  // Data write
  "issues.create",
  "issues.update",
  "issue.comments.create",
  "issue.documents.write",
  "activity.log.write",
  "metrics.write",
  "telemetry.track",
  // Plugin state
  "plugin.state.read",
  "plugin.state.write",
  // Integration
  "events.subscribe",
  "events.emit",
  "jobs.schedule",
  "webhooks.receive",
  "http.outbound",
  "secrets.read-ref",
  // Agent tools
  "agent.tools.register",
  // Agent control
  "agents.pause",
  "agents.resume",
  "agents.invoke",
  "agent.sessions.create",
  "agent.sessions.list",
  "agent.sessions.send",
  "agent.sessions.close",
  // Goals
  "goals.create",
  "goals.update",
  // UI
  "ui.sidebar.register",
  "ui.page.register",
  "ui.detailTab.register",
  "ui.dashboardWidget.register",
  "ui.commentAnnotation.register",
  "ui.action.register",
  // Instance
  "instance.settings.register",
] as const;
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export const PLUGIN_UI_SLOT_TYPES = [
  "sidebar",
  "sidebarPanel",
  "projectSidebarItem",
  "page",
  "detailTab",
  "taskDetailView",
  "dashboardWidget",
  "globalToolbarButton",
  "toolbarButton",
  "contextMenuItem",
  "commentAnnotation",
  "commentContextMenuItem",
  "settingsPage",
] as const;
export type PluginUiSlotType = (typeof PLUGIN_UI_SLOT_TYPES)[number];

export const PLUGIN_UI_SLOT_ENTITY_TYPES = [
  "project",
  "issue",
  "comment",
] as const;
export type PluginUiSlotEntityType = (typeof PLUGIN_UI_SLOT_ENTITY_TYPES)[number];

export const PLUGIN_STATE_SCOPE_KINDS = [
  "instance",
  "company",
  "project",
  "issue",
] as const;
export type PluginStateScopeKind = (typeof PLUGIN_STATE_SCOPE_KINDS)[number];

export const PLUGIN_LAUNCHER_PLACEMENT_ZONES = [
  "page",
  "detailTab",
  "taskDetailView",
  "dashboardWidget",
  "sidebar",
  "sidebarPanel",
  "projectSidebarItem",
  "globalToolbarButton",
  "toolbarButton",
  "contextMenuItem",
  "commentAnnotation",
  "commentContextMenuItem",
  "settingsPage",
] as const;
export type PluginLauncherPlacementZone = (typeof PLUGIN_LAUNCHER_PLACEMENT_ZONES)[number];

export const PLUGIN_LAUNCHER_ACTIONS = [
  "navigate",
  "deepLink",
  "performAction",
  "openModal",
  "openDrawer",
  "openPopover",
] as const;
export type PluginLauncherAction = (typeof PLUGIN_LAUNCHER_ACTIONS)[number];

export const PLUGIN_LAUNCHER_BOUNDS = [
  "default",
  "compact",
  "wide",
  "full",
  "inline",
] as const;
export type PluginLauncherBounds = (typeof PLUGIN_LAUNCHER_BOUNDS)[number];

export const PLUGIN_LAUNCHER_RENDER_ENVIRONMENTS = [
  "hostOverlay",
  "iframe",
] as const;
export type PluginLauncherRenderEnvironment = (typeof PLUGIN_LAUNCHER_RENDER_ENVIRONMENTS)[number];

export const PLUGIN_EVENT_TYPES = [
  "issue.created",
  "issue.updated",
  "issue.deleted",
  "project.created",
  "project.updated",
  "project.deleted",
  "agent.created",
  "agent.updated",
  "agent.run.started",
  "agent.run.completed",
  "goal.created",
  "goal.updated",
  "goal.deleted",
] as const;
export type PluginEventType = (typeof PLUGIN_EVENT_TYPES)[number];

export const PLUGIN_JOB_STATUSES = ["active", "paused", "failed"] as const;
export type PluginJobStatus = (typeof PLUGIN_JOB_STATUSES)[number];

export const PLUGIN_JOB_RUN_STATUSES = [
  "pending",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type PluginJobRunStatus = (typeof PLUGIN_JOB_RUN_STATUSES)[number];

export const PLUGIN_JOB_RUN_TRIGGERS = ["schedule", "manual", "retry"] as const;
export type PluginJobRunTrigger = (typeof PLUGIN_JOB_RUN_TRIGGERS)[number];

export const PLUGIN_WEBHOOK_DELIVERY_STATUSES = ["pending", "success", "failed"] as const;
export type PluginWebhookDeliveryStatus = (typeof PLUGIN_WEBHOOK_DELIVERY_STATUSES)[number];

export const PLUGIN_BRIDGE_ERROR_CODES = [
  "WORKER_UNAVAILABLE",
  "CAPABILITY_DENIED",
  "TIMEOUT",
  "WORKER_ERROR",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "UNKNOWN",
] as const;
export type PluginBridgeErrorCode = (typeof PLUGIN_BRIDGE_ERROR_CODES)[number];
