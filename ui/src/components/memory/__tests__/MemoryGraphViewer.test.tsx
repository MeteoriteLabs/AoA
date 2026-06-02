import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import Sigma from "sigma";
import { MemoryGraphViewer } from "../MemoryGraphViewer";

const memoryApiMock = vi.hoisted(() => ({
  companyGraph: vi.fn(async () => ({
    nodes: [
      {
        type: "memory_item",
        id: "mem-1",
        companyId: "co-1",
        label: "Launch plan",
        status: "approved",
      },
      {
        type: "department",
        id: "dept-1",
        companyId: "co-1",
        label: "Marketing",
        status: "active",
      },
    ],
    edges: [
      {
        id: "edge-1",
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
  })),
  neighbors: vi.fn(async () => ({
    center: { id: "mem-1", label: "Launch plan" },
    nodes: [],
    edges: [],
  })),
  usage: vi.fn(async () => ({ agents: [] })),
}));

const sigmaKillMock = vi.hoisted(() => vi.fn());
const sigmaOnMock = vi.hoisted(() => vi.fn());
const sigmaConstructorMock = vi.hoisted(() => vi.fn().mockImplementation(() => ({
  kill: sigmaKillMock,
  on: sigmaOnMock,
})));

vi.mock("sigma", () => ({
  default: sigmaConstructorMock,
}));

vi.mock("../../../api/memory", () => ({
  memoryApi: memoryApiMock,
}));

function renderViewer(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}

describe("MemoryGraphViewer", () => {
  it("loads and renders the company graph tab", async () => {
    const onOpenMemoryItem = vi.fn();

    renderViewer(
      <MemoryGraphViewer
        companyId="co-1"
        itemId={null}
        onOpenMemoryItem={onOpenMemoryItem}
      />,
    );

    await waitFor(() =>
      expect(memoryApiMock.companyGraph).toHaveBeenCalledWith("co-1", {
        includeStructural: true,
        limit: 100,
      }),
    );

    expect(await screen.findByTestId("company-graph-sigma-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("company-graph-map-view")).toHaveClass("text-text");
    expect(screen.getByTestId("company-graph-mode-shell")).toHaveClass("overflow-hidden");
    expect(screen.getAllByText("2 nodes / 1 edges")).toHaveLength(2);
    await waitFor(() =>
      expect(vi.mocked(Sigma)).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(HTMLElement),
        expect.objectContaining({
          labelColor: { color: expect.any(String) },
          edgeLabelColor: { color: expect.any(String) },
          renderLabels: true,
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Launch plan" }));
    expect(onOpenMemoryItem).toHaveBeenCalledWith({
      id: "mem-1",
      title: "Launch plan",
    });
  });

  it("switches between map, network, and cluster graph views", async () => {
    renderViewer(
      <MemoryGraphViewer
        companyId="co-1"
        itemId={null}
      />,
    );

    expect(await screen.findByTestId("company-graph-sigma-canvas")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Network view" }));
    expect(screen.getByTestId("company-graph-network-view")).toBeInTheDocument();
    expect(screen.getByTestId("company-graph-network-view")).toHaveClass("h-full");
    expect(screen.getByTestId("company-graph-network-view")).toHaveClass("text-text");

    fireEvent.click(screen.getByRole("button", { name: "Cluster view" }));
    expect(screen.getByTestId("company-graph-cluster-view")).toBeInTheDocument();
    expect(screen.getByTestId("company-graph-cluster-view")).toHaveClass("h-full");
    expect(screen.getByTestId("company-graph-cluster-view")).toHaveClass("text-text");

    fireEvent.click(screen.getByRole("button", { name: "Map view" }));
    expect(screen.getByTestId("company-graph-sigma-canvas")).toBeInTheDocument();
  });
});
