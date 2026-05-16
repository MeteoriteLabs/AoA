import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ServicesSection } from "../components/workspace/sections/ServicesSection";

// ─── API Mocks ───────────────────────────────────────────────────────────────

const executionWorkspacesApiMock = {
  runtimeServices: vi.fn(),
  controlRuntimeServices: vi.fn(),
};

vi.mock("../api/execution-workspaces", () => ({
  executionWorkspacesApi: new Proxy(
    {},
    { get: (_t, prop) => (executionWorkspacesApiMock as Record<string, unknown>)[prop as string] },
  ),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const runningService = {
  id: "svc-1",
  serviceName: "web-dev-server",
  status: "running",
  port: 3000,
  url: "http://localhost:3000",
  command: "pnpm dev",
  cwd: "/home/agent/workspace",
  provider: "local_process",
  lifecycle: "shared",
  startedAt: new Date().toISOString(),
  stoppedAt: null,
};

const previewOnlyService = {
  ...runningService,
  id: "svc-preview",
  serviceName: "localhost:4173",
  port: 4173,
  url: "http://127.0.0.1:4173/",
  command: null,
  provider: "adapter_managed",
  providerRef: null,
  lifecycle: "ephemeral",
  healthStatus: "healthy",
};

const unavailablePreviewService = {
  ...previewOnlyService,
  id: "svc-preview-stopped",
  status: "stopped",
  healthStatus: "unhealthy",
  stoppedAt: new Date().toISOString(),
};

const stoppedService = {
  ...runningService,
  id: "svc-2",
  serviceName: "api-server",
  status: "stopped",
  port: 8080,
  url: null,
};

const failedService = {
  ...runningService,
  id: "svc-3",
  serviceName: "worker",
  status: "failed",
  port: null,
  url: null,
};

const startingService = {
  ...runningService,
  id: "svc-4",
  serviceName: "migrator",
  status: "starting",
  port: null,
  url: null,
};

const mockWorkspace = {
  id: "ws-1",
  companyId: "comp-1",
  projectId: "proj-1",
  projectWorkspaceId: null,
  sourceIssueId: "issue-1",
  mode: "isolated_workspace" as const,
  strategyType: "git_worktree" as const,
  name: "ws-1",
  status: "active" as const,
  cwd: "/home/agent/workspace",
  repoUrl: null,
  branchName: "feat",
  baseRef: "main",
  providerType: "git_worktree" as const,
  providerRef: null,
  derivedFromExecutionWorkspaceId: null,
  lastUsedAt: new Date(),
  openedAt: new Date(),
  closedAt: null,
  cleanupEligibleAt: null,
  cleanupReason: null,
  config: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderSection(options: { onOpenBrowser?: (service: any) => void } = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return {
    ...render(
      <QueryClientProvider client={qc}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ServicesSection workspace={mockWorkspace as any} onOpenBrowser={options.onOpenBrowser} />
      </QueryClientProvider>,
    ),
    queryClient: qc,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ServicesSection", () => {
  it("renders loading skeleton while query is pending", () => {
    // Never-resolving promise -> stays in pending state
    executionWorkspacesApiMock.runtimeServices.mockReturnValue(new Promise(() => {}));

    renderSection();

    const body = screen.getByTestId("section-services-body");
    expect(body).toBeInTheDocument();
    // Should contain skeleton elements
    expect(body.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("shows empty state when no services are configured", async () => {
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([]);

    renderSection();

    await waitFor(() => {
      expect(screen.getByText("No app previews")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Agent-created localhost apps will appear here."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("section-services-body").className).toContain("py-2");
  });

  it("renders a running service row with name, port, and URL link", async () => {
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([runningService]);

    renderSection();

    await waitFor(() => {
      expect(screen.getByTestId("service-row-svc-1")).toBeInTheDocument();
    });
    expect(screen.getByText("web-dev-server")).toBeInTheDocument();
    expect(screen.getByText(":3000")).toBeInTheDocument();
    const link = screen.getByTestId("service-url-svc-1") as HTMLAnchorElement;
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("http://localhost:3000");
  });

  it("running service shows Stop + Restart buttons (not Start)", async () => {
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([runningService]);

    renderSection();

    await waitFor(() => {
      expect(screen.getByTestId("service-stop-svc-1")).toBeInTheDocument();
    });
    expect(screen.getByTestId("service-restart-svc-1")).toBeInTheDocument();
    expect(screen.queryByTestId("service-start-svc-1")).not.toBeInTheDocument();
  });

  it("preview-only adapter-managed service shows Open but no process controls", async () => {
    const user = userEvent.setup();
    const onOpenBrowser = vi.fn();
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([previewOnlyService]);

    renderSection({ onOpenBrowser });

    const row = await screen.findByTestId("service-row-svc-preview");
    expect(row).toHaveTextContent("Preview");
    expect(screen.getByTestId("service-open-svc-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("service-stop-svc-preview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("service-restart-svc-preview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("service-start-svc-preview")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("service-open-svc-preview"));
    expect(onOpenBrowser).toHaveBeenCalledWith(previewOnlyService);
  });

  it("unavailable preview-only service shows status without Open or process controls", async () => {
    const onOpenBrowser = vi.fn();
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([unavailablePreviewService]);

    renderSection({ onOpenBrowser });

    const row = await screen.findByTestId("service-row-svc-preview-stopped");
    expect(row).toHaveTextContent("Preview");
    expect(row).toHaveTextContent("Unavailable");
    expect(screen.queryByTestId("service-open-svc-preview-stopped")).not.toBeInTheDocument();
    expect(screen.queryByTestId("service-stop-svc-preview-stopped")).not.toBeInTheDocument();
    expect(screen.queryByTestId("service-restart-svc-preview-stopped")).not.toBeInTheDocument();
    expect(screen.queryByTestId("service-start-svc-preview-stopped")).not.toBeInTheDocument();
  });

  it("stopped service shows Start button only (not Stop/Restart)", async () => {
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([stoppedService]);

    renderSection();

    await waitFor(() => {
      expect(screen.getByTestId("service-start-svc-2")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("service-stop-svc-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("service-restart-svc-2")).not.toBeInTheDocument();
  });

  it("failed service shows Start button (allowing retry)", async () => {
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([failedService]);

    renderSection();

    await waitFor(() => {
      expect(screen.getByTestId("service-start-svc-3")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("service-stop-svc-3")).not.toBeInTheDocument();
  });

  it("clicking Start calls controlRuntimeServices with 'start' action and correct target", async () => {
    const user = userEvent.setup();
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([stoppedService]);
    executionWorkspacesApiMock.controlRuntimeServices.mockResolvedValue({
      workspace: mockWorkspace,
      runtimeServiceCount: 1,
      stdout: "",
      stderr: "",
    });

    renderSection();

    const startButton = await screen.findByTestId("service-start-svc-2");
    await user.click(startButton);

    await waitFor(() => {
      expect(executionWorkspacesApiMock.controlRuntimeServices).toHaveBeenCalledWith(
        "ws-1",
        "start",
        { runtimeServiceId: "svc-2" },
      );
    });
  });

  it("clicking Stop calls controlRuntimeServices with 'stop' action and correct target", async () => {
    const user = userEvent.setup();
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([runningService]);
    executionWorkspacesApiMock.controlRuntimeServices.mockResolvedValue({
      workspace: mockWorkspace,
      runtimeServiceCount: 1,
      stdout: "",
      stderr: "",
    });

    renderSection();

    const stopButton = await screen.findByTestId("service-stop-svc-1");
    await user.click(stopButton);

    await waitFor(() => {
      expect(executionWorkspacesApiMock.controlRuntimeServices).toHaveBeenCalledWith(
        "ws-1",
        "stop",
        { runtimeServiceId: "svc-1" },
      );
    });
  });

  it("clicking Restart calls controlRuntimeServices with 'restart' action and correct target", async () => {
    const user = userEvent.setup();
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([runningService]);
    executionWorkspacesApiMock.controlRuntimeServices.mockResolvedValue({
      workspace: mockWorkspace,
      runtimeServiceCount: 1,
      stdout: "",
      stderr: "",
    });

    renderSection();

    const restartButton = await screen.findByTestId("service-restart-svc-1");
    await user.click(restartButton);

    await waitFor(() => {
      expect(executionWorkspacesApiMock.controlRuntimeServices).toHaveBeenCalledWith(
        "ws-1",
        "restart",
        { runtimeServiceId: "svc-1" },
      );
    });
  });

  it("disables buttons while mutation is pending", async () => {
    const user = userEvent.setup();
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([runningService]);
    // Never-resolving mutation promise so the pending state sticks
    executionWorkspacesApiMock.controlRuntimeServices.mockReturnValue(new Promise(() => {}));

    renderSection();

    const stopButton = await screen.findByTestId("service-stop-svc-1");
    const restartButton = screen.getByTestId("service-restart-svc-1");

    await user.click(stopButton);

    await waitFor(() => {
      expect(stopButton).toBeDisabled();
    });
    expect(restartButton).toBeDisabled();
  });

  it("successful mutation invalidates runtime-services query (triggers refetch)", async () => {
    const user = userEvent.setup();
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([stoppedService]);
    executionWorkspacesApiMock.controlRuntimeServices.mockResolvedValue({
      workspace: mockWorkspace,
      runtimeServiceCount: 1,
      stdout: "",
      stderr: "",
    });

    renderSection();

    // Wait for initial fetch
    await screen.findByTestId("service-start-svc-2");
    const initialCallCount = executionWorkspacesApiMock.runtimeServices.mock.calls.length;

    const startButton = screen.getByTestId("service-start-svc-2");
    await user.click(startButton);

    // After success, invalidation should trigger a refetch
    await waitFor(() => {
      expect(executionWorkspacesApiMock.runtimeServices.mock.calls.length).toBeGreaterThan(
        initialCallCount,
      );
    });
  });

  it("URL renders as external link with target='_blank' and rel='noopener noreferrer'", async () => {
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([runningService]);

    renderSection();

    const link = (await screen.findByTestId("service-url-svc-1")) as HTMLAnchorElement;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("href")).toBe("http://localhost:3000");
  });

  it("starting service shows disabled Stop button", async () => {
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([startingService]);

    renderSection();

    const stopButton = await screen.findByTestId("service-stop-svc-4");
    expect(stopButton).toBeInTheDocument();
    expect(stopButton).toBeDisabled();
    expect(screen.queryByTestId("service-start-svc-4")).not.toBeInTheDocument();
    expect(screen.queryByTestId("service-restart-svc-4")).not.toBeInTheDocument();
  });

  it("handles concurrent mutations on different services correctly", async () => {
    const user = userEvent.setup();
    const stoppedA = { ...stoppedService, id: "svc-A", serviceName: "api-A" };
    const stoppedB = { ...stoppedService, id: "svc-B", serviceName: "api-B" };
    executionWorkspacesApiMock.runtimeServices.mockResolvedValue([stoppedA, stoppedB]);

    let resolveA: (v: unknown) => void;
    let resolveB: (v: unknown) => void;
    const pA = new Promise((r) => {
      resolveA = r;
    });
    const pB = new Promise((r) => {
      resolveB = r;
    });
    executionWorkspacesApiMock.controlRuntimeServices
      .mockImplementationOnce(() => pA)
      .mockImplementationOnce(() => pB);

    renderSection();

    const startA = await screen.findByTestId("service-start-svc-A");
    const startB = await screen.findByTestId("service-start-svc-B");

    await user.click(startA);
    await user.click(startB);

    // Both start buttons should be disabled (pending)
    expect(screen.getByTestId("service-start-svc-A")).toBeDisabled();
    expect(screen.getByTestId("service-start-svc-B")).toBeDisabled();

    // Resolve in reverse order — B first, then A
    resolveB!({ workspace: mockWorkspace, runtimeServiceCount: 2, stdout: "", stderr: "" });
    await waitFor(() => {
      expect(screen.getByTestId("service-start-svc-B")).not.toBeDisabled();
    });

    resolveA!({ workspace: mockWorkspace, runtimeServiceCount: 2, stdout: "", stderr: "" });
    await waitFor(() => {
      expect(screen.getByTestId("service-start-svc-A")).not.toBeDisabled();
    });

    expect(executionWorkspacesApiMock.controlRuntimeServices).toHaveBeenCalledTimes(2);
  });
});
