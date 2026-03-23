import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { briefsApi, type BriefItem } from "../api/briefs";
import { debriefsApi } from "../api/debriefs";
import { projectsApi } from "../api/projects";
import { goalsApi } from "../api/goals";
import { memoryApi } from "../api/memory";
import { outputDetectionApi } from "../api/output-detection";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode,
  Link as LinkIcon,
  Loader2,
  Pencil,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "../lib/utils";
import { BRIEF_STATUS_BADGES as STATUS_BADGES } from "../lib/brief-constants";

const TYPE_LABELS: Record<string, string> = {
  decision: "Decisions",
  task: "Tasks",
  insight: "Insights",
  context: "Context",
  reference: "References",
  preference: "Preferences",
};

const TYPE_ORDER = ["decision", "task", "insight", "context", "reference", "preference"];
const MEMORY_TYPES = new Set(["decision", "insight", "context", "reference", "preference"]);
const LAYER_OPTIONS = [
  { value: "identity", label: "Identity" },
  { value: "domain", label: "Domain" },
  { value: "active_context", label: "Active Context" },
  { value: "working", label: "Working" },
];
const DEDUP_OPTIONS = [
  { value: "create_separate", label: "Create separate" },
  { value: "update_existing", label: "Update existing" },
  { value: "replace", label: "Replace" },
];

const TYPE_COLORS: Record<string, string> = {
  decision: "bg-sky-100 text-sky-800",
  task: "bg-blue-100 text-blue-800",
  insight: "bg-amber-100 text-amber-800",
  context: "bg-emerald-100 text-emerald-800",
  reference: "bg-stone-200 text-stone-800",
  preference: "bg-rose-100 text-rose-800",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-800",
};

function humanLayer(layer: string | null | undefined) {
  return (layer ?? "domain").replace("_", " ");
}

function mergePreview(existingContent: string, nextContent: string) {
  const current = existingContent.trim();
  const incoming = nextContent.trim();
  if (!current) return incoming;
  if (!incoming) return current;
  if (current === incoming) return current;
  return `${current}\n\n${incoming}`;
}

function DiffText({ value, compareTo }: { value: string; compareTo: string }) {
  const compareWords = useMemo(
    () => new Set(compareTo.toLowerCase().split(/\s+/).filter(Boolean)),
    [compareTo],
  );
  const tokens = useMemo(() => value.split(/(\s+)/), [value]);

  return (
    <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
      {tokens.map((token, index) => {
        if (!token.trim()) return <span key={index}>{token}</span>;
        const changed = !compareWords.has(token.toLowerCase());
        return (
          <span
            key={index}
            className={changed ? "rounded bg-amber-100/80 px-0.5 text-foreground" : undefined}
          >
            {token}
          </span>
        );
      })}
    </p>
  );
}

function ComparisonPanel({
  title,
  subtitle,
  content,
  compareTo,
}: {
  title: string;
  subtitle: string;
  content: string;
  compareTo: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="mb-2">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <DiffText value={content} compareTo={compareTo} />
    </div>
  );
}

