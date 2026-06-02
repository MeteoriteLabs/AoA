import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

const companyId = "11111111-1111-4111-8111-111111111111";

/**
 * The GET /companies/:cid/issues route must translate the `crewBoard=true`
 * query param into a service filter. The service then applies the crew-assignee
 * predicate (assignee is an active `kind='aoa'` agent) and opts into a LEFT JOIN
 * against `discussions` to populate `Issue.sourceThreadTitle`. This route-level
 * test only verifies the param→filter wiring (the service is mocked); the
 * predicate itself is covered in crew-board-filter.test.ts. Other values for the
 * param must NOT trigger the filter — we treat it strictly as the literal
 * string "true".
 */

const mockIssueService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  checkout: vi.fn(),
  release: vi.fn(),
  listLabels: vi.fn(),
  getLabelById: vi.fn(),
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
  getComment: vi.fn(),
  createAttachment: vi.fn(),
  listAttachments: vi.fn(),
  getAttachmentById: vi.fn(),
  removeAttachment: vi.fn(),
  findMentionedAgents: vi.fn(),
  findMentionedProjectIds: vi.fn(),
  getAncestors: vi.fn(),
  staleCount: vi.fn(),
  countUnreadTouchedByUser: vi.fn(),
  markRead: vi.fn(),
  assertCheckoutOwner: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const noopService = vi.hoisted(() => () => ({}));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: noopService,
  goalService: noopService,
  heartbeatService: noopService,
  issueApprovalService: noopService,
  issueService: () => mockIssueService,
  logActivity: vi.fn(),
  projectService: noopService,
  routineService: noopService,
}));

vi.mock("../services/documents.js", () => ({
  documentService: noopService,
}));

const { issueRoutes } = await import("../routes/issues.js");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [companyId],
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("GET /companies/:companyId/issues — crewBoard filter (renamed from sourceDiscussionIdNotNull)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockIssueService.list.mockResolvedValue([]);
  });

  it("passes crewBoard=true through to the service when the query param is the literal 'true'", async () => {
    await request(createApp()).get(
      `/api/companies/${companyId}/issues?crewBoard=true`,
    );
    expect(mockIssueService.list).toHaveBeenCalledTimes(1);
    expect(mockIssueService.list.mock.calls[0][1]).toMatchObject({
      crewBoard: true,
    });
  });

  it("does not set the filter when the param is absent", async () => {
    await request(createApp()).get(`/api/companies/${companyId}/issues`);
    expect(mockIssueService.list).toHaveBeenCalledTimes(1);
    expect(mockIssueService.list.mock.calls[0][1]).not.toHaveProperty(
      "crewBoard",
    );
  });

  it("ignores non-'true' values for the param", async () => {
    await request(createApp()).get(
      `/api/companies/${companyId}/issues?crewBoard=1`,
    );
    expect(mockIssueService.list).toHaveBeenCalledTimes(1);
    expect(mockIssueService.list.mock.calls[0][1]).not.toHaveProperty(
      "crewBoard",
    );
  });

  it("returns the service result list unchanged (server preserves sourceThreadTitle from the JOIN)", async () => {
    const fakeRow = {
      id: "issue-1",
      title: "Hero copy",
      sourceDiscussionId: "thread-A",
      sourceThreadTitle: "Plan landing page redesign",
      status: "todo",
    };
    mockIssueService.list.mockResolvedValue([fakeRow]);

    const res = await request(createApp()).get(
      `/api/companies/${companyId}/issues?crewBoard=true`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: "issue-1",
      sourceDiscussionId: "thread-A",
      sourceThreadTitle: "Plan landing page redesign",
    });
  });

  it("passes assigneeAgentId through to the service alongside crewBoard", async () => {
    const agentId = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
    await request(createApp()).get(
      `/api/companies/${companyId}/issues?crewBoard=true&assigneeAgentId=${agentId}`,
    );
    expect(mockIssueService.list).toHaveBeenCalledTimes(1);
    expect(mockIssueService.list.mock.calls[0][1]).toMatchObject({
      crewBoard: true,
      assigneeAgentId: agentId,
    });
  });

  it("does NOT set crewBoard when the old sourceDiscussionIdNotNull param is used (old param is ignored)", async () => {
    await request(createApp()).get(
      `/api/companies/${companyId}/issues?sourceDiscussionIdNotNull=true`,
    );
    expect(mockIssueService.list).toHaveBeenCalledTimes(1);
    // The old param must not accidentally activate the filter
    expect(mockIssueService.list.mock.calls[0][1]).not.toHaveProperty("crewBoard");
    expect(mockIssueService.list.mock.calls[0][1]).not.toHaveProperty("sourceDiscussionIdNotNull");
  });
});
