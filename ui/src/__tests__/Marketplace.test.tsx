import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockCompanyContext, mockDialogContext } from "./test-utils";
import Marketplace from "../pages/Marketplace";
import type { CatalogItem, MarketplaceCatalogFile, MarketplacePackage } from "@armyofagents/shared";
import { usePackages } from "@/hooks/usePackages";
import { useCatalog } from "@/hooks/useCatalog";

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
  useCatalog: vi.fn(),
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

// Page renders inside the persistent LobbyLayout shell; stub only the mobile
// hamburger it renders (shell chrome is covered by LobbyLayout.test.tsx).
vi.mock("@/components/LobbyShell", () => ({
  LobbyShellMobileMenuButton: ({ className }: any) => (
    <button aria-label="Open menu" className={className} />
  ),
}));

vi.mock("@/components/UserMenu", () => ({ UserMenu: () => <div /> }));

vi.mock("@/components/marketplace/install/SnapshotInstallModal", () => ({
  SnapshotInstallModal: () => null,
}));

vi.mock("@/components/marketplace/install/PluginInstallModal", () => ({
  PluginInstallModal: () => null,
}));

function makeFixtureItem(overrides: Partial<CatalogItem> & Pick<CatalogItem, "id" | "type" | "name">): CatalogItem {
  return {
    description: "fixture item",
    version: "1.0.0",
    source: { adapter: "github", url: "https://github.com/x/y", locator: overrides.id },
    trust: { tier: "community", source: "x" },
    status: "active",
    addedAt: "2026-05-01T00:00:00Z",
    category: "engineering",
    tags: [],
    ...overrides,
  } as CatalogItem;
}

describe("Marketplace (hub)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCatalog).mockReturnValue({
      data: mockCatalog,
      isLoading: false,
      error: null,
    } as any);
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

  it("shows Packages as the first top-level overview section on All", () => {
    renderWithProviders(<Marketplace />);
    const headers = screen.getAllByRole("heading", { level: 2 });
    expect(headers[0]).toHaveTextContent(/packages/i);
    expect(headers[1]).toHaveTextContent(/skills/i);
  });

  it("renders packages in the overview shelf on All", () => {
    renderWithProviders(<Marketplace />);
    const shelf = screen.getByTestId("marketplace-packages-overview");
    expect(shelf).toHaveTextContent("gstack");
    expect(shelf).toHaveClass("auto-cols-[calc(100vw-2rem)]");
    expect(shelf).toHaveClass("sm:auto-cols-[minmax(20rem,32rem)]");
  });

  it("hides the native overview shelf scrollbar and renders chevron controls", () => {
    renderWithProviders(<Marketplace />);
    const shelf = screen.getByTestId("marketplace-packages-overview-scroll");
    expect(shelf).toHaveClass("[&::-webkit-scrollbar]:hidden");
    expect(shelf).toHaveClass("[scrollbar-width:none]");
    expect(screen.getByRole("button", { name: /scroll packages left/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scroll packages right/i })).toBeInTheDocument();
  });

  it("hides the Packages strip when a non-Skills chip is active", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Marketplace />);
    await user.click(screen.getByRole("button", { name: /plugins/i }));
    expect(screen.queryByText(/^packages$/i)).not.toBeInTheDocument();
    expect(screen.queryByText("gstack")).not.toBeInTheDocument();
  });

  it("shows skill packages as an expandable grid before the skills grid when the Skills chip is active", async () => {
    const user = userEvent.setup();
    const manyPackages: MarketplacePackage[] = Array.from({ length: 7 }, (_, index) => ({
      id: `owner/package-${index + 1}`,
      name: `package-${index + 1}`,
      sourceUrl: `https://github.com/owner/package-${index + 1}`,
      memberItemIds: ["skill:office-hours"],
      count: index + 1,
      verified: true,
      explicit: false,
    }));
    vi.mocked(usePackages).mockReturnValue({
      data: manyPackages,
      isLoading: false,
      error: null,
    } as any);
    renderWithProviders(<Marketplace />);
    // Chip's accessible name is "Skills{count}" (e.g. "Skills1"); start-anchored partial match.
    await user.click(screen.getByRole("button", { name: /^skills/i }));
    const headers = screen.getAllByRole("heading", { level: 2 });
    expect(headers[0]).toHaveTextContent(/skill packages/i);
    expect(headers[1]).toHaveTextContent(/^skills/i);
    const section = screen.getByTestId("marketplace-skills-packages-grid");
    expect(section).toHaveTextContent("package-1");
    expect(section).not.toHaveTextContent("package-7");
    expect(screen.queryByRole("button", { name: /scroll skill packages/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /view more/i }));

    expect(section).toHaveTextContent("package-7");
    expect(screen.getByRole("button", { name: /show less/i })).toBeInTheDocument();
  });
});

