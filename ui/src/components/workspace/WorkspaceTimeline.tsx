import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { TimelineTaskBrief } from "./TimelineTaskBrief";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "../../context/ToastContext";
import { Activity } from "lucide-react";
import type { IssueComment, Agent } from "@armyofagents/shared";
import { ChatbarStatusRow } from "./ChatbarStatusRow";
import { ChatbarControls } from "./ChatbarControls";
import { useRunTokens } from "./useRunTokens";
import { useLatestTodos } from "./useLatestTodos";
import { getContextLimit } from "./adapter-utils";
import type { ActiveRunForIssue, LiveRunForIssue } from "../../api/heartbeats";

export type TimelineItem =
  | { kind: "run"; ts: string; data: RunForIssue }
  | { kind: "comment"; ts: string; data: IssueComment };

function normalizeTimelineDate(value: string | Date | null): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : value.toISOString();
}

function liveRunToTimelineRun(run: LiveRunForIssue | ActiveRunForIssue): RunForIssue {
  return {
    runId: run.id,
    status: run.status,
    agentId: run.agentId,
    startedAt: normalizeTimelineDate(run.startedAt),
    finishedAt: normalizeTimelineDate(run.finishedAt),
    createdAt: normalizeTimelineDate(run.createdAt) ?? new Date().toISOString(),
    invocationSource: run.invocationSource,
    logStore: run.logStore,
    logRef: run.logRef,
    processPid: run.processPid,
    processStartedAt: normalizeTimelineDate(run.processStartedAt ?? null),
    lastOutputAt: normalizeTimelineDate(run.lastOutputAt ?? null),
    usageJson: null,
    resultJson: null,
    detectedOutputs: null,
  };
}

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
  const isPinnedToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [hasUnseenActivity, setHasUnseenActivity] = useState(false);

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

  const { data: attachments } = useQuery({
    queryKey: queryKeys.issues.attachments(issueId),
    queryFn: () => issuesApi.listAttachments(issueId),
    enabled: !!issueId,
  });

  const { data: contextBundles } = useQuery({
    queryKey: ["issues", "context-bundles", issueId],
    queryFn: () => issuesApi.listContextBundles(issueId),
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

  const liveTimelineRuns = useMemo(() => {
    const live: Array<LiveRunForIssue | ActiveRunForIssue> = [...(liveRuns ?? [])];
    if (activeRun && !live.some((run) => run.id === activeRun.id)) {
      live.push(activeRun);
    }
    return live.map(liveRunToTimelineRun);
  }, [liveRuns, activeRun]);

  // Merge runs + comments chronologically
  const mergedTimeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...liveTimelineRuns.map((r) => ({
        kind: "run" as const,
        ts: r.startedAt ?? r.createdAt,
        data: r,
      })),
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
  }, [liveTimelineRuns, timelineRuns, comments]);

  const attachmentsByCommentId = useMemo(() => {
    const grouped = new Map<string, NonNullable<typeof attachments>>();
    for (const attachment of attachments ?? []) {
      if (!attachment.issueCommentId) continue;
      const existing = grouped.get(attachment.issueCommentId) ?? [];
      grouped.set(attachment.issueCommentId, [...existing, attachment]);
    }
    return grouped;
  }, [attachments]);

  const taskAttachments = useMemo(
    () => (attachments ?? []).filter((attachment) => !attachment.issueCommentId),
    [attachments],
  );

  const scrollToTimelineBottom = useCallback(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    isPinnedToBottomRef.current = true;
    setHasUnseenActivity(false);
  }, []);

  const handleTimelineScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distanceFromBottom <= 96;
    isPinnedToBottomRef.current = pinned;
    if (pinned) setHasUnseenActivity(false);
  }, []);

  const handleTimelineActivity = useCallback(() => {
    if (!scrollRef.current) return;
    if (isPinnedToBottomRef.current) {
      scrollToTimelineBottom();
    } else {
      setHasUnseenActivity(true);
    }
  }, [scrollToTimelineBottom]);

  // Auto-follow new content only while the reader is pinned near the bottom.
  useEffect(() => {
    handleTimelineActivity();
  }, [mergedTimeline.length, hasLiveRuns, handleTimelineActivity]);

  // Agent resolution — always use the task's assigned agent
  const assignedAgentId = issue?.assigneeAgentId ?? null;
  const assignedAgent = assignedAgentId ? agentMap.get(assignedAgentId) : null;
  const agentAdapterType = assignedAgent?.adapterType ?? "process";
  const agentDefaultModel = (assignedAgent?.adapterConfig as Record<string, unknown>)?.model as string | null ?? null;

  const latestRun = linkedRuns?.[0] ?? null;

  // Token usage across all runs
  const tokenSummary = useRunTokens(linkedRuns);

  // Todo progress from latest run
  const todoData = useLatestTodos(latestRun, activeRun ?? null, agentAdapterType);

  // --- Mutations ---

  const sendMessage = useMutation({
    mutationFn: async ({ text, files }: { text: string; files: File[] }) => {
      if (files.length > 0) {
        await issuesApi.addCommentWithAttachments(issueId, text, files);
        return;
      }
      await issuesApi.addComment(issueId, text);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(issueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.attachments(issueId) });
      setChatInput("");
      setSelectedFiles([]);
      setModelOverride(null); // Reset model override after send
    },
  });

  const canSend = chatInput.trim().length > 0 || selectedFiles.length > 0;

  const handleAttach = () => {
    fileInputRef.current?.click();
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files ?? []);
    if (incoming.length === 0) return;
    const next = [...selectedFiles, ...incoming].slice(0, 5);
    if (selectedFiles.length + incoming.length > 5) {
      pushToast({ tone: "error", title: "Too many attachments", body: "Attach up to 5 files per message." });
    }
    setSelectedFiles(next);
    e.target.value = "";
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((files) => files.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if (canSend) {
      sendMessage.mutate({ text: chatInput.trim(), files: selectedFiles });
    }
  };

  const chatbarRunState =
    hasLiveRuns ? "running"
      : issue?.status === "done" ? "done"
        : issue?.status === "blocked" ? "blocked"
          : "idle";

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden", className)} data-testid="workspace-timeline">
      {/* Scrollable timeline */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-5"
        data-testid="timeline-scroll"
        onScroll={handleTimelineScroll}
      >
        <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4" data-testid="timeline-thread-lane">
        {(commentsLoading || runsLoading) && (
          <div className="space-y-3" data-testid="timeline-skeleton">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {mergedTimeline.length === 0 && !hasLiveRuns && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No runs or comments yet. Send a message to start work.
          </p>
        )}

        {/* Timeline items — structured conversation */}
        {issue && (
          <TimelineTaskBrief
            issue={issue}
            attachments={taskAttachments}
            contextBundles={contextBundles ?? []}
            agentName={assignedAgent?.name ?? null}
          />
        )}

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
                onActivity={handleTimelineActivity}
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
              attachments={attachmentsByCommentId.get(comment.id) ?? []}
            />
          );
        })}
        </div>
      </div>

      {/* Chatbar — unified 3-row widget fixed at bottom */}
      {hasUnseenActivity && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 z-10 flex justify-center">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="pointer-events-auto h-7 rounded-full border border-border bg-background/95 px-3 text-xs shadow-sm"
            onClick={scrollToTimelineBottom}
          >
            New activity
          </Button>
        </div>
      )}

      {assignedAgent && (
        <div className="shrink-0 mx-3 mb-3 border border-border rounded-lg overflow-hidden bg-background" data-testid="workspace-chatbar">
          {/* Status row */}
          <ChatbarStatusRow
            agentName={assignedAgent.name}
            adapterType={agentAdapterType}
            tokensUsed={tokenSummary.totalTokens > 0 ? tokenSummary.totalTokens : null}
            contextLimit={getContextLimit(agentDefaultModel)}
            todoProgress={todoData.total > 0 ? { completed: todoData.completed, total: todoData.total } : null}
            todoItems={todoData.total > 0 ? todoData.todos : null}
            runState={chatbarRunState}
            runDurationLabel={null}
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

          <input
            ref={fileInputRef}
            data-testid="workspace-chatbar-file-input"
            type="file"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
          {selectedFiles.length > 0 && (
            <div className="border-t border-border/50 px-3 py-1.5">
              <div className="flex flex-wrap gap-1">
                {selectedFiles.map((file, index) => (
                  <button
                    key={`${file.name}-${file.size}-${index}`}
                    type="button"
                    onClick={() => removeSelectedFile(index)}
                    className="max-w-full truncate rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                    title="Remove attachment"
                  >
                    {file.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Controls row */}
          <div className="border-t border-border/50">
            <ChatbarControls
              adapterType={agentAdapterType}
              defaultModel={agentDefaultModel}
              selectedModel={modelOverride}
              onModelChange={setModelOverride}
              onAttach={handleAttach}
              onSend={handleSend}
              sendDisabled={!canSend || sendMessage.isPending}
              sendPending={sendMessage.isPending}
            />
          </div>
        </div>
      )}

      {/* Fallback when no agent assigned */}
      {!assignedAgent && (
        <div className="shrink-0 mx-3 mb-3 border border-border rounded-lg overflow-hidden bg-background" data-testid="workspace-chatbar-fallback">
          <ChatbarStatusRow
            agentName="No agent assigned"
            adapterType="process"
            tokensUsed={null}
            contextLimit={null}
            todoProgress={todoData.total > 0 ? { completed: todoData.completed, total: todoData.total } : null}
            todoItems={todoData.total > 0 ? todoData.todos : null}
            runState={chatbarRunState}
            runDurationLabel={null}
          />
          <div className="border-t border-border/50">
            <textarea
              ref={textareaRef}
              className="w-full bg-transparent px-3 py-2 text-sm resize-none focus:outline-none placeholder:text-muted-foreground/50"
              placeholder="Add a comment..."
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
          <input
            ref={fileInputRef}
            data-testid="workspace-chatbar-file-input"
            type="file"
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
          {selectedFiles.length > 0 && (
            <div className="border-t border-border/50 px-3 py-1.5">
              <div className="flex flex-wrap gap-1">
                {selectedFiles.map((file, index) => (
                  <button
                    key={`${file.name}-${file.size}-${index}`}
                    type="button"
                    onClick={() => removeSelectedFile(index)}
                    className="max-w-full truncate rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                    title="Remove attachment"
                  >
                    {file.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-border/50">
            <ChatbarControls
              adapterType="comment"
              defaultModel={null}
              selectedModel={modelOverride}
              onModelChange={setModelOverride}
              onAttach={handleAttach}
              onSend={handleSend}
              showModelLabel={false}
              sendDisabled={!canSend || sendMessage.isPending}
              sendPending={sendMessage.isPending}
            />
          </div>
        </div>
      )}
    </div>
  );
}
