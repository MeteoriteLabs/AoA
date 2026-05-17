import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, makeAgent, mockCompanyContext, mockBreadcrumbContext } from "./test-utils";

// --- Mocks ---

const mockNavigate = vi.fn();

const mockParams: { agentId: string; companyPrefix?: string; tab?: string } = {
  agentId: "agent-aoa-1",
  companyPrefix: undefined,
  tab: undefined,
};

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParams,
    Link: actual.Link,
    NavLink: actual.NavLink,
    useBeforeUnload: vi.fn(),
  };
});

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => mockBreadcrumbContext,
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: false }),
}));

const mockListTriggers = vi.fn();
const mockPatchTrigger = vi.fn();
const mockGetAoaRuns = vi.fn();
const mockAgentsGet = vi.fn();

vi.mock("../api/agents", () => ({
  agentsApi: {
    get: (...args: any[]) => mockAgentsGet(...args),
    listTriggers: (...args: any[]) => mockListTriggers(...args),
    patchTrigger: (...args: any[]) => mockPatchTrigger(...args),
    getAoaRuns: (...args: any[]) => mockGetAoaRuns(...args),
    createTrigger: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    listKeys: vi.fn().mockResolvedValue([]),
    listConfigRevisions: vi.fn().mockResolvedValue([]),
    adapterModels: vi.fn().mockResolvedValue([]),
    runtimeState: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../lib/queryKeys", () => ({
  queryKeys: {
    agents: {
      detail: (id: string) => ["agents", id],
      list: (id: string) => ["agents", "list", id],
      runtimeState: (id: string) => ["agents", "runtimeState", id],
      configRevisions: (id: string) => ["agents", "configRevisions", id],
      keys: (id: string) => ["agents", "keys", id],
      adapterModels: (cid: string, at: string) => ["agents", "adapterModels", cid, at],
    },
    aoaRuns: (agentId: string) => ["aoa-runs", agentId],
    triggers: (agentId: string) => ["triggers", agentId],
  },
}));

vi.mock("../components/agent-detail/AgentDetailCore", () => ({
  AgentDetailCore: ({ agent, tabs, activeView, renderTab, headerActions }: any) => (
    <div data-testid="agent-detail-core">
      <h1 data-testid="agent-name">{agent?.name}</h1>
      <div data-testid="header-actions">{headerActions}</div>
      <div data-testid="tab-content">{renderTab(activeView)}</div>
      <div data-testid="tabs">
        {tabs?.map((t: any) => (
          <span key={t.value} data-testid={`tab-${t.value}`}>{t.label}</span>
        ))}
      </div>
    </div>
  ),
}));

vi.mock("../components/AgentInstructionsTab", () => ({
  AgentInstructionsTab: () => <div data-testid="instructions-tab">Instructions</div>,
}));

vi.mock("../components/AgentConfigForm", () => ({
  AgentConfigForm: () => <div data-testid="config-form">Config Form</div>,
}));

vi.mock("../components/PageSkeleton", () => ({
  PageSkeleton: () => <div data-testid="page-skeleton">Loading...</div>,
}));

vi.mock("../components/StatusBadge", () => ({
  StatusBadge: ({ status }: any) => <span data-testid="status-badge">{status}</span>,
}));

vi.mock("../components/AgentIconPicker", () => ({
  AgentIcon: ({ icon }: any) => <span data-testid="agent-icon">{icon ?? "icon"}</span>,
  AgentIconPicker: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("../components/agent-config-primitives", () => ({
  roleLabels: { engineer: "Engineer", lead: "Lead", cxo: "Director" } as Record<string, string>,
  adapterLabels: { claude_local: "Claude (local)" } as Record<string, string>,
}));

vi.mock("../lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
  relativeTime: () => "just now",
  formatDate: () => "2026-01-01",
  agentRouteRef: (agent: any) => agent?.urlKey ?? agent?.id ?? "",
  isUuidLike: (v: string) => /^[0-9a-f-]{36}$/.test(v),
}));

vi.mock("@armyofagents/shared", async () => {
  const actual = await vi.importActual<typeof import("@armyofagents/shared")>("@armyofagents/shared");
  return {
    ...actual,
    isUuidLike: (v: string) => /^[0-9a-f-]{36}$/.test(v),
  };
});

// --- Import AoaAgentDetail after mocks ---
import { AoaAgentDetail } from "../pages/AoaAgentDetail";
import { AoaTriggersTab } from "../components/agent-detail/AoaTriggersTab";

describe("AoaAgentDetail", () => {
  const aoaAgent = makeAgent({
    id: "agent-aoa-1",
    name: "Commander Bot",
    role: "lead",
    status: "active",
    adapterType: "claude_local",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.agentId = "agent-aoa-1";
    mockParams.companyPrefix = undefined;
    mockParams.tab = undefined;
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockAgentsGet.mockResolvedValue(aoaAgent);
    mockListTriggers.mockResolvedValue([]);
    mockGetAoaRuns.mockResolvedValue([]);
  });

  it("renders agent name in header", async () => {
    renderWithProviders(<AoaAgentDetail />);

    await waitFor(() => {
      expect(screen.getByTestId("agent-name")).toHaveTextContent("Commander Bot");
    });
  });

  it("renders all expected tabs", async () => {
    renderWithProviders(<AoaAgentDetail />);

    await waitFor(() => {
      expect(screen.getByTestId("tab-overview")).toBeInTheDocument();
      expect(screen.getByTestId("tab-instructions")).toBeInTheDocument();
      expect(screen.getByTestId("tab-runs")).toBeInTheDocument();
      expect(screen.getByTestId("tab-skills")).toBeInTheDocument();
      expect(screen.getByTestId("tab-configure")).toBeInTheDocument();
      expect(screen.getByTestId("tab-triggers")).toBeInTheDocument();
    });
  });
});

describe("AoaAgentDetail — UUID routing (kind='aoa' excluded from urlKey resolver)", () => {
  const AOA_UUID = "e9d5f695-6b38-49cf-afb3-7c986e5203ea";
  const AOA_SLUG = "discussion-extraction";

  // kind='aoa' member agent whose slug ("discussion-extraction") != its uuid.
  const aoaMember = makeAgent({
    id: AOA_UUID,
    name: "Discussion Extraction",
    role: "engineer",
    status: "active",
    kind: "aoa",
    urlKey: AOA_SLUG,
    runtimeConfig: { aoa: { role: "member" } },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.agentId = AOA_UUID;
    mockParams.companyPrefix = undefined;
    mockParams.tab = undefined;
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockListTriggers.mockResolvedValue([]);
    mockGetAoaRuns.mockResolvedValue([]);
    // Models the real server: by-id resolves any kind; by-slug 404s for kind='aoa'
    // (server resolveByReference is hardcoded eq(agents.kind,"org") — M1 / Decision #99).
    mockAgentsGet.mockImplementation(async (ref: string) => {
      if (ref === AOA_UUID) return aoaMember;
      throw new Error("Agent not found");
    });
  });

  it("loads a kind='aoa' agent by uuid without slug-canonicalizing the URL", async () => {
    renderWithProviders(<AoaAgentDetail />);

    // Agent loads by uuid — name renders, tabs render, no "Agent not found".
    await waitFor(() => {
      expect(screen.getByTestId("agent-name")).toHaveTextContent("Discussion Extraction");
    });
    expect(screen.getByTestId("tab-overview")).toBeInTheDocument();
    expect(screen.queryByText(/agent not found/i)).not.toBeInTheDocument();

    // The bug: a replace-navigate rewrote /team/aoa/<uuid> -> /team/aoa/discussion-extraction,
    // then the refetch-by-slug 404'd. Assert the URL is NEVER rewritten to the slug.
    expect(mockNavigate).not.toHaveBeenCalledWith(
      expect.stringContaining(AOA_SLUG),
      expect.anything(),
    );
    expect(mockNavigate).not.toHaveBeenCalledWith(`/team/aoa/${AOA_SLUG}`, { replace: true });

    // agentsApi.get must only ever be called with the uuid, never the slug.
    expect(mockAgentsGet).not.toHaveBeenCalledWith(AOA_SLUG, expect.anything());
  });
});

describe("AoaTriggersTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockListTriggers.mockResolvedValue([
      { id: "t1", kind: "outbox", enabled: true, config: { source: "discussion_entry_pending" } },
    ]);
    mockPatchTrigger.mockResolvedValue({ id: "t1", kind: "outbox", enabled: false, config: { source: "discussion_entry_pending" } });
  });

  it("Triggers tab lists triggers and toggles enabled", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <AoaTriggersTab agentId="agent-aoa-1" companyId="comp-1" />,
    );

    // Should show the trigger kind
    await waitFor(() => {
      expect(screen.getByText(/outbox/i)).toBeInTheDocument();
    });

    // Click the toggle
    const toggle = screen.getByRole("checkbox");
    await user.click(toggle);

    // patchTrigger should have been called with enabled: false
    await waitFor(() => {
      expect(mockPatchTrigger).toHaveBeenCalledWith(
        "agent-aoa-1",
        "t1",
        "comp-1",
        expect.objectContaining({ enabled: false }),
      );
    });
  });

  it("shows empty state when no triggers", async () => {
    mockListTriggers.mockResolvedValue([]);

    renderWithProviders(
      <AoaTriggersTab agentId="agent-aoa-1" companyId="comp-1" />,
    );

    await waitFor(() => {
      expect(screen.getByText(/no triggers/i)).toBeInTheDocument();
    });
  });
});
