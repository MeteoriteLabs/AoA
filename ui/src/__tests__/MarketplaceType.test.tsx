import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import MarketplaceType from "@/pages/MarketplaceType";
import { marketplaceApi } from "@/api/marketplace";
import { FULL_CATALOG } from "@/__tests__/__fixtures__/marketplace-catalog";

vi.mock("@/api/marketplace", async () => {
  const actual = await vi.importActual<typeof import("@/api/marketplace")>("@/api/marketplace");
  return { ...actual, marketplaceApi: { getCatalog: vi.fn() } };
});

function wrap(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/marketplace/:type" element={<MarketplaceType />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MarketplaceType", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders only items of the requested type", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap("/marketplace/plugin");

    await waitFor(() => expect(screen.getByText("Slack")).toBeInTheDocument());
    expect(screen.queryByText("Code Review")).not.toBeInTheDocument();
    expect(screen.queryByText("Engineer")).not.toBeInTheDocument();
    expect(screen.queryByText("Engineering Team")).not.toBeInTheDocument();
  });

  it("renders 404-style message for unknown type", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap("/marketplace/widget");
    await waitFor(() => expect(screen.getByText(/unknown item type/i)).toBeInTheDocument());
  });

  it("filters by tag chip click (AND logic)", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap("/marketplace/skill");

    // Both skills should be visible initially
    await waitFor(() => expect(screen.getByText("Code Review")).toBeInTheDocument());
    expect(screen.getByText("Quick Tip")).toBeInTheDocument();

    // CODE_REVIEW_SKILL has tag "official", COMMUNITY_SKILL has tag "new" (per M.3a.B fixtures)
    // Click "official" chip — only CODE_REVIEW_SKILL stays
    const officialChip = screen.getAllByRole("button").find(
      (b) => b.textContent?.trim() === "official"
    );
    expect(officialChip).toBeDefined();
    await userEvent.click(officialChip!);

    expect(screen.getByText("Code Review")).toBeInTheDocument();
    expect(screen.queryByText("Quick Tip")).not.toBeInTheDocument();
  });
});
