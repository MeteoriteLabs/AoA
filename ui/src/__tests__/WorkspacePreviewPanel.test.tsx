import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ─── Import after mocks ──────────────────────────────────────────────────────

import { WorkspacePreviewPanel } from "../components/workspace/WorkspacePreviewPanel";

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
