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

const mockGetHealth = vi.fn();

vi.mock("../api/health", () => ({
  healthApi: {
    get: (...args: unknown[]) => mockGetHealth(...args),
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

vi.mock("@/components/LobbySidebar", () => ({
  LobbySidebar: () => <aside data-testid="lobby-sidebar" />,
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/UserMenu", () => ({ UserMenu: () => <div /> }));

vi.mock("@/context/DialogContext", () => ({
  useDialog: () => ({ openOnboarding: vi.fn() }),
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
    mockGetHealth.mockResolvedValue({ status: "ok", deploymentMode: "authenticated" });
  });

  it("renders the Sign out button in the General tab", async () => {
    renderWithProviders(<InstanceSettingsPage />);
    expect(
      await screen.findByRole("button", { name: /sign out/i }),
    ).toBeInTheDocument();
  });

  it("renders the Sign out section heading and description", async () => {
    renderWithProviders(<InstanceSettingsPage />);
    const heading = await screen.findByRole("heading", { name: "Sign out", level: 2 });
    expect(heading).toBeInTheDocument();
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

  it("renders inside LobbyShell with settings active", () => {
    renderWithProviders(<InstanceSettingsPage />);
    expect(screen.getAllByTestId("lobby-sidebar").length).toBeGreaterThanOrEqual(1);
  });

  describe("Sign out section visibility by deployment mode", () => {
    it("hides the Sign out section when deploymentMode is local_trusted", async () => {
      mockGetHealth.mockResolvedValue({ status: "ok", deploymentMode: "local_trusted" });
      renderWithProviders(<InstanceSettingsPage />);

      // Wait for general settings to load so the General tab body is rendered.
      await screen.findByRole("heading", { name: /keyboard shortcuts/i });

      expect(
        screen.queryByRole("heading", { name: "Sign out", level: 2 }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /sign out/i }),
      ).not.toBeInTheDocument();
    });

    it("renders the Sign out section when deploymentMode is authenticated", async () => {
      mockGetHealth.mockResolvedValue({ status: "ok", deploymentMode: "authenticated" });
      renderWithProviders(<InstanceSettingsPage />);

      expect(
        await screen.findByRole("heading", { name: "Sign out", level: 2 }),
      ).toBeInTheDocument();
    });

    it("renders the Sign out section when deploymentMode is undefined (legacy)", async () => {
      mockGetHealth.mockResolvedValue({ status: "ok" });
      renderWithProviders(<InstanceSettingsPage />);

      expect(
        await screen.findByRole("heading", { name: "Sign out", level: 2 }),
      ).toBeInTheDocument();
    });
  });
});
