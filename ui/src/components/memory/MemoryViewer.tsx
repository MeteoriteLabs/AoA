import { useQuery } from "@tanstack/react-query";
import { Loader2, PanelRightClose } from "lucide-react";
import { MarkdownItemViewer } from "./viewers/MarkdownItemViewer";
import { MemoryFolderSummary } from "./MemoryFolderSummary";
import { MemoryEmptyViewer } from "./MemoryEmptyViewer";
import { PdfFileViewer } from "./viewers/PdfFileViewer";
import { ImageFileViewer } from "./viewers/ImageFileViewer";
import { VideoFileViewer } from "./viewers/VideoFileViewer";
import { GenericFileViewer } from "./viewers/GenericFileViewer";
import { DocxFileViewer } from "./viewers/DocxFileViewer";
import { memoryAssetsApi } from "../../api/memoryAssets";
import { queryKeys } from "../../lib/queryKeys";
import { Button } from "@/components/ui/button";

interface MemoryViewerProps {
  companyId: string;
  selectedItemId: string | null;
  selectedItemType: "memory_item" | "asset" | null;
  folderPath: string;
  onCollapse?: () => void;
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
  if (mt === "application/pdf") {
    return <PdfFileViewer companyId={companyId} assetId={assetId} />;
  }
  if (mt.startsWith("image/")) {
    return <ImageFileViewer companyId={companyId} assetId={assetId} />;
  }
  if (mt.startsWith("video/")) {
    return <VideoFileViewer companyId={companyId} assetId={assetId} />;
  }
  if (mt === DOCX_MIME) {
    return <DocxFileViewer companyId={companyId} assetId={assetId} />;
  }
  return <GenericFileViewer companyId={companyId} assetId={assetId} />;
}

export function MemoryViewer({
  companyId,
  selectedItemId,
  selectedItemType,
  folderPath,
  onCollapse,
}: MemoryViewerProps) {
  let inner: React.ReactNode;
  if (selectedItemId && selectedItemType === "memory_item") {
    inner = <MarkdownItemViewer companyId={companyId} itemId={selectedItemId} />;
  } else if (selectedItemId && selectedItemType === "asset") {
    inner = <AssetViewerSlot companyId={companyId} assetId={selectedItemId} />;
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
      {onCollapse && (
        <div className="flex items-center justify-end px-2 py-1 border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={onCollapse}
            aria-label="Collapse viewer"
            className="h-6 w-6"
          >
            <PanelRightClose className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        {inner}
      </div>
    </div>
  );
}
