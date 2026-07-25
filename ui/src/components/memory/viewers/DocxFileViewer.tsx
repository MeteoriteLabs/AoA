import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerRenderedHtmlView } from "@/components/viewers/ServerRenderedHtmlView";
import { memoryAssetsApi } from "../../../api/memoryAssets";
import { queryKeys } from "../../../lib/queryKeys";
import { ExtractsSidebar } from "../ExtractsSidebar";

interface DocxFileViewerProps {
  companyId: string;
  assetId: string;
}

export function DocxFileViewer({ companyId, assetId }: DocxFileViewerProps) {
  const { data: asset } = useQuery({
    queryKey: queryKeys.memory.assets.detail(companyId, assetId),
    queryFn: () => memoryAssetsApi.get(companyId, assetId),
  });
  const [extractsOpen, setExtractsOpen] = useState(false);

  const renderUrl = memoryAssetsApi.renderUrl(companyId, assetId);
  const downloadUrl = memoryAssetsApi.contentUrl(companyId, assetId);

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
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border text-[11px] bg-card/30">
          <span className="font-medium truncate flex-1">{asset.fileName}</span>
          <Button size="sm" variant="ghost" asChild className="h-7 gap-1">
            <a href={downloadUrl} download={asset.fileName}>
              <Download className="h-3 w-3" />
              Download
            </a>
          </Button>
        </div>
        <div className="flex-1 overflow-auto bg-background px-10 py-8">
          <ServerRenderedHtmlView renderUrl={renderUrl} />
        </div>
      </div>
      {asset.importJobId && (
        <div className="border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExtractsOpen((o) => !o)}
            className="w-full justify-start text-xs"
          >
            {extractsOpen ? "Hide extracts" : "Show extracts"}
          </Button>
          {extractsOpen && (
            <ExtractsSidebar companyId={companyId} importJobId={asset.importJobId} />
          )}
        </div>
      )}
    </div>
  );
}
