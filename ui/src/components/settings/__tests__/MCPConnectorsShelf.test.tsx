/**
 * Settings → Connectors: the curated shelf, the consent dialog, the status
 * badge, and the post-install credential path.
 *
 * WHAT THESE TESTS ARE FOR (in priority order):
 *
 *  1. `StatusBadge` used to have NO fallback branch, so an unrecognised status
 *     rendered literally nothing. P3a-11 made `needs_credentials` reachable in
 *     production, which meant a founder who installed a catalog connector saw a
 *     row with no badge at all. Both the new case and the fallback are pinned.
 *  2. An UNVERIFIED stdio entry spawns a process on the founder's machine. The
 *     dialog must show the exact argv and must not enable Install until the
 *     founder explicitly confirms. This is the whole point of the task.
 *  3. Consent tokens live 15 minutes. A shelf left open past that mints a
 *     doomed install, so an expired token must trigger a refetch first.
 *
 * Only `@/api/*` modules are mocked. The components under test — card, dialog,
 * freshness helper — stay real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { McpConnector, McpConnectorShelfEntry } from "@/api/mcpConnectors";
import { MCPConnectorsSection, StatusBadge } from "../sections/MCPConnectorsSection";
import { isConsentFresh, CONSENT_REFRESH_MARGIN_MS } from "../sections/connectors/consentFreshness";

/* ── mocks ─────────────────────────────────────────────────────────────── */

const listMock = vi.fn();
const catalogMock = vi.fn();
const installMock = vi.fn();
const bindCredentialsMock = vi.fn();

vi.mock("@/api/mcpConnectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/mcpConnectors")>();
  return {
    ...actual,
    mcpConnectorsApi: {
      list: (...a: unknown[]) => listMock(...a),
      catalog: (...a: unknown[]) => catalogMock(...a),
      install: (...a: unknown[]) => installMock(...a),
      bindCredentials: (...a: unknown[]) => bindCredentialsMock(...a),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      setAgents: vi.fn(),
    },
  };
});

vi.mock("@/api/agents", () => ({ agentsApi: { list: vi.fn(async () => []) } }));

const healthMock = vi.fn(async () => ({ status: "ok", deploymentMode: "local_trusted" }));
vi.mock("@/api/health", () => ({ healthApi: { get: () => healthMock() } }));

vi.mock("@/api/team", () => ({
  teamApi: {
    get: vi.fn(async () => ({ currentUser: { role: "founder", permissions: {} } })),
  },
}));

const COMPANY_ID = "company-1";
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: COMPANY_ID }),
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

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MCPConnectorsSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
  catalogMock.mockResolvedValue({ entries: [], stale: false });
  installMock.mockResolvedValue(connector());
  bindCredentialsMock.mockResolvedValue(connector({ secretRef: "mcp:notion", status: "active" }));
  healthMock.mockResolvedValue({ status: "ok", deploymentMode: "local_trusted" });
});

/* ── 1. StatusBadge ─────────────────────────────────────────────────────── */

