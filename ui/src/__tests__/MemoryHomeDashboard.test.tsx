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
      { id: "i-1", title: "Item one", status: "pending", departmentId: "d-eng", layer: "domain", updatedAt: "2026-05-01T00:00:00Z" },
      { id: "i-2", title: "Item two", status: "approved", departmentId: "d-eng", layer: "domain", updatedAt: "2026-05-02T00:00:00Z" },
    ]),
  },
}));
vi.mock("../api/memoryAssets", () => ({
  memoryAssetsApi: { list: vi.fn(async () => []) },
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "co-1", selectedCompany: { issuePrefix: "co1" } }),
}));

import { MemoryHomeDashboard } from "../components/memory/MemoryHomeDashboard";

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MemoryHomeDashboard companyId="co-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MemoryHomeDashboard (Phase 6.2a)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders pending banner when there are pending items", async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText(/1 item waiting for your review/i)).toBeInTheDocument());
  });

  it("renders 4 layer tiles", async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText("Identity")).toBeInTheDocument());
    expect(screen.getByText("Domain")).toBeInTheDocument();
    expect(screen.getByText("Active Context")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
  });

  it("renders recents", async () => {
    renderHome();
    // The 2 items mock above sorted by updatedAt — Item two newer, Item one older
    await waitFor(() => expect(screen.getByText("Item two")).toBeInTheDocument());
    expect(screen.getByText("Item one")).toBeInTheDocument();
  });
});
