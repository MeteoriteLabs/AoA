import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../../api/issues";
import { activityApi, type RunForIssue } from "../../api/activity";
import { heartbeatsApi } from "../../api/heartbeats";
import { agentsApi } from "../../api/agents";
import { useCompany } from "../../context/CompanyContext";
import { queryKeys } from "../../lib/queryKeys";
import { cn, relativeTime } from "@/lib/utils";
import { RunBlock } from "./RunBlock";
import { LiveRunWidget } from "../LiveRunWidget";
import { Identity } from "../Identity";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "../../context/ToastContext";
import { Send, CheckCircle2 } from "lucide-react";
import type { IssueComment, Agent } from "@paperclipai/shared";

export type TimelineItem =
  | { kind: "run"; ts: string; data: RunForIssue }
  | { kind: "comment"; ts: string; data: IssueComment };

interface WorkspaceTimelineProps {
  issueId: string;
  /** When true, renders in compact mode for TaskSlideOver */
  compact?: boolean;
  className?: string;
  /** If true, show Mark Complete button (for human-assigned tasks) */
  showMarkComplete?: boolean;
  onMarkComplete?: () => void;
}

export function WorkspaceTimeline({
  issueId,
  compact = false,
  className,
  showMarkComplete = false,
  onMarkComplete,
}: WorkspaceTimelineProps) {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [sendAgentId, setSendAgentId] = useState<string | null>(null);

  // --- Data fetching ---

  const { data: issue } = useQuery({
    queryKey: queryKeys.issues.detail(issueId),
    queryFn: () => issuesApi.get(issueId),
    enabled: !!issueId,
  });

  const { data: comments, error: commentsError } = useQuery({
    queryKey: queryKeys.issues.comments(issueId),
    queryFn: () => issuesApi.listComments(issueId),
    enabled: !!issueId,
  });

  const { data: linkedRuns } = useQuery({
    queryKey: queryKeys.issues.runs(issueId),
    queryFn: () => activityApi.runsForIssue(issueId),
    enabled: !!issueId,
    refetchInterval: 5000,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.issues.liveRuns(issueId),
    queryFn: () => heartbeatsApi.liveRunsForIssue(issueId),
    enabled: !!issueId,
    refetchInterval: 3000,
  });

  const { data: activeRun } = useQuery({
    queryKey: queryKeys.issues.activeRun(issueId),
    queryFn: () => heartbeatsApi.activeRunForIssue(issueId),
    enabled: !!issueId,
    refetchInterval: 3000,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { pushToast } = useToast();

  useEffect(() => {
    if (commentsError) {
      pushToast({ tone: "error", title: "Failed to load comments", body: (commentsError as Error).message });
    }
  }, [commentsError, pushToast]);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const hasLiveRuns = (liveRuns ?? []).length > 0 || !!activeRun;

  // Filter out live runs from the historical timeline
  const timelineRuns = useMemo(() => {
    const liveIds = new Set<string>();
    for (const r of liveRuns ?? []) liveIds.add(r.id);
    if (activeRun) liveIds.add(activeRun.id);
    if (liveIds.size === 0) return linkedRuns ?? [];
    return (linkedRuns ?? []).filter((r) => !liveIds.has(r.runId));
  }, [linkedRuns, liveRuns, activeRun]);

  // Merge runs + comments chronologically
  const mergedTimeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...(timelineRuns ?? []).map((r) => ({
        kind: "run" as const,
        ts: r.startedAt ?? r.createdAt,
        data: r,
      })),
      ...(comments ?? []).map((c) => ({
        kind: "comment" as const,
        ts: typeof c.createdAt === "string" ? c.createdAt : c.createdAt.toISOString(),
        data: c,
      })),
    ];
    return items.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  }, [timelineRuns, comments]);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mergedTimeline.length, hasLiveRuns]);

  // Default send agent to current assignee
  const effectiveSendAgentId = sendAgentId ?? issue?.assigneeAgentId ?? null;

  // --- Mutations ---

  const sendMessage = useMutation({
    mutationFn: async ({ text, agentId }: { text: string; agentId: string | null }) => {
      await issuesApi.addComment(issueId, text);
      if (agentId) {
        await agentsApi.wakeup(agentId, { source: "on_demand", reason: text });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId) });
      setChatInput("");
    },
  });

  const handleSend = () => {
    if (chatInput.trim()) {
      sendMessage.mutate({ text: chatInput.trim(), agentId: effectiveSendAgentId });
    }
  };

  return (
    <div className={cn("flex flex-col h-full", className)} data-testid="workspace-timeline">
      {/* Scrollable timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="timeline-scroll">
        {!comments && !linkedRuns && (
          <div className="space-y-3" data-testid="timeline-skeleton">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}

        {/* Live run widget at top if active */}
        {hasLiveRuns && (
          <LiveRunWidget issueId={issueId} companyId={issue?.companyId ?? null} />
        )}

        {/* Empty state */}
        {mergedTimeline.length === 0 && !hasLiveRuns && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No runs or comments yet. Send a message to start work.
          </p>
        )}

        {/* Timeline items */}
        {mergedTimeline.map((item, idx) => {
          if (item.kind === "run") {
            const run = item.data;
            const agent = agentMap.get(run.agentId);
            const isLatest = idx === mergedTimeline.length - 1 ||
              mergedTimeline.slice(idx + 1).every((i) => i.kind !== "run");
            return (
              <RunBlock
                key={`run-${run.runId}`}
                run={run}
                agentName={agent?.name ?? run.agentId.slice(0, 8)}
                isLatest={isLatest}
                compact={compact}
              />
            );
          }
          // Comment
          const comment = item.data;
          const authorAgent = comment.authorAgentId
            ? agentMap.get(comment.authorAgentId)
            : null;
          return (
            <div key={`comment-${comment.id}`} className="flex gap-2.5" data-testid={`timeline-comment-${comment.id}`}>
              <div className="shrink-0 mt-0.5">
                <Identity
                  name={authorAgent?.name ?? (comment.authorUserId ? "Board" : "Unknown")}
                  size="sm"
                />
              </div>
              <div className="flex-1 space-y-0.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium">
                    {authorAgent?.name ?? (comment.authorUserId ? "Board" : "Unknown")}
                  </span>
                  <span className="text-muted-foreground ml-auto">
                    {relativeTime(comment.createdAt)}
                  </span>
                </div>
                <p className="text-sm">{comment.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input area — fixed at bottom */}
      <div className="p-4 border-t border-border shrink-0 space-y-2" data-testid="workspace-input-area">
        <textarea
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Continue working on this task..."
          rows={compact ? 2 : 3}
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <div className="flex items-center gap-2">
          <select
            className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            value={effectiveSendAgentId ?? ""}
            onChange={(e) => setSendAgentId(e.target.value || null)}
          >
            <option value="">No agent</option>
            {(agents ?? [])
              .filter((a) => a.status !== "terminated")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
          {showMarkComplete && onMarkComplete && (
            <Button variant="outline" size="sm" onClick={onMarkComplete}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Mark Complete
            </Button>
          )}
          <Button
            size="sm"
            disabled={!chatInput.trim() || sendMessage.isPending}
            onClick={handleSend}
          >
            <Send className="h-3.5 w-3.5 mr-1" />
            {sendMessage.isPending ? "Sending..." : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
