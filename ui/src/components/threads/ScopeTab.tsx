/**
 * ScopeTab — decision board with grouped type accordions.
 * Structure: Plan → Needs Decision (pending items by type) → Approved (by type).
 * All groups collapsed by default.
 */
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Check, X, Pencil, RefreshCw, Link2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { discussionsApi } from "../../api/discussions";
import { threadsApi } from "../../api/threads";
import { useToast } from "../../context/ToastContext";
import type { ScopeItem } from "./scopeGrouping";
import type { ApproveItems } from "@armyofagents/shared";

/* ─── Type → display config ─── */

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  task:            { label: "Tasks",        color: "#4FB67E" },
  decision:        { label: "Decisions",    color: "#6470DC" },
  preference:      { label: "Preferences",  color: "#D9A938" },
  insight:         { label: "Insights",     color: "#3FA8C7" },
  reference:       { label: "References",   color: "#7E8AA8" },
  context:         { label: "Context",      color: "rgba(126,138,168,0.6)" },
  artifact:        { label: "Artifacts",    color: "#5AA87E" },
  spin_off_thread: { label: "Branches",     color: "#6470DC" },
};

function typeColor(type: string): string {
  return TYPE_CONFIG[type]?.color ?? "#7E8AA8";
}

function typeLabel(type: string): string {
  return TYPE_CONFIG[type]?.label ?? type;
}

/* ─── Priority label ─── */

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#e87070",
  high:   "#D9A938",
  medium: "#3FA8C7",
  low:    "#7E8AA8",
};

/* ════════════════════════════════════════════════════════════════════════
   ScopeTab
   ════════════════════════════════════════════════════════════════════════ */

export interface Department {
  id: string;
  name: string;
}

