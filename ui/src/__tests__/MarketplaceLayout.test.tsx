import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import { MarketplaceLayout } from "../components/marketplace/MarketplaceLayout";

// --- Mocks ---

const mockNavigate = vi.fn();

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// CompanySelector pulls in CompanyContext / queries; stub for layout isolation.
vi.mock("../components/marketplace/CompanySelector", () => ({
  CompanySelector: () => <div data-testid="company-selector" />,
}));

// --- Tests ---

describe("MarketplaceLayout back arrow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a Go back button", () => {
    renderWithProviders(
      <MarketplaceLayout>
        <div>content</div>
      </MarketplaceLayout>,
    );
    expect(screen.getByLabelText(/go back/i)).toBeInTheDocument();
  });

  it("clicking the back arrow navigates back via browser history (-1) instead of /home", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MarketplaceLayout>
        <div>content</div>
      </MarketplaceLayout>,
    );

    await user.click(screen.getByLabelText(/go back/i));

    expect(mockNavigate).toHaveBeenCalledWith(-1);
    expect(mockNavigate).not.toHaveBeenCalledWith("/home");
    expect(mockNavigate).not.toHaveBeenCalledWith("/home", expect.anything());
  });
});
