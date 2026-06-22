import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const assigneeAgentId = "33333333-3333-4333-8333-333333333333";
const mentionedAgentId = "44444444-4444-4444-8444-444444444444";
const leadAgentId = "55555555-5555-4555-8555-555555555555";
const otherLeadAgentId = "66666666-6666-4666-8666-666666666666";
const parentIssueId = "77777777-7777-4777-8777-777777777777";

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: issueId,
    identifier: "ARM-1",
    companyId,
    title: "Inspect upload context",
    status: "todo",
    workMode: "standard",
    assigneeAgentId,
    executionRunId: null,
    ...overrides,
  };
}

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
  notifyMentionedHumans: vi.fn(),
  getAncestors: vi.fn(),
  staleCount: vi.fn(),
  countUnreadTouchedByUser: vi.fn(),
  markRead: vi.fn(),
  assertCheckoutOwner: vi.fn(),
  resolveAgentKinds: vi.fn(),
  enqueueAoaMentionWakeup: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
  getRun: vi.fn(),
  getActiveRunForAgent: vi.fn(),
  cancelRun: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockProjectService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockGoalService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockIssueApprovalService = vi.hoisted(() => ({
  listApprovalsForIssue: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
}));
const mockDocumentService = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  upsert: vi.fn(),
  listRevisions: vi.fn(),
  restoreRevision: vi.fn(),
}));
const mockRoutineService = vi.hoisted(() => ({}));
const mockMemoryLifecycleService = vi.hoisted(() => ({}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockCreateEagerWorkspaceForIssue = vi.hoisted(() => vi.fn());
// CREATE-path assignment dispatch now routes through the kind-aware chokepoint
// (crew → AoA dispatcher, org → heartbeat). We assert on this mock for the
// POST /issues delegation tests. Comment-path dispatch is ALSO kind-aware
// (crew arc review #1): org assignees → heartbeat.wakeup, crew (kind='aoa')
// assignees → svc.enqueueAoaMentionWakeup.
const mockEnqueueAssignee = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  goalService: () => mockGoalService,
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => mockIssueApprovalService,
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  memoryLifecycleService: () => mockMemoryLifecycleService,
  projectService: () => mockProjectService,
  routineService: () => mockRoutineService,
}));

vi.mock("../services/documents.js", () => ({
  documentService: () => mockDocumentService,
}));

vi.mock("../services/eager-workspace.js", () => ({
  createEagerWorkspaceForIssue: mockCreateEagerWorkspaceForIssue,
}));

vi.mock("../services/issue-assignee-wakeup.js", () => ({
  enqueueIssueAssigneeWakeup: mockEnqueueAssignee,
}));

const { issueRoutes } = await import("../routes/issues.js");

