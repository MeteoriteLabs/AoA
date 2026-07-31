/**
 * Marketplace → Connectors: the browse + install half of the connector journey,
 * after it moved out of Settings so connectors are acquired the same way skills,
 * agents, plugins and teams are.
 *
 * WHAT THESE TESTS ARE FOR (in priority order):
 *
 *  1. An UNVERIFIED stdio entry spawns a process on the founder's machine. The
 *     dialog must show the exact argv and must not enable Install until the
 *     founder explicitly confirms. The MOVE must not have weakened this — these
 *     assertions are carried over verbatim from the Settings-era suite.
 *  2. Consent tokens live 15 minutes. A shelf left open past that mints a doomed
 *     install, so an expired token must trigger a refetch first.
 *  3. A deployment-refused entry is rendered greyed WITH the server's own reason,
 *     never hidden.
 *  4. The company the install targets is resolved the same way every other
 *     marketplace install resolves it (CompanyContext + CompanyPicker).
 *
 * Only `@/api/*` modules and CompanyContext are mocked. The page, the shelf, the
 * card and the dialog are all real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { McpConnector, McpConnectorShelfEntry } from "@/api/mcpConnectors";
import MarketplaceConnectors from "../pages/MarketplaceConnectors";

/* ── mocks ─────────────────────────────────────────────────────────────── */

const listMock = vi.fn();
const catalogMock = vi.fn();
const installMock = vi.fn();
const oauthStartMock = vi.fn();

vi.mock("@/api/mcpConnectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/mcpConnectors")>();
  return {
    ...actual,
    mcpConnectorsApi: {
      list: (...a: unknown[]) => listMock(...a),
      catalog: (...a: unknown[]) => catalogMock(...a),
      install: (...a: unknown[]) => installMock(...a),
      oauthStart: (...a: unknown[]) => oauthStartMock(...a),
      bindCredentials: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      setAgents: vi.fn(),
    },
  };
});

// Page renders inside the persistent LobbyLayout shell; stub the mobile hamburger.
vi.mock("@/components/LobbyShell", () => ({
  LobbyShellMobileMenuButton: ({ className }: any) => (
    <button aria-label="Open menu" className={className} />
  ),
}));

const roleMock = vi.fn(async () => ({ currentUser: { role: "founder", permissions: {} } }));
vi.mock("@/api/team", () => ({ teamApi: { get: () => roleMock() } }));

const COMPANY_ID = "company-1";
const OTHER_COMPANY_ID = "company-2";
const companiesMock = vi.fn(() => [
  { id: COMPANY_ID, name: "Acme", status: "active", issuePrefix: "ACME" },
]);
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: COMPANY_ID,
    selectedCompany: companiesMock()[0] ?? null,
    companies: companiesMock(),
    loading: false,
  }),
}));

/* ── fixtures ──────────────────────────────────────────────────────────── */

function shelfEntry(over: Partial<McpConnectorShelfEntry> = {}): McpConnectorShelfEntry {
  return {
    id: "notion",
    displayName: "Notion",
    description: "Read and write Notion pages.",
    serverName: "notion",
    transport: "http",
    url: "https://mcp.notion.com/sse",
    args: [],
    headerTemplateKeys: [],
    envTemplateKeys: [],
    requiresSecret: false,
    trust: { tier: "verified" },
    installable: true,
    consentRequired: false,
    ...over,
  } as McpConnectorShelfEntry;
}

/** An unverified stdio entry — the only shape that demands consent. */
function stdioEntry(over: Partial<McpConnectorShelfEntry> = {}): McpConnectorShelfEntry {
  return shelfEntry({
    id: "sketchy-fs",
    displayName: "Sketchy Filesystem",
    description: "Local filesystem access.",
    serverName: "sketchy-fs",
    transport: "stdio",
    url: undefined,
    command: "npx",
    args: ["-y", "@sketchy/mcp-fs", "--root", "/"],
    trust: { tier: "community" },
    consentRequired: true,
    consentToken: "tok-fresh",
    consentExpiresAt: Date.now() + 15 * 60_000,
    ...over,
  });
}

