import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../context/ToastContext";

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

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/router");
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useNavigate: () => vi.fn(),
  };
});

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
  memoryApi: {
    list: vi.fn(async () => []),
    get: vi.fn(),
    moveItem: vi.fn(),
    setPinnedToTop: vi.fn(),
  },
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

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <MemoryExplorer />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("MemoryExplorer (Phase 6.1a smoke test)", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("right pane shows the home view when nothing is selected", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/Coming soon/i)).toBeInTheDocument(),
    );
  });
});
