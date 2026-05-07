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

// --- Tests ---

describe("LobbySidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.companies = [];
    mockCompanyContext.loading = false;
  });

  it("renders the AoA brand", () => {
    renderWithProviders(<LobbySidebar />);
    expect(screen.getByText("AoA")).toBeInTheDocument();
  });

  it("renders the three nav rows: Companies, Marketplace, Settings", () => {
    renderWithProviders(<LobbySidebar />);
    expect(screen.getByRole("button", { name: /companies/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /marketplace/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("renders the UserMenu at the bottom", () => {
    renderWithProviders(<LobbySidebar />);
    expect(screen.getByTestId("user-menu")).toBeInTheDocument();
  });

  it("clicking Marketplace navigates to /marketplace", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LobbySidebar />);
    await user.click(screen.getByRole("button", { name: /marketplace/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/marketplace", undefined);
  });

  it("clicking Settings navigates to /instance/settings", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LobbySidebar />);
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(mockNavigate).toHaveBeenCalledWith("/instance/settings", undefined);
  });

  it("has an aside element with role complementary", () => {
    const { container } = renderWithProviders(<LobbySidebar />);
    const aside = container.querySelector("aside");
    expect(aside).toBeTruthy();
  });

  // PR-C polish: sidebar slides in from the left on mount via CSS keyframes.
  // The animation respects prefers-reduced-motion via a media query in index.css.
  it("applies the lobby-sidebar-enter mount-animation class", () => {
    const { container } = renderWithProviders(<LobbySidebar />);
    const aside = container.querySelector("aside");
    expect(aside).toBeTruthy();
    expect(aside!.className).toContain("lobby-sidebar-enter");
  });
});
