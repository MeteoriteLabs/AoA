import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import {
  commanderTrustRulesApi,
  internalAgentApi,
  toolPermissionsApi,
} from "@/api/internal-agent";
import type {
  CommanderToolPermission,
  CommanderTrustRule,
} from "@/api/internal-agent";
import { queryKeys } from "@/lib/queryKeys";
import { formatCents, budgetProgressColor, relativeTime, formatTokens } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  AGENT_CAPABILITIES,
  CLI_TOOLS,
  NOTIFICATION_PREFERENCES,
} from "@armyofagents/shared";
import type {
  AgentCapability,
  NotificationPreference,
  UpdateInternalAgentConfig,
} from "@armyofagents/shared";
import {
  CommanderSubTabs,
  CommanderSubTabsMobile,
  useCommanderSubTab,
} from "./CommanderSubTabs";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CAPABILITY_LABELS: Record<AgentCapability, string> = {
  discussion_processing: "Discussion Processing",
  proactive_suggestions: "Proactive Suggestions",
  organizational_queries: "Organizational Queries",
  system_actions: "System Actions",
  context_briefing: "Context Briefing",
  memory_management: "Memory Management",
  conflict_detection: "Conflict Detection",
  budget_awareness: "Budget Awareness",
  workflow_coaching: "Workflow Coaching",
  workflow_discovery: "Workflow Discovery",
  cross_department_coordination: "Cross-Department Coordination",
  department_personas: "Department Personas",
};

const CAPABILITY_GROUPS = [
  {
    label: "Core",
    caps: [
      "discussion_processing",
      "organizational_queries",
      "system_actions",
    ] as AgentCapability[],
  },
  {
    label: "Intelligence",
    caps: [
      "proactive_suggestions",
      "context_briefing",
      "memory_management",
      "conflict_detection",
    ] as AgentCapability[],
  },
  {
    label: "Operations",
    caps: [
      "budget_awareness",
      "workflow_coaching",
      "workflow_discovery",
    ] as AgentCapability[],
  },
  {
    label: "Coordination",
    caps: [
      "cross_department_coordination",
      "department_personas",
    ] as AgentCapability[],
  },
];

const CONTEXT_BUDGET_OPTIONS = [
  { value: 4000, label: "Compact (4,000)" },
  { value: 8000, label: "Standard (8,000)" },
  { value: 16000, label: "Large (16,000)" },
];

const NOTIFICATION_LABELS: Record<
  NotificationPreference,
  { label: string; description: string }
> = {
  silent: { label: "Silent", description: "No notifications" },
  digest: { label: "Digest", description: "Batched summary" },
  realtime: { label: "Real-time", description: "Instant notifications" },
};

/* ------------------------------------------------------------------ */
/*  Per-tab save button                                                */
/* ------------------------------------------------------------------ */

