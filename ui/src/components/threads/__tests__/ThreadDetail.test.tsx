import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { ThreadDetail } from "../../../pages/ThreadDetail";

// Mock API modules
vi.mock("../../../api/threads", () => ({
  threadsApi: {
    detail: vi.fn(),
    advancePhase: vi.fn(),
  },
}));

vi.mock("../../../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "comp-1",
    selectedCompany: { id: "comp-1", name: "Test Corp", issuePrefix: "TC" },
  }),
}));

vi.mock("../../../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: vi.fn(),
    setSubtitle: vi.fn(),
    setEntityColor: vi.fn(),
  }),
}));

vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ threadId: "thread-1", companyPrefix: "TC" }),
  };
});

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/router")>("../../../lib/router");
  return {
    ...actual,
    useParams: () => ({ threadId: "thread-1", companyPrefix: "TC" }),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

import { threadsApi } from "../../../api/threads";
import type { ThreadDetail as ThreadDetailType } from "../../../api/threads";
import React from "react";

const mockThread: ThreadDetailType = {
  id: "thread-1",
  title: "Refactor auth module",
  status: "active",
  scopeType: null,
  scopeId: null,
  scopeName: null,
  tags: [],
  entryCount: 2,
  pendingItemCount: 1,
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  entries: [],
  phase: "discuss",
  visibility: "open",
  ownerUserId: null,
  originSource: null,
  intent: ["improve security"],
  goalId: null,
  autonomyLevel: 1,
  summaryText: null,
  summaryNext: null,
};

describe("ThreadDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading skeleton while fetching", () => {
    vi.mocked(threadsApi.detail).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ThreadDetail />, {
      initialEntries: ["/TC/threads/thread-1"],
    });
    expect(screen.getByTestId("thread-detail-skeleton")).toBeInTheDocument();
  });

  it("renders title when thread loads successfully", async () => {
    vi.mocked(threadsApi.detail).mockResolvedValue(mockThread);
    renderWithProviders(<ThreadDetail />, {
      initialEntries: ["/TC/threads/thread-1"],
    });
    await waitFor(() => {
      // The title appears at least once (may appear in multiple places: left rail, heading)
      const titleElements = screen.getAllByText("Refactor auth module");
      expect(titleElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders Thread and Scope tabs", async () => {
    vi.mocked(threadsApi.detail).mockResolvedValue(mockThread);
    renderWithProviders(<ThreadDetail />, {
      initialEntries: ["/TC/threads/thread-1"],
    });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /thread/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /scope/i })).toBeInTheDocument();
    });
  });

  it("shows error state when fetch fails", async () => {
    vi.mocked(threadsApi.detail).mockRejectedValue(new Error("Network error"));
    renderWithProviders(<ThreadDetail />, {
      initialEntries: ["/TC/threads/thread-1"],
    });
    await waitFor(() => {
      expect(screen.getByTestId("thread-error-state")).toBeInTheDocument();
    });
  });

  it("renders tab list with correct ARIA roles", async () => {
    vi.mocked(threadsApi.detail).mockResolvedValue(mockThread);
    renderWithProviders(<ThreadDetail />, {
      initialEntries: ["/TC/threads/thread-1"],
    });
    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });
  });

  it("switches to Scope tab when clicked", async () => {
    vi.mocked(threadsApi.detail).mockResolvedValue(mockThread);
    const user = userEvent.setup();
    renderWithProviders(<ThreadDetail />, {
      initialEntries: ["/TC/threads/thread-1"],
    });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /scope/i })).toBeInTheDocument();
    });
    const scopeTab = screen.getByRole("tab", { name: /scope/i });
    await user.click(scopeTab);
    expect(scopeTab).toHaveAttribute("aria-selected", "true");
  });
});
