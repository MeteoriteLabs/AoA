import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DollarSign } from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { costsApi } from "../api/costs";
import { budgetsApi } from "../api/budgets";
import { quotasApi } from "../api/quotas";
import { financeApi } from "../api/finance";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "../components/EmptyState";
import { BudgetPolicyCard } from "../components/finance/BudgetPolicyCard";
import { BudgetIncidentCard } from "../components/finance/BudgetIncidentCard";
import { formatCents } from "../lib/utils";

// ─── Date range helpers ────────────────────────────────────────────────
type DatePreset = "mtd" | "7d" | "30d" | "ytd" | "all" | "custom";

const PRESET_LABELS: Record<DatePreset, string> = {
  mtd: "Month to Date",
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
    case "7d":
      return { from: new Date(now.getTime() - 7 * 86_400_000).toISOString(), to };
    case "30d":
      return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to };
    case "ytd":
      return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to };
    case "all":
    case "custom":
      return { from: "", to: "" };
  }
}

// ─── Section placeholder ───────────────────────────────────────────────
interface SectionPlaceholderProps {
  title: string;
  description: string;
}

function SectionPlaceholder({ title, description }: SectionPlaceholderProps) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────
export function Costs() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Budget" }]);
  }, [setBreadcrumbs]);

  const [preset, setPreset] = useState<DatePreset>("mtd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { from, to } = useMemo(() => {
    if (preset === "custom") {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : "",
        to: customTo ? new Date(customTo + "T23:59:59.999Z").toISOString() : "",
      };
    }
    return computeRange(preset);
  }, [preset, customFrom, customTo]);

  const costsSummaryQuery = useQuery({
    queryKey: queryKeys.costs(selectedCompanyId ?? "", from || undefined, to || undefined),
    queryFn: () =>
      costsApi.summary(selectedCompanyId!, from || undefined, to || undefined),
    enabled: !!selectedCompanyId,
  });

  const budgetOverviewQuery = useQuery({
    queryKey: ["budgets", "overview", selectedCompanyId],
    queryFn: () => budgetsApi.overview(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  useQuery({
    queryKey: ["quotas", selectedCompanyId],
    queryFn: () => quotasApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  useQuery({
    queryKey: ["finance", "summary", selectedCompanyId, from, to],
    queryFn: () =>
      financeApi.summary(selectedCompanyId!, from || undefined, to || undefined),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-bold">Budget</h2>
        <EmptyState icon={DollarSign} message="Select a company to view budget." />
      </div>
    );
  }

  const presetKeys: DatePreset[] = ["mtd", "7d", "30d", "ytd", "all", "custom"];
  const summary = costsSummaryQuery.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Budget</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Spend, budgets, quotas, and the finance ledger across the company.
          </p>
        </div>
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
            <div className="flex items-center gap-2 ml-1">
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
      </div>

      {/* Summary card */}
      {costsSummaryQuery.error && (
        <p className="text-sm text-destructive">{costsSummaryQuery.error.message}</p>
      )}
      {summary && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{PRESET_LABELS[preset]}</p>
              {summary.budgetCents > 0 && (
                <p className="text-sm text-muted-foreground">
                  {summary.utilizationPercent}% utilized
                </p>
              )}
            </div>
            <p className="text-2xl font-bold">
              {formatCents(summary.spendCents)}{" "}
              <span className="text-base font-normal text-muted-foreground">
                {summary.budgetCents > 0
                  ? `/ ${formatCents(summary.budgetCents)}`
                  : "Unlimited budget"}
              </span>
            </p>
            {summary.budgetCents > 0 && (
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width,background-color] duration-150 ${
                    summary.utilizationPercent > 90
                      ? "bg-red-400"
                      : summary.utilizationPercent > 70
                        ? "bg-yellow-400"
                        : "bg-green-400"
                  }`}
                  style={{
                    width: `${Math.min(100, summary.utilizationPercent)}%`,
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Budgets (full-width when populated) */}
      <BudgetsSection overview={budgetOverviewQuery.data} />

      {/* Remaining sections */}
      <div className="grid gap-4 md:grid-cols-2">
        <SectionPlaceholder
          title="Breakdown"
          description="Accounting model + Claude and Codex subscription utilization load here."
        />
        <SectionPlaceholder
          title="Quotas"
          description="Provider rate-limit windows load here."
        />
        <SectionPlaceholder
          title="Ledger"
          description="Finance events by biller, by kind, and over time load here."
        />
      </div>
    </div>
  );
}

// ─── Budgets section ───────────────────────────────────────────────────
function BudgetsSection({
  overview,
}: {
  overview: { policies: import("@paperclipai/shared").BudgetPolicySummary[]; openIncidents: import("@paperclipai/shared").BudgetIncident[] } | undefined;
}) {
  const policies = overview?.policies ?? [];
  const incidents = overview?.openIncidents ?? [];
  const hasAny = policies.length > 0 || incidents.length > 0;

  if (!hasAny) {
    return (
      <SectionPlaceholder
        title="Budgets"
        description="No budget policies configured yet. Create one in Settings → Budget."
      />
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Budgets</h3>
      {incidents.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {incidents.map((incident) => (
            <BudgetIncidentCard key={incident.id} incident={incident} />
          ))}
        </div>
      )}
      {policies.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {policies.map((policy) => (
            <BudgetPolicyCard key={policy.id} policy={policy} />
          ))}
        </div>
      )}
    </div>
  );
}
