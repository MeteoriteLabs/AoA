import { describe, expect, it } from "vitest";
import { resolveOutputViewer } from "../components/workspace/output-viewer-registry";

describe("resolveOutputViewer", () => {
  it("classifies common work product formats with rendered-first viewers", () => {
    expect(resolveOutputViewer({
      contentType: "text/markdown",
      filename: "summary.md",
      assetId: "asset-md",
    })).toMatchObject({
      kind: "markdown",
      label: "Markdown preview",
      requiresTextFetch: true,
      canShowSource: true,
    });

    expect(resolveOutputViewer({
      contentType: "text/html",
      filename: "loader.html",
      assetId: "asset-html",
    })).toMatchObject({
      kind: "html_sandbox",
      label: "HTML preview",
      requiresTextFetch: true,
      canShowSource: true,
      shouldExecuteInBrowser: false,
    });

    expect(resolveOutputViewer({
      contentType: "image/svg+xml",
      filename: "diagram.svg",
      assetId: "asset-svg",
    })).toMatchObject({
      kind: "svg_sandbox",
      label: "SVG preview",
      requiresTextFetch: true,
      canShowSource: true,
    });

    expect(resolveOutputViewer({
      contentType: "text/plain",
      filename: "flow.mermaid",
      assetId: "asset-mermaid",
    })).toMatchObject({
      kind: "mermaid",
      label: "Diagram preview",
      requiresTextFetch: true,
      canShowSource: true,
    });
  });

  it("classifies media and data formats", () => {
    expect(resolveOutputViewer({ contentType: "image/png", filename: "logo.png", assetId: "a" }).kind).toBe("image");
    expect(resolveOutputViewer({ contentType: "video/mp4", filename: "demo.mp4", assetId: "a" }).kind).toBe("video");
    expect(resolveOutputViewer({ contentType: "audio/webm", filename: "voice.webm", assetId: "a" }).kind).toBe("audio");
    expect(resolveOutputViewer({ contentType: "application/pdf", filename: "report.pdf", assetId: "a" }).kind).toBe("pdf");
    expect(resolveOutputViewer({ contentType: "application/json", filename: "result.json", assetId: "a" }).kind).toBe("json");
    expect(resolveOutputViewer({ contentType: "text/csv", filename: "metrics.csv", assetId: "a" }).kind).toBe("table");
  });

  it("uses safe metadata hints for future reusable viewer surfaces", () => {
    expect(resolveOutputViewer({
      contentType: "application/json",
      filename: "board.json",
      assetId: "asset-board",
      metadata: { viewerKind: "canvas" },
    })).toMatchObject({
      kind: "canvas",
      label: "Canvas preview",
      requiresTextFetch: true,
      canShowSource: true,
    });

    expect(resolveOutputViewer({
      contentType: "application/json",
      filename: "unknown.json",
      assetId: "asset-json",
      metadata: { viewerKind: "not-a-real-viewer" },
    })).toMatchObject({
      kind: "json",
      label: "JSON preview",
    });
  });

  it("classifies runtime and external URL outputs without requiring assets", () => {
    expect(resolveOutputViewer({
      outputType: "preview_url",
      url: "/preview/services/svc-1/",
      filename: "web",
    })).toMatchObject({
      kind: "browser",
      label: "Browser preview",
      requiresTextFetch: false,
    });

    expect(resolveOutputViewer({
      outputType: "external_link",
      url: "https://example.com/report",
      filename: "report",
    })).toMatchObject({
      kind: "external",
      label: "External link",
      requiresTextFetch: false,
    });
  });

  it("keeps unsupported archives as download fallback", () => {
    expect(resolveOutputViewer({
      contentType: "application/zip",
      filename: "bundle.zip",
      assetId: "asset-zip",
    })).toMatchObject({
      kind: "download",
      label: "Open externally",
      requiresTextFetch: false,
    });
  });
});
