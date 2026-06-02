import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../context/ToastContext";

const memoryApiMock = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  get: vi.fn(async () => ({
    id: "mem-1",
    companyId: "co-1",
    title: "Deep linked memory",
    content: "Opened from URL.",
    category: "workflow",
    source: "manual",
    status: "approved",
    tags: [],
    departmentId: null,
    projectId: null,
    createdBy: "test",
    layer: "domain",
    priority: 0,
    visibility: "scoped",
    expiresAt: null,
    goalId: null,
    taskId: null,
    sourceArtifactId: null,
    sourceContext: null,
    accessedAt: null,
    currentVersionId: null,
    embeddingRetries: 0,
    agentId: null,
    validationCount: 1,
    lastValidatedAt: null,
    pinnedToSkill: false,
    importJobId: null,
    folderPath: "",
    lastAccessedByUserId: null,
    founderPinnedToTop: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  })),
  moveItem: vi.fn(),
  setPinnedToTop: vi.fn(),
}));

// Mock react-pdf and pdfjs-dist to avoid DOMMatrix/canvas issues in jsdom
vi.mock("react-pdf", () => ({
  Document: ({ children }: any) => <div data-testid="pdf-document">{children}</div>,
  Page: () => <div data-testid="pdf-page" />,
  pdfjs: { GlobalWorkerOptions: {} },
}));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {} }));

// Mock react-resizable-panels with simple divs
vi.mock("react-resizable-panels", () => ({
  Group: ({ children, ...props }: any) => (
    <div data-testid="panel-group" {...props}>
      {children}
    </div>
  ),
  Panel: ({ children, id, ...props }: any) => (
    <div data-testid={`panel-${id}`} id={id} {...props}>
      {children}
    </div>
  ),
  Separator: ({ id, ...props }: any) => (
    <div data-testid={`separator-${id}`} id={id} role="separator" {...props} />
  ),
  useDefaultLayout: () => ({
    defaultLayout: undefined,
    onLayoutChanged: vi.fn(),
    onLayoutChange: vi.fn(),
  }),
}));

vi.mock("../api/memoryFolders", () => ({
  memoryFoldersApi: {
    list: vi.fn(async () => [
      {
        id: "f-company",
        companyId: "co-1",
        departmentId: null,
        path: "Company",
        displayName: "Company",
        icon: "🏛️",
        sortOrder: 0,
        seedKey: "company.root",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "f-eng-decisions",
        companyId: "co-1",
        departmentId: "dept-eng",
        path: "engineering/Decisions",
        displayName: "Decisions",
        icon: null,
        sortOrder: 0,
        seedKey: "software_development.decisions",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]),
  },
}));

vi.mock("../api/memoryAssets", () => ({
  memoryAssetsApi: {
    list: vi.fn(async () => []),
    contentUrl: () => "/test/content/url",
  },
}));

vi.mock("../api/memory", () => ({
  memoryApi: memoryApiMock,
}));

vi.mock("../api/projects", () => ({
  projectsApi: {
    list: vi.fn(async () => [
      {
        id: "dept-eng",
        type: "department",
        name: "Engineering",
        urlKey: "engineering",
        archivedAt: null,
        functionType: "software_development",
      },
    ]),
  },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "co-1",
    selectedCompany: { id: "co-1", issuePrefix: "co1", name: "Test Co" },
    companyPrefix: "co1",
  }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: vi.fn(),
    setSubtitle: vi.fn(),
    setEntityColor: vi.fn(),
  }),
}));

import { MemoryExplorer } from "../pages/MemoryExplorer";

function renderPage(initialEntry = "/co1/memory/explore") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <MemoryExplorer />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("MemoryExplorer (Phase 6.1a smoke test)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 3 panes and shows company + dept folders in the tree", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Folders/i)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText("Company")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText("Engineering")).toBeInTheDocument(),
    );
  });

  it("renders the viewer empty state on Home instead of a blank right pane", async () => {
    // Phase 1 UI audit removed the "📊 Memory graph view — Coming soon"
    // placeholder. The right pane on Home is now intentionally empty until
    // Phase 2/3 lands the tabbed viewer + graph. Ensure the placeholder copy
    // is gone.
    renderPage();
    // Center pane should still render the home dashboard.
    await waitFor(() =>
      expect(screen.getByText(/Identity/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Pick a memory item or upload a file to start/i)).toBeInTheDocument();
    expect(screen.queryByText(/Coming soon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Memory graph view/i)).not.toBeInTheDocument();
  });

  it("uses rounded panel shells for the folder, list, and viewer panes", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Folders/i)).toBeInTheDocument(),
    );

    for (const id of ["memory-tree-shell", "memory-list-shell", "memory-viewer-shell"]) {
      const shell = screen.getByTestId(id);
      expect(shell.className).toContain("rounded-xl");
      expect(shell.className).toContain("border");
      expect(shell.className).toContain("bg-background");
    }
  });

  it("uses 42px panel headers with collapse controls inside memory chrome", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Folders/i)).toBeInTheDocument(),
    );

    for (const id of ["memory-tree-header", "memory-list-header", "memory-viewer-header"]) {
      expect(screen.getByTestId(id).className).toContain("h-[42px]");
    }

    expect(screen.getByTestId("memory-tree-header")).toContainElement(
      screen.getByLabelText("Collapse folders"),
    );
    expect(screen.getByTestId("memory-viewer-header")).toContainElement(
      screen.getByLabelText("Close viewer"),
    );
  });

  it("does not render floating separator collapse buttons for memory panes", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Folders/i)).toBeInTheDocument(),
    );

    for (const id of ["separator-memory-explorer-sep-1", "separator-memory-explorer-sep-2"]) {
      expect(screen.getByTestId(id).querySelector("button")).toBeNull();
    }
  });

  it("opens memory item deep links even when the URL omits legacy type=memory_item", async () => {
    renderPage("/co1/memory/explore?item=mem-1");

    await waitFor(() =>
      expect(memoryApiMock.get).toHaveBeenCalledWith("co-1", "mem-1"),
    );
  });

  it("opens one closeable Memory Home tab from the viewer add button", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Folders/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "New memory viewer tab" }));
    expect(screen.getByRole("tab", { name: /Memory Home/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New memory viewer tab" }));
    expect(screen.getAllByRole("tab", { name: /Memory Home/i })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Close Memory Home" }));
    expect(screen.queryByRole("tab", { name: /Memory Home/i })).not.toBeInTheDocument();
  });
});
