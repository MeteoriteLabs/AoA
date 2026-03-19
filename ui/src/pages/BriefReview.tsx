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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Check,
  X,
  Pencil,
  ChevronDown,
  ChevronRight,
  CheckCheck,
  CheckSquare,
  XCircle,
  Loader2,
  ExternalLink,
  Link as LinkIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { BRIEF_STATUS_BADGES as STATUS_BADGES } from "../lib/brief-constants";

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

function BriefItemCard({
  item,
  departments,
  onUpdate,
  taskItems,
  dependencies,
  onAddDependency,
  onRemoveDependency,
  selected,
  onToggleSelect,
}: {
  item: BriefItem;
  departments: { id: string; name: string }[];
  onUpdate: (itemId: string, data: Record<string, unknown>) => void;
  taskItems?: BriefItem[];
  dependencies?: Array<{ dependentItemId: string; dependencyItemId: string }>;
  onAddDependency?: (dependentItemId: string, dependencyItemId: string) => void;
  onRemoveDependency?: (dependentItemId: string, dependencyItemId: string) => void;
  selected?: boolean;
  onToggleSelect?: (itemId: string) => void;
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
        "rounded-lg border p-4 transition-colors",
        item.status === "pending" && "border-border bg-card",
        item.status === "approved" && "border-green-300 bg-green-50/70 dark:border-green-700/40 dark:bg-green-950/30",
        item.status === "rejected" && "border-red-300 bg-red-50/50 opacity-50 dark:border-red-700/40 dark:bg-red-950/20",
        item.status === "edited" && "border-blue-300 bg-blue-50/70 dark:border-blue-700/40 dark:bg-blue-950/30",
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
            {/* Selection checkbox for pending items */}
            {item.status === "pending" && onToggleSelect && (
              <div className="pt-0.5 shrink-0">
                <Checkbox
                  checked={selected}
                  onCheckedChange={() => onToggleSelect(item.id)}
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{item.title}</span>
                <span className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
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
              {/* Dependency selector for task items */}
              {item.type === "task" && taskItems && taskItems.length > 1 && onAddDependency && onRemoveDependency && (
                <div className="mt-2 pt-2 border-t border-border/50">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <LinkIcon className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground font-medium">Depends on</span>
                  </div>
                  {/* Show current dependencies */}
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {dependencies
                      ?.filter((d) => d.dependentItemId === item.id)
                      .map((d) => {
                        const depItem = taskItems.find((t) => t.id === d.dependencyItemId);
                        return depItem ? (
                          <span
                            key={d.dependencyItemId}
                            className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
                          >
                            {depItem.title.length > 30 ? depItem.title.slice(0, 30) + "..." : depItem.title}
                            <button
                              onClick={() => onRemoveDependency(item.id, d.dependencyItemId)}
                              className="text-blue-400 hover:text-blue-600"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ) : null;
                      })}
                  </div>
                  {/* Add dependency dropdown */}
                  <select
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        onAddDependency(item.id, e.target.value);
                        e.target.value = "";
                      }
                    }}
                  >
                    <option value="">Select a dependency...</option>
                    {taskItems
                      .filter(
                        (t) =>
                          t.id !== item.id &&
                          !dependencies?.some(
                            (d) => d.dependentItemId === item.id && d.dependencyItemId === t.id,
                          ),
                      )
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                  </select>
                </div>
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

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [rawContentOpen, setRawContentOpen] = useState(false);
  const [approveResult, setApproveResult] = useState<{
    taskCount: number;
    memoryCount: number;
    createdDependencyCount: number;
    skippedDependencyCount: number;
  } | null>(null);
  const [dependencies, setDependencies] = useState<
    Array<{ dependentItemId: string; dependencyItemId: string }>
  >([]);

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

  const taskItems = useMemo(
    () => brief?.items.filter((i) => i.type === "task") ?? [],
    [brief],
  );

  function addDependency(dependentItemId: string, dependencyItemId: string) {
    if (dependentItemId === dependencyItemId) return;
    const alreadyExists = dependencies.some(
      (d) => d.dependentItemId === dependentItemId && d.dependencyItemId === dependencyItemId,
    );
    if (alreadyExists) return;
    const next = [...dependencies, { dependentItemId, dependencyItemId }];
    if (detectCycles(next)) {
      pushToast({ title: "Adding this dependency would create a cycle.", tone: "warn" });
      return;
    }
    setDependencies(next);
  }

  function removeDependency(dependentItemId: string, dependencyItemId: string) {
    setDependencies((prev) =>
      prev.filter(
        (d) => !(d.dependentItemId === dependentItemId && d.dependencyItemId === dependencyItemId),
      ),
    );
  }

  /** Detect cycles in the dependency graph before submitting. */
  function detectCycles(
    deps: Array<{ dependentItemId: string; dependencyItemId: string }>,
  ): boolean {
    // Build adjacency list: dependentItemId -> [dependencyItemIds]
    const graph = new Map<string, string[]>();
    for (const d of deps) {
      const edges = graph.get(d.dependentItemId) ?? [];
      edges.push(d.dependencyItemId);
      graph.set(d.dependentItemId, edges);
    }

    // DFS cycle detection
    const visiting = new Set<string>();
    const visited = new Set<string>();

    function hasCycle(node: string): boolean {
      if (visiting.has(node)) return true;
      if (visited.has(node)) return false;
      visiting.add(node);
      for (const neighbor of graph.get(node) ?? []) {
        if (hasCycle(neighbor)) return true;
      }
      visiting.delete(node);
      visited.add(node);
      return false;
    }

    for (const node of graph.keys()) {
      if (hasCycle(node)) return true;
    }
    return false;
  }

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
    mutationFn: () => briefsApi.approve(selectedCompanyId!, briefId!, dependencies),
    onSuccess: (result) => {
      setApproveResult({
        taskCount: result.createdTaskIds.length,
        memoryCount: result.createdMemoryIds.length,
        createdDependencyCount: result.createdDependencyCount,
        skippedDependencyCount: result.skippedDependencyCount,
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
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to process brief";
      pushToast({ title: message, tone: "warn" });
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
    setSelectedItems(new Set());
  }

  function handleApproveSelected() {
    if (!brief || selectedItems.size === 0) return;
    for (const itemId of selectedItems) {
      updateItemMutation.mutate({ itemId, data: { status: "approved" } });
    }
    setSelectedItems(new Set());
  }

  function toggleSelectItem(itemId: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!brief) return;
    const pendingIds = brief.items.filter((i) => i.status === "pending").map((i) => i.id);
    const allSelected = pendingIds.length > 0 && pendingIds.every((id) => selectedItems.has(id));
    if (allSelected) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(pendingIds));
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
            {approveResult.createdDependencyCount > 0 && (
              <> with {approveResult.createdDependencyCount} dependency{approveResult.createdDependencyCount !== 1 ? " links" : " link"}</>
            )}
          </p>
          {approveResult.skippedDependencyCount > 0 && (
            <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
              {approveResult.skippedDependencyCount} dependency{approveResult.skippedDependencyCount !== 1 ? " links were" : " link was"} skipped because one or both items were rejected or pending.
            </p>
          )}
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

      {/* Batch actions */}
      {!isProcessed && pendingCount > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-card/50 p-3">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSelectAll}
            className="text-xs"
          >
            <CheckSquare className="h-3.5 w-3.5 mr-1.5" />
            {selectedItems.size > 0 && selectedItems.size === pendingCount ? "Deselect All" : "Select All"}
          </Button>
          <div className="h-4 w-px bg-border" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction("approved")}
          >
            <CheckCheck className="h-4 w-4 mr-1.5" />
            Approve All ({pendingCount})
          </Button>
          {selectedItems.size > 0 && (
            <Button
              size="sm"
              onClick={handleApproveSelected}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="h-4 w-4 mr-1.5" />
              Approve Selected ({selectedItems.size})
            </Button>
          )}
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
                  taskItems={item.type === "task" ? taskItems : undefined}
                  dependencies={item.type === "task" ? dependencies : undefined}
                  onAddDependency={item.type === "task" ? addDependency : undefined}
                  onRemoveDependency={item.type === "task" ? removeDependency : undefined}
                  selected={selectedItems.has(item.id)}
                  onToggleSelect={!isProcessed ? toggleSelectItem : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Process Brief button */}
      {!isProcessed && hasActionedItems && (
        <div className="pt-4 border-t border-border space-y-2">
          {pendingCount > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {pendingCount} item{pendingCount !== 1 ? "s" : ""} still pending — they will be skipped during processing.
            </p>
          )}
          {dependencies.length > 0 && (
            <p className="text-xs text-blue-600 dark:text-blue-400">
              {dependencies.length} task dependency{dependencies.length !== 1 ? "ies" : ""} configured.
            </p>
          )}
          <div className="flex justify-end">
            <Button
              onClick={() => {
                if (dependencies.length > 0 && detectCycles(dependencies)) {
                  pushToast({ title: "Circular dependency detected — please remove the cycle before processing.", tone: "warn" });
                  return;
                }
                approveMutation.mutate();
              }}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              Process Brief
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
