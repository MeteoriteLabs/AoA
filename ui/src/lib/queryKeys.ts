export const queryKeys = {
  companies: {
    all: ["companies"] as const,
    detail: (id: string) => ["companies", id] as const,
    stats: ["companies", "stats"] as const,
  },
  agents: {
    list: (companyId: string) => ["agents", companyId] as const,
    detail: (id: string) => ["agents", "detail", id] as const,
    runtimeState: (id: string) => ["agents", "runtime-state", id] as const,
    taskSessions: (id: string) => ["agents", "task-sessions", id] as const,
    keys: (agentId: string) => ["agents", "keys", agentId] as const,
    configRevisions: (agentId: string) => ["agents", "config-revisions", agentId] as const,
    adapterModels: (companyId: string, adapterType: string) =>
      ["agents", companyId, "adapter-models", adapterType] as const,
  },
  issues: {
    list: (companyId: string) => ["issues", companyId] as const,
    search: (companyId: string, q: string, projectId?: string) =>
      ["issues", companyId, "search", q, projectId ?? "__all-projects__"] as const,
    listAssignedToMe: (companyId: string) => ["issues", companyId, "assigned-to-me"] as const,
    listTouchedByMe: (companyId: string) => ["issues", companyId, "touched-by-me"] as const,
    listUnreadTouchedByMe: (companyId: string) => ["issues", companyId, "unread-touched-by-me"] as const,
    labels: (companyId: string) => ["issues", companyId, "labels"] as const,
    listByProject: (companyId: string, projectId: string) =>
      ["issues", companyId, "project", projectId] as const,
    detail: (id: string) => ["issues", "detail", id] as const,
    comments: (issueId: string) => ["issues", "comments", issueId] as const,
    attachments: (issueId: string) => ["issues", "attachments", issueId] as const,
    activity: (issueId: string) => ["issues", "activity", issueId] as const,
    runs: (issueId: string) => ["issues", "runs", issueId] as const,
    approvals: (issueId: string) => ["issues", "approvals", issueId] as const,
    liveRuns: (issueId: string) => ["issues", "live-runs", issueId] as const,
    activeRun: (issueId: string) => ["issues", "active-run", issueId] as const,
    dependencies: (issueId: string) => ["issues", "dependencies", issueId] as const,
  },
  projects: {
    list: (companyId: string) => ["projects", companyId] as const,
    detail: (id: string) => ["projects", "detail", id] as const,
    agents: (projectId: string) => ["projects", "agents", projectId] as const,
    budget: (projectId: string) => ["projects", "budget", projectId] as const,
  },
  goals: {
    list: (companyId: string) => ["goals", companyId] as const,
    listByProject: (companyId: string, projectId: string) =>
      ["goals", companyId, "project", projectId] as const,
    detail: (id: string) => ["goals", "detail", id] as const,
  },
  approvals: {
    list: (companyId: string, status?: string) =>
      ["approvals", companyId, status] as const,
    detail: (approvalId: string) => ["approvals", "detail", approvalId] as const,
    comments: (approvalId: string) => ["approvals", "comments", approvalId] as const,
    issues: (approvalId: string) => ["approvals", "issues", approvalId] as const,
  },
  trustScores: {
    list: (companyId: string) => ["trust-scores", companyId] as const,
    detail: (companyId: string, agentId: string) => ["trust-scores", companyId, agentId] as const,
  },
  access: {
    joinRequests: (companyId: string, status: string = "pending_approval") =>
      ["access", "join-requests", companyId, status] as const,
    invite: (token: string) => ["access", "invite", token] as const,
  },
  team: {
    summary: (companyId: string) => ["team", companyId] as const,
  },
  auth: {
    session: ["auth", "session"] as const,
  },
  health: ["health"] as const,
  secrets: {
    list: (companyId: string) => ["secrets", companyId] as const,
    providers: (companyId: string) => ["secret-providers", companyId] as const,
  },
  dashboard: (companyId: string) => ["dashboard", companyId] as const,
  home: (companyId: string) => ["home", companyId] as const,
  sidebarBadges: (companyId: string) => ["sidebar-badges", companyId] as const,
  activity: (companyId: string) => ["activity", companyId] as const,
  costs: (companyId: string, from?: string, to?: string) =>
    ["costs", companyId, from, to] as const,
  heartbeats: (companyId: string, agentId?: string) =>
    ["heartbeats", companyId, agentId] as const,
  liveRuns: (companyId: string) => ["live-runs", companyId] as const,
  runIssues: (runId: string) => ["run-issues", runId] as const,
  org: Object.assign(
    (companyId: string) => ["org", companyId] as const,
    { tree: (companyId: string) => ["org", companyId, "tree"] as const },
  ),
  memory: {
    list: (companyId: string) => ["memory", companyId] as const,
    pending: (companyId: string) => ["memory", companyId, "pending"] as const,
    detail: (companyId: string, id: string) => ["memory", companyId, id] as const,
    versions: (companyId: string, id: string) => ["memory", companyId, id, "versions"] as const,
    semanticSearch: (companyId: string, q: string) => ["memory", companyId, "semantic-search", q] as const,
  },
  search: {
    global: (companyId: string, query: string, includeArchived = false) =>
      ["search", companyId, query, includeArchived ? "archived" : "default"] as const,
  },
  suggestions: {
    pending: (companyId: string) => ["suggestions", companyId, "pending"] as const,
  },
  debriefs: {
    list: (companyId: string) => ["debriefs", companyId] as const,
    detail: (companyId: string, id: string) => ["debriefs", companyId, id] as const,
  },
  discussions: {
    list: (companyId: string) => ["discussions", companyId] as const,
    detail: (companyId: string, id: string) => ["discussions", companyId, id] as const,
  },
  agentGreeting: (companyId: string) => ["agent-greeting", companyId] as const,
  agentConversation: (companyId: string) => ["agent-conversation", companyId] as const,
  agentConfig: (companyId: string) => ["agent-config", companyId] as const,
  agentRuns: (companyId: string) => ["agent-runs", companyId] as const,
  agentReminders: (companyId: string) => ["agent-reminders", companyId] as const,
  notifications: (companyId: string) => ["notifications", companyId] as const,
  workflowTemplates: {
    list: (companyId: string) => ["workflow-templates", companyId] as const,
    detail: (companyId: string, id: string) => ["workflow-templates", companyId, id] as const,
  },
  briefs: {
    list: (companyId: string) => ["briefs", companyId] as const,
    detail: (companyId: string, id: string) => ["briefs", companyId, id] as const,
  },
  artifacts: {
    byIssue: (issueId: string) => ["artifacts", "issue", issueId] as const,
    detail: (id: string) => ["artifacts", "detail", id] as const,
  },
  mcp: {
    status: (companyId: string) => ["mcp", companyId, "status"] as const,
    keys: (companyId: string) => ["mcp", companyId, "keys"] as const,
    clients: (companyId: string) => ["mcp", companyId, "clients"] as const,
  },
  detectedOutputs: {
    byIssue: (issueId: string) => ["detected-outputs", "issue", issueId] as const,
    byRun: (runId: string) => ["detected-outputs", "run", runId] as const,
  },
};
