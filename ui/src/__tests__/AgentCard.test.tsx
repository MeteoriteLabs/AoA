import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, makeAgent, mockCompanyContext } from "./test-utils";
import { AgentCard } from "../components/AgentCard";

// --- Mocks ---

const mockNavigate = vi.fn();

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: actual.Link,
    NavLink: actual.NavLink,
  };
});

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../lib/queryKeys", () => ({
  queryKeys: {
    agents: {
      detail: (id: string) => ["agents", id],
      list: (id: string) => ["agents", "list", id],
    },
  },
}));

vi.mock("../api/agents", () => ({
  agentsApi: { pause: vi.fn(), resume: vi.fn() },
}));

vi.mock("../lib/utils", () => ({
  relativeTime: () => "2 minutes ago",
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
  agentUrl: (agent: any) => `/agents/${agent.id}`,
  agentRouteRef: (agent: any) => agent.id,
}));

vi.mock("./AgentIconPicker", () => ({
  AgentIcon: ({ icon, className }: any) => <span data-testid="agent-icon" className={className}>{icon ?? "icon"}</span>,
}));

vi.mock("./StatusBadge", () => ({
  StatusBadge: ({ status }: any) => <span data-testid="status-badge">{status}</span>,
}));

vi.mock("./agent-config-primitives", () => ({
  adapterLabels: { claude_api: "Claude API", openai_api: "OpenAI API" } as Record<string, string>,
  roleLabels: { engineer: "Engineer", designer: "Designer" } as Record<string, string>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children, asChild }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => <div onClick={onClick}>{children}</div>,
  DropdownMenuTrigger: ({ children, asChild }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock("../lib/status-colors", () => ({
  agentStatusDot: {
    active: "bg-green-400",
    paused: "bg-yellow-400",
    idle: "bg-yellow-400",
    error: "bg-red-400",
    archived: "bg-neutral-400",
  },
  agentStatusDotDefault: "bg-neutral-400",
  statusBadge: {
    active: "bg-green-100",
    paused: "bg-orange-100",
    idle: "bg-yellow-100",
    error: "bg-red-100",
  },
  statusBadgeDefault: "bg-muted",
}));

// --- Tests ---

describe("AgentCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
  });

  it("renders agent name, role, and status", () => {
    const agent = makeAgent({ name: "Claude Agent", role: "engineer", status: "active" });

    renderWithProviders(<AgentCard agent={agent as any} />);

    expect(screen.getByText("Claude Agent")).toBeInTheDocument();
    expect(screen.getByText(/Engineer/)).toBeInTheDocument();
    // StatusBadge renders the status text directly
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("shows correct status dot color for active agent", () => {
    const agent = makeAgent({ status: "active" });

    const { container } = renderWithProviders(<AgentCard agent={agent as any} />);

    // The status dot should have the green color class
    const dot = container.querySelector(".bg-green-400");
    expect(dot).toBeInTheDocument();
  });

  it("shows correct status dot color for paused agent", () => {
    const agent = makeAgent({ status: "paused" });

    const { container } = renderWithProviders(<AgentCard agent={agent as any} />);

    const dot = container.querySelector(".bg-yellow-400");
    expect(dot).toBeInTheDocument();
  });

  it("shows correct status dot color for error agent", () => {
    const agent = makeAgent({ status: "error" });

    const { container } = renderWithProviders(<AgentCard agent={agent as any} />);

    const dot = container.querySelector(".bg-red-400");
    expect(dot).toBeInTheDocument();
  });

  it("click card calls navigation", async () => {
    const user = userEvent.setup();
    const agent = makeAgent({ id: "agent-1" });

    renderWithProviders(<AgentCard agent={agent as any} />);

    // Click the card container (outermost div)
    await user.click(screen.getByText("Claude Agent"));
    expect(mockNavigate).toHaveBeenCalledWith("/agents/agent-1");
  });
});
