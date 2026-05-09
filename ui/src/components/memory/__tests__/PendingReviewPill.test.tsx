import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// Hoist mocks so they are available before module imports are resolved.
const { navigateMock, listMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  listMock: vi.fn(),
}));

// Stub useNavigate so it doesn't call useCompany internally.
vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/router");
  return { ...actual, useNavigate: () => navigateMock };
});

// Mock the company context so the hook resolves.
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompany: { issuePrefix: "ACME" } }),
}));

// Mock the API so we can drive the items list.
vi.mock("../../../api/memory", () => ({
  memoryApi: { list: (...args: unknown[]) => listMock(...args) },
}));

import { PendingReviewPill } from "../PendingReviewPill";

function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PendingReviewPill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when there are zero pending items", async () => {
    listMock.mockResolvedValueOnce([
      { id: "1", status: "approved" },
      { id: "2", status: "archived" },
    ]);
    const { container } = renderWithProviders(<PendingReviewPill companyId="co-1" />);
    // Wait for the query to settle then verify no button rendered.
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders pill with count when there are pending items", async () => {
    listMock.mockResolvedValueOnce([
      { id: "1", status: "pending" },
      { id: "2", status: "pending" },
      { id: "3", status: "pending" },
      { id: "4", status: "approved" },
    ]);
    const { findByText } = renderWithProviders(<PendingReviewPill companyId="co-1" />);
    expect(await findByText("3 pending")).toBeInTheDocument();
    expect(await findByText("Review")).toBeInTheDocument();
  });

  it("navigates to /:prefix/memory/explore?folder=__pending on click", async () => {
    listMock.mockResolvedValueOnce([{ id: "1", status: "pending" }]);
    const { findByText } = renderWithProviders(<PendingReviewPill companyId="co-1" />);
    const reviewBtn = await findByText("Review");
    fireEvent.click(reviewBtn.closest("button")!);
    expect(navigateMock).toHaveBeenCalledWith("/ACME/memory/explore?folder=__pending");
  });
});
