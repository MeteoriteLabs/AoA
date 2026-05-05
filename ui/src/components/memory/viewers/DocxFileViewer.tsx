import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Download, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { memoryAssetsApi } from "../../../api/memoryAssets";
import { queryKeys } from "../../../lib/queryKeys";
import { ExtractsSidebar } from "../ExtractsSidebar";

interface DocxFileViewerProps {
  companyId: string;
  assetId: string;
}

async function fetchDocxHtml(url: string): Promise<string> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`Render failed (HTTP ${r.status})`);
  return r.text();
}

export function DocxFileViewer({ companyId, assetId }: DocxFileViewerProps) {
  const { data: asset } = useQuery({
    queryKey: queryKeys.memory.assets.detail(companyId, assetId),
    queryFn: () => memoryAssetsApi.get(companyId, assetId),
  });
  const [extractsOpen, setExtractsOpen] = useState(false);

  const renderUrl = memoryAssetsApi.renderUrl(companyId, assetId);
  const downloadUrl = memoryAssetsApi.contentUrl(companyId, assetId);

  const htmlQuery = useQuery({
    queryKey: ["memory-asset-render", companyId, assetId],
    queryFn: () => fetchDocxHtml(renderUrl),
    enabled: Boolean(asset),
    staleTime: 5 * 60 * 1000,
  });

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
          {htmlQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Rendering document…
            </div>
          ) : htmlQuery.error ? (
            <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
              <FileWarning className="h-8 w-8" />
              <div>Couldn't render this DOCX. Use Download to open it externally.</div>
            </div>
          ) : (
            <article
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: htmlQuery.data ?? "" }}
            />
          )}
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
