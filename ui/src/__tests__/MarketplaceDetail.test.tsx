import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import MarketplaceDetail from "@/pages/MarketplaceDetail";
import { marketplaceApi } from "@/api/marketplace";
import { FULL_CATALOG } from "@/__tests__/__fixtures__/marketplace-catalog";
import { ToastProvider } from "@/components/marketplace/toast/ToastProvider";
import { InstallToastSlot } from "@/components/marketplace/toast/InstallToastSlot";

vi.mock("@/api/marketplace", async () => {
  const actual = await vi.importActual<typeof import("@/api/marketplace")>("@/api/marketplace");
  return { ...actual, marketplaceApi: { getCatalog: vi.fn() } };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "c1",
    companies: [{ id: "c1", name: "Acme", status: "active" }],
  }),
}));

function wrap(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ToastProvider>
          <Routes>
            <Route path="/marketplace/:type/:slug/*" element={<MarketplaceDetail />} />
          </Routes>
          <InstallToastSlot />
        </ToastProvider>
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
    // MarketplaceDetail renders the version twice — once as a header badge and
    // once in the right-side metadata Version field — so we assert presence
    // rather than uniqueness.
    expect(screen.getAllByText("v1.0.0").length).toBeGreaterThanOrEqual(1);
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

  it("Install button opens install modal", async () => {
    vi.mocked(marketplaceApi.getCatalog).mockResolvedValueOnce(FULL_CATALOG);
    wrap("/marketplace/plugin/aoa-curated/aoa-plugin-slack");

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Slack" }),
      ).toBeInTheDocument(),
    );
    // Before opening, the only "Install" button is the page-level CTA.
    const installBtn = screen.getByRole("button", { name: /install/i });
    await userEvent.click(installBtn);
    // Modal title appears once dialog mounts.
    await waitFor(() => expect(screen.getByText("Install Slack")).toBeInTheDocument());
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
