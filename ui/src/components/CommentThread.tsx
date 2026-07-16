import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import type { IssueComment, Agent, FeedbackVote } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { AtSign, Mic, Paperclip } from "lucide-react";
import { Identity } from "./Identity";
import { InlineEntitySelector, type InlineEntityOption } from "./InlineEntitySelector";
import { MarkdownBody } from "./MarkdownBody";
import { MarkdownEditor, type MarkdownEditorRef, type MentionOption } from "./MarkdownEditor";
import { StatusBadge } from "./StatusBadge";
import { AgentIcon } from "./AgentIconPicker";
import { FeedbackThumbs } from "./FeedbackThumbs";
import { IssueRunLedger, type IssueRunLedgerItem } from "./IssueRunLedger";
import { SystemNotice } from "./SystemNotice";
import { isSystemNoticeComment } from "../lib/system-notice-comment";
import { parseTaskAssigneeValue, taskAssigneePayload } from "../lib/task-assignee";
import { formatDateTime } from "../lib/utils";
import {
  resolveTaskCommentAction,
} from "../lib/task-composer-actions";
import { COMPOSER_ATTACHMENT_CONTENT_TYPES, COMPOSER_MAX_ATTACHMENTS, COMPOSER_MAX_ATTACHMENT_BYTES } from "@armyofagents/shared";
import { ComposerFrame } from "./composer/ComposerFrame";
import { ComposerIconButton } from "./composer/ComposerIconButton";
import { ComposerAttachmentCard } from "./composer/ComposerAttachmentCard";

export { resolveTaskCommentAction } from "../lib/task-composer-actions";
export type { TaskCommentAction, TaskCommentActionInput } from "../lib/task-composer-actions";

interface CommentWithRunMeta extends IssueComment {
  runId?: string | null;
  runAgentId?: string | null;
}

interface LinkedRunItem extends Omit<IssueRunLedgerItem, "finishedAt" | "invocationSource" | "usageJson" | "resultJson" | "detectedOutputs"> {
  runId: string;
  status: string;
  agentId: string;
  createdAt: Date | string;
  startedAt: Date | string | null;
}

interface CommentReassignment {
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
}

interface CommentThreadProps {
  comments: CommentWithRunMeta[];
  linkedRuns?: LinkedRunItem[];
  onAdd: (body: string, reopen?: boolean, reassignment?: CommentReassignment, interrupt?: boolean) => Promise<void>;
  onAddWithAttachments?: (body: string, files: File[], reopen?: boolean, interrupt?: boolean) => Promise<void>;
  issueStatus?: string;
  agentMap?: Map<string, Agent>;
  imageUploadHandler?: (file: File) => Promise<string>;
  /** Callback to attach an image file to the parent issue (not inline in a comment). */
  onAttachImage?: (file: File) => Promise<void>;
  draftKey?: string;
  liveRunSlot?: React.ReactNode;
  enableReassign?: boolean;
  reassignOptions?: InlineEntityOption[];
  currentAssigneeValue?: string;
  mentions?: MentionOption[];
  /** True when this task currently has a running agent execution. */
  hasActiveRun?: boolean;
  /**
   * When provided, agent-authored comments render a thumbs up/down widget. The
   * existingVotes map lets the widget reflect the user's prior choice without
   * flicker. Both must be set for the widget to appear.
   */
  feedbackIssueId?: string;
  existingVotesByCommentId?: Map<string, FeedbackVote>;
  onVoteChange?: () => void;
}

const CLOSED_STATUSES = new Set(["done", "cancelled"]);
const DRAFT_DEBOUNCE_MS = 800;

