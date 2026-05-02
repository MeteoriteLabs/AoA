import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/router");
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("../api/memory", () => ({
  memoryApi: {
    list: vi.fn(async () => [
      {
        id: "i-pinned",
        title: "Pinned item",
        category: "decision",
        status: "approved",
        updatedAt: "2026-05-01T00:00:00Z",
        folderPath: "engineering/Decisions",
        founderPinnedToTop: true,
      },
      {
        id: "i-pending",
        title: "Pending item",
        category: "reference",
        status: "pending",
        updatedAt: "2026-05-02T00:00:00Z",
        folderPath: "marketing/Brand",
        founderPinnedToTop: false,
      },
      {
        id: "i-other",
        title: "Other item",
        category: "context",
        status: "approved",
        updatedAt: "2026-04-29T00:00:00Z",
        folderPath: "engineering/Decisions",
        founderPinnedToTop: false,
      },
    ]),
  },
}));
vi.mock("../api/memoryAssets", () => ({
  memoryAssetsApi: { list: vi.fn(async () => []) },
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "co-1",
    selectedCompany: { issuePrefix: "co1" },
  }),
}));

import { MemoryFileList } from "../components/memory/MemoryFileList";

function renderList(props: {
  folderPath: string;
  departmentId: string | null;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MemoryFileList
          companyId="co-1"
          folderPath={props.folderPath}
          departmentId={props.departmentId}
          selectedItemId={null}
          selectedItemType={null}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MemoryFileList — virtual folders (Phase 6.1e)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("__pinned shows only items with founderPinnedToTop=true", async () => {
    renderList({ folderPath: "__pinned", departmentId: null });
    await waitFor(() =>
      expect(screen.getByText("Pinned item")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Pending item")).not.toBeInTheDocument();
    expect(screen.queryByText("Other item")).not.toBeInTheDocument();
  });

  it("__pending shows only items with status=pending", async () => {
    renderList({ folderPath: "__pending", departmentId: null });
    await waitFor(() =>
      expect(screen.getByText("Pending item")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Pinned item")).not.toBeInTheDocument();
    expect(screen.queryByText("Other item")).not.toBeInTheDocument();
  });

  it("regular folder shows items with matching folderPath", async () => {
    renderList({
      folderPath: "engineering/Decisions",
      departmentId: "d-eng",
    });
    await waitFor(() =>
      expect(screen.getByText("Pinned item")).toBeInTheDocument(),
    );
    expect(screen.getByText("Other item")).toBeInTheDocument();
    expect(screen.queryByText("Pending item")).not.toBeInTheDocument();
  });
});
