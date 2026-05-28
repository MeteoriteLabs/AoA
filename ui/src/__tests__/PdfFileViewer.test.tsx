import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-pdf", () => ({
  Document: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Page: ({ pageNumber }: { pageNumber: number }) => <div>page {pageNumber}</div>,
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" } },
}));
vi.mock("react-pdf/dist/Page/TextLayer.css", () => ({}));
vi.mock("react-pdf/dist/Page/AnnotationLayer.css", () => ({}));

vi.mock("../api/memoryAssets", () => ({
  memoryAssetsApi: {
    get: vi.fn(async () => ({
      id: "a-1",
      fileName: "x.pdf",
      mimeType: "application/pdf",
      importJobId: null,
    })),
    contentUrl: () => "/test",
    list: vi.fn(async () => []),
  },
}));
vi.mock("../api/memory", () => ({
  memoryApi: { list: vi.fn(async () => []) },
}));

import { PdfFileViewer } from "../components/memory/viewers/PdfFileViewer";

describe("PdfFileViewer", () => {
  it("renders toolbar with filename + page nav", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PdfFileViewer companyId="co-1" assetId="a-1" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("x.pdf")).toBeInTheDocument());
    expect(screen.getByTestId("pdf-document-viewer")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous page")).toBeInTheDocument();
    expect(screen.getByLabelText("Next page")).toBeInTheDocument();
  });
});
