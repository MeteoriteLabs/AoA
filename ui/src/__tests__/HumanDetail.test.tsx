import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HumanDetail } from "../pages/HumanDetail";
import { teamApi } from "../api/team";
import { issuesApi } from "../api/issues";
import { activityApi } from "../api/activity";
import { assetsApi } from "../api/assets";
import { SidebarProvider } from "../context/SidebarContext";

const pushToast = vi.fn();

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast }),
}));

vi.mock("../api/team", () => ({
  teamApi: {
    get: vi.fn(),
    getMember: vi.fn(),
    updateRole: vi.fn(),
    updateProfile: vi.fn(),
  },
}));

vi.mock("../api/projects", () => ({
  projectsApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../api/issues", () => ({
  issuesApi: {
    list: vi.fn(),
  },
}));

vi.mock("../api/activity", () => ({
  activityApi: {
    list: vi.fn(),
  },
}));

vi.mock("../api/assets", () => ({
  assetsApi: {
    uploadImage: vi.fn(),
  },
}));

function renderHumanDetail(path = "/team/user-1") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/team/:userId" element={children} />
              <Route path="/team/:userId/:tab" element={children} />
            </Routes>
          </MemoryRouter>
        </SidebarProvider>
      </QueryClientProvider>
    );
  }

  return render(<HumanDetail />, { wrapper: Wrapper });
}

const member = {
  userId: "user-1",
  email: "ada@example.com",
  displayName: "Ada Lovelace",
  avatarUrl: null,
  title: "Product Lead",
  bio: "Turns founder intent into shipped operating systems.",
  location: "London",
  timezone: "Europe/London",
  socialLinks: [{ type: "github", label: "GitHub", url: "https://github.com/ada" }],
  avatarAssetId: null,
  role: "team_lead",
  departmentId: "dept-1",
  departmentName: "Product",
  permissions: ["tasks.assign"],
  isCurrentUser: true,
  isSystemAdmin: false,
  parentType: "user",
  parentId: "founder-1",
} as const;

const teamSummary = {
  currentUser: {
    userId: "user-1",
    role: "team_lead",
    departmentId: "dept-1",
    isSystemAdmin: false,
    permissions: {
      canAssignTasks: true,
      canInviteUsers: false,
      canManageRoles: false,
      canEditIdentityMemory: false,
    },
  },
  members: [
    member,
    {
      ...member,
      userId: "founder-1",
      email: "founder@example.com",
      displayName: "Grace Founder",
      role: "founder",
      isCurrentUser: false,
      parentId: null,
    },
  ],
  pendingInvites: [],
};

function issue(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "issue-1",
    companyId: "company-1",
    projectId: null,
    goalId: null,
    parentId: null,
    title: "Draft onboarding profile",
    description: null,
    status: "todo",
    priority: "medium",
    workMode: "standard",
    assigneeAgentId: null,
    assigneeUserId: "user-1",
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    executionWorkspaceId: null,
    executionEnvironmentId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    createdByAgentId: null,
    createdByUserId: "user-1",
    issueNumber: 42,
    identifier: "AOA-42",
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    source: null,
    reviewerUserId: null,
    dueDate: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    artifactId: null,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-02T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(teamApi.getMember).mockResolvedValue({
    member,
    dependencies: {
      teamMembers: [],
      agentTrees: [{ rootAgentId: "agent-1", rootAgentName: "Ops Agent", subAgentCount: 1, agentIds: ["agent-1", "agent-2"] }],
      assignedTaskCount: 1,
      createdTaskCount: 1,
    },
  });
  vi.mocked(teamApi.get).mockResolvedValue(teamSummary);
  vi.mocked(teamApi.updateProfile).mockResolvedValue({
    profile: {
      id: "profile-1",
      companyId: "company-1",
      userId: "user-1",
      displayName: "Ada Lovelace",
      title: "Product Lead",
      bio: "Turns founder intent into shipped operating systems.",
      location: "London",
      timezone: "Europe/London",
      socialLinks: [{ type: "github", label: "GitHub", url: "https://github.com/ada" }],
      avatarAssetId: null,
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedByUserId: "user-1",
    },
  });
  vi.mocked(assetsApi.uploadImage).mockResolvedValue({
    assetId: "asset-1",
    companyId: "company-1",
    contentPath: "/api/assets/asset-1/content",
  } as never);
  vi.mocked(activityApi.list).mockResolvedValue([
    {
      id: "activity-1",
      companyId: "company-1",
      actorType: "user",
      actorId: "user-1",
      action: "issue.created",
      entityType: "issue",
      entityId: "issue-created",
      agentId: null,
      runId: null,
      details: { title: "Created launch checklist" },
      createdAt: "2026-07-03T10:00:00.000Z",
    },
  ] as never);
  vi.mocked(issuesApi.list).mockImplementation(async (_companyId, filters) => {
    if (filters?.assigneeUserId === "user-1") {
      return [issue({ id: "assigned-1", identifier: "AOA-1", title: "Assigned directly" })] as never;
    }
    if (filters?.createdByUserId === "user-1") {
      return [issue({ id: "created-1", identifier: "AOA-2", title: "Created by Ada" })] as never;
    }
    if (filters?.assigneeAgentId === "agent-1") {
      return [issue({ id: "agent-task-1", identifier: "AOA-3", title: "Agent follow-up", assigneeAgentId: "agent-1", assigneeUserId: null })] as never;
    }
    return [] as never;
  });
});

