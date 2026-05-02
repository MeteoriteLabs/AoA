import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ZoomIn, ZoomOut, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { memoryAssetsApi } from "../../../api/memoryAssets";
import { queryKeys } from "../../../lib/queryKeys";
import { ExtractsSidebar } from "../ExtractsSidebar";

interface ImageFileViewerProps {
  companyId: string;
  assetId: string;
}

export function ImageFileViewer({ companyId, assetId }: ImageFileViewerProps) {
  const { data: asset } = useQuery({
    queryKey: queryKeys.memory.assets.detail(companyId, assetId),
    queryFn: () => memoryAssetsApi.get(companyId, assetId),
  });
  const [zoom, setZoom] = useState(1);
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
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs bg-card/30">
          <span className="font-medium truncate flex-1">{asset.fileName}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
            className="h-7 w-7 p-0"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-3 w-3" />
          </Button>
          <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            className="h-7 w-7 p-0"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" asChild className="h-7 gap-1">
            <a href={url} download={asset.fileName}>
              <Download className="h-3 w-3" />
              Download
            </a>
          </Button>
        </div>
        <div className="flex-1 overflow-auto bg-muted/30 flex items-start justify-center py-4">
          <img
            src={url}
            alt={asset.fileName}
            style={{ transform: `scale(${zoom})`, transformOrigin: "center top" }}
            className="max-w-full"
          />
        </div>
      </div>
      {asset.importJobId && (
        <ExtractsSidebar companyId={companyId} importJobId={asset.importJobId} />
      )}
    </div>
  );
}
