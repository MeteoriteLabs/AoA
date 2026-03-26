import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  mockCompanyContext,
  mockDialogContext,
} from "./test-utils";
import { DiscussionCaptureModal } from "../components/DiscussionCaptureModal";

// --- Mocks ---

const mockNavigate = vi.fn();
const pushToast = vi.fn();

const discussionsApiMock = {
  list: vi.fn().mockResolvedValue({
    discussions: [
      {
        id: "disc-existing",
        title: "Existing Discussion",
        status: "active",
        pendingItemCount: 1,
        entryCount: 2,
      },
    ],
    total: 1,
    limit: 20,
    offset: 0,
  }),
  create: vi.fn().mockResolvedValue({
    id: "disc-new",
    title: "New Discussion",
    status: "active",
    entries: [],
  }),
  addEntry: vi.fn().mockResolvedValue({
    id: "entry-1",
    extractionStatus: "processing",
  }),
};

vi.mock("../api/discussions", () => ({
  discussionsApi: new Proxy(
    {},
    { get: (_t, prop) => (discussionsApiMock as any)[prop] },
  ),
}));

vi.mock("../api/projects", () => ({
  projectsApi: {
    list: vi.fn().mockResolvedValue([
      { id: "dept-1", name: "Engineering", type: "department" },
      { id: "proj-1", name: "Website", type: "project" },
    ]),
  },
}));

vi.mock("../api/transcription", () => ({
  transcriptionApi: {
    transcribe: vi.fn().mockResolvedValue({ text: "Transcribed content" }),
  },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ ...mockCompanyContext, selectedCompanyId: "comp-1" }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({
    ...mockDialogContext,
    discussionCaptureOpen: true,
    closeDiscussionCapture: mockDialogContext.closeDiscussionCapture,
  }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast }),
}));

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual("react-router-dom") as any;
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---

describe("DiscussionCaptureModal", () => {
  it("renders when open", async () => {
    renderWithProviders(<DiscussionCaptureModal />);

    await waitFor(() => {
      expect(screen.getByText("New Discussion")).toBeInTheDocument();
    });
  });

  it("shows input tabs: Paste, Write, Voice", async () => {
    renderWithProviders(<DiscussionCaptureModal />);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Paste/ })).toBeInTheDocument();
    });

    expect(screen.getByRole("tab", { name: /Write/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Voice/ })).toBeInTheDocument();
  });

  it("shows existing discussion dropdown", async () => {
    renderWithProviders(<DiscussionCaptureModal />);

    await waitFor(() => {
      expect(screen.getByText("New standalone discussion")).toBeInTheDocument();
    });
  });

  it("shows title and department fields for new discussion", async () => {
    renderWithProviders(<DiscussionCaptureModal />);

    await waitFor(() => {
      expect(screen.getByText("Title (optional — auto-generated if empty)")).toBeInTheDocument();
    });

    expect(screen.getByText("Department (optional)")).toBeInTheDocument();
  });

  it("shows Start Discussion button", async () => {
    renderWithProviders(<DiscussionCaptureModal />);

    await waitFor(() => {
      expect(screen.getByText("Start Discussion")).toBeInTheDocument();
    });
  });

  it("disables submit when content is empty", async () => {
    renderWithProviders(<DiscussionCaptureModal />);

    await waitFor(() => {
      const btn = screen.getByText("Start Discussion").closest("button");
      expect(btn).toBeDisabled();
    });
  });

  it("enables submit when content is entered", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DiscussionCaptureModal />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Paste meeting notes/)).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText(/Paste meeting notes/), "Some meeting notes");

    const btn = screen.getByText("Start Discussion").closest("button");
    expect(btn).not.toBeDisabled();
  });

  it("changes button label to Add Entry when existing discussion selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DiscussionCaptureModal />);

    // Wait for discussion options to load
    await waitFor(() => {
      expect(screen.getByText(/Existing Discussion/)).toBeInTheDocument();
    });

    const select = screen.getByLabelText(/Add to existing discussion/) as HTMLSelectElement;
    await user.selectOptions(select, "disc-existing");

    await waitFor(() => {
      expect(screen.getByText("Add Entry")).toBeInTheDocument();
    });
  });

  it("hides title/department fields when adding to existing discussion", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DiscussionCaptureModal />);

    // Wait for discussion options to load
    await waitFor(() => {
      expect(screen.getByText(/Existing Discussion/)).toBeInTheDocument();
    });

    const select = screen.getByLabelText(/Add to existing discussion/) as HTMLSelectElement;
    await user.selectOptions(select, "disc-existing");

    await waitFor(() => {
      expect(screen.queryByText("Title (optional — auto-generated if empty)")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Department (optional)")).not.toBeInTheDocument();
  });
});
