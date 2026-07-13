import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const agentId = "33333333-3333-4333-8333-333333333333";
const nextAgentId = "44444444-4444-4444-8444-444444444444";

const baseIssue = {
  id: issueId,
  identifier: "AOA-1",
  companyId,
  title: "Prepare launch plan",
  status: "todo",
  workMode: "standard",
  assigneeAgentId: agentId,
  assigneeUserId: null,
  responsibleUserId: "user-old",
  createdByUserId: "creator-user",
  projectId: null,
  goalId: null,
  parentId: null,
  executionRunId: null,
  labels: [],
  labelIds: [],
};

const mockIssueService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  addComment: vi.fn(),
  findMentionedAgents: vi.fn(),
  notifyMentionedHumans: vi.fn(),
  resolveAgentKinds: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockEnqueueIssueAssigneeWakeup = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  goalService: () => ({ getById: vi.fn() }),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  memoryLifecycleService: () => ({ onTaskCompleted: vi.fn() }),
  projectService: () => ({ getById: vi.fn() }),
  routineService: () => ({ syncRunStatusForIssue: vi.fn() }),
}));

vi.mock("../services/documents.js", () => ({
  documentService: () => ({}),
}));

vi.mock("../services/eager-workspace.js", () => ({
  createEagerWorkspaceForIssue: vi.fn(),
}));

vi.mock("../services/issue-assignee-wakeup.js", () => ({
  enqueueIssueAssigneeWakeup: mockEnqueueIssueAssigneeWakeup,
}));

vi.mock("../services/issue-context-bundles.js", () => ({
  listIssueContextBundlesForIssue: vi.fn(),
  setIssueContextBundleItemIncluded: vi.fn(),
}));

const { issueRoutes } = await import("../routes/issues.js");

