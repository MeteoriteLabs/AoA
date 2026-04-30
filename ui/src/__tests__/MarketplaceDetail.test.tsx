import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import MarketplaceDetail from "@/pages/MarketplaceDetail";
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
          <Route path="/marketplace/:type/:slug/*" element={<MarketplaceDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MarketplaceDetail", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders skill detail with inline README", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    // CODE_REVIEW_SKILL.id = "skill:aoa-curated/code-review"
    wrap("/marketplace/skill/aoa-curated/code-review");

    // Wait for the page to load — fixture has both a page-title h1 and a README
    // h1 from inline `# Code Review`, so multiple heading-1 matches indicate the
    // README rendered too. (Breadcrumb adds a third "Code Review" plain text.)
    await waitFor(() => {
      const headings = screen.getAllByRole("heading", { level: 1, name: "Code Review" });
      expect(headings.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByText(/Systematic code review/)).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    // Breadcrumb + page title + README heading → 3 matches.
    expect(screen.getAllByText("Code Review").length).toBeGreaterThan(1);
  });

  it("renders plugin detail with capabilities list", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap("/marketplace/plugin/aoa-curated/aoa-plugin-slack");

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Slack" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("companies.read")).toBeInTheDocument();
    expect(screen.getByText("issues.read")).toBeInTheDocument();
  });

  it("Install button shows M.3b coming-soon toast", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap("/marketplace/plugin/aoa-curated/aoa-plugin-slack");

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Slack" }),
      ).toBeInTheDocument(),
    );
    const installBtn = screen.getByRole("button", { name: /install/i });
    await userEvent.click(installBtn);
    await waitFor(() => expect(screen.getByText(/coming in M\.3b/i)).toBeInTheDocument());
  });

  it("renders 404 for unknown item id", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap("/marketplace/skill/nonexistent/item");
    await waitFor(() => expect(screen.getByText(/Item not found/)).toBeInTheDocument());
  });

  it("renders dependencies section for items with requires", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap("/marketplace/team/aoa-curated/engineering");

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Engineering Team" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Dependencies")).toBeInTheDocument();
    expect(screen.getByText(/agent:aoa-curated\/engineer/)).toBeInTheDocument();
    expect(screen.getByText(/skill:aoa-curated\/code-review/)).toBeInTheDocument();
  });
});
