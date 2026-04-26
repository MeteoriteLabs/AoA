import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockCompanyContext, makeCompany } from "./test-utils";
import { InstanceSettingsPage } from "../pages/InstanceSettingsPage";

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

// ── API mocks ─────────────────────────────────────────────────────────────────

const mockGetGeneral = vi.fn();
const mockUpdateGeneral = vi.fn();
const mockGetExperimental = vi.fn();
const mockUpdateExperimental = vi.fn();

vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: {
    getGeneral: (...args: unknown[]) => mockGetGeneral(...args),
    updateGeneral: (...args: unknown[]) => mockUpdateGeneral(...args),
    getExperimental: (...args: unknown[]) => mockGetExperimental(...args),
    updateExperimental: (...args: unknown[]) => mockUpdateExperimental(...args),
  },
}));

const mockSignOut = vi.fn();

vi.mock("../api/auth", () => ({
  authApi: {
    getSession: vi.fn(),
    signInEmail: vi.fn(),
    signUpEmail: vi.fn(),
    signOut: (...args: unknown[]) => mockSignOut(...args),
  },
}));

// feedbackApi is only called when the Privacy tab is active — not needed here.
vi.mock("../api/feedback", () => ({
  feedbackApi: {
    listExports: vi.fn().mockResolvedValue([]),
  },
}));

// Stub out heavy sub-components that live on other tabs
vi.mock("../components/settings/HeartbeatsTab", () => ({
  HeartbeatsTab: () => <div data-testid="heartbeats-tab-stub" />,
}));

vi.mock("../components/settings/PrivacyTab", () => ({
  PrivacyTab: () => <div data-testid="privacy-tab-stub" />,
}));

vi.mock("../pages/PluginManager", () => ({
  PluginManager: () => <div data-testid="plugin-manager-stub" />,
}));

// PageTabBar — keep it functional so tab switching works if needed
vi.mock("../components/PageTabBar", () => ({
  PageTabBar: ({ items, value, onValueChange }: any) => (
    <div data-testid="page-tab-bar">
      {items.map((item: any) => (
        <button
          key={item.value}
          data-testid={`tab-${item.value}`}
          aria-selected={value === item.value}
          onClick={() => onValueChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

// ── Default fixture data ───────────────────────────────────────────────────────

const defaultGeneralSettings = {
  censorUsernameInLogs: false,
  keyboardShortcuts: false,
};

const defaultExperimentalSettings = {
  enableIsolatedWorkspaces: false,
  autoRestartDevServerWhenIdle: false,
  enableWorkspaceTtlSweeper: false,
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("InstanceSettingsPage Sign out section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockCompanyContext.selectedCompany = makeCompany();
    mockCompanyContext.companies = [makeCompany()];
    mockGetGeneral.mockResolvedValue(defaultGeneralSettings);
    mockGetExperimental.mockResolvedValue(defaultExperimentalSettings);
    mockSignOut.mockResolvedValue(undefined);
  });

  it("renders the Sign out button in the General tab", async () => {
    renderWithProviders(<InstanceSettingsPage />);
    expect(
      await screen.findByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });

  it("renders the Sign out section heading and description", async () => {
    renderWithProviders(<InstanceSettingsPage />);
    // The heading "Sign out" appears both as an <h2> and as button text — use getAllByText
    const headings = await screen.findAllByText("Sign out");
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(
      await screen.findByText(/sign out of this AoA instance/i),
    ).toBeInTheDocument();
  });

  it("calls authApi.signOut on button click", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceSettingsPage />);

    const button = await screen.findByRole("button", { name: /sign out/i });
    await user.click(button);

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
  });

  it("disables the button while sign-out is pending", async () => {
    // Return a promise that never resolves so isPending stays true
    mockSignOut.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<InstanceSettingsPage />);

    const button = await screen.findByRole("button", { name: /sign out/i });
    await user.click(button);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /signing out/i }),
      ).toBeDisabled(),
    );
  });
});