describe("Marketplace (hub) — sections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCatalog).mockReturnValue({
      data: mockCatalog,
      isLoading: false,
      error: null,
    } as any);
    vi.mocked(usePackages).mockReturnValue({
      data: [], isLoading: false, error: null,
    } as any);
  });

  it("renders all four section headers in order Skills → Plugins → Agents → Teams", () => {
    renderWithProviders(<Marketplace />);
    const headers = screen.getAllByRole("heading", { level: 2 });
    const labels = headers.map((h) => h.textContent?.toLowerCase() ?? "");
    const idxSkill = labels.findIndex((l) => l.includes("skills"));
    const idxPlug = labels.findIndex((l) => l.includes("plugins"));
    const idxAgent = labels.findIndex((l) => l.includes("agents"));
    const idxTeam = labels.findIndex((l) => l.includes("teams"));
    expect(idxSkill).toBeGreaterThanOrEqual(0);
    expect(idxPlug).toBeGreaterThan(idxSkill);
    expect(idxAgent).toBeGreaterThan(idxPlug);
    expect(idxTeam).toBeGreaterThan(idxAgent);
  });

  it("hides a section whose post-filter item count is zero", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Marketplace />);
    // Sort = "Featured" — only office-hours is featured (a skill). Plugins/Agents/Teams sections must hide.
    await user.click(screen.getByRole("button", { name: /featured$/i }));
    const headers = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.toLowerCase() ?? "");
    const has = (label: string) => headers.some((h) => h.includes(label));
    expect(has("skills")).toBe(true);
    expect(has("plugins")).toBe(false);
    expect(has("agents")).toBe(false);
    expect(has("teams")).toBe(false);
  });

  it("clicking 'See all →' on a section sets the type chip to that type", async () => {
    // Override the default catalog so Skills overflows the cap (need > 6 skills)
    const overflow = Array.from({ length: 8 }).map((_, i) =>
      makeFixtureItem({ id: `skill:s${i}`, type: "skill", name: `skill-${i}` }),
    );
    vi.mocked(useCatalog).mockReturnValue({
      data: { schemaVersion: "1.0.0", generatedAt: "2026-05-01T00:00:00Z", itemCount: 8, items: overflow },
      isLoading: false, error: null,
    } as any);
    const user = userEvent.setup();
    renderWithProviders(<Marketplace />);
    const seeAll = screen.getByRole("button", { name: /see all/i });
    await user.click(seeAll);
    // After clicking "See all", the Skills chip should be in the active state.
    // Chip's accessible name is "Skills{count}" — start-anchored partial match.
    const skillsChip = screen.getByRole("button", { name: /^skills/i });
    expect(skillsChip).toHaveAttribute("data-active", "true");
  });

  it("caps each section at SECTION_CAP items in the all-view", async () => {
    const overflow = Array.from({ length: 8 }).map((_, i) =>
      makeFixtureItem({ id: `skill:s${i}`, type: "skill", name: `skill-${i}` }),
    );
    vi.mocked(useCatalog).mockReturnValue({
      data: { schemaVersion: "1.0.0", generatedAt: "2026-05-01T00:00:00Z", itemCount: 8, items: overflow },
      isLoading: false, error: null,
    } as any);
    renderWithProviders(<Marketplace />);
    // Only first 6 skill names should render; the 7th and 8th are clipped.
    expect(screen.getByText("skill-0")).toBeInTheDocument();
    expect(screen.getByText("skill-5")).toBeInTheDocument();
    expect(screen.queryByText("skill-6")).not.toBeInTheDocument();
    expect(screen.queryByText("skill-7")).not.toBeInTheDocument();
  });

  it("removes the cap when a single type chip is active (single-section view)", async () => {
    const overflow = Array.from({ length: 8 }).map((_, i) =>
      makeFixtureItem({ id: `skill:s${i}`, type: "skill", name: `skill-${i}` }),
    );
    vi.mocked(useCatalog).mockReturnValue({
      data: { schemaVersion: "1.0.0", generatedAt: "2026-05-01T00:00:00Z", itemCount: 8, items: overflow },
      isLoading: false, error: null,
    } as any);
    const user = userEvent.setup();
    renderWithProviders(<Marketplace />);
    // Chip's accessible name is "Skills{count}" — start-anchored partial match.
    await user.click(screen.getByRole("button", { name: /^skills/i }));
    // All 8 should render now.
    expect(screen.getByText("skill-0")).toBeInTheDocument();
    expect(screen.getByText("skill-7")).toBeInTheDocument();
  });

  it("hides 'See all →' when a section's total fits inside the cap", () => {
    // Default fixture has 1 of each type — far below SECTION_CAP=6.
    renderWithProviders(<Marketplace />);
    expect(screen.queryByRole("button", { name: /see all/i })).not.toBeInTheDocument();
  });
});