function createApp(actorOverride?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [companyId],
      ...actorOverride,
    };
    next();
  });
  app.use(
    "/api",
    issueRoutes({} as any, {
      putFile: vi.fn(async (input: { originalFilename: string | null; contentType: string; body: Buffer }) => ({
        provider: "memory",
        objectKey: `stored/${input.originalFilename ?? "file"}`,
        contentType: input.contentType,
        byteSize: input.body.length,
        sha256: "sha256",
        originalFilename: input.originalFilename,
      })),
      getObject: vi.fn(),
      deleteObject: vi.fn(),
    } as any),
  );
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAccessService.canUser.mockResolvedValue(true);
  mockAccessService.hasPermission.mockResolvedValue(true);
  mockIssueService.getById.mockResolvedValue(makeIssue());
  // Default: no crew assignees → comment wakeups route to heartbeat (org path).
  mockIssueService.resolveAgentKinds.mockResolvedValue(new Map());
  mockIssueService.enqueueAoaMentionWakeup.mockResolvedValue(undefined);
  mockIssueService.addComment.mockResolvedValue({
    id: "comment-1",
    issueId,
    companyId,
    body: "Please inspect these screenshots",
    authorAgentId: null,
    authorUserId: "board-user",
  });
  mockIssueService.createAttachment.mockImplementation(async (input: Record<string, unknown>) => ({
    id: `attachment-${mockIssueService.createAttachment.mock.calls.length}`,
    companyId,
    issueId,
    issueCommentId: input.issueCommentId,
    provider: input.provider,
    objectKey: input.objectKey,
    contentType: input.contentType,
    byteSize: input.byteSize,
    sha256: input.sha256,
    originalFilename: input.originalFilename,
  }));
  mockIssueService.findMentionedAgents.mockResolvedValue([]);
  mockIssueService.notifyMentionedHumans.mockResolvedValue([]);
  mockHeartbeatService.wakeup.mockResolvedValue({ id: "run-1" });
  mockEnqueueAssignee.mockResolvedValue(undefined);
  mockCreateEagerWorkspaceForIssue.mockResolvedValue(null);
  mockProjectService.getById.mockResolvedValue({ id: "99999999-9999-4999-8999-999999999999", companyId });
  mockIssueService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
    id: "new-issue",
    identifier: "ARM-2",
    companyId,
    title: input.title,
    status: input.status ?? "todo",
    workMode: input.workMode ?? "standard",
    projectId: input.projectId ?? null,
    parentId: input.parentId ?? null,
    assigneeAgentId: input.assigneeAgentId ?? null,
    executionWorkspaceId: null,
  }));
  mockAgentService.getById.mockImplementation(async (id: string) => {
    const rows: Record<string, unknown> = {
      [leadAgentId]: {
        id: leadAgentId,
        companyId,
        role: "lead",
        status: "idle",
        reportsTo: null,
        permissions: {},
      },
      [assigneeAgentId]: {
        id: assigneeAgentId,
        companyId,
        role: "general",
        status: "idle",
        reportsTo: leadAgentId,
        permissions: {},
      },
      [mentionedAgentId]: {
        id: mentionedAgentId,
        companyId,
        role: "general",
        status: "idle",
        reportsTo: otherLeadAgentId,
        permissions: {},
      },
    };
    return rows[id] ?? null;
  });
});

