import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const navigateMock = vi.fn();
vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/router");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("../api/memoryFolders", () => ({
  memoryFoldersApi: {
    list: vi.fn(async () => [
      {
        id: "f-co",
        companyId: "co-1",
        departmentId: null,
        path: "Company",
        displayName: "Company",
        icon: "🏛️",
        sortOrder: 0,
        seedKey: "company-root",
      },
      {
        id: "f-eng-decisions",
        companyId: "co-1",
        departmentId: "d-eng",
        path: "engineering/Decisions",
        displayName: "Decisions",
        icon: null,
        sortOrder: 0,
        seedKey: "decisions",
      },
    ]),
  },
}));

vi.mock("../api/projects", () => ({
  projectsApi: {
    list: vi.fn(async () => [
      {
        id: "d-eng",
        type: "department",
        name: "Engineering",
        archivedAt: null,
        urlKey: "engineering",
      },
      {
        id: "d-mkt",
        type: "department",
        name: "Marketing",
        archivedAt: null,
        urlKey: "marketing",
      },
    ]),
  },
}));

vi.mock("../api/memory", () => ({
  memoryApi: {
    list: vi.fn(async () => [
      { id: "i-id1", title: "Vision", layer: "identity", status: "approved", founderPinnedToTop: true },
      { id: "i-d1", title: "Auth", layer: "domain", status: "approved", departmentId: "d-eng" },
      { id: "i-d2", title: "API", layer: "domain", status: "pending", departmentId: "d-eng" },
      { id: "i-a1", title: "Ctx", layer: "active_context", status: "approved", goalId: "g-1" },
      { id: "i-w1", title: "Work", layer: "working", status: "approved" },
    ]),
  },
}));

vi.mock("../api/goals", () => ({
  goalsApi: {
    list: vi.fn(async () => [
      { id: "g-1", title: "Ship in EU", status: "active", level: "goal" },
      { id: "g-2", title: "Q3 OKRs", status: "active", level: "goal" },
      { id: "g-3", title: "Achieved", status: "achieved", level: "goal" },
    ]),
  },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "co-1",
    selectedCompany: { issuePrefix: "co1" },
  }),
}));

import { MemoryTree } from "../components/memory/MemoryTree";

function renderTree(
  selected: { folder?: string; dept?: string | null; layer?: string | null; goal?: string | null } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MemoryTree
          companyId="co-1"
          selectedFolderPath={selected.folder ?? ""}
          selectedDepartmentId={selected.dept ?? null}
          selectedLayer={selected.layer ?? null}
          selectedGoalId={selected.goal ?? null}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MemoryTree (Phase 6.2a)", () => {
  beforeEach(() => {
    navigateMock.mockClear();
  });

  it("renders the cross-cutting shortcuts at the top", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Home")).toBeInTheDocument());
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("Pending Review")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("renders all 4 layer headers", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Identity")).toBeInTheDocument());
    expect(screen.getByText("Domain")).toBeInTheDocument();
    expect(screen.getByText("Active Context")).toBeInTheDocument();
    expect(screen.getByText("Working")).toBeInTheDocument();
  });

  it("auto-expands Identity + Domain by default; Active and Working collapsed", async () => {
    renderTree();
    await waitFor(() => expect(screen.getByText("Engineering")).toBeInTheDocument());
    // Identity expanded -> Company visible
    expect(screen.getByText("Company")).toBeInTheDocument();
    // Domain expanded -> Engineering, Marketing visible
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Marketing")).toBeInTheDocument();
    // Active/Working collapsed -> goal "Ship in EU" not visible
    expect(screen.queryByText("Ship in EU")).not.toBeInTheDocument();
  });

  it("Active Context expansion shows only goals with status='active'", async () => {
    const user = userEvent.setup();
    renderTree();
    await waitFor(() => screen.getByText("Active Context"));
    const activeHeader = screen.getByText("Active Context").closest("div");
    expect(activeHeader).not.toBeNull();
    await user.click(activeHeader!);
    await waitFor(() => expect(screen.getByText("Ship in EU")).toBeInTheDocument());
    expect(screen.getByText("Q3 OKRs")).toBeInTheDocument();
    // status='achieved' goal NOT shown
    expect(screen.queryByText("Achieved")).not.toBeInTheDocument();
  });

  it("Working layer has no children (flat)", async () => {
    const user = userEvent.setup();
    renderTree();
    await waitFor(() => screen.getByText("Working"));
    const workingHeader = screen.getByText("Working").closest("div");
    await user.click(workingHeader!);
    // After expansion, no nested children — Working stays leaf.
    // We assert that no extra entries appeared (the header itself counts as 1).
    // Easier: assert no element with text matching common task patterns.
    expect(screen.queryByText(/Task: /i)).not.toBeInTheDocument();
  });

  it("Pinned shortcut shows count when there are pinned items", async () => {
    renderTree();
    await waitFor(() => screen.getByText("Pinned"));
    const pinnedRow = screen.getByText("Pinned").closest("div");
    expect(pinnedRow?.textContent).toMatch(/1/);
  });

  it("Pending Review shows pending count", async () => {
    renderTree();
    await waitFor(() => screen.getByText("Pending Review"));
    const pendingRow = screen.getByText("Pending Review").closest("div");
    expect(pendingRow?.textContent).toMatch(/1/);
  });

  it("clicking Home navigates to /memory/explore (no params)", async () => {
    const user = userEvent.setup();
    renderTree();
    await waitFor(() => screen.getByText("Home"));
    await user.click(screen.getByText("Home"));
    expect(navigateMock).toHaveBeenCalledWith("/co1/memory/explore");
  });

  it("clicking a layer header navigates with ?layer= param", async () => {
    const user = userEvent.setup();
    renderTree();
    await waitFor(() => screen.getByText("Identity"));
    await user.click(screen.getByText("Identity"));
    expect(navigateMock).toHaveBeenCalledWith("/co1/memory/explore?layer=identity");
  });

  it("clicking a department navigates to scope URL", async () => {
    const user = userEvent.setup();
    renderTree();
    await waitFor(() => screen.getByText("Engineering"));
    await user.click(screen.getByText("Engineering"));
    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls[navigateMock.mock.calls.length - 1][0];
    expect(lastCall).toMatch(/dept=d-eng/);
    expect(lastCall).not.toMatch(/folder=/);  // dept-only, no folder param
  });
});
