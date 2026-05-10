import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockCompanyContext, mockBreadcrumbContext } from "./test-utils";
import { TeamPage } from "../pages/TeamPage";

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => mockBreadcrumbContext,
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: false, setCollapsed: vi.fn() }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({ openNewAgent: vi.fn() }),
}));

vi.mock("../hooks/useTeamAccess", () => ({
  useTeamAccess: () => ({
    summary: null,
    permissions: {
      canAssignTasks: false,
      canInviteUsers: false,
      canManageRoles: false,
      canEditIdentityMemory: false,
    },
    isLoading: false,
  }),
}));

vi.mock("../api/agents", () => ({
  agentsApi: {
    list: vi.fn().mockResolvedValue([]),
    org: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../api/projects", () => ({
  projectsApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../api/team", () => ({
  teamApi: {
    get: vi.fn().mockResolvedValue({ members: [], pendingInvites: [] }),
    updateRole: vi.fn().mockResolvedValue({}),
  },
}));

describe("TeamPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
  });

  it("renders the team sections", () => {
    renderWithProviders(<TeamPage />);

    expect(screen.getByText("Org Tree")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("Humans")).toBeInTheDocument();
    expect(screen.getByText("Teams")).toBeInTheDocument();
  });

  it("defaults to Org Tree tab", () => {
    renderWithProviders(<TeamPage />);

    expect(screen.getByRole("tab", { name: /org tree/i })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("switches tabs when clicking", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamPage />);

    await user.click(screen.getByText("Agents"));

    expect(screen.getByRole("tab", { name: /agents/i })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("opens correct tab from direct URL", () => {
    renderWithProviders(<TeamPage />, {
      initialEntries: ["/team?tab=humans"],
    });

    expect(screen.getByRole("tab", { name: /humans/i })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("falls back to Org Tree for invalid tab param", () => {
    renderWithProviders(<TeamPage />, {
      initialEntries: ["/team?tab=invalid"],
    });

    expect(screen.getByRole("tab", { name: /org tree/i })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  it("sets breadcrumbs to Team", () => {
    renderWithProviders(<TeamPage />);

    expect(mockBreadcrumbContext.setBreadcrumbs).toHaveBeenCalledWith([
      { label: "Team" },
    ]);
  });

  it("shows empty state when no company selected", () => {
    mockCompanyContext.selectedCompanyId = null;
    renderWithProviders(<TeamPage />);

    expect(
      screen.getByText("Select a company to view team."),
    ).toBeInTheDocument();
  });
});
