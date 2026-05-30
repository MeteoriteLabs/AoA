import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../__tests__/test-utils";
import { ThreadsList } from "../ThreadsList";

// Mock API modules
vi.mock("../../api/threads", () => ({
  threadsApi: {
    list: vi.fn(),
  },
}));

vi.mock("../../api/client", () => ({
  api: {
    get: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  },
}));

vi.mock("../../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "comp-1",
    selectedCompany: { id: "comp-1", name: "Test Corp", issuePrefix: "TC" },
  }),
}));

// useTeamAccess mock — role is configurable per test via teamAccessRole.
let teamAccessRole: string = "founder";

vi.mock("../../hooks/useTeamAccess", () => ({
  useTeamAccess: () => ({
    role: teamAccessRole,
    currentUser: null,
    permissions: { canAssignTasks: true, canInviteUsers: true, canManageRoles: true, canEditIdentityMemory: true },
    summary: null,
    isLoading: false,
  }),
}));

vi.mock("../../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: vi.fn(),
    setSubtitle: vi.fn(),
    setEntityColor: vi.fn(),
  }),
}));

vi.mock("../../context/DialogContext", () => ({
  useDialog: () => ({
    openNewThread: vi.fn(),
    openDiscussionCapture: vi.fn(),
  }),
}));

// Mock RoutingDialControl so ThreadsList tests don't need to wire up
// internal-agent API. canEdit prop is forwarded to a data attribute so tests
// can assert Fix 5 wiring without a full API integration.
vi.mock("../../components/threads/RoutingDialControl", () => ({
  RoutingDialControl: ({ canEdit }: { companyId: string; canEdit?: boolean }) => (
    <div data-testid="routing-dial-stub" data-can-edit={String(canEdit ?? true)} />
  ),
}));

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("../../lib/router")>("../../lib/router");
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

import { threadsApi } from "../../api/threads";
import type { ThreadListItem } from "../../api/threads";
import React from "react";

const makeThread = (overrides: Partial<ThreadListItem> = {}): ThreadListItem => ({
  id: "thread-1",
  title: "First thread",
  status: "active",
  scopeType: null,
  scopeId: null,
  scopeName: null,
  tags: [],
  entryCount: 2,
  pendingItemCount: 0,
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  lastEntryAt: "2026-01-01T12:00:00Z",
  lastEntryInputType: null,
  phase: "discuss",
  visibility: "company",
  ownerUserId: null,
  originSource: null,
  intent: null,
  goalId: null,
  autonomyLevel: null,
  summaryText: null,
  summaryNext: null,
  ...overrides,
});

describe("ThreadsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders two thread titles when list returns 2 threads", async () => {
    vi.mocked(threadsApi.list).mockResolvedValue({
      discussions: [
        makeThread({ id: "thread-1", title: "Auth refactor thread" }),
        makeThread({ id: "thread-2", title: "Product roadmap discussion" }),
      ],
      total: 2,
      limit: 50,
      offset: 0,
    });

    renderWithProviders(<ThreadsList />, { initialEntries: ["/TC/discussions"] });

    await waitFor(() => {
      expect(screen.getByText("Auth refactor thread")).toBeInTheDocument();
      expect(screen.getByText("Product roadmap discussion")).toBeInTheDocument();
    });
  });

  it("renders phase filter buttons (all/discuss/scope/assign/done)", async () => {
    vi.mocked(threadsApi.list).mockResolvedValue({
      discussions: [],
      total: 0,
      limit: 50,
      offset: 0,
    });

    renderWithProviders(<ThreadsList />, { initialEntries: ["/TC/discussions"] });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /all/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /discuss/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /scope/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /assign/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
    });
  });

  it("renders empty state when list returns no threads", async () => {
    vi.mocked(threadsApi.list).mockResolvedValue({
      discussions: [],
      total: 0,
      limit: 50,
      offset: 0,
    });

    renderWithProviders(<ThreadsList />, { initialEntries: ["/TC/discussions"] });

    await waitFor(() => {
      expect(screen.getByText(/no threads yet/i)).toBeInTheDocument();
    });
  });

  it("renders loading skeleton while fetching", () => {
    vi.mocked(threadsApi.list).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<ThreadsList />, { initialEntries: ["/TC/discussions"] });

    expect(screen.getByTestId("threads-list-skeleton")).toBeInTheDocument();
  });

  it("renders error state when fetch fails with retry button", async () => {
    vi.mocked(threadsApi.list).mockRejectedValue(new Error("Network error"));

    renderWithProviders(<ThreadsList />, { initialEntries: ["/TC/discussions"] });

    await waitFor(() => {
      expect(screen.getByText(/couldn't load threads/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
  });

  it("filters threads by phase when a phase filter button is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(threadsApi.list).mockResolvedValue({
      discussions: [
        makeThread({ id: "t1", title: "Discuss thread", phase: "discuss" }),
        makeThread({ id: "t2", title: "Scope thread", phase: "scope" }),
      ],
      total: 2,
      limit: 50,
      offset: 0,
    });

    renderWithProviders(<ThreadsList />, { initialEntries: ["/TC/discussions"] });

    await waitFor(() => {
      expect(screen.getByText("Discuss thread")).toBeInTheDocument();
      expect(screen.getByText("Scope thread")).toBeInTheDocument();
    });

    // Filter to "scope" phase only
    const scopeBtn = screen.getByRole("button", { name: /^scope/i });
    await user.click(scopeBtn);

    expect(screen.queryByText("Discuss thread")).not.toBeInTheDocument();
    expect(screen.getByText("Scope thread")).toBeInTheDocument();
  });

  // Fix 5 — RoutingDialControl canEdit gated to founder role
  describe("RoutingDialControl role gating (Fix 5)", () => {
    it("passes canEdit=true to RoutingDialControl when user is founder", async () => {
      vi.mocked(threadsApi.list).mockResolvedValue({
        discussions: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

      renderWithProviders(<ThreadsList />, { initialEntries: ["/TC/discussions"] });

      await waitFor(() => {
        const stub = screen.getByTestId("routing-dial-stub");
        // useTeamAccess mock returns role='founder', so canEdit must be true
        expect(stub.getAttribute("data-can-edit")).toBe("true");
      });
    });

    it("passes canEdit=false to RoutingDialControl when user is not founder", async () => {
      // Set the shared mutable role to team_lead for this test
      teamAccessRole = "team_lead";

      vi.mocked(threadsApi.list).mockResolvedValue({
        discussions: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

      renderWithProviders(<ThreadsList />, { initialEntries: ["/TC/discussions"] });

      await waitFor(() => {
        const stub = screen.getByTestId("routing-dial-stub");
        expect(stub.getAttribute("data-can-edit")).toBe("false");
      });

      // Restore for subsequent tests
      teamAccessRole = "founder";
    });
  });
});
