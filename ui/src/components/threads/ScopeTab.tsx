/**
 * ScopeTab — renders Summary, Plan, and grouped scope items.
 * Uses groupScopeItems() to sort items into four buckets.
 * Used inside ThreadDetail's center panel (Scope tab).
 *
 * Task 7 additions:
 * - Per-item routing (department selector + assignee) — founder only
 * - Dependency badges ("blocks N")
 * - Amber conflict card styling for conflicted items in Needs Input
 * - "Spin off →" button per item
 */
import { groupScopeItems, groupByType, ALL_SCOPE_TYPES, type ScopeItem } from "./scopeGrouping";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, GitBranch, Link2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { threadsApi } from "../../api/threads";
import { useToast } from "../../context/ToastContext";
import { cn } from "@/lib/utils";

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
  /** These are optional for backward compatibility */
  companyId?: string;
  discussionId?: string;
  /** When true, per-item routing controls are shown */
  isFounder?: boolean;
  /** Available departments for routing dropdown */
  departments?: Department[];
  /** When true, renders an "All Items by Type" section at the bottom */
  showAllTypes?: boolean;
  /** Router recommendation banner data */
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
  isFounder = false,
  departments = [],
  showAllTypes = false,
  recommendation = null,
}: ScopeTabProps) {
  // ── Loading skeleton ──
  if (isLoading) {
    return (
      <div
        className="space-y-4 py-4"
        data-testid="scope-tab-skeleton"
        aria-label="Loading scope..."
      >
        <div className="h-4 rounded bg-muted animate-pulse w-3/4" />
        <div className="h-4 rounded bg-muted animate-pulse w-1/2" />
        <div className="h-24 rounded-lg bg-muted animate-pulse" />
      </div>
    );
  }

  // ── Error state ──
  if (isError) {
    return (
      <div
        className="flex flex-col items-center gap-3 py-8"
        data-testid="scope-tab-error"
      >
        <p className="text-sm text-muted-foreground">Couldn&apos;t load scope.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  const grouped = groupScopeItems(items);
  const hasAnyItems =
    grouped.needsInput.length > 0 ||
    grouped.confirmed.length > 0 ||
    grouped.references.length > 0 ||
    grouped.artifacts.length > 0;

  return (
    <div className="space-y-6 py-2" data-testid="scope-tab">
      {/* ── Summary ── */}
      <section data-testid="scope-summary">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Summary
        </h3>
        {summaryText ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground leading-relaxed">{summaryText}</p>
            {summaryNext && (
              <p className="text-xs text-muted-foreground italic">
                Next: {summaryNext}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Scribe will summarize once there&apos;s enough to go on.
          </p>
        )}
      </section>

      {/* ── Router Recommendation ── */}
      {recommendation && (
        <div
          data-testid="scope-router-recommendation"
          className="rounded-lg border border-teal-300 bg-teal-50 dark:bg-teal-900/10 px-3 py-2 text-xs text-teal-900 dark:text-teal-200"
        >
          Router suggests routing to <span className="font-semibold">{recommendation.departmentName}</span>{" "}
          ({recommendation.itemCount} task{recommendation.itemCount !== 1 ? "s" : ""}). You decide.
        </div>
      )}

      {/* ── Plan ── */}
      <section data-testid="scope-plan">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Plan
        </h3>
        {planSteps.length > 0 ? (
          <ol className="space-y-1.5 list-decimal list-inside">
            {planSteps.map((step, i) => (
              <li key={i} className="text-sm text-muted-foreground">
                {step}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No plan yet — advance to Scope to build one.
          </p>
        )}
      </section>

      {/* ── Items ── */}
      {!showAllTypes && (
        <section data-testid="scope-items">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Items
          </h3>

          {!hasAnyItems ? (
            <p className="text-sm text-muted-foreground italic">
              Nothing to scope yet. Scribe surfaces items as the discussion grows.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Needs Input group */}
              {grouped.needsInput.length > 0 && (
                <ItemGroup label="Needs Input" count={grouped.needsInput.length}>
                  {grouped.needsInput.map(({ item, hasConflict }) => (
                    <ScopeItemRow
                      key={item.id}
                      item={item}
                      hasConflict={hasConflict}
                      onClick={() => onItemClick(item)}
                      companyId={companyId}
                      discussionId={discussionId}
                      isFounder={isFounder}
                      departments={departments}
                    />
                  ))}
                </ItemGroup>
              )}

              {/* Confirmed group */}
              {grouped.confirmed.length > 0 && (
                <ItemGroup label="Confirmed" count={grouped.confirmed.length}>
                  {grouped.confirmed.map((item) => (
                    <ScopeItemRow
                      key={item.id}
                      item={item}
                      hasConflict={false}
                      onClick={() => onItemClick(item)}
                      companyId={companyId}
                      discussionId={discussionId}
                      isFounder={isFounder}
                      departments={departments}
                    />
                  ))}
                </ItemGroup>
              )}

              {/* References group */}
              {grouped.references.length > 0 && (
                <ItemGroup label="References" count={grouped.references.length}>
                  {grouped.references.map((item) => (
                    <ScopeItemRow
                      key={item.id}
                      item={item}
                      hasConflict={false}
                      onClick={() => onItemClick(item)}
                      companyId={companyId}
                      discussionId={discussionId}
                      isFounder={isFounder}
                      departments={departments}
                    />
                  ))}
                </ItemGroup>
              )}

              {/* Artifacts group */}
              {grouped.artifacts.length > 0 && (
                <ItemGroup label="Artifacts" count={grouped.artifacts.length}>
                  {grouped.artifacts.map((item) => (
                    <ScopeItemRow
                      key={item.id}
                      item={item}
                      hasConflict={false}
                      onClick={() => onItemClick(item)}
                      companyId={companyId}
                      discussionId={discussionId}
                      isFounder={isFounder}
                      departments={departments}
                    />
                  ))}
                </ItemGroup>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── All Items by Type (showAllTypes mode) ── */}
      {showAllTypes && (() => {
        const byType = groupByType(items);
        const nonEmpty = ALL_SCOPE_TYPES.filter((t) => byType[t].length > 0);
        if (nonEmpty.length === 0) {
          return (
            <section data-testid="scope-items">
              <p className="text-sm text-muted-foreground italic">
                Nothing to scope yet. Scribe surfaces items as the discussion grows.
              </p>
            </section>
          );
        }
        return (
          <section data-testid="scope-items-by-type">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              All Items by Type
            </h3>
            <div className="space-y-4">
              {nonEmpty.map((t) => (
                <ItemGroup key={t} label={t} count={byType[t].length}>
                  {byType[t].map((item) => (
                    <ScopeItemRow
                      key={item.id}
                      item={item}
                      hasConflict={false}
                      onClick={() => onItemClick(item)}
                      companyId={companyId}
                      discussionId={discussionId}
                      isFounder={isFounder}
                      departments={departments}
                    />
                  ))}
                </ItemGroup>
              ))}
            </div>
          </section>
        );
      })()}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   ItemGroup — section wrapper
   ════════════════════════════════════════════════════════════════════════ */

function ItemGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] bg-muted text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   ScopeItemRow — single item card
   ════════════════════════════════════════════════════════════════════════ */

const TYPE_COLORS: Record<string, string> = {
  task: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  decision: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  insight: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  reference: "bg-stone-200 text-stone-800 dark:bg-stone-800/30 dark:text-stone-300",
  artifact: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  context: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  preference: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  spin_off_thread: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
};

function ScopeItemRow({
  item,
  hasConflict,
  onClick,
  companyId,
  discussionId,
  isFounder = false,
  departments = [],
}: {
  item: ScopeItem;
  hasConflict: boolean;
  onClick: () => void;
  companyId?: string;
  discussionId?: string;
  isFounder?: boolean;
  departments?: Department[];
}) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const spinOffMutation = useMutation({
    mutationFn: () => {
      if (!companyId || !discussionId) throw new Error("Missing context");
      return threadsApi.spinOff(companyId, discussionId, item.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads", companyId] });
      pushToast({ title: "Spin-off thread created", tone: "success" });
    },
    onError: () => pushToast({ title: "Failed to spin off thread", tone: "warn" }),
  });

  const routingMutation = useMutation({
    mutationFn: (routing: { departmentId?: string }) => {
      if (!companyId || !discussionId) throw new Error("Missing context");
      return threadsApi.routeItem(companyId, discussionId, item.id, routing);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads", companyId, discussionId] });
    },
  });

  const depCount = (item.dependsOn ?? []).length;

  return (
    <div
      className={cn(
        "group flex flex-col gap-2 w-full rounded-lg border p-3 transition-colors",
        "border-border bg-card",
        hasConflict && "border-amber-400 bg-amber-50 dark:bg-amber-900/10",
      )}
      data-testid={`scope-item-${item.id}`}
    >
      {/* Main row: click to open */}
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-3 w-full text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{item.title}</span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase shrink-0",
                TYPE_COLORS[item.type] ?? "bg-muted text-muted-foreground",
              )}
            >
              {item.type}
            </span>
            {hasConflict && (
              <Badge variant="destructive" className="text-[10px] shrink-0">
                Conflict
              </Badge>
            )}
            {/* Dependency badge */}
            {depCount > 0 && (
              <span
                data-testid={`dep-badge-${item.id}`}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 shrink-0"
                title={`Blocked by ${depCount} item${depCount !== 1 ? "s" : ""}`}
              >
                <Link2 className="h-2.5 w-2.5" />
                blocked by {depCount}
              </span>
            )}
          </div>
          {item.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {item.description}
            </p>
          )}
        </div>
      </button>

      {/* Action row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Spin-off button */}
        <button
          type="button"
          data-testid={`spin-off-${item.id}`}
          onClick={(e) => {
            e.stopPropagation();
            spinOffMutation.mutate();
          }}
          disabled={spinOffMutation.isPending || !companyId || !discussionId}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] border border-border hover:bg-muted/30 transition-colors text-muted-foreground"
          aria-label="Spin off"
        >
          <GitBranch className="h-2.5 w-2.5" />
          Spin off →
        </button>

        {/* Per-item routing (founder only) */}
        {isFounder && (
          <select
            data-testid={`routing-dept-${item.id}`}
            className="text-[10px] rounded border border-border bg-background px-1.5 py-0.5 text-muted-foreground"
            defaultValue=""
            onChange={(e) => routingMutation.mutate({ departmentId: e.target.value || undefined })}
            aria-label="Route to department"
          >
            <option value="">Department…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
