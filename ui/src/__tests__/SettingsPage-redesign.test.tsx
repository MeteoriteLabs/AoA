import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsPage } from "@/pages/SettingsPage";
import { SETTINGS_SECTIONS } from "@/components/settings/SettingsLayout";
import { SidebarProvider } from "@/context/SidebarContext";
import { DialogProvider } from "@/context/DialogContext";
import { ThemeProvider } from "@/context/ThemeContext";
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

// ─── Task 3 mocks ─────────────────────────────────────────────────────
vi.mock("@/api/costs", () => ({
  costsApi: {
    summary: vi.fn().mockResolvedValue({
      spendCents: 0,
      budgetCents: 0,
      utilizationPercent: 0,
    }),
    byAgent: vi.fn().mockResolvedValue([]),
    byProject: vi.fn().mockResolvedValue([]),
    byModel: vi.fn().mockResolvedValue([]),
    byBiller: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/api/finance", () => ({
  financeApi: {
    summary: vi.fn().mockResolvedValue({ totalCents: 0, eventCount: 0 }),
    byBiller: vi.fn().mockResolvedValue([]),
    byKind: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/api/quotas", () => ({
  quotasApi: {
    list: vi.fn().mockResolvedValue([]),
    refresh: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

vi.mock("@/api/budgets", () => ({
  budgetsApi: {
    overview: vi.fn().mockResolvedValue({
      policies: [],
      openIncidents: [],
    }),
    upsertPolicy: vi.fn().mockResolvedValue({ id: "p1" }),
    deletePolicy: vi.fn().mockResolvedValue({ ok: true }),
    resolveIncident: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

vi.mock("@/api/internal-agent", () => ({
  internalAgentApi: {
    getConfig: vi.fn().mockResolvedValue({
      id: "ia-cfg-1",
      executionMode: "cli",
      provider: null,
      model: null,
      cliTool: "claude_cli",
      autonomyLevel: 0,
      enabledCapabilities: [
        "discussion_processing",
        "proactive_suggestions",
        "organizational_queries",
        "system_actions",
        "context_briefing",
        "memory_management",
        "conflict_detection",
        "budget_awareness",
        "workflow_coaching",
        "workflow_discovery",
        "cross_department_coordination",
        "department_personas",
      ],
      notificationPreference: "realtime",
      contextTokenBudget: 8000,
      budgetMonthlyCents: null,
      spentMonthlyCents: 0,
      proactiveIntervalMinutes: 240,
      lastProactiveRunAt: null,
    }),
    getRuns: vi.fn().mockResolvedValue({
      runs: [],
      total: 0,
      limit: 20,
      offset: 0,
      aggregates: {
        totalCostCents: 0,
        totalRuns: 0,
        avgDurationMs: 0,
        failureRate: 0,
      },
    }),
    testConnection: vi.fn().mockResolvedValue({ success: true }),
    updateConfig: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/api/mcp", () => ({
  mcpApi: {
    status: vi.fn().mockResolvedValue({
      enabled: false,
      keyCount: 0,
      connectedClients: 0,
      endpointPath: "/api/companies/c1/mcp",
    }),
    listKeys: vi.fn().mockResolvedValue([]),
    listClients: vi.fn().mockResolvedValue([]),
    updateSettings: vi.fn().mockResolvedValue({}),
    createKey: vi.fn().mockResolvedValue({ token: "abc" }),
    revokeKey: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

vi.mock("@/api/secrets", () => ({
  secretsApi: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    rotate: vi.fn().mockResolvedValue({}),
    remove: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

vi.mock("@/api/plugins", () => ({
  listCompanyPlugins: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/api/github-integration", () => ({
  githubIntegrationApi: {
    status: vi.fn().mockResolvedValue({ configured: false }),
    setPat: vi.fn().mockResolvedValue({ configured: true, githubUser: "test-user" }),
    removePat: vi.fn().mockResolvedValue({ configured: false, removed: true }),
    createPR: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/api/marketplace", () => ({
  marketplaceApi: {
    getSettings: vi.fn().mockResolvedValue({
      pluginUpdatePolicy: "notify_all",
      skillUpdatePolicy: "notify",
      agentUpdatePolicy: "notify",
      teamUpdatePolicy: "notify",
      showTrustBadges: true,
      showSourceInfo: true,
      allowTeamLeadPlugins: false,
      teamMemberCanRequestInstall: false,
      requireFounderApproval: false,
      catalogRefreshHours: 6,
      updateCheckHours: 24,
      updateWindow: "anytime",
    }),
    patchSettings: vi.fn().mockResolvedValue({}),
    getUpdates: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn(), dismissToast: vi.fn(), clearToasts: vi.fn(), toasts: [] }),
}));

function renderSettings(initialPath = "/P4/settings?tab=general") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ThemeProvider>
          <TooltipProvider>
            <DialogProvider>
              <SidebarProvider>
                <SettingsPage />
              </SidebarProvider>
            </DialogProvider>
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Mounts the same redirect routes that App.tsx defines, to exercise the
// /settings/commander → /settings?tab=commander redirect chain end-to-end.
function renderViaAppRoutes(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ThemeProvider>
          <TooltipProvider>
            <DialogProvider>
              <SidebarProvider>
                <Routes>
                  <Route path=":companyPrefix">
                    <Route
                      path="settings/commander"
                      element={<Navigate to="../settings?tab=commander" replace />}
                    />
                    <Route
                      path="settings/internal-agent"
                      element={<Navigate to="../settings?tab=commander" replace />}
                    />
                    <Route path="settings" element={<SettingsPage />} />
                  </Route>
                </Routes>
              </SidebarProvider>
            </DialogProvider>
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SettingsPage redesign — Phase F shell", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1280 });
    window.dispatchEvent(new Event("resize"));
    // Reset secondary-sidebar collapse state so tests start expanded
    try { localStorage.removeItem("aoa.settings-secondary-collapsed"); } catch { /* noop */ }
  });

  it("renders the SecondarySidebar with all 11 section items", () => {
    renderSettings();
    // Defensive: catch silent drift in section count.
    const totalItems = SETTINGS_SECTIONS.flatMap((g) => g.items).length;
    expect(totalItems).toBe(11);
    // Each label appears in both the desktop sidebar and the mobile sub-nav pill row
    // (CSS media queries that hide one or the other are not evaluated in JSDOM).
    expect(screen.getAllByText("General").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Activity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Commander").length).toBeGreaterThan(0);
    expect(screen.getAllByText("LLM providers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Budget & caps").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MCP API keys").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Environments").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GitHub").length).toBeGreaterThan(0);
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

  it("Budget section: renders date presets, summary, by-agent, by-project, budgets, quotas, breakdown", async () => {
    renderSettings("/P4/settings?tab=budget");
    expect(await screen.findByRole("button", { name: /MTD/i })).toBeInTheDocument();
    expect(screen.getByText(/By Agent/i)).toBeInTheDocument();
    expect(screen.getByText(/By Project/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Budgets/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Quotas/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Breakdown/i)).toBeInTheDocument();
  });

  it("MCP API keys section: renders MCP server controls — NO GitHub card", async () => {
    renderSettings("/P4/settings?tab=mcp");
    // "MCP Server" appears in both the sub-section header and the toggle label.
    const mcpServerMatches = await screen.findAllByText(/MCP Server/i);
    expect(mcpServerMatches.length).toBeGreaterThan(0);
    expect(screen.getByText(/API Key Management/i)).toBeInTheDocument();
    // The GitHub card is GONE — no Connect, no PAT
    expect(screen.queryByText(/Personal Access Token/i)).toBeNull();
    expect(screen.queryByText(/Connect GitHub/i)).toBeNull();
  });

  it("Marketplace prefs section: renders Updates / Access / Catalog Refresh + updateWindow Select", async () => {
    renderSettings("/P4/settings?tab=marketplace");
    expect(await screen.findByText(/^Updates$/)).toBeInTheDocument();
    expect(screen.getByText(/^Access$/)).toBeInTheDocument();
    // "Catalog Refresh" appears in both the sub-section header and the field label.
    const catalogMatches = screen.getAllByText(/Catalog Refresh/i);
    expect(catalogMatches.length).toBeGreaterThan(0);
    // Ghost setting — updateWindow
    expect(screen.getByText(/Update window/i)).toBeInTheDocument();
  });

  it("LLM providers section: renders Anthropic, OpenAI, Google", async () => {
    renderSettings("/P4/settings?tab=llm");
    expect(await screen.findByText(/Anthropic/i)).toBeInTheDocument();
    expect(screen.getByText(/OpenAI/i)).toBeInTheDocument();
    expect(screen.getByText(/Google/i)).toBeInTheDocument();
  });

  it("Plugins section: renders the existing PluginsSection", async () => {
    renderSettings("/P4/settings?tab=plugins");
    // The PluginsSection renders an h2 with "Plugins" text + count
    expect(await screen.findByRole("heading", { name: /Plugins/i })).toBeInTheDocument();
  });

  it("Commander section: renders 4 sub-tabs", async () => {
    renderSettings("/P4/settings?tab=commander");
    expect(await screen.findByRole("tab", { name: /Execution & Model/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Capabilities/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Budget & Spend/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Run History/i })).toBeInTheDocument();
  });

  it("Commander Capabilities sub-tab: renders proactiveIntervalMinutes input (ghost setting → UI)", async () => {
    renderSettings("/P4/settings?tab=commander&sub=capabilities");
    expect(await screen.findByLabelText(/Proactive scan interval/i)).toBeInTheDocument();
  });

  it("does not render an Activity section in Settings", () => {
    renderSettings("/P4/settings?tab=activity");
    // The shell should fall back to General (default) for unknown tab values
    // The "general" section heading ("General." h2) should appear, not an Activity heading
    expect(screen.queryByText(/Activity event log/i)).toBeNull();
  });

  it("does NOT render the redundant 'Settings' header inside the secondary aside", async () => {
    renderSettings();
    // After cleanup, the aside's first child should be the <nav>, not a header div with "Settings" text.
    // Selector: SecondarySidebar aside (has shrink-0 + flex-col; uses md:flex for responsive display).
    const aside = document.querySelector("aside.shrink-0.flex-col");
    expect(aside).not.toBeNull();
    const firstChild = aside!.firstElementChild;
    expect(firstChild?.tagName.toLowerCase()).toBe("nav");
  });

  it("renders the SecondarySidebar collapse toggle button", async () => {
    renderSettings();
    // SidebarCollapseToggle's aria-label is overridden via its `ariaLabel` prop in SettingsLayout.
    expect(await screen.findByLabelText(/collapse settings nav|expand settings nav/i)).toBeInTheDocument();
  });

  it("toggles the SecondarySidebar between expanded (200px) and collapsed (48px)", async () => {
    const user = userEvent.setup();
    renderSettings();
    const toggle = await screen.findByLabelText(/collapse settings nav/i);

    // Initially expanded — aside has w-[200px]
    let aside = document.querySelector("aside.shrink-0.flex-col") as HTMLElement;
    expect(aside.className).toContain("w-[200px]");

    await user.click(toggle);
    aside = document.querySelector("aside.shrink-0.flex-col") as HTMLElement;
    expect(aside.className).toContain("w-[48px]");

    expect(screen.getByLabelText(/expand settings nav/i)).toBeInTheDocument();
  });

  it("GitHub section: renders the GitHubIntegrationCard with section header + transitional pill", async () => {
    renderSettings("/P4/settings?tab=github");

    // Section header h2 — "GitHub" with the brand-colored period.
    const headings = await screen.findAllByRole("heading", { name: /^GitHub/i });
    expect(headings.length).toBeGreaterThan(0);

    // Transitional pill in the section header.
    expect(screen.getByText(/migrating to plugins/i)).toBeInTheDocument();

    // The GitHubIntegrationCard's actual rendered content. With a mocked
    // status of `{ configured: false }`, the unconnected branch shows a PAT
    // input + "Connect" button + descriptive copy.
    expect(
      await screen.findByLabelText(/GitHub Personal Access Token/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect/i })).toBeInTheDocument();
  });

  it("/settings/commander route redirects to /settings?tab=commander", async () => {
    renderViaAppRoutes("/P4/settings/commander");
    // After the redirect, the Commander section should render with its 4 sub-tabs.
    expect(
      await screen.findByRole("tab", { name: /Execution & Model/i }),
    ).toBeInTheDocument();
  });

  it("/settings/internal-agent route redirects to /settings?tab=commander", async () => {
    renderViaAppRoutes("/P4/settings/internal-agent");
    expect(
      await screen.findByRole("tab", { name: /Execution & Model/i }),
    ).toBeInTheDocument();
  });

  it("Settings > General > Appearance has a Theme field with 3 options (Dark / Light / System)", async () => {
    renderSettings("/P4/settings?tab=general");
    expect(await screen.findByRole("button", { name: /^Dark$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Light$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^System$/i })).toBeInTheDocument();
  });
});