function TabSaveButton({
  onClick,
  isPending,
  saveMessage,
}: {
  onClick: () => void;
  isPending: boolean;
  saveMessage: string | null;
}) {
  return (
    <div className="pt-4 flex items-center gap-3">
      <Button onClick={onClick} disabled={isPending}>
        {isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
        Save
      </Button>
      {saveMessage && (
        <span
          className={`text-sm ${saveMessage === "Settings saved" ? "text-emerald-600" : "text-red-600"}`}
        >
          {saveMessage}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function CommanderSection() {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const { active, setActive } = useCommanderSubTab();

  // Form state
  // Sprint 2A (Decision #91) removed API-mode execution from the Commander
  // path; CLI is now the only dispatch. executionMode stays in the DB schema
  // for rollback/audit but is always written as 'cli' here.
  const [cliTool, setCliTool] = useState<string>("claude_cli");
  const [enabledCapabilities, setEnabledCapabilities] = useState<string[]>([
    ...AGENT_CAPABILITIES,
  ]);
  const [notificationPreference, setNotificationPreference] =
    useState<NotificationPreference>("realtime");
  const [contextTokenBudget, setContextTokenBudget] = useState<number>(8000);
  const [budgetMonthlyCents, setBudgetMonthlyCents] = useState<number>(5000);
  const [cheapModel, setCheapModel] = useState<string>("");
  const [proactiveIntervalMinutes, setProactiveIntervalMinutes] =
    useState<number>(240);
  const [runtimeApprovalsEnabled, setRuntimeApprovalsEnabled] =
    useState<boolean>(true);
  const [runtimeAllowAlwaysEnabled, setRuntimeAllowAlwaysEnabled] =
    useState<boolean>(true);
  const [vendorCliBypassEnabled, setVendorCliBypassEnabled] =
    useState<boolean>(true);

  // Connection test
  const [connectionStatus, setConnectionStatus] = useState<
    "untested" | "loading" | "success" | "failed"
  >("untested");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Per-tab save feedback
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!saveMessage) return;
    const timer = setTimeout(() => setSaveMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [saveMessage]);

  // --- Queries ---

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: queryKeys.agentConfig(selectedCompanyId!),
    queryFn: () => internalAgentApi.getConfig(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const {
    data: runsPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: queryKeys.agentRuns(selectedCompanyId!),
    queryFn: ({ pageParam = 0 }) =>
      internalAgentApi.getRuns(selectedCompanyId!, {
        limit: 20,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.runs.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: !!selectedCompanyId && active === "history",
  });

  // Permissions tab state
  const { data: permissionsData, isLoading: permissionsLoading } = useQuery({
    queryKey: ["commander-tool-permissions", selectedCompanyId],
    queryFn: () => toolPermissionsApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId && active === "permissions",
  });

  const { data: trustRulesData, isLoading: trustRulesLoading } = useQuery({
    queryKey: ["commander-tool-trust-rules", selectedCompanyId],
    queryFn: () => commanderTrustRulesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && active === "trusted-actions",
  });

  const [permissionEdits, setPermissionEdits] = useState<Record<string, Partial<CommanderToolPermission>>>({});

  const updatePermissionsMutation = useMutation({
    mutationFn: (perms: Record<string, CommanderToolPermission>) =>
      toolPermissionsApi.update(selectedCompanyId!, perms),
    onSuccess: () => {
      setPermissionEdits({});
      queryClient.invalidateQueries({ queryKey: ["commander-tool-permissions"] });
    },
  });

  const revokeTrustRuleMutation = useMutation({
    mutationFn: (ruleId: string) =>
      commanderTrustRulesApi.revoke(selectedCompanyId!, ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["commander-tool-trust-rules", selectedCompanyId],
      });
    },
  });

  const KNOWN_TOOLS = [
    "update_company_identity",
    "create_task",
    "update_task",
    "create_goal",
    "extract_from_content",
    "query_company",
    "query_tasks",
    "query_agents",
    "use_skill",
    "delegate_to_subagent",
  ];

  const defaultPerm: CommanderToolPermission = permissionsData?.default ?? {
    enabled: true,
    requireConfirmation: false,
    minimumRole: "team_member" as const,
  };

  function getEffectivePerm(toolName: string): CommanderToolPermission {
    const stored = permissionsData?.permissions[toolName] ?? defaultPerm;
    const edited = permissionEdits[toolName] ?? {};
    return { ...stored, ...edited };
  }

  function handlePermEdit(toolName: string, field: keyof CommanderToolPermission, value: unknown) {
    setPermissionEdits((prev) => ({
      ...prev,
      [toolName]: { ...(prev[toolName] ?? {}), [field]: value },
    }));
  }

  function handlePermissionsSave() {
    const merged: Record<string, CommanderToolPermission> = {};
    for (const tool of KNOWN_TOOLS) {
      merged[tool] = getEffectivePerm(tool);
    }
    updatePermissionsMutation.mutate(merged);
  }

  // Sync form from config
  useEffect(() => {
    if (!config) return;
    if (config.cliTool) setCliTool(config.cliTool);
    setEnabledCapabilities([...config.enabledCapabilities]);
    setNotificationPreference(
      config.notificationPreference as NotificationPreference,
    );
    setContextTokenBudget(config.contextTokenBudget);
    setBudgetMonthlyCents(config.budgetMonthlyCents ?? 5000);
    setCheapModel(config.cheapModel ?? "");
    setRuntimeApprovalsEnabled(config.runtimeApprovalsEnabled ?? true);
    setRuntimeAllowAlwaysEnabled(config.runtimeAllowAlwaysEnabled ?? true);
    setVendorCliBypassEnabled(config.vendorCliBypassEnabled ?? true);
    if (config.proactiveIntervalMinutes != null) {
      setProactiveIntervalMinutes(config.proactiveIntervalMinutes);
    }
  }, [config]);

  // Derived: flatten all pages into a single runs array + aggregates from first page
  const allRuns = runsPages?.pages.flatMap((p) => p.runs) ?? [];
  const runsAggregates = runsPages?.pages[0]?.aggregates;

  // --- Mutations ---

  const saveMutation = useMutation({
    mutationFn: (fields: UpdateInternalAgentConfig) =>
      internalAgentApi.updateConfig(selectedCompanyId!, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.agentConfig(selectedCompanyId!),
      });
      setSaveMessage("Settings saved");
    },
    onError: (err: Error) => {
      setSaveMessage(err.message || "Failed to save settings");
    },
  });

  function saveExecution() {
    saveMutation.mutate({
      executionMode: "cli",
      cliTool,
      runtimeApprovalsEnabled,
      runtimeAllowAlwaysEnabled,
      vendorCliBypassEnabled,
    });
  }

  function saveCapabilities() {
    saveMutation.mutate({
      enabledCapabilities: enabledCapabilities as AgentCapability[],
      notificationPreference,
      contextTokenBudget,
      proactiveIntervalMinutes,
    });
  }

  function saveBudget() {
    saveMutation.mutate({
      budgetMonthlyCents,
      cheapModel: cheapModel.trim() || null,
    });
  }

  // --- Handlers ---

  async function handleTestConnection() {
    setConnectionStatus("loading");
    setConnectionError(null);
    try {
      const result = await internalAgentApi.testConnection(selectedCompanyId!);
      if (result.success) {
        setConnectionStatus("success");
      } else {
        setConnectionStatus("failed");
        setConnectionError(result.error ?? "Connection failed");
      }
    } catch (err: unknown) {
      setConnectionStatus("failed");
      setConnectionError(
        err instanceof Error ? err.message : "Connection failed",
      );
    }
  }

  function toggleCapability(cap: string) {
    setEnabledCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap],
    );
  }

  function toggleAll() {
    if (enabledCapabilities.length === AGENT_CAPABILITIES.length) {
      setEnabledCapabilities([]);
    } else {
      setEnabledCapabilities([...AGENT_CAPABILITIES]);
    }
  }

  // --- Budget calculations ---

  const spentCents = config?.spentMonthlyCents ?? 0;
  const utilization =
    budgetMonthlyCents > 0 ? (spentCents / budgetMonthlyCents) * 100 : 0;
  const progressColor = budgetProgressColor(utilization);

  // --- Loading ---

  if (configLoading) {
    return <PageSkeleton variant="detail" />;
  }

  // --- Render ---

  return (
    <div>
      {/* Section header */}
      <div className="px-8 pt-6 pb-3 border-b border-border">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/60 font-semibold">
          Settings · Operations
        </div>
        <h2 className="text-[1.4rem] font-bold tracking-tight mt-1">
          Commander<span className="text-brand">.</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Internal-agent execution, capabilities, budget, and run history.
        </p>
      </div>

      {/* Desktop sub-tabs */}
      <div className="hidden md:block">
        <CommanderSubTabs active={active} onSelect={setActive} />
      </div>

      {/* Mobile sub-tabs */}
      <CommanderSubTabsMobile active={active} onSelect={setActive} />

      {/* Sub-tab content */}
      <div className="p-8">
        {active === "execution" && (
          <ExecutionTabContent
            cliTool={cliTool}
            setCliTool={setCliTool}
            connectionStatus={connectionStatus}
            connectionError={connectionError}
            handleTestConnection={handleTestConnection}
            runtimeApprovalsEnabled={runtimeApprovalsEnabled}
            setRuntimeApprovalsEnabled={setRuntimeApprovalsEnabled}
            runtimeAllowAlwaysEnabled={runtimeAllowAlwaysEnabled}
            setRuntimeAllowAlwaysEnabled={setRuntimeAllowAlwaysEnabled}
            vendorCliBypassEnabled={vendorCliBypassEnabled}
            setVendorCliBypassEnabled={setVendorCliBypassEnabled}
            saveExecution={saveExecution}
            isPending={saveMutation.isPending}
            saveMessage={saveMessage}
          />
        )}
        {active === "capabilities" && (
          <CapabilitiesTabContent
            enabledCapabilities={enabledCapabilities}
            toggleCapability={toggleCapability}
            toggleAll={toggleAll}
            notificationPreference={notificationPreference}
            setNotificationPreference={setNotificationPreference}
            contextTokenBudget={contextTokenBudget}
            setContextTokenBudget={setContextTokenBudget}
            proactiveIntervalMinutes={proactiveIntervalMinutes}
            setProactiveIntervalMinutes={setProactiveIntervalMinutes}
            saveCapabilities={saveCapabilities}
            isPending={saveMutation.isPending}
            saveMessage={saveMessage}
          />
        )}
        {active === "budget" && (
          <BudgetTabContent
            budgetMonthlyCents={budgetMonthlyCents}
            setBudgetMonthlyCents={setBudgetMonthlyCents}
            cheapModel={cheapModel}
            setCheapModel={setCheapModel}
            spentCents={spentCents}
            utilization={utilization}
            progressColor={progressColor}
            saveBudget={saveBudget}
            isPending={saveMutation.isPending}
            saveMessage={saveMessage}
          />
        )}
        {active === "history" && (
          <RunHistoryTabContent
            allRuns={allRuns}
            runsAggregates={runsAggregates}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
          />
        )}
        {active === "permissions" && (
          <div className="space-y-4">
            {permissionsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading tool permissions...
              </div>
            ) : (
              <>
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                  <p className="text-xs text-amber-900">
                    <strong>Note:</strong> Per-tool permissions are stored. Runtime enforcement: Claude CLI gates write tools strictly via structured tool events; codex and opencode use best-effort marker detection. For guaranteed gating, set Commander to Claude CLI under Execution &amp; Model.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Control which tools Commander can use and what level of access each requires.
                </p>
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Tool</th>
                        <th className="px-3 py-2 text-center font-medium text-xs text-muted-foreground w-20">Enabled</th>
                        <th className="px-3 py-2 text-center font-medium text-xs text-muted-foreground w-24">Confirm</th>
                        <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground w-36">Min Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {KNOWN_TOOLS.map((toolName) => {
                        const perm = getEffectivePerm(toolName);
                        return (
                          <tr key={toolName} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2 font-mono text-xs">{toolName}</td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={perm.enabled}
                                onChange={(e) => handlePermEdit(toolName, "enabled", e.target.checked)}
                                className="rounded"
                                aria-label={`Enable Commander to use ${toolName}`}
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={perm.requireConfirmation}
                                onChange={(e) => handlePermEdit(toolName, "requireConfirmation", e.target.checked)}
                                className="rounded"
                                aria-label={`Require confirmation for ${toolName}`}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={perm.minimumRole}
                                onChange={(e) => handlePermEdit(toolName, "minimumRole", e.target.value)}
                                className="text-xs border border-border rounded px-1.5 py-0.5 bg-background"
                                aria-label={`Minimum role for ${toolName}`}
                              >
                                <option value="team_member">Member</option>
                                <option value="team_lead">Lead</option>
                                <option value="founder">Founder</option>
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handlePermissionsSave}
                    disabled={updatePermissionsMutation.isPending || Object.keys(permissionEdits).length === 0}
                  >
                    {updatePermissionsMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    Save permissions
                  </Button>
                </div>
                {updatePermissionsMutation.isSuccess && (
                  <p className="text-xs text-green-600">Permissions saved.</p>
                )}
              </>
            )}
          </div>
        )}
        {active === "trusted-actions" && (
          <TrustedActionsTabContent
            rules={trustRulesData?.rules ?? []}
            isLoading={trustRulesLoading}
            revokeRule={(ruleId) => revokeTrustRuleMutation.mutate(ruleId)}
            revokingRuleId={
              revokeTrustRuleMutation.isPending
                ? revokeTrustRuleMutation.variables
                : null
            }
            error={
              revokeTrustRuleMutation.isError
                ? revokeTrustRuleMutation.error.message
                : null
            }
          />
        )}
      </div>
    </div>
  );
}

