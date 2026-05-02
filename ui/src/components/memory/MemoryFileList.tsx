import { useMemo } from "react";
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
import { queryKeys } from "../../lib/queryKeys";
import { useCompany } from "../../context/CompanyContext";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface MemoryFileListProps {
  companyId: string;
  folderPath: string;
  departmentId: string | null;
  selectedItemId: string | null;
  selectedItemType: "memory_item" | "asset" | null;
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

export function MemoryFileList({
  companyId,
  folderPath,
  departmentId,
  selectedItemId,
  selectedItemType,
}: MemoryFileListProps) {
  const navigate = useNavigate();
  const { selectedCompany } = useCompany();
  const companyPrefix = selectedCompany?.issuePrefix ?? "";

  const itemsQuery = useQuery({
    queryKey: [...queryKeys.memory.list(companyId), { folderPath, departmentId }],
    queryFn: () =>
      memoryApi.list(companyId, departmentId ? { departmentId } : {}),
    enabled: Boolean(folderPath),
  });

  const assetsQuery = useQuery({
    queryKey: queryKeys.memory.assets.list(companyId, {
      departmentId: departmentId ?? undefined,
      folderPath,
    }),
    queryFn: () =>
      memoryAssetsApi.list(companyId, {
        departmentId: departmentId ?? undefined,
        folderPath,
      }),
    enabled: Boolean(folderPath),
  });

  const rows = useMemo<ListRow[]>(() => {
    const items = (itemsQuery.data ?? [])
      .filter((it: MemoryItem) => (it as MemoryItem & { folderPath?: string }).folderPath === folderPath)
      .map<ListRow>((it: MemoryItem) => ({
        kind: "memory_item",
        id: it.id,
        name: it.title,
        category: it.category,
        status: it.status,
        modifiedAt: typeof it.updatedAt === "string" ? it.updatedAt : new Date(it.updatedAt).toISOString(),
        raw: it,
      }));

    const assets = (assetsQuery.data ?? []).map<ListRow>((a: MemoryAssetRecord) => ({
      kind: "asset",
      id: a.id,
      name: a.fileName,
      mimeType: a.mimeType,
      status: undefined,
      modifiedAt: a.updatedAt,
      raw: a,
    }));

    return [...items, ...assets].sort(
      (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
    );
  }, [itemsQuery.data, assetsQuery.data, folderPath]);

  function selectRow(row: ListRow) {
    const params = new URLSearchParams(window.location.search);
    params.set("item", row.id);
    params.set("type", row.kind);
    navigate(`/${companyPrefix}/memory/explore?${params.toString()}`);
  }

  const isLoading = itemsQuery.isLoading || assetsQuery.isLoading;

  if (!folderPath) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        Select a folder to see its contents
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card/30">
      <div className="flex items-center px-3 py-2 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground gap-2">
        <span className="truncate">{folderPath}</span>
        <span className="flex-1" />
        <span className="text-[10px] text-muted-foreground">{rows.length}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-xs text-muted-foreground text-center">
            No items in this folder
          </div>
        ) : (
          rows.map((row) => {
            const Icon = iconForRow(row);
            const isSel =
              row.id === selectedItemId && row.kind === selectedItemType;
            return (
              <div
                key={`${row.kind}-${row.id}`}
                onClick={() => selectRow(row)}
                className={cn(
                  "grid grid-cols-[24px_1fr_60px] gap-2 items-center px-3 py-2 border-b border-border cursor-pointer text-xs",
                  "hover:bg-muted/40",
                  isSel && "bg-primary/10",
                )}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium truncate">{row.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {row.kind === "memory_item"
                      ? row.category ?? "memory item"
                      : row.mimeType ?? "file"}
                    {" · "}
                    {formatRelative(row.modifiedAt)}
                  </div>
                </div>
                {row.status && (
                  <span
                    className={cn(
                      "text-[10px] px-2 py-0.5 rounded text-center font-medium",
                      STATUS_COLORS[row.status] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {row.status}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
