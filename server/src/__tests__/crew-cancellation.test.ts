/**
 * Plan 3 Task 7 — in-flight cancellation reaches internal_agent_runs.
 *
 * Contract test: the crew cancellation helpers exported by heartbeat.ts
 * must cancel internal_agent_runs records when invoked.
 *
 * Uses a comprehensive drizzle mock that covers .as() and template literals
 * so heartbeat.ts's module-level code doesn't crash during load.
 */
import { describe, it, expect, vi } from "vitest";

// ── Mocks (must be hoisted) ─────────────────────────────────────────────────
vi.mock("drizzle-orm", () => {
  const makeSql = () => {
    const s: any = function (..._args: any[]) { return s; };
    s.as = () => s;
    s.mapWith = () => s;
    return s;
  };
  const sql = makeSql();
  return {
    and: (...args: unknown[]) => ({ op: "and", args }),
    eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
    inArray: (col: unknown, vals: unknown) => ({ op: "inArray", col, vals }),
    asc: (col: unknown) => ({ op: "asc", col }),
    desc: (col: unknown) => ({ op: "desc", col }),
    or: (...args: unknown[]) => ({ op: "or", args }),
    gt: (a: unknown, b: unknown) => ({ op: "gt", a, b }),
    lte: (a: unknown, b: unknown) => ({ op: "lte", a, b }),
    ne: (a: unknown, b: unknown) => ({ op: "ne", a, b }),
    sql,
    not: (x: unknown) => ({ op: "not", x }),
    count: () => sql,
    isNull: (a: unknown) => ({ op: "isNull", a }),
    notInArray: (col: unknown, vals: unknown) => ({ op: "notInArray", col, vals }),
    lt: (a: unknown, b: unknown) => ({ op: "lt", a, b }),
    relations: () => ({}),
  };
});

vi.mock("@armyofagents/db", () => {
  const t = (n: string) =>
    new Proxy({}, { get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined) });
  return {
    agents: t("agents"),
    agentRuntimeState: t("agentRuntimeState"),
    agentTaskSessions: t("agentTaskSessions"),
    agentWakeupRequests: t("agentWakeupRequests"),
    heartbeatRunEvents: t("heartbeatRunEvents"),
    heartbeatRuns: t("heartbeatRuns"),
    costEvents: t("costEvents"),
    environments: t("environments"),
    issues: t("issues"),
    projectWorkspaces: t("projectWorkspaces"),
    memoryItems: t("memoryItems"),
    companies: t("companies"),
    taskDependencies: t("taskDependencies"),
    issueAttachments: t("issueAttachments"),
    issueComments: t("issueComments"),
    assets: t("assets"),
    projects: t("projects"),
    companySkills: t("companySkills"),
    teamMembers: t("teamMembers"),
    teamCoordinations: t("teamCoordinations"),
    teams: t("teams"),
    internalAgentRuns: t("internalAgentRuns"),
    aoaAgentTriggers: t("aoaAgentTriggers"),
    // misc tables referenced transitively
    discussions: t("discussions"),
    discussionEntries: t("discussionEntries"),
    internalAgentConfig: t("internalAgentConfig"),
    internalAgentMessages: t("internalAgentMessages"),
    internalAgentRuns: t("internalAgentRuns"),
    internalAgentConversations: t("internalAgentConversations"),
    notifications: t("notifications"),
    boardApiKeys: t("boardApiKeys"),
    userRoles: t("userRoles"),
    instanceUserRoles: t("instanceUserRoles"),
    mcpApiKeys: t("mcpApiKeys"),
    mcpClientConnections: t("mcpClientConnections"),
    budgetPolicies: t("budgetPolicies"),
    budgetIncidents: t("budgetIncidents"),
    providerQuotaWindows: t("providerQuotaWindows"),
    financeEvents: t("financeEvents"),
    issueLabels: t("issueLabels"),
    labels: t("labels"),
    issueApprovals: t("issueApprovals"),
    issueDocuments: t("issueDocuments"),
    issueReadStates: t("issueReadStates"),
    issueAttachments: t("issueAttachments"),
    issueComments: t("issueComments"),
    routines: t("routines"),
    artifacts: t("artifacts"),
    artifactVersions: t("artifactVersions"),
    documents: t("documents"),
    documentRevisions: t("documentRevisions"),
    assets: t("assets"),
    feedbackVotes: t("feedbackVotes"),
    feedbackExports: t("feedbackExports"),
    approvals: t("approvals"),
    approvalComments: t("approvalComments"),
    activityLog: t("activityLog"),
    suggestions: t("suggestions"),
    workflowTemplates: t("workflowTemplates"),
    invites: t("invites"),
    joinRequests: t("joinRequests"),
    companyMemberships: t("companyMemberships"),
    companySecrets: t("companySecrets"),
    companySecretVersions: t("companySecretVersions"),
    plugins: t("plugins"),
    pluginConfig: t("pluginConfig"),
    pluginEntities: t("pluginEntities"),
    pluginState: t("pluginState"),
    pluginJobs: t("pluginJobs"),
    pluginLogs: t("pluginLogs"),
    pluginWebhooks: t("pluginWebhooks"),
    pluginVersionSnapshots: t("pluginVersionSnapshots"),
    pluginCompanySettings: t("pluginCompanySettings"),
    principalPermissionGrants: t("principalPermissionGrants"),
    marketplaceCatalogCache: t("marketplaceCatalogCache"),
    marketplaceCompanySettings: t("marketplaceCompanySettings"),
    marketplaceInstallOperations: t("marketplaceInstallOperations"),
    marketplacePendingUpdates: t("marketplacePendingUpdates"),
    agentApiKeys: t("agentApiKeys"),
    agentConfigRevisions: t("agentConfigRevisions"),
    agentProjects: t("agentProjects"),
    agentRuntimeState: t("agentRuntimeState"),
    agentTaskSessions: t("agentTaskSessions"),
    agentWakeupRequests: t("agentWakeupRequests"),
    aoaAgentTriggers: t("aoaAgentTriggers"),
    auth: t("auth"),
    cliAuthChallenges: t("cliAuthChallenges"),
    executionWorkspaces: t("executionWorkspaces"),
    fileImportJobs: t("fileImportJobs"),
    goals: t("goals"),
    heartbeatRuns: t("heartbeatRuns"),
    heartbeatRunEvents: t("heartbeatRunEvents"),
    heartbeatRunWatchdogDecisions: t("heartbeatRunWatchdogDecisions"),
    inboxDismissals: t("inboxDismissals"),
    internalAgentReminders: t("internalAgentReminders"),
    internalAgentRuns: t("internalAgentRuns"),
    memoryAssets: t("memoryAssets"),
    memoryExtractionBatches: t("memoryExtractionBatches"),
    memoryExtractions: t("memoryExtractions"),
    memoryFeedbackPatterns: t("memoryFeedbackPatterns"),
    memoryFolders: t("memoryFolders"),
    memoryItemVersions: t("memoryItemVersions"),
    memoryItems: t("memoryItems"),
    memoryRelations: t("memoryRelations"),
    memoryRetrievals: t("memoryRetrievals"),
    projectGoals: t("projectGoals"),
    sidebarPreferences: t("sidebarPreferences"),
    taskDependencies: t("taskDependencies"),
    teams: t("teams"),
    teamMembers: t("teamMembers"),
    teamCoordinations: t("teamCoordinations"),
    workspaceOperations: t("workspaceOperations"),
    workspaceRuntimeServices: t("workspaceRuntimeServices"),
    companySkills: t("companySkills"),
  };
});

