import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { THREAD_PHASES, type ThreadPhase } from "@armyofagents/shared";
import { threadsApi, type ThreadDetail } from "../../api/threads";
import { useToast } from "../../context/ToastContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lock, Unlock, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { MentionInput } from "./MentionInput";

/* ─── Constants ─── */

const PHASE_LABELS: Record<ThreadPhase, string> = {
  discuss: "Discuss",
  scope: "Scope",
  assign: "Assign",
  done: "Done",
};

const PHASE_COLORS: Record<ThreadPhase, string> = {
  discuss: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  scope: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  assign: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  done: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const PHASE_ACTIVE_COLORS: Record<ThreadPhase, string> = {
  discuss: "bg-blue-600 text-white",
  scope: "bg-amber-600 text-white",
  assign: "bg-violet-600 text-white",
  done: "bg-green-600 text-white",
};

const AUTONOMY_LABELS: Record<number, string> = {
  0: "L0",
  1: "L1",
  2: "L2",
};

/* ════════════════════════════════════════════════════════════════════════
   OriginCard
   Displays thread metadata: title, phase pills, intent chips,
   participant avatars, autonomy level, owner/visibility.
   ════════════════════════════════════════════════════════════════════════ */

interface OriginCardProps {
  thread: ThreadDetail;
  companyId: string;
  onPhaseChanged: () => void;
}

export function OriginCard({ thread, companyId, onPhaseChanged }: OriginCardProps) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  // The phase the user intends to advance to (pending confirm dialog)
  const [pendingPhase, setPendingPhase] = useState<ThreadPhase | null>(null);
  const [mentionChips, setMentionChips] = useState<string[]>([]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["threads", companyId, thread.id] });

  const advancePhaseMutation = useMutation({
    mutationFn: (phase: string) =>
      threadsApi.advancePhase(companyId, thread.id, phase),
    onSuccess: () => {
      invalidate();
      onPhaseChanged();
      pushToast({ title: "Phase advanced", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to advance phase", tone: "warn" });
    },
  });

  const claimMutation = useMutation({
    mutationFn: () => threadsApi.claim(companyId, thread.id),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Thread claimed", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to claim thread", tone: "warn" });
    },
  });

  const visibilityMutation = useMutation({
    mutationFn: (visibility: "open" | "private") =>
      threadsApi.setVisibility(companyId, thread.id, visibility),
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Visibility updated", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to update visibility", tone: "warn" });
    },
  });

  function handlePhaseClick(phase: ThreadPhase) {
    if (phase === thread.phase) return; // no-op on active phase
    setPendingPhase(phase);
  }

  function handleConfirmPhaseAdvance() {
    if (!pendingPhase) return;
    advancePhaseMutation.mutate(pendingPhase);
    setPendingPhase(null);
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-4 space-y-4" data-testid="origin-card">
        {/* Title */}
        <h2 className="text-base font-semibold text-foreground leading-tight">
          {thread.title}
        </h2>

        {/* Meta row: visibility + autonomy + owner */}
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
          {/* Visibility badge */}
          <Badge variant="outline" className="text-[10px] capitalize">
            {thread.visibility}
          </Badge>

          {/* Visibility toggle button */}
          <button
            type="button"
            data-testid="visibility-toggle"
            onClick={() =>
              visibilityMutation.mutate(thread.visibility === "open" ? "private" : "open")
            }
            disabled={visibilityMutation.isPending}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] border border-border hover:bg-muted/30 transition-colors"
            aria-label={thread.visibility === "open" ? "Make private" : "Make open"}
          >
            {thread.visibility === "open" ? (
              <><Lock className="h-2.5 w-2.5" /> Make private</>
            ) : (
              <><Unlock className="h-2.5 w-2.5" /> Make open</>
            )}
          </button>

          {/* Autonomy level */}
          {thread.autonomyLevel != null && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[var(--token-skill,theme(colors.violet.100))] text-violet-800 dark:text-violet-300"
              aria-label={`Autonomy level ${thread.autonomyLevel}`}
            >
              {AUTONOMY_LABELS[thread.autonomyLevel] ?? `L${thread.autonomyLevel}`}
            </span>
          )}

          {/* Owner / Claim */}
          {thread.ownerUserId ? (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              Owner: {thread.ownerUserId}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground italic">Unclaimed</span>
              <Button
                size="sm"
                variant="outline"
                className="h-5 px-2 text-[10px]"
                onClick={() => claimMutation.mutate()}
                disabled={claimMutation.isPending}
              >
                Claim
              </Button>
            </span>
          )}
        </div>

        {/* @mention input */}
        <MentionInput
          chips={mentionChips}
          onChipsChange={setMentionChips}
          placeholder="@mention someone..."
        />

        {/* Origin source chip */}
        {thread.originSource && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground uppercase font-medium tracking-wide">
              Source:
            </span>
            <Badge variant="secondary" className="text-[10px] capitalize">
              {thread.originSource}
            </Badge>
          </div>
        )}

        {/* Intent chips */}
        {thread.intent && thread.intent.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Thread intent">
            {thread.intent.map((item, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground"
              >
                {item}
              </span>
            ))}
          </div>
        )}

        {/* Phase pill bar */}
        <div
          className="flex items-center gap-1.5 flex-wrap"
          role="group"
          aria-label="Thread phases"
          data-testid="phase-pills"
        >
          {THREAD_PHASES.map((phase) => {
            const isActive = thread.phase === phase;
            return (
              <button
                key={phase}
                type="button"
                aria-current={isActive ? "true" : undefined}
                aria-label={PHASE_LABELS[phase]}
                onClick={() => handlePhaseClick(phase)}
                disabled={advancePhaseMutation.isPending}
                className={cn(
                  "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold capitalize transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-primary",
                  isActive
                    ? PHASE_ACTIVE_COLORS[phase]
                    : cn(
                        PHASE_COLORS[phase],
                        "opacity-60 hover:opacity-100 cursor-pointer",
                      ),
                )}
                data-testid={`phase-pill-${phase}`}
              >
                {PHASE_LABELS[phase]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Confirm dialog for phase advance */}
      <AlertDialog
        open={pendingPhase !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPhase(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Advance phase?</AlertDialogTitle>
            <AlertDialogDescription>
              Move this thread to the{" "}
              <strong>{pendingPhase ? PHASE_LABELS[pendingPhase] : ""}</strong> phase?
              This will update the thread for all participants.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmPhaseAdvance}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Advance
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
