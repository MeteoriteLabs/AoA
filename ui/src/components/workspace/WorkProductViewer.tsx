import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { PdfDocumentViewer } from "@/components/viewers/PdfDocumentViewer";
import type { OutputViewerResolution } from "./output-viewer-registry";

interface WorkProductViewerProps {
  viewer: OutputViewerResolution;
  filename: string;
}

export function WorkProductViewer({ viewer, filename }: WorkProductViewerProps) {
  const assetUrl = viewer.assetUrl;

  const { data: textContent, isLoading, error } = useQuery({
    queryKey: ["work-product-text", assetUrl],
    queryFn: async () => {
      const response = await fetch(assetUrl!, { credentials: "include" });
      if (!response.ok) throw new Error(`Failed to load output (${response.status})`);
      return await response.text();
    },
    enabled: Boolean(assetUrl && viewer.requiresTextFetch),
  });

  if (viewer.requiresTextFetch) {
    if (isLoading) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
          Loading output...
        </div>
      );
    }
    if (error || textContent == null) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-destructive">
          Could not load output content.
        </div>
      );
    }
  }

  switch (viewer.kind) {
    case "markdown":
      return <MarkdownOutputViewer content={textContent ?? ""} />;
    case "html_sandbox":
      return <SandboxedMarkupViewer content={textContent ?? ""} filename={filename} kind="html" />;
    case "svg_sandbox":
      return <SandboxedMarkupViewer content={textContent ?? ""} filename={filename} kind="svg" />;
    case "mermaid":
      return <MermaidOutputViewer content={textContent ?? ""} />;
    case "json":
      return <JsonOutputViewer content={textContent ?? ""} />;
    case "table":
      return <CsvOutputViewer content={textContent ?? ""} />;
    case "canvas":
      return <CanvasOutputViewer content={textContent ?? ""} />;
    case "code":
      return <SourceOutputViewer content={textContent ?? ""} />;
    case "image":
      return <ImageOutputViewer url={assetUrl} filename={filename} />;
    case "video":
      return <VideoOutputViewer url={assetUrl} filename={filename} />;
    case "audio":
      return <AudioOutputViewer url={assetUrl} filename={filename} />;
    case "pdf":
      return <PdfOutputViewer url={assetUrl} filename={filename} />;
    case "browser":
    case "external":
    case "collection":
    case "download":
      return <DownloadFallbackViewer url={viewer.url ?? assetUrl} />;
  }
}

function SourceOutputViewer({ content }: { content: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="work-product-source">
      <pre className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  );
}

function MarkdownOutputViewer({ content }: { content: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-5" data-testid="work-product-markdown">
      <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mb-2 prose-p:my-2 prose-li:my-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

function SandboxedMarkupViewer({
  content,
  filename,
  kind,
}: {
  content: string;
  filename: string;
  kind: "html" | "svg";
}) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const srcDoc = kind === "svg" ? `<html><body style="margin:0">${content}</body></html>` : content;

  if (mode === "source") {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ViewerModeTabs mode={mode} onModeChange={setMode} />
        <SourceOutputViewer content={content} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ViewerModeTabs mode={mode} onModeChange={setMode} />
      <iframe
        title={filename}
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-forms allow-downloads"
        className="min-h-0 flex-1 border-0 bg-background"
        data-testid={kind === "svg" ? "work-product-svg-frame" : "work-product-html-frame"}
      />
    </div>
  );
}

function ViewerModeTabs({
  mode,
  onModeChange,
}: {
  mode: "preview" | "source";
  onModeChange: (mode: "preview" | "source") => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
      <Button
        type="button"
        size="sm"
        variant={mode === "preview" ? "secondary" : "ghost"}
        className="h-7 px-2 text-xs"
        onClick={() => onModeChange("preview")}
      >
        Preview
      </Button>
      <Button
        type="button"
        size="sm"
        variant={mode === "source" ? "secondary" : "ghost"}
        className="h-7 px-2 text-xs"
        onClick={() => onModeChange("source")}
      >
        Source
      </Button>
    </div>
  );
}

function MermaidOutputViewer({ content }: { content: string }) {
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);

    void import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        return mermaid.render(`work-product-mermaid-${id}`, content);
      })
      .then((result) => {
        if (!cancelled) setSvg(result.svg);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not render diagram.");
      });

    return () => {
      cancelled = true;
    };
  }, [content, id]);

  if (error) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
        <SourceOutputViewer content={content} />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="work-product-mermaid">
      {svg ? (
        <iframe
          title="Diagram preview"
          srcDoc={`<html><body style="margin:0;padding:16px;background:transparent;color:inherit">${svg}</body></html>`}
          sandbox=""
          className="h-full min-h-[320px] w-full rounded-md border border-border bg-muted/30"
        />
      ) : (
        <div className="text-sm text-muted-foreground">Rendering diagram...</div>
      )}
    </div>
  );
}

function JsonOutputViewer({ content }: { content: string }) {
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }, [content]);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="work-product-json">
      <pre className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
        {formatted}
      </pre>
    </div>
  );
}

