import { useQuery } from "@tanstack/react-query";
import { CheckSquare } from "lucide-react";
import { Link } from "@/lib/router";
import { dashboardApi } from "../../../api/dashboard";
import { workQuestionsApi } from "../../../api/work-questions";
import { queryKeys } from "../../../lib/queryKeys";
import { WidgetShell } from "./WidgetShell";
import { WidgetEmpty, WidgetLoading } from "./WidgetStates";
import type { WidgetProps } from "./types";

export function ApprovalsWidget({ companyId, editing }: WidgetProps) {
  const { data: dash, isLoading: dashLoading, isError: dashIsError } = useQuery({ queryKey: queryKeys.dashboard(companyId), queryFn: () => dashboardApi.summary(companyId), enabled: !!companyId });
  const { data: questions, isLoading: questionsLoading, isError: questionsIsError } = useQuery({
    queryKey: ["work-questions", companyId, "mine-open"],
    queryFn: () => workQuestionsApi.list(companyId, { scope: "mine", status: "open" }),
    enabled: !!companyId,
  });
  const approvals = dash?.pendingApprovals ?? 0;
  const qCount = questions?.length ?? 0;
  const total = approvals + qCount;
  // Require BOTH queries settled successfully — questions=[] is truthy, so a
  // `&&` on data alone would render a misleading partial total on a
  // one-sided failure. Either query still in flight -> loading; either
  // failed -> error (never a partial/misleading total).
  const isLoading = dashLoading || questionsLoading;
  const isError = dashIsError || questionsIsError;
  return (
    <WidgetShell title="Approvals & questions" icon={CheckSquare} to="/inbox" editing={editing}>
      {isLoading ? (
        <WidgetLoading />
      ) : isError || !dash || !questions ? (
        <WidgetEmpty icon={CheckSquare} message="Couldn't load" />
      ) : (
        <Link to="/inbox" className="flex items-center gap-3 rounded-md border border-border px-4 py-3 text-inherit no-underline transition-colors hover:bg-accent/50">
          <CheckSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-2xl font-semibold tabular-nums">{total}</span>
          <span className="text-sm text-muted-foreground">
            waiting on you{total > 0 ? ` (${approvals} approval${approvals === 1 ? "" : "s"}, ${qCount} question${qCount === 1 ? "" : "s"})` : ""}
          </span>
        </Link>
      )}
    </WidgetShell>
  );
}
