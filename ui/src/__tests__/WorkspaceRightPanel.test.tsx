import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceRightPanel } from "../components/workspace/WorkspaceRightPanel";
import { mockCompanyContext } from "./test-utils";

// ─── Mock data ───────────────────────────────────────────────────────────────

const mockWorkspace = {
  id: "ws-1",
  companyId: "comp-1",
  projectId: "proj-1",
  projectWorkspaceId: null,
  sourceIssueId: "issue-1",
  mode: "local_checkout" as const,
  strategyType: "git_branch" as const,
  name: "workspace-1",
  status: "active" as const,
  cwd: "/home/agent/workspace",
  repoUrl: "https://github.com/org/repo",
  branchName: "feat/fix-auth",
  baseRef: "main",
  providerType: "local" as const,
  providerRef: null,
  derivedFromExecutionWorkspaceId: null,
  lastUsedAt: new Date(),
  openedAt: new Date(),
  closedAt: null,
  cleanupEligibleAt: null,
  cleanupReason: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockArtifact = {
  id: "art-1",
  companyId: "comp-1",
  title: "API Specification",
  description: null,
  type: "document" as const,
  status: "active" as const,
  currentVersionId: "v-1",
  createdById: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  versions: [
    {
      id: "v-1",
      artifactId: "art-1",
      versionNumber: 3,
      source: "agent" as const,
      sourceDetail: "Claude",
      changelog: "Updated endpoints",
      parentVersionId: null,
      content: "openapi: 3.0.0\npaths: ...",
      fileUrl: null,
      createdAt: new Date(),
    },
  ],
};

const mockAgent = {
  id: "agent-1",
  companyId: "comp-1",
  name: "Claude Agent",
  urlKey: "claude-agent",
  role: "engineer",
  title: "Senior Engineer",
  icon: null,
  status: "active",
  reportsTo: null,
  parentType: null,
  parentId: null,
  capabilities: null,
  adapterType: "claude_api",
  adapterConfig: {},
  runtimeConfig: {},
  lastHeartbeatAt: new Date().toISOString(),
  projectId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockIssue = {
  id: "issue-1",
  companyId: "comp-1",
  projectId: "proj-1",
  goalId: null,
  parentId: null,
  title: "Fix auth bug",
  description: null,
  status: "in_progress",
  priority: "high",
  assigneeAgentId: "agent-1",
  assigneeUserId: null,
  checkoutRunId: null,
  executionRunId: null,
  executionAgentNameKey: null,
  executionLockedAt: null,
  executionWorkspaceId: "ws-1",
  executionWorkspacePreference: null,
  executionWorkspaceSettings: null,
  createdByAgentId: null,
  createdByUserId: null,
  issueNumber: 42,
  identifier: "ENG-42",
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
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRuns = [
  {
    runId: "run-1",
    status: "completed",
    agentId: "agent-1",
    startedAt: "2026-04-01T10:00:00Z",
    finishedAt: "2026-04-01T10:05:00Z",
    createdAt: "2026-04-01T10:00:00Z",
    invocationSource: "heartbeat",
  },
  {
    runId: "run-2",
    status: "completed",
    agentId: "agent-1",
    startedAt: "2026-04-01T11:00:00Z",
    finishedAt: "2026-04-01T11:03:00Z",
    createdAt: "2026-04-01T11:00:00Z",
    invocationSource: "heartbeat",
  },
];

// ─── API Mocks ───────────────────────────────────────────────────────────────

const artifactsApiMock = {
  getByIssueId: vi.fn().mockResolvedValue(mockArtifact),
  get: vi.fn().mockResolvedValue(mockArtifact),
};

const dependenciesApiMock = {
  list: vi.fn().mockResolvedValue({ upstream: [], downstream: [] }),
};

const agentsApiMock = {
  list: vi.fn().mockResolvedValue([mockAgent]),
};

const activityApiMock = {
  runsForIssue: vi.fn().mockResolvedValue(mockRuns),
};

const heartbeatsApiMock = {
  activeRunForIssue: vi.fn().mockResolvedValue(null),
  liveRunsForIssue: vi.fn().mockResolvedValue([]),
  events: vi.fn().mockResolvedValue([]),
  log: vi.fn().mockResolvedValue({ content: "", nextOffset: undefined }),
};

const issuesApiMock = {
  get: vi.fn().mockResolvedValue(mockIssue),
};

const executionWorkspacesApiMock = {
  runtimeServices: vi.fn().mockResolvedValue([]),
};

vi.mock("../api/artifacts", () => ({
  artifactsApi: new Proxy({}, { get: (_t, prop) => (artifactsApiMock as any)[prop] }),
}));

vi.mock("../api/dependencies", () => ({
  dependenciesApi: new Proxy({}, { get: (_t, prop) => (dependenciesApiMock as any)[prop] }),
}));

vi.mock("../api/agents", () => ({
  agentsApi: new Proxy({}, { get: (_t, prop) => (agentsApiMock as any)[prop] }),
}));

vi.mock("../api/activity", () => ({
  activityApi: new Proxy({}, { get: (_t, prop) => (activityApiMock as any)[prop] }),
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: new Proxy({}, { get: (_t, prop) => (heartbeatsApiMock as any)[prop] }),
}));

vi.mock("../api/issues", () => ({
  issuesApi: new Proxy({}, { get: (_t, prop) => (issuesApiMock as any)[prop] }),
}));

vi.mock("../api/execution-workspaces", () => ({
  executionWorkspacesApi: new Proxy({}, { get: (_t, prop) => (executionWorkspacesApiMock as any)[prop] }),
}));

// Mock xterm modules to avoid DOM issues in jsdom
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    clear: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  })),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    ...mockCompanyContext,
    selectedCompanyId: "comp-1",
    selectedCompany: { id: "comp-1", issuePrefix: "TC", name: "Test Corp" },
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderRightPanel(props: Partial<React.ComponentProps<typeof WorkspaceRightPanel>> = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorkspaceRightPanel
          issueId="issue-1"
          companyId="comp-1"
          companyPrefix="TC"
          workspace={mockWorkspace}
          functionType="software_development"
          previewMode={null}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("WorkspaceRightPanel — section rendering", () => {
  it("renders permanent sections (artifacts, process, terminal, notes) when no previewMode", async () => {
    renderRightPanel({ previewMode: null });

    await waitFor(() => {
      expect(screen.getByTestId("section-artifacts")).toBeInTheDocument();
    });

    expect(screen.getByTestId("section-process")).toBeInTheDocument();
    expect(screen.getByTestId("section-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("section-notes")).toBeInTheDocument();

    // No contextual section when previewMode is null
    expect(screen.queryByTestId("section-contextual")).not.toBeInTheDocument();
  });

  it("renders section labels", async () => {
    renderRightPanel({ previewMode: null });

    await waitFor(() => {
      expect(screen.getByText("Artifacts")).toBeInTheDocument();
    });

    expect(screen.getByText("Process")).toBeInTheDocument();
    expect(screen.getByText("Terminal")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
  });

  it("hides terminal section for non-software departments", async () => {
    renderRightPanel({ functionType: "marketing", previewMode: null });

    await waitFor(() => {
      expect(screen.getByTestId("section-artifacts")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("section-terminal")).not.toBeInTheDocument();
  });
});

describe("WorkspaceRightPanel — contextual top section", () => {
  it("shows Changes contextual section when previewMode is 'changes'", async () => {
    renderRightPanel({ previewMode: "changes" });

    await waitFor(() => {
      expect(screen.getByTestId("section-contextual")).toBeInTheDocument();
    });

    expect(screen.getByText("Changes")).toBeInTheDocument();
  });

  it("shows Runs contextual section when previewMode is 'logs'", async () => {
    renderRightPanel({ previewMode: "logs" });

    await waitFor(() => {
      expect(screen.getByTestId("section-contextual")).toBeInTheDocument();
    });

    expect(screen.getByText("Runs")).toBeInTheDocument();
  });

  it("shows Preview contextual section when previewMode is 'preview'", async () => {
    renderRightPanel({ previewMode: "preview" });

    await waitFor(() => {
      expect(screen.getByTestId("section-contextual")).toBeInTheDocument();
    });

    expect(screen.getByText("Preview")).toBeInTheDocument();
  });
});

describe("WorkspaceRightPanel — expand/collapse persistence", () => {
  it("toggles a section and persists to localStorage", async () => {
    renderRightPanel();

    await waitFor(() => {
      expect(screen.getByTestId("section-artifacts")).toBeInTheDocument();
    });

    // Artifacts is open by default — click to collapse
    const trigger = screen.getByText("Artifacts");
    fireEvent.click(trigger);

    expect(localStorage.getItem("aoa:workspace:section:artifacts")).toBe("false");
  });

  it("loads expand state from localStorage on mount", async () => {
    localStorage.setItem("aoa:workspace:section:artifacts", "false");
    localStorage.setItem("aoa:workspace:section:terminal", "true");

    renderRightPanel();

    await waitFor(() => {
      expect(screen.getByTestId("section-artifacts")).toBeInTheDocument();
    });

    // Terminal section should be expanded
    expect(screen.getByTestId("section-terminal")).toBeInTheDocument();
  });
});

describe("ArtifactsSection", () => {
  it("shows artifacts list when artifact exists", async () => {
    renderRightPanel();

    await waitFor(() => {
      expect(screen.getByTestId("artifacts-list")).toBeInTheDocument();
    });

    expect(screen.getByText("API Specification")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();
  });

  it("shows empty state when no artifact linked", async () => {
    artifactsApiMock.getByIssueId.mockResolvedValueOnce(null);

    renderRightPanel();

    await waitFor(() => {
      expect(screen.getByTestId("artifacts-empty")).toBeInTheDocument();
    });
  });

  it("calls onPreviewArtifact when artifact row clicked", async () => {
    const onPreview = vi.fn();
    renderRightPanel({ onPreviewArtifact: onPreview });

    await waitFor(() => {
      expect(screen.getByTestId("artifact-row")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("artifact-row"));

    expect(onPreview).toHaveBeenCalledWith(mockArtifact, mockArtifact.versions[0]);
  });
});

describe("ProcessSection", () => {
  it("shows agent info with name and adapter type", async () => {
    renderRightPanel();

    await waitFor(() => {
      expect(screen.getByTestId("agent-link")).toBeInTheDocument();
    });

    expect(screen.getByText("Claude Agent")).toBeInTheDocument();
    expect(screen.getByText("claude_api")).toBeInTheDocument();
  });

  it("shows run count", async () => {
    renderRightPanel();

    await waitFor(() => {
      expect(screen.getByText("2 runs")).toBeInTheDocument();
    });
  });

  it("shows idle status when no active run", async () => {
    renderRightPanel();

    await waitFor(() => {
      expect(screen.getByText("Idle")).toBeInTheDocument();
    });
  });

  it("shows no-agent state when no agent assigned", async () => {
    issuesApiMock.get.mockResolvedValueOnce({ ...mockIssue, assigneeAgentId: null });

    renderRightPanel();

    await waitFor(() => {
      expect(screen.getByTestId("no-agent")).toBeInTheDocument();
    });
  });

  it("shows upstream dependency outputs when deps are completed", async () => {
    dependenciesApiMock.list.mockResolvedValueOnce({
      upstream: [
        {
          id: "dep-1",
          dependencyIssueId: "issue-upstream",
          title: "Write API Spec",
          status: "done",
          createdAt: "2026-04-01",
        },
      ],
      downstream: [],
    });

    renderRightPanel();

    await waitFor(() => {
      expect(screen.getByText("Write API Spec")).toBeInTheDocument();
    });
  });
});

describe("NotesSection", () => {
  it("renders textarea with placeholder", async () => {
    renderRightPanel();

    await waitFor(() => {
      expect(screen.getByTestId("notes-textarea")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("Add notes about this workspace...")).toBeInTheDocument();
  });

  it("saves notes to localStorage after typing (debounced)", async () => {
    renderRightPanel();

    await waitFor(() => {
      expect(screen.getByTestId("notes-textarea")).toBeInTheDocument();
    });

    const textarea = screen.getByTestId("notes-textarea");
    fireEvent.change(textarea, { target: { value: "My workspace notes" } });

    // Not saved immediately
    expect(localStorage.getItem("aoa:workspace:notes:ws-1")).toBeNull();

    // Wait for debounce to fire (500ms + buffer)
    await waitFor(
      () => {
        expect(localStorage.getItem("aoa:workspace:notes:ws-1")).toBe("My workspace notes");
      },
      { timeout: 2000 },
    );
  });

  it("loads saved notes from localStorage on mount", async () => {
    localStorage.setItem("aoa:workspace:notes:ws-1", "Previously saved notes");

    renderRightPanel();

    await waitFor(() => {
      const textarea = screen.getByTestId("notes-textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Previously saved notes");
    });
  });
});

describe("WorkspaceRightPanel — collapsed icon rail", () => {
  it("renders icon rail instead of sections when collapsed", () => {
    renderRightPanel({ collapsed: true });

    expect(screen.getByTestId("workspace-right-panel-collapsed")).toBeInTheDocument();
    expect(screen.queryByTestId("section-artifacts")).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-right-panel-expand")).toBeInTheDocument();
  });

  it("shows all permanent section icons for software_development", () => {
    renderRightPanel({ collapsed: true, functionType: "software_development" });

    expect(screen.getByTestId("workspace-rail-section-artifacts")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-rail-section-process")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-rail-section-memory")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-rail-section-git")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-rail-section-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-rail-section-notes")).toBeInTheDocument();
  });

  it("hides git + terminal icons for non-software functionType", () => {
    renderRightPanel({ collapsed: true, functionType: "marketing" });

    expect(screen.getByTestId("workspace-rail-section-artifacts")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-rail-section-process")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-rail-section-memory")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-rail-section-notes")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-rail-section-git")).not.toBeInTheDocument();
    expect(screen.queryByTestId("workspace-rail-section-terminal")).not.toBeInTheDocument();
  });

  it("clicking a section icon calls onExpandAndShowSection with section name", () => {
    const onExpandAndShowSection = vi.fn();
    renderRightPanel({
      collapsed: true,
      onExpandAndShowSection,
    });

    fireEvent.click(screen.getByTestId("workspace-rail-section-memory"));
    expect(onExpandAndShowSection).toHaveBeenCalledWith("memory");
  });

  it("expand toggle calls onToggleCollapse", () => {
    const onToggleCollapse = vi.fn();
    renderRightPanel({ collapsed: true, onToggleCollapse });

    fireEvent.click(screen.getByTestId("workspace-right-panel-expand"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("shows collapse button in expanded header", () => {
    const onToggleCollapse = vi.fn();
    renderRightPanel({ collapsed: false, onToggleCollapse });

    expect(screen.getByTestId("workspace-right-panel-collapse")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("workspace-right-panel-collapse"));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("openSection prop force-opens the named section when expanded", async () => {
    // Memory section starts closed by setting localStorage to "false"
    localStorage.setItem("aoa:workspace:section:memory", "false");

    const { rerender } = renderRightPanel({
      collapsed: false,
      openSection: null,
    });

    // memory section should be rendered but collapsed (no memory-placeholder visible)
    await waitFor(() => {
      expect(screen.getByTestId("section-memory")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("memory-placeholder")).not.toBeInTheDocument();

    // Now re-render with an openSection request
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <MemoryRouter>
          <WorkspaceRightPanel
            issueId="issue-1"
            companyId="comp-1"
            companyPrefix="TC"
            workspace={mockWorkspace}
            functionType="software_development"
            previewMode={null}
            collapsed={false}
            openSection={{ section: "memory", nonce: 123 }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("memory-placeholder")).toBeInTheDocument();
    });
  });
});
