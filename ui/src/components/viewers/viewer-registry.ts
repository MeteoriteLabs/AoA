export interface ViewerInput {
  contentType?: string | null;
  filename?: string | null;
  assetId?: string | null;
  assetUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type ViewerKind =
  | "markdown"
  | "code"
  | "json"
  | "table"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "html_sandbox"
  | "svg_sandbox"
  | "mermaid"
  | "canvas"
  | "download";

export interface ViewerResolution {
  kind: ViewerKind;
  label: string;
  assetUrl: string | null;
  url: string | null;
  canOpenDirectly: boolean;
  shouldExecuteInBrowser: boolean;
  requiresTextFetch: boolean;
  canShowSource: boolean;
}

export type OutputViewerKind = ViewerKind;
export type OutputViewerResolution = ViewerResolution;

const TEXT_EXTENSIONS = new Set([
  "css",
  "csv",
  "env",
  "html",
  "htm",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mdx",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

const SAFE_METADATA_VIEWERS = new Set<ViewerKind>([
  "markdown",
  "json",
  "table",
  "html_sandbox",
  "svg_sandbox",
  "mermaid",
  "canvas",
]);

function normaliseContentType(value: string | null | undefined): string {
  const trimmed = value?.trim().toLowerCase() ?? "";
  const semi = trimmed.indexOf(";");
  return semi === -1 ? trimmed : trimmed.slice(0, semi).trim();
}

function extensionOf(filename: string | null | undefined): string {
  const name = filename?.trim().toLowerCase() ?? "";
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1 || lastDot === name.length - 1) return "";
  return name.slice(lastDot + 1);
}

function metadataViewerKind(metadata: Record<string, unknown> | null | undefined): ViewerKind | null {
  const hint = metadata?.viewerKind;
  if (typeof hint !== "string") return null;
  const normalised = hint.trim().toLowerCase() as ViewerKind;
  return SAFE_METADATA_VIEWERS.has(normalised) ? normalised : null;
}

function textViewer(
  kind: ViewerKind,
  label: string,
  assetUrl: string | null,
  canOpenDirectly: boolean,
): ViewerResolution {
  return {
    kind,
    label,
    assetUrl,
    url: assetUrl,
    canOpenDirectly,
    shouldExecuteInBrowser: false,
    requiresTextFetch: true,
    canShowSource: true,
  };
}

function binaryViewer(
  kind: ViewerKind,
  label: string,
  assetUrl: string | null,
  canOpenDirectly: boolean,
): ViewerResolution {
  return {
    kind,
    label,
    assetUrl,
    url: assetUrl,
    canOpenDirectly,
    shouldExecuteInBrowser: false,
    requiresTextFetch: false,
    canShowSource: false,
  };
}

function isTextLike(contentType: string, extension: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/javascript" ||
    contentType === "application/typescript" ||
    contentType.endsWith("+json") ||
    contentType.endsWith("+xml") ||
    TEXT_EXTENSIONS.has(extension)
  );
}

export function resolveViewer(output: ViewerInput): ViewerResolution {
  const contentType = normaliseContentType(output.contentType);
  const extension = extensionOf(output.filename);
  const assetUrl = output.assetUrl ?? (output.assetId ? `/api/assets/${output.assetId}/content` : null);
  const canOpenDirectly = Boolean(assetUrl);
  const hintedKind = metadataViewerKind(output.metadata);

  if (hintedKind) {
    const labels: Partial<Record<ViewerKind, string>> = {
      markdown: "Markdown preview",
      json: "JSON preview",
      table: "Table preview",
      html_sandbox: "HTML preview",
      svg_sandbox: "SVG preview",
      mermaid: "Diagram preview",
      canvas: "Canvas preview",
    };
    return textViewer(hintedKind, labels[hintedKind] ?? "Preview", assetUrl, canOpenDirectly);
  }

  if (extension === "aoa-canvas" || output.filename?.toLowerCase().endsWith(".aoa-canvas.json")) {
    return textViewer("canvas", "Canvas preview", assetUrl, canOpenDirectly);
  }

  if (contentType === "text/markdown" || extension === "md" || extension === "mdx") {
    return textViewer("markdown", "Markdown preview", assetUrl, canOpenDirectly);
  }

  if (contentType === "text/html" || extension === "html" || extension === "htm") {
    return textViewer("html_sandbox", "HTML preview", assetUrl, canOpenDirectly);
  }

  if (contentType === "image/svg+xml" || extension === "svg") {
    return textViewer("svg_sandbox", "SVG preview", assetUrl, canOpenDirectly);
  }

  if (extension === "mermaid" || extension === "mmd") {
    return textViewer("mermaid", "Diagram preview", assetUrl, canOpenDirectly);
  }

  if (contentType === "application/json" || contentType.endsWith("+json") || extension === "json") {
    return textViewer("json", "JSON preview", assetUrl, canOpenDirectly);
  }

  if (contentType === "text/csv" || extension === "csv") {
    return textViewer("table", "Table preview", assetUrl, canOpenDirectly);
  }

  if (contentType.startsWith("image/")) {
    return binaryViewer("image", "Image preview", assetUrl, canOpenDirectly);
  }

  if (contentType.startsWith("video/")) {
    return binaryViewer("video", "Video preview", assetUrl, canOpenDirectly);
  }

  if (contentType.startsWith("audio/")) {
    return binaryViewer("audio", "Audio preview", assetUrl, canOpenDirectly);
  }

  if (contentType === "application/pdf" || extension === "pdf") {
    return binaryViewer("pdf", "PDF preview", assetUrl, canOpenDirectly);
  }

  if (isTextLike(contentType, extension)) {
    return textViewer("code", "Source preview", assetUrl, canOpenDirectly);
  }

  return {
    kind: "download",
    label: "Open externally",
    assetUrl,
    url: assetUrl,
    canOpenDirectly,
    shouldExecuteInBrowser: false,
    requiresTextFetch: false,
    canShowSource: false,
  };
}

export const resolveOutputViewer = resolveViewer;
