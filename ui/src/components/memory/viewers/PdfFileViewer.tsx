import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfDocumentViewer } from "@/components/viewers/PdfDocumentViewer";
import { memoryAssetsApi } from "../../../api/memoryAssets";
import { queryKeys } from "../../../lib/queryKeys";
import { ExtractsSidebar } from "../ExtractsSidebar";

interface PdfFileViewerProps {
  companyId: string;
  assetId: string;
}

export function PdfFileViewer({ companyId, assetId }: PdfFileViewerProps) {
  const { data: asset } = useQuery({
    queryKey: queryKeys.memory.assets.detail(companyId, assetId),
    queryFn: () => memoryAssetsApi.get(companyId, assetId),
  });

  const [extractsOpen, setExtractsOpen] = useState(false);

  const fileUrl = useMemo(
    () => memoryAssetsApi.contentUrl(companyId, assetId),
    [companyId, assetId],
  );

  if (!asset) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <div className="flex min-h-0 min-w-0 flex-1">
        <PdfDocumentViewer fileUrl={fileUrl} filename={asset.fileName} />
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
