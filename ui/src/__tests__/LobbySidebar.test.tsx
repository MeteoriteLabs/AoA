import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockCompanyContext } from "./test-utils";
import { LobbySidebar } from "../components/LobbySidebar";

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

// UserMenu pulls in profile/auth queries; stub it for sidebar isolation.
vi.mock("@/components/UserMenu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

// Tooltip from Radix needs a TooltipProvider context, which the test renderer
// doesn't supply. Stub Tooltip+children so collapsed-mode buttons render.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: any) => asChild ? children : <>{children}</>,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: any) => <>{children}</>,
}));

// --- Tests ---

describe("LobbySidebar", () => {
  const onCreateCompany = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onCreateCompany.mockClear();
    mockCompanyContext.companies = [];
    mockCompanyContext.loading = false;
    // Reset persisted collapse preference between tests so default is expanded.
    try {
      localStorage.removeItem("aoa.lobby.sidebar-collapsed");
    } catch {
      // noop
    }
  });

  it("renders the AoA brand wordmark", () => {
    renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    // Expanded brand renders "AoA" + a brand-red period span as siblings.
    expect(screen.getByText("AoA")).toBeInTheDocument();
  });

  it("renders the + New organization button at the top", () => {
    renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    expect(screen.getByRole("button", { name: /new organization/i })).toBeInTheDocument();
  });

  it("clicking + New organization calls the onCreateCompany handler", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    await user.click(screen.getByRole("button", { name: /new organization/i }));
    expect(onCreateCompany).toHaveBeenCalledTimes(1);
  });

  it("renders Organizations (active), Marketplace, Learn, Documentation, Settings", () => {
    renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    expect(screen.getByRole("button", { name: /organizations/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /marketplace/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /learn/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /documentation/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("Organizations row is the active item (data-active=true)", () => {
    renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    const orgs = screen.getByRole("button", { name: /organizations/i });
    expect(orgs.getAttribute("data-active")).toBe("true");
  });

  it("renders the UserMenu at the bottom", () => {
    renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    expect(screen.getByTestId("user-menu")).toBeInTheDocument();
  });

  it("renders the external collapse toggle button", () => {
    renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    expect(screen.getByRole("button", { name: /collapse sidebar/i })).toBeInTheDocument();
  });

  it("clicking Marketplace navigates to /marketplace", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    await user.click(screen.getByRole("button", { name: /marketplace/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/marketplace", undefined);
  });

  it("clicking Settings navigates to /instance/settings", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/instance/settings", undefined);
  });

  it("has an aside element", () => {
    const { container } = renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    const aside = container.querySelector("aside");
    expect(aside).toBeTruthy();
  });

  it("applies the lobby-sidebar-enter mount-animation class", () => {
    const { container } = renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    const aside = container.querySelector("aside");
    expect(aside).toBeTruthy();
    expect(aside!.className).toContain("lobby-sidebar-enter");
  });

  it("toggling the collapse button flips data-collapsed on the aside", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LobbySidebar onCreateCompany={onCreateCompany} />);
    const aside = container.querySelector("aside");
    expect(aside?.getAttribute("data-collapsed")).toBe("false");
    await user.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(aside?.getAttribute("data-collapsed")).toBe("true");
  });

  it("forces collapse when defaultCollapsed=true even if localStorage says expanded", () => {
    localStorage.setItem("aoa.lobby.sidebar-collapsed", "false");
    const { container } = renderWithProviders(
      <LobbySidebar onCreateCompany={onCreateCompany} defaultCollapsed activeItem="settings" />,
    );
    const aside = container.querySelector("aside");
    expect(aside?.getAttribute("data-collapsed")).toBe("true");
  });
});
