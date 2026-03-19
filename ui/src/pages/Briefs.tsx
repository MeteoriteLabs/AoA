import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { briefsApi } from "../api/briefs";
import { queryKeys } from "../lib/queryKeys";
import { Loader2, FileText, ClipboardPen, PenLine, Plug, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import { BRIEF_STATUS_BADGES as STATUS_BADGES } from "../lib/brief-constants";
import { EmptyState } from "../components/EmptyState";

const SOURCE_BADGES: Record<string, { label: string; class: string; icon: typeof FileText }> = {
  paste: { label: "Paste", class: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: ClipboardPen },
  write: { label: "Write", class: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: PenLine },
  mcp: { label: "MCP", class: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300", icon: Plug },
};

/** Pipeline statuses in order, with display labels and active chip styles */
const PIPELINE_STATUSES = [
  { value: "draft", label: "Draft", activeClass: "bg-muted text-foreground border-border" },
  { value: "ready", label: "Ready", activeClass: "bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500" },
  { value: "reviewed", label: "Reviewed", activeClass: "bg-purple-600 text-white border-purple-600 dark:bg-purple-500 dark:border-purple-500" },
  { value: "approved", label: "Approved", activeClass: "bg-green-600 text-white border-green-600 dark:bg-green-500 dark:border-green-500" },
  { value: "partially_approved", label: "Partial", activeClass: "bg-amber-600 text-white border-amber-600 dark:bg-amber-500 dark:border-amber-500" },
  { value: "rejected", label: "Rejected", activeClass: "bg-red-600 text-white border-red-600 dark:bg-red-500 dark:border-red-500" },
] as const;

export function Briefs() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const { setSubtitle, setEntityColor } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Briefs" }]);
    setEntityColor("var(--entity-brief)");
    return () => { setSubtitle(null); setEntityColor(null); };
  }, [setBreadcrumbs, setSubtitle, setEntityColor]);

  // Always fetch all briefs so we can compute counts per status
  const { data: briefs, isLoading } = useQuery({
    queryKey: queryKeys.briefs.list(selectedCompanyId!),
    queryFn: () => briefsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // Compute subtitle counts
  useEffect(() => {
    if (!briefs) return;
    const ready = briefs.filter((b) => b.status === "ready").length;
    setSubtitle(ready > 0 ? `${ready} ready for review` : null);
  }, [briefs, setSubtitle]);

  // Compute status counts for the pipeline bar
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of PIPELINE_STATUSES) counts[s.value] = 0;
    if (briefs) {
      for (const b of briefs) {
        if (counts[b.status] !== undefined) counts[b.status]++;
      }
    }
    return counts;
  }, [briefs]);

  // Client-side filtering + sorting: ready briefs first, then by date descending
  const sorted = useMemo(() => {
    if (!briefs) return [];
    const filtered = statusFilter ? briefs.filter((b) => b.status === statusFilter) : briefs;
    return [...filtered].sort((a, b) => {
      if (a.status === "ready" && b.status !== "ready") return -1;
      if (a.status !== "ready" && b.status === "ready") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [briefs, statusFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status pipeline bar */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* "All" chip */}
        <button
          onClick={() => setStatusFilter(null)}
          className={cn(
            "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
            statusFilter === null
              ? "bg-foreground text-background border-foreground"
              : "bg-transparent text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground",
          )}
        >
          All ({briefs?.length ?? 0})
        </button>
        {PIPELINE_STATUSES.map((status, index) => {
          const count = statusCounts[status.value];
          const isActive = statusFilter === status.value;
          return (
            <div key={status.value} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
              <button
                onClick={() => setStatusFilter(isActive ? null : status.value)}
                className={cn(
                  "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
                  isActive
                    ? status.activeClass
                    : "bg-transparent text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground",
                  count === 0 && !isActive && "opacity-50",
                )}
              >
                {count} {status.label}
              </button>
            </div>
          );
        })}
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={FileText}
          message="No briefs yet"
          description="Submit a debrief to generate your first brief. Briefs extract structured insights, tasks, and decisions from raw content."
          entityColor="var(--entity-brief)"
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((brief) => {
            const isReady = brief.status === "ready";
            const source = brief.sourceType ? SOURCE_BADGES[brief.sourceType] : null;
            const SourceIcon = source?.icon ?? FileText;
            const scopeLabel = brief.departmentName ?? brief.projectName ?? null;

            return (
              <Link
                key={brief.id}
                to={`/briefs/${brief.id}`}
                className={cn(
                  "flex items-center justify-between rounded-lg border p-4 transition-colors",
                  isReady
                    ? "border-blue-300 bg-blue-50/60 hover:bg-blue-100/60 dark:border-blue-800 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
                    : "border-border bg-card hover:bg-accent/50",
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className={cn("h-4 w-4 shrink-0", isReady ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground")} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        Brief — {new Date(brief.createdAt).toLocaleDateString()}
                      </p>
                      {isReady && (
                        <span className="inline-flex items-center rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white shrink-0">
                          Needs Review
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {new Date(brief.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {brief.itemCount} {brief.itemCount === 1 ? "item" : "items"}
                      </span>
                      {source && (
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", source.class)}>
                          <SourceIcon className="h-3 w-3" />
                          {source.label}
                        </span>
                      )}
                      {scopeLabel && (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {scopeLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium shrink-0 capitalize",
                    STATUS_BADGES[brief.status] ?? "bg-muted text-muted-foreground",
                  )}
                >
                  {brief.status.replace("_", " ")}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