describe("POST /issues/:id/comments-with-attachments", () => {
  it("creates a comment, links attachments, then wakes the assignee once with attachment metadata", async () => {
    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "Please inspect these screenshots")
      .attach("files", Buffer.from("fake-png"), { filename: "proof.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.comment.body).toBe("Please inspect these screenshots");
    expect(res.body.attachments).toHaveLength(1);
    expect(res.body.attachments[0].issueCommentId).toBe("comment-1");
    expect(mockIssueService.createAttachment).toHaveBeenCalledWith(expect.objectContaining({
      issueId,
      issueCommentId: "comment-1",
      originalFilename: "proof.png",
      contentType: "image/png",
    }));

    await vi.waitFor(() => expect(mockHeartbeatService.wakeup).toHaveBeenCalledTimes(1));
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      assigneeAgentId,
      expect.objectContaining({
        reason: "issue_commented",
        payload: expect.objectContaining({
          issueId,
          commentId: "comment-1",
          attachmentCount: 1,
          attachments: [
            expect.objectContaining({
              id: "attachment-1",
              filename: "proof.png",
              contentType: "image/png",
            }),
          ],
        }),
        contextSnapshot: expect.objectContaining({
          issueId,
          taskId: issueId,
          wakeCommentId: "comment-1",
          attachmentCount: 1,
        }),
      }),
    );
  });

  it("routes a crew (kind='aoa') assignee's comment wakeup to the AoA dispatcher, NOT heartbeat (crew arc review #1)", async () => {
    // The task assignee is a crew agent → heartbeat.wakeup would be silently
    // refused (Decision #100, heartbeat.ts:4355) and the crew agent would never
    // run. The comment route must enqueue an AoA dispatcher wakeup instead.
    mockIssueService.resolveAgentKinds.mockResolvedValue(new Map([[assigneeAgentId, "aoa"]]));

    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "Please take a look")
      .attach("files", Buffer.from("fake-png"), { filename: "proof.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    await vi.waitFor(() =>
      expect(mockIssueService.enqueueAoaMentionWakeup).toHaveBeenCalledTimes(1),
    );
    expect(mockIssueService.enqueueAoaMentionWakeup).toHaveBeenCalledWith(
      companyId,
      assigneeAgentId,
      expect.objectContaining({
        reason: "issue_commented",
        payload: expect.objectContaining({ issueId, commentId: "comment-1" }),
      }),
    );
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("honors reopen=true for attachment comments and wakes with reopen context", async () => {
    const closedIssue = makeIssue({ status: "done" });
    const reopenedIssue = makeIssue({ status: "todo" });
    mockIssueService.getById.mockResolvedValue(closedIssue);
    mockIssueService.update.mockResolvedValue(reopenedIssue);

    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "Reopen with evidence")
      .field("reopen", "true")
      .attach("files", Buffer.from("fake-png"), { filename: "proof.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(mockIssueService.update).toHaveBeenCalledWith(issueId, { status: "todo" });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.updated",
        entityId: issueId,
        details: expect.objectContaining({
          status: "todo",
          reopened: true,
          reopenedFrom: "done",
          source: "comment",
        }),
      }),
    );
    await vi.waitFor(() => expect(mockHeartbeatService.wakeup).toHaveBeenCalledTimes(1));
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      assigneeAgentId,
      expect.objectContaining({
        reason: "issue_reopened_via_comment",
        payload: expect.objectContaining({
          issueId,
          commentId: "comment-1",
          reopenedFrom: "done",
          attachmentCount: 1,
        }),
        contextSnapshot: expect.objectContaining({
          issueId,
          taskId: issueId,
          wakeCommentId: "comment-1",
          wakeReason: "issue_reopened_via_comment",
          reopenedFrom: "done",
          attachmentCount: 1,
        }),
      }),
    );
  });

  it("does NOT wake on reopen-via-comment when the task is in planning mode (D8 gate)", async () => {
    // A-M11: reopening a planning-mode task via comment must honor the D8
    // planning-mode dispatch gate. heartbeat.wakeup has no planning gate, so the
    // route's shared helper must suppress the reopen wakeup for planning tasks.
    const closedPlanningIssue = makeIssue({ status: "done", workMode: "planning" });
    const reopenedPlanningIssue = makeIssue({ status: "todo", workMode: "planning" });
    mockIssueService.getById.mockResolvedValue(closedPlanningIssue);
    mockIssueService.update.mockResolvedValue(reopenedPlanningIssue);

    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "Reopen this planning task")
      .field("reopen", "true")
      .attach("files", Buffer.from("fake-png"), { filename: "proof.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(mockIssueService.update).toHaveBeenCalledWith(issueId, { status: "todo" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    expect(mockIssueService.enqueueAoaMentionWakeup).not.toHaveBeenCalled();
  });

  it("honors interrupt=true for board attachment comments and includes interruptedRunId in wake context", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({ executionRunId: "run-active" }));
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-active",
      companyId,
      agentId: assigneeAgentId,
      status: "running",
    });
    mockHeartbeatService.cancelRun.mockResolvedValue({
      id: "run-active",
      companyId,
      agentId: assigneeAgentId,
    });

    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "Stop and inspect this")
      .field("interrupt", "true")
      .attach("files", Buffer.from("fake-png"), { filename: "proof.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith("run-active");
    expect(mockHeartbeatService.cancelRun).toHaveBeenCalledWith("run-active");
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "heartbeat.cancelled",
        entityType: "heartbeat_run",
        entityId: "run-active",
        details: expect.objectContaining({
          agentId: assigneeAgentId,
          source: "issue_comment_interrupt",
          issueId,
        }),
      }),
    );
    await vi.waitFor(() => expect(mockHeartbeatService.wakeup).toHaveBeenCalledTimes(1));
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      assigneeAgentId,
      expect.objectContaining({
        reason: "issue_commented",
        payload: expect.objectContaining({
          issueId,
          commentId: "comment-1",
          interruptedRunId: "run-active",
          attachmentCount: 1,
        }),
        contextSnapshot: expect.objectContaining({
          issueId,
          taskId: issueId,
          wakeCommentId: "comment-1",
          interruptedRunId: "run-active",
          attachmentCount: 1,
        }),
      }),
    );
  });

  it("rejects interrupt=true for non-board attachment comments before creating comments or attachments", async () => {
    const res = await request(createApp({
      type: "agent",
      agentId: assigneeAgentId,
      companyId,
      runId: "agent-run-1",
    }))
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "Try to interrupt with evidence")
      .field("interrupt", "true")
      .attach("files", Buffer.from("fake-png"), { filename: "proof.png", contentType: "image/png" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "Only board users can interrupt active runs from issue comments",
    });
    expect(mockIssueService.addComment).not.toHaveBeenCalled();
    expect(mockIssueService.createAttachment).not.toHaveBeenCalled();
    expect(mockHeartbeatService.cancelRun).not.toHaveBeenCalled();
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("accepts common context document attachments, not only images", async () => {
    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "Use this repro log")
      .attach("files", Buffer.from("steps: reproduce"), { filename: "repro.md", contentType: "text/markdown" });

    expect(res.status).toBe(201);
    expect(mockIssueService.createAttachment).toHaveBeenCalledWith(expect.objectContaining({
      originalFilename: "repro.md",
      contentType: "text/markdown",
    }));
  });

  it("does not wake the assigned agent for planning-mode comments with attachments", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({ workMode: "planning" }));

    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "Here is context for planning")
      .attach("files", Buffer.from("fake-png"), { filename: "context.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("still wakes explicitly mentioned agents in planning mode", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({ workMode: "planning" }));
    mockIssueService.findMentionedAgents.mockResolvedValue([mentionedAgentId]);

    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "@Beta please inspect this")
      .attach("files", Buffer.from("fake-png"), { filename: "context.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(mockHeartbeatService.wakeup).toHaveBeenCalledTimes(1));
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      mentionedAgentId,
      expect.objectContaining({
        reason: "issue_comment_mentioned",
        payload: expect.objectContaining({
          issueId,
          commentId: "comment-1",
          attachmentCount: 1,
        }),
      }),
    );
  });

  it("rejects unsupported files without creating a comment or waking", async () => {
    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "Please inspect")
      .attach("files", Buffer.from("echo hi"), { filename: "run.sh", contentType: "application/x-sh" });

    expect(res.status).toBe(422);
    expect(mockIssueService.addComment).not.toHaveBeenCalled();
    expect(mockIssueService.createAttachment).not.toHaveBeenCalled();
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });
});