describe("HumanDetail", () => {
  it("renders profile fields and compact overview sections with query filters", async () => {
    renderHumanDetail();

    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByText("Product Lead")).toBeInTheDocument();
    expect(screen.getByText("Turns founder intent into shipped operating systems.")).toBeInTheDocument();
    expect(screen.getByText("London")).toBeInTheDocument();
    expect(screen.getByText("Europe/London")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/ada");

    expect(await screen.findByText("Assigned directly")).toBeInTheDocument();
    expect(screen.getByText("Created by Ada")).toBeInTheDocument();
    expect(screen.getByText("Agent follow-up")).toBeInTheDocument();
    expect(screen.getByText("issue.created")).toBeInTheDocument();
    expect(screen.getByText("Authority")).toBeInTheDocument();
    expect(screen.getByText("Grace Founder")).toBeInTheDocument();

    expect(issuesApi.list).toHaveBeenCalledWith("company-1", { assigneeUserId: "user-1", taskScope: "all" });
    expect(issuesApi.list).toHaveBeenCalledWith("company-1", { createdByUserId: "user-1", taskScope: "all" });
    expect(issuesApi.list).toHaveBeenCalledWith("company-1", { assigneeAgentId: "agent-1", taskScope: "all" });
    expect(issuesApi.list).toHaveBeenCalledWith("company-1", { assigneeAgentId: "agent-2", taskScope: "all" });
    expect(activityApi.list).toHaveBeenCalledWith("company-1", { actorType: "user", actorId: "user-1" });
  });

  it("saves profile form display fields", async () => {
    const user = userEvent.setup();
    renderHumanDetail("/team/user-1/settings");

    const profileSection = await screen.findByRole("region", { name: "Profile" });
    await user.clear(within(profileSection).getByLabelText("Display name"));
    await user.type(within(profileSection).getByLabelText("Display name"), "Ada Byron");
    await user.clear(within(profileSection).getByLabelText("Title"));
    await user.type(within(profileSection).getByLabelText("Title"), "Founder Partner");
    await user.clear(within(profileSection).getByLabelText("Bio"));
    await user.type(within(profileSection).getByLabelText("Bio"), "Builds the operating cadence.");
    await user.clear(within(profileSection).getByLabelText("Location"));
    await user.type(within(profileSection).getByLabelText("Location"), "San Francisco");
    await user.clear(within(profileSection).getByLabelText("Timezone"));
    await user.type(within(profileSection).getByLabelText("Timezone"), "America/Los_Angeles");
    await user.clear(within(profileSection).getByLabelText("Social link label"));
    await user.type(within(profileSection).getByLabelText("Social link label"), "Portfolio");
    await user.clear(within(profileSection).getByLabelText("Social link URL"));
    await user.type(within(profileSection).getByLabelText("Social link URL"), "https://ada.example.com");
    await user.click(within(profileSection).getByRole("button", { name: "Save Profile" }));

    await waitFor(() => {
      expect(teamApi.updateProfile).toHaveBeenCalledWith("company-1", "user-1", {
        displayName: "Ada Byron",
        title: "Founder Partner",
        bio: "Builds the operating cadence.",
        location: "San Francisco",
        timezone: "America/Los_Angeles",
        socialLinks: [{ type: "github", label: "Portfolio", url: "https://ada.example.com" }],
      });
    });
  });

  it("uploads an avatar before saving the returned asset id and can remove it", async () => {
    const user = userEvent.setup();
    renderHumanDetail("/team/user-1/settings");

    const profileSection = await screen.findByRole("region", { name: "Profile" });
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    await user.upload(within(profileSection).getByLabelText("Avatar image"), file);
    await user.click(within(profileSection).getByRole("button", { name: "Upload Avatar" }));

    await waitFor(() => {
      expect(assetsApi.uploadImage).toHaveBeenCalledWith("company-1", file, "humans/avatars");
      expect(teamApi.updateProfile).toHaveBeenCalledWith("company-1", "user-1", { avatarAssetId: "asset-1" });
    });

    vi.mocked(teamApi.updateProfile).mockClear();
    await user.click(within(profileSection).getByRole("button", { name: "Remove Avatar" }));

    await waitFor(() => {
      expect(teamApi.updateProfile).toHaveBeenCalledWith("company-1", "user-1", { avatarAssetId: null });
    });
  });
});
