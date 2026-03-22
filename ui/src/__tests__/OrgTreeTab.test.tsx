import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import { OrgTreeTab } from "../components/team/OrgTreeTab";
import type { UnifiedOrgNode } from "@paperclipai/shared";

// --- Mocks ---

vi.mock("../components/AgentIconPicker", () => ({
  AgentIcon: ({ icon, className }: any) => (
    <span data-testid="agent-icon" className={className}>
      {icon ?? "icon"}
    </span>
  ),
}));

vi.mock("../components/agent-config-primitives", () => ({
  adapterLabels: { claude_api: "Claude (API)", openai_api: "OpenAI (API)" } as Record<string, string>,
  roleLabels: { engineer: "Engineer", designer: "Designer" } as Record<string, string>,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

// --- Fixtures ---

function makeAgentNode(overrides: Partial<UnifiedOrgNode> = {}): UnifiedOrgNode {
  return {
    id: "agent-1",
    name: "Claude Bot",
    nodeType: "agent",
    role: "engineer",
    status: "active",
    adapterType: "claude_api",
    icon: null,
    pendingApproval: false,
    children: [],
    ...overrides,
  };
}

function makeHumanNode(overrides: Partial<UnifiedOrgNode> = {}): UnifiedOrgNode {
  return {
    id: "human-1",
    name: "Jane Doe",
    nodeType: "human",
    avatarUrl: null,
    userRole: "founder",
    departmentName: "Engineering",
    children: [],
    ...overrides,
  };
}

// --- Tests ---

describe("OrgTreeTab", () => {
  it("renders empty state when no nodes", () => {
    const onClick = vi.fn();
    renderWithProviders(<OrgTreeTab orgTree={[]} onNodeClick={onClick} />);

    expect(screen.getByTestId("org-tree-empty")).toBeInTheDocument();
    expect(
      screen.getByText("Add agents and invite teammates to build your org chart"),
    ).toBeInTheDocument();
  });

  it("renders agent node with blue border", () => {
    const onClick = vi.fn();
    const tree = [makeAgentNode()];
    const { container } = renderWithProviders(
      <OrgTreeTab orgTree={tree} onNodeClick={onClick} />,
    );

    const card = screen.getByTestId("org-node-agent-1");
    expect(card).toBeInTheDocument();
    expect(card.getAttribute("data-node-type")).toBe("agent");
    expect(card.className).toContain("border-l-blue-400");
  });

  it("renders human node with green border", () => {
    const onClick = vi.fn();
    const tree = [makeHumanNode()];
    const { container } = renderWithProviders(
      <OrgTreeTab orgTree={tree} onNodeClick={onClick} />,
    );

    const card = screen.getByTestId("org-node-human-1");
    expect(card).toBeInTheDocument();
    expect(card.getAttribute("data-node-type")).toBe("human");
    expect(card.className).toContain("border-l-green-400");
  });

  it("renders mixed agent and human nodes", () => {
    const onClick = vi.fn();
    const tree = [
      makeHumanNode({
        id: "founder-1",
        name: "Alice",
        children: [
          makeAgentNode({ id: "bot-1", name: "Bot Alpha" }),
          makeHumanNode({ id: "lead-1", name: "Bob", userRole: "team_lead" }),
        ],
      }),
    ];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    expect(screen.getByTestId("org-node-founder-1")).toBeInTheDocument();
    expect(screen.getByTestId("org-node-bot-1")).toBeInTheDocument();
    expect(screen.getByTestId("org-node-lead-1")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bot Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("calls onNodeClick with correct id and nodeType for agent", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const tree = [makeAgentNode({ id: "a1", name: "Test Bot" })];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    await user.click(screen.getByText("Test Bot"));
    expect(onClick).toHaveBeenCalledWith("a1", "agent");
  });

  it("calls onNodeClick with correct id and nodeType for human", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const tree = [makeHumanNode({ id: "h1", name: "Jane Smith" })];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    await user.click(screen.getByText("Jane Smith"));
    expect(onClick).toHaveBeenCalledWith("h1", "human");
  });

  it("dims pending_approval agents with opacity-50", () => {
    const onClick = vi.fn();
    const tree = [makeAgentNode({ id: "pending-1", pendingApproval: true })];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    const card = screen.getByTestId("org-node-pending-1");
    expect(card.className).toContain("opacity-50");
  });

  it("shows Pending badge for pending_approval agents", () => {
    const onClick = vi.fn();
    const tree = [makeAgentNode({ pendingApproval: true })];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("does not apply opacity-50 to approved agents", () => {
    const onClick = vi.fn();
    const tree = [makeAgentNode({ id: "approved-1", pendingApproval: false })];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    const card = screen.getByTestId("org-node-approved-1");
    expect(card.className).not.toContain("opacity-50");
  });

  it("renders human initials when no avatar", () => {
    const onClick = vi.fn();
    const tree = [makeHumanNode({ name: "Jane Doe", avatarUrl: null })];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("renders human avatar when provided", () => {
    const onClick = vi.fn();
    const tree = [makeHumanNode({ avatarUrl: "https://example.com/avatar.png" })];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    const img = screen.getByAltText("Jane Doe");
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe("https://example.com/avatar.png");
  });

  it("renders adapter type label for agents", () => {
    const onClick = vi.fn();
    const tree = [makeAgentNode({ adapterType: "claude_api" })];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    expect(screen.getByText("Claude (API)")).toBeInTheDocument();
  });

  it("renders role badge for humans", () => {
    const onClick = vi.fn();
    const tree = [makeHumanNode({ userRole: "team_lead" })];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    expect(screen.getByText("Team Lead")).toBeInTheDocument();
  });

  it("renders department name for humans", () => {
    const onClick = vi.fn();
    const tree = [makeHumanNode({ departmentName: "Design" })];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    expect(screen.getByText("Design")).toBeInTheDocument();
  });

  it("handles forest layout with multiple roots", () => {
    const onClick = vi.fn();
    const tree = [
      makeAgentNode({ id: "root-1", name: "Bot A" }),
      makeHumanNode({ id: "root-2", name: "Human B" }),
    ];

    renderWithProviders(<OrgTreeTab orgTree={tree} onNodeClick={onClick} />);

    expect(screen.getByTestId("org-node-root-1")).toBeInTheDocument();
    expect(screen.getByTestId("org-node-root-2")).toBeInTheDocument();
  });
});
