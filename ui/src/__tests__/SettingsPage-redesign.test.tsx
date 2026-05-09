import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsPage } from "@/pages/SettingsPage";
import { SidebarProvider } from "@/context/SidebarContext";
import { DialogProvider } from "@/context/DialogContext";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: {
      id: "c1",
      name: "Phase4 Test Co",
      issuePrefix: "P4",
      description: null,
      brandColor: null,
      logoAssetId: null,
      requireBoardApprovalForNewAgents: false,
      rootFolder: null,
      status: "active",
    },
    selectedCompanyId: "c1",
    companies: [],
    setSelectedCompanyId: vi.fn(),
  }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("@/api/companies", () => ({
  companiesApi: {
    update: vi.fn().mockResolvedValue({}),
    archive: vi.fn().mockResolvedValue({}),
    uploadLogo: vi.fn().mockResolvedValue({}),
    removeLogo: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/api/access", () => ({
  accessApi: {
    createCompanyInvite: vi.fn().mockResolvedValue({
      token: "tok",
      onboardingTextUrl: "/api/invites/tok/onboarding.txt",
    }),
    getInviteOnboarding: vi.fn().mockResolvedValue({
      onboarding: { connectivity: null },
    }),
  },
}));

function renderSettings(initialPath = "/P4/settings?tab=general") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <TooltipProvider>
          <DialogProvider>
            <SidebarProvider>
              <SettingsPage />
            </SidebarProvider>
          </DialogProvider>
        </TooltipProvider>
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

  it("General section: renders company name, description, brand color, logo upload, agent invites, rootFolder fields", async () => {
    renderSettings("/P4/settings?tab=general");
    expect(await screen.findByLabelText(/Company name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
    expect(screen.getByText(/Brand color/i)).toBeInTheDocument();
    expect(screen.getByText(/Upload logo/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate agent snippet/i })).toBeInTheDocument();
    // Ghost setting added in this task — rootFolder
    expect(screen.getByLabelText(/Root folder/i)).toBeInTheDocument();
    // Archive button is NOT in the General body — only in the sidebar nav.
    // The sidebar has 2 instances (desktop + mobile sub-nav). The section adds none.
    const archiveButtons = screen.queryAllByRole("button", { name: /Archive company/i });
    expect(archiveButtons.length).toBeLessThanOrEqual(2);
  });

  it("Archive section: renders the archive button", async () => {
    renderSettings("/P4/settings?tab=archive");
    // The sidebar nav also has an "Archive company" button (desktop + mobile copies),
    // so the section's button is the additional one — expect more than the 2 nav buttons.
    const buttons = await screen.findAllByRole("button", { name: /Archive company/i });
    expect(buttons.length).toBeGreaterThan(2);
  });
});
