import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "@/lib/router";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { internalAgentApi } from "../api/internal-agent";
import { queryKeys } from "../lib/queryKeys";
import { formatCents, budgetProgressColor, relativeTime } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { PageTabBar } from "../components/PageTabBar";
import { PageSkeleton } from "../components/PageSkeleton";
import {
  AGENT_CAPABILITIES,
  AGENT_MODELS_BY_PROVIDER,
  AGENT_PROVIDERS,
  CLI_TOOLS,
  NOTIFICATION_PREFERENCES,
} from "@armyofagents/shared";
import type {
  AgentProvider,
  AgentCapability,
  NotificationPreference,
  UpdateInternalAgentConfig,
} from "@armyofagents/shared";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const IA_TABS = [
  { value: "execution", label: "Execution & Model" },
  { value: "capabilities", label: "Capabilities" },
  { value: "budget", label: "Budget & Spend" },
  { value: "history", label: "Run History" },
];

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

export function InternalAgentSettingsPage() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "execution";

  const handleTabChange = useCallback(
    (value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", value);
        return next;
      });
    },
    [setSearchParams],
  );

  // Form state
  const [executionMode, setExecutionMode] = useState<"api" | "cli">("api");
  const [provider, setProvider] = useState<AgentProvider>("anthropic");
  const [model, setModel] = useState<string>("claude-sonnet-4-6");
  const [cliTool, setCliTool] = useState<string>("claude_cli");
  const [enabledCapabilities, setEnabledCapabilities] = useState<string[]>([
    ...AGENT_CAPABILITIES,
  ]);
  const [notificationPreference, setNotificationPreference] =
    useState<NotificationPreference>("realtime");
  const [contextTokenBudget, setContextTokenBudget] = useState<number>(8000);
  const [budgetMonthlyCents, setBudgetMonthlyCents] = useState<number>(5000);

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
    enabled: !!selectedCompanyId && activeTab === "history",
  });

  // --- Effects ---

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/home" },
      { label: "Settings", href: "/settings" },
      { label: "Commander" },
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  // Sync form from config
  useEffect(() => {
    if (!config) return;
    setExecutionMode(config.executionMode as "api" | "cli");
    if (config.provider)
      setProvider(config.provider as AgentProvider);
    if (config.model) setModel(config.model);
    if (config.cliTool) setCliTool(config.cliTool);
    setEnabledCapabilities([...config.enabledCapabilities]);
    setNotificationPreference(config.notificationPreference as NotificationPreference);
    setContextTokenBudget(config.contextTokenBudget);
    setBudgetMonthlyCents(config.budgetMonthlyCents ?? 5000);
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
      executionMode,
      provider: executionMode === "api" ? provider : undefined,
      model: executionMode === "api" ? model : undefined,
      cliTool: executionMode === "cli" ? cliTool : undefined,
    });
  }

  function saveCapabilities() {
    saveMutation.mutate({
      enabledCapabilities: enabledCapabilities as AgentCapability[],
      notificationPreference,
      contextTokenBudget,
    });
  }

  function saveBudget() {
    saveMutation.mutate({ budgetMonthlyCents });
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
    <div className="max-w-3xl space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Commander Settings</h1>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <PageTabBar
          items={IA_TABS}
          value={activeTab}
          onValueChange={handleTabChange}
        />

        {/* ─── Execution & Model ─── */}
        <TabsContent value="execution">
          <div className="space-y-4">
            {/* Execution mode toggle */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Execution Mode
              </label>
              <div role="group" aria-label="Execution mode" className="flex gap-1 bg-muted rounded-md p-0.5 w-fit">
                <button
                  aria-pressed={executionMode === "api"}
                  className={`px-3 py-1 text-sm rounded ${executionMode === "api" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
                  onClick={() => setExecutionMode("api")}
                >
                  API
                </button>
                <button
                  aria-pressed={executionMode === "cli"}
                  className={`px-3 py-1 text-sm rounded ${executionMode === "cli" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
                  onClick={() => setExecutionMode("cli")}
                >
                  CLI
                </button>
              </div>
            </div>

            {executionMode === "api" ? (
              <>
                {/* Provider */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Provider
                  </label>
                  <Select
                    value={provider}
                    onValueChange={(v) => {
                      const p = v as AgentProvider;
                      setProvider(p);
                      const models = AGENT_MODELS_BY_PROVIDER[p];
                      if (models.length > 0) setModel(models[0].value);
                    }}
                  >
                    <SelectTrigger className="w-full max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENT_PROVIDERS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p === "anthropic"
                            ? "Anthropic"
                            : p === "openai"
                              ? "OpenAI"
                              : "Google"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Model */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Model
                  </label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="w-full max-w-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGENT_MODELS_BY_PROVIDER[provider].map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* API key link */}
                <p className="text-xs text-muted-foreground">
                  <Link to="../settings?tab=llm" className="underline hover:text-foreground transition-colors">
                    Configure API keys in LLM Providers settings
                  </Link>
                </p>
              </>
            ) : (
              /* CLI Tool */
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
              </div>
            )}

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
              isPending={saveMutation.isPending}
              saveMessage={saveMessage}
            />
          </div>
        </TabsContent>

        {/* ─── Capabilities & Preferences ─── */}
        <TabsContent value="capabilities">
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
                  <div key={group.label} role="group" aria-label={`${group.label} capabilities`}>
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
              isPending={saveMutation.isPending}
              saveMessage={saveMessage}
            />
          </div>
        </TabsContent>

        {/* ─── Budget & Spend ─── */}
        <TabsContent value="budget">
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
                <p className="text-xs text-red-600 mt-1 font-medium">
                  Agent paused
                </p>
              )}
              {utilization >= 80 && utilization < 100 && (
                <p className="text-xs text-amber-600 mt-1">
                  Approaching budget limit
                </p>
              )}
            </div>

            <TabSaveButton
              onClick={saveBudget}
              isPending={saveMutation.isPending}
              saveMessage={saveMessage}
            />
          </div>
        </TabsContent>

        {/* ─── Run History ─── */}
        <TabsContent value="history">
          <div className="space-y-4">
            {/* Aggregates */}
            {runsAggregates && (
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Total Runs</p>
                  <p className="text-lg font-semibold">
                    {runsAggregates.totalRuns}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Total Cost</p>
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

            {/* Runs table */}
            {allRuns.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Trigger</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Cost</th>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
