import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { memoryAssetsApi } from "../../../api/memoryAssets";
import { queryKeys } from "../../../lib/queryKeys";
import { ExtractsSidebar } from "../ExtractsSidebar";

import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfFileViewerProps {
  companyId: string;
  assetId: string;
}

export function PdfFileViewer({ companyId, assetId }: PdfFileViewerProps) {
  const { data: asset } = useQuery({
    queryKey: queryKeys.memory.assets.detail(companyId, assetId),
    queryFn: () => memoryAssetsApi.get(companyId, assetId),
  });

  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState<number | null>(null);

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
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs bg-card/30">
          <span className="font-medium truncate flex-1">{asset.fileName}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
            className="h-7 w-7 p-0"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <span className="tabular-nums">
            {pageNum} / {numPages ?? "…"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setPageNum((p) => (numPages ? Math.min(numPages, p + 1) : p + 1))
            }
            disabled={numPages !== null && pageNum >= numPages}
            className="h-7 w-7 p-0"
            aria-label="Next page"
          >
            <ChevronRight className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" asChild className="h-7 gap-1">
            <a href={fileUrl} download={asset.fileName}>
              <Download className="h-3 w-3" />
              Download
            </a>
          </Button>
        </div>
        <div className="flex-1 overflow-auto bg-muted/30 flex items-start justify-center py-4">
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            loading={
              <div className="p-8 text-xs text-muted-foreground">
                Loading PDF…
              </div>
            }
            error={
              <div className="p-8 text-xs text-destructive">
                Failed to load PDF.
              </div>
            }
          >
            <Page pageNumber={pageNum} width={680} />
          </Document>
        </div>
      </div>
      {asset.importJobId && (
        <ExtractsSidebar
          companyId={companyId}
          importJobId={asset.importJobId}
        />
      )}
    </div>
  );
}
