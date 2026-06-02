import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CompanyBrainOverviewResponse } from "@armyofagents/shared";
import { CompanyGraphCanvas } from "../CompanyGraphCanvas";

const sigmaKillMock = vi.hoisted(() => vi.fn());
const sigmaOnMock = vi.hoisted(() => vi.fn());

vi.mock("sigma", () => ({
  default: vi.fn().mockImplementation(() => ({
    kill: sigmaKillMock,
    on: sigmaOnMock,
  })),
}));

function graph(overrides: Partial<CompanyBrainOverviewResponse> = {}): CompanyBrainOverviewResponse {
  return {
    nodes: [
      {
        type: "memory_item",
        id: "mem-1",
        companyId: "co-1",
        label: "Pricing policy",
        status: "approved",
      },
      {
        type: "memory_item",
        id: "mem-2",
        companyId: "co-1",
        label: "Seat billing",
        status: "approved",
      },
      {
        type: "department",
        id: "dept-1",
        companyId: "co-1",
        label: "Product",
        status: "active",
      },
    ],
    edges: [
      {
        id: "edge-supports",
        companyId: "co-1",
        from: { type: "memory_item", id: "mem-1" },
        to: { type: "memory_item", id: "mem-2" },
        kind: "supports",
        sourceClass: "semantic",
        editability: "editable",
      },
      {
        id: "edge-dept",
        companyId: "co-1",
        from: { type: "memory_item", id: "mem-1" },
        to: { type: "department", id: "dept-1" },
        kind: "belongs_to",
        sourceClass: "derived",
        editability: "source_row_only",
      },
    ],
    limit: 100,
    truncated: false,
    ...overrides,
  };
}

describe("CompanyGraphCanvas", () => {
  it("renders an empty graph state", () => {
    render(<CompanyGraphCanvas graph={{ nodes: [], edges: [], limit: 100, truncated: false }} />);

    expect(screen.getByText("No visible graph relationships yet")).toBeInTheDocument();
  });

  it("renders graph counts and node labels", () => {
    render(<CompanyGraphCanvas graph={graph()} />);

    expect(screen.getAllByText("3 nodes / 2 edges")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Select Pricing policy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Seat billing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Product" })).toBeInTheDocument();
  });

  it("opens memory item nodes from the details panel", () => {
    const onOpenMemoryItem = vi.fn();
    render(<CompanyGraphCanvas graph={graph()} onOpenMemoryItem={onOpenMemoryItem} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Pricing policy" }));

    expect(onOpenMemoryItem).toHaveBeenCalledWith({ id: "mem-1", title: "Pricing policy" });
  });

  it("shows connected relations for the selected node", () => {
    render(<CompanyGraphCanvas graph={graph()} />);

    fireEvent.click(screen.getByRole("button", { name: "Select Pricing policy" }));

    expect(screen.getByTestId("company-graph-selected-node")).toHaveTextContent("Pricing policy");
    expect(screen.getByText("supports Seat billing")).toBeInTheDocument();
    expect(screen.getByText("belongs_to Product")).toBeInTheDocument();
  });
});
