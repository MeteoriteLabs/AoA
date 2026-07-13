import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, makeCompany, mockCompanyContext, mockDialogContext } from "./test-utils";
import { Lobby } from "../pages/Lobby";

// --- Mocks ---

const mockNavigate = vi.fn();
const onboardingProgressByCompany = vi.hoisted(() => new Map<string, string[]>());

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
    useQueries: vi.fn(({ queries }: { queries: { queryKey: readonly unknown[] }[] }) =>
      queries.map((query) => ({
        data: { completedStates: onboardingProgressByCompany.get(String(query.queryKey[2])) ?? [] },
        isLoading: false,
      }))),
  };
});

vi.mock("@/lib/queryKeys", () => ({
  queryKeys: {
    companies: { stats: ["companies", "stats"] },
    auth: { profile: ["auth", "profile"] },
  },
}));

vi.mock("@/api/companies", () => ({
  companiesApi: { stats: vi.fn().mockResolvedValue({}) },
}));

vi.mock("@/api/profile", () => ({
  profileApi: { get: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/api/onboarding", () => ({
  getOnboardingProgress: vi.fn(),
}));

vi.mock("@/components/LobbyCompanyCard", () => ({
  LobbyCompanyCard: ({ company, onClick }: any) => (
    <button data-testid={`company-card-${company.id}`} onClick={onClick}>
      {company.name}
    </button>
  ),
}));

// The page now renders inside the persistent LobbyLayout shell; here we only
// need the mobile hamburger it renders. Stub it so the page doesn't require the
// real LobbyShell context (that chrome is covered by LobbyLayout.test.tsx).
vi.mock("@/components/LobbyShell", () => ({
  LobbyShellMobileMenuButton: ({ className }: any) => (
    <button aria-label="Open menu" className={className} />
  ),
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
    onboardingProgressByCompany.clear();
    mockCompanyContext.loading = false;
    mockCompanyContext.companies = [];
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

  // The lobby v4 redesign drops the top header bar entirely. The "+ New
  // company" CTA lives in the LobbySidebar (mocked in this file). Import
  // company is only surfaced from the empty state. Tests for the prior
  // header dropdown (+New menu, Create/Import items) are removed.

  it("does NOT render the legacy dashed Create/Import grid cards", () => {
    mockCompanyContext.companies = [makeCompany()];
    renderWithProviders(<Lobby />);
    expect(screen.queryByText("Create Company")).not.toBeInTheDocument();
    expect(screen.queryByText("Import Company")).not.toBeInTheDocument();
  });

  it("renders a hamburger button on mobile (md:hidden) that opens the drawer", () => {
    mockCompanyContext.companies = [makeCompany()];
    renderWithProviders(<Lobby />);
    expect(screen.getByRole("button", { name: /open menu/i })).toBeInTheDocument();
  });

  it("clicking a company card navigates to that company's home", async () => {
    const user = userEvent.setup();
    const company = makeCompany({ id: "c1", name: "Acme Inc", issuePrefix: "ACME" });
    mockCompanyContext.companies = [company];

    renderWithProviders(<Lobby />);

    await user.click(screen.getByTestId("company-card-c1"));
    expect(mockNavigate).toHaveBeenCalledWith("/ACME/home", undefined);
  });

  it("surfaces an interrupted founder's organization and resumes its onboarding", async () => {
    const user = userEvent.setup();
    const company = makeCompany({ id: "c1", name: "Acme Inc", issuePrefix: "ACME" });
    mockCompanyContext.companies = [company];
    onboardingProgressByCompany.set("c1", ["AUTHENTICATED", "PROFILE_SET", "ORGANIZATION_CREATED"]);

    renderWithProviders(<Lobby />);

    await user.click(screen.getByRole("button", { name: /finish setting up acme inc/i }));
    expect(mockCompanyContext.setSelectedCompanyId).toHaveBeenCalledWith("c1");
    expect(mockNavigate).toHaveBeenCalledWith("/onboarding", undefined);
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

  it("navigates to /onboarding when LobbyEmptyState's create button is clicked (C13)", async () => {
    const user = userEvent.setup();
    mockCompanyContext.companies = [];
    renderWithProviders(<Lobby />);
    await user.click(screen.getByTestId("empty-create"));
    expect(mockNavigate).toHaveBeenCalledWith("/onboarding", undefined);
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

  // Mount choreography classes are applied to heading + each card wrapper.
  // Sidebar's own .lobby-sidebar-enter class is asserted in
  // LobbySidebar.test.tsx (the sidebar is mocked in this file's renderer).
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
