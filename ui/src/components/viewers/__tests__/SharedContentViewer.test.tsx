import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { SharedContentViewer } from "../SharedContentViewer";
import type { ViewerResolution } from "../viewer-registry";

vi.mock("../PdfDocumentViewer", () => ({
  PdfDocumentViewer: ({ fileUrl, filename }: { fileUrl: string; filename: string }) => (
    <div data-testid="pdf-viewer">{filename}:{fileUrl}</div>
  ),
}));

function renderViewer(
  viewer: ViewerResolution,
  inlineTextContent: string | null = null,
  filename = "example.md",
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <SharedContentViewer
        viewer={viewer}
        filename={filename}
        inlineTextContent={inlineTextContent}
      />
    </QueryClientProvider>,
  );
}

function viewer(overrides: Partial<ViewerResolution>): ViewerResolution {
  return {
    kind: "markdown",
    label: "Markdown preview",
    assetUrl: null,
    url: null,
    canOpenDirectly: false,
    shouldExecuteInBrowser: false,
    requiresTextFetch: true,
    canShowSource: true,
    ...overrides,
  };
}

describe("SharedContentViewer", () => {
  it("renders inline markdown without fetching", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    renderViewer(viewer({ kind: "markdown" }), "# Hello");

    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches text content when required and no inline content exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Fetched source", { status: 200 }),
    );

    renderViewer(viewer({ kind: "code", assetUrl: "/asset.txt", url: "/asset.txt" }));

    await waitFor(() => expect(screen.getByText("Fetched source")).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalledWith("/asset.txt", { credentials: "include" });
  });

  it("renders html content inside a sandboxed iframe", () => {
    renderViewer(viewer({ kind: "html_sandbox" }), "<h1>Preview</h1>");

    const frame = screen.getByTestId("work-product-html-frame");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  });

  it("renders download fallback with an external open link", () => {
    renderViewer(
      viewer({
        kind: "download",
        label: "Open externally",
        assetUrl: "/bundle.zip",
        url: "/bundle.zip",
        requiresTextFetch: false,
        canShowSource: false,
      }),
    );

    expect(screen.getByTestId("preview-output-download")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/bundle.zip");
  });

  it("delegates pdf rendering to PdfDocumentViewer", () => {
    renderViewer(
      viewer({
        kind: "pdf",
        label: "PDF preview",
        assetUrl: "/report.pdf",
        url: "/report.pdf",
        requiresTextFetch: false,
        canShowSource: false,
      }),
    );

    expect(screen.getByTestId("pdf-viewer")).toHaveTextContent("example.md:/report.pdf");
  });

  it("renders inline code as source text", () => {
    renderViewer(viewer({ kind: "code" }), "const x = 1;");
    expect(screen.getByTestId("work-product-source")).toHaveTextContent("const x = 1;");
  });

  // P3.2 discriminator: the code viewer now emits highlight.js token spans.
  // Ablation: the old `SourceOutputViewer` rendered `<pre>{content}</pre>` with
  // ZERO child elements, so `querySelector("span.hljs-keyword")` was null and
  // this assertion failed. The filename drives the language (`snippet.js` → js).
  it("highlights the code viewer with token spans (not a plain <pre>)", () => {
    renderViewer(viewer({ kind: "code" }), "const x = 1;", "snippet.js");
    const source = screen.getByTestId("work-product-source");
    const keyword = source.querySelector("span.hljs-keyword");
    expect(keyword).not.toBeNull();
    expect(keyword).toHaveTextContent("const");
    // The visible text is intact — highlighting only wraps, never mutates.
    expect(source).toHaveTextContent("const x = 1;");
    // The <code> container carries the hljs class the theme CSS targets.
    expect(source.querySelector("code.hljs")).not.toBeNull();
  });

  it("escapes HTML in the code viewer output (XSS-safe highlighting)", () => {
    renderViewer(viewer({ kind: "code" }), "<script>alert(1)</script>", "x.js");
    const source = screen.getByTestId("work-product-source");
    // No live <script> element is injected into the DOM.
    expect(source.querySelector("script")).toBeNull();
    expect(source).toHaveTextContent("<script>alert(1)</script>");
  });

  it("highlights fenced code blocks in markdown, leaving inline code plain", () => {
    renderViewer(
      viewer({ kind: "markdown" }),
      "Run `npm i` first.\n\n```js\nconst x = 1;\n```\n",
    );
    const md = screen.getByTestId("work-product-markdown");
    // Fenced block → highlighted <code class="hljs language-js"> with token spans.
    const fenced = md.querySelector("code.hljs.language-js");
    expect(fenced).not.toBeNull();
    expect(fenced!.querySelector("span.hljs-keyword")).not.toBeNull();
    // Inline code (`npm i`) is left plain — no hljs class.
    const inlineCodes = Array.from(md.querySelectorAll("code")).filter(
      (el) => !el.classList.contains("hljs"),
    );
    expect(inlineCodes.some((el) => el.textContent === "npm i")).toBe(true);
  });

  it("renders a CSV table, honoring the comma delimiter and quoted fields", () => {
    renderViewer(viewer({ kind: "table", delimiter: "," }), 'name,city\n"Smith, John",NYC');
    const table = screen.getByTestId("work-product-table");
    expect(table).toHaveTextContent("name");
    expect(table).toHaveTextContent("Smith, John"); // quoted comma kept as one cell
    expect(table).toHaveTextContent("NYC");
  });

  it("renders a TSV table when the resolved delimiter is a tab (delimiter prop is honored)", () => {
    renderViewer(viewer({ kind: "table", delimiter: "\t" }), "name\tcity\nSmith, John\tNYC");
    const table = screen.getByTestId("work-product-table");
    // The comma is a literal inside the tab-delimited cell, not a column break.
    expect(table).toHaveTextContent("Smith, John");
    expect(table).toHaveTextContent("NYC");
  });

  it("renders pretty-printed JSON", () => {
    renderViewer(viewer({ kind: "json" }), '{"ok":true,"count":2}');
    const json = screen.getByTestId("work-product-json");
    expect(json).toHaveTextContent('"ok": true');
    expect(json).toHaveTextContent('"count": 2');
  });

  it("renders an aoa-canvas document by its node labels", () => {
    const canvas = JSON.stringify({ nodes: [{ id: "1", label: "Plan" }, { id: "2", label: "Decision" }] });
    renderViewer(viewer({ kind: "canvas" }), canvas);
    const el = screen.getByTestId("work-product-canvas");
    expect(el).toHaveTextContent("Plan");
    expect(el).toHaveTextContent("Decision");
  });
});
