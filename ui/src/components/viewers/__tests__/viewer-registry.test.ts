import { resolveViewer } from "../viewer-registry";

describe("resolveViewer", () => {
  it("detects markdown, json, csv, media, pdf, sandbox markup, mermaid, canvas, and downloads", () => {
    expect(resolveViewer({ contentType: "text/markdown", filename: "note.md", assetId: "a" }).kind).toBe("markdown");
    expect(resolveViewer({ contentType: "application/json", filename: "data.json", assetId: "a" }).kind).toBe("json");
    expect(resolveViewer({ contentType: "text/csv", filename: "data.csv", assetId: "a" }).kind).toBe("table");
    expect(resolveViewer({ contentType: "image/png", filename: "image.png", assetId: "a" }).kind).toBe("image");
    expect(resolveViewer({ contentType: "video/mp4", filename: "video.mp4", assetId: "a" }).kind).toBe("video");
    expect(resolveViewer({ contentType: "audio/webm", filename: "audio.webm", assetId: "a" }).kind).toBe("audio");
    expect(resolveViewer({ contentType: "application/pdf", filename: "report.pdf", assetId: "a" }).kind).toBe("pdf");
    expect(resolveViewer({ contentType: "text/html", filename: "page.html", assetId: "a" }).kind).toBe("html_sandbox");
    expect(resolveViewer({ contentType: "image/svg+xml", filename: "diagram.svg", assetId: "a" }).kind).toBe("svg_sandbox");
    expect(resolveViewer({ contentType: "text/plain", filename: "diagram.mmd", assetId: "a" }).kind).toBe("mermaid");
    expect(resolveViewer({ contentType: "application/json", filename: "flow.aoa-canvas.json", assetId: "a" }).kind).toBe("canvas");
    expect(resolveViewer({ contentType: "application/zip", filename: "bundle.zip", assetId: "a" }).kind).toBe("download");
  });
});
