import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock data ────────────────────────────────────────────────────────────────

const mockRunsWithOutputs = [
  {
    runId: "run-1",
    status: "completed",
    agentId: "agent-1",
    startedAt: "2026-04-04T10:00:00Z",
    finishedAt: "2026-04-04T10:05:00Z",
    createdAt: "2026-04-04T10:00:00Z",
    invocationSource: "heartbeat",
    usageJson: null,
    resultJson: null,
    detectedOutputs: [
      {
        path: "src/components/Button.tsx",
        filename: "Button.tsx",
        byteSize: 2048,
        contentType: "text/typescript",
        assetId: null,
        sha256: null,
        source: "git_diff",
        status: "pending",
      },
      {
        path: "src/styles/theme.css",
        filename: "theme.css",
        byteSize: 1200,
        contentType: "text/css",
        assetId: null,
        sha256: null,
        source: "workspace_scan",
        status: "pending",
      },
      {
        path: "package.json",
        filename: "package.json",
        byteSize: 800,
        contentType: "application/json",
        assetId: null,
        sha256: null,
        source: "git_diff",
        status: "confirmed",
      },
    ],
  },
];

const mockRunningService = [
  {
    id: "svc-1",
    serviceName: "npm_dev_server",
    status: "running",
    port: 3000,
    url: "http://localhost:3000",
    command: "npm run dev",
    cwd: "/tmp/workspace",
    provider: "local_process",
    lifecycle: "shared",
    startedAt: "2026-04-04T10:00:00Z",
    stoppedAt: null,
  },
];

const mockArtifact = {
  id: "art-1",
  companyId: "comp-1",
  title: "Workspace summary",
  description: null,
  type: "document" as const,
  status: "active" as const,
  currentVersionId: "v-1",
  createdById: "agent-1",
  createdAt: new Date("2026-04-04T10:00:00Z"),
  updatedAt: new Date("2026-04-04T10:00:00Z"),
  versions: [
    {
      id: "v-1",
      artifactId: "art-1",
      versionNumber: 1,
      source: "agent" as const,
      sourceDetail: "Codex",
      changelog: null,
      parentVersionId: null,
      content: "Artifact body",
      fileUrl: null,
      createdAt: new Date("2026-04-04T10:00:00Z"),
    },
  ],
};

// ─── API Mocks ────────────────────────────────────────────────────────────────

const activityApiMock = {
  runsForIssue: vi.fn().mockResolvedValue([]),
};

const artifactsApiMock = {
  getByIssueId: vi.fn().mockResolvedValue(null),
};

const executionWorkspacesApiMock = {
  runtimeServices: vi.fn().mockResolvedValue([]),
};

const heartbeatsApiMock = {
  log: vi.fn().mockResolvedValue({ runId: "", store: "file", logRef: "", content: "" }),
};

const outputDetectionApiMock = {
  listForIssue: vi.fn().mockResolvedValue([]),
};

vi.mock("../api/activity", () => ({
  activityApi: new Proxy(
    {},
    { get: (_t: unknown, prop: string) => (activityApiMock as Record<string, unknown>)[prop] },
  ),
}));

vi.mock("../api/artifacts", () => ({
  artifactsApi: new Proxy(
    {},
    { get: (_t: unknown, prop: string) => (artifactsApiMock as Record<string, unknown>)[prop] },
  ),
}));

vi.mock("../api/execution-workspaces", () => ({
  executionWorkspacesApi: new Proxy(
    {},
    { get: (_t: unknown, prop: string) => (executionWorkspacesApiMock as Record<string, unknown>)[prop] },
  ),
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: new Proxy(
    {},
    { get: (_t: unknown, prop: string) => (heartbeatsApiMock as Record<string, unknown>)[prop] },
  ),
}));

