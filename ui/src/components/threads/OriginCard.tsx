import { Fragment, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Lock,
  Unlock,
  Lightbulb,
  Plug,
  Mic,
  ClipboardPen,
  PenLine,
  MessageSquare,
  Share2,
  MoreHorizontal,
  Flag,
  Calendar,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ThreadPresenceMember } from "../../context/LiveUpdatesProvider";
import { MentionInput } from "./MentionInput";

/* ─── Constants ─── */

const PHASE_LABELS: Record<ThreadPhase, string> = {
  discuss: "Discuss",
  scope: "Scope",
  assign: "Assign",
  done: "Done",
};

const AUTONOMY_LABELS: Record<number, string> = {
  0: "L0",
  1: "L1",
  2: "L2",
};

/* ─── Origin type → eyebrow label + icon ─── */

const ORIGIN_META: Record<string, { label: string; Icon: LucideIcon }> = {
  mcp: { label: "MCP", Icon: Plug },
  voice: { label: "Voice", Icon: Mic },
  paste: { label: "Paste", Icon: ClipboardPen },
  write: { label: "Write", Icon: PenLine },
  idea: { label: "Idea", Icon: Lightbulb },
};

function originMeta(originSource: string | null): { label: string; Icon: LucideIcon } {
  if (!originSource) return { label: "Discussion", Icon: MessageSquare };
  return ORIGIN_META[originSource.toLowerCase()] ?? { label: originSource, Icon: MessageSquare };
}

/* ─── Friendly owner name from a raw user id / slug ───
   Owner ids are text slugs (e.g. the local_trusted "local-board" actor) or
   UUIDs. Render a human label instead of leaking the raw slug. */

