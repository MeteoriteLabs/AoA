import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { resolveViewer } from "@/components/viewers/viewer-registry";
import { SharedContentViewer } from "@/components/viewers/SharedContentViewer";
import { MarkdownItemViewer } from "./viewers/MarkdownItemViewer";
import { MemoryFolderSummary } from "./MemoryFolderSummary";
import { MemoryEmptyViewer } from "./MemoryEmptyViewer";
import { DocxFileViewer } from "./viewers/DocxFileViewer";
import { memoryAssetsApi } from "../../api/memoryAssets";
import { queryKeys } from "../../lib/queryKeys";
import { MemoryViewerTabs } from "./MemoryViewerTabs";
import { MemoryGraphViewer } from "./MemoryGraphViewer";
import { MemoryOpenViewer } from "./MemoryOpenViewer";
import type { MemoryTab, MemoryTabKind, TabKey } from "../../lib/memoryTabs";

interface MemoryViewerProps {
  companyId: string;
  tabs: ReadonlyArray<MemoryTab>;
  activeKey: TabKey | null;
  onActivate: (id: string, kind: MemoryTabKind) => void;
  onClose: (id: string, kind: MemoryTabKind) => void;
  onAdd?: () => void;
  onOpenTab?: (tab: MemoryTab) => void;
  onToggleCollapse?: () => void;
  /** Optional folder fallback for the empty-pane / folder-summary view. */
  folderPath?: string;
}

function AssetViewerSlot({ companyId, assetId }: { companyId: string; assetId: string }) {
  const { data: asset, isLoading } = useQuery({
    queryKey: queryKeys.memory.assets.detail(companyId, assetId),
    queryFn: () => memoryAssetsApi.get(companyId, assetId),
  });
  if (isLoading || !asset) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }
  const mt = asset.mimeType;
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (mt === DOCX_MIME) {
    return <DocxFileViewer companyId={companyId} assetId={assetId} />;
  }

  const viewer = resolveViewer({
    contentType: asset.mimeType,
    filename: asset.fileName,
    assetUrl: memoryAssetsApi.contentUrl(companyId, assetId),
    metadata: asset.metadata ?? null,
  });

  return <SharedContentViewer viewer={viewer} filename={asset.fileName} />;
}

function MemoryCollectionViewer({ tab }: { tab: MemoryTab }) {
  const descriptions: Record<string, string> = {
    recent: "Recent memory activity will appear here.",
    unlinked: "Memory items without graph links will appear here.",
    "review-queue": "Memory items waiting for review will appear here.",
  };

  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <div className="max-w-xs text-center">
        <div className="text-sm font-semibold">{tab.title}</div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {descriptions[tab.id] ?? "Memory collection details will appear here."}
        </p>
      </div>
    </div>
  );
}

export function MemoryViewer({
  companyId,
  tabs,
  activeKey,
  onActivate,
  onClose,
  onAdd,
  onOpenTab,
  onToggleCollapse,
  folderPath,
}: MemoryViewerProps) {
  // Resolve the active tab from the tabs array.
  const activeTab = activeKey
    ? tabs.find((t) => t.id === activeKey.id && t.kind === activeKey.kind) ?? null
    : null;

  let inner: React.ReactNode;
  if (activeTab && activeTab.kind === "home") {
    inner = <MemoryOpenViewer onOpenTab={onOpenTab} />;
  } else if (activeTab && activeTab.kind === "memory_item") {
    inner = <MarkdownItemViewer companyId={companyId} itemId={activeTab.id} />;
  } else if (activeTab && activeTab.kind === "asset") {
    inner = <AssetViewerSlot companyId={companyId} assetId={activeTab.id} />;
  } else if (activeTab && activeTab.kind === "graph") {
    inner = (
      <MemoryGraphViewer
        companyId={companyId}
        itemId={activeTab.id === "company-graph" ? null : activeTab.id}
        onOpenMemoryItem={(item) => onOpenTab?.({
          id: item.id,
          kind: "memory_item",
          title: item.title,
        })}
      />
    );
  } else if (activeTab && activeTab.kind === "open") {
    inner = <MemoryOpenViewer onOpenTab={onOpenTab} />;
  } else if (activeTab && activeTab.kind === "collection") {
    inner = <MemoryCollectionViewer tab={activeTab} />;
  } else if (folderPath) {
    inner = (
      <MemoryFolderSummary
        companyId={companyId}
        folderPath={folderPath}
        departmentId={null}
      />
    );
  } else {
    inner = <MemoryEmptyViewer />;
  }

  return (
    <div className="h-full flex flex-col">
      <MemoryViewerTabs
        tabs={tabs}
        activeKey={activeKey}
        onActivate={onActivate}
        onClose={onClose}
        onAdd={onAdd}
        onToggleCollapse={onToggleCollapse}
      />
      <div className="flex-1 min-h-0 overflow-auto">
        {inner}
      </div>
    </div>
  );
}
