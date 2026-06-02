import { describe, expect, it } from "vitest";
import {
  buildMemoryItemNeighborGraph,
  canSeeMemoryItemForGraph,
  type GraphActorScope,
  type MemoryItemGraphRow,
} from "../company-brain-graph.js";

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const MARKETING_ID = "00000000-0000-0000-0000-000000000101";
const PRODUCT_ID = "00000000-0000-0000-0000-000000000102";
const GOAL_ID = "00000000-0000-0000-0000-000000000201";
const TASK_ID = "00000000-0000-0000-0000-000000000301";
const ARTIFACT_ID = "00000000-0000-0000-0000-000000000401";
const AGENT_ID = "00000000-0000-0000-0000-000000000501";

function memory(overrides: Partial<MemoryItemGraphRow> = {}): MemoryItemGraphRow {
  return {
    id: "00000000-0000-0000-0000-000000000901",
    companyId: COMPANY_ID,
    title: "Pricing decision",
    content: "We price by seat.",
    status: "approved",
    category: "decision",
    layer: "domain",
    visibility: "scoped",
    departmentId: MARKETING_ID,
    projectId: PRODUCT_ID,
    goalId: GOAL_ID,
    taskId: TASK_ID,
    sourceArtifactId: ARTIFACT_ID,
    agentId: AGENT_ID,
    folderPath: "Pricing",
    createdBy: "founder@example.com",
    createdAt: new Date("2026-06-02T00:00:00.000Z"),
    updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    ...overrides,
  };
}

const founder: GraphActorScope = {
  actorType: "user",
  principalId: "founder@example.com",
  role: "founder",
  departmentIds: [],
  activeCompanyMember: true,
};

describe("canSeeMemoryItemForGraph", () => {
  it("allows company-wide identity memory to active company members", () => {
    const item = memory({
      layer: "identity",
      visibility: "shared",
      departmentId: null,
      projectId: null,
      goalId: null,
      taskId: null,
      sourceArtifactId: null,
      agentId: null,
    });

    expect(canSeeMemoryItemForGraph(item, {
      actorType: "user",
      principalId: "member@example.com",
      role: "team_member",
      departmentIds: [],
      activeCompanyMember: true,
    })).toBe(true);
  });

  it("hides agent-personal memory from unrelated team members", () => {
    const item = memory({ agentId: AGENT_ID });

    expect(canSeeMemoryItemForGraph(item, {
      actorType: "user",
      principalId: "member@example.com",
      role: "team_member",
      departmentIds: [MARKETING_ID],
      activeCompanyMember: true,
    })).toBe(false);
  });

  it("allows the owning agent to see its own personal memory", () => {
    const item = memory({ agentId: AGENT_ID });

    expect(canSeeMemoryItemForGraph(item, {
      actorType: "agent",
      principalId: AGENT_ID,
      role: "team_member",
      departmentIds: [MARKETING_ID],
      activeCompanyMember: true,
    })).toBe(true);
  });
});

describe("buildMemoryItemNeighborGraph", () => {
  it("derives first-hop structural edges from the memory item row", () => {
    const graph = buildMemoryItemNeighborGraph({
      companyId: COMPANY_ID,
      center: memory(),
      actor: founder,
      relatedItems: [],
      semanticRelations: [],
      linked: {
        departments: [{ id: MARKETING_ID, name: "Marketing", type: "department", status: "active" }],
        projects: [{ id: PRODUCT_ID, name: "Pricing App", type: "project", status: "active" }],
        goals: [{ id: GOAL_ID, title: "Launch pricing", status: "active" }],
        tasks: [{ id: TASK_ID, title: "Draft pricing memo", status: "in_progress" }],
        artifacts: [{ id: ARTIFACT_ID, title: "Pricing Memo", status: "active" }],
        agents: [{ id: AGENT_ID, name: "Market Analyst", status: "idle" }],
      },
    });

    expect(graph.center.id).toBe("00000000-0000-0000-0000-000000000901");
    expect(graph.nodes.map((node) => `${node.type}:${node.id}`)).toEqual([
      "memory_item:00000000-0000-0000-0000-000000000901",
      `department:${MARKETING_ID}`,
      `project:${PRODUCT_ID}`,
      `goal:${GOAL_ID}`,
      `task:${TASK_ID}`,
      `artifact:${ARTIFACT_ID}`,
      `agent:${AGENT_ID}`,
    ]);
    expect(graph.edges.map((edge) => edge.kind)).toEqual([
      "belongs_to",
      "belongs_to",
      "applies_to",
      "applies_to",
      "derived_from",
      "created_by",
    ]);
    expect(graph.edges.every((edge) => edge.sourceClass === "derived")).toBe(true);
  });

  it("filters semantic edges unless both endpoints are visible", () => {
    const center = memory({ agentId: null });
    const visible = memory({
      id: "00000000-0000-0000-0000-000000000902",
      title: "Visible decision",
      agentId: null,
    });
    const privateTarget = memory({
      id: "00000000-0000-0000-0000-000000000903",
      title: "Agent private note",
      agentId: AGENT_ID,
    });

    const graph = buildMemoryItemNeighborGraph({
      companyId: COMPANY_ID,
      center,
      actor: {
        actorType: "user",
        principalId: "member@example.com",
        role: "team_member",
        departmentIds: [MARKETING_ID],
        activeCompanyMember: true,
      },
      relatedItems: [visible, privateTarget],
      semanticRelations: [
        {
          id: "rel-visible",
          fromItemId: center.id,
          toItemId: visible.id,
          kind: "related_to",
          createdBy: "system",
          createdAt: new Date("2026-06-02T00:00:00.000Z"),
        },
        {
          id: "rel-private",
          fromItemId: center.id,
          toItemId: privateTarget.id,
          kind: "related_to",
          createdBy: "system",
          createdAt: new Date("2026-06-02T00:00:00.000Z"),
        },
      ],
      linked: {},
    });

    expect(graph.nodes.map((node) => node.id)).toContain(visible.id);
    expect(graph.nodes.map((node) => node.id)).not.toContain(privateTarget.id);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["rel-visible"]);
  });
});
