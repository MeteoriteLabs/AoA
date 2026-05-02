import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { FileText, File as FileIcon, Image as ImageIcon, FileType } from "lucide-react";
import { memoryApi } from "../../api/memory";
import { memoryAssetsApi } from "../../api/memoryAssets";
import { queryKeys } from "../../lib/queryKeys";
import { useCompany } from "../../context/CompanyContext";
import type { MemoryItem, MemoryAssetRecord } from "@armyofagents/shared";

interface MemoryRecentsStripProps {
  companyId: string;
}

interface RecentRow {
  kind: "memory_item" | "asset";
  id: string;
  name: string;
  modifiedAt: string;
  mimeType?: string;
  folderPath?: string;
  departmentId?: string | null;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

export function MemoryRecentsStrip({ companyId }: MemoryRecentsStripProps) {
  const navigate = useNavigate();
  const { selectedCompany } = useCompany();
  const companyPrefix = (selectedCompany as { issuePrefix?: string } | null)?.issuePrefix ?? "";

  const itemsQuery = useQuery({
    queryKey: queryKeys.memory.list(companyId),
    queryFn: () => memoryApi.list(companyId, {}),
  });
  const assetsQuery = useQuery({
    queryKey: queryKeys.memory.assets.list(companyId),
    queryFn: () => memoryAssetsApi.list(companyId),
  });

  const rows: RecentRow[] = [
    ...((itemsQuery.data ?? []) as MemoryItem[]).map<RecentRow>((it) => ({
      kind: "memory_item",
      id: it.id,
      name: it.title,
      modifiedAt: typeof it.updatedAt === "string" ? it.updatedAt : new Date(it.updatedAt).toISOString(),
      folderPath: (it as MemoryItem & { folderPath?: string }).folderPath,
      departmentId: (it as MemoryItem & { departmentId?: string | null }).departmentId,
    })),
    ...((assetsQuery.data ?? []) as MemoryAssetRecord[]).map<RecentRow>((a) => ({
      kind: "asset",
      id: a.id,
      name: a.fileName,
      modifiedAt: a.updatedAt,
      mimeType: a.mimeType,
      folderPath: a.folderPath,
      departmentId: a.departmentId,
    })),
  ]
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
    .slice(0, 10);

  function iconFor(row: RecentRow) {
    if (row.kind === "memory_item") return FileText;
    if (!row.mimeType) return FileIcon;
    if (row.mimeType.startsWith("image/")) return ImageIcon;
    if (row.mimeType === "application/pdf") return FileType;
    return FileIcon;
  }

  function openRow(row: RecentRow) {
    const params = new URLSearchParams();
    if (row.folderPath) params.set("folder", row.folderPath);
    if (row.departmentId) params.set("dept", row.departmentId);
    params.set("item", row.id);
    params.set("type", row.kind);
    navigate(`/${companyPrefix}/memory/explore?${params.toString()}`);
  }

  if (itemsQuery.isLoading || assetsQuery.isLoading) {
    return <div className="text-xs text-muted-foreground">Loading recents…</div>;
  }
  if (rows.length === 0) {
    return <div className="text-xs text-muted-foreground">No recent activity yet.</div>;
  }

  return (
    <div className="space-y-1">
      {rows.map((row) => {
        const Icon = iconFor(row);
        return (
          <button
            key={`${row.kind}-${row.id}`}
            onClick={() => openRow(row)}
            className="w-full text-left flex items-center gap-2 px-3 py-2 rounded hover:bg-muted/40 text-xs transition-colors duration-100"
          >
            <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="flex-1 truncate font-medium">{row.name}</span>
            <span className="text-muted-foreground tabular-nums">{formatRelative(row.modifiedAt)}</span>
          </button>
        );
      })}
    </div>
  );
}