export interface ScopeTabProps {
  summaryText: string | null;
  summaryNext: string | null;
  items: ScopeItem[];
  planSteps: string[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onItemClick: (item: ScopeItem) => void;
  companyId?: string;
  discussionId?: string;
  isFounder?: boolean;
  departments?: Department[];
  showAllTypes?: boolean;
  recommendation?: { departmentId: string; departmentName: string; itemCount: number } | null;
}

export function ScopeTab({
  summaryText,
  summaryNext,
  items,
  planSteps,
  isLoading,
  isError,
  onRetry,
  onItemClick,
  companyId,
  discussionId,
}: ScopeTabProps) {
  if (isLoading) {
    return (
      <div className="space-y-4 py-4" data-testid="scope-tab-skeleton">
        <div className="h-4 rounded bg-muted animate-pulse w-3/4" />
        <div className="h-4 rounded bg-muted animate-pulse w-1/2" />
        <div className="h-24 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-8" data-testid="scope-tab-error">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load scope.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  const pendingItems = items.filter((i) => i.status === "pending" || i.status === "edited");
  const approvedItems = items.filter((i) => i.status === "approved");

  return (
    <div className="space-y-5 py-2" data-testid="scope-tab">
      {/* Plan */}
      {planSteps.length > 0 && (
        <PlanBlock steps={planSteps} />
      )}

      {/* Needs Decision */}
      <NeedsDecisionSection
        items={pendingItems}
        companyId={companyId}
        discussionId={discussionId}
        onItemClick={onItemClick}
      />

      {/* Approved */}
      {approvedItems.length > 0 && (
        <ApprovedSection items={approvedItems} onItemClick={onItemClick} />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   PlanBlock
   ════════════════════════════════════════════════════════════════════════ */

function PlanBlock({ steps }: { steps: string[] }) {
  return (
    <section data-testid="scope-plan">
      <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 px-0.5">
        Plan
      </h3>
      <div
        className="rounded-lg border border-border/60 overflow-hidden"
        style={{ background: "var(--card-2, #1d2128)" }}
      >
        <ol className="divide-y divide-border/60">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3 px-3.5 py-2.5">
              <span
                className="shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={{ background: "hsl(221 22% 30%)", color: "#8899cc" }}
              >
                {i + 1}
              </span>
              <span className="text-sm text-foreground/90 leading-snug pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   NeedsDecisionSection
   ════════════════════════════════════════════════════════════════════════ */

function NeedsDecisionSection({
  items,
  companyId,
  discussionId,
  onItemClick,
}: {
  items: ScopeItem[];
  companyId?: string;
  discussionId?: string;
  onItemClick: (item: ScopeItem) => void;
}) {
  // Group by type
  const byType = new Map<string, ScopeItem[]>();
  for (const item of items) {
    const list = byType.get(item.type) ?? [];
    list.push(item);
    byType.set(item.type, list);
  }

  const typeKeys = [...byType.keys()];

  // All groups collapsed by default
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const toggle = useCallback((type: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  return (
    <section data-testid="scope-needs-decision">
      <div className="flex items-center gap-2 mb-2.5 px-0.5">
        <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Needs Decision
        </h3>
        {items.length > 0 && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
            style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}
          >
            {items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic px-0.5">
          Nothing to decide yet — Scribe surfaces items as the discussion grows.
        </p>
      ) : (
        <div className="space-y-2">
          {typeKeys.map((type) => {
            const typeItems = byType.get(type) ?? [];
            const isOpen = openGroups.has(type);
            const color = typeColor(type);
            return (
              <TypeAccordion
                key={type}
                type={type}
                color={color}
                items={typeItems}
                isOpen={isOpen}
                onToggle={() => toggle(type)}
                companyId={companyId}
                discussionId={discussionId}
                onItemClick={onItemClick}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   TypeAccordion
   ──────────────────────────────────────────────────────────────────────── */

function TypeAccordion({
  type,
  color,
  items,
  isOpen,
  onToggle,
  companyId,
  discussionId,
  onItemClick,
}: {
  type: string;
  color: string;
  items: ScopeItem[];
  isOpen: boolean;
  onToggle: () => void;
  companyId?: string;
  discussionId?: string;
  onItemClick: (item: ScopeItem) => void;
}) {
  return (
    <div
      className="rounded-lg border border-border/60 overflow-hidden"
      data-testid={`s-type-group-${type}`}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-left hover:bg-muted/20 transition-colors"
        style={{ background: "var(--card-2, #1d2128)" }}
        aria-expanded={isOpen}
      >
        <span
          className="shrink-0 w-2 h-2 rounded-full"
          style={{ background: color }}
          aria-hidden="true"
        />
        <span className="flex-1 text-sm font-medium text-foreground">
          {typeLabel(type)}
        </span>
        <span
          className="text-[11px] font-semibold tabular-nums rounded-full px-2 py-0.5"
          style={{ background: "hsl(0 0% 18%)", color: "hsl(0 0% 60%)" }}
        >
          {items.length}
        </span>
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Items */}
      {isOpen && (
        <div
          className="border-t border-border/60 divide-y divide-border/40"
          style={{ background: "var(--card, #161a20)" }}
        >
          {items.map((item) => (
            <ScopeItemCard
              key={item.id}
              item={item}
              companyId={companyId}
              discussionId={discussionId}
              onItemClick={onItemClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   ScopeItemCard
   ──────────────────────────────────────────────────────────────────────── */

function ScopeItemCard({
  item,
  companyId,
  discussionId,
  onItemClick,
}: {
  item: ScopeItem;
  companyId?: string;
  discussionId?: string;
  onItemClick: (item: ScopeItem) => void;
}) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const hasConflict = !!item.conflictsWith;
  const depCount = (item.dependsOn ?? []).length;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["threads", companyId] });

  const approveMutation = useMutation({
    mutationFn: () => {
      if (!companyId || !discussionId) throw new Error("Missing context");
      return discussionsApi.approveItems(companyId, discussionId, {
        items: [{ itemId: item.id, action: "approved" }],
      } as ApproveItems);
    },
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Item approved", tone: "success" });
    },
    onError: () => pushToast({ title: "Failed to approve", tone: "warn" }),
  });

  const rejectMutation = useMutation({
    mutationFn: () => {
      if (!companyId || !discussionId) throw new Error("Missing context");
      return discussionsApi.rejectItems(companyId, discussionId, [item.id]);
    },
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Item rejected", tone: "success" });
    },
    onError: () => pushToast({ title: "Failed to reject", tone: "warn" }),
  });

  const spinOffMutation = useMutation({
    mutationFn: () => {
      if (!companyId || !discussionId) throw new Error("Missing context");
      return threadsApi.spinOff(companyId, discussionId, item.id, item.title);
    },
    onSuccess: () => {
      invalidate();
      pushToast({ title: "Branch thread created", tone: "success" });
    },
    onError: () => pushToast({ title: "Failed to spin off", tone: "warn" }),
  });

  const isBusy = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div
      className={cn(
        "px-3.5 py-3 group",
        hasConflict && "border-l-2 border-amber-500/70",
      )}
      style={hasConflict ? { background: "hsl(38 20% 10%)" } : undefined}
      data-testid={`scope-item-${item.id}`}
    >
      {/* Row 1: short ID + title + actions */}
      <div className="flex items-start gap-2">
        <span
          className="shrink-0 text-[10px] font-mono text-muted-foreground/50 mt-0.5 pt-[1px]"
        >
          #{item.id.slice(0, 4)}
        </span>
        <button
          type="button"
          onClick={() => onItemClick(item)}
          className="flex-1 text-left min-w-0"
        >
          <span className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2 hover:text-foreground/80 transition-colors">
            {item.title}
          </span>
        </button>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          <button
            type="button"
            onClick={() => approveMutation.mutate()}
            disabled={isBusy || !companyId || !discussionId}
            title="Approve"
            className="w-6 h-6 rounded flex items-center justify-center transition-colors text-muted-foreground hover:text-emerald-400 hover:bg-emerald-400/10 disabled:opacity-40"
            aria-label="Approve"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => rejectMutation.mutate()}
            disabled={isBusy || !companyId || !discussionId}
            title="Reject"
            className="w-6 h-6 rounded flex items-center justify-center transition-colors text-muted-foreground disabled:opacity-40"
            style={{ ["--hover-color" as string]: "hsl(10 70% 62%)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "hsl(10 70% 62%)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "")}
            aria-label="Reject"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onItemClick(item)}
            title="Edit"
            className="w-6 h-6 rounded flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/30"
            aria-label="Edit"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Row 2: description */}
      {item.description && (
        <p className="text-xs text-muted-foreground leading-relaxed mt-1.5 ml-7 line-clamp-2">
          {item.description}
        </p>
      )}

      {/* Row 3: meta pills */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2 ml-7">
        {item.suggestedPriority && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize"
            style={{
              color: PRIORITY_COLORS[item.suggestedPriority] ?? "#7E8AA8",
              background: `${PRIORITY_COLORS[item.suggestedPriority] ?? "#7E8AA8"}20`,
            }}
          >
            {item.suggestedPriority}
          </span>
        )}
        {item.suggestedLayer && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-muted-foreground bg-muted/40 capitalize">
            {item.suggestedLayer}
          </span>
        )}
        {hasConflict && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ color: "#D9A938", background: "rgba(217,169,56,0.15)" }}
          >
            ⚠ Conflict
          </span>
        )}
        {depCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-muted-foreground"
            style={{ background: "hsl(0 0% 18%)" }}
            data-testid={`dep-badge-${item.id}`}
          >
            <Link2 className="h-2.5 w-2.5" />
            blocked by {depCount}
          </span>
        )}
        {item.type === "spin_off_thread" && (
          <button
            type="button"
            onClick={() => spinOffMutation.mutate()}
            disabled={spinOffMutation.isPending || !companyId || !discussionId}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            style={{ background: "hsl(0 0% 18%)" }}
            data-testid={`spin-off-${item.id}`}
          >
            <GitBranch className="h-2.5 w-2.5" />
            Spin off →
          </button>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   ApprovedSection
   ════════════════════════════════════════════════════════════════════════ */

function ApprovedSection({
  items,
  onItemClick,
}: {
  items: ScopeItem[];
  onItemClick: (item: ScopeItem) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  // Sub-group by type
  const byType = new Map<string, ScopeItem[]>();
  for (const item of items) {
    const list = byType.get(item.type) ?? [];
    list.push(item);
    byType.set(item.type, list);
  }

  return (
    <section data-testid="scope-approved">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-2 w-full px-0.5 mb-2"
        aria-expanded={isOpen}
      >
        <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Approved
        </h3>
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
          style={{ background: "rgba(79,182,126,0.12)", color: "#4FB67E" }}
        >
          {items.length}
        </span>
        {isOpen ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground/60 ml-auto" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground/60 ml-auto" />
        )}
      </button>

      {isOpen && (
        <div className="space-y-2">
          {[...byType.entries()].map(([type, typeItems]) => (
            <div
              key={type}
              className="rounded-lg border border-border/40 overflow-hidden"
              style={{ background: "var(--card-2, #1d2128)" }}
            >
              <div className="flex items-center gap-2 px-3.5 py-2 border-b border-border/40">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: typeColor(type) }}
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {typeLabel(type)}
                </span>
                <span className="text-[11px] text-muted-foreground/50 ml-auto tabular-nums">
                  {typeItems.length}
                </span>
              </div>
              <div className="divide-y divide-border/30">
                {typeItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onItemClick(item)}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="shrink-0 text-[10px] font-mono text-muted-foreground/40 mt-0.5"
                      >
                        #{item.id.slice(0, 4)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] text-foreground/80 line-clamp-1">
                          {item.title}
                        </span>
                        {(item.resultTaskId || item.resultMemoryId) && (
                          <span className="block text-[11px] text-muted-foreground/50 mt-0.5">
                            {item.resultTaskId && `→ Task #${item.resultTaskId.slice(0, 8)}`}
                            {item.resultMemoryId && "→ Memory"}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