function loadDraft(draftKey: string): string {
  try {
    return localStorage.getItem(draftKey) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(draftKey: string, value: string) {
  try {
    if (value.trim()) {
      localStorage.setItem(draftKey, value);
    } else {
      localStorage.removeItem(draftKey);
    }
  } catch {
    // Ignore localStorage failures.
  }
}

function clearDraft(draftKey: string) {
  try {
    localStorage.removeItem(draftKey);
  } catch {
    // Ignore localStorage failures.
  }
}

function parseReassignment(target: string): CommentReassignment | null {
  if (!target || target === "__none__") {
    return { assigneeAgentId: null, assigneeUserId: null };
  }
  const parsed = parseTaskAssigneeValue(target);
  return parsed.kind === "none" ? null : taskAssigneePayload(target);
}

type TimelineItem =
  | { kind: "comment"; id: string; createdAtMs: number; comment: CommentWithRunMeta }
  | { kind: "run"; id: string; createdAtMs: number; run: LinkedRunItem };

const TimelineList = memo(function TimelineList({
  timeline,
  agentMap,
  highlightCommentId,
  feedbackIssueId,
  existingVotesByCommentId,
  onVoteChange,
}: {
  timeline: TimelineItem[];
  agentMap?: Map<string, Agent>;
  highlightCommentId?: string | null;
  feedbackIssueId?: string;
  existingVotesByCommentId?: Map<string, FeedbackVote>;
  onVoteChange?: () => void;
}) {
  if (timeline.length === 0) {
    return <p className="text-sm text-muted-foreground">No comments or runs yet.</p>;
  }

  return (
    <div className="space-y-3">
      {timeline.map((item) => {
        if (item.kind === "run") {
          const run = item.run;
          return (
            <div key={`run:${run.runId}`} className="space-y-2">
              <div className="flex items-center justify-between">
                <Link to={`/agents/${run.agentId}`} className="hover:underline">
                  <Identity
                    name={agentMap?.get(run.agentId)?.name ?? run.agentId.slice(0, 8)}
                    size="sm"
                  />
                </Link>
              </div>
              <IssueRunLedger runs={[run]} />
            </div>
          );
        }

        const comment = item.comment;
        const isHighlighted = highlightCommentId === comment.id;
        if (isSystemNoticeComment(comment)) {
          return <SystemNotice key={comment.id} comment={comment} />;
        }

        return (
          <div
            key={comment.id}
            id={`comment-${comment.id}`}
            className={`border p-3 overflow-hidden min-w-0 rounded-sm transition-colors duration-1000 ${isHighlighted ? "border-primary/50 bg-primary/5" : "border-border"}`}
          >
            <div className="flex items-center justify-between mb-1">
              {comment.authorAgentId ? (
                <Link to={`/agents/${comment.authorAgentId}`} className="hover:underline">
                  <Identity
                    name={agentMap?.get(comment.authorAgentId)?.name ?? comment.authorAgentId.slice(0, 8)}
                    size="sm"
                  />
                </Link>
              ) : comment.authorUserId ? (
                <Identity name="You" size="sm" />
              ) : (
                <span className="text-xs text-muted-foreground italic">System</span>
              )}
              <a
                href={`#comment-${comment.id}`}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
              >
                {formatDateTime(comment.createdAt)}
              </a>
            </div>
            <MarkdownBody className="text-sm">{comment.body}</MarkdownBody>
            {comment.runId && (
              <div className="mt-2 pt-2 border-t border-border/60">
                {comment.runAgentId ? (
                  <Link
                    to={`/agents/${comment.runAgentId}/runs/${comment.runId}`}
                    className="inline-flex items-center rounded-md border border-border bg-accent/30 px-2 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                  >
                    run {comment.runId.slice(0, 8)}
                  </Link>
                ) : (
                  <span className="inline-flex items-center rounded-md border border-border bg-accent/30 px-2 py-1 text-[10px] font-mono text-muted-foreground">
                    run {comment.runId.slice(0, 8)}
                  </span>
                )}
              </div>
            )}
            {feedbackIssueId && comment.authorAgentId ? (
              <div className="mt-2 pt-2 border-t border-border/60">
                <FeedbackThumbs
                  issueId={feedbackIssueId}
                  targetType="issue_comment"
                  targetId={comment.id}
                  initialVote={existingVotesByCommentId?.get(comment.id) ?? null}
                  onChange={onVoteChange}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

export function CommentThread({
  comments,
  linkedRuns = [],
  onAdd,
  onAddWithAttachments,
  issueStatus,
  agentMap,
  imageUploadHandler,
  onAttachImage,
  draftKey,
  liveRunSlot,
  enableReassign = false,
  reassignOptions = [],
  currentAssigneeValue = "",
  mentions: providedMentions,
  hasActiveRun = false,
  feedbackIssueId,
  existingVotesByCommentId,
  onVoteChange,
}: CommentThreadProps) {
  const [body, setBody] = useState("");
  const [reopen, setReopen] = useState(true);
  const [interrupt, setInterrupt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState(currentAssigneeValue);
  const [highlightCommentId, setHighlightCommentId] = useState<string | null>(null);
  const editorRef = useRef<MarkdownEditorRef>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();
  const hasScrolledRef = useRef(false);

  const isClosed = issueStatus ? CLOSED_STATUSES.has(issueStatus) : false;

  const timeline = useMemo<TimelineItem[]>(() => {
    const commentItems: TimelineItem[] = comments.map((comment) => ({
      kind: "comment",
      id: comment.id,
      createdAtMs: new Date(comment.createdAt).getTime(),
      comment,
    }));
    const runItems: TimelineItem[] = linkedRuns.map((run) => ({
      kind: "run",
      id: run.runId,
      createdAtMs: new Date(run.startedAt ?? run.createdAt).getTime(),
      run,
    }));
    return [...commentItems, ...runItems].sort((a, b) => {
      if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
      if (a.kind === b.kind) return a.id.localeCompare(b.id);
      return a.kind === "comment" ? -1 : 1;
    });
  }, [comments, linkedRuns]);

  // Build mention options from agent map (exclude terminated agents)
  const mentions = useMemo<MentionOption[]>(() => {
    if (providedMentions) return providedMentions;
    if (!agentMap) return [];
    return Array.from(agentMap.values())
      .filter((a) => a.status !== "terminated")
      .map((a) => ({
        id: a.id,
        name: a.name,
      }));
  }, [agentMap, providedMentions]);

  useEffect(() => {
    if (!draftKey) return;
    setBody(loadDraft(draftKey));
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      saveDraft(draftKey, body);
    }, DRAFT_DEBOUNCE_MS);
  }, [body, draftKey]);

  useEffect(() => {
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, []);

  useEffect(() => {
    setReassignTarget(currentAssigneeValue);
  }, [currentAssigneeValue]);

  // Scroll to comment when URL hash matches #comment-{id}
  useEffect(() => {
    const hash = location.hash;
    if (!hash.startsWith("#comment-") || comments.length === 0) return;
    const commentId = hash.slice("#comment-".length);
    // Only scroll once per hash
    if (hasScrolledRef.current) return;
    const el = document.getElementById(`comment-${commentId}`);
    if (el) {
      hasScrolledRef.current = true;
      setHighlightCommentId(commentId);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Clear highlight after animation
      const timer = setTimeout(() => setHighlightCommentId(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [location.hash, comments]);

  async function handleSubmit() {
    const trimmed = body.trim();
    if (!trimmed && selectedFiles.length === 0) return;
    const hasReassignment = enableReassign && reassignTarget !== currentAssigneeValue;
    const reassignment = hasReassignment ? parseReassignment(reassignTarget) : null;
    const action = resolveTaskCommentAction({
      isClosed,
      reopenRequested: reopen,
      hasActiveRun,
      interruptRequested: interrupt,
      hasReassignment: !!reassignment,
    });

    if (selectedFiles.length > 0 && reassignment) {
      setAttachmentError("Remove attachments before changing the assignee.");
      return;
    }

    setSubmitting(true);
    try {
      if (selectedFiles.length > 0 && onAddWithAttachments && !reassignment) {
        await onAddWithAttachments(trimmed, [...selectedFiles], action === "reopen" ? true : undefined, action === "interrupt" ? true : undefined);
      } else {
        await onAdd(trimmed, action === "reopen" ? true : undefined, reassignment ?? undefined, action === "interrupt" ? true : undefined);
      }
      setBody("");
      setSelectedFiles([]);
      setAttachmentError(null);
      if (draftKey) clearDraft(draftKey);
      setReopen(false);
      setInterrupt(false);
      setReassignTarget(currentAssigneeValue);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAttachFile(evt: ChangeEvent<HTMLInputElement>) {
    const file = evt.target.files?.[0];
    if (!file) return;
    if (onAddWithAttachments) {
      if (selectedFiles.length >= COMPOSER_MAX_ATTACHMENTS) setAttachmentError(`Attach up to ${COMPOSER_MAX_ATTACHMENTS} files per comment.`);
      else if (!COMPOSER_ATTACHMENT_CONTENT_TYPES.includes(file.type as (typeof COMPOSER_ATTACHMENT_CONTENT_TYPES)[number])) setAttachmentError(`Unsupported attachment type: ${file.type || "unknown"}.`);
      else if (file.size > COMPOSER_MAX_ATTACHMENT_BYTES) setAttachmentError(`${file.name} exceeds the 10 MB attachment limit.`);
      else { setSelectedFiles((current) => [...current, file]); setAttachmentError(null); }
      if (attachInputRef.current) attachInputRef.current.value = "";
      return;
    }
    if (!onAttachImage) return;
    setAttaching(true);
    try {
      await onAttachImage(file);
    } finally {
      setAttaching(false);
      if (attachInputRef.current) attachInputRef.current.value = "";
    }
  }

  const canSubmit = !submitting && (!!body.trim() || selectedFiles.length > 0);
  const hasReassignment = enableReassign && reassignTarget !== currentAssigneeValue;

  return (
    <ComposerFrame
      className="flex min-h-0 flex-1 flex-col gap-3"
      data-testid="task-comments-panel"
      density="comfortable"
    >
      <h3 className="shrink-0 text-sm font-semibold">Comments &amp; Runs ({timeline.length})</h3>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
        data-testid="task-comments-timeline"
      >
        <TimelineList
          timeline={timeline}
          agentMap={agentMap}
          highlightCommentId={highlightCommentId}
          feedbackIssueId={feedbackIssueId}
          existingVotesByCommentId={existingVotesByCommentId}
          onVoteChange={onVoteChange}
        />

        {liveRunSlot ? <div className="mt-3">{liveRunSlot}</div> : null}
      </div>

      {/* Sticky positioning stays OUTSIDE the card (card chrome on a sticky
          scroll sibling breaks the layout); the Quiet Operator frame wraps only
          the composer content. */}
      <div
        className="sticky bottom-0 z-10 shrink-0 border-t border-border bg-background pt-3"
        data-testid="task-comments-composer"
      >
        <ComposerFrame chrome="card" density="compact" className="gap-2 p-2.5">
        {selectedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="task-comment-attachments">
            {selectedFiles.map((file, index) => (
              <ComposerAttachmentCard
                key={`${file.name}-${file.size}-${index}`}
                name={file.name}
                byteSize={file.size}
                state="ready"
                onRemove={() => setSelectedFiles((current) => current.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        )}
        {attachmentError && <div className="text-xs text-destructive" role="alert">{attachmentError}</div>}
        <MarkdownEditor
          ref={editorRef}
          value={body}
          onChange={setBody}
          placeholder="Leave a comment..."
          mentions={mentions}
          onSubmit={handleSubmit}
          imageUploadHandler={imageUploadHandler}
          contentClassName="min-h-[60px] text-sm"
          bordered={false}
        />
        <div className="flex items-center justify-end gap-3">
          {onAttachImage && (
            <div className="mr-auto flex items-center gap-3">
              <input
                ref={attachInputRef}
                type="file"
                accept={COMPOSER_ATTACHMENT_CONTENT_TYPES.join(",")}
                className="hidden"
                onChange={handleAttachFile}
              />
              <ComposerIconButton
                onClick={() => attachInputRef.current?.click()}
                disabled={attaching}
                title="Attach file"
                aria-label="Attach file"
              >
                <Paperclip className="h-4 w-4" />
              </ComposerIconButton>
              <ComposerIconButton
                onClick={() => {
                  // Boundary-safe insert: the editor's mention detector only
                  // fires on start-or-whitespace + "@", so glue a space on when
                  // the body doesn't end with one (mock v2: the @ button always
                  // opens the picker).
                  const needsSpace = body.length > 0 && !/\s$/.test(body);
                  editorRef.current?.insertText(needsSpace ? " @" : "@");
                }}
                title="Mention someone"
                aria-label="Mention someone"
                data-testid="task-comments-mention-button"
              >
                <AtSign className="h-4 w-4" />
              </ComposerIconButton>
              <ComposerIconButton title="Voice input" aria-label="Voice input" comingSoon>
                <Mic className="h-4 w-4" />
              </ComposerIconButton>
            </div>
          )}
          {isClosed && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={reopen}
                onChange={(e) => setReopen(e.target.checked)}
                className="rounded border-border"
              />
              Re-open
            </label>
          )}
          {enableReassign && reassignOptions.length > 0 && (
            <InlineEntitySelector
              value={reassignTarget}
              options={reassignOptions}
              placeholder="Assignee"
              noneLabel="No assignee"
              searchPlaceholder="Search assignees..."
              emptyMessage="No assignees found."
              onChange={setReassignTarget}
              className="text-xs h-8"
              renderTriggerValue={(option) => {
                if (!option) return <span className="text-muted-foreground">Assignee</span>;
                const parsed = parseTaskAssigneeValue(option.id);
                const agentId = parsed.kind === "agent" ? parsed.id : null;
                const agent = agentId ? agentMap?.get(agentId) : null;
                return (
                  <>
                    {agent ? (
                      <AgentIcon icon={agent.icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                    <span className="truncate">{option.label}</span>
                  </>
                );
              }}
              renderOption={(option) => {
                if (!option.id) return <span className="truncate">{option.label}</span>;
                const parsed = parseTaskAssigneeValue(option.id);
                const agentId = parsed.kind === "agent" ? parsed.id : null;
                const agent = agentId ? agentMap?.get(agentId) : null;
                return (
                  <>
                    {agent ? (
                      <AgentIcon icon={agent.icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                    <span className="truncate">{option.label}</span>
                  </>
                );
              }}
            />
          )}
          <Button size="sm" className="bg-brand text-white hover:bg-brand/90" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? "Posting..." : "Comment"}
          </Button>
        </div>
        </ComposerFrame>

        {/* Interrupt is a deliberate, separate choice BELOW the card (approved
            mock §4); still a flag applied on the next send. */}
        {hasActiveRun && !isClosed && (
          <label className="mt-2 flex cursor-pointer select-none items-center gap-2 text-[11px] text-muted-foreground" data-testid="task-comments-interrupt">
            <input
              type="checkbox"
              checked={interrupt}
              disabled={hasReassignment}
              onChange={(e) => setInterrupt(e.target.checked)}
              className="rounded border-border"
            />
            Interrupt active run — applies to the next send
          </label>
        )}
      </div>
    </ComposerFrame>
  );
}
