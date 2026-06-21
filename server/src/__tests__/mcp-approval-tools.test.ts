import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@armyofagents/db", () => {
  const makeTable = () =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "$inferSelect" || prop === "$inferInsert") return {};
          return Symbol(String(prop));
        },
      },
    );

  return {
    issues: makeTable(),
    userRoles: makeTable(),
    projectGoals: makeTable(),
    agentProjects: makeTable(),
    approvals: makeTable(),
    issueApprovals: makeTable(),
    approvalComments: makeTable(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  eq: (..._args: unknown[]) => "eq",
  inArray: (..._args: unknown[]) => "inArray",
  desc: (..._args: unknown[]) => "desc",
  asc: (..._args: unknown[]) => "asc",
}));

vi.mock("../services/index.js", () => {
  const noopFactory = () => ({});
  return {
    agentService: noopFactory,
    approvalService: noopFactory,
    artifactService: noopFactory,
    companyService: noopFactory,
    debriefService: noopFactory,
    extractionService: noopFactory,
    goalService: noopFactory,
    issueApprovalService: noopFactory,
    issueService: noopFactory,
    memoryService: noopFactory,
    mcpService: noopFactory,
    permissionService: noopFactory,
    projectService: noopFactory,
    logActivity: vi.fn().mockResolvedValue(undefined),
  };
});

import { mcpServerRoutes } from "../mcp/server.js";

const UUID_APPROVAL = "aaaaaaaa-0000-0000-0000-000000000001";
const UUID_APPROVAL_2 = "aaaaaaaa-0000-0000-0000-000000000002";
const UUID_APPROVAL_OTHER = "bbbbbbbb-0000-0000-0000-000000000099";
const UUID_TASK_MINE = "cccccccc-0000-0000-0000-000000000001";
const UUID_TASK_OTHER = "cccccccc-0000-0000-0000-000000000002";
const UUID_TASK_CROSS = "cccccccc-0000-0000-0000-000000000003";
const UUID_PROJECT_MINE = "dddddddd-0000-0000-0000-000000000001";
const UUID_PROJECT_OTHER = "dddddddd-0000-0000-0000-000000000002";

type Approval = {
  id: string;
  companyId: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
};

type Task = {
  id: string;
  companyId: string;
  projectId: string | null;
};

