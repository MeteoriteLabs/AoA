/**
 * ThreadTab — group-chat message stream.
 * Uses EntryRow for each entry (bubble/card style).
 * Composer at the bottom is the new Phase E1 EntryComposer with
 * @-autocomplete, attachments, and reply support.
 */
import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { discussionsApi, type DiscussionEntry } from "../../api/discussions";
import { authApi } from "../../api/auth";
import { agentsApi } from "../../api/agents";
import { assetsApi } from "../../api/assets";
import { teamApi } from "../../api/team";
import { issuesApi } from "../../api/issues";
import { useToast } from "../../context/ToastContext";
import { useLiveUpdates } from "../../context/LiveUpdatesProvider";
import { queryKeys } from "../../lib/queryKeys";
import { EntryRow } from "./EntryRow";
import { EntryComposer, type AgentRef, type AssetRef, type UserRef } from "./EntryComposer";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useNavigate } from "@/lib/router";

/* ════════════════════════════════════════════════════════════════════════
   ThreadTab
   ════════════════════════════════════════════════════════════════════════ */

export interface ThreadTabProps {
  threadId: string;
  companyId: string;
  entries: DiscussionEntry[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function ThreadTab({
  threadId,
  companyId,
  entries,
  isLoading,
  isError,
  onRetry,
}: ThreadTabProps) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { connectionState } = useLiveUpdates();
  const isOffline = connectionState === "offline";
  const isReconnecting = connectionState === "reconnecting";
  const isDisconnected = isOffline || isReconnecting;

  // Current user identity — for right-aligning own messages
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId =
    (session as Record<string, unknown> | undefined)?.userId as string | null ??
    (session as { user?: { id?: string } } | undefined)?.user?.id ??
    null;

  // Suggestions for the @-autocomplete: AoA crew agents + team members.
  // Both queries are cheap and cached by react-query; we tolerate failure
  // silently because autocomplete is non-critical.
  const { data: agentsData } = useQuery({
    queryKey: ["agents", companyId, "aoa"],
    queryFn: () => agentsApi.listAoa(companyId),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const { data: teamData } = useQuery({
    queryKey: ["team", companyId],
    queryFn: () => teamApi.get(companyId),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const composerAgents: AgentRef[] = useMemo(
    () =>
      (agentsData ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        icon: a.icon,
        role: a.role,
      })),
    [agentsData],
  );

  const composerUsers: UserRef[] = useMemo(() => {
    const team = teamData as { members?: Array<{ userId: string; displayName?: string | null; email?: string | null }> } | undefined;
    return (team?.members ?? []).map((m) => ({
      id: m.userId,
      name: m.displayName ?? m.email ?? m.userId,
      email: m.email ?? null,
    }));
  }, [teamData]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (entries.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [entries.length]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["threads", companyId, threadId] });
  };

  const addEntryMutation = useMutation({
    mutationFn: (payload: {
      rawContent: string;
      attachments: AssetRef[];
      parentEntryId: string | null;
    }) =>
      discussionsApi.addEntry(companyId, threadId, {
        rawContent: payload.rawContent,
        inputType: "write",
        parentEntryId: payload.parentEntryId,
        // Phase E1: pass attachment ids so the server links them in the same txn.
        attachments: payload.attachments.length
          ? payload.attachments.map((a) => ({ assetId: a.id }))
          : undefined,
      } as Parameters<typeof discussionsApi.addEntry>[2]),
    onSuccess: () => {
      invalidate();
    },
    onError: () => {
      pushToast({ title: "Failed to send message", tone: "warn" });
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: (entryId: string) =>
      discussionsApi.reprocessEntry(companyId, threadId, entryId),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Reprocessing entry…", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to reprocess entry", tone: "warn" });
    },
  });

  // P1-T7: Approve a scope proposal — calls the secure server handler which
  // independently authorizes, validates staleness, and creates deliverable tasks.
  const approveProposalMutation = useMutation({
    mutationFn: (proposalEntryId: string) =>
      discussionsApi.approveProposal(companyId, threadId, proposalEntryId),
    onSuccess: (data) => {
      invalidate();
      if (data.alreadyApproved) {
        pushToast({ title: "Proposal already approved", tone: "success" });
      } else {
        pushToast({
          title: `${data.tasksCreated.length} task${data.tasksCreated.length === 1 ? "" : "s"} created`,
          tone: "success",
        });
      }
    },
    onError: (err: unknown) => {
      const message =
        (err as { body?: { error?: string } })?.body?.error ??
        (err as { message?: string })?.message ??
        "Failed to approve proposal";
      pushToast({ title: message, tone: "warn" });
    },
  });

