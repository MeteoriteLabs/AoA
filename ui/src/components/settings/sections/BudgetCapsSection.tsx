import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCompany } from "@/context/CompanyContext";
import { costsApi } from "@/api/costs";
import { budgetsApi } from "@/api/budgets";
import { internalAgentApi } from "@/api/internal-agent";
import type { ResolveBudgetIncidentInput } from "@armyofagents/shared";
import { queryKeys } from "@/lib/queryKeys";
import { formatCents, formatTokens, budgetProgressColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, DollarSign, Plus } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Identity } from "@/components/Identity";
import { StatusBadge } from "@/components/StatusBadge";
import { CreateBudgetPolicyDialog } from "@/components/finance/CreateBudgetPolicyDialog";

// ─── Date preset helpers (lifted from old SettingsPage) ───────────────
type DatePreset = "mtd" | "7d" | "30d" | "ytd" | "all" | "custom";

const PRESET_LABELS: Record<DatePreset, string> = {
  mtd: "MTD",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  ytd: "Year to Date",
  all: "All Time",
  custom: "Custom",
};

function computeRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  switch (preset) {
    case "mtd": {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: d.toISOString(), to };
    }
    case "7d": {
      const d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { from: d.toISOString(), to };
    }
    case "30d": {
      const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { from: d.toISOString(), to };
    }
    case "ytd": {
      const d = new Date(now.getFullYear(), 0, 1);
      return { from: d.toISOString(), to };
    }
    case "all":
      return { from: "", to: "" };
    case "custom":
      return { from: "", to: "" };
  }
}

