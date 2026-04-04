import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { agentsApi } from "../../../api/agents";
import { activityApi } from "../../../api/activity";
import { heartbeatsApi } from "../../../api/heartbeats";
import { issuesApi } from "../../../api/issues";
import { dependenciesApi } from "../../../api/dependencies";
import { queryKeys } from "../../../lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Bot, ExternalLink, AlertTriangle } from "lucide-react";
import type { Agent, Issue } from "@paperclipai/shared";

interface ProcessSectionProps {
  issueId: string;
  companyId: string;
  companyPrefix: string;
}

export function ProcessSection({ issueId, companyId, companyPrefix }: ProcessSectionProps) {
  const navigate = useNavigate();

  const { data: issue } = useQuery({
    queryKey: queryKeys.issues.detail(issueId),
    queryFn: () => issuesApi.get(issueId),
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.issues.runs(issueId),
    queryFn: () => activityApi.runsForIssue(issueId),
  });

  const { data: activeRun } = useQuery({
    queryKey: queryKeys.issues.activeRun(issueId),
    queryFn: () => heartbeatsApi.activeRunForIssue(issueId),
    refetchInterval: 5000,
  });

  const { data: deps } = useQuery({
    queryKey: queryKeys.issues.dependencies(issueId),
    queryFn: () => dependenciesApi.list(companyId, issueId),
    enabled: issue?.status === "blocked",
  });

  const assignedAgent = agents?.find((a: Agent) => a.id === issue?.assigneeAgentId);
  const isRunning = !!activeRun;
  const totalRuns = runs?.length ?? 0;
  const isBlocked = issue?.status === "blocked";

  const blockingTasks = isBlocked
    ? (deps?.upstream ?? []).filter((d) => d.status !== "done" && d.status !== "completed")
    : [];

  return (
    <div className="space-y-2 px-3" data-testid="process-section">
      {/* Agent info */}
      {assignedAgent ? (
        <button
          type="button"
          className="flex items-center gap-2 w-full text-left hover:bg-accent/50 rounded-md p-1.5 -ml-1.5 transition-colors"
          onClick={() => navigate(`/${companyPrefix}/agents/${assignedAgent.urlKey}`)}
          data-testid="agent-link"
        >
          <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{assignedAgent.name}</div>
            <Badge variant="outline" className="text-[10px] h-4 px-1 mt-0.5">
              {assignedAgent.adapterType}
            </Badge>
          </div>
          <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
        </button>
      ) : (
        <div className="text-xs text-muted-foreground py-1" data-testid="no-agent">
          No agent assigned
        </div>
      )}

      {/* Status + runs */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div
            className={`h-2 w-2 rounded-full ${isRunning ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"}`}
          />
          <span>{isRunning ? "Running" : "Idle"}</span>
        </div>
        <span>{totalRuns} run{totalRuns !== 1 ? "s" : ""}</span>
      </div>

      {/* Blockers */}
      {isBlocked && blockingTasks.length > 0 && (
        <div className="space-y-1" data-testid="blockers-list">
          <div className="flex items-center gap-1 text-xs font-medium text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            Blocked by
          </div>
          {blockingTasks.map((b) => (
            <div key={b.id} className="text-xs text-muted-foreground pl-4 truncate">
              {b.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
