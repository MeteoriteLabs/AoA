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

function renderViewer(viewer: ViewerResolution, inlineTextContent: string | null = null) {
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
        filename="example.md"
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
});