// Mock heavy service dependencies that heartbeat.ts imports
vi.mock("../services/secrets.js", () => ({ secretService: () => ({}) }));
vi.mock("../services/costs.js", () => ({ costService: () => ({}) }));
vi.mock("../services/output-detection.js", () => ({ outputDetectionService: () => ({}) }));
vi.mock("../services/workspace.js", () => ({
  executionWorkspaceService: () => ({}),
  workspaceOperationService: () => ({}),
}));
vi.mock("../services/instance-settings.js", () => ({ instanceSettingsService: () => ({}) }));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDb() {
  const capturedSets: Array<Record<string, unknown>> = [];
  const db: any = {
    update: (_table: unknown) => ({
      set: (vals: Record<string, unknown>) => {
        capturedSets.push(vals);
        return { where: () => Promise.resolve([]) };
      },
    }),
    _capturedSets: capturedSets,
  };
  return db;
}

describe("cancelCrewRunsForAgent", () => {
  it("cancels internal_agent_runs for the given agentId", async () => {
    const { cancelCrewRunsForAgent } = await import("../services/heartbeat.js");
    const db = makeDb();
    await cancelCrewRunsForAgent(db, "agent-abc");
    expect(db._capturedSets.length).toBeGreaterThan(0);
    expect(db._capturedSets.some((s: any) => s.status === "cancelled")).toBe(true);
  });
});

describe("cancelCrewRunsForCompany", () => {
  it("cancels internal_agent_runs for the given companyId", async () => {
    const { cancelCrewRunsForCompany } = await import("../services/heartbeat.js");
    const db = makeDb();
    await cancelCrewRunsForCompany(db, "co-xyz");
    expect(db._capturedSets.length).toBeGreaterThan(0);
    expect(db._capturedSets.some((s: any) => s.status === "cancelled")).toBe(true);
  });
});
