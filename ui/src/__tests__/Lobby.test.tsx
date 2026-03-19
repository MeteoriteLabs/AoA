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

// --- Tests ---

describe("Lobby", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows 'Create Company' card", () => {
    mockCompanyContext.companies = [makeCompany()];

    renderWithProviders(<Lobby />);

    expect(screen.getByText("Create Company")).toBeInTheDocument();
  });

  it("click company card calls navigation", async () => {
    const user = userEvent.setup();
    const company = makeCompany({ id: "c1", name: "Acme Inc", issuePrefix: "ACME" });
    mockCompanyContext.companies = [company];

    renderWithProviders(<Lobby />);

    await user.click(screen.getByTestId("company-card-c1"));
    expect(mockNavigate).toHaveBeenCalledWith("/ACME/home");
  });

  it("handles 0 companies by triggering onboarding", () => {
    mockCompanyContext.companies = [];
    mockCompanyContext.loading = false;

    renderWithProviders(<Lobby />);

    expect(mockDialogContext.openOnboarding).toHaveBeenCalled();
  });

  it("shows loading state while companies are loading", () => {
    mockCompanyContext.loading = true;

    renderWithProviders(<Lobby />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});
