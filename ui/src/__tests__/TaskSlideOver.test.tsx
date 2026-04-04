import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock @mdxeditor/editor before any imports to avoid CSS-in-ESM cycle
vi.mock("@mdxeditor/editor", () => ({
  CodeMirrorEditor: {},
  MDXEditor: () => null,
  headingsPlugin: () => ({}),
  listsPlugin: () => ({}),
  quotePlugin: () => ({}),
  thematicBreakPlugin: () => ({}),
  markdownShortcutPlugin: () => ({}),
  toolbarPlugin: () => ({}),
  BoldItalicUnderlineToggles: () => null,
  ListsToggle: () => null,
  BlockTypeSelect: () => null,
  CreateLink: () => null,
  linkPlugin: () => ({}),
  linkDialogPlugin: () => ({}),
  codeBlockPlugin: () => ({}),
  codeMirrorPlugin: () => ({}),
}));

// --- We test the component's API surface by mocking heavy dependencies ---

const mockOnClose = vi.fn();
const mockIssue = {
  id: "issue-1",
  title: "Fix login bug",
  description: "The login page has a bug",
  status: "in_progress",
  priority: "high",
  identifier: "TC-1",
  assigneeAgentId: null,
  assigneeUserId: null,
  projectId: null,
  parentId: null,
  goalId: null,
  labels: ["bug"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Mock all heavy dependencies
vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Link: actual.Link,
    NavLink: actual.NavLink,
  };
});

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "comp-1" }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("../hooks/useTeamAccess", () => ({
  useTeamAccess: () => ({
    permissions: {
      canAssignTasks: true,
      canInviteUsers: true,
      canManageRoles: true,
      canEditIdentityMemory: true,
    },
  }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn(({ queryKey }: any) => {
      const key = Array.isArray(queryKey) ? queryKey.join(".") : String(queryKey);
      // Return mock issue for the detail query
      if (key.includes("detail")) {
        return { data: mockIssue, isLoading: false, error: null };
      }
      // Return empty arrays for list-type queries
      if (key.includes("comments") || key.includes("activity") ||
          key.includes("runs") || key.includes("approvals") ||
          key.includes("attachments") || key.includes("liveRuns") ||
          key.includes("dependencies") || key.includes("list") ||
          key.includes("agents") || key.includes("projects")) {
        return { data: [], isLoading: false, error: null };
      }
      // activeRun returns null
      if (key.includes("activeRun")) {
        return { data: null, isLoading: false, error: null };
      }
      // Artifacts — return null (no linked artifact)
      if (key.includes("artifacts")) {
        return { data: null, isLoading: false, error: null };
      }
      // Detected outputs — return empty array
      if (key.includes("detected-outputs")) {
        return { data: [], isLoading: false, error: null };
      }
      return { data: undefined, isLoading: false, error: null };
    }),
    useQueries: ({ queries }: any) =>
      (queries ?? []).map(() => ({ data: null, isLoading: false, error: null })),
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
      isSuccess: false,
      isError: false,
    }),
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    }),
  };
});

vi.mock("../lib/queryKeys", () => ({
  queryKeys: {
    issues: {
      detail: (id: string) => ["issues", "detail", id],
      list: (id: string) => ["issues", "list", id],
      comments: (id: string) => ["issues", "comments", id],
      activity: (id: string) => ["issues", "activity", id],
      runs: (id: string) => ["issues", "runs", id],
      approvals: (id: string) => ["issues", "approvals", id],
      attachments: (id: string) => ["issues", "attachments", id],
      liveRuns: (id: string) => ["issues", "liveRuns", id],
      activeRun: (id: string) => ["issues", "activeRun", id],
      dependencies: (id: string) => ["issues", "dependencies", id],
      documents: (id: string) => ["issues", "documents", id],
    },
    agents: { list: (id: string) => ["agents", "list", id] },
    projects: { list: (id: string) => ["projects", "list", id] },
    goals: { list: (id: string) => ["goals", "list", id] },
    artifacts: {
      byIssue: (id: string) => ["artifacts", "issue", id],
      detail: (id: string) => ["artifacts", "detail", id],
    },
    detectedOutputs: {
      byIssue: (id: string) => ["detected-outputs", "issue", id],
      byRun: (id: string) => ["detected-outputs", "run", id],
    },
    activity: (id: string) => ["activity", id],
    auth: { session: "auth.session" },
  },
}));

vi.mock("../hooks/useProjectOrder", () => ({
  useProjectOrder: () => ({ orderedProjects: [], reorder: vi.fn() }),
}));

vi.mock("../api/issues", () => ({
  issuesApi: { get: vi.fn(), update: vi.fn(), addComment: vi.fn(), markRead: vi.fn(), delete: vi.fn() },
}));

vi.mock("../api/dependencies", () => ({
  dependenciesApi: { list: vi.fn().mockResolvedValue([]), create: vi.fn(), delete: vi.fn() },
}));

vi.mock("../api/activity", () => ({
  activityApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: { triggerByIssueId: vi.fn() },
}));

vi.mock("../api/agents", () => ({
  agentsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/auth", () => ({
  authApi: { getSession: vi.fn().mockResolvedValue({ user: { id: "u1" } }) },
}));

vi.mock("../api/projects", () => ({
  projectsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/artifacts", () => ({
  artifactsApi: { getByIssueId: vi.fn().mockResolvedValue(null), get: vi.fn(), addVersion: vi.fn() },
}));

