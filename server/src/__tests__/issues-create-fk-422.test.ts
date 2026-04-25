/**
 * Contract test: POST /companies/:cid/issues — typed 422 response shape.
 *
 * The UI's ApiError.fieldError accessor reads:
 *   body.details.field  — which field was invalid
 *   body.details.id     — the offending id value
 *
 * This test pins that wire shape so any server-side refactor that silently
 * changes the response body (e.g. flattening details, renaming keys) is
 * caught before the UI degrades to a generic toast.
 *
 * Exhaustive FK coverage lives in issues-routes-create-fk-validation.test.ts.
 * This file only checks the minimum contract the UI reads.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

// ── fixture ids ──────────────────────────────────────────────────────────────
const companyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agentId   = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const projectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// ── service stubs ─────────────────────────────────────────────────────────────
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

const mockAgentService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockProjectService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockGoalService = vi.hoisted(() => ({ getById: vi.fn() }));
const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));
const mockHeartbeatService = vi.hoisted(() => ({ wakeup: vi.fn() }));
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
const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService:        () => mockAccessService,
  agentService:         () => mockAgentService,
  goalService:          () => mockGoalService,
  heartbeatService:     () => mockHeartbeatService,
  issueApprovalService: () => mockIssueApprovalService,
  issueService:         () => mockIssueService,
  logActivity:          mockLogActivity,
  projectService:       () => mockProjectService,
  routineService:       () => mockRoutineService,
}));

vi.mock("../services/documents.js", () => ({
  documentService: () => mockDocumentService,
}));

const { issueRoutes } = await import("../routes/issues.js");

// ── helpers ───────────────────────────────────────────────────────────────────
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

const validAgent   = { id: agentId,   companyId, status: "idle" };
const validProject = { id: projectId, companyId, type: "project" as const };
const createdIssue = {
  id: "issue-1",
  identifier: "AOA-1",
  companyId,
  title: "Test",
  status: "todo",
  assigneeAgentId: null,
  projectId: null,
  goalId: null,
  parentId: null,
  labels: [],
  labelIds: [],
};

// ── tests ─────────────────────────────────────────────────────────────────────
describe("POST /companies/:cid/issues — typed 422 contract (ApiError.fieldError shape)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockAgentService.getById.mockResolvedValue(validAgent);
    mockProjectService.getById.mockResolvedValue(validProject);
    mockGoalService.getById.mockResolvedValue(null); // not used in happy path
    mockIssueService.getById.mockResolvedValue(null); // not used in happy path
    mockIssueService.create.mockResolvedValue(createdIssue);
    mockLogActivity.mockResolvedValue(undefined);
  });

  // ── contract: assigneeAgentId ─────────────────────────────────────────────
  it("stale assigneeAgentId → 422 with { error, details: { field, id } }", async () => {
    mockAgentService.getById.mockResolvedValue(null);

    const res = await request(createApp())
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "T", assigneeAgentId: agentId });

    expect(res.status).toBe(422);

    // Top-level shape the error handler always emits:
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");

    // details.field / details.id — the keys ApiError.fieldError reads:
    expect(res.body.details).toEqual({ field: "assigneeAgentId", id: agentId });
  });

  // ── contract: projectId ───────────────────────────────────────────────────
  it("stale projectId → 422 with { error, details: { field, id } }", async () => {
    mockProjectService.getById.mockResolvedValue(null);

    const res = await request(createApp())
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "T", projectId });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
    expect(res.body.details).toEqual({ field: "projectId", id: projectId });
  });

  // ── contract: happy path returns 201 ─────────────────────────────────────
  it("valid refs → 201 and no FK rejection", async () => {
    const res = await request(createApp())
      .post(`/api/companies/${companyId}/issues`)
      .send({ title: "T", assigneeAgentId: agentId, projectId });

    expect(res.status).toBe(201);
    expect(mockIssueService.create).toHaveBeenCalledOnce();
    // No details field on a success response
    expect(res.body).not.toHaveProperty("details");
  });
});
