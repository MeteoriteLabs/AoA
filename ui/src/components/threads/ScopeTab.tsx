/**
 * ScopeTab — renders Summary, Plan, and grouped scope items.
 * Uses groupScopeItems() to sort items into four buckets.
 * Used inside ThreadDetail's center panel (Scope tab).
 */
import { groupScopeItems, type ScopeItem } from "./scopeGrouping";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/* ════════════════════════════════════════════════════════════════════════
   ScopeTab
   ════════════════════════════════════════════════════════════════════════ */

export interface ScopeTabProps {
  summaryText: string | null;
  summaryNext: string | null;
  items: ScopeItem[];
  planSteps: string[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onItemClick: (item: ScopeItem) => void;
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
                  />
                ))}
              </ItemGroup>
            )}
          </div>
        )}
      </section>
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
};

function ScopeItemRow({
  item,
  hasConflict,
  onClick,
}: {
  item: ScopeItem;
  hasConflict: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 w-full rounded-lg border p-3 text-left transition-colors",
        "border-border bg-card hover:bg-muted/30 cursor-pointer",
      )}
      data-testid={`scope-item-${item.id}`}
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
        </div>
        {item.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {item.description}
          </p>
        )}
      </div>
    </button>
  );
}