describe("POST /issues/:id/comments (no attachments) — D8 reopen gate", () => {
  // A-M11: the plain comment route funnels through the SAME shared
  // enqueueIssueCommentWakeups helper as the attachments route, so the D8
  // planning-mode gate on reopen must cover this path too.
  it("does NOT wake on reopen-via-comment when the task is in planning mode", async () => {
    const closedPlanningIssue = makeIssue({ status: "done", workMode: "planning" });
    const reopenedPlanningIssue = makeIssue({ status: "todo", workMode: "planning" });
    mockIssueService.getById.mockResolvedValue(closedPlanningIssue);
    mockIssueService.update.mockResolvedValue(reopenedPlanningIssue);

    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments`)
      .send({ body: "Reopen this planning task", reopen: true });

    expect(res.status).toBe(201);
    expect(mockIssueService.update).toHaveBeenCalledWith(issueId, { status: "todo" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    expect(mockIssueService.enqueueAoaMentionWakeup).not.toHaveBeenCalled();
  });

  it("DOES wake on reopen-via-comment for a standard task (regression)", async () => {
    const closedIssue = makeIssue({ status: "done", workMode: "standard" });
    const reopenedIssue = makeIssue({ status: "todo", workMode: "standard" });
    mockIssueService.getById.mockResolvedValue(closedIssue);
    mockIssueService.update.mockResolvedValue(reopenedIssue);

    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments`)
      .send({ body: "Reopen this standard task", reopen: true });

    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(mockHeartbeatService.wakeup).toHaveBeenCalledTimes(1));
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith(
      assigneeAgentId,
      expect.objectContaining({
        reason: "issue_reopened_via_comment",
        payload: expect.objectContaining({ issueId, reopenedFrom: "done" }),
      }),
    );
  });
});

