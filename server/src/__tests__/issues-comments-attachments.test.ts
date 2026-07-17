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

// A real PNG magic-byte header so the round-3 byte-sniff guard accepts these
// image/png uploads (the endpoint no longer trusts the multipart mimetype).
const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

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
  completeMissingCommentAttachments: vi.fn(),
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
  getCommentByClientSubmissionId: vi.fn(),
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
  // Default: no prior submission with this key → the create path runs.
  mockIssueService.getCommentByClientSubmissionId.mockResolvedValue(null);
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
  // Replay-completion (C6) delegates to the serialized service method. Default:
  // nothing missing → create nothing, no attachments. Tests that exercise the
  // replay-completion path override this per scenario.
  mockIssueService.completeMissingCommentAttachments.mockResolvedValue({ created: [], all: [] });
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
      .attach("files", validPng, { filename: "proof.png", contentType: "image/png" });

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
      .attach("files", validPng, { filename: "proof.png", contentType: "image/png" });

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
      .attach("files", validPng, { filename: "proof.png", contentType: "image/png" });

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
      .attach("files", validPng, { filename: "proof.png", contentType: "image/png" });

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
      .attach("files", validPng, { filename: "proof.png", contentType: "image/png" });

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
      .attach("files", validPng, { filename: "proof.png", contentType: "image/png" });

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
      .attach("files", validPng, { filename: "context.png", contentType: "image/png" });

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
      .attach("files", validPng, { filename: "context.png", contentType: "image/png" });

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

  it("rejects a comment attachment whose bytes do not match the declared type (round-3 #5)", async () => {
    // The endpoint must sniff the real bytes, not trust the multipart mimetype:
    // arbitrary content labeled as an allowed image is rejected before any
    // comment or attachment is created.
    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "Spoofed screenshot")
      .attach("files", Buffer.from("this is not a real png"), { filename: "evil.png", contentType: "image/png" });

    expect(res.status).toBe(422);
    expect(mockIssueService.addComment).not.toHaveBeenCalled();
    expect(mockIssueService.createAttachment).not.toHaveBeenCalled();
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("skips re-storing attachments and re-waking when addComment loses the insert race (round-3 #4)", async () => {
    // Two same-key requests both pass the route-level replay pre-check (neither
    // committed yet). The loser's insert is swallowed; addComment returns the
    // winner's row flagged `replayed`. The loser must NOT re-store files or
    // re-fire wakeups — it completes through the serialized (advisory-locked)
    // path, which finds nothing missing.
    const submissionId = "sub-race-loser";
    const winner = {
      id: "comment-1",
      issueId,
      companyId,
      body: "Please inspect these screenshots",
      authorAgentId: null,
      authorUserId: "board-user",
      clientSubmissionId: submissionId,
    };
    mockIssueService.getCommentByClientSubmissionId.mockResolvedValue(null); // pre-check missed it
    mockIssueService.addComment.mockResolvedValue({ ...winner, replayed: true });
    const winnerAttachment = {
      id: "attachment-1", issueId, issueCommentId: "comment-1", originalFilename: "proof.png", contentType: "image/png",
    };
    mockIssueService.listAttachments.mockResolvedValue([winnerAttachment]);
    mockIssueService.completeMissingCommentAttachments.mockResolvedValue({
      created: [],
      all: [winnerAttachment],
    });

    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments-with-attachments`)
      .field("body", "Please inspect these screenshots")
      .field("clientSubmissionId", submissionId)
      .attach("files", validPng, { filename: "proof.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.comment.id).toBe("comment-1");
    // No direct re-store, no re-wake; only the serialized completion runs.
    expect(mockIssueService.createAttachment).not.toHaveBeenCalled();
    expect(mockIssueService.completeMissingCommentAttachments).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("replays the original comment+attachments and does not re-persist or re-wake on a retried key", async () => {
    const submissionId = "sub-att-1";
    const existing = {
      id: "comment-1",
      issueId,
      companyId,
      body: "Please inspect these screenshots",
      authorAgentId: null,
      authorUserId: "board-user",
      clientSubmissionId: submissionId,
    };
    mockIssueService.getCommentByClientSubmissionId
      .mockResolvedValueOnce(null) // first send creates
      .mockResolvedValueOnce(existing); // retry replays
    const existingAttachment = {
      id: "attachment-1", issueId, issueCommentId: "comment-1", originalFilename: "proof.png", contentType: "image/png",
    };
    mockIssueService.listAttachments.mockResolvedValue([existingAttachment]);
    // Nothing is missing on the retry → the serialized completion creates nothing
    // and returns the existing attachment.
    mockIssueService.completeMissingCommentAttachments.mockResolvedValue({
      created: [],
      all: [existingAttachment],
    });

    const app = createApp();
    const send = () =>
      request(app)
        .post(`/api/issues/${issueId}/comments-with-attachments`)
        .field("body", "Please inspect these screenshots")
        .field("clientSubmissionId", submissionId)
        .attach("files", validPng, { filename: "proof.png", contentType: "image/png" });

    const first = await send();
    const retry = await send();

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.comment.id).toBe("comment-1");
    expect(retry.body.attachments).toHaveLength(1);

    // The retry must not persist a second comment, and the completion is
    // serialized through the dedicated service method (advisory-locked).
    expect(mockIssueService.addComment).toHaveBeenCalledTimes(1);
    expect(mockIssueService.completeMissingCommentAttachments).toHaveBeenCalledTimes(1);
    // First send used createAttachment once (create path); the retry does NOT
    // touch createAttachment directly (it goes through the serialized method).
    expect(mockIssueService.createAttachment).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledTimes(1);
  });

  it("completes missing attachments on a retried key after a partial failure (PR #291: no silent drop)", async () => {
    // The comment commits BEFORE the files are stored. If attachment
    // persistence dies after that point, the client's idempotent retry finds
    // the comment via the replay check — it must then store + record the
    // files the original send lost, not report success with a partial set. The
    // completion runs through the serialized (advisory-locked) service method.
    const submissionId = "sub-att-2";
    const existing = {
      id: "comment-1",
      issueId,
      companyId,
      body: "Please inspect these screenshots",
      authorAgentId: null,
      authorUserId: "board-user",
      clientSubmissionId: submissionId,
    };
    mockIssueService.getCommentByClientSubmissionId
      .mockResolvedValueOnce(null) // first send creates…
      .mockResolvedValueOnce(existing); // …retry replays
    // First send: the attachment row insert dies after the comment committed.
    mockIssueService.createAttachment.mockRejectedValueOnce(new Error("db blip"));
    // Nothing landed for this comment; the retry's serialized completion stores
    // + records the missing file.
    mockIssueService.listAttachments.mockResolvedValue([]);
    const completedAttachment = {
      id: "attachment-2", issueId, issueCommentId: "comment-1", originalFilename: "proof.png", contentType: "image/png",
    };
    mockIssueService.completeMissingCommentAttachments.mockResolvedValue({
      created: [completedAttachment],
      all: [completedAttachment],
    });

    const app = createApp();
    const send = () =>
      request(app)
        .post(`/api/issues/${issueId}/comments-with-attachments`)
        .field("body", "Please inspect these screenshots")
        .field("clientSubmissionId", submissionId)
        .attach("files", validPng, { filename: "proof.png", contentType: "image/png" });

    const first = await send();
    expect(first.status).toBe(500); // partial failure surfaced, retry offered

    const retry = await send();
    expect(retry.status).toBe(200);
    expect(retry.body.comment.id).toBe("comment-1");
    // The retry completed the missing attachment against the replayed comment.
    expect(retry.body.attachments).toHaveLength(1);
    expect(retry.body.attachments[0]).toMatchObject({
      issueCommentId: "comment-1",
      originalFilename: "proof.png",
    });
    // The retry delegated completion to the serialized method with the file.
    expect(mockIssueService.completeMissingCommentAttachments).toHaveBeenCalledTimes(1);
    expect(mockIssueService.completeMissingCommentAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId,
        commentId: "comment-1",
        files: expect.arrayContaining([
          expect.objectContaining({ originalFilename: "proof.png", contentType: "image/png" }),
        ]),
      }),
    );
    // An activity row is logged for the completed-on-retry attachment.
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.attachment_added",
        details: expect.objectContaining({ completedOnRetry: true, commentId: "comment-1" }),
      }),
    );
    // Still exactly one durable comment.
    expect(mockIssueService.addComment).toHaveBeenCalledTimes(1);
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

describe("POST /issues/:id/comments — idempotent retry (clientSubmissionId)", () => {
  // A retried Send (same clientSubmissionId, e.g. after a lost 201 response)
  // must not create a second durable comment and must not re-fire task
  // side-effects (wakeup/interrupt). The whole handler is gated, not just the
  // row insert — otherwise a retry could re-interrupt a run while the row dedups.
  const submissionId = "sub-1111-2222";
  const existingComment = {
    id: "comment-1",
    issueId,
    companyId,
    body: "Please inspect the logs",
    authorAgentId: null,
    authorUserId: "board-user",
    clientSubmissionId: submissionId,
  };

  it("replays the same comment (200) and wakes at most once on a retried key", async () => {
    mockIssueService.getCommentByClientSubmissionId
      .mockResolvedValueOnce(null) // first attempt: not seen yet → create
      .mockResolvedValueOnce(existingComment); // retry: key already recorded → replay
    mockIssueService.addComment.mockResolvedValue(existingComment);

    const app = createApp();
    const first = await request(app)
      .post(`/api/issues/${issueId}/comments`)
      .send({ body: "Please inspect the logs", clientSubmissionId: submissionId });
    const retry = await request(app)
      .post(`/api/issues/${issueId}/comments`)
      .send({ body: "Please inspect the logs", clientSubmissionId: submissionId });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200); // replay is a read, not a new creation
    expect(retry.body.id).toBe("comment-1");

    expect(mockIssueService.addComment).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledTimes(1);
  });

  it("returns the winner's comment without re-firing wakeups when addComment loses the insert race (round-3 #4)", async () => {
    // Both same-key requests pass the pre-check; the loser's insert is swallowed
    // and addComment returns the winner's row flagged `replayed`. The route must
    // return it (200) without re-logging activity or re-firing wakeups.
    mockIssueService.getCommentByClientSubmissionId.mockResolvedValue(null);
    mockIssueService.addComment.mockResolvedValue({ ...existingComment, replayed: true });

    const res = await request(createApp())
      .post(`/api/issues/${issueId}/comments`)
      .send({ body: "Please inspect the logs", clientSubmissionId: submissionId });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("comment-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
  });

  it("passes the clientSubmissionId through to addComment on the create path", async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/api/issues/${issueId}/comments`)
      .send({ body: "First send", clientSubmissionId: submissionId });

    expect(res.status).toBe(201);
    expect(mockIssueService.addComment).toHaveBeenCalledWith(
      issueId,
      "First send",
      expect.objectContaining({ clientSubmissionId: submissionId }),
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

  it("rejects non-empty agent-authored acceptance criteria", async () => {
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockIssueService.getById.mockResolvedValue(makeIssue({ id: parentIssueId }));

    const res = await request(createApp(agentActor()))
      .post(`/api/companies/${companyId}/issues`)
      .send({
        title: "Child task with self-authored criteria",
        status: "todo",
        parentId: parentIssueId,
        assigneeAgentId,
        acceptanceCriteria: ["Agent decides when the work is complete"],
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Agents cannot define their own task acceptance criteria");
    expect(mockIssueService.create).not.toHaveBeenCalled();
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
