import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, makeAgent, mockCompanyContext } from "./test-utils";
import { CommanderTeamTab } from "../components/team/CommanderTeamTab";

// --- Mocks ---

const mockNavigate = vi.fn();

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("@/lib/router")>("@/lib/router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../api/agents", () => ({
  agentsApi: {
    listAoa: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../lib/utils", () => ({
  formatCents: (v: number) => `$${(v / 100).toFixed(2)}`,
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
  agentUrl: (agent: any) => `/agents/${agent.id}`,
  agentRouteRef: (agent: any) => agent.id,
  relativeTime: (date: any) => (date ? "just now" : ""),
}));

vi.mock("../components/AgentIconPicker", () => ({
  AgentIcon: ({ icon, className }: any) => <span data-testid="agent-icon" className={className}>{icon ?? "icon"}</span>,
}));

vi.mock("../components/StatusBadge", () => ({
  StatusBadge: ({ status }: any) => <span data-testid="status-badge">{status}</span>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children, asChild }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({ title, description, action }: any) => (
    <div>
      <p>{title}</p>
      {description && <p>{description}</p>}
      {action}
    </div>
  ),
}));

// --- Tests ---

describe("CommanderTeamTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
  });

  const defaultPermissions = { isFounder: true };

  function makeAoaAgents() {
    return [
      makeAgent({
        id: "a1",
        name: "Commander",
        kind: "aoa",
        runtimeConfig: { aoa: { role: "lead" } },
        status: "idle",
        adapterType: "process",
      }),
      makeAgent({
        id: "a2",
        name: "Discussion Extraction",
        kind: "aoa",
        runtimeConfig: { aoa: { role: "member" } },
        status: "idle",
        adapterType: "process",
      }),
    ];
  }

  it("renders both agent names", () => {
    const agents = makeAoaAgents();

    renderWithProviders(
      <CommanderTeamTab agents={agents as any} permissions={defaultPermissions} />,
    );

    expect(screen.getByText("Commander")).toBeInTheDocument();
    expect(screen.getByText("Discussion Extraction")).toBeInTheDocument();
  });

  it("shows Lead badge for commander agent with lead role", () => {
    const agents = makeAoaAgents();

    renderWithProviders(
      <CommanderTeamTab agents={agents as any} permissions={defaultPermissions} />,
    );

    expect(screen.getByText("Lead")).toBeInTheDocument();
  });

  it("does not show Lead badge for member agent", () => {
    const agents = [
      makeAgent({
        id: "a2",
        name: "Discussion Extraction",
        kind: "aoa",
        runtimeConfig: { aoa: { role: "member" } },
        status: "idle",
        adapterType: "process",
      }),
    ];

    renderWithProviders(
      <CommanderTeamTab agents={agents as any} permissions={defaultPermissions} />,
    );

    expect(screen.queryByText("Lead")).not.toBeInTheDocument();
  });

  it("clicking an agent card navigates to aoa detail route", async () => {
    const user = userEvent.setup();
    const agents = makeAoaAgents();

    renderWithProviders(
      <CommanderTeamTab agents={agents as any} permissions={defaultPermissions} />,
    );

    const card = screen.getByTestId("commander-agent-card-a1");
    await user.click(card);

    expect(mockNavigate).toHaveBeenCalledWith("/team/aoa/a1");
  });

  it("shows empty state when no agents", () => {
    renderWithProviders(
      <CommanderTeamTab agents={[]} permissions={defaultPermissions} />,
    );

    expect(screen.getByText("No AoA agents yet")).toBeInTheDocument();
  });

  it("shows New AoA agent button for founder", () => {
    const agents = makeAoaAgents();

    renderWithProviders(
      <CommanderTeamTab agents={agents as any} permissions={defaultPermissions} />,
    );

    expect(screen.getByText("New AoA Agent")).toBeInTheDocument();
  });

  it("hides New AoA agent button for non-founders", () => {
    const agents = makeAoaAgents();

    renderWithProviders(
      <CommanderTeamTab agents={agents as any} permissions={{ isFounder: false }} />,
    );

    expect(screen.queryByText("New AoA Agent")).not.toBeInTheDocument();
  });
});
