import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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

interface MemoryViewerProps {
  companyId: string;
  selectedItemId: string | null;
  selectedItemType: "memory_item" | "asset" | null;
  folderPath: string;
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
}: MemoryViewerProps) {
  if (selectedItemId && selectedItemType === "memory_item") {
    return <MarkdownItemViewer companyId={companyId} itemId={selectedItemId} />;
  }

  if (selectedItemId && selectedItemType === "asset") {
    return <AssetViewerSlot companyId={companyId} assetId={selectedItemId} />;
  }

  if (folderPath) {
    return (
      <MemoryFolderSummary
        companyId={companyId}
        folderPath={folderPath}
        departmentId={null}
      />
    );
  }

  return <MemoryEmptyViewer />;
}
