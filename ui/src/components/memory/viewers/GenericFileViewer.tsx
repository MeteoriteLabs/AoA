import { useQuery } from "@tanstack/react-query";
import { File as FileIcon, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { memoryAssetsApi } from "../../../api/memoryAssets";
import { queryKeys } from "../../../lib/queryKeys";
import { ExtractsSidebar } from "../ExtractsSidebar";
import { formatBytes } from "../../../lib/format";

interface GenericFileViewerProps {
  companyId: string;
  assetId: string;
}

export function GenericFileViewer({ companyId, assetId }: GenericFileViewerProps) {
  const { data: asset } = useQuery({
    queryKey: queryKeys.memory.assets.detail(companyId, assetId),
    queryFn: () => memoryAssetsApi.get(companyId, assetId),
  });
  const url = memoryAssetsApi.contentUrl(companyId, assetId);

  if (!asset) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <FileIcon className="h-16 w-16 text-muted-foreground opacity-50" />
        <div className="text-lg font-medium">{asset.fileName}</div>
        <div className="text-xs text-muted-foreground">
          {asset.mimeType} · {formatBytes(asset.fileSize)}
        </div>
        <Button asChild>
          <a href={url} download={asset.fileName} className="gap-2">
            <Download className="h-4 w-4" />
            Download
          </a>
        </Button>
      </div>
      {asset.importJobId && (
        <ExtractsSidebar companyId={companyId} importJobId={asset.importJobId} />
      )}
    </div>
  );
}