describe("StatusBadge", () => {
  it.each([
    ["active", "Active"],
    ["pending_approval", "Pending approval"],
    ["needs_credentials", "Needs setup"],
    ["disabled", "Disabled"],
  ])("renders a badge for %s", (status, label) => {
    render(<StatusBadge status={status as McpConnector["status"]} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("renders the raw status for an unknown value instead of nothing", () => {
    // Regression: the original implementation had no fallback `return`, so an
    // unrecognised status produced an empty render and the founder saw a
    // connector row with no state at all.
    const { container } = render(
      <StatusBadge status={"quarantined" as McpConnector["status"]} />,
    );
    expect(container.textContent).toContain("quarantined");
    expect(container.textContent).not.toBe("");
  });
});

/* ── 2. consent freshness helper ────────────────────────────────────────── */

describe("isConsentFresh", () => {
  const now = 1_000_000;
  it("is false without a token", () => {
    expect(isConsentFresh({ consentExpiresAt: now + 10 * 60_000 }, now)).toBe(false);
  });
  it("is false when the token expires inside the safety margin", () => {
    expect(
      isConsentFresh(
        { consentToken: "t", consentExpiresAt: now + CONSENT_REFRESH_MARGIN_MS - 1 },
        now,
      ),
    ).toBe(false);
  });
  it("is true for a comfortably live token", () => {
    expect(
      isConsentFresh(
        { consentToken: "t", consentExpiresAt: now + CONSENT_REFRESH_MARGIN_MS + 1 },
        now,
      ),
    ).toBe(true);
  });
});

/* ── 3. the shelf ───────────────────────────────────────────────────────── */

describe("connector shelf", () => {
  it("installs a verified http entry with no confirmation step", async () => {
    catalogMock.mockResolvedValue({ entries: [shelfEntry()], stale: false });
    // Sampled INSIDE the install call, because the success path deliberately
    // invalidates the catalog afterwards (to re-mint tokens) — a plain
    // call-count assertion would measure that, not the pre-install path.
    let catalogCallsAtInstall = -1;
    installMock.mockImplementation(async () => {
      catalogCallsAtInstall = catalogMock.mock.calls.length;
      return connector();
    });
    renderSection();

    const install = await screen.findByRole("button", { name: /install notion/i });
    fireEvent.click(install);

    await waitFor(() => expect(installMock).toHaveBeenCalledWith(COMPANY_ID, { entryId: "notion" }));
    // No dialog was ever opened — nothing to confirm.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // An entry that needs no token must not pay for a freshness refetch.
    expect(catalogCallsAtInstall).toBe(1);
  });

  it("renders a deployment-refused entry as unavailable, quoting the SERVER's reason", async () => {
    // The reason must come off the wire, not out of a client-side constant: the
    // shelf must report whichever refusal branch the server's D7 gate actually
    // took, including one this build has never heard of.
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
    renderSection();

    const card = await screen.findByTestId("connector-shelf-card-sketchy-fs");
    expect(within(card).getByText(/unavailable/i)).toBeInTheDocument();
    expect(
      within(card).getByText(/A future refusal branch nobody hard-coded here\./),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
  });

  it("falls back to generic copy when the server sends no reason", async () => {
    catalogMock.mockResolvedValue({
      entries: [stdioEntry({ installable: false, consentToken: undefined, consentExpiresAt: undefined })],
      stale: false,
    });
    renderSection();

    const card = await screen.findByTestId("connector-shelf-card-sketchy-fs");
    expect(
      within(card).getByText(/cannot be installed in this deployment/i),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
  });

  it("shows the exact command and blocks Install until the founder confirms", async () => {
    catalogMock.mockResolvedValue({ entries: [stdioEntry()], stale: false });
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: /install sketchy filesystem/i }));

    const dialog = await screen.findByRole("dialog");
    // The exact argv, verbatim — this is the string the founder is consenting to.
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
    renderSection();

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

  it("marks an already-installed entry instead of offering Install again", async () => {
    catalogMock.mockResolvedValue({ entries: [shelfEntry()], stale: false });
    listMock.mockResolvedValue([connector()]);
    renderSection();

    const card = await screen.findByTestId("connector-shelf-card-notion");
    expect(within(card).getByText(/installed/i)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /install notion/i })).not.toBeInTheDocument();
  });
});

/* ── 4. post-install credential path ────────────────────────────────────── */

describe("needs_credentials follow-through", () => {
  it("offers a one-click credential path on an installed-but-unusable connector", async () => {
    listMock.mockResolvedValue([
      connector({
        status: "needs_credentials",
        requiresSecret: true,
        secretRef: null,
        headerTemplate: { Authorization: "" },
      }),
    ]);
    renderSection();

    expect(await screen.findByText("Needs setup")).toBeInTheDocument();

    const row = screen.getByTestId("connector-row-conn-1");
    fireEvent.click(within(row).getByRole("button", { name: /add credential/i }));
    fireEvent.change(within(row).getByLabelText(/secret reference/i), {
      target: { value: "mcp:notion" },
    });
    fireEvent.click(within(row).getByRole("button", { name: /save credential/i }));

    await waitFor(() =>
      expect(bindCredentialsMock).toHaveBeenCalledWith(COMPANY_ID, "conn-1", "mcp:notion"),
    );
  });
});
