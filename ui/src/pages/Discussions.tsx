import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useDialog } from "../context/DialogContext";
import { discussionsApi, type DiscussionListItem } from "../api/discussions";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import {
  Loader2,
  MessageSquare,
  ClipboardPen,
  PenLine,
  Mic,
  Plug,
  Plus,
  SlidersHorizontal,
  ArrowUpDown,
  Clock,
  AlertCircle,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/EmptyState";

const SOURCE_BADGES: Record<string, { label: string; class: string; icon: typeof ClipboardPen }> = {
  paste: { label: "Paste", class: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: ClipboardPen },
  write: { label: "Write", class: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: PenLine },
  voice: { label: "Voice", class: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", icon: Mic },
  mcp: { label: "MCP", class: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300", icon: Plug },
};

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "has_pending", label: "Needs Review" },
  { value: "reviewed", label: "All Reviewed" },
] as const;

const SORT_OPTIONS = [
  { value: "lastEntryAt", label: "Most Recent", icon: Clock },
  { value: "pendingItemCount", label: "Most Pending", icon: AlertCircle },
] as const;

type StatusFilterValue = (typeof STATUS_FILTERS)[number]["value"];
type SortValue = (typeof SORT_OPTIONS)[number]["value"];

export function Discussions() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs, setSubtitle, setEntityColor } = useBreadcrumbs();
  const { openDiscussionCapture } = useDialog();

  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortValue>("lastEntryAt");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Discussions" }]);
    setEntityColor("var(--entity-brief)");
    return () => { setSubtitle(null); setEntityColor(null); };
  }, [setBreadcrumbs, setSubtitle, setEntityColor]);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.discussions.list(selectedCompanyId!),
    queryFn: () => discussionsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && showFilters,
  });

  const discussions = data?.discussions ?? [];

  // Subtitle
  useEffect(() => {
    if (!discussions.length) return;
    const pending = discussions.filter((d) => d.pendingItemCount > 0).length;
    setSubtitle(pending > 0 ? `${pending} with pending items` : null);
  }, [discussions, setSubtitle]);

  // Client-side filtering + sorting
  const filtered = useMemo(() => {
    let result = [...discussions];

    if (statusFilter === "has_pending") {
      result = result.filter((d) => d.pendingItemCount > 0);
    } else if (statusFilter === "reviewed") {
      result = result.filter((d) => d.pendingItemCount === 0);
    }

    if (sourceFilter) {
      result = result.filter((d) => d.lastEntryInputType === sourceFilter);
    }

    if (scopeFilter) {
      result = result.filter((d) => d.scopeType === scopeFilter);
    }

    result.sort((a, b) => {
      if (sortBy === "pendingItemCount") {
        return b.pendingItemCount - a.pendingItemCount;
      }
      // Default: most recent entry first
      const aDate = a.lastEntryAt ? new Date(a.lastEntryAt).getTime() : 0;
      const bDate = b.lastEntryAt ? new Date(b.lastEntryAt).getTime() : 0;
      return bDate - aDate;
    });

    return result;
  }, [discussions, statusFilter, sourceFilter, scopeFilter, sortBy]);

  const pendingCount = useMemo(
    () => discussions.filter((d) => d.pendingItemCount > 0).length,
    [discussions],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_FILTERS.map((sf) => {
            const isActive = statusFilter === sf.value;
            const count =
              sf.value === "all"
                ? discussions.length
                : sf.value === "has_pending"
                  ? pendingCount
                  : discussions.length - pendingCount;
            return (
              <button
                key={sf.value}
                onClick={() => setStatusFilter(sf.value)}
                className={cn(
                  "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
                  isActive
                    ? "bg-foreground text-background border-foreground"
                    : "bg-transparent text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {sf.label} ({count})
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters((p) => !p)}
            className={cn(showFilters && "bg-accent")}
          >
            <SlidersHorizontal className="h-4 w-4 mr-1.5" />
            Filters
          </Button>
          <Button size="sm" onClick={() => openDiscussionCapture()}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Discussion
          </Button>
        </div>
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className="flex items-center gap-3 flex-wrap rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Source:</span>
            <select
              value={sourceFilter ?? ""}
              onChange={(e) => setSourceFilter(e.target.value || null)}
              className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">All sources</option>
              <option value="paste">Paste</option>
              <option value="write">Write</option>
              <option value="voice">Voice</option>
              <option value="mcp">MCP</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Scope:</span>
            <select
              value={scopeFilter ?? ""}
              onChange={(e) => setScopeFilter(e.target.value || null)}
              className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">All scopes</option>
              <option value="department">Department</option>
              <option value="project">Project</option>
              <option value="goal">Goal</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Sort:</span>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSortBy(opt.value)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs border transition-colors",
                  sortBy === opt.value
                    ? "bg-foreground text-background border-foreground"
                    : "bg-transparent text-muted-foreground border-border hover:bg-accent",
                )}
              >
                <opt.icon className="h-3 w-3" />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Discussion list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          message="No discussions yet"
          description="Start a discussion to capture and process raw content into structured tasks, decisions, and memory items."
          entityColor="var(--entity-brief)"
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((discussion) => (
            <DiscussionRow key={discussion.id} discussion={discussion} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiscussionRow({ discussion }: { discussion: DiscussionListItem }) {
  const hasPending = discussion.pendingItemCount > 0;
  const source = discussion.lastEntryInputType
    ? SOURCE_BADGES[discussion.lastEntryInputType]
    : null;
  const SourceIcon = source?.icon ?? MessageSquare;

  return (
    <Link
      to={`/discussions/${discussion.id}`}
      className={cn(
        "flex items-center justify-between rounded-lg border p-4 transition-colors",
        hasPending
          ? "border-blue-300 bg-blue-50/60 hover:bg-blue-100/60 dark:border-blue-800 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
          : "border-border bg-card hover:bg-accent/50",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <MessageSquare
          className={cn(
            "h-4 w-4 shrink-0",
            hasPending ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground",
          )}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{discussion.title}</p>
            {hasPending && (
              <span className="inline-flex items-center rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white shrink-0">
                {discussion.pendingItemCount} pending
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {discussion.lastEntryAt && (
              <span className="text-xs text-muted-foreground">
                {new Date(discussion.lastEntryAt).toLocaleDateString()}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {discussion.entryCount} {discussion.entryCount === 1 ? "entry" : "entries"}
            </span>
            {source && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  source.class,
                )}
              >
                <SourceIcon className="h-3 w-3" />
                {source.label}
              </span>
            )}
            {discussion.scopeName && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {discussion.scopeName}
              </span>
            )}
            {discussion.tags.length > 0 &&
              discussion.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
          </div>
        </div>
      </div>
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium shrink-0 capitalize",
          discussion.status === "archived"
            ? "bg-muted text-muted-foreground"
            : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
        )}
      >
        {discussion.status}
      </span>
    </Link>
  );
}
