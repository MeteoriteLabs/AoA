/**
 * Settings → Connectors: the MANAGE half of the connector journey — status
 * badges, credential binding, per-agent access, and the empty state that hands
 * a founder with nothing installed the route to the Marketplace.
 *
 * The BROWSE + INSTALL half (shelf, consent dialog, token freshness) moved to
 * Marketplace → Connectors so connectors are acquired the same way skills,
 * agents, plugins and teams are. Those assertions live — unchanged — in
 * `ui/src/pages/__tests__/MarketplaceConnectors.test.tsx`.
 *
 * WHAT THESE TESTS ARE FOR (in priority order):
 *
 *  1. `StatusBadge` used to have NO fallback branch, so an unrecognised status
 *     rendered literally nothing. P3a-11 made `needs_credentials` reachable in
 *     production, which meant a founder who installed a catalog connector saw a
 *     row with no badge at all. Both the new case and the fallback are pinned.
 *  2. A connector installed from the Marketplace lands `needs_credentials` and
 *     is useless until a secret is bound HERE. That hand-off is the seam the
 *     relocation created, so it is pinned from both ends.
 *  3. Settings must no longer render a browsable catalog — and must not become a
 *     dead end because of it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { McpConnector } from "@/api/mcpConnectors";
import { MCPConnectorsSection, StatusBadge } from "../sections/MCPConnectorsSection";

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
  useCompany: () => ({
    selectedCompanyId: COMPANY_ID,
    // `@/lib/router`'s Link reads selectedCompany to resolve the board prefix.
    selectedCompany: { id: COMPANY_ID, name: "Acme", status: "active", issuePrefix: "ACME" },
    companies: [{ id: COMPANY_ID, name: "Acme", status: "active", issuePrefix: "ACME" }],
    loading: false,
  }),
}));

/* ── fixtures ──────────────────────────────────────────────────────────── */

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
    deliverability: null,
    ...over,
  };
}

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/ACME/settings?tab=connectors"]}>
        <MCPConnectorsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
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

/* ── 5. delivery health (FU-1) ──────────────────────────────────────────── */

describe("delivery-skip visibility (FU-1)", () => {
  it("shows no delivery warning for a healthy, deliverable active connector", async () => {
    listMock.mockResolvedValue([
      connector({
        deliverability: { deliverable: true, reason: null, blockedAgents: [] },
      }),
    ]);
    renderSection();

    await screen.findByTestId("connector-row-conn-1");
    expect(
      screen.queryByTestId("connector-delivery-warning-conn-1"),
    ).not.toBeInTheDocument();
  });

  it("surfaces a global d7_blocked reason on an active-but-undeliverable connector", async () => {
    listMock.mockResolvedValue([
      connector({
        transport: "stdio",
        command: "npx fs-mcp",
        url: null,
        deliverability: { deliverable: false, reason: "d7_blocked", blockedAgents: [] },
      }),
    ]);
    renderSection();

    const warning = await screen.findByTestId("connector-delivery-warning-conn-1");
    // Distinct from the healthy green "Active" badge.
    expect(within(warning).getByText(/not reaching agents/i)).toBeInTheDocument();
    expect(within(warning).getByText(/aren't allowed in this deployment/i)).toBeInTheDocument();
  });

  it("names the blocked agent for a per-agent secret_unreachable (codex + stdio secret)", async () => {
    listMock.mockResolvedValue([
      connector({
        transport: "stdio",
        command: "npx fs-mcp",
        url: null,
        secretRef: "mcp:fs",
        requiresSecret: true,
        deliverability: {
          deliverable: false,
          reason: null,
          blockedAgents: [
            { agentId: "a2", agentName: "Codey", reason: "secret_unreachable" },
          ],
        },
      }),
    ]);
    renderSection();

    const warning = await screen.findByTestId("connector-delivery-warning-conn-1");
    expect(within(warning).getByText(/Codey/)).toBeInTheDocument();
    expect(within(warning).getByText(/Codex CLI can't pass/i)).toBeInTheDocument();
  });

  it("still shows the needs_credentials affordance (its own surface) untouched", async () => {
    listMock.mockResolvedValue([
      connector({
        status: "needs_credentials",
        requiresSecret: true,
        secretRef: null,
        headerTemplate: { Authorization: "" },
        // non-active → deliverability is null; the status badge speaks for it
        deliverability: null,
      }),
    ]);
    renderSection();

    expect(await screen.findByText("Needs setup")).toBeInTheDocument();
    const row = screen.getByTestId("connector-row-conn-1");
    expect(within(row).getByRole("button", { name: /add credential/i })).toBeInTheDocument();
    // No delivery warning competes with the credential affordance.
    expect(
      screen.queryByTestId("connector-delivery-warning-conn-1"),
    ).not.toBeInTheDocument();
  });
});

/* ── 3. Settings is manage-only, and the empty state is not a dead end ──── */

describe("Settings no longer browses the catalog", () => {
  it("never fetches the connector catalog", async () => {
    listMock.mockResolvedValue([connector()]);
    renderSection();

    await screen.findByTestId("connector-row-conn-1");
    // The browsable shelf moved to Marketplace → Connectors. If this ever fires
    // again from Settings, the two surfaces have drifted back together.
    expect(catalogMock).not.toHaveBeenCalled();
    expect(installMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("connector-shelf-card-notion")).not.toBeInTheDocument();
  });

  it("sends a founder with zero connectors to the Marketplace surface", async () => {
    listMock.mockResolvedValue([]);
    renderSection();

    const empty = await screen.findByTestId("connectors-empty-state");
    expect(within(empty).getByText(/no connectors yet/i)).toBeInTheDocument();
    // A dead end would be: "you have none" with no way to get one.
    expect(
      await within(empty).findByRole("link", { name: /browse connectors in marketplace/i }),
    ).toHaveAttribute("href", "/marketplace/connectors");
  });

  it("keeps a persistent link to the Marketplace surface next to the list", async () => {
    listMock.mockResolvedValue([connector()]);
    renderSection();

    await screen.findByTestId("connector-row-conn-1");
    expect(screen.getByRole("link", { name: /browse connectors/i })).toHaveAttribute(
      "href",
      "/marketplace/connectors",
    );
  });
});