function createApp(actor: Record<string, unknown> = {
  type: "board",
  userId: "board-user",
  source: "session",
  companyIds: [companyId],
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue responsible user routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockAgentService.getById.mockResolvedValue({
      id: agentId,
      companyId,
      status: "idle",
      role: "engineer",
      reportsTo: null,
      permissions: {},
    });
    mockIssueService.list.mockResolvedValue([]);
    mockIssueService.getById.mockResolvedValue(baseIssue);
    mockIssueService.getByIdentifier.mockResolvedValue(null);
    mockIssueService.create.mockImplementation(async (_companyId: string, data: Record<string, unknown>) => ({
      ...baseIssue,
      id: "created-issue",
      assigneeAgentId: null,
      responsibleUserId: data.responsibleUserId ?? null,
      ...data,
    }));
    mockIssueService.update.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...baseIssue,
      ...data,
    }));
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.notifyMentionedHumans.mockResolvedValue(0);
    mockIssueService.resolveAgentKinds.mockResolvedValue(new Map());
    mockHeartbeatService.wakeup.mockResolvedValue(undefined);
    mockLogActivity.mockResolvedValue(undefined);
    mockEnqueueIssueAssigneeWakeup.mockResolvedValue(undefined);
  });

  it("lets board users with tasks:assign create and update responsibleUserId", async () => {
    const app = createApp();

    const createRes = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Prepare launch plan", responsibleUserId: "user-new" });

    expect(createRes.status, JSON.stringify(createRes.body)).toBe(201);
    expect(mockAccessService.canUser).toHaveBeenCalledWith(companyId, "board-user", "tasks:assign");
    expect(mockIssueService.create).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({ responsibleUserId: "user-new" }),
    );

    const updateRes = await request(app)
      .patch(`/api/issues/${issueId}`)
      .send({ responsibleUserId: "user-next" });

    expect(updateRes.status, JSON.stringify(updateRes.body)).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      issueId,
      expect.objectContaining({ responsibleUserId: "user-next" }),
    );
  });

  it("passes board user as responsible fallback when creating an unassigned task", async () => {
    const app = createApp();

    const res = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Operator-owned unassigned task" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockIssueService.create).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({ responsibleFallbackUserId: "board-user" }),
    );
  });

  it("rejects board users without tasks:assign when they change responsibleUserId", async () => {
    mockAccessService.canUser.mockResolvedValue(false);

    const res = await request(createApp())
      .patch(`/api/issues/${issueId}`)
      .send({ responsibleUserId: "user-new" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Missing permission: tasks:assign");
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });

  it("rejects assigned agents without tasks:assign when return-to-creator also changes responsibleUserId", async () => {
    const res = await request(createApp({
      type: "agent",
      agentId,
      companyId,
      source: "agent_key",
      runId: "run-1",
    }))
      .patch(`/api/issues/${issueId}`)
      .send({
        assigneeAgentId: null,
        assigneeUserId: "creator-user",
        responsibleUserId: "some-user",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Missing permission: tasks:assign");
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });

  it("rejects board users without tasks:assign when they create with responsibleUserId", async () => {
    mockAccessService.canUser.mockResolvedValue(false);

    const res = await request(createApp())
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "Prepare launch plan", responsibleUserId: "user-new" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Missing permission: tasks:assign");
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("does not wake the assigned agent for a responsible-only update", async () => {
    const res = await request(createApp())
      .patch(`/api/issues/${issueId}`)
      .send({ responsibleUserId: "user-new" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockEnqueueIssueAssigneeWakeup).not.toHaveBeenCalled();
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("logs previous and next responsibleUserId in issue.updated activity details", async () => {
    const res = await request(createApp())
      .patch(`/api/issues/${issueId}`)
      .send({ responsibleUserId: "user-new" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.updated",
        details: expect.objectContaining({
          responsibleUserId: "user-new",
          previousResponsibleUserId: "user-old",
        }),
      }),
    );
  });

  it("logs persisted responsible owner when reassignment auto-recomputes it", async () => {
    mockIssueService.update.mockResolvedValueOnce({
      ...baseIssue,
      assigneeAgentId: nextAgentId,
      assigneeUserId: null,
      responsibleUserId: "manager-user",
    });

    const res = await request(createApp())
      .patch(`/api/issues/${issueId}`)
      .send({ assigneeAgentId: nextAgentId, assigneeUserId: null });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.updated",
        details: expect.objectContaining({
          responsibleUserId: "manager-user",
          previousResponsibleUserId: "user-old",
        }),
      }),
    );
    const details = mockLogActivity.mock.calls.find(([, payload]) => payload.action === "issue.updated")?.[1].details;
    expect(details.responsibleUserId).not.toBe("__omitted__");
  });

  it("does not add responsible fields to unrelated update activity details", async () => {
    const res = await request(createApp())
      .patch(`/api/issues/${issueId}`)
      .send({ title: "Retitled task" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const details = mockLogActivity.mock.calls.find(([, payload]) => payload.action === "issue.updated")?.[1].details;
    expect(details).toEqual(expect.objectContaining({ title: "Retitled task", identifier: "AOA-1" }));
    expect(details).not.toHaveProperty("responsibleUserId");
    expect(details).not.toHaveProperty("previousResponsibleUserId");
  });

  it("passes responsibleUserId list filters to the issue service", async () => {
    const res = await request(createApp())
      .get(`/api/companies/${companyId}/issues`)
      .query({ responsibleUserId: "user-1" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockIssueService.list).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({ responsibleUserId: "user-1" }),
    );
  });

  it("resolves responsibleUserId=me for board actors", async () => {
    const res = await request(createApp())
      .get(`/api/companies/${companyId}/issues`)
      .query({ responsibleUserId: "me" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockIssueService.list).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({ responsibleUserId: "board-user" }),
    );
  });

  it("rejects responsibleUserId=me for non-board actors", async () => {
    const res = await request(createApp({
      type: "agent",
      agentId,
      companyId,
      source: "agent_key",
    }))
      .get(`/api/companies/${companyId}/issues`)
      .query({ responsibleUserId: "me" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("responsibleUserId=me requires board authentication");
    expect(mockIssueService.list).not.toHaveBeenCalled();
  });
});