vi.mock("../api/output-detection", () => ({
  outputDetectionApi: new Proxy(
    {},
    { get: (_t: unknown, prop: string) => (outputDetectionApiMock as Record<string, unknown>)[prop] },
  ),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ─── Import after mocks ──────────────────────────────────────────────────────

import { WorkspacePreviewPanel, type WorkspacePreviewTab } from "../components/workspace/WorkspacePreviewPanel";
import { resolveOutputViewer } from "../components/workspace/output-viewer-registry";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WorkspacePreviewPanel — Changes mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders file list for software_development workspaces", async () => {
    activityApiMock.runsForIssue.mockResolvedValue(mockRunsWithOutputs);

    render(
      <WorkspacePreviewPanel
        issueId="issue-1"
        companyId="comp-1"
        activeMode="changes"
        onModeChange={() => {}}
        functionType="software_development"
        workspaceId="ws-1"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByTestId("changes-view")).toBeInTheDocument();
    });

    const rows = screen.getAllByTestId("changes-file-row");
    expect(rows).toHaveLength(3);
    expect(screen.getByText("src/components/Button.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/styles/theme.css")).toBeInTheDocument();
    expect(screen.getByText("package.json")).toBeInTheDocument();
    expect(screen.getByText("3 files changed in this run")).toBeInTheDocument();
  });

  it("shows 'no code changes' for non-software departments", async () => {
    render(
      <WorkspacePreviewPanel
        issueId="issue-1"
        companyId="comp-1"
        activeMode="changes"
        onModeChange={() => {}}
        functionType="marketing"
        workspaceId="ws-1"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByTestId("changes-no-code")).toBeInTheDocument();
    });

    expect(screen.getByText("No code changes to display")).toBeInTheDocument();
  });
});

