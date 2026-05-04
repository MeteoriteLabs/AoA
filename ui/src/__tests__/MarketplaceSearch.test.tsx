import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import MarketplaceSearch from "@/pages/MarketplaceSearch";
import { marketplaceApi } from "@/api/marketplace";
import { FULL_CATALOG } from "@/__tests__/__fixtures__/marketplace-catalog";
import { mockCompanyContext } from "@/__tests__/test-utils";

vi.mock("@/api/marketplace", async () => {
  const actual = await vi.importActual<typeof import("@/api/marketplace")>(
    "@/api/marketplace",
  );
  return { ...actual, marketplaceApi: { getCatalog: vi.fn() } };
});

// MarketplaceLayout uses the custom useNavigate which requires CompanyContext.
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

function wrap(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/marketplace/search" element={<MarketplaceSearch />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MarketplaceSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups results by type", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap("/marketplace/search?q=engineering");

    await waitFor(() =>
      expect(screen.getByText(/Search: "engineering"/)).toBeInTheDocument(),
    );
    expect(screen.getByText("Engineering Team")).toBeInTheDocument();
  });

  it("shows no-results state for unmatched query", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap("/marketplace/search?q=zzzznonexistent");

    await waitFor(() =>
      expect(screen.getByText(/No items match/)).toBeInTheDocument(),
    );
  });

  it("filters by category param when present", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap("/marketplace/search?q=&category=engineering");

    await waitFor(() =>
      expect(screen.getByText(/category: engineering/)).toBeInTheDocument(),
    );
  });
});
