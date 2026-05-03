import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import {
  FileText,
  Image as ImageIcon,
  FileType,
  Film,
  Presentation,
  File as FileIcon,
} from "lucide-react";
import type { MemoryItem, MemoryAssetRecord } from "@armyofagents/shared";
import { memoryApi } from "../../api/memory";
import { memoryAssetsApi } from "../../api/memoryAssets";
import { projectsApi } from "../../api/projects";
import { queryKeys } from "../../lib/queryKeys";
import { useCompany } from "../../context/CompanyContext";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ExpiresAtChip } from "./ExpiresAtChip";

interface MemoryFileListProps {
  companyId: string;
  folderPath: string;
  departmentId: string | null;
  layer?: string | null;
  selectedItemId: string | null;
  selectedItemType: "memory_item" | "asset" | null;
  searchQuery?: string;
}

interface ListRow {
  kind: "memory_item" | "asset";
  id: string;
  name: string;
  category?: string | null;
  status?: string | null;
  mimeType?: string | null;
  modifiedAt: string;
  raw: MemoryItem | MemoryAssetRecord;
}

const STATUS_COLORS: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  archived: "bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  draft: "bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300",
};

function iconForRow(row: ListRow) {
  if (row.kind === "memory_item") return FileText;
  if (!row.mimeType) return FileIcon;
  if (row.mimeType.startsWith("image/")) return ImageIcon;
  if (row.mimeType.startsWith("video/")) return Film;
  if (row.mimeType === "application/pdf") return FileType;
  if (row.mimeType.includes("presentation")) return Presentation;
  return FileIcon;
}

