import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { NewThreadDialog } from "../../NewThreadDialog";

vi.mock("../../../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "comp-1",
    selectedCompany: { id: "comp-1", name: "Test Corp", issuePrefix: "TC" },
  }),
}));

vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("../../../api/discussions", () => ({
  discussionsApi: {
    create: vi.fn().mockResolvedValue({ id: "disc-new", title: "New" }),
  },
}));

vi.mock("../../../api/threads", () => ({
  threadsApi: {
    promoteToGoal: vi.fn().mockResolvedValue({ threadId: "t1", goalId: "g1" }),
  },
}));

vi.mock("../../../api/projects", () => ({
  projectsApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../../api/goals", () => ({
  goalsApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}));

describe("NewThreadDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing when open", () => {
    renderWithProviders(
      <NewThreadDialog open={true} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows type chooser chips (Idea, Discussion, Goal, Transcript, Document)", () => {
    renderWithProviders(
      <NewThreadDialog open={true} onClose={vi.fn()} />,
    );
    // Use getAllBy and check at least one button matches each label
    expect(screen.getByRole("button", { name: /^idea$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^discussion$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^goal$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^transcript$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^document$/i })).toBeInTheDocument();
  });

  it("does NOT show goal fields when type is 'Idea'", () => {
    renderWithProviders(
      <NewThreadDialog open={true} onClose={vi.fn()} />,
    );
    // Idea is the default — no goal scope/parent fields shown
    expect(screen.queryByTestId("goal-fields")).not.toBeInTheDocument();
  });

  it("reveals goal fields when type is switched to 'Goal'", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NewThreadDialog open={true} onClose={vi.fn()} />,
    );
    const goalBtn = screen.getByRole("button", { name: /goal/i });
    await user.click(goalBtn);
    await waitFor(() => {
      expect(screen.getByTestId("goal-fields")).toBeInTheDocument();
    });
  });

  it("calls onClose when dialog is cancelled", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <NewThreadDialog open={true} onClose={onClose} />,
    );
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancelBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not render when open=false", () => {
    renderWithProviders(
      <NewThreadDialog open={false} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
