import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockCompanyContext, mockBreadcrumbContext } from "./test-utils";
import { Team } from "../pages/Team";

const mockPushToast = vi.fn();
const mockUpdateRole = vi.fn().mockResolvedValue({});
const mockCreateInvite = vi.fn().mockResolvedValue({
  id: "invite-1",
  token: "token-1",
  inviteUrl: "/invite/token-1",
  expiresAt: new Date().toISOString(),
  allowedJoinTypes: "human",
});

let mockTeamSummary = {
  currentUser: {
    userId: "user-1",
    role: "founder",
    departmentId: null,
    permissions: {
      canAssignTasks: true,
      canInviteUsers: true,
      canManageRoles: true,
      canEditIdentityMemory: true,
    },
  },
  members: [
    {
      userId: "user-1",
      email: "founder@example.com",
      displayName: "Founder",
      avatarUrl: null,
      role: "founder",
      departmentId: null,
      departmentName: null,
      permissions: ["users:invite", "users:manage_permissions"],
      isCurrentUser: true,
    },
    {
      userId: "user-2",
      email: "lead@example.com",
      displayName: "Ops Lead",
      avatarUrl: null,
      role: "team_lead",
      departmentId: "dept-1",
      departmentName: "Operations",
      permissions: ["tasks:assign", "tasks:assign_scope"],
      isCurrentUser: false,
    },
  ],
  pendingInvites: [],
};

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => mockBreadcrumbContext,
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));

vi.mock("../hooks/useTeamAccess", () => ({
  useTeamAccess: () => ({
    summary: mockTeamSummary,
    permissions: mockTeamSummary.currentUser.permissions,
    isLoading: false,
  }),
}));

vi.mock("../api/projects", () => ({
  projectsApi: {
    list: vi.fn().mockResolvedValue([
      { id: "dept-1", name: "Operations", type: "department", color: "#111111" },
      { id: "dept-2", name: "Product", type: "department", color: "#222222" },
    ]),
  },
}));

vi.mock("../api/team", () => ({
  teamApi: {
    updateRole: (...args: unknown[]) => mockUpdateRole(...args),
  },
}));

vi.mock("../api/access", () => ({
  accessApi: {
    createCompanyInvite: (...args: unknown[]) => mockCreateInvite(...args),
  },
}));

describe("Team Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false;
    }
    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => {};
    }
    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = () => {};
    }
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {};
    }
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockTeamSummary = {
      currentUser: {
        userId: "user-1",
        role: "founder",
        departmentId: null,
        permissions: {
          canAssignTasks: true,
          canInviteUsers: true,
          canManageRoles: true,
          canEditIdentityMemory: true,
        },
      },
      members: [
        {
          userId: "user-1",
          email: "founder@example.com",
          displayName: "Founder",
          avatarUrl: null,
          role: "founder",
          departmentId: null,
          departmentName: null,
          permissions: ["users:invite", "users:manage_permissions"],
          isCurrentUser: true,
        },
        {
          userId: "user-2",
          email: "lead@example.com",
          displayName: "Ops Lead",
          avatarUrl: null,
          role: "team_lead",
          departmentId: "dept-1",
          departmentName: "Operations",
          permissions: ["tasks:assign", "tasks:assign_scope"],
          isCurrentUser: false,
        },
      ],
      pendingInvites: [],
    };
  });

  it("renders role badges for each member", async () => {
    renderWithProviders(<Team />);

    expect(await screen.findByText("Ops Lead")).toBeInTheDocument();
    expect(screen.getAllByText("Founder").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Team Lead").length).toBeGreaterThan(0);
    expect(screen.getByText(/lead@example\.com/i)).toBeInTheDocument();
  });

  it("prevents the last founder from demoting themselves", async () => {
    mockTeamSummary.members = [
      mockTeamSummary.members[0],
      {
        userId: "user-3",
        email: "member@example.com",
        displayName: "Member",
        avatarUrl: null,
        role: "team_member",
        departmentId: null,
        departmentName: null,
        permissions: [],
        isCurrentUser: false,
      },
    ];
    renderWithProviders(<Team />);

    const comboboxes = await screen.findAllByRole("combobox");
    expect(comboboxes[0]).toBeDisabled();
  });

  it("shows the invite first teammate CTA when only the founder exists", async () => {
    mockTeamSummary.members = [mockTeamSummary.members[0]];
    renderWithProviders(<Team />);

    expect(await screen.findByText("Invite your first team member")).toBeInTheDocument();
  });

  it("creates an invite with the selected role and department", async () => {
    const user = userEvent.setup();
    mockTeamSummary.members = [mockTeamSummary.members[0]];
    renderWithProviders(<Team />);

    await user.click((await screen.findAllByText("Invite teammate"))[0]!);
    await user.type(screen.getByLabelText("Email"), "lead@example.com");
    const comboboxes = screen.getAllByRole("combobox");
    await user.click(comboboxes[0]);
    await user.click(screen.getByText("Team lead"));
    await user.click(screen.getAllByRole("combobox")[1]);
    await user.click(screen.getByText("Operations"));
    await user.click(screen.getByText("Send invite"));

    await waitFor(() => {
      expect(mockCreateInvite).toHaveBeenCalledWith(
        "comp-1",
        expect.objectContaining({
          allowedJoinTypes: "human",
          defaultsPayload: expect.objectContaining({
            teamInvite: expect.objectContaining({
              email: "lead@example.com",
              role: "team_lead",
              projectId: "dept-1",
            }),
          }),
        }),
      );
    });
  });
});