function CsvOutputViewer({ content }: { content: string }) {
  const rows = useMemo(() => parseCsv(content), [content]);
  if (rows.length === 0) return <SourceOutputViewer content={content} />;
  const [header, ...body] = rows;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="work-product-table">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={`${cell}-${index}`} className="border border-border bg-muted/50 px-2 py-1 text-left font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`} className="border border-border px-2 py-1">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseCsv(content: string): string[][] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(",").map((cell) => cell.trim()));
}

function CanvasOutputViewer({ content }: { content: string }) {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(content) as {
        width?: number;
        height?: number;
        items?: Array<{ type?: string; x?: number; y?: number; text?: string; color?: string }>;
        nodes?: Array<{ id?: string; label?: string; x?: number; y?: number; text?: string; color?: string }>;
        edges?: Array<{ from?: string; to?: string; source?: string; target?: string }>;
      };
    } catch {
      return null;
    }
  }, [content]);

  if (!parsed) return <SourceOutputViewer content={content} />;

  const width = Math.max(320, Number(parsed.width) || 800);
  const height = Math.max(180, Number(parsed.height) || 450);
  const graphNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const items = Array.isArray(parsed.items)
    ? parsed.items.map((item) => ({ ...item, id: undefined, label: undefined }))
    : graphNodes.map((node, index) => ({
        ...node,
        type: "node",
        x: node.x ?? 80 + (index % 4) * 190,
        y: node.y ?? 80 + Math.floor(index / 4) * 120,
        text: node.text ?? node.label ?? node.id ?? "Node",
      }));
  const itemPositions = new Map<string, { x: number; y: number }>();
  graphNodes.forEach((node, index) => {
    if (!node.id) return;
    itemPositions.set(node.id, {
      x: node.x ?? 80 + (index % 4) * 190,
      y: node.y ?? 80 + Math.floor(index / 4) * 120,
    });
  });
  const edges = Array.isArray(parsed.edges) ? parsed.edges : [];

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="work-product-canvas">
      <div
        className="relative overflow-hidden rounded-md border border-border bg-muted/30"
        style={{ width: "100%", minHeight: 260, aspectRatio: `${width} / ${height}` }}
      >
        {items.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Canvas metadata loaded, but no drawable items were found.
          </div>
        )}
        {edges.length > 0 && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {edges.map((edge, index) => {
              const from = itemPositions.get(edge.from ?? edge.source ?? "");
              const to = itemPositions.get(edge.to ?? edge.target ?? "");
              if (!from || !to) return null;
              return (
                <line
                  key={`${edge.from ?? edge.source}-${edge.to ?? edge.target}-${index}`}
                  x1={from.x + 48}
                  y1={from.y + 16}
                  x2={to.x + 48}
                  y2={to.y + 16}
                  stroke="currentColor"
                  strokeOpacity="0.35"
                  strokeWidth="2"
                />
              );
            })}
          </svg>
        )}
        {items.map((item, index) => (
          <div
            key={index}
            className="absolute rounded border border-border bg-background/90 px-2 py-1 text-xs shadow-sm"
            style={{
              left: `${Math.max(0, Math.min(95, ((Number(item.x) || 0) / width) * 100))}%`,
              top: `${Math.max(0, Math.min(95, ((Number(item.y) || 0) / height) * 100))}%`,
              color: item.color,
            }}
          >
            {item.text ?? item.type ?? "Item"}
          </div>
        ))}
      </div>
    </div>
  );
}

function ImageOutputViewer({ url, filename }: { url: string | null; filename: string }) {
  if (!url) return <DownloadFallbackViewer url={url} />;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="preview-output-image">
      <img src={url} alt={filename} className="max-w-full rounded-md border border-border" />
    </div>
  );
}

function VideoOutputViewer({ url, filename }: { url: string | null; filename: string }) {
  if (!url) return <DownloadFallbackViewer url={url} />;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <video src={url} title={filename} controls className="max-h-full w-full rounded-md border border-border" data-testid="work-product-video" />
    </div>
  );
}

function AudioOutputViewer({ url, filename }: { url: string | null; filename: string }) {
  if (!url) return <DownloadFallbackViewer url={url} />;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <audio src={url} title={filename} controls className="w-full max-w-2xl" data-testid="work-product-audio" />
    </div>
  );
}

function PdfOutputViewer({ url, filename }: { url: string | null; filename: string }) {
  if (!url) return <DownloadFallbackViewer url={url} />;
  return <PdfDocumentViewer fileUrl={url} filename={filename} />;
}

function DownloadFallbackViewer({ url }: { url: string | null }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4" data-testid="preview-output-download">
      <div className="max-w-sm rounded-md border border-border bg-muted/30 p-4 text-center">
        <div className="text-sm font-medium">Preview unavailable</div>
        <div className="mt-1 text-xs text-muted-foreground">
          This file type can be opened in a separate tab.
        </div>
        {url && (
          <Button asChild type="button" variant="outline" size="sm" className="mt-3">
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
