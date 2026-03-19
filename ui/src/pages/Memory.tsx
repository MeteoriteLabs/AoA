import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Filter,
} from "lucide-react";
import {
  MEMORY_ITEM_CATEGORIES,
  MEMORY_ITEM_STATUSES,
  type MemoryItemCategory,
  type MemoryItemStatus,
  type MemoryItem,
  type Project,
} from "@paperclipai/shared";
import { memoryApi } from "../api/memory";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<MemoryItemCategory, string> = {
  decision: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  reference: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  context: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  insight: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  preference: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
};

const STATUS_COLORS: Record<MemoryItemStatus, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  archived: "bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function Memory() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { setSubtitle, setEntityColor } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Memory" }]);
    setEntityColor("var(--entity-memory)");
    return () => { setSubtitle(null); setEntityColor(null); };
  }, [setBreadcrumbs, setSubtitle, setEntityColor]);

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (categoryFilter !== "all") f.category = categoryFilter;
    if (statusFilter !== "all") f.status = statusFilter;
    if (departmentFilter !== "all") f.departmentId = departmentFilter;
    if (search.trim()) f.search = search.trim();
    return f;
  }, [categoryFilter, statusFilter, departmentFilter, search]);

  const { data: items, isLoading } = useQuery({
    queryKey: [...queryKeys.memory.list(selectedCompanyId!), filters],
    queryFn: () => memoryApi.list(selectedCompanyId!, filters),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const departments = useMemo(
    () => (projects ?? []).filter((p: Project) => p.type === "department"),
    [projects],
  );

  // Compute subtitle counts
  useEffect(() => {
    if (!items) return;
    const total = items.length;
    const pending = items.filter((i: MemoryItem) => i.status === "pending").length;
    const parts: string[] = [];
    if (total > 0) parts.push(`${total} items`);
    if (pending > 0) parts.push(`${pending} pending`);
    setSubtitle(parts.length > 0 ? parts.join(" \u00B7 ") : null);
  }, [items, setSubtitle]);

  const approveMutation = useMutation({
    mutationFn: (id: string) => memoryApi.approve(selectedCompanyId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.memory.list(selectedCompanyId!) }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => memoryApi.reject(selectedCompanyId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.memory.list(selectedCompanyId!) }),
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Brain} message="Select a company to view memory." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const sorted = [...(items ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const pendingCount = (items ?? []).filter((i) => i.status === "pending").length;

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search memory..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add to Memory
        </Button>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-7 w-[130px] text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {MEMORY_ITEM_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c} className="capitalize">
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-7 w-[120px] text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {MEMORY_ITEM_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="h-7 w-[150px] text-xs">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d: Project) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {pendingCount > 0 && (
          <Button
            size="sm"
            variant={statusFilter === "pending" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() =>
              setStatusFilter(statusFilter === "pending" ? "all" : "pending")
            }
          >
            Pending ({pendingCount})
          </Button>
        )}
      </div>

      {/* Items list */}
      {sorted.length === 0 ? (
        <EmptyState
          icon={Brain}
          message="No memory items found"
          description="Memory stores decisions, references, and context that your agents use to produce better work."
          action="Add to Memory"
          onAction={() => setCreateOpen(true)}
          entityColor="var(--entity-memory)"
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((item) => (
            <MemoryCard
              key={item.id}
              item={item}
              departments={departments}
              expanded={expandedId === item.id}
              onToggle={() =>
                setExpandedId(expandedId === item.id ? null : item.id)
              }
              onApprove={() => approveMutation.mutate(item.id)}
              onReject={() => rejectMutation.mutate(item.id)}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CreateMemoryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        companyId={selectedCompanyId}
        departments={departments}
      />
    </div>
  );
}

function MemoryCard({
  item,
  departments,
  expanded,
  onToggle,
  onApprove,
  onReject,
}: {
  item: MemoryItem;
  departments: Project[];
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const dept = item.departmentId
    ? departments.find((d) => d.id === item.departmentId)
    : null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-start gap-3 p-3 text-left hover:bg-accent/30 transition-colors"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{item.title}</span>
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] px-1.5 py-0 capitalize",
                CATEGORY_COLORS[item.category],
              )}
            >
              {item.category}
            </Badge>
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] px-1.5 py-0 capitalize",
                STATUS_COLORS[item.status],
              )}
            >
              {item.status}
            </Badge>
          </div>

          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
            <span className="capitalize">{item.source}</span>
            {dept && (
              <>
                <span>&middot;</span>
                <span>{dept.name}</span>
              </>
            )}
            <span>&middot;</span>
            <span>{formatDate(item.createdAt)}</span>
          </div>

          {item.tags && item.tags.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {item.status === "pending" && (
          <div
            className="flex items-center gap-1 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
              onClick={onApprove}
              title="Approve"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30"
              onClick={onReject}
              title="Reject"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pl-10">
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {item.content}
          </p>
        </div>
      )}
    </div>
  );
}

function CreateMemoryDialog({
  open,
  onOpenChange,
  companyId,
  departments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  departments: Project[];
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>("reference");
  const [tagsInput, setTagsInput] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("none");

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      memoryApi.create(companyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.list(companyId) });
      onOpenChange(false);
      setTitle("");
      setContent("");
      setCategory("reference");
      setTagsInput("");
      setDepartmentId("none");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    createMutation.mutate({
      title: title.trim(),
      content: content.trim(),
      category,
      source: "founder",
      status: "approved",
      tags,
      departmentId: departmentId !== "none" ? departmentId : null,
      createdBy: "founder",
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Memory</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mem-title">Title</Label>
            <Input
              id="mem-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Memory item title"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mem-content">Content</Label>
            <Textarea
              id="mem-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Describe the knowledge..."
              rows={4}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMORY_ITEM_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mem-tags">Tags (comma-separated)</Label>
            <Input
              id="mem-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. frontend, design, api"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (company-wide)</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || !content.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
