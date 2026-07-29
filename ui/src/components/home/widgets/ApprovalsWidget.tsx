import { useQuery } from "@tanstack/react-query";
import { CheckSquare } from "lucide-react";
import { Link } from "@/lib/router";
import { dashboardApi } from "../../../api/dashboard";
import { workQuestionsApi } from "../../../api/work-questions";
import { queryKeys } from "../../../lib/queryKeys";
import { WidgetShell } from "./WidgetShell";
import type { WidgetProps } from "./types";

export function ApprovalsWidget({ companyId, editing }: WidgetProps) {
  const { data: dash } = useQuery({ queryKey: queryKeys.dashboard(companyId), queryFn: () => dashboardApi.summary(companyId), enabled: !!companyId });
  const { data: questions } = useQuery({
    queryKey: ["work-questions", companyId, "mine-open"],
    queryFn: () => workQuestionsApi.list(companyId, { scope: "mine", status: "open" }),
    enabled: !!companyId,
  });
  const approvals = dash?.pendingApprovals ?? 0;
  const qCount = questions?.length ?? 0;
  const total = approvals + qCount;
  if (!dash || !questions) return null; // require BOTH — questions=[] is truthy, so && would render a misleading partial total on a one-sided failure
  return (
    <WidgetShell title="Approvals & questions" icon={CheckSquare} to="/inbox" editing={editing}>
      <Link to="/inbox" className="flex items-center gap-3 rounded-md border border-border px-4 py-3 text-inherit no-underline transition-colors hover:bg-accent/50">
        <CheckSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-2xl font-semibold tabular-nums">{total}</span>
        <span className="text-sm text-muted-foreground">
          waiting on you{total > 0 ? ` (${approvals} approval${approvals === 1 ? "" : "s"}, ${qCount} question${qCount === 1 ? "" : "s"})` : ""}
        </span>
      </Link>
    </WidgetShell>
  );
}
