import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "@/lib/router";
import {
  Brain,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Filter,
  Layers,
  List,
  History,
  Clock,
  AlertTriangle,
  FileEdit,
  Send,
  RotateCcw,
  Eye,
  Pencil,
} from "lucide-react";
import {
  MEMORY_ITEM_CATEGORIES,
  MEMORY_ITEM_STATUSES,
  MEMORY_ITEM_LAYERS,
  MEMORY_ITEM_VISIBILITY,
  type MemoryItemCategory,
  type MemoryItemStatus,
  type MemoryItemLayer,
  type MemoryItemVisibility,
  type MemoryItem,
  type MemoryItemVersion,
  type Project,
  type Goal,
  type Issue,
} from "@paperclipai/shared";
import { memoryApi } from "../api/memory";
import { projectsApi } from "../api/projects";
import { goalsApi } from "../api/goals";
import { issuesApi } from "../api/issues";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ── Constants ──────────────────────────────────────────────────────────

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
  draft: "bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
};

const LAYER_COLORS: Record<MemoryItemLayer, string> = {
  identity: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  domain: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  active_context: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  working: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

const LAYER_LABELS: Record<MemoryItemLayer, string> = {
  identity: "Identity",
  domain: "Domain",
  active_context: "Active Context",
  working: "Working",
};

const LAYER_DESCRIPTIONS: Record<MemoryItemLayer, string> = {
  identity: "Permanent company knowledge — vision, mission, values",
  domain: "Department-scoped, semi-permanent knowledge",
  active_context: "Goal/project-scoped, temporary with expiration",
  working: "Task-chain-scoped, ephemeral (auto-archives after 7 days)",
};

const STALENESS_THRESHOLD_DAYS = 90;

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysSince(date: Date | string) {
  const diff = Date.now() - new Date(date).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function estimateTokens(content: string) {
  return Math.ceil(content.length / 4);
}

function isStale(item: MemoryItem): boolean {
  const checkDate = item.accessedAt ?? item.updatedAt;
  return daysSince(checkDate) >= STALENESS_THRESHOLD_DAYS;
}

// ── Main Component ─────────────────────────────────────────────────────

export function Memory() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs, setSubtitle, setEntityColor } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [layerFilter, setLayerFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"layer" | "flat">("layer");
  const [activeTab, setActiveTab] = useState<string>(searchParams.get("tab") ?? "all");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    searchParams.get("item") ?? searchParams.get("selected"),
  );
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Memory" }]);
    setEntityColor("var(--entity-memory)");
    return () => { setSubtitle(null); setEntityColor(null); };
  }, [setBreadcrumbs, setSubtitle, setEntityColor]);

  useEffect(() => {
    setActiveTab(searchParams.get("tab") ?? "all");
    setSelectedItemId(searchParams.get("item") ?? searchParams.get("selected"));
    const searchParam = searchParams.get("q");
    if (searchParam !== null) {
      setSearch(searchParam);
    }
  }, [searchParams]);

  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (categoryFilter !== "all") f.category = categoryFilter;
    if (statusFilter !== "all") f.status = statusFilter;
    if (departmentFilter !== "all") f.departmentId = departmentFilter;
    if (layerFilter !== "all") f.layer = layerFilter;
    if (search.trim()) f.search = search.trim();
    return f;
  }, [categoryFilter, statusFilter, departmentFilter, layerFilter, search]);

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
  const agentPendingCount = (items ?? []).filter(
    (i) => i.status === "pending" && i.source === "agent",
  ).length;

  // Items for the suggestions tab
  const agentPendingItems = sorted.filter(
    (i) => i.status === "pending" && i.source === "agent",
  );

  // Items for the "all" tab (excluding agent pending if on suggestions tab)
  const allItems = activeTab === "suggestions" ? [] : sorted;

  return (
    <div className="space-y-4">
      {/* Search bar + view mode toggle */}
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

        {/* View mode toggle */}
        <div className="flex items-center rounded-md border border-border">
          <Button
            size="sm"
            variant={viewMode === "layer" ? "default" : "ghost"}
            className="h-7 rounded-r-none text-xs gap-1"
            onClick={() => setViewMode("layer")}
          >
            <Layers className="h-3.5 w-3.5" />
            By Layer
          </Button>
          <Button
            size="sm"
            variant={viewMode === "flat" ? "default" : "ghost"}
            className="h-7 rounded-l-none text-xs gap-1"
            onClick={() => setViewMode("flat")}
          >
            <List className="h-3.5 w-3.5" />
            Flat
          </Button>
        </div>

        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add to Memory
        </Button>
      </div>

      {/* Tabs: All / Agent Suggestions */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="suggestions">
            Agent Suggestions
            {agentPendingCount > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                {agentPendingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          {/* Filter row */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
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

            <Select value={layerFilter} onValueChange={setLayerFilter}>
              <SelectTrigger className="h-7 w-[150px] text-xs">
                <SelectValue placeholder="Layer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All layers</SelectItem>
                {MEMORY_ITEM_LAYERS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LAYER_LABELS[l]}
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
          {allItems.length === 0 ? (
            <EmptyState
              icon={Brain}
              message="No memory items found"
              description="Memory stores decisions, references, and context that your agents use to produce better work."
              action="Add to Memory"
              onAction={() => setCreateOpen(true)}
              entityColor="var(--entity-memory)"
            />
          ) : viewMode === "layer" ? (
            <LayerView
              items={allItems}
              departments={departments}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
              onApprove={(id) => approveMutation.mutate(id)}
              onReject={(id) => rejectMutation.mutate(id)}
            />
          ) : (
            <FlatView
              items={allItems}
              departments={departments}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
              onApprove={(id) => approveMutation.mutate(id)}
              onReject={(id) => rejectMutation.mutate(id)}
            />
          )}
        </TabsContent>

        <TabsContent value="suggestions" className="mt-4">
          <SuggestionQueue
            items={agentPendingItems}
            departments={departments}
            companyId={selectedCompanyId}
            onApprove={(id) => approveMutation.mutate(id)}
            onReject={(id) => rejectMutation.mutate(id)}
          />
        </TabsContent>
      </Tabs>

      {/* Detail panel */}
      {selectedItemId && (
        <MemoryDetailPanel
          companyId={selectedCompanyId}
          itemId={selectedItemId}
          departments={departments}
          onClose={() => setSelectedItemId(null)}
        />
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

// ── Layer View ─────────────────────────────────────────────────────────

function LayerView({
  items,
  departments,
  selectedItemId,
  onSelectItem,
  onApprove,
  onReject,
}: {
  items: MemoryItem[];
  departments: Project[];
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const map: Record<string, MemoryItem[]> = {
      identity: [],
      domain: [],
      active_context: [],
      working: [],
      unassigned: [],
    };
    for (const item of items) {
      const layer = item.layer ?? "unassigned";
      if (map[layer]) {
        map[layer].push(item);
      } else {
        map.unassigned.push(item);
      }
    }
    return map;
  }, [items]);

  return (
    <div className="space-y-3">
      {MEMORY_ITEM_LAYERS.map((layer) => (
        <LayerSection
          key={layer}
          layer={layer}
          items={grouped[layer]}
          departments={departments}
          selectedItemId={selectedItemId}
          onSelectItem={onSelectItem}
          onApprove={onApprove}
          onReject={onReject}
        />
      ))}
      {grouped.unassigned.length > 0 && (
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Unassigned Layer</span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {grouped.unassigned.length}
              </Badge>
            </div>
          </div>
          <div className="p-2 space-y-1.5">
            {grouped.unassigned.map((item) => (
              <MemoryCard
                key={item.id}
                item={item}
                departments={departments}
                selected={selectedItemId === item.id}
                onSelect={() => onSelectItem(selectedItemId === item.id ? null : item.id)}
                onApprove={() => onApprove(item.id)}
                onReject={() => onReject(item.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LayerSection({
  layer,
  items,
  departments,
  selectedItemId,
  onSelectItem,
  onApprove,
  onReject,
}: {
  layer: MemoryItemLayer;
  items: MemoryItem[];
  departments: Project[];
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const totalTokens = useMemo(
    () => items.reduce((sum, i) => sum + estimateTokens(i.content), 0),
    [items],
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              {open ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <Badge
                variant="secondary"
                className={cn("text-[10px] px-1.5 py-0", LAYER_COLORS[layer])}
              >
                {LAYER_LABELS[layer]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ~{totalTokens.toLocaleString()} tokens
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{LAYER_DESCRIPTIONS[layer]}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {items.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No items in this layer
            </div>
          ) : (
            <div className="p-2 space-y-1.5">
              {items.map((item) => (
                <MemoryCard
                  key={item.id}
                  item={item}
                  departments={departments}
                  selected={selectedItemId === item.id}
                  onSelect={() => onSelectItem(selectedItemId === item.id ? null : item.id)}
                  onApprove={() => onApprove(item.id)}
                  onReject={() => onReject(item.id)}
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ── Flat View ──────────────────────────────────────────────────────────

function FlatView({
  items,
  departments,
  selectedItemId,
  onSelectItem,
  onApprove,
  onReject,
}: {
  items: MemoryItem[];
  departments: Project[];
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <MemoryCard
          key={item.id}
          item={item}
          departments={departments}
          selected={selectedItemId === item.id}
          onSelect={() => onSelectItem(selectedItemId === item.id ? null : item.id)}
          onApprove={() => onApprove(item.id)}
          onReject={() => onReject(item.id)}
          showLayer
        />
      ))}
    </div>
  );
}

// ── Memory Card ────────────────────────────────────────────────────────

function MemoryCard({
  item,
  departments,
  selected,
  onSelect,
  onApprove,
  onReject,
  showLayer,
}: {
  item: MemoryItem;
  departments: Project[];
  selected: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
  showLayer?: boolean;
}) {
  const dept = item.departmentId
    ? departments.find((d) => d.id === item.departmentId)
    : null;

  const stale = isStale(item);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card",
        selected && "ring-2 ring-primary/30 border-primary/50",
      )}
    >
      <button
        type="button"
        className="flex w-full items-start gap-3 p-3 text-left hover:bg-accent/30 transition-colors"
        onClick={onSelect}
      >
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
            {showLayer && item.layer && (
              <Badge
                variant="secondary"
                className={cn("text-[10px] px-1.5 py-0", LAYER_COLORS[item.layer])}
              >
                {LAYER_LABELS[item.layer]}
              </Badge>
            )}
            {item.currentVersionId && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
                <History className="h-2.5 w-2.5" />
                versioned
              </Badge>
            )}
            {stale && item.status === "approved" && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 gap-0.5">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      stale
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Not accessed in {daysSince(item.accessedAt ?? item.updatedAt)} days. Still relevant?</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
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
            {item.visibility === "shared" && (
              <>
                <span>&middot;</span>
                <span className="text-blue-600 dark:text-blue-400">Shared</span>
              </>
            )}
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
    </div>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────

function MemoryDetailPanel({
  companyId,
  itemId,
  departments,
  onClose,
}: {
  companyId: string;
  itemId: string;
  departments: Project[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [activeDetailTab, setActiveDetailTab] = useState<string>("content");
  const [draftContent, setDraftContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const { data: item } = useQuery({
    queryKey: queryKeys.memory.detail(companyId, itemId),
    queryFn: () => memoryApi.get(companyId, itemId),
  });

  const { data: versions } = useQuery({
    queryKey: queryKeys.memory.versions(companyId, itemId),
    queryFn: () => memoryApi.getVersions(companyId, itemId),
  });

  const saveDraftMutation = useMutation({
    mutationFn: (content: string) => memoryApi.saveDraft(companyId, itemId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.versions(companyId, itemId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.detail(companyId, itemId) });
      setIsEditing(false);
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => memoryApi.publishDraft(companyId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.versions(companyId, itemId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.detail(companyId, itemId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.list(companyId) });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: () => memoryApi.restore(companyId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.detail(companyId, itemId) });
    },
  });

  const touchMutation = useMutation({
    mutationFn: () => memoryApi.touchAccessedAt(companyId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.list(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.detail(companyId, itemId) });
    },
  });

  if (!item) return null;

  const dept = item.departmentId
    ? departments.find((d) => d.id === item.departmentId)
    : null;

  const stale = isStale(item);
  const hasDraft = versions?.some((v) => v.status === "draft");
  const hasPendingAgentVersion = versions?.some(
    (v) => v.status === "draft" && v.createdBy !== "founder",
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <DialogTitle className="text-base">{item.title}</DialogTitle>
            {item.layer && (
              <Badge
                variant="secondary"
                className={cn("text-[10px] px-1.5 py-0", LAYER_COLORS[item.layer])}
              >
                {LAYER_LABELS[item.layer]}
              </Badge>
            )}
            <Badge
              variant="secondary"
              className={cn("text-[10px] px-1.5 py-0 capitalize", STATUS_COLORS[item.status])}
            >
              {item.status}
            </Badge>
            {hasDraft && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 gap-0.5">
                <FileEdit className="h-2.5 w-2.5" />
                draft
              </Badge>
            )}
            {stale && item.status === "approved" && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 gap-0.5">
                <AlertTriangle className="h-2.5 w-2.5" />
                stale ({daysSince(item.accessedAt ?? item.updatedAt)}d)
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* Metadata */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="capitalize">Source: {item.source}</span>
          {dept && <span>Dept: {dept.name}</span>}
          <span>Created: {formatDate(item.createdAt)}</span>
          {item.accessedAt && <span>Last accessed: {formatDate(item.accessedAt)}</span>}
          {item.priority > 0 && <span>Priority: {item.priority}</span>}
          <span>Visibility: {item.visibility}</span>
        </div>

        {/* Staleness action */}
        {stale && item.status === "approved" && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-xs text-amber-800 dark:text-amber-300">
              Not accessed in {daysSince(item.accessedAt ?? item.updatedAt)} days.
            </span>
            <div className="flex gap-1 ml-auto">
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs"
                onClick={() => touchMutation.mutate()}
              >
                Still Relevant
              </Button>
            </div>
          </div>
        )}

        {/* Restore button for archived items */}
        {item.status === "archived" && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800">
            <RotateCcw className="h-4 w-4 text-gray-600 shrink-0" />
            <span className="text-xs text-gray-800 dark:text-gray-300">
              This item is archived.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs ml-auto"
              onClick={() => restoreMutation.mutate()}
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending ? "Restoring..." : "Restore"}
            </Button>
          </div>
        )}

        {/* Source context */}
        {item.sourceContext && (
          <div className="text-xs text-muted-foreground p-2 rounded-md bg-muted/30 border border-border">
            <span className="font-medium">Context:</span> {item.sourceContext}
          </div>
        )}

        {/* Tabs: Content / Version History */}
        <Tabs value={activeDetailTab} onValueChange={setActiveDetailTab}>
          <TabsList variant="line">
            <TabsTrigger value="content">
              <Eye className="h-3.5 w-3.5 mr-1" />
              Content
            </TabsTrigger>
            <TabsTrigger value="versions">
              <History className="h-3.5 w-3.5 mr-1" />
              Versions
              {versions && versions.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">
                  {versions.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="content" className="mt-3">
            {isEditing ? (
              <div className="space-y-2">
                {hasPendingAgentVersion && (
                  <div className="flex items-center gap-2 p-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span className="text-xs text-amber-800 dark:text-amber-300">
                      An agent has a pending version for this item.
                    </span>
                  </div>
                )}
                <Textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  rows={8}
                  className="text-sm"
                />
                <div className="flex items-center gap-2 justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsEditing(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveDraftMutation.mutate(draftContent)}
                    disabled={saveDraftMutation.isPending}
                  >
                    <FileEdit className="h-3.5 w-3.5 mr-1" />
                    {saveDraftMutation.isPending ? "Saving..." : "Save Draft"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      saveDraftMutation.mutate(draftContent, {
                        onSuccess: () => publishMutation.mutate(),
                      });
                    }}
                    disabled={saveDraftMutation.isPending || publishMutation.isPending}
                  >
                    <Send className="h-3.5 w-3.5 mr-1" />
                    {publishMutation.isPending ? "Publishing..." : "Save & Publish"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {item.content}
                </p>
                <div className="flex items-center gap-2 justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDraftContent(item.content);
                      setIsEditing(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                  {hasDraft && (
                    <Button
                      size="sm"
                      onClick={() => publishMutation.mutate()}
                      disabled={publishMutation.isPending}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />
                      {publishMutation.isPending ? "Publishing..." : "Publish Draft"}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="versions" className="mt-3">
            {!versions || versions.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-4">
                No version history yet. Edit and save a draft to create versions.
              </div>
            ) : (
              <div className="space-y-2">
                {versions.map((version, idx) => (
                  <VersionCard
                    key={version.id}
                    version={version}
                    isCurrent={version.id === item.currentVersionId}
                    previousContent={idx < versions.length - 1 ? versions[idx + 1].content : null}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── Version Card ───────────────────────────────────────────────────────

function VersionCard({
  version,
  isCurrent,
  previousContent,
}: {
  version: MemoryItemVersion;
  isCurrent: boolean;
  previousContent: string | null;
}) {
  const [showDiff, setShowDiff] = useState(false);

  const statusColor =
    version.status === "approved"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
      : version.status === "draft"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
        : "bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300";

  return (
    <div
      className={cn(
        "rounded-md border border-border p-2.5",
        isCurrent && "border-primary/50 bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">v{version.versionNumber}</span>
          <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0", statusColor)}>
            {version.status}
          </Badge>
          {isCurrent && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              current
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            by {version.createdBy}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {formatDate(version.createdAt)}
          </span>
          {previousContent && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => setShowDiff(!showDiff)}
            >
              {showDiff ? "Hide diff" : "Show diff"}
            </Button>
          )}
        </div>
      </div>
      {showDiff && previousContent && (
        <div className="mt-2 space-y-1">
          <SimpleDiff oldText={previousContent} newText={version.content} />
        </div>
      )}
    </div>
  );
}

// ── Simple Diff ────────────────────────────────────────────────────────

function SimpleDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const maxLen = Math.max(oldLines.length, newLines.length);

  const diffs: { type: "same" | "removed" | "added"; text: string }[] = [];

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      if (oldLine !== undefined) diffs.push({ type: "same", text: oldLine });
    } else {
      if (oldLine !== undefined) diffs.push({ type: "removed", text: oldLine });
      if (newLine !== undefined) diffs.push({ type: "added", text: newLine });
    }
  }

  return (
    <div className="text-xs font-mono rounded border border-border overflow-hidden">
      {diffs.map((d, i) => (
        <div
          key={i}
          className={cn(
            "px-2 py-0.5",
            d.type === "removed" && "bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300",
            d.type === "added" && "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300",
          )}
        >
          <span className="select-none mr-2 text-muted-foreground">
            {d.type === "removed" ? "-" : d.type === "added" ? "+" : " "}
          </span>
          {d.text || "\u00A0"}
        </div>
      ))}
    </div>
  );
}

// ── Suggestion Queue ───────────────────────────────────────────────────

function SuggestionQueue({
  items,
  departments,
  companyId,
  onApprove,
  onReject,
}: {
  items: MemoryItem[];
  departments: Project[];
  companyId: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");

  const updateAndApproveMutation = useMutation({
    mutationFn: async ({ id, title, content }: { id: string; title: string; content: string }) => {
      await memoryApi.update(companyId, id, { title, content });
      return memoryApi.approve(companyId, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.list(companyId) });
      setEditingId(null);
    },
  });

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Brain}
        message="No agent suggestions"
        description="When agents suggest memory items, they'll appear here for your review."
        entityColor="var(--entity-memory)"
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {items.length} pending {items.length === 1 ? "suggestion" : "suggestions"} from agents
      </p>
      {items.map((item) => {
        const dept = item.departmentId
          ? departments.find((d) => d.id === item.departmentId)
          : null;

        const isEditingThis = editingId === item.id;

        return (
          <div key={item.id} className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{item.title}</span>
                  <Badge
                    variant="secondary"
                    className={cn("text-[10px] px-1.5 py-0 capitalize", CATEGORY_COLORS[item.category])}
                  >
                    {item.category}
                  </Badge>
                  {item.layer && (
                    <Badge
                      variant="secondary"
                      className={cn("text-[10px] px-1.5 py-0", LAYER_COLORS[item.layer])}
                    >
                      {LAYER_LABELS[item.layer]}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground capitalize">
                  by {item.createdBy}
                </span>
              </div>

              {item.sourceContext && (
                <div className="text-xs text-muted-foreground p-2 rounded bg-white/50 dark:bg-black/10 border border-amber-100 dark:border-amber-900">
                  <span className="font-medium">Agent reasoning:</span> {item.sourceContext}
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
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

              {isEditingThis ? (
                <div className="space-y-2">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="text-sm"
                    placeholder="Title"
                  />
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={4}
                    className="text-sm"
                  />
                  <div className="flex items-center gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        updateAndApproveMutation.mutate({
                          id: item.id,
                          title: editTitle,
                          content: editContent,
                        })
                      }
                      disabled={updateAndApproveMutation.isPending}
                    >
                      {updateAndApproveMutation.isPending ? "Saving..." : "Save & Approve"}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {item.content}
                </p>
              )}

              {/* Actions */}
              {!isEditingThis && (
                <div className="flex items-center gap-2 justify-end pt-1 border-t border-amber-100 dark:border-amber-900">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 h-7 text-xs"
                    onClick={() => onReject(item.id)}
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      setEditingId(item.id);
                      setEditTitle(item.title);
                      setEditContent(item.content);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit & Approve
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onApprove(item.id)}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Approve
                  </Button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Create Memory Dialog ───────────────────────────────────────────────

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
  const [layer, setLayer] = useState<string>("domain");
  const [priority, setPriority] = useState<number>(0);
  const [visibility, setVisibility] = useState<string>("scoped");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [goalId, setGoalId] = useState<string>("none");
  const [taskId, setTaskId] = useState<string>("none");

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(companyId),
    queryFn: () => goalsApi.list(companyId),
    enabled: open && layer === "active_context",
  });

  const { data: tasks } = useQuery({
    queryKey: queryKeys.issues.list(companyId),
    queryFn: () => issuesApi.list(companyId),
    enabled: open && layer === "working",
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      memoryApi.create(companyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memory.list(companyId) });
      onOpenChange(false);
      resetForm();
    },
  });

  function resetForm() {
    setTitle("");
    setContent("");
    setCategory("reference");
    setTagsInput("");
    setDepartmentId("none");
    setLayer("domain");
    setPriority(0);
    setVisibility("scoped");
    setExpiresAt("");
    setGoalId("none");
    setTaskId("none");
  }

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
      layer,
      priority,
      visibility,
      expiresAt: expiresAt || null,
      goalId: goalId !== "none" ? goalId : null,
      taskId: taskId !== "none" ? taskId : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
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

          <div className="grid grid-cols-2 gap-3">
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
              <Label>Layer</Label>
              <Select value={layer} onValueChange={setLayer}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMORY_ITEM_LAYERS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {LAYER_LABELS[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Label className="cursor-help border-b border-dotted border-muted-foreground">
                      Priority
                    </Label>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Higher priority items take precedence when two items in the same layer conflict</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Label className="cursor-help border-b border-dotted border-muted-foreground">
                      Visibility
                    </Label>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Shared items are visible to all departments</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMORY_ITEM_VISIBILITY.map((v) => (
                    <SelectItem key={v} value={v} className="capitalize">
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Conditional fields based on layer */}
          {layer === "active_context" && (
            <>
              <div className="space-y-1.5">
                <Label>Expires At</Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Goal</Label>
                <Select value={goalId} onValueChange={setGoalId}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(goals ?? []).map((g: Goal) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {layer === "working" && (
            <div className="space-y-1.5">
              <Label>Task</Label>
              <Select value={taskId} onValueChange={setTaskId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {(tasks ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
