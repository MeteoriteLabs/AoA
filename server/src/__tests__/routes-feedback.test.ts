import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { feedbackRoutes } from "../routes/feedback.js";
import { forbidden, notFound } from "../errors.js";

const mockVotesService = vi.hoisted(() => ({
  recordVote: vi.fn(),
  listVotes: vi.fn(),
  dismissVote: vi.fn(),
  voteSummaryForTarget: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../services/feedback-votes.js", () => ({
  feedbackVotesService: () => mockVotesService,
}));

vi.mock("../services/issues.js", () => ({
  issueService: () => mockIssueService,
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "55555555-5555-5555-5555-555555555555";
const ISSUE_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const VOTE_ID = "44444444-4444-4444-4444-444444444444";
const USER_A = "user-a";
const USER_B = "user-b";

function createApp(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", feedbackRoutes({} as any));
  app.use(errorHandler);
  return app;
}

function boardActor(
  overrides: Partial<{
    userId: string;
    companyIds: string[];
    isInstanceAdmin: boolean;
    source: string;
  }> = {},
) {
  return {
    type: "board" as const,
    userId: overrides.userId ?? USER_A,
    source: overrides.source ?? "session",
    companyIds: overrides.companyIds ?? [COMPANY_A],
    isInstanceAdmin: overrides.isInstanceAdmin ?? false,
  };
}

// ── POST /issues/:id/feedback-votes ──────────────────────────────────────────

describe("feedback routes — POST /issues/:id/feedback-votes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a vote and returns 201", async () => {
    mockIssueService.getById.mockResolvedValue({
      id: ISSUE_ID,
      companyId: COMPANY_A,
      identifier: "ENG-1",
    });
    mockVotesService.recordVote.mockResolvedValue({
      id: VOTE_ID,
      companyId: COMPANY_A,
      issueId: ISSUE_ID,
      targetType: "issue_comment",
      targetId: TARGET_ID,
      authorUserId: USER_A,
      vote: "up",
      reason: null,
    });

    const app = createApp(boardActor());
    const res = await request(app)
      .post(`/api/issues/${ISSUE_ID}/feedback-votes`)
      .send({
        targetType: "issue_comment",
        targetId: TARGET_ID,
        vote: "up",
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.id).toBe(VOTE_ID);
    expect(mockVotesService.recordVote).toHaveBeenCalledWith({
      companyId: COMPANY_A,
      authorUserId: USER_A,
      issueId: ISSUE_ID,
      targetType: "issue_comment",
      targetId: TARGET_ID,
      vote: "up",
      reason: undefined,
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    const [, activity] = mockLogActivity.mock.calls[0];
    expect(activity.action).toBe("issue.feedback_vote_saved");
    expect(activity.entityId).toBe(ISSUE_ID);
    expect(activity.details).toMatchObject({
      vote: "up",
      hasReason: false,
      targetType: "issue_comment",
    });
  });

  it("passes trimmed reason to service on downvote", async () => {
    mockIssueService.getById.mockResolvedValue({ id: ISSUE_ID, companyId: COMPANY_A, identifier: "ENG-1" });
    mockVotesService.recordVote.mockResolvedValue({
      id: VOTE_ID,
      targetType: "issue_comment",
      targetId: TARGET_ID,
      vote: "down",
      reason: "missed the mark",
    });

    const app = createApp(boardActor());
    await request(app)
      .post(`/api/issues/${ISSUE_ID}/feedback-votes`)
      .send({
        targetType: "issue_comment",
        targetId: TARGET_ID,
        vote: "down",
        reason: "  missed the mark  ",
      });

    const [{ reason }] = mockVotesService.recordVote.mock.calls[0];
    // Zod .trim() runs before service is called.
    expect(reason).toBe("missed the mark");
  });

  it("returns 404 when issue does not exist", async () => {
    mockIssueService.getById.mockResolvedValue(null);
    const app = createApp(boardActor());
    const res = await request(app)
      .post(`/api/issues/${ISSUE_ID}/feedback-votes`)
      .send({ targetType: "issue_comment", targetId: TARGET_ID, vote: "up" });
    expect(res.status).toBe(404);
    expect(mockVotesService.recordVote).not.toHaveBeenCalled();
  });

  it("rejects agent actor (403) — only board can vote", async () => {
    mockIssueService.getById.mockResolvedValue({ id: ISSUE_ID, companyId: COMPANY_A });
    const app = createApp({
      type: "agent" as const,
      source: "agent-key",
      agentId: "some-agent",
      companyId: COMPANY_A,
    });
    const res = await request(app)
      .post(`/api/issues/${ISSUE_ID}/feedback-votes`)
      .send({ targetType: "issue_comment", targetId: TARGET_ID, vote: "up" });
    expect(res.status).toBe(403);
    expect(mockVotesService.recordVote).not.toHaveBeenCalled();
  });

  it("forbids cross-company access", async () => {
    mockIssueService.getById.mockResolvedValue({ id: ISSUE_ID, companyId: COMPANY_A });
    const app = createApp(boardActor({ companyIds: [COMPANY_B] }));
    const res = await request(app)
      .post(`/api/issues/${ISSUE_ID}/feedback-votes`)
      .send({ targetType: "issue_comment", targetId: TARGET_ID, vote: "up" });
    expect(res.status).toBe(403);
    expect(mockVotesService.recordVote).not.toHaveBeenCalled();
  });

  it("rejects invalid target type (400 validation)", async () => {
    mockIssueService.getById.mockResolvedValue({ id: ISSUE_ID, companyId: COMPANY_A });
    const app = createApp(boardActor());
    const res = await request(app)
      .post(`/api/issues/${ISSUE_ID}/feedback-votes`)
      .send({ targetType: "bogus", targetId: TARGET_ID, vote: "up" });
    expect(res.status).toBe(400);
    expect(mockVotesService.recordVote).not.toHaveBeenCalled();
  });

  it("rejects non-uuid targetId (400 validation)", async () => {
    mockIssueService.getById.mockResolvedValue({ id: ISSUE_ID, companyId: COMPANY_A });
    const app = createApp(boardActor());
    const res = await request(app)
      .post(`/api/issues/${ISSUE_ID}/feedback-votes`)
      .send({ targetType: "issue_comment", targetId: "not-uuid", vote: "up" });
    expect(res.status).toBe(400);
  });
});

// ── GET /issues/:id/feedback-votes ───────────────────────────────────────────

describe("feedback routes — GET /issues/:id/feedback-votes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the current user's votes for this issue", async () => {
    mockIssueService.getById.mockResolvedValue({ id: ISSUE_ID, companyId: COMPANY_A });
    mockVotesService.listVotes.mockResolvedValue([
      { id: VOTE_ID, vote: "up", authorUserId: USER_A, issueId: ISSUE_ID },
    ]);

    const app = createApp(boardActor());
    const res = await request(app).get(`/api/issues/${ISSUE_ID}/feedback-votes`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(mockVotesService.listVotes).toHaveBeenCalledWith({
      companyId: COMPANY_A,
      issueId: ISSUE_ID,
      authorUserId: USER_A,
    });
  });

  it("returns 404 when issue is unknown", async () => {
    mockIssueService.getById.mockResolvedValue(null);
    const app = createApp(boardActor());
    const res = await request(app).get(`/api/issues/${ISSUE_ID}/feedback-votes`);
    expect(res.status).toBe(404);
  });

  it("rejects non-board actor with 403", async () => {
    mockIssueService.getById.mockResolvedValue({ id: ISSUE_ID, companyId: COMPANY_A });
    const app = createApp({
      type: "agent" as const,
      source: "agent-key",
      agentId: "some-agent",
      companyId: COMPANY_A,
    });
    const res = await request(app).get(`/api/issues/${ISSUE_ID}/feedback-votes`);
    expect(res.status).toBe(403);
  });
});

// ── GET /issues/:id/feedback-votes/summary ──────────────────────────────────

describe("feedback routes — GET /issues/:id/feedback-votes/summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns aggregate ups/downs for a target", async () => {
    mockIssueService.getById.mockResolvedValue({ id: ISSUE_ID, companyId: COMPANY_A });
    mockVotesService.voteSummaryForTarget.mockResolvedValue({ ups: 3, downs: 1, total: 4 });

    const app = createApp(boardActor());
    const res = await request(app)
      .get(`/api/issues/${ISSUE_ID}/feedback-votes/summary`)
      .query({ targetType: "issue_comment", targetId: TARGET_ID });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ ups: 3, downs: 1, total: 4 });
    expect(mockVotesService.voteSummaryForTarget).toHaveBeenCalledWith({
      companyId: COMPANY_A,
      issueId: ISSUE_ID,
      targetType: "issue_comment",
      targetId: TARGET_ID,
    });
  });

  it("requires targetType + targetId query params", async () => {
    mockIssueService.getById.mockResolvedValue({ id: ISSUE_ID, companyId: COMPANY_A });
    const app = createApp(boardActor());
    const res = await request(app).get(`/api/issues/${ISSUE_ID}/feedback-votes/summary`);
    expect(res.status).toBe(400);
  });
});