function connector(over: Partial<McpConnector> = {}): McpConnector {
  return {
    id: "conn-1",
    companyId: COMPANY_ID,
    serverName: "notion",
    displayName: "Notion",
    transport: "http",
    url: "https://mcp.notion.com/sse",
    command: null,
    args: [],
    headerTemplate: {},
    envTemplate: {},
    secretRef: null,
    source: "catalog",
    status: "active",
    requiresSecret: false,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    enabledAgentIds: [],
    ...over,
  };
}

function renderPage(initialPath = "/marketplace/connectors") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<Outlet context={{ setSecondarySidebar: () => {} }} />}>
            <Route path="/marketplace/connectors" element={<MarketplaceConnectors />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
  catalogMock.mockResolvedValue({ entries: [], stale: false });
  installMock.mockResolvedValue(connector());
  oauthStartMock.mockResolvedValue({ authorizeUrl: "https://as/authorize" });
  roleMock.mockResolvedValue({ currentUser: { role: "founder", permissions: {} } });
  companiesMock.mockReturnValue([
    { id: COMPANY_ID, name: "Acme", status: "active", issuePrefix: "ACME" },
  ]);
});

/* ── the surface ────────────────────────────────────────────────────────── */

describe("Marketplace → Connectors", () => {
  it("renders catalog entries against the selected company", async () => {
    catalogMock.mockResolvedValue({ entries: [shelfEntry(), stdioEntry()], stale: false });
    renderPage();

    expect(await screen.findByTestId("connector-shelf-card-notion")).toBeInTheDocument();
    expect(screen.getByTestId("connector-shelf-card-sketchy-fs")).toBeInTheDocument();
    // Company context: resolved from CompanyContext, exactly like every other
    // marketplace install — no separate mechanism was invented.
    expect(catalogMock).toHaveBeenCalledWith(COMPANY_ID);
    // Single active company → the picker stays hidden (CompanyPicker semantics).
    expect(screen.queryByTestId("connector-company-picker")).not.toBeInTheDocument();
  });

  it("shows the company picker when the founder has more than one company", async () => {
    companiesMock.mockReturnValue([
      { id: COMPANY_ID, name: "Acme", status: "active", issuePrefix: "ACME" },
      { id: OTHER_COMPANY_ID, name: "Beta", status: "active", issuePrefix: "BETA" },
    ]);
    catalogMock.mockResolvedValue({ entries: [shelfEntry()], stale: false });
    renderPage();

    expect(await screen.findByTestId("connector-company-picker")).toBeInTheDocument();
  });

  it("installs a verified http entry from the marketplace with no confirmation step", async () => {
    catalogMock.mockResolvedValue({ entries: [shelfEntry()], stale: false });
    let catalogCallsAtInstall = -1;
    installMock.mockImplementation(async () => {
      catalogCallsAtInstall = catalogMock.mock.calls.length;
      return connector();
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /install notion/i }));

    await waitFor(() =>
      expect(installMock).toHaveBeenCalledWith(COMPANY_ID, { entryId: "notion" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // An entry that needs no token must not pay for a freshness refetch.
    expect(catalogCallsAtInstall).toBe(1);
  });

  it("points the founder at Settings for the credential step after install", async () => {
    catalogMock.mockResolvedValue({
      entries: [shelfEntry({ requiresSecret: true })],
      stale: false,
    });
    installMock.mockResolvedValue(
      connector({ status: "needs_credentials", requiresSecret: true }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /install notion/i }));

    const notice = await screen.findByTestId("connector-install-notice");
    expect(notice).toHaveTextContent(/needs a credential/i);
    expect(within(notice).getByRole("link", { name: /settings/i })).toHaveAttribute(
      "href",
      expect.stringContaining("settings?tab=connectors"),
    );
  });

  it("shows the exact command and blocks Install until the founder confirms", async () => {
    catalogMock.mockResolvedValue({ entries: [stdioEntry()], stale: false });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /install sketchy filesystem/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("connector-consent-command")).toHaveTextContent(
      "npx -y @sketchy/mcp-fs --root /",
    );
    expect(within(dialog).getByText(/unverified/i)).toBeInTheDocument();

    const confirmInstall = within(dialog).getByRole("button", { name: /^install$/i });
    expect(confirmInstall).toBeDisabled();
    expect(installMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(confirmInstall).toBeEnabled();

    fireEvent.click(confirmInstall);
    await waitFor(() =>
      expect(installMock).toHaveBeenCalledWith(COMPANY_ID, {
        entryId: "sketchy-fs",
        consentToken: "tok-fresh",
      }),
    );
  });

  it("refetches instead of installing when the consent token has expired", async () => {
    catalogMock
      .mockResolvedValueOnce({
        entries: [stdioEntry({ consentToken: "tok-stale", consentExpiresAt: Date.now() - 1000 })],
        stale: false,
      })
      .mockResolvedValue({
        entries: [stdioEntry({ consentToken: "tok-refreshed" })],
        stale: false,
      });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /install sketchy filesystem/i }));

    await waitFor(() => expect(catalogMock).toHaveBeenCalledTimes(2));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: /^install$/i }));

    await waitFor(() =>
      expect(installMock).toHaveBeenCalledWith(COMPANY_ID, {
        entryId: "sketchy-fs",
        consentToken: "tok-refreshed",
      }),
    );
  });

  it("renders a deployment-refused entry as unavailable, quoting the SERVER's reason", async () => {
    catalogMock.mockResolvedValue({
      entries: [
        stdioEntry({
          installable: false,
          unavailableReason: "A future refusal branch nobody hard-coded here.",
          consentToken: undefined,
          consentExpiresAt: undefined,
        }),
      ],
      stale: false,
    });
    renderPage();

    const card = await screen.findByTestId("connector-shelf-card-sketchy-fs");
    expect(within(card).getByText(/unavailable/i)).toBeInTheDocument();
    expect(
      within(card).getByText(/A future refusal branch nobody hard-coded here\./),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
  });

  it("renders an OAuth-only entry as present, tagged, with its reason and no Install", async () => {
    catalogMock.mockResolvedValue({
      entries: [
        shelfEntry({
          id: "notion-hosted",
          displayName: "Notion (hosted)",
          serverName: "notion-hosted",
          requiresOAuth: true,
          installable: false,
          unavailableReason:
            "This connector uses OAuth sign-in, which isn't available yet (coming with the OAuth broker).",
        }),
      ],
      stale: false,
    });
    renderPage();

    const card = await screen.findByTestId("connector-shelf-card-notion-hosted");
    // The card is present (shown, not hidden) and carries a distinct OAuth tag.
    expect(within(card).getByTestId("connector-oauth-tag")).toBeInTheDocument();
    expect(within(card).getByText(/uses OAuth sign-in/i)).toBeInTheDocument();
    // ...and offers no actionable Install.
    expect(within(card).queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
  });

  it("still installs a normal entry shown beside an OAuth-only one", async () => {
    catalogMock.mockResolvedValue({
      entries: [
        shelfEntry(),
        shelfEntry({
          id: "notion-hosted",
          displayName: "Notion (hosted)",
          serverName: "notion-hosted",
          requiresOAuth: true,
          installable: false,
          unavailableReason: "This connector uses OAuth sign-in, which isn't available yet.",
        }),
      ],
      stale: false,
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /install notion/i }));
    await waitFor(() =>
      expect(installMock).toHaveBeenCalledWith(COMPANY_ID, { entryId: "notion" }),
    );
  });

  describe("OAuth broker (Authorize)", () => {
    const originalLocation = window.location;

    beforeEach(() => {
      // Same pattern as pages/__tests__/Auth.test.tsx: replace window.location
      // wholesale so `.assign` is a spy, then restore it after each test.
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: { href: "http://localhost/marketplace/connectors", assign: vi.fn() },
      });
    });

    afterEach(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    });

    function oauthEntry(over: Partial<McpConnectorShelfEntry> = {}) {
      return shelfEntry({
        id: "notion-hosted",
        displayName: "Notion (hosted)",
        serverName: "notion-hosted",
        requiresOAuth: true,
        oauthRequired: true,
        installable: true,
        ...over,
      });
    }

    it("renders Authorize (not Install) for a live oauthRequired entry", async () => {
      catalogMock.mockResolvedValue({ entries: [oauthEntry()], stale: false });
      renderPage();

      const card = await screen.findByTestId("connector-shelf-card-notion-hosted");
      expect(
        within(card).getByRole("button", { name: /authorize notion \(hosted\)/i }),
      ).toBeInTheDocument();
      expect(within(card).queryByRole("button", { name: /^install/i })).not.toBeInTheDocument();
    });

    it("installs, starts OAuth, and navigates to the authorize URL on click", async () => {
      catalogMock.mockResolvedValue({ entries: [oauthEntry()], stale: false });
      installMock.mockResolvedValue(
        connector({
          id: "conn-oauth",
          serverName: "notion-hosted",
          displayName: "Notion (hosted)",
          status: "needs_credentials",
          requiresSecret: true,
        }),
      );
      oauthStartMock.mockResolvedValue({ authorizeUrl: "https://mcp.notion.com/authorize?x=1" });
      renderPage();

      fireEvent.click(await screen.findByRole("button", { name: /authorize notion \(hosted\)/i }));

      await waitFor(() =>
        expect(installMock).toHaveBeenCalledWith(COMPANY_ID, { entryId: "notion-hosted" }),
      );
      await waitFor(() => expect(oauthStartMock).toHaveBeenCalledWith(COMPANY_ID, "conn-oauth"));
      await waitFor(() =>
        expect(window.location.assign).toHaveBeenCalledWith(
          "https://mcp.notion.com/authorize?x=1",
        ),
      );
    });
  });

  it("falls back to generic copy when the server sends no reason", async () => {
    catalogMock.mockResolvedValue({
      entries: [
        stdioEntry({ installable: false, consentToken: undefined, consentExpiresAt: undefined }),
      ],
      stale: false,
    });
    renderPage();

    const card = await screen.findByTestId("connector-shelf-card-sketchy-fs");
    expect(within(card).getByText(/cannot be installed in this deployment/i)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
  });

  it("marks an already-installed entry instead of offering Install again", async () => {
    catalogMock.mockResolvedValue({ entries: [shelfEntry()], stale: false });
    listMock.mockResolvedValue([connector()]);
    renderPage();

    const card = await screen.findByTestId("connector-shelf-card-notion");
    expect(within(card).getByText(/installed/i)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /install notion/i })).not.toBeInTheDocument();
  });

  it("filters the shelf by search without hiding anything from the install path", async () => {
    catalogMock.mockResolvedValue({ entries: [shelfEntry(), stdioEntry()], stale: false });
    renderPage();

    await screen.findByTestId("connector-shelf-card-notion");
    fireEvent.change(screen.getByLabelText(/search connectors/i), {
      target: { value: "sketchy" },
    });

    expect(screen.queryByTestId("connector-shelf-card-notion")).not.toBeInTheDocument();
    expect(screen.getByTestId("connector-shelf-card-sketchy-fs")).toBeInTheDocument();
  });

  it("never fetches the founder-only catalog for a non-founder", async () => {
    roleMock.mockResolvedValue({ currentUser: { role: "team_member", permissions: {} } });
    renderPage();

    expect(await screen.findByText(/only founders can browse and install/i)).toBeInTheDocument();
    expect(catalogMock).not.toHaveBeenCalled();
  });

  describe("post-OAuth success notice (?authorized=)", () => {
    it("shows a success notice naming the connector after the OAuth redirect", async () => {
      catalogMock.mockResolvedValue({ entries: [shelfEntry()], stale: false });
      renderPage("/marketplace/connectors?authorized=notion-hosted");

      const notice = await screen.findByTestId("connector-oauth-success-notice");
      expect(notice).toHaveTextContent(/authorized and active/i);
      expect(notice).toHaveTextContent("notion-hosted");
      expect(within(notice).getByRole("link", { name: /settings/i })).toHaveAttribute(
        "href",
        expect.stringContaining("settings?tab=connectors"),
      );
    });

    it("prefers the connector's own display name once it's in the installed list", async () => {
      catalogMock.mockResolvedValue({ entries: [shelfEntry()], stale: false });
      listMock.mockResolvedValue([
        connector({ serverName: "notion-hosted", displayName: "Notion (hosted)" }),
      ]);
      renderPage("/marketplace/connectors?authorized=notion-hosted");

      const notice = await screen.findByTestId("connector-oauth-success-notice");
      expect(within(notice).getByText("Notion (hosted)")).toBeInTheDocument();
    });

    it("does not show the notice when there is no ?authorized= param", async () => {
      catalogMock.mockResolvedValue({ entries: [shelfEntry()], stale: false });
      renderPage();

      await screen.findByTestId("connector-shelf-card-notion");
      expect(screen.queryByTestId("connector-oauth-success-notice")).not.toBeInTheDocument();
    });
  });
});
