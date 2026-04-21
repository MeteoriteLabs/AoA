import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "./test-utils";
import { FeedbackThumbs } from "../components/FeedbackThumbs";
import type { FeedbackVote } from "@paperclipai/shared";

const mockRecordVote = vi.fn();
const mockDismissVote = vi.fn();

vi.mock("../api/feedback", () => ({
  feedbackApi: {
    recordVote: (...args: unknown[]) => mockRecordVote(...args),
    dismissVote: (...args: unknown[]) => mockDismissVote(...args),
    listVotes: vi.fn(),
    summary: vi.fn(),
  },
}));

const ISSUE_ID = "issue-1";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const VOTE_ID = "44444444-4444-4444-4444-444444444444";

function makeVote(overrides: Partial<FeedbackVote> = {}): FeedbackVote {
  return {
    id: VOTE_ID,
    companyId: "company-1",
    issueId: ISSUE_ID,
    targetType: "issue_comment",
    targetId: TARGET_ID,
    authorUserId: "user-1",
    vote: "up",
    reason: null,
    sharedWithLabs: false,
    sharedAt: null,
    consentVersion: null,
    redactionSummary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("FeedbackThumbs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders two thumb buttons in the idle state", () => {
    renderWithProviders(
      <FeedbackThumbs issueId={ISSUE_ID} targetType="issue_comment" targetId={TARGET_ID} />,
    );
    expect(screen.getByRole("button", { name: /thumbs up/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /thumbs down/i })).toBeInTheDocument();
  });

  it("calls recordVote with vote='up' on thumbs-up click", async () => {
    mockRecordVote.mockResolvedValue(makeVote({ vote: "up" }));
    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackThumbs issueId={ISSUE_ID} targetType="issue_comment" targetId={TARGET_ID} />,
    );

    await user.click(screen.getByRole("button", { name: /thumbs up/i }));

    await waitFor(() => {
      expect(mockRecordVote).toHaveBeenCalledWith(ISSUE_ID, {
        targetType: "issue_comment",
        targetId: TARGET_ID,
        vote: "up",
      });
    });
  });

  it("shows reason textarea after clicking thumbs-down", async () => {
    mockRecordVote.mockResolvedValue(makeVote({ vote: "down" }));
    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackThumbs issueId={ISSUE_ID} targetType="issue_comment" targetId={TARGET_ID} />,
    );

    await user.click(screen.getByRole("button", { name: /thumbs down/i }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /why/i })).toBeInTheDocument();
    });
  });

  it("does not show reason textarea for thumbs-up", async () => {
    mockRecordVote.mockResolvedValue(makeVote({ vote: "up" }));
    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackThumbs issueId={ISSUE_ID} targetType="issue_comment" targetId={TARGET_ID} />,
    );

    await user.click(screen.getByRole("button", { name: /thumbs up/i }));

    await waitFor(() => {
      expect(mockRecordVote).toHaveBeenCalled();
    });
    expect(screen.queryByRole("textbox", { name: /why/i })).not.toBeInTheDocument();
  });

  it("submits downvote with reason via recordVote when user types + confirms", async () => {
    mockRecordVote.mockResolvedValue(makeVote({ vote: "down", reason: "not accurate" }));
    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackThumbs issueId={ISSUE_ID} targetType="issue_comment" targetId={TARGET_ID} />,
    );

    await user.click(screen.getByRole("button", { name: /thumbs down/i }));
    await waitFor(() => expect(mockRecordVote).toHaveBeenCalledTimes(1));

    const textarea = screen.getByRole("textbox", { name: /why/i });
    await user.type(textarea, "not accurate");
    await user.click(screen.getByRole("button", { name: /save feedback/i }));

    await waitFor(() => {
      expect(mockRecordVote).toHaveBeenCalledWith(ISSUE_ID, {
        targetType: "issue_comment",
        targetId: TARGET_ID,
        vote: "down",
        reason: "not accurate",
      });
    });
    expect(mockRecordVote).toHaveBeenCalledTimes(2);
  });

  it("reflects initialVote: selected thumbs-up shows active styling", () => {
    renderWithProviders(
      <FeedbackThumbs
        issueId={ISSUE_ID}
        targetType="issue_comment"
        targetId={TARGET_ID}
        initialVote={makeVote({ vote: "up" })}
      />,
    );
    const upBtn = screen.getByRole("button", { name: /thumbs up/i });
    expect(upBtn).toHaveAttribute("aria-pressed", "true");
    const downBtn = screen.getByRole("button", { name: /thumbs down/i });
    expect(downBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking an already-selected thumb dismisses the vote", async () => {
    mockDismissVote.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackThumbs
        issueId={ISSUE_ID}
        targetType="issue_comment"
        targetId={TARGET_ID}
        initialVote={makeVote({ vote: "up" })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /thumbs up/i }));

    await waitFor(() => {
      expect(mockDismissVote).toHaveBeenCalledWith(VOTE_ID);
    });
    expect(mockRecordVote).not.toHaveBeenCalled();
  });

  it("switching from up to down re-records (not dismiss)", async () => {
    mockRecordVote.mockResolvedValue(makeVote({ vote: "down" }));
    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackThumbs
        issueId={ISSUE_ID}
        targetType="issue_comment"
        targetId={TARGET_ID}
        initialVote={makeVote({ vote: "up" })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /thumbs down/i }));

    await waitFor(() => {
      expect(mockRecordVote).toHaveBeenCalledWith(ISSUE_ID, {
        targetType: "issue_comment",
        targetId: TARGET_ID,
        vote: "down",
      });
    });
    expect(mockDismissVote).not.toHaveBeenCalled();
  });

  it("calls onChange after a successful vote", async () => {
    const onChange = vi.fn();
    mockRecordVote.mockResolvedValue(makeVote({ vote: "up" }));
    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackThumbs
        issueId={ISSUE_ID}
        targetType="issue_comment"
        targetId={TARGET_ID}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /thumbs up/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });
});