describe("WorkspacePreviewPanel tab deck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders closeable tabs and the active browser tab", () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const tabs: WorkspacePreviewTab[] = [
      {
        id: "browser:svc-1",
        kind: "browser",
        title: "web",
        url: "http://localhost:3000",
      },
      {
        id: "logs:issue-1",
        kind: "logs",
        title: "Logs",
        issueId: "issue-1",
      },
    ];

    render(
      <WorkspacePreviewPanel
        companyId="comp-1"
        tabs={tabs}
        activeTabId="browser:svc-1"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
      />,
      { wrapper },
    );

    expect(screen.getByTestId("workspace-preview-tabs")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /web/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /logs/i })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("preview-browser-tab")).toBeInTheDocument();
    expect(screen.getByTestId("preview-browser-iframe")).toHaveAttribute("src", "http://localhost:3000");

    fireEvent.click(screen.getByTestId("preview-tab-close-browser:svc-1"));
    expect(onCloseTab).toHaveBeenCalledWith("browser:svc-1");
  });

  it("opens the add-tab picker without offering run-output changes as a center viewer", () => {
    const onOpenTab = vi.fn();
    const tabs: WorkspacePreviewTab[] = [
      { id: "home:issue-1", kind: "home", title: "Viewer", issueId: "issue-1" },
    ];

    render(
      <WorkspacePreviewPanel
        companyId="comp-1"
        tabs={tabs}
        activeTabId="home:issue-1"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onOpenTab={onOpenTab}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByTestId("preview-tab-add"));
    expect(screen.queryByTestId("preview-tab-add-changes")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-tab-add-browser")).toBeInTheDocument();
    expect(screen.getByTestId("preview-tab-add-logs")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("preview-tab-add-home"));

    expect(onOpenTab).toHaveBeenCalledWith("home");
  });

  it("lists service, artifact, and logs in Viewer Home without a Changes entry", async () => {
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue(mockRunningService);
    artifactsApiMock.getByIssueId.mockResolvedValue(mockArtifact);
    activityApiMock.runsForIssue.mockResolvedValue(mockRunsWithOutputs);
    const onOpenResolvedTab = vi.fn();

    render(
      <WorkspacePreviewPanel
        companyId="comp-1"
        tabs={[{ id: "home:issue-1", kind: "home", title: "Viewer", issueId: "issue-1" }]}
        activeTabId="home:issue-1"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onOpenResolvedTab={onOpenResolvedTab}
        functionType="software_development"
        workspaceId="ws-1"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByTestId("viewer-home")).toBeInTheDocument();
      expect(screen.getByTestId("viewer-home-service-svc-1")).toBeInTheDocument();
      expect(screen.getByTestId("viewer-home-artifact-art-1")).toBeInTheDocument();
      expect(screen.getByTestId("viewer-home-logs")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("viewer-home-changes")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("viewer-home-service-svc-1"));
    expect(onOpenResolvedTab).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "browser", id: "browser:svc-1", url: "http://localhost:3000" }),
    );

    fireEvent.click(screen.getByTestId("viewer-home-artifact-art-1"));
    expect(onOpenResolvedTab).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "artifact", id: "artifact:art-1:v-1", artifact: mockArtifact }),
    );
  });

  it("opens captured output candidates from Viewer Home as preview tabs", async () => {
    artifactsApiMock.getByIssueId.mockResolvedValue(null);
    outputDetectionApiMock.listForIssue.mockResolvedValue([
      {
        runId: "run-1",
        outputIndex: 0,
        path: "workspace-summary.md",
        filename: "workspace-summary.md",
        byteSize: 512,
        contentType: "text/markdown",
        assetId: "asset-1",
        sha256: null,
        source: "workspace_scan",
        status: "pending",
      },
    ]);
    const onOpenResolvedTab = vi.fn();

    render(
      <WorkspacePreviewPanel
        companyId="comp-1"
        tabs={[{ id: "home:issue-1", kind: "home", title: "Viewer", issueId: "issue-1" }]}
        activeTabId="home:issue-1"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onOpenResolvedTab={onOpenResolvedTab}
        functionType="software_development"
        workspaceId="ws-1"
      />,
      { wrapper },
    );

    await waitFor(() => expect(screen.getByTestId("viewer-home-output-run-1-0")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("viewer-home-output-run-1-0"));

    expect(onOpenResolvedTab).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "output",
        id: "output:run-1:0",
        title: "workspace-summary.md",
        output: expect.objectContaining({ assetId: "asset-1" }),
      }),
    );
  });

  it("renders captured text output tabs by loading the asset content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Rendered output body", { status: 200 })),
    );
    const tabs: WorkspacePreviewTab[] = [
      {
        id: "output:run-1:0",
        kind: "output",
        title: "workspace-summary.md",
        output: {
          runId: "run-1",
          outputIndex: 0,
          path: "workspace-summary.md",
          filename: "workspace-summary.md",
          byteSize: 512,
          contentType: "text/markdown",
          assetId: "asset-1",
          sha256: null,
          source: "workspace_scan",
          status: "pending",
          runFinishedAt: "2026-04-04T10:05:00Z",
        },
      },
    ];

    render(
      <WorkspacePreviewPanel
        companyId="comp-1"
        tabs={tabs}
        activeTabId="output:run-1:0"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
      />,
      { wrapper },
    );

    await waitFor(() => expect(screen.getByTestId("preview-output-text")).toHaveTextContent("Rendered output body"));
    expect(fetch).toHaveBeenCalledWith("/api/assets/asset-1/content", { credentials: "include" });
    expect(screen.getAllByText("workspace-summary.md").length).toBeGreaterThan(0);
  });

  it("renders captured html output as source instead of executing it in a frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<button>Agent UI</button>", { status: 200 })),
    );
    const tabs: WorkspacePreviewTab[] = [
      {
        id: "output:run-1:0",
        kind: "output",
        title: "interactive.html",
        output: {
          runId: "run-1",
          outputIndex: 0,
          path: "interactive.html",
          filename: "interactive.html",
          byteSize: 256,
          contentType: "text/html",
          assetId: "asset-html",
          sha256: null,
          source: "workspace_scan",
          status: "pending",
          runFinishedAt: "2026-04-04T10:05:00Z",
        },
      },
    ];

    render(
      <WorkspacePreviewPanel
        companyId="comp-1"
        tabs={tabs}
        activeTabId="output:run-1:0"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
      />,
      { wrapper },
    );

    await waitFor(() => expect(screen.getByTestId("preview-output-text")).toHaveTextContent("<button>Agent UI</button>"));
    expect(screen.queryByTestId("preview-output-frame")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-output-tab")).toHaveTextContent("Source preview");
  });

  it("renders image outputs as images", () => {
    const tabs: WorkspacePreviewTab[] = [
      {
        id: "output:run-1:0",
        kind: "output",
        title: "mock.png",
        output: {
          runId: "run-1",
          outputIndex: 0,
          path: "mock.png",
          filename: "mock.png",
          byteSize: 4096,
          contentType: "image/png",
          assetId: "asset-image",
          sha256: null,
          source: "workspace_scan",
          status: "pending",
          runFinishedAt: "2026-04-04T10:05:00Z",
        },
      },
    ];

    render(
      <WorkspacePreviewPanel
        companyId="comp-1"
        tabs={tabs}
        activeTabId="output:run-1:0"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
      />,
      { wrapper },
    );

    expect(screen.getByTestId("preview-output-image")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "mock.png" })).toHaveAttribute("src", "/api/assets/asset-image/content");
  });

  it("renders pdf outputs in a frame", () => {
    const tabs: WorkspacePreviewTab[] = [
      {
        id: "output:run-1:0",
        kind: "output",
        title: "report.pdf",
        output: {
          runId: "run-1",
          outputIndex: 0,
          path: "report.pdf",
          filename: "report.pdf",
          byteSize: 8192,
          contentType: "application/pdf",
          assetId: "asset-pdf",
          sha256: null,
          source: "workspace_scan",
          status: "pending",
          runFinishedAt: "2026-04-04T10:05:00Z",
        },
      },
    ];

    render(
      <WorkspacePreviewPanel
        companyId="comp-1"
        tabs={tabs}
        activeTabId="output:run-1:0"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
      />,
      { wrapper },
    );

    expect(screen.getByTestId("preview-output-frame")).toHaveAttribute("src", "/api/assets/asset-pdf/content");
  });

  it("does not preview binary output types inline", () => {
    const tabs: WorkspacePreviewTab[] = [
      {
        id: "output:run-1:0",
        kind: "output",
        title: "archive.zip",
        output: {
          runId: "run-1",
          outputIndex: 0,
          path: "archive.zip",
          filename: "archive.zip",
          byteSize: 1024,
          contentType: "application/zip",
          assetId: "asset-zip",
          sha256: null,
          source: "workspace_scan",
          status: "pending",
          runFinishedAt: "2026-04-04T10:05:00Z",
        },
      },
    ];

    render(
      <WorkspacePreviewPanel
        companyId="comp-1"
        tabs={tabs}
        activeTabId="output:run-1:0"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
      />,
      { wrapper },
    );

    expect(screen.getByTestId("preview-output-download")).toHaveTextContent("Preview unavailable");
  });

  it("classifies output viewer capability from content type and filename", () => {
    expect(resolveOutputViewer({ contentType: "text/html", filename: "page.html", assetId: "a1" })).toMatchObject({
      kind: "text",
      label: "Source preview",
      canOpenDirectly: true,
      shouldExecuteInBrowser: false,
    });
    expect(resolveOutputViewer({ contentType: "image/png", filename: "mock.png", assetId: "a1" })).toMatchObject({
      kind: "image",
      label: "Image preview",
    });
    expect(resolveOutputViewer({ contentType: "application/pdf", filename: "report.pdf", assetId: "a1" })).toMatchObject({
      kind: "pdf",
      label: "PDF preview",
    });
    expect(resolveOutputViewer({ contentType: "application/zip", filename: "archive.zip", assetId: "a1" })).toMatchObject({
      kind: "download",
      label: "Open externally",
    });
  });

  it("shows a useful manual browser start surface with URL entry and service shortcuts", async () => {
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue(mockRunningService);

    render(
      <WorkspacePreviewPanel
        companyId="comp-1"
        tabs={[{ id: "browser:manual:ws-1", kind: "browser", title: "Browser", url: "about:blank" }]}
        activeTabId="browser:manual:ws-1"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        functionType="software_development"
        workspaceId="ws-1"
      />,
      { wrapper },
    );

    expect(screen.getByTestId("preview-browser-url-input")).toHaveValue("");
    await waitFor(() => expect(screen.getByTestId("preview-browser-service-svc-1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("preview-browser-service-svc-1"));
    expect(screen.getByTestId("preview-browser-iframe")).toHaveAttribute("src", "http://localhost:3000");
    expect(screen.getByTestId("preview-browser-url-input")).toHaveValue("http://localhost:3000");
  });
});

describe("WorkspacePreviewPanel — Preview mode (dev server)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows iframe when dev server URL is available", async () => {
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue(mockRunningService);

    render(
      <WorkspacePreviewPanel
        issueId="issue-1"
        companyId="comp-1"
        activeMode="preview"
        onModeChange={() => {}}
        functionType="software_development"
        workspaceId="ws-1"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByTestId("preview-devserver")).toBeInTheDocument();
    });

    const iframe = screen.getByTestId("preview-iframe") as HTMLIFrameElement;
    expect(iframe.src).toBe("http://localhost:3000/");
    expect(screen.getByText("http://localhost:3000")).toBeInTheDocument();
    expect(screen.getByTestId("preview-refresh")).toBeInTheDocument();
  });

  it("shows 'no dev server' when none running", async () => {
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([]);

    render(
      <WorkspacePreviewPanel
        issueId="issue-1"
        companyId="comp-1"
        activeMode="preview"
        onModeChange={() => {}}
        functionType="software_development"
        workspaceId="ws-1"
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByTestId("preview-no-devserver")).toBeInTheDocument();
    });

    expect(screen.getByText("No dev server running")).toBeInTheDocument();
  });
});
