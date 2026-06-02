import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import type { Agent, Issue } from "@armyofagents/shared";
import { KanbanBoard, type LiveRunInfo } from "../KanbanBoard";
import { issuesApi } from "../../api/issues";
import { heartbeatsApi } from "../../api/heartbeats";
import { queryKeys } from "../../lib/queryKeys";
import { EmptyState } from "../EmptyState";
import { CrewTaskAuditCard } from "./CrewTaskAuditCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * P1-T9: Crew Board — filtered deliverable view for tasks spawned from
 * discussion threads (originKind = 'crew_thread').
 *
 * Lists every issue produced by the Adjutant's propose_crew_work chokepoint
 * (D11), grouped by the source thread. The Dispatcher is retired; scope cards
 * now flow through crew-task-service.proposeWork with autonomy gating. Backs
 * the team expectation that crew-created tasks show up alongside the rest of
 * the team without trawling through individual discussions.
 *
 * Filter dropdown narrows by crew agent (assignee) — defensive client-side
 * filter on top of the server filter so the dropdown reflects what's actually
 * visible.
 */

export interface CrewBoardProps {
  companyId: string;
  /** Pre-loaded list of crew/AoA agents to populate the assignee dropdown. */
  crewAgents?: Pick<Agent, "id" | "name">[];
}

interface ThreadGroup {
  threadId: string;
  threadTitle: string;
  tasks: Issue[];
}

const ALL_AGENTS_VALUE = "__all__";

export function CrewBoard({ companyId, crewAgents = [] }: CrewBoardProps) {
  const queryClient = useQueryClient();
  const [selectedAgentId, setSelectedAgentId] = useState<string>(ALL_AGENTS_VALUE);
  const [auditIssue, setAuditIssue] = useState<Issue | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const agentFilter =
    selectedAgentId === ALL_AGENTS_VALUE ? undefined : selectedAgentId;

  const tasksQuery = useQuery({
    queryKey: ["tasks", "from-discussions", companyId, agentFilter ?? null],
    queryFn: () =>
      issuesApi.list(companyId, {
        crewBoard: true,
        ...(agentFilter ? { assigneeAgentId: agentFilter } : {}),
      }),
    enabled: Boolean(companyId),
  });

  // Task 5.7: live crew activity. `liveRunsForCompany` now UNIONs crew
  // (internal_agent) runs, so a task a crew agent is executing shows the "Live"
  // pill — labelled "{agentName} · {elapsed}" via liveRunsByIssue. The
  // issue.status_changed live event (LiveUpdatesProvider) also invalidates this
  // query so the pill clears promptly when a run ends; refetchInterval is the
  // belt-and-suspenders fallback (mirrors Issues.tsx / ProjectDetail.tsx).
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(companyId),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
    enabled: Boolean(companyId),
    refetchInterval: 5000,
  });

  const liveIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of liveRuns ?? []) {
      if (run.issueId) ids.add(run.issueId);
    }
    return ids;
  }, [liveRuns]);

  const liveRunsByIssue = useMemo(() => {
    const map = new Map<string, LiveRunInfo>();
    for (const run of liveRuns ?? []) {
      if (run.issueId) map.set(run.issueId, { agentName: run.agentName, startedAt: run.startedAt });
    }
    return map;
  }, [liveRuns]);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["tasks", "from-discussions", companyId],
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.list(companyId),
      });
    },
  });

  const filteredTasks = useMemo(() => {
    const tasks = tasksQuery.data ?? [];
    if (selectedAgentId === ALL_AGENTS_VALUE) return tasks;
    return tasks.filter((t) => t.assigneeAgentId === selectedAgentId);
  }, [tasksQuery.data, selectedAgentId]);

  const handleSelectIssue = (identifierOrId: string) => {
    const found =
      filteredTasks.find((t) => t.identifier === identifierOrId) ??
      filteredTasks.find((t) => t.id === identifierOrId) ??
      null;
    setAuditIssue(found);
    setAuditOpen(true);
  };

  const grouped = useMemo<ThreadGroup[]>(() => {
    const map = new Map<string, ThreadGroup>();
    for (const t of filteredTasks) {
      // Defensive: backend already filters but if a downstream consumer mocks
      // a row without sourceDiscussionId, skip silently to keep the UI clean.
      if (!t.sourceDiscussionId) continue;
      const key = t.sourceDiscussionId;
      if (!map.has(key)) {
        map.set(key, {
          threadId: key,
          threadTitle: t.sourceThreadTitle ?? "(unknown thread)",
          tasks: [],
        });
      }
      map.get(key)!.tasks.push(t);
    }
    return Array.from(map.values());
  }, [filteredTasks]);

  if (tasksQuery.isLoading) {
    return (
      <div
        className="px-5 py-12 text-center text-sm text-muted-foreground"
        data-testid="crew-board-loading"
      >
        Loading…
      </div>
    );
  }

  if (!tasksQuery.data?.length) {
    return (
      <div className="px-5 py-8" data-testid="crew-board-empty">
        <EmptyState
          icon={MessageSquare}
          message="No tasks yet. Crew-created tasks will appear here."
        />
      </div>
    );
  }

  return (
    <>
      <div className="px-5 py-4 space-y-6" data-testid="crew-board">
        {crewAgents.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Filter:</span>
            <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
              <SelectTrigger
                className="h-8 w-[220px] text-xs"
                data-testid="crew-board-agent-filter"
              >
                <SelectValue placeholder="All crew agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_AGENTS_VALUE}>All crew agents</SelectItem>
                {crewAgents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {grouped.length === 0 ? (
          <div
            className="text-center py-12 text-sm text-muted-foreground"
            data-testid="crew-board-filtered-empty"
          >
            No tasks match this filter.
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.threadId} data-testid={`crew-board-group-${g.threadId}`}>
              <div className="text-sm text-muted-foreground mb-2">
                From:{" "}
                <Link
                  to={`/discussions/${g.threadId}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {g.threadTitle}
                </Link>
              </div>
              <KanbanBoard
                issues={g.tasks}
                agents={crewAgents}
                liveIssueIds={liveIssueIds}
                liveRunsByIssue={liveRunsByIssue}
                onUpdateIssue={(id, data) =>
                  updateMutation.mutate({ id, data })
                }
                onSelectIssue={handleSelectIssue}
              />
            </div>
          ))
        )}
      </div>

      {/* Audit sheet — opens when a card is clicked on the crew board */}
      <CrewTaskAuditCard
        issue={auditIssue}
        open={auditOpen}
        onOpenChange={setAuditOpen}
      />
    </>
  );
}
