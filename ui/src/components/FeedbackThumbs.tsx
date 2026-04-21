import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { FeedbackTargetType, FeedbackVote } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { feedbackApi } from "../api/feedback";

interface FeedbackThumbsProps {
  /** Required per schema — every vote is task-contextualized. */
  issueId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  /** Caller provides the existing vote (usually from a parent useQuery). */
  initialVote?: FeedbackVote | null;
  /** Fires after any successful mutation so callers can refetch. */
  onChange?: (vote: FeedbackVote | null) => void;
  className?: string;
}

export function FeedbackThumbs({
  issueId,
  targetType,
  targetId,
  initialVote = null,
  onChange,
  className,
}: FeedbackThumbsProps) {
  const [vote, setVote] = useState<FeedbackVote | null>(initialVote);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");

  const recordMutation = useMutation({
    mutationFn: (args: { value: "up" | "down"; reason?: string }) =>
      feedbackApi.recordVote(issueId, {
        targetType,
        targetId,
        vote: args.value,
        ...(args.reason ? { reason: args.reason } : {}),
      }),
    onSuccess: (saved) => {
      setVote(saved);
      onChange?.(saved);
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (voteId: string) => feedbackApi.dismissVote(voteId),
    onSuccess: () => {
      setVote(null);
      setReasonOpen(false);
      setReason("");
      onChange?.(null);
    },
  });

  const isUp = vote?.vote === "up";
  const isDown = vote?.vote === "down";
  const busy = recordMutation.isPending || dismissMutation.isPending;

  async function handleClick(value: "up" | "down") {
    // Toggle off when clicking the currently-selected thumb.
    if (vote && vote.vote === value) {
      dismissMutation.mutate(vote.id);
      return;
    }
    if (value === "down") {
      // Show reason input immediately; send first vote without reason so the
      // capture is not blocked on the optional explanation.
      setReasonOpen(true);
      setReason(vote?.reason ?? "");
    } else {
      setReasonOpen(false);
      setReason("");
    }
    recordMutation.mutate({ value });
  }

  function handleReasonSubmit() {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setReasonOpen(false);
      return;
    }
    recordMutation.mutate({ value: "down", reason: trimmed });
    setReasonOpen(false);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Was this helpful?</span>
        <Button
          type="button"
          size="icon-xs"
          variant={isUp ? "default" : "ghost"}
          aria-label="Thumbs up"
          aria-pressed={isUp}
          disabled={busy}
          onClick={() => handleClick("up")}
          className={cn(isUp && "ring-1 ring-primary/30")}
        >
          <ThumbsUp />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant={isDown ? "default" : "ghost"}
          aria-label="Thumbs down"
          aria-pressed={isDown}
          disabled={busy}
          onClick={() => handleClick("down")}
          className={cn(isDown && "ring-1 ring-primary/30")}
        >
          <ThumbsDown />
        </Button>
        {vote?.reason && !reasonOpen ? (
          <button
            type="button"
            className="ml-1 underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => {
              setReason(vote.reason ?? "");
              setReasonOpen(true);
            }}
          >
            Edit reason
          </button>
        ) : null}
      </div>

      {reasonOpen ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2">
          <label
            htmlFor={`feedback-reason-${targetId}`}
            className="text-xs text-muted-foreground"
          >
            Why is this not helpful? (optional)
          </label>
          <Textarea
            id={`feedback-reason-${targetId}`}
            aria-label="Why is this not helpful?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What was missing or wrong?"
            className="min-h-16 text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setReasonOpen(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="xs"
              variant="default"
              disabled={busy}
              onClick={handleReasonSubmit}
              aria-label="Save feedback"
            >
              Save feedback
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
