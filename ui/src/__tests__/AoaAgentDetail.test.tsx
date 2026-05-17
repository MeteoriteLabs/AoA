import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, makeAgent, mockCompanyContext, mockBreadcrumbContext } from "./test-utils";

// --- Mocks ---

const mockNavigate = vi.fn();

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({
      agentId: "agent-aoa-1",
      companyPrefix: undefined,
      tab: undefined,
    }),
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