vi.mock("../api/output-detection", () => ({
  outputDetectionApi: { listForIssue: vi.fn().mockResolvedValue([]), confirm: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("../api/context-packaging", () => ({
  contextPackagingApi: {
    getContextPackage: vi.fn().mockResolvedValue({ markdown: "# Test context", tokenEstimate: 100 }),
  },
}));

vi.mock("../lib/utils", () => ({
  relativeTime: () => "2m ago",
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
  formatTokens: (v: number) => String(v),
}));

// Mock all child components that are complex
vi.mock("../components/InlineEditor", () => ({
  InlineEditor: ({ value }: any) => <div data-testid="inline-editor">{value}</div>,
}));

vi.mock("../components/CommentThread", () => ({
  CommentThread: () => <div data-testid="comment-thread">Comments</div>,
}));

vi.mock("../components/IssueProperties", () => ({
  IssueProperties: () => <div data-testid="issue-properties">Properties</div>,
}));

vi.mock("../components/LiveRunWidget", () => ({
  LiveRunWidget: () => null,
}));

vi.mock("../components/StatusIcon", () => ({
  StatusIcon: ({ status }: any) => <span data-testid="status-icon">{status}</span>,
}));

vi.mock("../components/PriorityIcon", () => ({
  PriorityIcon: ({ priority }: any) => <span data-testid="priority-icon">{priority}</span>,
}));

vi.mock("../components/StatusBadge", () => ({
  StatusBadge: ({ status }: any) => <span data-testid="status-badge">{status}</span>,
}));

vi.mock("../components/Identity", () => ({
  Identity: ({ name }: any) => <span>{name}</span>,
}));

vi.mock("../components/MarkdownEditor", () => ({
  MarkdownEditor: () => null,
}));

vi.mock("../components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: any) => <div data-testid="markdown-body">{children}</div>,
}));

vi.mock("../components/IssueDocumentsSection", () => ({
  IssueDocumentsSection: () => <div data-testid="issue-documents" />,
}));

// Mock the Sheet component to just render children when open
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children, onOpenChange }: any) =>
    open ? <div data-testid="sheet" data-open={open}>{children}</div> : null,
  SheetContent: ({ children, side }: any) => (
    <div data-testid="sheet-content" data-side={side ?? "right"}>{children}</div>
  ),
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, ...props }: any) => <div data-testid="tabs" {...props}>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: any) => <button data-testid={`tab-${value}`}>{children}</button>,
  TabsContent: ({ children, value }: any) => <div data-testid={`tab-content-${value}`}>{children}</div>,
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: any) => <div>{children}</div>,
  CollapsibleContent: ({ children }: any) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

import { TaskSlideOver } from "../components/TaskSlideOver";

function renderSlideOver(props: { issueId: string | null; open: boolean }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TaskSlideOver issueId={props.issueId} open={props.open} onClose={mockOnClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// --- Tests ---

describe("TaskSlideOver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when open=false", () => {
    const { container } = renderSlideOver({ issueId: "issue-1", open: false });
    expect(container.querySelector("[data-testid='sheet']")).not.toBeInTheDocument();
  });

  it("opens as right-side Sheet when issueId is set and open=true", () => {
    renderSlideOver({ issueId: "issue-1", open: true });
    expect(screen.getByTestId("sheet")).toBeInTheDocument();
    expect(screen.getByTestId("sheet-content")).toHaveAttribute("data-side", "right");
  });

  it("renders task title when issue data is loaded", () => {
    renderSlideOver({ issueId: "issue-1", open: true });
    // Two InlineEditors: one for title, one for description
    const editors = screen.getAllByTestId("inline-editor");
    expect(editors[0]).toHaveTextContent("Fix login bug");
    expect(editors[1]).toHaveTextContent("The login page has a bug");
  });

  it("renders properties section", () => {
    renderSlideOver({ issueId: "issue-1", open: true });
    expect(screen.getByTestId("issue-properties")).toBeInTheDocument();
  });

  it("renders Artifacts tab trigger", () => {
    renderSlideOver({ issueId: "issue-1", open: true });
    expect(screen.getByTestId("tab-artifacts")).toBeInTheDocument();
    expect(screen.getByTestId("tab-artifacts")).toHaveTextContent("Artifacts");
  });

  it("renders Open in LLM button options", () => {
    renderSlideOver({ issueId: "issue-1", open: true });
    // The LLM menu popover content renders inline in our mock
    expect(screen.getByText("Copy context to clipboard")).toBeInTheDocument();
    expect(screen.getByText("Open in Claude")).toBeInTheDocument();
    expect(screen.getByText("Open in ChatGPT")).toBeInTheDocument();
  });

  it("calls onClose when X button is clicked", async () => {
    const user = userEvent.setup();
    renderSlideOver({ issueId: "issue-1", open: true });

    await user.click(screen.getByTestId("close-button"));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("renders all four tab triggers inside Sheet", () => {
    renderSlideOver({ issueId: "issue-1", open: true });
    expect(screen.getByTestId("tab-comments")).toBeInTheDocument();
    expect(screen.getByTestId("tab-subissues")).toBeInTheDocument();
    expect(screen.getByTestId("tab-activity")).toBeInTheDocument();
    expect(screen.getByTestId("tab-artifacts")).toBeInTheDocument();
  });

  it("renders StatusIcon and PriorityIcon in Sheet header", () => {
    renderSlideOver({ issueId: "issue-1", open: true });
    expect(screen.getByTestId("status-icon")).toBeInTheDocument();
    expect(screen.getByTestId("priority-icon")).toBeInTheDocument();
  });

  it("renders popovers (LLM and more-menu) within Sheet without crashing", () => {
    // Popovers are mocked to render inline — verifies they don't break in Sheet context
    renderSlideOver({ issueId: "issue-1", open: true });
    expect(screen.getByText("Copy context to clipboard")).toBeInTheDocument();
    expect(screen.getByText("Hide this Task")).toBeInTheDocument();
  });
});
