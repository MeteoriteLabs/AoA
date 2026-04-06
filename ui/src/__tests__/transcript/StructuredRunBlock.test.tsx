// ui/src/__tests__/transcript/StructuredRunBlock.test.tsx

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { StructuredRunBlock } from "../../components/workspace/transcript";

// Mock heartbeatsApi
vi.mock("../../api/heartbeats", () => ({
  heartbeatsApi: new Proxy({}, {
    get: () => vi.fn(),
  }),
}));

// Import mocked module
import { heartbeatsApi } from "../../api/heartbeats";

function renderComponent(props: Partial<React.ComponentProps<typeof StructuredRunBlock>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StructuredRunBlock
          runId="test-run-1"
          adapterType="claude_local"
          departmentType="software_development"
          isRunning={false}
          agentName="Claude Code"
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StructuredRunBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    (heartbeatsApi.log as any).mockReturnValue(new Promise(() => {})); // never resolves
    renderComponent();
    expect(screen.getByText("Loading run output...")).toBeTruthy();
  });

  it("shows empty state for run with no output", async () => {
    (heartbeatsApi.log as any).mockResolvedValue({ runId: "test-run-1", store: "", logRef: "", content: "" });
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText("No output recorded.")).toBeTruthy();
    });
  });

  it("shows waiting state for running run with no output", async () => {
    (heartbeatsApi.log as any).mockResolvedValue({ runId: "test-run-1", store: "", logRef: "", content: "" });
    renderComponent({ isRunning: true });
    await waitFor(() => {
      expect(screen.getByText("Waiting for output...")).toBeTruthy();
    });
  });
});
