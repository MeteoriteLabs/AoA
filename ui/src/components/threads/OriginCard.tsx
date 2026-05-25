import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { THREAD_PHASES, type Agent, type ThreadPhase } from "@armyofagents/shared";
import { threadsApi, type ThreadDetail } from "../../api/threads";
import { agentsApi } from "../../api/agents";
import { queryKeys } from "../../lib/queryKeys";
import { useLiveUpdates } from "../../context/LiveUpdatesProvider";
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
import { getInitials } from "@/lib/initials";
import type { ThreadPresenceMember } from "../../context/LiveUpdatesProvider";
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

  // ── Plan 7: live presence/typing + agent "working" indicator ──
  const { presenceByThread } = useLiveUpdates();
  const presence = presenceByThread[thread.id] ?? [];
  const typingMembers = presence.filter((m) => m.typing);
  // Reuse the agents query (kept fresh by agent.status / heartbeat.run.* live
  // events) to surface agents currently working — visually distinct from humans.
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });
  const workingAgents = (agents ?? []).filter((a: Agent) => a.status === "running");

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

        {/* Plan 7: live presence + typing + agent working indicator */}
        <PresenceStrip
          presence={presence}
          typingMembers={typingMembers}
          workingAgents={workingAgents}
        />

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

/* ════════════════════════════════════════════════════════════════════════
   PresenceStrip (Plan 7)
   Live human presence (stacked avatars, max 3 + "+N"), an agent "working"
   indicator that is VISUALLY DISTINCT from human presence (so founders can
   tell "Scribe is extracting" from "Maria is here"), and a subtle typing line.
   A11y (D3): updates announce via aria-live="polite" — never assertive, so
   screen readers aren't spammed on every keystroke.
   ════════════════════════════════════════════════════════════════════════ */

const MAX_VISIBLE_AVATARS = 3;

function PresenceStrip({
  presence,
  typingMembers,
  workingAgents,
}: {
  presence: ThreadPresenceMember[];
  typingMembers: ThreadPresenceMember[];
  workingAgents: Array<{ id: string; name: string }>;
}) {
  const hasAnything = presence.length > 0 || workingAgents.length > 0;
  if (!hasAnything) {
    // Keep a polite live region mounted so "everyone left" is announced once.
    return <div aria-live="polite" className="sr-only" data-testid="presence-live" />;
  }

  const visible = presence.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = presence.length - visible.length;

  const typingLabel =
    typingMembers.length === 0
      ? null
      : typingMembers.length === 1
        ? "Someone is typing…"
        : `${typingMembers.length} people are typing…`;

  const announce = [
    presence.length > 0
      ? `${presence.length} ${presence.length === 1 ? "person" : "people"} here`
      : null,
    workingAgents.length > 0
      ? `${workingAgents.length} ${workingAgents.length === 1 ? "agent" : "agents"} working`
      : null,
    typingLabel,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <div className="flex flex-col gap-1" data-testid="presence-strip">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Human presence avatars */}
        {visible.length > 0 && (
          <div className="flex items-center -space-x-1.5" aria-hidden="true">
            {visible.map((m) => (
              <span
                key={m.userId}
                title={m.userId}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted text-[9px] font-semibold text-muted-foreground"
              >
                {getInitials(m.userId) || "?"}
              </span>
            ))}
            {overflow > 0 && (
              <span
                title={`${overflow} more`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted/70 text-[9px] font-semibold text-muted-foreground"
              >
                +{overflow}
              </span>
            )}
          </div>
        )}

        {/* Agent "working" indicator — distinct from human presence */}
        {workingAgents.length > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-[var(--token-skill,theme(colors.violet.100))] px-2 py-0.5 text-[10px] font-medium text-violet-800 dark:text-violet-300"
            data-testid="agent-working-indicator"
            title={workingAgents.map((a) => a.name).join(", ")}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-pulse" aria-hidden="true" />
            {workingAgents.length === 1
              ? `${workingAgents[0].name} working`
              : `${workingAgents.length} agents working`}
          </span>
        )}
      </div>

      {/* Typing line — subtle */}
      {typingLabel && (
        <span className="text-[11px] italic text-muted-foreground" data-testid="typing-indicator">
          {typingLabel}
        </span>
      )}

      {/* Polite a11y announcement (never assertive). */}
      <div aria-live="polite" className="sr-only" data-testid="presence-live">
        {announce}
      </div>
    </div>
  );
}
