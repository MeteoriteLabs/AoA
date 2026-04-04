import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronDown, ChevronRight, Search } from "lucide-react";
import { issuesApi } from "../../api/issues";
import { queryKeys } from "../../lib/queryKeys";
import { StatusIcon } from "../StatusIcon";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "../../context/ToastContext";
import { cn } from "../../lib/utils";
import type { Issue } from "@paperclipai/shared";

interface WorkspaceTaskNavProps {
  companyId: string;
  companyPrefix: string;
  projectId: string;
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string) => void;
  onBack: () => void;
  departmentName: string;
}

type TaskGroup = {
  label: string;
  statuses: string[];
};

const TASK_GROUPS: TaskGroup[] = [
  { label: "Needs Attention", statuses: ["blocked", "in_review"] },
  { label: "Running", statuses: ["in_progress"] },
  { label: "Idle", statuses: ["backlog", "todo"] },
  { label: "Completed", statuses: ["done", "cancelled"] },
];

export function WorkspaceTaskNav({
  companyId,
  companyPrefix,
  projectId,
  selectedIssueId,
  onSelectIssue,
  onBack,
  departmentName,
}: WorkspaceTaskNavProps) {
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(["Completed"]));

  const { data: allIssues = [], isLoading, error } = useQuery({
    queryKey: queryKeys.issues.listByProject(companyId, projectId),
    queryFn: () => issuesApi.list(companyId, { projectId }),
    enabled: !!companyId && !!projectId,
  });

  const { pushToast } = useToast();

  useEffect(() => {
    if (error) {
      pushToast({ tone: "error", title: "Failed to load tasks", body: (error as Error).message });
    }
  }, [error, pushToast]);

  // Only tasks with workspaces
  const issues = useMemo(
    () => allIssues.filter((i) => i.executionWorkspaceId != null),
    [allIssues],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return issues;
    const q = search.toLowerCase();
    return issues.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.identifier?.toLowerCase().includes(q) ?? false),
    );
  }, [issues, search]);

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full" data-testid="workspace-task-nav">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors border-b border-border shrink-0"
        data-testid="workspace-back-btn"
      >
        <ChevronLeft className="h-4 w-4" />
        <span>Back to Department</span>
      </button>

      {/* Department name */}
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border shrink-0">
        {departmentName}
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Filter tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
            data-testid="workspace-task-search"
          />
        </div>
      </div>

      {/* Task groups */}
      {isLoading ? (
        <div className="p-3 space-y-2" data-testid="task-nav-skeleton">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto" data-testid="workspace-task-list">
          {TASK_GROUPS.map((group) => {
            const groupIssues = filtered.filter((i) => group.statuses.includes(i.status));
            if (groupIssues.length === 0) return null;
            const isCollapsed = collapsedGroups.has(group.label);

            return (
              <div key={group.label}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  data-testid={`workspace-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  )}
                  {group.label}
                  <span className="ml-auto text-xs text-muted-foreground/60">{groupIssues.length}</span>
                </button>

                {!isCollapsed && (
                  <div>
                    {groupIssues.map((issue) => (
                      <TaskRow
                        key={issue.id}
                        issue={issue}
                        isSelected={issue.id === selectedIssueId}
                        onSelect={() => onSelectIssue(issue.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              {search ? "No tasks match your search" : "No tasks with workspaces"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  issue,
  isSelected,
  onSelect,
}: {
  issue: Issue;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50",
        isSelected && "bg-accent/10 text-accent-foreground",
      )}
      data-testid={`workspace-task-row-${issue.id}`}
    >
      <StatusIcon status={issue.status} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {issue.identifier && (
            <span className="text-xs text-muted-foreground shrink-0">{issue.identifier}</span>
          )}
          <span className="truncate text-xs">{issue.title}</span>
        </div>
      </div>
    </button>
  );
}
