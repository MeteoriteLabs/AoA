import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../../api/issues";
import { activityApi, type RunForIssue } from "../../api/activity";
import { heartbeatsApi } from "../../api/heartbeats";
import { agentsApi } from "../../api/agents";
import { projectsApi } from "../../api/projects";
import { useCompany } from "../../context/CompanyContext";
import { queryKeys } from "../../lib/queryKeys";
import { cn } from "@/lib/utils";
import { TimelineUserMessage } from "./TimelineUserMessage";
import { TimelineAgentMessage } from "./TimelineAgentMessage";
import { LiveRunWidget } from "../LiveRunWidget";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "../../context/ToastContext";
import { Activity } from "lucide-react";
import { summarizeOutputs } from "./workspace-utils";
import type { IssueComment, Agent } from "@paperclipai/shared";
import { ChatbarStatusRow } from "./ChatbarStatusRow";
import { ChatbarControls } from "./ChatbarControls";

export type TimelineItem =
  | { kind: "run"; ts: string; data: RunForIssue }
  | { kind: "comment"; ts: string; data: IssueComment };

interface WorkspaceTimelineProps {
  issueId: string;
  /** When true, renders in compact mode for TaskSlideOver */
  compact?: boolean;
  className?: string;
}

export function WorkspaceTimeline({
  issueId,
  compact = false,
  className,
}: WorkspaceTimelineProps) {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [modelOverride, setModelOverride] = useState<string | null>(null);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setChatInput(e.target.value);
    // Auto-grow: reset to 1 row then expand to content, max 4 rows
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`; // 96px ≈ 4 rows at text-sm
  };

  // --- Data fetching ---

  const { data: issue } = useQuery({
    queryKey: queryKeys.issues.detail(issueId),
    queryFn: () => issuesApi.get(issueId),
    enabled: !!issueId,
  });

  const { data: comments, error: commentsError, isLoading: commentsLoading } = useQuery({
    queryKey: queryKeys.issues.comments(issueId),
    queryFn: () => issuesApi.listComments(issueId),
    enabled: !!issueId,
  });

  const { data: linkedRuns, isLoading: runsLoading } = useQuery({
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

  const { data: project } = useQuery({
    queryKey: queryKeys.projects.detail(issue?.projectId ?? ""),
    queryFn: () => projectsApi.get(issue!.projectId!),
    enabled: !!issue?.projectId,
  });

  const departmentType = project?.functionType ?? "general";

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

  // Agent resolution — always use the task's assigned agent
  const assignedAgentId = issue?.assigneeAgentId ?? null;
  const assignedAgent = assignedAgentId ? agentMap.get(assignedAgentId) : null;
  const agentAdapterType = assignedAgent?.adapterType ?? "process";
  const agentDefaultModel = (assignedAgent?.adapterConfig as Record<string, unknown>)?.model as string | null ?? null;

  // Diff stats from latest run
  const latestRun = linkedRuns?.[0] ?? null;
  const latestOutputs = latestRun?.detectedOutputs ?? [];
  const { fileCount: latestFileCount, totalBytes: latestTotalBytes } = summarizeOutputs(latestOutputs);

  // --- Mutations ---

  const sendMessage = useMutation({
    mutationFn: async ({ text, agentId, modelOvr }: { text: string; agentId: string | null; modelOvr: string | null }) => {
      await issuesApi.addComment(issueId, text);
      if (agentId) {
        const payload = modelOvr ? { modelOverride: modelOvr } : null;
        await agentsApi.wakeup(agentId, { source: "on_demand", reason: text, payload });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId) });
      setChatInput("");
      setModelOverride(null); // Reset model override after send
    },
  });

  const handleSend = () => {
    if (chatInput.trim()) {
      sendMessage.mutate({ text: chatInput.trim(), agentId: assignedAgentId, modelOvr: modelOverride });
    }
  };

  return (
    <div className={cn("flex flex-col h-full min-h-0", className)} data-testid="workspace-timeline">
      {/* Scrollable timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="timeline-scroll">
        {(commentsLoading || runsLoading) && (
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

        {/* Timeline items — structured conversation */}
        {mergedTimeline.map((item, idx) => {
          if (item.kind === "run") {
            const run = item.data;
            const agent = agentMap.get(run.agentId);
            const isLatest = idx === mergedTimeline.length - 1 ||
              mergedTimeline.slice(idx + 1).every((i) => i.kind !== "run");
            const agentAdapterType = agent?.adapterType ?? "process";
            return (
              <TimelineAgentMessage
                key={`run-${run.runId}`}
                run={run}
                agentName={agent?.name ?? run.agentId.slice(0, 8)}
                isLatest={isLatest}
                compact={compact}
                adapterType={agentAdapterType}
                departmentType={departmentType}
              />
            );
          }
          // Comment — rendered as chat bubble or system row
          const comment = item.data;
          const isSystemComment = !comment.authorAgentId && !comment.authorUserId;

          if (isSystemComment) {
            // System-generated comment — render as subtle centered metadata row
            const body = comment.body ?? "";
            const isRunSummary = body.includes("**Run Summary**");
            let displayText = "System";

            if (isRunSummary) {
              // Format: "🤖 **Run Summary** — Agent\nDuration: Xs | Tokens: N in / N out | Cost: $X\nOutcome: ✅ Completed"
              const lines = body.split("\n").filter(Boolean);
              const statsLine = lines[1] ?? "";
              const outcomeLine = lines[2] ?? "";
              const outcome = outcomeLine.replace(/^Outcome:\s*/, "").replace(/[✅❌⏱️⛔]\s*/g, "").trim();
              displayText = [statsLine, outcome].filter(Boolean).join(" · ") || "System";
            } else {
              // Generic system comment — show first line of body
              displayText = body.replace(/\*\*/g, "").trim().split("\n").filter(Boolean)[0] ?? "System";
            }

            return (
              <div key={`comment-${comment.id}`} className="flex items-center gap-3 px-2 py-1.5 overflow-hidden" data-testid={`timeline-comment-${comment.id}`}>
                <div className="flex-1 h-px bg-border shrink-0 min-w-[20px]" />
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
                  <Activity className="h-3 w-3 shrink-0" />
                  <span className="truncate" title={displayText}>{displayText}</span>
                </div>
                <div className="flex-1 h-px bg-border shrink-0 min-w-[20px]" />
              </div>
            );
          }

          // Resolve author name — agent or user
          const authorAgent = comment.authorAgentId
            ? agentMap.get(comment.authorAgentId)
            : null;
          const authorName = comment.authorAgentId
            ? (authorAgent?.name ?? "Agent")
            : (comment.authorUserId ? "You" : "System");
          const isAgentComment = !!comment.authorAgentId;
          return (
            <TimelineUserMessage
              key={`comment-${comment.id}`}
              comment={comment}
              authorName={authorName}
              isAgent={isAgentComment}
            />
          );
        })}
      </div>

      {/* Chatbar — unified 3-row widget fixed at bottom */}
      {assignedAgent && (
        <div className="shrink-0 mx-3 mb-3 border border-border rounded-lg overflow-hidden bg-background" data-testid="workspace-chatbar">
          {/* Status row */}
          <ChatbarStatusRow
            agentName={assignedAgent.name}
            adapterType={agentAdapterType}
            fileCount={latestFileCount}
            totalBytes={latestTotalBytes}
            tokensUsed={null}
            contextLimit={null}
            todoProgress={null}
          />

          {/* Textarea */}
          <div className="border-t border-border/50">
            <textarea
              ref={textareaRef}
              className="w-full bg-transparent px-3 py-2 text-sm resize-none focus:outline-none placeholder:text-muted-foreground/50"
              placeholder={`Message ${assignedAgent.name}...`}
              rows={1}
              value={chatInput}
              onChange={handleTextareaChange}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
          </div>

          {/* Controls row */}
          <div className="border-t border-border/50">
            <ChatbarControls
              adapterType={agentAdapterType}
              defaultModel={agentDefaultModel}
              selectedModel={modelOverride}
              onModelChange={setModelOverride}
              onSend={handleSend}
              sendDisabled={!chatInput.trim() || sendMessage.isPending}
              sendPending={sendMessage.isPending}
            />
          </div>
        </div>
      )}

      {/* Fallback when no agent assigned */}
      {!assignedAgent && (
        <div className="shrink-0 mx-3 mb-3 border border-border rounded-lg overflow-hidden bg-background" data-testid="workspace-chatbar-fallback">
          <div className="px-3 py-1.5 text-xs text-muted-foreground">
            No agent assigned
          </div>
          <div className="border-t border-border/50">
            <textarea
              className="w-full bg-transparent px-3 py-2 text-sm resize-none focus:outline-none placeholder:text-muted-foreground/50"
              placeholder="Add a comment..."
              rows={1}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
          </div>
          <div className="border-t border-border/50 px-3 py-1.5 flex justify-end">
            <Button
              size="sm"
              className="h-7 text-xs px-3"
              disabled={!chatInput.trim() || sendMessage.isPending}
              onClick={handleSend}
            >
              Comment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
