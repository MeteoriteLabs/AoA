import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { goalsApi } from "../api/goals";
import { AgentPanelContent } from "../components/InternalAgentPanel";
import { Settings, Target, Brain, Compass } from "lucide-react";
import { cn } from "../lib/utils";

export function Commander() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Commander" }]);
  }, [setBreadcrumbs]);

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const activeGoals = goals?.filter((g) => g.status === "active" || g.status === "at_risk").length ?? 0;
  const hasVision = !!selectedCompany?.vision;
  const hasMission = !!selectedCompany?.mission;

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      <div>
        <h1 className="text-[1.6rem] font-bold tracking-tight">
          Commander<span className="text-brand">.</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your always-on AI assistant for coordination and proactive monitoring.
        </p>
      </div>
      <div className="flex gap-6 flex-1 min-h-0">
      {/* Context sidebar */}
      <div className="hidden lg:flex flex-col gap-3 w-64 shrink-0">
        {/* Identity snapshot */}
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Compass className="h-3 w-3" />
            Identity
          </div>
          {hasVision ? (
            <p className="text-xs text-foreground line-clamp-2">{selectedCompany!.vision}</p>
          ) : (
            <p className="text-xs text-muted-foreground italic">No vision set</p>
          )}
          {hasMission ? (
            <p className="text-xs text-muted-foreground line-clamp-2">{selectedCompany!.mission}</p>
          ) : (
            <p className="text-xs text-muted-foreground italic">No mission set</p>
          )}
          <Link to="/objectives" className="text-[10px] text-primary hover:underline">
            Edit in Objectives
          </Link>
        </div>

        {/* Goals snapshot */}
        <div className="rounded-lg border border-border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Target className="h-3 w-3" />
            Goals
          </div>
          <p className="text-sm font-semibold">{activeGoals} active</p>
          <p className="text-xs text-muted-foreground">{goals?.length ?? 0} total</p>
        </div>

        {/* Quick links */}
        <Link
          to="/settings?tab=commander"
          className="flex items-center gap-2 rounded-lg border border-border p-3 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
        >
          <Settings className="h-3 w-3" />
          Commander Settings
        </Link>
      </div>

      {/* Conversation area */}
      <div className="flex-1 min-w-0 rounded-lg border border-border overflow-hidden bg-background">
        <AgentPanelContent />
      </div>
      </div>
    </div>
  );
}