function BriefItemCard({
  item,
  briefGoalId,
  sourceTaskId,
  departments,
  onUpdate,
  taskItems,
  dependencies,
  onAddDependency,
  onRemoveDependency,
  selected,
  onToggleSelect,
  companyId,
}: {
  item: BriefItem;
  briefGoalId: string | null;
  sourceTaskId: string | null;
  departments: { id: string; name: string }[];
  onUpdate: (itemId: string, data: Record<string, unknown>) => void;
  taskItems?: BriefItem[];
  dependencies?: Array<{ dependentItemId: string; dependencyItemId: string }>;
  onAddDependency?: (dependentItemId: string, dependencyItemId: string) => void;
  onRemoveDependency?: (dependentItemId: string, dependencyItemId: string) => void;
  selected?: boolean;
  onToggleSelect?: (itemId: string) => void;
  companyId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editDescription, setEditDescription] = useState(item.description ?? "");
  const [editPriority, setEditPriority] = useState(item.suggestedPriority ?? "medium");
  const [editDeptId, setEditDeptId] = useState(item.suggestedDepartmentId ?? "");
  const [mergedDraft, setMergedDraft] = useState(item.mergedContent ?? "");

  const isActioned = item.status === "approved" || item.status === "rejected" || item.status === "edited";
  const isMemoryType = MEMORY_TYPES.has(item.type);
  const effectiveLayer = item.layer ?? item.suggestedLayer ?? "domain";
  const effectiveContent = item.description?.trim() || item.title;

  useEffect(() => {
    setMergedDraft(item.mergedContent ?? "");
  }, [item.mergedContent]);

  const { data: similarItems, isLoading: loadingSimilar } = useQuery({
    queryKey: ["brief-similar", companyId, item.id, effectiveContent, item.suggestedDepartmentId, effectiveLayer],
    queryFn: () =>
      memoryApi.findSimilarItems(companyId, effectiveContent, {
        departmentId: item.suggestedDepartmentId ?? undefined,
        layer: effectiveLayer,
      }),
    enabled: isMemoryType && effectiveContent.trim().length > 0,
  });

  const selectedSimilarItem =
    similarItems?.find((candidate) => candidate.id === item.selectedMemoryId) ??
    (similarItems?.length === 1 ? similarItems[0] : null);

  const mergedPreview = selectedSimilarItem
    ? mergePreview(selectedSimilarItem.content, effectiveContent)
    : effectiveContent;

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
      suggestedPriority: item.type === "task" ? editPriority : item.suggestedPriority,
      suggestedDepartmentId: editDeptId || null,
    });
    setEditing(false);
  }

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        item.status === "pending" && "border-border bg-card",
        item.status === "approved" && "border-green-300 bg-green-50/70",
        item.status === "rejected" && "border-red-300 bg-red-50/50 opacity-60",
        item.status === "edited" && "border-blue-300 bg-blue-50/70",
      )}
    >
      {editing ? (
        <div className="flex flex-col gap-3">
          <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="font-medium" />
          <Textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            className="min-h-[100px] resize-y text-sm"
          />
          <div className="flex flex-wrap gap-3">
            {item.type === "task" && (
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value)}
                className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            )}
            <select
              value={editDeptId}
              onChange={(e) => setEditDeptId(e.target.value)}
              className="flex h-9 min-w-[180px] rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="">No department override</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" onClick={saveEdit}>Save</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 gap-2">
              {item.status === "pending" && onToggleSelect && (
                <div className="pt-0.5 shrink-0">
                  <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(item.id)} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{item.title}</span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      TYPE_COLORS[item.type] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {item.type}
                  </span>
                  {item.type === "task" && item.suggestedPriority && (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                        PRIORITY_COLORS[item.suggestedPriority] ?? "bg-muted text-muted-foreground",
                      )}
                    >
                      {item.suggestedPriority}
                    </span>
                  )}
                  {isMemoryType && (
                    <Badge variant="outline" className="text-[10px]">
                      {humanLayer(effectiveLayer)}
                    </Badge>
                  )}
                  {item.status !== "pending" && (
                    <Badge variant="outline" className="text-[10px]">
                      {item.status}
                    </Badge>
                  )}
                </div>
                {item.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                )}
                {item.resultTaskId && (
                  <Link to={`/issues/${item.resultTaskId}`} className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <ExternalLink className="h-3 w-3" /> View created task
                  </Link>
                )}
                {item.resultMemoryId && (
                  <Link to="/memory" className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <ExternalLink className="h-3 w-3" /> View in memory
                  </Link>
                )}
              </div>
            </div>
            {!isActioned && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onUpdate(item.id, { status: "approved" })}
                  className="text-green-600 hover:bg-green-50 hover:text-green-700"
                  title="Approve"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={startEdit}
                  className="text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onUpdate(item.id, { status: "rejected" })}
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  title="Reject"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {isMemoryType && (
            <div className="grid gap-3 rounded-md border border-border/70 bg-background/70 p-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Layer
                <select
                  value={effectiveLayer}
                  onChange={(e) => onUpdate(item.id, { layer: e.target.value })}
                  className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                >
                  {LAYER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {item.suggestedLayer && (
                  <span className="text-[11px]">LLM suggested {humanLayer(item.suggestedLayer)}</span>
                )}
              </label>
              <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                <span>Propagation</span>
                <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-foreground">
                  {effectiveLayer === "active_context" && (
                    <span>{briefGoalId ? `Goal linked: ${briefGoalId}` : "No goal selected for active context"}</span>
                  )}
                  {effectiveLayer === "working" && (
                    <span>{sourceTaskId ? `Task linked: ${sourceTaskId}` : "No task scope detected for working memory"}</span>
                  )}
                  {effectiveLayer !== "active_context" && effectiveLayer !== "working" && (
                    <span>No extra propagation for this layer</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {item.type === "task" && taskItems && taskItems.length > 1 && onAddDependency && onRemoveDependency && (
            <div className="rounded-md border border-border/70 bg-background/70 p-3">
              <div className="mb-2 flex items-center gap-1.5">
                <LinkIcon className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Depends on</span>
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {dependencies
                  ?.filter((dependency) => dependency.dependentItemId === item.id)
                  .map((dependency) => {
                    const dependencyItem = taskItems.find((task) => task.id === dependency.dependencyItemId);
                    if (!dependencyItem) return null;
                    return (
                      <span
                        key={dependency.dependencyItemId}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                      >
                        {dependencyItem.title}
                        <button onClick={() => onRemoveDependency(item.id, dependency.dependencyItemId)}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
              </div>
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
                    (task) =>
                      task.id !== item.id &&
                      !dependencies?.some(
                        (dependency) =>
                          dependency.dependentItemId === item.id && dependency.dependencyItemId === task.id,
                      ),
                  )
                  .map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {isMemoryType && (
            <div className="space-y-3 rounded-md border border-border/70 bg-background/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Dedup detection</p>
                  <p className="text-xs text-muted-foreground">
                    {loadingSimilar
                      ? "Checking memory for similar items..."
                      : similarItems && similarItems.length > 0
                        ? `${similarItems.length} similar item${similarItems.length === 1 ? "" : "s"} found`
                        : "No similar memory items found"}
                  </p>
                </div>
                {similarItems && similarItems.length > 0 && (
                  <select
                    value={item.dedupAction ?? "create_separate"}
                    onChange={(e) => onUpdate(item.id, { dedupAction: e.target.value })}
                    className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                  >
                    {DEDUP_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {similarItems && similarItems.length > 0 && (
                <>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Matching item
                    <select
                      value={item.selectedMemoryId ?? (similarItems.length === 1 ? similarItems[0].id : "")}
                      onChange={(e) => onUpdate(item.id, { selectedMemoryId: e.target.value || null })}
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                    >
                      <option value="">Select existing memory</option>
                      {similarItems.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.title}
                          {candidate.similarity != null ? ` (${Math.round(candidate.similarity * 100)}%)` : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedSimilarItem && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <ComparisonPanel
                        title={selectedSimilarItem.title}
                        subtitle={`Existing • ${humanLayer(selectedSimilarItem.layer)} • ${selectedSimilarItem.departmentId ?? "No department"}`}
                        content={selectedSimilarItem.content}
                        compareTo={effectiveContent}
                      />
                      <ComparisonPanel
                        title={item.title}
                        subtitle={`New brief item • ${humanLayer(effectiveLayer)} • ${item.suggestedDepartmentId ?? "No department"}`}
                        content={effectiveContent}
                        compareTo={selectedSimilarItem.content}
                      />
                    </div>
                  )}

                  {selectedSimilarItem && (item.dedupAction ?? "create_separate") === "update_existing" && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Merged content</label>
                      <Textarea
                        value={mergedDraft || mergedPreview}
                        onChange={(e) => setMergedDraft(e.target.value)}
                        onBlur={() => onUpdate(item.id, { mergedContent: mergedDraft || mergedPreview })}
                        className="min-h-[140px] resize-y text-sm"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
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

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const sourceIssueId = useMemo(
    () => (debrief?.sourceInfo as Record<string, unknown> | null)?.issueId as string | undefined,
    [debrief],
  );

  const { data: detectedOutputs } = useQuery({
    queryKey: queryKeys.detectedOutputs.byIssue(sourceIssueId!),
    queryFn: () => outputDetectionApi.listForIssue(sourceIssueId!),
    enabled: !!sourceIssueId,
  });

  const pendingOutputs = useMemo(
    () => (detectedOutputs ?? []).filter((output) => output.status === "pending"),
    [detectedOutputs],
  );

  const departments = useMemo(
    () => projects?.filter((project) => project.type === "department").map((project) => ({ id: project.id, name: project.name })) ?? [],
    [projects],
  );

  const taskItems = useMemo(() => brief?.items.filter((item) => item.type === "task") ?? [], [brief]);

  const grouped = useMemo(() => {
    if (!brief) return {};
    const groups: Record<string, BriefItem[]> = {};
    for (const item of brief.items) {
      if (!groups[item.type]) groups[item.type] = [];
      groups[item.type].push(item);
    }
    return groups;
  }, [brief]);

  const isProcessed =
    brief?.status === "approved" || brief?.status === "rejected" || brief?.status === "partially_approved";
  const pendingCount = brief?.items.filter((item) => item.status === "pending").length ?? 0;
  const hasActionedItems =
    brief?.items.some((item) => item.status === "approved" || item.status === "edited" || item.status === "rejected") ?? false;
  const hasActiveContextWithoutGoal =
    brief?.items.some(
      (item) =>
        MEMORY_TYPES.has(item.type) &&
        (item.layer ?? item.suggestedLayer ?? "domain") === "active_context" &&
        item.status !== "rejected",
    ) && !brief.goalId;

  const updateBriefMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => briefsApi.update(selectedCompanyId!, briefId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.briefs.detail(selectedCompanyId!, briefId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.briefs.list(selectedCompanyId!) });
    },
    onError: () => pushToast({ title: "Failed to update brief", tone: "warn" }),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: Record<string, unknown> }) =>
      briefsApi.updateItem(selectedCompanyId!, briefId!, itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.briefs.detail(selectedCompanyId!, briefId!) });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.briefs.detail(selectedCompanyId!, briefId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.briefs.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.list(selectedCompanyId!) });
      pushToast({ title: "Brief processed successfully", tone: "success" });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to process brief";
      pushToast({ title: message, tone: "warn" });
    },
  });

  const confirmOutput = useMutation({
    mutationFn: (data: { runId: string; index: number; payload: { title?: string; type?: string; changelog?: string | null } }) =>
      outputDetectionApi.confirm(data.runId, data.index, data.payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.detectedOutputs.byIssue(sourceIssueId!) });
      pushToast({ title: "Output confirmed as artifact" });
    },
    onError: () => pushToast({ title: "Failed to confirm output", tone: "warn" }),
  });

  const dismissOutput = useMutation({
    mutationFn: (data: { runId: string; index: number }) => outputDetectionApi.dismiss(data.runId, data.index),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.detectedOutputs.byIssue(sourceIssueId!) });
    },
    onError: () => pushToast({ title: "Failed to dismiss output", tone: "warn" }),
  });

  function detectCycles(deps: Array<{ dependentItemId: string; dependencyItemId: string }>): boolean {
    const graph = new Map<string, string[]>();
    for (const dependency of deps) {
      const edges = graph.get(dependency.dependentItemId) ?? [];
      edges.push(dependency.dependencyItemId);
      graph.set(dependency.dependentItemId, edges);
    }

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

  function addDependency(dependentItemId: string, dependencyItemId: string) {
    if (dependentItemId === dependencyItemId) return;
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
        (dependency) =>
          !(dependency.dependentItemId === dependentItemId && dependency.dependencyItemId === dependencyItemId),
      ),
    );
  }

  function handleUpdateItem(itemId: string, data: Record<string, unknown>) {
    updateItemMutation.mutate({ itemId, data });
  }

  function handleBulkAction(status: "approved" | "rejected") {
    if (!brief) return;
    for (const item of brief.items.filter((candidate) => candidate.status === "pending")) {
      updateItemMutation.mutate({ itemId: item.id, data: { status } });
    }
    setSelectedItems(new Set());
  }

  function handleApproveSelected() {
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
    const pendingIds = brief.items.filter((item) => item.status === "pending").map((item) => item.id);
    const allSelected = pendingIds.length > 0 && pendingIds.every((id) => selectedItems.has(id));
    setSelectedItems(allSelected ? new Set() : new Set(pendingIds));
  }

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
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{debrief?.title ?? "Untitled Debrief"}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {debrief?.inputType && (
              <Badge variant="outline" className="text-[10px]">
                {debrief.inputType}
              </Badge>
            )}
            <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium", STATUS_BADGES[brief.status] ?? "bg-muted text-muted-foreground")}>
              {brief.status.replace("_", " ")}
            </span>
            <span>{new Date(brief.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card/60 p-4 md:grid-cols-[1fr_260px]">
        <div>
          <p className="text-sm font-medium">Goal propagation</p>
          <p className="text-xs text-muted-foreground">
            Active context items inherit the selected goal. Working items inherit the source task when this brief came from a task-scoped debrief.
          </p>
        </div>
        <select
          value={brief.goalId ?? ""}
          onChange={(e) => updateBriefMutation.mutate({ goalId: e.target.value || null })}
          className="h-10 rounded-md border border-input bg-background px-3 py-1 text-sm"
        >
          <option value="">No goal</option>
          {(goals ?? []).map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.title}
            </option>
          ))}
        </select>
      </div>

      {hasActiveContextWithoutGoal && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-sm font-medium">Active context items are missing a goal</p>
            <p className="text-sm">These items will be created without `goalId` unless you select a goal above.</p>
          </div>
        </div>
      )}

      {approveResult && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">Brief processed successfully</p>
          <p className="mt-1 text-sm text-green-700">
            Created {approveResult.taskCount} task{approveResult.taskCount !== 1 ? "s" : ""} and {approveResult.memoryCount} memory item{approveResult.memoryCount !== 1 ? "s" : ""}.
          </p>
          {approveResult.createdDependencyCount > 0 && (
            <p className="mt-1 text-sm text-green-700">
              Added {approveResult.createdDependencyCount} task dependenc{approveResult.createdDependencyCount === 1 ? "y" : "ies"}.
            </p>
          )}
          {approveResult.skippedDependencyCount > 0 && (
            <p className="mt-1 text-sm text-amber-700">
              Skipped {approveResult.skippedDependencyCount} dependency link{approveResult.skippedDependencyCount === 1 ? "" : "s"} because one or both items were not created.
            </p>
          )}
        </div>
      )}

      {debrief?.rawContent && (
        <div className="rounded-lg border border-border">
          <button
            onClick={() => setRawContentOpen((open) => !open)}
            className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-accent/50"
          >
            {rawContentOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Original Content
          </button>
          {rawContentOpen && (
            <div className="border-t border-border px-4 py-3">
              <pre className="max-h-[300px] overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                {debrief.rawContent}
              </pre>
            </div>
          )}
        </div>
      )}

      {!isProcessed && pendingCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 p-3">
          <Button variant="outline" size="sm" onClick={toggleSelectAll} className="text-xs">
            <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
            {selectedItems.size > 0 && selectedItems.size === pendingCount ? "Deselect All" : "Select All"}
          </Button>
          <div className="h-4 w-px bg-border" />
          <Button variant="outline" size="sm" onClick={() => handleBulkAction("approved")}>
            <CheckCheck className="mr-1.5 h-4 w-4" />
            Approve All ({pendingCount})
          </Button>
          {selectedItems.size > 0 && (
            <Button size="sm" onClick={handleApproveSelected} className="bg-green-600 text-white hover:bg-green-700">
              <Check className="mr-1.5 h-4 w-4" />
              Approve Selected ({selectedItems.size})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => handleBulkAction("rejected")}>
            <XCircle className="mr-1.5 h-4 w-4" />
            Reject All
          </Button>
        </div>
      )}

      {TYPE_ORDER.map((type) => {
        const items = grouped[type];
        if (!items?.length) return null;
        return (
          <div key={type} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {TYPE_LABELS[type]} ({items.length})
            </h2>
            <div className="space-y-3">
              {items.map((item) => (
                <BriefItemCard
                  key={item.id}
                  item={item}
                  briefGoalId={brief.goalId}
                  sourceTaskId={sourceIssueId ?? null}
                  departments={departments}
                  onUpdate={handleUpdateItem}
                  taskItems={item.type === "task" ? taskItems : undefined}
                  dependencies={item.type === "task" ? dependencies : undefined}
                  onAddDependency={item.type === "task" ? addDependency : undefined}
                  onRemoveDependency={item.type === "task" ? removeDependency : undefined}
                  selected={selectedItems.has(item.id)}
                  onToggleSelect={!isProcessed ? toggleSelectItem : undefined}
                  companyId={selectedCompanyId!}
                />
              ))}
            </div>
          </div>
        );
      })}

      {pendingOutputs.length > 0 && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <FileCode className="h-4 w-4" />
            Detected Files ({pendingOutputs.length})
          </h2>
          <div className="space-y-2">
            {pendingOutputs.map((output) => (
              <div key={`${output.runId}-${output.path}`} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2 text-sm">
                  <FileCode className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{output.filename}</span>
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground">{output.path}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={confirmOutput.isPending}
                    onClick={() =>
                      confirmOutput.mutate({
                        runId: output.runId,
                        index: output.outputIndex,
                        payload: {
                          title: output.filename,
                          type: output.artifactType ?? "other",
                          changelog: `Agent output: ${output.filename}`,
                        },
                      })}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Create Artifact
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={dismissOutput.isPending}
                    onClick={() => dismissOutput.mutate({ runId: output.runId, index: output.outputIndex })}
                  >
                    <XCircle className="mr-1 h-3.5 w-3.5" />
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isProcessed && hasActionedItems && (
        <div className="space-y-2 border-t border-border pt-4">
          {pendingCount > 0 && (
            <p className="text-xs text-amber-600">
              {pendingCount} item{pendingCount !== 1 ? "s" : ""} still pending. They will be skipped during processing.
            </p>
          )}
          {dependencies.length > 0 && (
            <p className="text-xs text-blue-600">
              {dependencies.length} task dependenc{dependencies.length === 1 ? "y" : "ies"} configured.
            </p>
          )}
          <div className="flex justify-end">
            <Button
              onClick={() => {
                if (dependencies.length > 0 && detectCycles(dependencies)) {
                  pushToast({ title: "Circular dependency detected. Remove the cycle before processing.", tone: "warn" });
                  return;
                }
                approveMutation.mutate();
              }}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Process Brief
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
