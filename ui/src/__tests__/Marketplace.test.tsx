import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import Marketplace from "@/pages/Marketplace";
import { marketplaceApi } from "@/api/marketplace";
import { FULL_CATALOG, EMPTY_CATALOG } from "@/__tests__/__fixtures__/marketplace-catalog";
import { mockCompanyContext } from "@/__tests__/test-utils";

vi.mock("@/api/marketplace", async () => {
  const actual = await vi.importActual<typeof import("@/api/marketplace")>("@/api/marketplace");
  return { ...actual, marketplaceApi: { getCatalog: vi.fn() } };
});

// MarketplaceLayout > useNavigate (custom router) > useActiveCompanyPrefix > useCompany.
// Other UI tests in this directory follow the same file-level mock pattern.
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Marketplace homepage", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("shows loading state initially (skeleton placeholders, no hero)", () => {
    vi.mocked(marketplaceApi.getCatalog).mockImplementation(() => new Promise(() => {}));
    const { container } = wrap(<Marketplace />);
    // The loading branch renders skeleton placeholders inside MarketplaceLayout.
    // Hero h1 ("Extend your workforce") only appears once data loads, so its
    // absence is the most reliable loading-state signal.
    expect(container.querySelector("h1")).toBeNull();
  });

  it("renders the hero, type pills and category grid with a full catalog", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap(<Marketplace />);

    // Hero
    await waitFor(() =>
      expect(screen.getByText(/extend your workforce/i)).toBeInTheDocument(),
    );

    // Type pills (4 across the top)
    expect(screen.getByText("Plugins")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("Teams")).toBeInTheDocument();

    // FULL_CATALOG has at least one item — its name appears as a card heading
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(0);
  });

  it("renders the homepage with an empty catalog (counts read 0 available)", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(EMPTY_CATALOG);
    wrap(<Marketplace />);

    await waitFor(() =>
      expect(screen.getByText(/extend your workforce/i)).toBeInTheDocument(),
    );

    // All four type pills show "0 available" when the catalog is empty
    expect(screen.getAllByText("0 available").length).toBe(4);
  });

  it("renders error state when catalog fetch fails", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockRejectedValueOnce(new Error("503 Catalog not yet synced"));
    wrap(<Marketplace />);

    await waitFor(() => expect(screen.getByText(/Could not load the marketplace/i)).toBeInTheDocument());
  });
});