function friendlyUser(id: string): { name: string; initials: string } {
  if (id === "local-board") return { name: "Local Board", initials: "LB" };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return { name: "Member", initials: "M" };
  const name = id
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return { name: name || id, initials: initials || "?" };
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/* ════════════════════════════════════════════════════════════════════════
   OriginCard
   Displays thread metadata: origin type + icon, title, Share/⋯ actions,
   intent/goal/scope chips, owner/visibility, participants, and a connected
   phase stepper with the autonomy pill.
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

  // Phase 1 (Task A2): the canonical visibility tiers are private | department | company.
  // The OriginCard still surfaces a binary private ↔ open toggle for now; we map
  // "open" → "company" (everyone with scope can see it). The dept-scoped UI lives
  // in a later task.
  const visibilityMutation = useMutation({
    mutationFn: (visibility: "private" | "company") =>
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

  function handleShare() {
    try {
      void navigator.clipboard?.writeText(window.location.href);
      pushToast({ title: "Link copied", tone: "success" });
    } catch {
      pushToast({ title: "Couldn't copy link", tone: "warn" });
    }
  }

  function toggleVisibility() {
    // Binary toggle between private and company (open-equivalent). Threads
    // already on "department" flip to "private" on first toggle.
    visibilityMutation.mutate(thread.visibility === "private" ? "company" : "private");
  }

  const { label: originLabel, Icon: OriginIcon } = originMeta(thread.originSource);
  const owner = thread.ownerUserId ? friendlyUser(thread.ownerUserId) : null;
  const currentIndex = THREAD_PHASES.indexOf(thread.phase);

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="origin-card">
        {/* Row 1: origin icon + eyebrow/title + Share/⋯ */}
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{
              backgroundColor: "color-mix(in srgb, var(--entity-brief) 14%, transparent)",
              color: "var(--entity-brief)",
            }}
            aria-hidden
          >
            <OriginIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Thread · {originLabel}
            </p>
            <h2 className="text-base font-semibold leading-tight text-foreground">
              {thread.title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={handleShare}
            >
              <Share2 className="h-3 w-3" />
              Share
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-7 w-7" aria-label="More actions">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleShare}>Copy link</DropdownMenuItem>
                <DropdownMenuItem onClick={toggleVisibility}>
                  {thread.visibility === "private" ? "Make open" : "Make private"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Chips row: status · intent · goal · scope · date · visibility */}
        <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium capitalize">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                thread.status === "active" ? "bg-green-500" : "bg-muted-foreground",
              )}
              aria-hidden
            />
            {thread.status}
          </span>

          {thread.intent?.map((item, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium"
            >
              {item}
            </span>
          ))}

          {thread.goalId && (
            <span className="inline-flex items-center gap-1 rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
              <Flag className="h-2.5 w-2.5" />
              Goal linked
            </span>
          )}

          {thread.scopeName && (
            <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium">
              {thread.scopeName}
            </span>
          )}

          <span className="inline-flex items-center gap-1 text-[10px]">
            <Calendar className="h-2.5 w-2.5" />
            {formatDate(thread.createdAt)}
          </span>

          {/* Visibility badge */}
          <Badge variant="outline" className="text-[10px] capitalize">
            {thread.visibility}
          </Badge>

          {/* Visibility toggle (binary: private ↔ company) */}
          <button
            type="button"
            data-testid="visibility-toggle"
            onClick={toggleVisibility}
            disabled={visibilityMutation.isPending}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] border border-border hover:bg-muted/30 transition-colors"
            aria-label={thread.visibility === "private" ? "Make open" : "Make private"}
          >
            {thread.visibility === "private" ? (
              <><Unlock className="h-2.5 w-2.5" /> Make open</>
            ) : (
              <><Lock className="h-2.5 w-2.5" /> Make private</>
            )}
          </button>
        </div>

        {/* Owner / claim + live presence */}
        <div className="flex items-center gap-3 flex-wrap">
          {owner ? (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
                {owner.initials}
              </span>
              <span className="font-medium text-foreground">{owner.name}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs">
              <span className="italic text-muted-foreground">Unclaimed</span>
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

          <PresenceStrip
            presence={presence}
            typingMembers={typingMembers}
            workingAgents={workingAgents}
          />
        </div>

        {/* @mention input */}
        <MentionInput
          chips={mentionChips}
          onChipsChange={setMentionChips}
          placeholder="@mention someone..."
        />

        {/* Phase stepper (connected nodes + lines) + autonomy pill */}
        <div
          className="flex items-center gap-0"
          role="group"
          aria-label="Thread phases"
          data-testid="phase-pills"
        >
          {THREAD_PHASES.map((phase, i) => {
            const isActive = i === currentIndex;
            const isDone = i < currentIndex;
            return (
              <Fragment key={phase}>
                <button
                  type="button"
                  aria-current={isActive ? "true" : undefined}
                  aria-label={PHASE_LABELS[phase]}
                  onClick={() => handlePhaseClick(phase)}
                  disabled={advancePhaseMutation.isPending}
                  data-testid={`phase-pill-${phase}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-primary",
                    isActive
                      ? "font-semibold text-foreground"
                      : isDone
                        ? "font-medium text-green-600 dark:text-green-400"
                        : "font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full border shrink-0",
                      isActive
                        ? "border-brand bg-brand"
                        : isDone
                          ? "border-green-500 bg-green-500"
                          : "border-muted-foreground/40",
                    )}
                    aria-hidden
                  />
                  {PHASE_LABELS[phase]}
                </button>
                {i < THREAD_PHASES.length - 1 && (
                  <span
                    className={cn(
                      "h-px w-5 flex-none mx-0.5",
                      isDone ? "bg-green-500/40" : "bg-border",
                    )}
                    aria-hidden
                  />
                )}
              </Fragment>
            );
          })}

          <div className="flex-1" />

          {/* Autonomy pill */}
          {thread.autonomyLevel != null && (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
              aria-label={`Autonomy level ${thread.autonomyLevel}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden />
              {AUTONOMY_LABELS[thread.autonomyLevel] ?? `L${thread.autonomyLevel}`}
            </span>
          )}
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
              // No display-name source is available in this component (presence
              // carries only userId). getInitials on a raw UUID produces garbage
              // fragments ("C3"), so render a neutral placeholder instead and
              // avoid leaking the UUID via the tooltip.
              <span
                key={m.userId}
                title="Member here"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted text-[9px] font-semibold text-muted-foreground"
              >
                ?
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