describe("POST /companies/:companyId/issues agent delegation", () => {
  function agentActor(agentId = leadAgentId) {
    return {
      type: "agent",
      agentId,
      companyId,
      runId: "run-1",
    };
  }

  it("lets a lead create and assign a child task to a direct report", async () => {
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockIssueService.getById.mockImplementation(async (id: string) =>
      id === parentIssueId ? makeIssue({ id: parentIssueId }) : makeIssue({ id }),
    );

    const res = await request(createApp(agentActor()))
      .post(`/api/companies/${companyId}/issues`)
      .send({
        title: "Child task",
        status: "todo",
        parentId: parentIssueId,
        assigneeAgentId,
      });

    expect(res.status).toBe(201);
    expect(mockIssueService.create).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({
        title: "Child task",
        parentId: parentIssueId,
        assigneeAgentId,
        createdByAgentId: leadAgentId,
      }),
    );
    await vi.waitFor(() => expect(mockEnqueueAssignee).toHaveBeenCalledTimes(1));
    expect(mockEnqueueAssignee).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentId: assigneeAgentId, issueId: "new-issue", reason: "issue_assigned", source: "assignment" }),
    );
  });

  it("blocks a lead assigning a child task outside direct reports", async () => {
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockIssueService.getById.mockResolvedValue(makeIssue({ id: parentIssueId }));

    const res = await request(createApp(agentActor()))
      .post(`/api/companies/${companyId}/issues`)
      .send({
        title: "Out of scope child task",
        status: "todo",
        parentId: parentIssueId,
        assigneeAgentId: mentionedAgentId,
      });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "Cannot assign target agent",
      reason: "target_not_direct_report",
      allowedActions: ["create_unassigned", "assign_to_self", "request_routing_from_lead"],
    });
    expect(mockIssueService.create).not.toHaveBeenCalled();
    expect(mockEnqueueAssignee).not.toHaveBeenCalled();
  });

  it("queues assignment to a paused direct report without waking it", async () => {
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockIssueService.getById.mockResolvedValue(makeIssue({ id: parentIssueId }));
    mockAgentService.getById.mockImplementation(async (id: string) => {
      if (id === leadAgentId) {
        return { id: leadAgentId, companyId, role: "lead", status: "idle", reportsTo: null, permissions: {} };
      }
      if (id === assigneeAgentId) {
        return { id: assigneeAgentId, companyId, role: "general", status: "paused", reportsTo: leadAgentId, permissions: {} };
      }
      return null;
    });

    const res = await request(createApp(agentActor()))
      .post(`/api/companies/${companyId}/issues`)
      .send({
        title: "Paused child task",
        status: "todo",
        parentId: parentIssueId,
        assigneeAgentId,
      });

    expect(res.status).toBe(201);
    expect(res.body.wakeSkippedReason).toBe("assignee_paused");
    expect(mockIssueService.create).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockEnqueueAssignee).not.toHaveBeenCalled();
  });

  it("ensures project workspace before waking an assigned agent", async () => {
    const projectId = "99999999-9999-4999-8999-999999999999";
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockIssueService.getById.mockResolvedValue(makeIssue({ id: parentIssueId }));

    const res = await request(createApp(agentActor()))
      .post(`/api/companies/${companyId}/issues`)
      .send({
        title: "Workspace child task",
        status: "todo",
        projectId,
        parentId: parentIssueId,
        assigneeAgentId,
      });

    expect(res.status).toBe(201);
    expect(mockCreateEagerWorkspaceForIssue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId,
        issueId: "new-issue",
        issueIdentifier: "ARM-2",
        issueTitle: "Workspace child task",
        projectId,
      }),
    );
    await vi.waitFor(() => expect(mockEnqueueAssignee).toHaveBeenCalledTimes(1));
    expect(mockCreateEagerWorkspaceForIssue.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnqueueAssignee.mock.invocationCallOrder[0],
    );
  });

  it("does not wake assigned agent when workspace ensure fails", async () => {
    const projectId = "99999999-9999-4999-8999-999999999999";
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockIssueService.getById.mockResolvedValue(makeIssue({ id: parentIssueId }));
    mockCreateEagerWorkspaceForIssue.mockRejectedValueOnce(new Error("worktree exists"));

    const res = await request(createApp(agentActor()))
      .post(`/api/companies/${companyId}/issues`)
      .send({
        title: "Workspace failed child task",
        status: "todo",
        projectId,
        parentId: parentIssueId,
        assigneeAgentId,
      });

    expect(res.status).toBe(201);
    expect(res.body.wakeSkippedReason).toBe("workspace_setup_failed");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockEnqueueAssignee).not.toHaveBeenCalled();
  });
});