function buildApp(options?: {
  role?: "founder" | "team_lead" | "team_member";
  projectIds?: string[];
  approvals?: Approval[];
  tasks?: Task[];
  linksByApproval?: Record<string, Task[]>;
  linksByIssue?: Record<string, Approval[]>;
}) {
  const role = options?.role ?? "founder";
  const projectIds = new Set(options?.projectIds ?? []);
  const approvalList = options?.approvals ?? [];
  const taskList = options?.tasks ?? [];
  const linksByApproval = options?.linksByApproval ?? {};
  const linksByIssue = options?.linksByIssue ?? {};

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "mcp",
      source: "mcp_key",
      userId: "user-1",
      companyId: "company-1",
      keyId: "key-1",
    };
    next();
  });

  const approveFn = vi.fn().mockImplementation(async (id: string, _companyId: string, userId: string, note?: string | null) => {
    const existing = approvalList.find((a) => a.id === id);
    return { ...(existing ?? { id }), status: "approved", decidedByUserId: userId, decisionNote: note };
  });
  const rejectFn = vi.fn().mockImplementation(async (id: string, _companyId: string, userId: string, note?: string | null) => {
    const existing = approvalList.find((a) => a.id === id);
    return { ...(existing ?? { id }), status: "rejected", decidedByUserId: userId, decisionNote: note };
  });
  const requestRevisionFn = vi.fn().mockImplementation(async (id: string, _companyId: string, userId: string, note?: string | null) => {
    const existing = approvalList.find((a) => a.id === id);
    return { ...(existing ?? { id }), status: "revision_requested", decidedByUserId: userId, decisionNote: note };
  });
  const resubmitFn = vi.fn().mockImplementation(async (id: string, payload?: Record<string, unknown>) => {
    const existing = approvalList.find((a) => a.id === id);
    return { ...(existing ?? { id }), status: "pending", payload: payload ?? existing?.payload ?? {} };
  });
  const createFn = vi.fn().mockImplementation(async (companyId: string, data: any) => ({
    id: "approval-new",
    companyId,
    type: data.type,
    status: data.status ?? "pending",
    payload: data.payload,
    requestedByUserId: data.requestedByUserId,
    requestedByAgentId: data.requestedByAgentId,
  }));
  const addCommentFn = vi.fn().mockImplementation(async (approvalId: string, body: string, actor: any) => ({
    id: "comment-new",
    approvalId,
    body,
    authorUserId: actor.userId ?? null,
    authorAgentId: actor.agentId ?? null,
  }));
  const listCommentsFn = vi.fn().mockResolvedValue([]);
  const listFn = vi.fn().mockImplementation(async (companyId: string, status?: string) =>
    approvalList.filter((a) => a.companyId === companyId && (!status || a.status === status)),
  );
  const getByIdFn = vi.fn().mockImplementation(async (id: string) =>
    approvalList.find((a) => a.id === id) ?? null,
  );

  const approvalsSvc = {
    list: listFn,
    getById: getByIdFn,
    create: createFn,
    approve: approveFn,
    reject: rejectFn,
    requestRevision: requestRevisionFn,
    resubmit: resubmitFn,
    listComments: listCommentsFn,
    addComment: addCommentFn,
  };

  const linkFn = vi.fn().mockImplementation(async (taskId: string, approvalId: string) => ({
    issueId: taskId,
    approvalId,
  }));
  const unlinkFn = vi.fn().mockResolvedValue(undefined);
  const linkManyFn = vi.fn().mockResolvedValue(undefined);
  const listApprovalsForIssueFn = vi
    .fn()
    .mockImplementation(async (issueId: string) => linksByIssue[issueId] ?? []);
  const listIssuesForApprovalFn = vi
    .fn()
    .mockImplementation(async (approvalId: string) => linksByApproval[approvalId] ?? []);

  const issueApprovalsSvc = {
    link: linkFn,
    unlink: unlinkFn,
    linkManyForApproval: linkManyFn,
    listApprovalsForIssue: listApprovalsForIssueFn,
    listIssuesForApproval: listIssuesForApprovalFn,
  };

  app.use(
    "/api",
    mcpServerRoutes({} as any, {
      companiesSvc: {
        getById: vi.fn().mockResolvedValue({ id: "company-1", mcpEnabled: true }),
        update: vi.fn(),
      } as any,
      mcpSvc: {
        touchClient: vi.fn().mockResolvedValue(null),
        getStatus: vi.fn(),
        listKeys: vi.fn(),
        createKey: vi.fn(),
        requireOwnedKey: vi.fn(),
        revokeKey: vi.fn(),
        listClients: vi.fn(),
      } as any,
      resolveScope: async (_c, actor) =>
        role === "founder"
          ? { kind: "founder", userId: actor.userId }
          : { kind: "scoped", userId: actor.userId, projectIds },
      resolveRole: async () => role,
      resolveScopedAgentIds: async () => null,
      issuesSvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi
          .fn()
          .mockImplementation(async (id: string) => taskList.find((t) => t.id === id) ?? null),
        create: vi.fn(),
        update: vi.fn(),
        addComment: vi.fn(),
        listComments: vi.fn().mockResolvedValue([]),
        getComment: vi.fn().mockResolvedValue(null),
      } as any,
      goalsSvc: { list: vi.fn().mockResolvedValue([]), getById: vi.fn().mockResolvedValue(null) } as any,
      memorySvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      } as any,
      artifactsSvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        addVersion: vi.fn(),
      } as any,
      debriefsSvc: { create: vi.fn() } as any,
      extractionSvc: { extractFromDebrief: vi.fn() } as any,
      permissionsSvc: {
        canAccessEntity: vi.fn().mockResolvedValue(true),
        canAccessMemory: vi.fn().mockResolvedValue(true),
      } as any,
      agentsSvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
      } as any,
      projectsSvc: {
        list: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
      } as any,
      approvalsSvc: approvalsSvc as any,
      issueApprovalsSvc: issueApprovalsSvc as any,
    }),
  );

  return { app, approvalsSvc, issueApprovalsSvc };
}

async function callTool(
  app: express.Express,
  name: string,
  args: Record<string, unknown> = {},
) {
  return request(app)
    .post("/api/companies/company-1/mcp")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
}

