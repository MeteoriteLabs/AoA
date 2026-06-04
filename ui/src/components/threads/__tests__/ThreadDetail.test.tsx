import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { ThreadDetail } from "../../../pages/ThreadDetail";

// Mock API modules
vi.mock("../../../api/threads", () => ({
  threadsApi: {
    detail: vi.fn(),
    advancePhase: vi.fn(),
    listLinks: vi.fn().mockResolvedValue({ links: [] }),
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
  visibility: "company",
  ownerUserId: null,
  originSource: null,
  intent: ["improve security"],
  goalId: null,
  autonomyLevel: 1,
  summaryText: null,
  summaryNext: null,
  crewPaused: false,
  subtype: "normal",
  shareToken: null,
  participants: [],
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
      expect(screen.getByRole("tablist", { name: "Thread sections" })).toBeInTheDocument();
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

  it("renders embedded detail with rounded center and viewer panes", async () => {
    vi.mocked(threadsApi.detail).mockResolvedValue(mockThread);

    renderWithProviders(<ThreadDetail embedded />, {
      initialEntries: ["/TC/discussions/thread-1"],
    });

    await waitFor(() => {
      expect(screen.getByTestId("thread-center-panel")).toHaveAttribute("data-pane", "center");
      expect(screen.getByTestId("thread-right-viewer")).toHaveAttribute("data-pane", "viewer");
    });
  });

  it("does not report viewer-wide auto-collapse while resizing the viewer", async () => {
    vi.mocked(threadsApi.detail).mockResolvedValue(mockThread);
    const onViewerWideChange = vi.fn();

    renderWithProviders(<ThreadDetail embedded onViewerWideChange={onViewerWideChange} />, {
      initialEntries: ["/TC/discussions/thread-1"],
    });

    const viewer = await screen.findByTestId("thread-right-viewer");
    const resizeHandle = screen.getByRole("separator", { name: /resize viewer/i });

    fireEvent.pointerDown(resizeHandle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(resizeHandle, { clientX: -140, pointerId: 1 });
    fireEvent.pointerUp(resizeHandle, { pointerId: 1 });

    await waitFor(() => {
      expect(viewer).toHaveAttribute("data-width", "580");
    });
    expect(onViewerWideChange).not.toHaveBeenCalled();
  });

  it("allows closing the Open tab and reopening it from the add button", async () => {
    vi.mocked(threadsApi.detail).mockResolvedValue(mockThread);
    const user = userEvent.setup();

    renderWithProviders(<ThreadDetail embedded />, {
      initialEntries: ["/TC/discussions/thread-1"],
    });

    await screen.findByTestId("thread-open-viewer");
    await user.click(screen.getByRole("button", { name: /close open/i }));

    expect(screen.getByTestId("thread-viewer-empty")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open viewer tab/i }));

    expect(screen.getByTestId("thread-open-viewer")).toBeInTheDocument();
  });

  it("shows open viewer tabs as icons while the right viewer is collapsed", async () => {
    vi.mocked(threadsApi.detail).mockResolvedValue(mockThread);
    const user = userEvent.setup();

    renderWithProviders(<ThreadDetail embedded />, {
      initialEntries: ["/TC/discussions/thread-1"],
    });

    await screen.findByTestId("thread-open-viewer");
    await user.click(screen.getByRole("button", { name: /close viewer/i }));

    const strip = screen.getByTestId("thread-viewer-collapsed-strip");
    expect(strip).toBeInTheDocument();
    expect(within(strip).getByRole("button", { name: /^open$/i })).toBeInTheDocument();
  });

  it("opens localhost browser previews with the same http default as Workspace", async () => {
    vi.mocked(threadsApi.detail).mockResolvedValue(mockThread);
    const user = userEvent.setup();

    renderWithProviders(<ThreadDetail embedded />, {
      initialEntries: ["/TC/discussions/thread-1"],
    });

    await screen.findByTestId("thread-open-viewer");
    await user.click(screen.getByText("New browser"));

    const input = screen.getByTestId("thread-browser-url-input");
    await user.clear(input);
    await user.type(input, "localhost:3100/api/health");
    await user.click(screen.getByRole("button", { name: /^open$/i }));

    expect(screen.getByTestId("thread-browser-iframe")).toHaveAttribute(
      "src",
      "http://localhost:3100/api/health",
    );
  });

  it("keeps browser viewer URL state isolated when switching link tabs", async () => {
    vi.mocked(threadsApi.detail).mockResolvedValue({
      ...mockThread,
      entries: [
        {
          id: "entry-1",
          discussionId: "thread-1",
          inputType: "paste",
          rawContent: "Compare https://example.com and https://openai.com for this thread.",
          title: null,
          departmentId: null,
          projectId: null,
          goalId: null,
          sourceInfo: null,
          parentEntryId: null,
          authorAgentId: null,
          extractionStatus: "skipped",
          seq: 1,
          createdBy: "user-1",
          createdAt: "2026-01-01T00:00:00Z",
          extractedItems: [],
          annotations: [],
          attachments: [],
        } as any,
      ],
    });
    const user = userEvent.setup();

    renderWithProviders(<ThreadDetail embedded />, {
      initialEntries: ["/TC/discussions/thread-1"],
    });

    await screen.findByTestId("thread-open-viewer");
    await user.click(screen.getByRole("button", { name: "https://example.com/" }));
    expect(screen.getByTestId("thread-browser-iframe")).toHaveAttribute("src", "https://example.com/");

    await user.click(screen.getByRole("tab", { name: /^open$/i }));
    await user.click(screen.getByRole("button", { name: "https://openai.com/" }));
    expect(screen.getByTestId("thread-browser-iframe")).toHaveAttribute("src", "https://openai.com/");

    await user.click(screen.getByRole("tab", { name: /example\.com/i }));
    expect(screen.getByTestId("thread-browser-iframe")).toHaveAttribute("src", "https://example.com/");
  });
});
