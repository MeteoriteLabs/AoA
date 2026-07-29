import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign } from "lucide-react";
import { Link } from "@/lib/router";
import { dashboardApi } from "../../../api/dashboard";
import { queryKeys } from "../../../lib/queryKeys";
import { formatDollars } from "../money";
import { WidgetShell } from "./WidgetShell";
import type { WidgetProps } from "./types";

export function BudgetWidget({ companyId, editing }: WidgetProps) {
  const { data } = useQuery({ queryKey: queryKeys.dashboard(companyId), queryFn: () => dashboardApi.summary(companyId), enabled: !!companyId });
  if (!data) return null;
  const { monthSpendCents, monthBudgetCents, monthUtilizationPercent } = data.costs;
  const pct = Math.min(100, Math.max(0, Math.round(monthUtilizationPercent))); // server-computed; clamp only the bar width
  return (
    <WidgetShell title="Budget" icon={CircleDollarSign} to="/budget" editing={editing}>
      <Link to="/budget" className="block rounded-md border border-border px-4 py-3 text-inherit no-underline transition-colors hover:bg-accent/50">
        <div className="flex items-center gap-2">
          <CircleDollarSign className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-2xl font-semibold tabular-nums">{formatDollars(monthSpendCents)}</span>
          <span className="text-sm text-muted-foreground">of {formatDollars(monthBudgetCents)} this month</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </Link>
    </WidgetShell>
  );
}
