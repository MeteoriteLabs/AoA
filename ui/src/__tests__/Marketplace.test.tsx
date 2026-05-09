import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockCompanyContext, mockDialogContext } from "./test-utils";
import Marketplace from "../pages/Marketplace";
import type { CatalogItem, MarketplaceCatalogFile } from "@armyofagents/shared";
import { usePackages } from "@/hooks/usePackages";

const mockCatalog: MarketplaceCatalogFile = {
  schemaVersion: "1.0.0",
  generatedAt: "2026-05-01T00:00:00Z",
  itemCount: 4,
  items: [
    {
      id: "skill:office-hours", type: "skill", name: "/office-hours",
      description: "YC product interrogation", version: "1.0.0",
      source: { adapter: "github", url: "https://github.com/garrytan/gstack", locator: "office-hours" },
      trust: { tier: "verified", source: "x" }, status: "active", addedAt: "2026-05-01T00:00:00Z",
      category: "engineering", tags: ["featured"], featured: true,
    } as CatalogItem,
    {
      id: "plugin:gh", type: "plugin", name: "github-issues",
      description: "GH sync", version: "1.0.0",
      source: { adapter: "github", url: "https://github.com/anthropic/plugin-gh", locator: "github-issues" },
      npm: { packageName: "@aoa/gh", version: "1.0.0" },
      trust: { tier: "verified", source: "x" }, status: "active", addedAt: "2026-05-02T00:00:00Z",
      category: "integrations", tags: [],
    } as CatalogItem,
    {
      id: "agent:claude-eng", type: "agent", name: "claude-engineer",
      description: "Engineer agent", version: "1.0.0",
      source: { adapter: "github", url: "https://github.com/anthropic/agents", locator: "claude-engineer" },
      trust: { tier: "community", source: "x" }, status: "active", addedAt: "2026-04-01T00:00:00Z",
      category: "engineering", tags: [],
    } as CatalogItem,
    {
      id: "team:product", type: "team", name: "product-team",
      description: "Multi-agent product team", version: "1.0.0",
      source: { adapter: "github", url: "https://github.com/aoa/teams", locator: "product-team" },
      trust: { tier: "community", source: "x" }, status: "active", addedAt: "2026-03-01T00:00:00Z",
      category: "engineering", tags: [],
    } as CatalogItem,
  ],
};

vi.mock("@/hooks/useCatalog", () => ({
  useCatalog: () => ({ data: mockCatalog, isLoading: false, error: null }),
}));

vi.mock("@/hooks/usePackages", () => ({
  usePackages: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn().mockReturnValue({ data: [], isLoading: false }),
  };
});

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("@/context/DialogContext", () => ({ useDialog: () => mockDialogContext }));

vi.mock("@/components/LobbySidebar", () => ({
  LobbySidebar: () => <aside data-testid="lobby-sidebar" />,
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: any) => <>{children}</>,
  SheetContent: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/UserMenu", () => ({ UserMenu: () => <div /> }));

vi.mock("@/components/marketplace/install/SnapshotInstallModal", () => ({
  SnapshotInstallModal: () => null,
}));

vi.mock("@/components/marketplace/install/PluginInstallModal", () => ({
  PluginInstallModal: () => null,
}));

describe("Marketplace (hub)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePackages).mockReturnValue({
      data: [
        {
          id: "garrytan/gstack",
          name: "gstack",
          sourceUrl: "https://github.com/garrytan/gstack",
          memberItemIds: ["skill:office-hours", "skill:qa"],
          count: 2,
          verified: true,
          explicit: false,
        },
      ],
      isLoading: false,
      error: null,
    } as any);
  });

  it("renders inside LobbyShell with marketplace active", () => {
    renderWithProviders(<Marketplace />);
    expect(screen.getAllByTestId("lobby-sidebar").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the filter chip row with all 5 chips", () => {
    renderWithProviders(<Marketplace />);
    // "All" appears in both FilterChips and SubfilterChips rows — just check at least one exists
    expect(screen.getAllByRole("button", { name: /^all$/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /skills/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plugins/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /agents/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /teams/i })).toBeInTheDocument();
  });

  it("clicking the Skills chip filters the grid to skill items", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Marketplace />);
    await user.click(screen.getByRole("button", { name: /skills/i }));
    // Skill is shown, plugin name is not.
    expect(screen.getByText("/office-hours")).toBeInTheDocument();
    expect(screen.queryByText("github-issues")).not.toBeInTheDocument();
  });

  it("renders the sub-filter chip row with sort modes", () => {
    renderWithProviders(<Marketplace />);
    expect(screen.getByRole("button", { name: /featured$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /recently added/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /a–z/i })).toBeInTheDocument();
  });

  it("clicking Featured filters to items with featured=true", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Marketplace />);
    await user.click(screen.getByRole("button", { name: /featured$/i }));
    expect(screen.getByText("/office-hours")).toBeInTheDocument();
    expect(screen.queryByText("github-issues")).not.toBeInTheDocument();
  });

  it("renders a mobile hamburger button (md:hidden)", () => {
    renderWithProviders(<Marketplace />);
    expect(screen.getByRole("button", { name: /open menu/i })).toBeInTheDocument();
  });

  it("renders the Packages section heading when type filter is null", () => {
    renderWithProviders(<Marketplace />);
    expect(screen.getByText(/^packages$/i)).toBeInTheDocument();
  });

  it("renders package cards when packages are available", () => {
    renderWithProviders(<Marketplace />);
    // gstack is the only package fixture
    expect(screen.getByText("gstack")).toBeInTheDocument();
  });

  it("hides the Packages section when a specific type filter is active", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Marketplace />);
    await user.click(screen.getByRole("button", { name: /skills/i }));
    expect(screen.queryByText(/^packages$/i)).not.toBeInTheDocument();
    expect(screen.queryByText("gstack")).not.toBeInTheDocument();
  });
});
