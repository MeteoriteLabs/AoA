import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import Marketplace from "@/pages/Marketplace";
import { marketplaceApi } from "@/api/marketplace";
import { FULL_CATALOG, EMPTY_CATALOG } from "@/__tests__/__fixtures__/marketplace-catalog";

vi.mock("@/api/marketplace", async () => {
  const actual = await vi.importActual<typeof import("@/api/marketplace")>("@/api/marketplace");
  return { ...actual, marketplaceApi: { getCatalog: vi.fn() } };
});

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

  it("shows loading state initially", () => {
    vi.mocked(marketplaceApi.getCatalog).mockImplementation(() => new Promise(() => {}));
    wrap(<Marketplace />);
    expect(screen.getByText(/loading marketplace/i)).toBeInTheDocument();
  });

  it("renders Featured + Recently Added + Browse sections", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap(<Marketplace />);

    await waitFor(() => expect(screen.queryByText(/loading marketplace/i)).not.toBeInTheDocument());

    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(screen.getByText("Recently Added")).toBeInTheDocument();
    expect(screen.getByText("Browse by type")).toBeInTheDocument();
    expect(screen.getByText("Browse by category")).toBeInTheDocument();

    // Featured: ENGINEERING_TEAM is featured
    expect(screen.getAllByText("Engineering Team").length).toBeGreaterThan(0);

    // Type tiles
    expect(screen.getByText("Plugins")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("Teams")).toBeInTheDocument();
  });

  it("renders empty state when catalog has 0 items", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(EMPTY_CATALOG);
    wrap(<Marketplace />);

    await waitFor(() => expect(screen.getByText(/no items in the marketplace yet/i)).toBeInTheDocument());
  });

  it("renders error state when catalog fetch fails", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockRejectedValueOnce(new Error("503 Catalog not yet synced"));
    wrap(<Marketplace />);

    await waitFor(() => expect(screen.getByText(/Could not load the marketplace/i)).toBeInTheDocument());
  });
});
