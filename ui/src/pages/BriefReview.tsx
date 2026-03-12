import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { briefsApi, type BriefWithItems, type BriefItem } from "../api/briefs";
import { debriefsApi } from "../api/debriefs";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  X,
  Pencil,
  ChevronDown,
  ChevronRight,
  CheckCheck,
  XCircle,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { cn } from "../lib/utils";

const TYPE_LABELS: Record<string, string> = {
  decision: "Decisions",
  task: "Tasks",
  insight: "Insights",
  context: "Context",
};

const TYPE_ORDER = ["decision", "task", "insight", "context"];

const TYPE_COLORS: Record<string, string> = {
  decision: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  task: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  insight: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  context: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  low: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

const STATUS_BADGES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  reviewed: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  partially_approved: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

function BriefItemCard({
  item,
  departments,
  onUpdate,
}: {
  item: BriefItem;
  departments: { id: string; name: string }[];
  onUpdate: (itemId: string, data: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editDescription, setEditDescription] = useState(item.description ?? "");
  const [editPriority, setEditPriority] = useState(item.suggestedPriority ?? "medium");
  const [editDeptId, setEditDeptId] = useState(item.suggestedDepartmentId ?? "");

  const isActioned = item.status === "approved" || item.status === "rejected" || item.status === "edited";

  function startEdit() {
    setEditTitle(item.title);
    setEditDescription(item.description ?? "");
    setEditPriority(item.suggestedPriority ?? "medium");
    setEditDeptId(item.suggestedDepartmentId ?? "");
    setEditing(true);
  }

  function saveEdit() {
    onUpdate(item.id, {
      status: "edited",
      title: editTitle,
      description: editDescription,
      ...(item.type === "task" ? { suggestedPriority: editPriority } : {}),
      ...(editDeptId ? { suggestedDepartmentId: editDeptId } : {}),
    });
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 transition-colors",
        item.status === "approved" && "border-green-200 bg-green-50/50 dark:border-green-800/30 dark:bg-green-900/10",
        item.status === "rejected" && "border-red-200 bg-red-50/50 opacity-60 dark:border-red-800/30 dark:bg-red-900/10",
        item.status === "edited" && "border-blue-200 bg-blue-50/50 dark:border-blue-800/30 dark:bg-blue-900/10",
      )}
    >
      {editing ? (
        <div className="flex flex-col gap-3">
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="font-medium"
          />
          <Textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            className="min-h-[80px] resize-y text-sm"
          />
          {item.type === "task" && (
            <div className="flex gap-3">
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value)}
                className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <select
                value={editDeptId}
                onChange={(e) => setEditDeptId(e.target.value)}
                className="flex h-9 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={cancelEdit}>Cancel</Button>
            <Button size="sm" onClick={saveEdit}>Save</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{item.title}</span>
                <span className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                  TYPE_COLORS[item.type] ?? "bg-muted text-muted-foreground",
                )}>
                  {item.type}
                </span>
                {item.type === "task" && item.suggestedPriority && (
                  <span className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                    PRIORITY_COLORS[item.suggestedPriority] ?? "bg-muted text-muted-foreground",
                  )}>
                    {item.suggestedPriority}
                  </span>
                )}
                {item.status !== "pending" && (
                  <span className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                    item.status === "approved" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
                    item.status === "rejected" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
                    item.status === "edited" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                  )}>
                    {item.status}
                  </span>
                )}
              </div>
              {item.description && (
                <p className="mt-1 text-sm text-muted-foreground line-clamp-3">
                  {item.description}
                </p>
              )}
              {/* Show links to created items */}
              {item.resultTaskId && (
                <Link
                  to={`/issues/${item.resultTaskId}`}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> View created task
                </Link>
              )}
              {item.resultMemoryId && (
                <Link
                  to="/memory"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> View in memory
                </Link>
              )}
            </div>
            {!isActioned && (
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onUpdate(item.id, { status: "approved" })}
                  title="Approve"
                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={startEdit}
                  title="Edit"
                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onUpdate(item.id, { status: "rejected" })}
                  title="Reject"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function BriefReview() {
  const { briefId } = useParams<{ briefId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [rawContentOpen, setRawContentOpen] = useState(false);
  const [approveResult, setApproveResult] = useState<{
    taskCount: number;
    memoryCount: number;
  } | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Briefs", href: "/briefs" },
      { label: "Review" },
    ]);
  }, [setBreadcrumbs]);

  const { data: brief, isLoading } = useQuery({
    queryKey: queryKeys.briefs.detail(selectedCompanyId!, briefId!),
    queryFn: () => briefsApi.get(selectedCompanyId!, briefId!),
    enabled: !!selectedCompanyId && !!briefId,
  });

  // Fetch the debrief for raw content
  const { data: debrief } = useQuery({
    queryKey: queryKeys.debriefs.detail(selectedCompanyId!, brief?.debriefId ?? ""),
    queryFn: () => debriefsApi.get(selectedCompanyId!, brief!.debriefId),
    enabled: !!selectedCompanyId && !!brief?.debriefId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const departments = useMemo(
    () => projects?.filter((p) => p.type === "department").map((d) => ({ id: d.id, name: d.name })) ?? [],
    [projects],
  );

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: Record<string, unknown> }) =>
      briefsApi.updateItem(selectedCompanyId!, briefId!, itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.briefs.detail(selectedCompanyId!, briefId!),
      });
    },
    onError: () => {
      pushToast({ title: "Failed to update item", tone: "warn" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: () => briefsApi.approve(selectedCompanyId!, briefId!),
    onSuccess: (result) => {
      setApproveResult({
        taskCount: result.createdTaskIds.length,
        memoryCount: result.createdMemoryIds.length,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.briefs.detail(selectedCompanyId!, briefId!),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.briefs.list(selectedCompanyId!),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.list(selectedCompanyId!),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.memory.list(selectedCompanyId!),
      });
      pushToast({ title: "Brief processed successfully", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to process brief", tone: "warn" });
    },
  });

  function handleUpdateItem(itemId: string, data: Record<string, unknown>) {
    updateItemMutation.mutate({ itemId, data });
  }

  function handleBulkAction(status: "approved" | "rejected") {
    if (!brief) return;
    const pendingItems = brief.items.filter((i) => i.status === "pending");
    for (const item of pendingItems) {
      updateItemMutation.mutate({ itemId: item.id, data: { status } });
    }
  }

  // Group items by type
  const grouped = useMemo(() => {
    if (!brief) return {};
    const groups: Record<string, BriefItem[]> = {};
    for (const item of brief.items) {
      if (!groups[item.type]) groups[item.type] = [];
      groups[item.type].push(item);
    }
    return groups;
  }, [brief]);

  const isProcessed = brief?.status === "approved" || brief?.status === "rejected" || brief?.status === "partially_approved";
  const pendingCount = brief?.items.filter((i) => i.status === "pending").length ?? 0;
  const hasActionedItems = brief?.items.some(
    (i) => i.status === "approved" || i.status === "edited" || i.status === "rejected",
  ) ?? false;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm">Brief not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">
            {debrief?.title ?? "Untitled Debrief"}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {debrief?.inputType && (
              <Badge variant="outline" className="text-[10px]">
                {debrief.inputType}
              </Badge>
            )}
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                STATUS_BADGES[brief.status] ?? "bg-muted text-muted-foreground",
              )}
            >
              {brief.status.replace("_", " ")}
            </span>
            <span>{new Date(brief.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Success result banner */}
      {approveResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800/30 dark:bg-green-900/10">
          <p className="text-sm font-medium text-green-800 dark:text-green-300">
            Brief processed successfully
          </p>
          <p className="mt-1 text-sm text-green-700 dark:text-green-400">
            Created {approveResult.taskCount} task{approveResult.taskCount !== 1 ? "s" : ""} and{" "}
            {approveResult.memoryCount} memory item{approveResult.memoryCount !== 1 ? "s" : ""}
          </p>
        </div>
      )}

      {/* Original content collapsible */}
      {debrief?.rawContent && (
        <div className="rounded-lg border border-border">
          <button
            onClick={() => setRawContentOpen(!rawContentOpen)}
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-accent/50 transition-colors"
          >
            {rawContentOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Original Content
          </button>
          {rawContentOpen && (
            <div className="border-t border-border px-4 py-3">
              <pre className="whitespace-pre-wrap text-sm text-muted-foreground max-h-[300px] overflow-y-auto">
                {debrief.rawContent}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Bulk actions */}
      {!isProcessed && pendingCount > 0 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction("approved")}
          >
            <CheckCheck className="h-4 w-4 mr-1.5" />
            Approve All ({pendingCount})
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction("rejected")}
          >
            <XCircle className="h-4 w-4 mr-1.5" />
            Reject All
          </Button>
        </div>
      )}

      {/* Grouped items */}
      {TYPE_ORDER.map((type) => {
        const items = grouped[type];
        if (!items || items.length === 0) return null;
        return (
          <div key={type} className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {TYPE_LABELS[type]} ({items.length})
            </h2>
            <div className="space-y-2">
              {items.map((item) => (
                <BriefItemCard
                  key={item.id}
                  item={item}
                  departments={departments}
                  onUpdate={handleUpdateItem}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Process Brief button */}
      {!isProcessed && hasActionedItems && (
        <div className="flex justify-end pt-4 border-t border-border">
          <Button
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            )}
            Process Brief
          </Button>
        </div>
      )}
    </div>
  );
}
