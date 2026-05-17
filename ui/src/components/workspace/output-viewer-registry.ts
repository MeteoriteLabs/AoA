type OutputViewerInput = {
  contentType?: string | null;
  filename?: string | null;
  assetId?: string | null;
};

export type OutputViewerKind = "text" | "image" | "pdf" | "download";

export interface OutputViewerResolution {
  kind: OutputViewerKind;
  label: string;
  assetUrl: string | null;
  canOpenDirectly: boolean;
  shouldExecuteInBrowser: boolean;
  requiresTextFetch: boolean;
}

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

export function resolveOutputViewer(output: OutputViewerInput): OutputViewerResolution {
  const contentType = normaliseContentType(output.contentType);
  const extension = extensionOf(output.filename);
  const assetUrl = output.assetId ? `/api/assets/${output.assetId}/content` : null;
  const canOpenDirectly = Boolean(assetUrl);

  if (contentType.startsWith("image/")) {
    return {
      kind: "image",
      label: "Image preview",
      assetUrl,
      canOpenDirectly,
      shouldExecuteInBrowser: false,
      requiresTextFetch: false,
    };
  }

  if (contentType === "application/pdf" || extension === "pdf") {
    return {
      kind: "pdf",
      label: "PDF preview",
      assetUrl,
      canOpenDirectly,
      shouldExecuteInBrowser: false,
      requiresTextFetch: false,
    };
  }

  if (isTextLike(contentType, extension)) {
    return {
      kind: "text",
      label: "Source preview",
      assetUrl,
      canOpenDirectly,
      shouldExecuteInBrowser: false,
      requiresTextFetch: true,
    };
  }

  return {
    kind: "download",
    label: "Open externally",
    assetUrl,
    canOpenDirectly,
    shouldExecuteInBrowser: false,
    requiresTextFetch: false,
  };
}
