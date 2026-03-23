import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, mockCompanyContext } from "./test-utils";
import { IssueProperties } from "../components/IssueProperties";
import { screen } from "@testing-library/react";

const issue = {
  id: "issue-1",
  companyId: "comp-1",
  title: "Task",
  status: "todo",
  priority: "medium",
  assigneeAgentId: null,
  assigneeUserId: null,
  projectId: null,
  parentId: null,
  ancestors: [],
  labels: [],
  labelIds: [],
  requestDepth: 0,
  createdByUserId: "user-1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as any;

let canAssignTasks = false;

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../hooks/useProjectOrder", () => ({
  useProjectOrder: () => ({ orderedProjects: [] }),
}));

vi.mock("../hooks/useTeamAccess", () => ({
  useTeamAccess: () => ({
    permissions: {
      canAssignTasks,
      canInviteUsers: false,
      canManageRoles: false,
      canEditIdentityMemory: false,
    },
  }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn(({ queryKey }: any) => {
      const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
      if (key === "auth") {
        return { data: { user: { id: "user-1" }, session: { userId: "user-1" } }, isLoading: false };
      }
      return { data: [], isLoading: false };
    }),
    useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
  };
});

vi.mock("../api/agents", () => ({ agentsApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../api/auth", () => ({ authApi: { getSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }) } }));
vi.mock("../api/issues", () => ({
  issuesApi: {
    listLabels: vi.fn().mockResolvedValue([]),
    createLabel: vi.fn(),
    deleteLabel: vi.fn(),
  },
}));
vi.mock("../api/projects", () => ({ projectsApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("../lib/queryKeys", () => ({
  queryKeys: {
    auth: { session: ["auth"] },
    agents: { list: () => ["agents"] },
    projects: { list: () => ["projects"] },
    issues: { labels: () => ["labels"] },
  },
}));

describe("IssueProperties permissions", () => {
  it("hides assignment controls for team members without task assignment permission", () => {
    canAssignTasks = false;
    renderWithProviders(<IssueProperties issue={issue} onUpdate={vi.fn()} />);

    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search assignees...")).not.toBeInTheDocument();
  });

  it("keeps assignment controls available when the user can assign tasks", () => {
    canAssignTasks = true;
    renderWithProviders(<IssueProperties issue={issue} onUpdate={vi.fn()} />);

    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});