export function BudgetCapsSection() {
  const { selectedCompanyId } = useCompany();

  const [preset, setPreset] = useState<DatePreset>("mtd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [newPolicyOpen, setNewPolicyOpen] = useState(false);

  const { from, to } = useMemo(() => {
    if (preset === "custom") {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : "",
        to: customTo
          ? new Date(customTo + "T23:59:59.999Z").toISOString()
          : "",
      };
    }
    return computeRange(preset);
  }, [preset, customFrom, customTo]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.costs(
      selectedCompanyId!,
      from || undefined,
      to || undefined
    ),
    queryFn: async () => {
      const [summary, byAgent, byProject] = await Promise.all([
        costsApi.summary(selectedCompanyId!, from || undefined, to || undefined),
        costsApi.byAgent(selectedCompanyId!, from || undefined, to || undefined),
        costsApi.byProject(
          selectedCompanyId!,
          from || undefined,
          to || undefined
        ),
      ]);
      return { summary, byAgent, byProject };
    },
    enabled: !!selectedCompanyId,
  });

  const { data: agentConfig } = useQuery({
    queryKey: queryKeys.agentConfig(selectedCompanyId!),
    queryFn: () => internalAgentApi.getConfig(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: budgetOverview, refetch: refetchOverview } = useQuery({
    queryKey: ["budgets", "overview", selectedCompanyId],
    queryFn: () => budgetsApi.overview(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const resolveIncident = useMutation({
    mutationFn: ({ incidentId, input }: { incidentId: string; input: ResolveBudgetIncidentInput }) =>
      budgetsApi.resolveIncident(selectedCompanyId!, incidentId, input),
    onSuccess: () => { refetchOverview(); },
  });

  const presetKeys: DatePreset[] = [
    "mtd",
    "7d",
    "30d",
    "ytd",
    "all",
    "custom",
  ];

  return (
    <div>
      {/* Section header */}
      <div className="px-8 pt-6 pb-3 border-b border-border">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/60 font-semibold">
          Settings · Operations
        </div>
        <h2 className="text-[1.4rem] font-bold tracking-tight mt-1">
          Budget &amp; caps<span className="text-brand">.</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Caps, alerts, agent and project breakdowns, and active overruns.
        </p>
      </div>

      <div className="p-8">
        {!selectedCompanyId ? (
          <EmptyState icon={DollarSign} message="Select a company to view budget." />
        ) : isLoading ? (
          <PageSkeleton variant="costs" />
        ) : (
          <div className="space-y-6">
            {/* Cross-link to full Budget page (primary entry point for finance analytics) */}
            <div className="flex flex-wrap items-stretch gap-3">
              <Link
                to="../budget"
                className="group flex-1 min-w-[260px] flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-4 py-3 hover:bg-primary/10 hover:border-primary/60 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">Open full Budget page</p>
                  <p className="text-xs text-muted-foreground">
                    Breakdown, budgets, quotas, and the finance ledger in one place. This tab shows a quick summary.
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-primary group-hover:translate-x-0.5 transition-transform shrink-0" />
              </Link>
              <Button
                variant="outline"
                className="shrink-0 self-center"
                onClick={() => setNewPolicyOpen(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New Budget Policy
              </Button>
            </div>

            <CreateBudgetPolicyDialog
              open={newPolicyOpen}
              onOpenChange={setNewPolicyOpen}
              onCreated={() => refetchOverview()}
            />

            {/* Date range selector */}
            <div className="flex flex-wrap items-center gap-2">
              {presetKeys.map((p) => (
                <Button
                  key={p}
                  variant={preset === p ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setPreset(p)}
                >
                  {PRESET_LABELS[p]}
                </Button>
              ))}
              {preset === "custom" && (
                <div className="flex items-center gap-2 ml-2">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  />
                </div>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error.message}</p>}

            {data && (
              <>
                {/* Summary card */}
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        {PRESET_LABELS[preset]}
                      </p>
                      {data.summary.budgetCents > 0 && (
                        <p className="text-sm text-muted-foreground">
                          {data.summary.utilizationPercent}% utilized
                        </p>
                      )}
                    </div>
                    <p className="text-2xl font-bold">
                      {formatCents(
                        data.summary.spendCents +
                          (agentConfig?.spentMonthlyCents ?? 0),
                      )}{" "}
                      <span className="text-base font-normal text-muted-foreground">
                        {data.summary.budgetCents > 0
                          ? `/ ${formatCents(data.summary.budgetCents)}`
                          : "Unlimited budget"}
                      </span>
                    </p>
                    {data.summary.budgetCents > 0 && (
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-[width,background-color] duration-150 ${
                            data.summary.utilizationPercent > 90
                              ? "bg-red-400"
                              : data.summary.utilizationPercent > 70
                                ? "bg-yellow-400"
                                : "bg-green-400"
                          }`}
                          style={{
                            width: `${Math.min(100, data.summary.utilizationPercent)}%`,
                          }}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* By Agent / By Project */}
                <div className="grid md:grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <h3 className="text-sm font-semibold mb-3">By Agent</h3>
                      {data.byAgent.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No cost events yet.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {data.byAgent.map((row) => (
                            <div
                              key={row.agentId}
                              className="flex items-start justify-between text-sm"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Identity
                                  name={row.agentName ?? row.agentId}
                                  size="sm"
                                />
                                {row.agentStatus === "terminated" && (
                                  <StatusBadge status="terminated" />
                                )}
                              </div>
                              <div className="text-right shrink-0 ml-2">
                                <span className="font-medium block">
                                  {formatCents(row.costCents)}
                                </span>
                                <span className="text-xs text-muted-foreground block">
                                  in {formatTokens(row.inputTokens)} / out{" "}
                                  {formatTokens(row.outputTokens)} tok
                                </span>
                                {(row.apiRunCount > 0 ||
                                  row.subscriptionRunCount > 0) && (
                                  <span className="text-xs text-muted-foreground block">
                                    {/* apiRunCount includes 'api' and 'metered_api' variants */}
                                    {row.apiRunCount > 0
                                      ? `metered runs: ${row.apiRunCount}`
                                      : null}
                                    {row.apiRunCount > 0 &&
                                    row.subscriptionRunCount > 0
                                      ? " | "
                                      : null}
                                    {/* subscriptionRunCount includes 'subscription', 'subscription_included', 'subscription_overage' */}
                                    {row.subscriptionRunCount > 0
                                      ? `subscription runs: ${row.subscriptionRunCount} (${formatTokens(row.subscriptionInputTokens)} in / ${formatTokens(row.subscriptionOutputTokens)} out tok)`
                                      : null}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Commander spend mini-row */}
                      {agentConfig && agentConfig.budgetMonthlyCents != null && (
                        <div className="mt-4 pt-4 border-t border-border">
                          <p className="text-xs font-medium text-muted-foreground mb-2">
                            Commander
                          </p>
                          <div className="flex items-center justify-between text-sm">
                            <span>AI Assistant</span>
                            <span>
                              {formatCents(agentConfig.spentMonthlyCents)} /{" "}
                              {formatCents(agentConfig.budgetMonthlyCents)}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1">
                            <div
                              className={`h-full rounded-full ${budgetProgressColor(
                                agentConfig.budgetMonthlyCents > 0
                                  ? (agentConfig.spentMonthlyCents / agentConfig.budgetMonthlyCents) * 100
                                  : 0,
                              )}`}
                              style={{
                                width: `${
                                  agentConfig.budgetMonthlyCents > 0
                                    ? Math.min(
                                        (agentConfig.spentMonthlyCents / agentConfig.budgetMonthlyCents) * 100,
                                        100,
                                      )
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <h3 className="text-sm font-semibold mb-3">By Project</h3>
                      {data.byProject.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No project-attributed run costs yet.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {data.byProject.map((row) => (
                            <div
                              key={row.projectId ?? "na"}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="truncate">
                                {row.projectName ?? row.projectId ?? "Unattributed"}
                              </span>
                              <span className="font-medium">
                                {formatCents(row.costCents)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Open Budget Incidents */}
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <h3 className="text-sm font-semibold">Open Incidents</h3>
                    {!budgetOverview || budgetOverview.openIncidents.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No open budget incidents.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {budgetOverview.openIncidents.map((incident) => (
                          <div key={incident.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${incident.thresholdType === "hard_stop" ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                                  {incident.thresholdType === "hard_stop" ? "Hard Stop" : "Warning"}
                                </span>
                                <span className="text-sm font-medium">{incident.scopeName ?? incident.scopeId}</span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                ${(incident.amountObservedCents / 100).toFixed(2)} observed / ${(incident.amountLimitCents / 100).toFixed(2)} limit
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Created {new Date(incident.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {incident.thresholdType === "hard_stop" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={resolveIncident.isPending}
                                  onClick={() => {
                                    const newAmount = window.prompt("New budget limit in dollars:", String(Math.round(incident.amountLimitCents / 100 * 1.5)));
                                    if (!newAmount) return;
                                    const parsed = parseFloat(newAmount);
                                    if (isNaN(parsed) || parsed <= 0) { window.alert("Please enter a valid dollar amount."); return; }
                                    resolveIncident.mutate({
                                      incidentId: incident.id,
                                      input: { action: "raise_and_resume", newAmountCents: Math.round(parsed * 100) },
                                    });
                                  }}
                                >
                                  Raise &amp; Resume
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={resolveIncident.isPending}
                                onClick={() => resolveIncident.mutate({ incidentId: incident.id, input: { action: "dismiss" } })}
                              >
                                Dismiss
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
