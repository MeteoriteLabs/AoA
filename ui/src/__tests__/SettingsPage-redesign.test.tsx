import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsPage } from "@/pages/SettingsPage";
import { SidebarProvider } from "@/context/SidebarContext";
import { DialogProvider } from "@/context/DialogContext";

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: { id: "c1", name: "Phase4 Test Co", issuePrefix: "P4" },
    selectedCompanyId: "c1",
    companies: [],
    setSelectedCompanyId: vi.fn(),
  }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

function renderSettings(initialPath = "/P4/settings?tab=general") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <DialogProvider>
          <SidebarProvider>
            <SettingsPage />
          </SidebarProvider>
        </DialogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SettingsPage redesign — Phase F shell", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1280 });
    window.dispatchEvent(new Event("resize"));
  });

  it("renders the SecondarySidebar with all 8 section items", () => {
    renderSettings();
    // Each label appears in both the desktop sidebar and the mobile sub-nav pill row
    // (CSS media queries that hide one or the other are not evaluated in JSDOM).
    expect(screen.getAllByText("General").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Commander").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LLM providers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Budget & caps").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MCP API keys").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Plugins").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Marketplace prefs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Archive company").length).toBeGreaterThan(0);
  });

  it("renders the 4 group labels (Company / Operations / Extensions / Danger)", () => {
    renderSettings();
    expect(screen.getByText("Company")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("Extensions")).toBeInTheDocument();
    expect(screen.getByText("Danger")).toBeInTheDocument();
  });

  it("does not render the legacy PageTabBar", () => {
    renderSettings();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("does not render the legacy 'Commander' card link at the top", () => {
    renderSettings();
    expect(screen.queryByText(/Configure the Commander/i)).toBeNull();
  });
});
