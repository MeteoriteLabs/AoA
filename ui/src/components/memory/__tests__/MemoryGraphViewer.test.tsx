import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
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

vi.mock("sigma", () => ({
  default: vi.fn().mockImplementation(() => ({
    kill: sigmaKillMock,
    on: sigmaOnMock,
  })),
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
    expect(screen.getAllByText("2 nodes / 1 edges")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Open Launch plan" }));
    expect(onOpenMemoryItem).toHaveBeenCalledWith({
      id: "mem-1",
      title: "Launch plan",
    });
  });
});