describe("MCP approval tools", () => {
  describe("tools/list exposes all 10 approval tools", () => {
    it("lists every approval tool name", async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post("/api/companies/company-1/mcp")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
      expect(res.status).toBe(200);
      const names = res.body.result.tools.map((t: any) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "list-approvals",
          "get-approval",
          "get-approval-tasks",
          "list-approval-comments",
          "list-task-approvals",
          "create-approval",
          "approval-decision",
          "add-approval-comment",
          "link-task-approval",
          "unlink-task-approval",
        ]),
      );
    });
  });

  describe("list-approvals", () => {
    it("founder sees all approvals in their company", async () => {
      const { app } = buildApp({
        approvals: [
          { id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} },
          { id: UUID_APPROVAL_2, companyId: "company-1", type: "budget_override_required", status: "approved", payload: {} },
        ],
      });
      const res = await callTool(app, "list-approvals");
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(2);
    });

    it("filters by status", async () => {
      const { app } = buildApp({
        approvals: [
          { id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} },
          { id: UUID_APPROVAL_2, companyId: "company-1", type: "hire_agent", status: "approved", payload: {} },
        ],
      });
      const res = await callTool(app, "list-approvals", { status: "pending" });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(1);
      expect(payload[0].status).toBe("pending");
    });

    it("filters by type", async () => {
      const { app } = buildApp({
        approvals: [
          { id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} },
          { id: UUID_APPROVAL_2, companyId: "company-1", type: "budget_override_required", status: "pending", payload: {} },
        ],
      });
      const res = await callTool(app, "list-approvals", { type: "hire_agent" });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(1);
      expect(payload[0].type).toBe("hire_agent");
    });

    it("scoped user sees only approvals linked to tasks in their projects", async () => {
      const linkedTaskMine: Task = { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE };
      const linkedTaskOther: Task = { id: UUID_TASK_OTHER, companyId: "company-1", projectId: UUID_PROJECT_OTHER };
      const { app } = buildApp({
        role: "team_lead",
        projectIds: [UUID_PROJECT_MINE],
        approvals: [
          { id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} },
          { id: UUID_APPROVAL_2, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} },
        ],
        linksByApproval: {
          [UUID_APPROVAL]: [linkedTaskMine],
          [UUID_APPROVAL_2]: [linkedTaskOther],
        },
      });
      const res = await callTool(app, "list-approvals");
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(1);
      expect(payload[0].id).toBe(UUID_APPROVAL);
    });
  });

  describe("get-approval", () => {
    it("founder can get any approval in their company", async () => {
      const { app } = buildApp({
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "get-approval", { approvalId: UUID_APPROVAL });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload.id).toBe(UUID_APPROVAL);
    });

    it("returns 404 for cross-company approval", async () => {
      const { app } = buildApp({
        approvals: [{ id: UUID_APPROVAL_OTHER, companyId: "other-company", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "get-approval", { approvalId: UUID_APPROVAL_OTHER });
      expect(res.status).toBe(404);
    });

    it("scoped user gets 404 for approval with no linked task in their scope", async () => {
      const taskOther: Task = { id: UUID_TASK_OTHER, companyId: "company-1", projectId: UUID_PROJECT_OTHER };
      const { app } = buildApp({
        role: "team_member",
        projectIds: [UUID_PROJECT_MINE],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
        linksByApproval: { [UUID_APPROVAL]: [taskOther] },
      });
      const res = await callTool(app, "get-approval", { approvalId: UUID_APPROVAL });
      expect(res.status).toBe(404);
    });
  });

  describe("get-approval-tasks", () => {
    it("founder sees all linked tasks", async () => {
      const tasks: Task[] = [
        { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE },
        { id: UUID_TASK_OTHER, companyId: "company-1", projectId: UUID_PROJECT_OTHER },
      ];
      const { app } = buildApp({
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
        linksByApproval: { [UUID_APPROVAL]: tasks },
      });
      const res = await callTool(app, "get-approval-tasks", { approvalId: UUID_APPROVAL });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(2);
    });

    it("scoped user sees only tasks in their scope", async () => {
      const tasks: Task[] = [
        { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE },
        { id: UUID_TASK_OTHER, companyId: "company-1", projectId: UUID_PROJECT_OTHER },
      ];
      const { app } = buildApp({
        role: "team_lead",
        projectIds: [UUID_PROJECT_MINE],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
        linksByApproval: { [UUID_APPROVAL]: tasks },
      });
      const res = await callTool(app, "get-approval-tasks", { approvalId: UUID_APPROVAL });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(1);
      expect(payload[0].id).toBe(UUID_TASK_MINE);
    });
  });

  describe("list-approval-comments", () => {
    it("founder gets comments", async () => {
      const { app, approvalsSvc } = buildApp({
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      (approvalsSvc.listComments as any).mockResolvedValue([{ id: "c-1", body: "hi" }]);
      const res = await callTool(app, "list-approval-comments", { approvalId: UUID_APPROVAL });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toEqual([{ id: "c-1", body: "hi" }]);
    });

    it("returns 404 for cross-company approval", async () => {
      const { app } = buildApp({
        approvals: [{ id: UUID_APPROVAL_OTHER, companyId: "other-company", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "list-approval-comments", { approvalId: UUID_APPROVAL_OTHER });
      expect(res.status).toBe(404);
    });
  });

  describe("list-task-approvals", () => {
    it("returns approvals linked to a task when caller can access the task", async () => {
      const task: Task = { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE };
      const approval: Approval = { id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} };
      const { app } = buildApp({
        tasks: [task],
        approvals: [approval],
        linksByIssue: { [UUID_TASK_MINE]: [approval] },
      });
      const res = await callTool(app, "list-task-approvals", { taskId: UUID_TASK_MINE });
      expect(res.status).toBe(200);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload).toHaveLength(1);
      expect(payload[0].id).toBe(UUID_APPROVAL);
    });

    it("returns 404 when task is in another company", async () => {
      const task: Task = { id: UUID_TASK_CROSS, companyId: "other-company", projectId: null };
      const { app } = buildApp({ tasks: [task] });
      const res = await callTool(app, "list-task-approvals", { taskId: UUID_TASK_CROSS });
      expect(res.status).toBe(404);
    });

    it("scoped user gets 404 for task outside scope", async () => {
      const task: Task = { id: UUID_TASK_OTHER, companyId: "company-1", projectId: UUID_PROJECT_OTHER };
      const { app } = buildApp({
        role: "team_member",
        projectIds: [UUID_PROJECT_MINE],
        tasks: [task],
      });
      const res = await callTool(app, "list-task-approvals", { taskId: UUID_TASK_OTHER });
      expect(res.status).toBe(404);
    });
  });

  describe("create-approval", () => {
    it("founder creates unscoped approval", async () => {
      const { app, approvalsSvc } = buildApp();
      const res = await callTool(app, "create-approval", {
        type: "hire_agent",
        payload: { name: "A" },
      });
      expect(res.status).toBe(200);
      expect(approvalsSvc.create).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(res.body.result.content[0].text);
      expect(payload.id).toBe("approval-new");
    });

    it("founder creates approval with linked issues + links them", async () => {
      const task: Task = { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE };
      const { app, issueApprovalsSvc } = buildApp({ tasks: [task] });
      const res = await callTool(app, "create-approval", {
        type: "hire_agent",
        payload: { name: "A" },
        issueIds: [UUID_TASK_MINE],
      });
      expect(res.status).toBe(200);
      expect(issueApprovalsSvc.linkManyForApproval).toHaveBeenCalledWith(
        "approval-new",
        [UUID_TASK_MINE],
        { userId: "user-1" },
      );
    });

    it("team_member cannot create approval (403)", async () => {
      const { app } = buildApp({ role: "team_member", projectIds: [UUID_PROJECT_MINE] });
      const res = await callTool(app, "create-approval", {
        type: "hire_agent",
        payload: {},
      });
      expect(res.status).toBe(403);
    });

    it("team_lead can create approval when linking a task in scope", async () => {
      const task: Task = { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE };
      const { app } = buildApp({
        role: "team_lead",
        projectIds: [UUID_PROJECT_MINE],
        tasks: [task],
      });
      const res = await callTool(app, "create-approval", {
        type: "hire_agent",
        payload: {},
        issueIds: [UUID_TASK_MINE],
      });
      expect(res.status).toBe(200);
    });

    it("team_lead cannot create approval with task outside scope (403)", async () => {
      const task: Task = { id: UUID_TASK_OTHER, companyId: "company-1", projectId: UUID_PROJECT_OTHER };
      const { app } = buildApp({
        role: "team_lead",
        projectIds: [UUID_PROJECT_MINE],
        tasks: [task],
      });
      const res = await callTool(app, "create-approval", {
        type: "hire_agent",
        payload: {},
        issueIds: [UUID_TASK_OTHER],
      });
      expect(res.status).toBe(403);
    });

    it("team_lead cannot create approval without any linked task (403)", async () => {
      const { app } = buildApp({ role: "team_lead", projectIds: [UUID_PROJECT_MINE] });
      const res = await callTool(app, "create-approval", {
        type: "hire_agent",
        payload: {},
      });
      expect(res.status).toBe(403);
    });

    it("rejects cross-company task in issueIds (404)", async () => {
      const task: Task = { id: UUID_TASK_CROSS, companyId: "other-company", projectId: null };
      const { app } = buildApp({ tasks: [task] });
      const res = await callTool(app, "create-approval", {
        type: "hire_agent",
        payload: {},
        issueIds: [UUID_TASK_CROSS],
      });
      expect(res.status).toBe(404);
    });
  });

  describe("approval-decision", () => {
    it("founder can approve", async () => {
      const { app, approvalsSvc } = buildApp({
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "approval-decision", {
        approvalId: UUID_APPROVAL,
        action: "approve",
        decisionNote: "LGTM",
      });
      expect(res.status).toBe(200);
      // companyId now threaded as the second arg (defense-in-depth at service layer).
      expect(approvalsSvc.approve).toHaveBeenCalledWith(UUID_APPROVAL, "company-1", "user-1", "LGTM");
    });

    it("founder can reject", async () => {
      const { app, approvalsSvc } = buildApp({
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "approval-decision", {
        approvalId: UUID_APPROVAL,
        action: "reject",
      });
      expect(res.status).toBe(200);
      expect(approvalsSvc.reject).toHaveBeenCalled();
    });

    it("founder can request revision", async () => {
      const { app, approvalsSvc } = buildApp({
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "approval-decision", {
        approvalId: UUID_APPROVAL,
        action: "requestRevision",
        decisionNote: "needs work",
      });
      expect(res.status).toBe(200);
      expect(approvalsSvc.requestRevision).toHaveBeenCalled();
    });

    it("founder can resubmit with payloadJson", async () => {
      const { app, approvalsSvc } = buildApp({
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "revision_requested", payload: {} }],
      });
      const res = await callTool(app, "approval-decision", {
        approvalId: UUID_APPROVAL,
        action: "resubmit",
        payloadJson: JSON.stringify({ updated: true }),
      });
      expect(res.status).toBe(200);
      expect(approvalsSvc.resubmit).toHaveBeenCalledWith(UUID_APPROVAL, { updated: true });
    });

    it("rejects invalid payloadJson (400)", async () => {
      const { app } = buildApp({
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "revision_requested", payload: {} }],
      });
      const res = await callTool(app, "approval-decision", {
        approvalId: UUID_APPROVAL,
        action: "resubmit",
        payloadJson: "not valid json",
      });
      expect(res.status).toBe(400);
    });

    it("team_member cannot decide (403)", async () => {
      const { app } = buildApp({
        role: "team_member",
        projectIds: [UUID_PROJECT_MINE],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "approval-decision", {
        approvalId: UUID_APPROVAL,
        action: "approve",
      });
      expect(res.status).toBe(403);
    });

    it("team_lead can decide on approval with scoped task link", async () => {
      const task: Task = { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE };
      const { app, approvalsSvc } = buildApp({
        role: "team_lead",
        projectIds: [UUID_PROJECT_MINE],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
        linksByApproval: { [UUID_APPROVAL]: [task] },
      });
      const res = await callTool(app, "approval-decision", {
        approvalId: UUID_APPROVAL,
        action: "approve",
      });
      expect(res.status).toBe(200);
      expect(approvalsSvc.approve).toHaveBeenCalled();
    });

    it("team_lead cannot decide on approval without scoped task link (403)", async () => {
      const task: Task = { id: UUID_TASK_OTHER, companyId: "company-1", projectId: UUID_PROJECT_OTHER };
      const { app } = buildApp({
        role: "team_lead",
        projectIds: [UUID_PROJECT_MINE],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
        linksByApproval: { [UUID_APPROVAL]: [task] },
      });
      const res = await callTool(app, "approval-decision", {
        approvalId: UUID_APPROVAL,
        action: "approve",
      });
      expect(res.status).toBe(403);
    });

    it("cross-company approval returns 404", async () => {
      const { app } = buildApp({
        approvals: [{ id: UUID_APPROVAL_OTHER, companyId: "other-company", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "approval-decision", {
        approvalId: UUID_APPROVAL_OTHER,
        action: "approve",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("add-approval-comment", () => {
    it("founder adds comment", async () => {
      const { app, approvalsSvc } = buildApp({
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "add-approval-comment", {
        approvalId: UUID_APPROVAL,
        body: "looking",
      });
      expect(res.status).toBe(200);
      expect(approvalsSvc.addComment).toHaveBeenCalled();
    });

    it("team_member CAN comment if approval is accessible", async () => {
      const task: Task = { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE };
      const { app } = buildApp({
        role: "team_member",
        projectIds: [UUID_PROJECT_MINE],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
        linksByApproval: { [UUID_APPROVAL]: [task] },
      });
      const res = await callTool(app, "add-approval-comment", {
        approvalId: UUID_APPROVAL,
        body: "asking",
      });
      expect(res.status).toBe(200);
    });

    it("cross-company approval returns 404", async () => {
      const { app } = buildApp({
        approvals: [{ id: UUID_APPROVAL_OTHER, companyId: "other-company", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "add-approval-comment", {
        approvalId: UUID_APPROVAL_OTHER,
        body: "nope",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("link-task-approval", () => {
    it("founder can link", async () => {
      const task: Task = { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE };
      const { app, issueApprovalsSvc } = buildApp({
        tasks: [task],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "link-task-approval", {
        taskId: UUID_TASK_MINE,
        approvalId: UUID_APPROVAL,
      });
      expect(res.status).toBe(200);
      expect(issueApprovalsSvc.link).toHaveBeenCalledWith(UUID_TASK_MINE, UUID_APPROVAL, {
        userId: "user-1",
      });
    });

    it("team_member cannot link (403)", async () => {
      const task: Task = { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE };
      const { app } = buildApp({
        role: "team_member",
        projectIds: [UUID_PROJECT_MINE],
        tasks: [task],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "link-task-approval", {
        taskId: UUID_TASK_MINE,
        approvalId: UUID_APPROVAL,
      });
      expect(res.status).toBe(403);
    });

    it("cross-company task returns 404", async () => {
      const task: Task = { id: UUID_TASK_CROSS, companyId: "other-company", projectId: null };
      const { app } = buildApp({
        tasks: [task],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "link-task-approval", {
        taskId: UUID_TASK_CROSS,
        approvalId: UUID_APPROVAL,
      });
      expect(res.status).toBe(404);
    });

    it("cross-company approval returns 404", async () => {
      const task: Task = { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE };
      const { app } = buildApp({
        tasks: [task],
        approvals: [{ id: UUID_APPROVAL_OTHER, companyId: "other-company", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "link-task-approval", {
        taskId: UUID_TASK_MINE,
        approvalId: UUID_APPROVAL_OTHER,
      });
      expect(res.status).toBe(404);
    });

    it("team_lead cannot link with task outside their scope (403)", async () => {
      const task: Task = { id: UUID_TASK_OTHER, companyId: "company-1", projectId: UUID_PROJECT_OTHER };
      const { app } = buildApp({
        role: "team_lead",
        projectIds: [UUID_PROJECT_MINE],
        tasks: [task],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "link-task-approval", {
        taskId: UUID_TASK_OTHER,
        approvalId: UUID_APPROVAL,
      });
      expect(res.status).toBe(403);
    });
  });

  describe("unlink-task-approval", () => {
    it("founder can unlink", async () => {
      const task: Task = { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE };
      const { app, issueApprovalsSvc } = buildApp({
        tasks: [task],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "unlink-task-approval", {
        taskId: UUID_TASK_MINE,
        approvalId: UUID_APPROVAL,
      });
      expect(res.status).toBe(200);
      expect(issueApprovalsSvc.unlink).toHaveBeenCalledWith(UUID_TASK_MINE, UUID_APPROVAL);
    });

    it("team_member cannot unlink (403)", async () => {
      const task: Task = { id: UUID_TASK_MINE, companyId: "company-1", projectId: UUID_PROJECT_MINE };
      const { app } = buildApp({
        role: "team_member",
        projectIds: [UUID_PROJECT_MINE],
        tasks: [task],
        approvals: [{ id: UUID_APPROVAL, companyId: "company-1", type: "hire_agent", status: "pending", payload: {} }],
      });
      const res = await callTool(app, "unlink-task-approval", {
        taskId: UUID_TASK_MINE,
        approvalId: UUID_APPROVAL,
      });
      expect(res.status).toBe(403);
    });
  });
});
