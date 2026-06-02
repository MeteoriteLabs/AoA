import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { MemoryAssetRecord } from "@armyofagents/shared";
import { MemoryViewer } from "../MemoryViewer";
import { memoryAssetsApi } from "../../../api/memoryAssets";
import type { MemoryTab } from "../../../lib/memoryTabs";

vi.mock("../../../api/memoryAssets", () => ({
  memoryAssetsApi: {
    get: vi.fn(),
    contentUrl: vi.fn((companyId: string, id: string) => `/api/companies/${companyId}/memory/assets/${id}/content`),
  },
}));

vi.mock("../../viewers/SharedContentViewer", () => ({
  SharedContentViewer: ({
    viewer,
    filename,
  }: {
    viewer: { kind: string; assetUrl: string | null; url: string | null };
    filename: string;
  }) => (
    <div data-testid="shared-content-viewer">
      {viewer.kind}:{filename}:{viewer.assetUrl ?? viewer.url}
    </div>
  ),
}));

vi.mock("../viewers/DocxFileViewer", () => ({
  DocxFileViewer: ({ companyId, assetId }: { companyId: string; assetId: string }) => (
    <div data-testid="docx-file-viewer">{companyId}:{assetId}</div>
  ),
}));

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function asset(overrides: Partial<MemoryAssetRecord>): MemoryAssetRecord {
  return {
    id: "asset-1",
    companyId: "co-1",
    departmentId: null,
    folderPath: "/",
    fileName: "file.bin",
    mimeType: "application/octet-stream",
    fileSize: 123,
    storageKey: "memory/asset-1",
    importJobId: null,
    extractedItemCount: 0,
    metadata: null,
    uploadedByUserId: null,
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

function renderAssetViewer(record: MemoryAssetRecord) {
  vi.mocked(memoryAssetsApi.get).mockResolvedValue(record);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tabs: MemoryTab[] = [{ id: record.id, kind: "asset", title: record.fileName }];

  return render(
    <QueryClientProvider client={client}>
      <MemoryViewer
        companyId="co-1"
        tabs={tabs}
        activeKey={{ id: record.id, kind: "asset" }}
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("MemoryViewer asset routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["application/pdf", "report.pdf", "pdf"],
    ["image/png", "diagram.png", "image"],
    ["video/mp4", "demo.mp4", "video"],
    ["application/x-zip-compressed", "bundle.zip", "download"],
  ])("routes %s assets through the shared %s viewer path", async (mimeType, fileName, viewerKind) => {
    renderAssetViewer(asset({ mimeType, fileName }));

    await waitFor(() => expect(screen.getByTestId("shared-content-viewer")).toBeInTheDocument());
    expect(screen.getByTestId("shared-content-viewer")).toHaveTextContent(
      `${viewerKind}:${fileName}:/api/companies/co-1/memory/assets/asset-1/content`,
    );
    expect(screen.queryByTestId("docx-file-viewer")).not.toBeInTheDocument();
  });

  it("keeps DOCX assets on the Memory-specific DOCX viewer", async () => {
    renderAssetViewer(asset({ mimeType: DOCX_MIME, fileName: "brief.docx" }));

    await waitFor(() => expect(screen.getByTestId("docx-file-viewer")).toBeInTheDocument());
    expect(screen.getByTestId("docx-file-viewer")).toHaveTextContent("co-1:asset-1");
    expect(screen.queryByTestId("shared-content-viewer")).not.toBeInTheDocument();
  });
});