function TrustedActionsTabContent({
  rules,
  isLoading,
  revokeRule,
  revokingRuleId,
  error,
}: {
  rules: CommanderTrustRule[];
  isLoading: boolean;
  revokeRule: (ruleId: string) => void;
  revokingRuleId: string | null;
  error: string | null;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading trusted actions...
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        No trusted Commander actions yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Revoke exact actions that were approved with allow always. Fingerprints
        identify the saved tool parameters without exposing the original values.
      </p>
      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">
                Tool
              </th>
              <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">
                Fingerprint
              </th>
              <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">
                Created
              </th>
              <th className="px-3 py-2 text-right font-medium text-xs text-muted-foreground">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td className="px-3 py-2 font-mono text-xs">{rule.toolName}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {rule.paramsHashVersion}:{rule.paramsHashPrefix}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {relativeTime(rule.createdAt)}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revokeRule(rule.id)}
                    disabled={revokingRuleId === rule.id}
                  >
                    {revokingRuleId === rule.id ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Execution Tab                                                      */
/* ------------------------------------------------------------------ */

interface ExecutionTabContentProps {
  cliTool: string;
  setCliTool: (v: string) => void;
  connectionStatus: "untested" | "loading" | "success" | "failed";
  connectionError: string | null;
  handleTestConnection: () => Promise<void>;
  runtimeApprovalsEnabled: boolean;
  setRuntimeApprovalsEnabled: (v: boolean) => void;
  runtimeAllowAlwaysEnabled: boolean;
  setRuntimeAllowAlwaysEnabled: (v: boolean) => void;
  vendorCliBypassEnabled: boolean;
  setVendorCliBypassEnabled: (v: boolean) => void;
  saveExecution: () => void;
  isPending: boolean;
  saveMessage: string | null;
}

function ExecutionTabContent({
  cliTool,
  setCliTool,
  connectionStatus,
  connectionError,
  handleTestConnection,
  runtimeApprovalsEnabled,
  setRuntimeApprovalsEnabled,
  runtimeAllowAlwaysEnabled,
  setRuntimeAllowAlwaysEnabled,
  vendorCliBypassEnabled,
  setVendorCliBypassEnabled,
  saveExecution,
  isPending,
  saveMessage,
}: ExecutionTabContentProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Commander runs via your local CLI tool. No API key required — the CLI
        handles authentication and model selection itself.
      </p>

      {/* CLI Tool */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          CLI Tool
        </label>
        <Select value={cliTool} onValueChange={setCliTool}>
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLI_TOOLS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          Make sure the selected tool is installed and on your PATH.
        </p>
      </div>

      {/* Autonomy Level */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          Autonomy Level
        </label>
        <Select value="0" disabled>
          <SelectTrigger className="w-full max-w-xs" disabled>
            <SelectValue>Level 0 — Full Approval</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Level 0 — Full Approval</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground mt-1">
          Higher levels available in V3
        </p>
      </div>

      <div className="rounded-md border border-border p-3 space-y-3 max-w-xl">
        <p className="text-xs font-medium text-muted-foreground">
          Runtime Approvals
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={runtimeApprovalsEnabled}
            onChange={(e) => setRuntimeApprovalsEnabled(e.target.checked)}
            className="mt-0.5 rounded border-input"
            aria-label="Require AoA runtime approvals"
          />
          <span>
            <span className="font-medium">Require AoA runtime approvals</span>
            <span className="block text-xs text-muted-foreground">
              Show approval cards before Commander executes confirmation-gated tools.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={runtimeAllowAlwaysEnabled}
            onChange={(e) => setRuntimeAllowAlwaysEnabled(e.target.checked)}
            className="mt-0.5 rounded border-input"
            aria-label="Allow always for exact repeated actions"
          />
          <span>
            <span className="font-medium">Allow always for exact repeated actions</span>
            <span className="block text-xs text-muted-foreground">
              Let users trust the same tool with the same parameters until revoked.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={vendorCliBypassEnabled}
            onChange={(e) => setVendorCliBypassEnabled(e.target.checked)}
            className="mt-0.5 rounded border-input"
            aria-label="Bypass vendor CLI approval prompts"
          />
          <span>
            <span className="font-medium">Bypass vendor CLI approval prompts</span>
            <span className="block text-xs text-muted-foreground">
              Use AoA approvals as the primary gate instead of forwarding prompts to the CLI.
            </span>
          </span>
        </label>
      </div>

      {/* Test Connection */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTestConnection}
          disabled={connectionStatus === "loading"}
        >
          {connectionStatus === "loading" && (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          )}
          Test Connection
        </Button>
        {connectionStatus === "success" && (
          <span className="flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Connected
          </span>
        )}
        {connectionStatus === "failed" && (
          <span className="flex items-center gap-1 text-xs text-red-600">
            <XCircle className="h-3.5 w-3.5" />
            Failed
            {connectionError && (
              <span className="text-muted-foreground ml-1">
                — {connectionError}
              </span>
            )}
          </span>
        )}
      </div>

      <TabSaveButton
        onClick={saveExecution}
        isPending={isPending}
        saveMessage={saveMessage}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Capabilities Tab                                                   */
/* ------------------------------------------------------------------ */

interface CapabilitiesTabContentProps {
  enabledCapabilities: string[];
  toggleCapability: (cap: string) => void;
  toggleAll: () => void;
  notificationPreference: NotificationPreference;
  setNotificationPreference: (v: NotificationPreference) => void;
  contextTokenBudget: number;
  setContextTokenBudget: (v: number) => void;
  proactiveIntervalMinutes: number;
  setProactiveIntervalMinutes: (v: number) => void;
  saveCapabilities: () => void;
  isPending: boolean;
  saveMessage: string | null;
}

function CapabilitiesTabContent({
  enabledCapabilities,
  toggleCapability,
  toggleAll,
  notificationPreference,
  setNotificationPreference,
  contextTokenBudget,
  setContextTokenBudget,
  proactiveIntervalMinutes,
  setProactiveIntervalMinutes,
  saveCapabilities,
  isPending,
  saveMessage,
}: CapabilitiesTabContentProps) {
  return (
    <div className="space-y-4">
      {/* Capability checkboxes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-muted-foreground">
            Enabled Capabilities
          </label>
          <button
            className="text-xs text-primary hover:underline"
            onClick={toggleAll}
          >
            {enabledCapabilities.length === AGENT_CAPABILITIES.length
              ? "Deselect All"
              : "Select All"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {CAPABILITY_GROUPS.map((group) => (
            <div
              key={group.label}
              role="group"
              aria-label={`${group.label} capabilities`}
            >
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {group.label}
              </p>
              {group.caps.map((cap) => (
                <label
                  key={cap}
                  className="flex items-center gap-2 text-sm py-0.5"
                >
                  <input
                    type="checkbox"
                    data-capability={cap}
                    checked={enabledCapabilities.includes(cap)}
                    onChange={() => toggleCapability(cap)}
                    className="rounded border-input"
                  />
                  {CAPABILITY_LABELS[cap]}
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Ghost setting → UI: proactiveIntervalMinutes */}
      <div className="space-y-1.5">
        <label
          htmlFor="proactive-interval"
          className="text-xs font-medium text-muted-foreground"
        >
          Proactive scan interval (minutes)
        </label>
        <p className="text-[11px] text-muted-foreground/80">
          How often Commander checks for blocked tasks, budget thresholds,
          stale work, etc. Min 15 minutes.
        </p>
        <input
          id="proactive-interval"
          type="number"
          min={15}
          step={5}
          aria-label="Proactive scan interval"
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          value={proactiveIntervalMinutes}
          onChange={(e) =>
            setProactiveIntervalMinutes(Number(e.target.value))
          }
        />
      </div>

      {/* Notification preference */}
      <fieldset>
        <legend className="text-xs text-muted-foreground mb-1">
          Notification Preference
        </legend>
        <div className="space-y-2">
          {NOTIFICATION_PREFERENCES.map((pref) => (
            <label key={pref} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="notification"
                value={pref}
                checked={notificationPreference === pref}
                onChange={() => setNotificationPreference(pref)}
              />
              <span>
                <span className="font-medium">
                  {NOTIFICATION_LABELS[pref].label}
                </span>
                <span className="text-muted-foreground ml-1 text-xs">
                  — {NOTIFICATION_LABELS[pref].description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Context token budget */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          Context Token Budget
        </label>
        <Select
          value={String(contextTokenBudget)}
          onValueChange={(v) => setContextTokenBudget(Number(v))}
        >
          <SelectTrigger className="w-full max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTEXT_BUDGET_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TabSaveButton
        onClick={saveCapabilities}
        isPending={isPending}
        saveMessage={saveMessage}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Budget Tab                                                         */
/* ------------------------------------------------------------------ */

interface BudgetTabContentProps {
  budgetMonthlyCents: number;
  setBudgetMonthlyCents: (v: number) => void;
  cheapModel: string;
  setCheapModel: (v: string) => void;
  spentCents: number;
  utilization: number;
  progressColor: string;
  saveBudget: () => void;
  isPending: boolean;
  saveMessage: string | null;
}

function BudgetTabContent({
  budgetMonthlyCents,
  setBudgetMonthlyCents,
  cheapModel,
  setCheapModel,
  spentCents,
  utilization,
  progressColor,
  saveBudget,
  isPending,
  saveMessage,
}: BudgetTabContentProps) {
  return (
    <div className="space-y-4">
      {/* Monthly budget input */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          Monthly Budget
        </label>
        <div className="flex items-center gap-1 max-w-xs">
          <span className="text-sm text-muted-foreground">$</span>
          <input
            type="number"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={(budgetMonthlyCents / 100).toFixed(2)}
            onChange={(e) => {
              const dollars = parseFloat(e.target.value) || 0;
              setBudgetMonthlyCents(Math.round(dollars * 100));
            }}
            step="0.01"
            min="0"
          />
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>
            {formatCents(spentCents)} / {formatCents(budgetMonthlyCents)}{" "}
            spent
          </span>
          <span>{Math.min(utilization, 100).toFixed(0)}%</span>
        </div>
        <div
          data-testid="budget-progress"
          className="h-2 bg-muted rounded-full overflow-hidden"
        >
          <div
            data-testid="budget-progress-bar"
            className={`h-full rounded-full transition-all ${progressColor}`}
            style={{
              width: `${Math.min(utilization, 100)}%`,
            }}
          />
        </div>
        {utilization >= 100 && (
          <p className="text-xs text-red-600 mt-1 font-medium">Agent paused</p>
        )}
        {utilization >= 80 && utilization < 100 && (
          <p className="text-xs text-amber-600 mt-1">
            Approaching budget limit
          </p>
        )}
      </div>

      {/* Cost-saver fallback model */}
      <div className="space-y-2">
        <label htmlFor="cheap-model-input" className="text-sm font-medium text-foreground">
          Cost-saver fallback at 80%
        </label>
        <p className="text-xs text-muted-foreground">
          Model to use when monthly spend reaches 80% of budget. Leave blank to disable.
        </p>
        <input
          id="cheap-model-input"
          type="text"
          data-testid="cheap-model-input"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="e.g. claude-haiku-4-5"
          value={cheapModel}
          onChange={(e) => setCheapModel(e.target.value)}
        />
      </div>

      <TabSaveButton
        onClick={saveBudget}
        isPending={isPending}
        saveMessage={saveMessage}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Run History Tab                                                    */
/* ------------------------------------------------------------------ */

interface RunHistoryAggregates {
  totalCostCents: number;
  totalRuns: number;
  avgDurationMs: number;
  failureRate: number;
}

interface RunHistoryTabContentProps {
  allRuns: Array<{
    id: string;
    triggerType: string;
    status: string;
    costCents: number;
    durationMs: number;
    createdAt: string;
    tokenUsage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  }>;
  runsAggregates: RunHistoryAggregates | undefined;
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

export function RunHistoryTabContent({
  allRuns,
  runsAggregates,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: RunHistoryTabContentProps) {
  return (
    <div className="space-y-4">
      {/* Aggregates */}
      {runsAggregates && (
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Total Runs</p>
            <p className="text-lg font-semibold">{runsAggregates.totalRuns}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Est. Cost</p>
            <p className="text-lg font-semibold">
              {formatCents(runsAggregates.totalCostCents)}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Avg Duration</p>
            <p className="text-lg font-semibold">
              {(runsAggregates.avgDurationMs / 1000).toFixed(1)}s
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Failure Rate</p>
            <p className="text-lg font-semibold">
              {(runsAggregates.failureRate * 100).toFixed(0)}%
            </p>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Cost is an estimate at list prices. CLI subscription runs have no per-call charge.
      </p>

      {/* Runs table */}
      {allRuns.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Trigger</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Est. Cost</th>
                <th className="pb-2 font-medium">Tokens</th>
                <th className="pb-2 font-medium">Duration</th>
                <th className="pb-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {allRuns.map((run) => (
                <tr key={run.id} className="border-b last:border-0">
                  <td className="py-2">{run.triggerType}</td>
                  <td className="py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        run.status === "completed"
                          ? "bg-emerald-50 text-emerald-700"
                          : run.status === "failed"
                            ? "bg-red-50 text-red-700"
                            : "bg-blue-50 text-blue-700"
                      }`}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="py-2">{formatCents(run.costCents)}</td>
                  <td className="py-2 text-muted-foreground">
                    {run.tokenUsage
                      ? `${formatTokens(run.tokenUsage.inputTokens)} / ${formatTokens(run.tokenUsage.outputTokens)}`
                      : "—"}
                  </td>
                  <td className="py-2">
                    {(run.durationMs / 1000).toFixed(1)}s
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {relativeTime(run.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No runs yet
        </p>
      )}

      {/* Load more */}
      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : null}
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