function formatRelative(isoOrDate: string): string {
  const ms = Date.now() - new Date(isoOrDate).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

function folderLabel(folderPath: string, layer?: string | null, deptOnly?: boolean, deptName?: string): string {
  if (folderPath === "__pinned") return "📌 Pinned";
  if (folderPath === "__pending") return "📋 Pending Review";
  if (folderPath === "__recent") return "🕒 Recent (last 14 days)";
  if (folderPath === "__archived") return "📦 Archived";
  if (!folderPath && layer) {
    const labels: Record<string, string> = {
      identity: "🪪 Identity",
      domain: "🏢 Domain",
      active_context: "🎯 Active Context",
      working: "⚡ Working",
    };
    return labels[layer] ?? layer;
  }
  if (deptOnly && deptName) return `📁 ${deptName}`;
  if (deptOnly) return "📁 Department";
  return folderPath;
}

export function MemoryFileList({
  companyId,
  folderPath,
  departmentId,
  layer,
  selectedItemId,
  selectedItemType,
  searchQuery,
}: MemoryFileListProps) {
  const navigate = useNavigate();
  const { selectedCompany } = useCompany();
  const companyPrefix = selectedCompany?.issuePrefix ?? "";

  const isVirtualFolder =
    folderPath === "__pinned" ||
    folderPath === "__pending" ||
    folderPath === "__recent" ||
    folderPath === "__archived";

  const isLayerOnly = !folderPath && !departmentId && Boolean(layer);

  const isDeptOnly =
    !folderPath && Boolean(departmentId) && !isVirtualFolder;

  const itemsQuery = useQuery({
    queryKey: [...queryKeys.memory.list(companyId), { folderPath, departmentId }],
    queryFn: () =>
      memoryApi.list(companyId, departmentId ? { departmentId } : {}),
    enabled: Boolean(folderPath) || isLayerOnly || isDeptOnly,
  });

  const assetsQuery = useQuery({
    queryKey: queryKeys.memory.assets.list(companyId, {
      departmentId: departmentId ?? undefined,
      folderPath: isDeptOnly ? undefined : folderPath,
    }),
    queryFn: () =>
      memoryAssetsApi.list(companyId, {
        departmentId: departmentId ?? undefined,
        folderPath: isDeptOnly ? undefined : folderPath,
      }),
    enabled: (Boolean(folderPath) && !isVirtualFolder && !isLayerOnly) || isDeptOnly,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(companyId),
    queryFn: () => projectsApi.list(companyId),
    enabled: Boolean(companyId) && Boolean(departmentId),
  });
  const deptName = projects?.find((p) => p.id === departmentId)?.name;

  const rows = useMemo<ListRow[]>(() => {
    const allItems = (itemsQuery.data ?? []) as Array<
      MemoryItem & {
        folderPath?: string;
        founderPinnedToTop?: boolean;
        layer?: string | null;
      }
    >;

    const recentCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const items = allItems
      .filter((it) => {
        if (folderPath === "__pinned") return it.founderPinnedToTop === true;
        if (folderPath === "__pending") return it.status === "pending";
        if (folderPath === "__recent") {
          if (it.status === "archived") return false;
          const t = new Date(it.updatedAt).getTime();
          return Number.isFinite(t) && t >= recentCutoff;
        }
        if (folderPath === "__archived") return it.status === "archived";
        if (isLayerOnly) return it.layer === layer;
        if (isDeptOnly) return (it as unknown as { departmentId?: string | null }).departmentId === departmentId;
        return it.folderPath === folderPath;
      })
      .map<ListRow>((it) => ({
        kind: "memory_item",
        id: it.id,
        name: it.title,
        category: it.category,
        status: it.status,
        modifiedAt:
          typeof it.updatedAt === "string"
            ? it.updatedAt
            : new Date(it.updatedAt).toISOString(),
        raw: it,
      }));

    // Virtual folders and layer-only views show items only — assets don't have pin/approval state.
    const assets = isVirtualFolder || isLayerOnly
      ? []
      : (assetsQuery.data ?? []).map<ListRow>((a: MemoryAssetRecord) => ({
          kind: "asset",
          id: a.id,
          name: a.fileName,
          mimeType: a.mimeType,
          status: undefined,
          modifiedAt: a.updatedAt,
          raw: a,
        }));

    return [...items, ...assets].sort(
      (a, b) =>
        new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
    );
  }, [itemsQuery.data, assetsQuery.data, folderPath, isVirtualFolder, isLayerOnly, isDeptOnly, layer, departmentId]);

  const filteredRows = useMemo(() => {
    if (!searchQuery?.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q) ||
        (r.mimeType ?? "").toLowerCase().includes(q),
    );
  }, [rows, searchQuery]);

  // Phase 6.2a: collapsible category groups.
  // Group keys are MemoryItemCategory values + "asset" for files (which don't have a category).
  type GroupKey =
    | "decision"
    | "reference"
    | "insight"
    | "preference"
    | "procedure"
    | "policy"
    | "context"
    | "asset";

  const CATEGORY_LABEL: Record<GroupKey, string> = {
    decision: "Decisions",
    reference: "References",
    insight: "Insights",
    preference: "Preferences",
    procedure: "Procedures",
    policy: "Policies",
    context: "Context",
    asset: "Files",
  };

  const CATEGORY_ORDER: GroupKey[] = [
    "decision",
    "reference",
    "policy",
    "procedure",
    "insight",
    "preference",
    "context",
    "asset",
  ];

  interface CategoryGroup {
    key: GroupKey;
    label: string;
    rows: ListRow[];
  }

  const groupedRows = useMemo<CategoryGroup[]>(() => {
    const buckets = new Map<GroupKey, ListRow[]>();
    for (const row of filteredRows) {
      const k: GroupKey =
        row.kind === "asset" ? "asset" : ((row.category ?? "context") as GroupKey);
      const list = buckets.get(k) ?? [];
      list.push(row);
      buckets.set(k, list);
    }
    // Build groups in CATEGORY_ORDER, skipping empties.
    return CATEGORY_ORDER.map<CategoryGroup>((k) => ({
      key: k,
      label: CATEGORY_LABEL[k],
      rows: buckets.get(k) ?? [],
    })).filter((g) => g.rows.length > 0);
  }, [filteredRows]);

  // Default-expanded set: top 3 groups by row count.
  // Persisted per-scope so collapse state survives folder switches.
  const defaultExpanded = useMemo(() => {
    const sorted = [...groupedRows].sort((a, b) => b.rows.length - a.rows.length);
    return new Set(sorted.slice(0, 3).map((g) => g.key));
  }, [groupedRows]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<GroupKey>>(new Set());
  // Recompute initial state when scope changes (folderPath/dept changes the rows).
  useEffect(() => {
    // Mark as collapsed everything NOT in defaultExpanded
    const next = new Set<GroupKey>();
    for (const g of groupedRows) {
      if (!defaultExpanded.has(g.key)) next.add(g.key);
    }
    setCollapsedGroups(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderPath, departmentId]);

  function toggleGroup(key: GroupKey) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectRow(row: ListRow) {
    const params = new URLSearchParams(window.location.search);
    params.set("item", row.id);
    params.set("type", row.kind);
    navigate(`/${companyPrefix}/memory/explore?${params.toString()}`);
  }

  const isLoading = itemsQuery.isLoading || assetsQuery.isLoading;

  if (!folderPath && !isLayerOnly && !isDeptOnly) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        Select a folder to see its contents
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card/30">
      <div className="flex items-center px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground gap-2">
        <span className="truncate">{folderLabel(folderPath, layer, isDeptOnly, deptName)}</span>
        <span className="flex-1" />
        <span className="text-[10px] text-muted-foreground">{filteredRows.length}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : groupedRows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            No items in this folder
          </div>
        ) : (
          groupedRows.map((group) => {
            const isCollapsed = collapsedGroups.has(group.key);
            return (
              <div key={group.key} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-muted/40 transition-colors text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                  aria-expanded={!isCollapsed}
                >
                  <span className="inline-block w-3 text-center">
                    {isCollapsed ? "▶" : "▼"}
                  </span>
                  <span>{group.label}</span>
                  <span className="text-muted-foreground/60">({group.rows.length})</span>
                </button>
                {!isCollapsed &&
                  group.rows.map((row) => {
                    const Icon = iconForRow(row);
                    const isSelected =
                      row.id === selectedItemId && row.kind === selectedItemType;
                    const expiresAt =
                      row.kind === "memory_item"
                        ? (row.raw as MemoryItem & { expiresAt?: Date | string | null }).expiresAt ?? null
                        : null;
                    return (
                      <button
                        key={`${row.kind}-${row.id}`}
                        onClick={() => selectRow(row)}
                        className={cn(
                          "w-full text-left flex items-center gap-2 pl-7 pr-3 py-2 text-xs transition-colors",
                          isSelected
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted/40",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="flex-1 truncate">{row.name}</span>
                        {row.status && (
                          <span
                            className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded",
                              STATUS_COLORS[row.status] ?? "",
                            )}
                          >
                            {row.status}
                          </span>
                        )}
                        <ExpiresAtChip expiresAt={expiresAt} />
                        <span className="text-muted-foreground tabular-nums text-[10px]">
                          {formatRelative(row.modifiedAt)}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
