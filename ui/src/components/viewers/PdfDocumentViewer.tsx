import { lazy, Suspense, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PdfDocumentRenderer = lazy(() =>
  import("./PdfDocumentRenderer").then((module) => ({
    default: module.PdfDocumentRenderer,
  })),
);

export function PdfDocumentViewer({
  fileUrl,
  filename,
  className,
}: {
  fileUrl: string;
  filename: string;
  className?: string;
}) {
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [useNativeFallback, setUseNativeFallback] = useState(false);

  return (
    <div
      data-testid="pdf-document-viewer"
      className={cn("flex min-h-0 flex-1 flex-col bg-background", className)}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-[11px]">
        <span className="min-w-0 flex-1 truncate font-medium">{filename}</span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setPageNum((page) => Math.max(1, page - 1))}
          disabled={pageNum <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-10 text-center tabular-nums">
          {pageNum} / {numPages ?? "..."}
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() =>
            setPageNum((page) => (numPages ? Math.min(numPages, page + 1) : page + 1))
          }
          disabled={numPages !== null && pageNum >= numPages}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a href={fileUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            Open
          </a>
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a href={fileUrl} download={filename}>
            <Download />
            Download
          </a>
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-muted/30 py-4">
        {useNativeFallback ? (
          <iframe
            data-testid="pdf-native-fallback"
            src={fileUrl}
            title={filename}
            className="h-full min-h-[520px] w-full border-0 bg-background"
          />
        ) : (
          <Suspense fallback={<div className="p-8 text-xs text-muted-foreground">Loading PDF...</div>}>
            <PdfDocumentRenderer
              fileUrl={fileUrl}
              pageNumber={pageNum}
              onLoadSuccess={(loadedPages) => setNumPages(loadedPages)}
              onLoadError={() => setUseNativeFallback(true)}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
