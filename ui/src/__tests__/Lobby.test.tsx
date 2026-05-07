import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, makeCompany, mockCompanyContext, mockDialogContext } from "./test-utils";
import { Lobby } from "../pages/Lobby";

// --- Mocks ---

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("@/context/DialogContext", () => ({
  useDialog: () => mockDialogContext,
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
  };
});

vi.mock("@/lib/queryKeys", () => ({
  queryKeys: { companies: { stats: ["companies", "stats"] } },
}));

vi.mock("@/api/companies", () => ({
  companiesApi: { stats: vi.fn().mockResolvedValue({}) },
}));

vi.mock("@/components/LobbyCompanyCard", () => ({
  LobbyCompanyCard: ({ company, onClick }: any) => (
    <button data-testid={`company-card-${company.id}`} onClick={onClick}>
      {company.name}
    </button>
  ),
}));

vi.mock("@/components/LobbySidebar", () => ({
  LobbySidebar: () => <aside data-testid="lobby-sidebar" />,
}));

vi.mock("@/components/LobbyEmptyState", () => ({
  LobbyEmptyState: ({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) => (
    <div data-testid="lobby-empty-state">
      <button data-testid="empty-create" onClick={onCreate}>create</button>
      <button data-testid="empty-import" onClick={onImport}>import</button>
    </div>
  ),
}));

vi.mock("@/components/UserMenu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

// --- Tests ---

describe("Lobby", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.loading = false;
    mockCompanyContext.companies = [];
  });

  it("renders the LobbySidebar", () => {
    mockCompanyContext.companies = [makeCompany()];
    renderWithProviders(<Lobby />);
    expect(screen.getByTestId("lobby-sidebar")).toBeInTheDocument();
  });

  it("renders company cards when companies exist", () => {
    const companies = [
      makeCompany({ id: "c1", name: "Acme Inc", issuePrefix: "ACME" }),
      makeCompany({ id: "c2", name: "Beta Corp", issuePrefix: "BETA" }),
    ];
    mockCompanyContext.companies = companies;

    renderWithProviders(<Lobby />);

    expect(screen.getByText("Acme Inc")).toBeInTheDocument();
    expect(screen.getByText("Beta Corp")).toBeInTheDocument();
  });

  it("renders a +New header dropdown trigger when companies exist", () => {
    mockCompanyContext.companies = [makeCompany()];
    renderWithProviders(<Lobby />);
    expect(screen.getByRole("button", { name: /\+ new/i })).toBeInTheDocument();
  });

  it("does NOT render the legacy dashed Create/Import grid cards", () => {
    mockCompanyContext.companies = [makeCompany()];
    renderWithProviders(<Lobby />);
    // Legacy cards rendered "Create Company" and "Import Company" inside the
    // grid. The +New dropdown surfaces them on demand instead, so they should
    // not be visible at idle.
    expect(screen.queryByText("Create Company")).not.toBeInTheDocument();
    expect(screen.queryByText("Import Company")).not.toBeInTheDocument();
  });

  it("opens the onboarding dialog when +New > Create company is selected", async () => {
    const user = userEvent.setup();
    mockCompanyContext.companies = [makeCompany()];

    renderWithProviders(<Lobby />);

    await user.click(screen.getByRole("button", { name: /\+ new/i }));
    await user.click(await screen.findByRole("menuitem", { name: /create company/i }));
    expect(mockDialogContext.openOnboarding).toHaveBeenCalled();
  });

  it("navigates to /import when +New > Import company is selected", async () => {
    const user = userEvent.setup();
    mockCompanyContext.companies = [makeCompany()];

    renderWithProviders(<Lobby />);

    await user.click(screen.getByRole("button", { name: /\+ new/i }));
    await user.click(await screen.findByRole("menuitem", { name: /import company/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/import", undefined);
  });

  it("clicking a company card navigates to that company's home", async () => {
    const user = userEvent.setup();
    const company = makeCompany({ id: "c1", name: "Acme Inc", issuePrefix: "ACME" });
    mockCompanyContext.companies = [company];

    renderWithProviders(<Lobby />);

    await user.click(screen.getByTestId("company-card-c1"));
    expect(mockNavigate).toHaveBeenCalledWith("/ACME/home", undefined);
  });

  it("renders LobbyEmptyState when there are 0 companies", () => {
    mockCompanyContext.companies = [];
    mockCompanyContext.loading = false;

    renderWithProviders(<Lobby />);

    expect(screen.getByTestId("lobby-empty-state")).toBeInTheDocument();
  });

  // Load-bearing regression test: the previous implementation auto-fired
  // openOnboarding from a useEffect when the lobby loaded with zero
  // companies. The new design replaces that with the LobbyEmptyState hero,
  // which is opt-in.
  it("does NOT auto-trigger openOnboarding with 0 companies (regression)", () => {
    mockCompanyContext.companies = [];
    mockCompanyContext.loading = false;

    renderWithProviders(<Lobby />);

    expect(mockDialogContext.openOnboarding).not.toHaveBeenCalled();
  });

  it("does NOT auto-trigger openOnboarding while companies are still loading", () => {
    mockCompanyContext.companies = [];
    mockCompanyContext.loading = true;

    renderWithProviders(<Lobby />);

    expect(mockDialogContext.openOnboarding).not.toHaveBeenCalled();
  });

  it("invokes openOnboarding when LobbyEmptyState's create button is clicked", async () => {
    const user = userEvent.setup();
    mockCompanyContext.companies = [];
    renderWithProviders(<Lobby />);
    await user.click(screen.getByTestId("empty-create"));
    expect(mockDialogContext.openOnboarding).toHaveBeenCalledTimes(1);
  });

  it("navigates to /import when LobbyEmptyState's import button is clicked", async () => {
    const user = userEvent.setup();
    mockCompanyContext.companies = [];
    renderWithProviders(<Lobby />);
    await user.click(screen.getByTestId("empty-import"));
    expect(mockNavigate).toHaveBeenCalledWith("/import", undefined);
  });

  it("shows loading state while companies are loading", () => {
    mockCompanyContext.loading = true;

    renderWithProviders(<Lobby />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  // Phase 2 lobby pilot: page background uses brand-red radial wash
  // anchored top-center (replaces the prior diagonal purple-wash gradient).
  // Per design-system §8.4: lobby surfaces get full brand-tinted radial wash.
  it("applies the brand-red radial wash gradient on the lobby root", () => {
    mockCompanyContext.companies = [makeCompany()];
    const { container } = renderWithProviders(<Lobby />);
    const root = container.firstChild as HTMLElement | null;
    expect(root).toBeTruthy();
    expect(root!.className).toMatch(/radial-gradient/);
    expect(root!.className).toContain("brand-focus-ring");
  });

  // PR-C polish: mount choreography classes are applied to heading + each card
  // wrapper. Sidebar's own .lobby-sidebar-enter class is asserted in
  // LobbySidebar.test.tsx (the sidebar is mocked in this file's renderer).
  // CSS-keyframe-driven animations respect prefers-reduced-motion via a media
  // query in index.css.
  it("applies mount-choreography animation classes to heading + card wrappers", () => {
    mockCompanyContext.companies = [
      makeCompany({ id: "c1", name: "Acme" }),
      makeCompany({ id: "c2", name: "Beta" }),
    ];
    const { container } = renderWithProviders(<Lobby />);

    expect(container.querySelector(".lobby-heading-enter")).toBeTruthy();

    const cardWrappers = container.querySelectorAll(".lobby-card-enter");
    expect(cardWrappers).toHaveLength(2);
    // Stagger index is set via inline CSS variable on each wrapper.
    expect((cardWrappers[0] as HTMLElement).style.getPropertyValue("--lobby-card-index")).toBe("0");
    expect((cardWrappers[1] as HTMLElement).style.getPropertyValue("--lobby-card-index")).toBe("1");
  });
});