// ── DELETE /feedback-votes/:voteId ──────────────────────────────────────────

describe("feedback routes — DELETE /feedback-votes/:voteId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dismisses the caller's own vote with 204", async () => {
    mockVotesService.dismissVote.mockResolvedValue(undefined);
    const app = createApp(boardActor({ userId: USER_A }));
    const res = await request(app).delete(`/api/feedback-votes/${VOTE_ID}`);
    expect(res.status).toBe(204);
    expect(mockVotesService.dismissVote).toHaveBeenCalledWith(VOTE_ID, USER_A);
  });

  it("propagates service 403 when caller is not the vote's author", async () => {
    mockVotesService.dismissVote.mockRejectedValue(forbidden("Only the vote's author can dismiss it"));
    const app = createApp(boardActor({ userId: USER_B }));
    const res = await request(app).delete(`/api/feedback-votes/${VOTE_ID}`);
    expect(res.status).toBe(403);
  });

  it("propagates service 404 for unknown vote", async () => {
    mockVotesService.dismissVote.mockRejectedValue(notFound("Feedback vote not found"));
    const app = createApp(boardActor());
    const res = await request(app).delete(`/api/feedback-votes/${VOTE_ID}`);
    expect(res.status).toBe(404);
  });

  it("rejects non-board actors", async () => {
    const app = createApp({
      type: "agent" as const,
      source: "agent-key",
      agentId: "some-agent",
      companyId: COMPANY_A,
    });
    const res = await request(app).delete(`/api/feedback-votes/${VOTE_ID}`);
    expect(res.status).toBe(403);
    expect(mockVotesService.dismissVote).not.toHaveBeenCalled();
  });
});