  // P2-T2: crew-failure card actions.
  const retryTaskMutation = useMutation({
    mutationFn: (issueId: string) => issuesApi.update(issueId, { status: "todo" }),
    onSuccess: () => {
      pushToast({ title: "Task re-queued", tone: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
    },
    onError: () => pushToast({ title: "Failed to retry task", tone: "warn" }),
  });
  const skipTaskMutation = useMutation({
    mutationFn: (issueId: string) => issuesApi.update(issueId, { status: "cancelled" }),
    onSuccess: () => {
      pushToast({ title: "Task skipped", tone: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
    },
    onError: () => pushToast({ title: "Failed to skip task", tone: "warn" }),
  });

  async function handleComposerSubmit(payload: {
    text: string;
    mentions: string[];
    parentEntryId: string | null;
    attachments: AssetRef[];
  }) {
    if (isDisconnected) {
      pushToast({
        title: isOffline ? "You're offline — message not sent" : "Reconnecting — message not sent",
        tone: "warn",
      });
      return;
    }
    await addEntryMutation.mutateAsync({
      rawContent: payload.text,
      attachments: payload.attachments,
      parentEntryId: payload.parentEntryId,
    });
  }

  async function handleUpload(file: File): Promise<AssetRef> {
    const res = await assetsApi.uploadFile(companyId, file, "discussion-entries");
    return {
      id: res.assetId,
      name: res.originalFilename ?? file.name,
      mimeType: res.contentType,
    };
  }

  // ── Loading skeleton ──
  if (isLoading) {
    return (
      <div className="space-y-4 py-4" data-testid="thread-tab-skeleton">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 rounded bg-muted animate-pulse w-24" />
              <div
                className="h-12 rounded-xl bg-muted animate-pulse"
                style={{ borderRadius: "4px 14px 14px 14px" }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Error state ──
  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-8" data-testid="thread-tab-error">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load messages.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  // Derive user initials for composer avatar
  const myInitials = currentUserId
    ? currentUserId === "local-board"
      ? "LB"
      : currentUserId.replace(/[-_]/g, " ").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "Me"
    : "Me";

  const composer = (
    <div data-testid="thread-composer">
      <EntryComposer
        threadId={threadId}
        agents={composerAgents}
        users={composerUsers}
        onUpload={handleUpload}
        onSubmit={handleComposerSubmit}
        disabled={isDisconnected || addEntryMutation.isPending}
        myInitials={myInitials}
        hint={
          isDisconnected
            ? (
                <span data-testid="thread-composer-offline-hint">
                  {isOffline ? "You're offline — messages won't send" : "Reconnecting…"}
                </span>
              )
            : undefined
        }
      />
    </div>
  );

  // ── Empty state ──
  if (entries.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center py-12 text-center px-6">
          <p className="text-sm text-muted-foreground mb-1">No messages yet.</p>
          <p className="text-xs text-muted-foreground/60">Start the discussion below.</p>
        </div>
        {composer}
      </div>
    );
  }

  // P1-T7: The most-recent scope_proposal entry in the thread is the "active" one.
  // Older proposals are shown read-only (isActive=false, buttons disabled by card).
  const activeProposalEntryId = useMemo(() => {
    const proposals = entries.filter((e) => e.inputType === "scope_proposal");
    return proposals.length > 0 ? proposals[proposals.length - 1].id : null;
  }, [entries]);

  // Group: top-level first, replies underneath; orphan replies treated as top-level
  const topLevel = entries.filter((e) => !e.parentEntryId);
  const topLevelIds = new Set(topLevel.map((e) => e.id));
  const repliesByParent = new Map<string, DiscussionEntry[]>();
  for (const e of entries) {
    if (e.parentEntryId && topLevelIds.has(e.parentEntryId)) {
      const list = repliesByParent.get(e.parentEntryId) ?? [];
      list.push(e);
      repliesByParent.set(e.parentEntryId, list);
    }
  }
  const orphans = entries.filter((e) => e.parentEntryId && !topLevelIds.has(e.parentEntryId));
  const roots = [...topLevel, ...orphans];

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3"
        data-testid="thread-tab-entries"
      >
        {roots.map((entry) => {
          const replies = repliesByParent.get(entry.id) ?? [];
          // Phase E2: client-side reply count when server doesn't supply one.
          const enrichedEntry: DiscussionEntry = {
            ...entry,
            replyCount: entry.replyCount ?? replies.length,
          };
          return (
            <div key={entry.id} data-testid={`entry-group-${entry.id}`} className="space-y-2">
              <EntryRow
                entry={enrichedEntry}
                currentUserId={currentUserId}
                onReprocess={() => reprocessMutation.mutate(entry.id)}
                isReprocessing={
                  reprocessMutation.isPending && reprocessMutation.variables === entry.id
                }
                scopeProposalActive={entry.id === activeProposalEntryId}
                onScopeProposalApprove={(e) => approveProposalMutation.mutate(e.id)}
                onCrewFailureRetry={(issueId) => retryTaskMutation.mutate(issueId)}
                onCrewFailureReassign={(issueId) => navigate(`/issues/${issueId}`)}
                onCrewFailureSkip={(issueId) => skipTaskMutation.mutate(issueId)}
              />
              {replies.map((reply) => (
                <div key={reply.id} className="pl-10">
                  <EntryRow
                    entry={reply}
                    currentUserId={currentUserId}
                    onReprocess={() => reprocessMutation.mutate(reply.id)}
                    isReprocessing={
                      reprocessMutation.isPending && reprocessMutation.variables === reply.id
                    }
                    onCrewFailureRetry={(issueId) => retryTaskMutation.mutate(issueId)}
                    onCrewFailureReassign={(issueId) => navigate(`/issues/${issueId}`)}
                    onCrewFailureSkip={(issueId) => skipTaskMutation.mutate(issueId)}
                  />
                </div>
              ))}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {composer}
    </div>
  );
}
