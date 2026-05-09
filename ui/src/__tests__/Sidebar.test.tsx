import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "@/components/Sidebar";
import { SidebarProvider } from "@/context/SidebarContext";
import { DialogProvider } from "@/context/DialogContext";

// Mock APIs the sidebar pulls from
vi.mock("@/api/sidebarBadges", () => ({
  sidebarBadgesApi: {
    get: vi.fn().mockResolvedValue({ inbox: 0, pendingDiscussions: 0, failedRuns: 0 }),
  },
}));
vi.mock("@/api/plugins", () => ({
  pluginsApi: { listUiContributions: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/api/projects", () => ({
  projectsApi: {
    list: vi.fn().mockResolvedValue([
      { id: "p1", name: "Q4 launch", type: "project", color: "#10b981", archivedAt: null, sortOrder: 0 },
      { id: "d1", name: "Engineering", type: "department", color: "#06b6d4", archivedAt: null, sortOrder: 0 },
    ]),
  },
}));
vi.mock("@/hooks/useLiveAgentCount", () => ({
  useLiveAgentCount: () => 0,
}));
vi.mock("@/hooks/usePendingUpdates", () => ({
  usePendingUpdates: () => ({ data: [] }),
}));
vi.mock("@/components/UserMenu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));
vi.mock("@/context/CompanyContext", async () => {
  return {
    CompanyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useCompany: () => ({
      selectedCompany: { id: "c1", name: "Phase4 Test Co", issuePrefix: "P4", brandColor: "#7c3aed" },
      selectedCompanyId: "c1",
    }),
  };
});

function renderSidebar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/P4/home"]}>
        <DialogProvider>
          <SidebarProvider>
            <Sidebar />
          </SidebarProvider>
        </DialogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Force desktop dimensions for these tests
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1280 });
  window.dispatchEvent(new Event("resize"));
});

describe("Sidebar — Phase E chrome", () => {
  it("does not render Marketplace nav item", () => {
    renderSidebar();
    expect(screen.queryByText("Marketplace")).toBeNull();
  });

  it("does not render Updates nav item", () => {
    renderSidebar();
    expect(screen.queryByText(/^Updates/)).toBeNull();
  });

  it("does not render bottom UserMenu", () => {
    renderSidebar();
    expect(screen.queryByTestId("user-menu")).toBeNull();
  });

  it("renders the external SidebarCollapseToggle on desktop", () => {
    renderSidebar();
    expect(screen.getByLabelText(/collapse sidebar/i)).toBeInTheDocument();
  });

  it("header company-name link navigates to lobby (href='/' )", () => {
    renderSidebar();
    const link = screen.getByTitle(/back to all companies/i);
    expect(link).toHaveAttribute("href", "/");
  });
});
