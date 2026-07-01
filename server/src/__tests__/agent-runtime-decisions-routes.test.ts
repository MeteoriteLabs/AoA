import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../errors.js";
import { errorHandler } from "../middleware/index.js";
import { agentRuntimeDecisionRoutes } from "../routes/agent-runtime-decisions.js";

const mockRuntimeDecisions = vi.hoisted(() => ({
  getDetail: vi.fn(),
  answerPrompt: vi.fn(),
}));

const mockPerms = vi.hoisted(() => ({
  isFounder: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  agentRuntimeDecisionService: () => mockRuntimeDecisions,
  permissionService: () => mockPerms,
}));

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "55555555-5555-5555-5555-555555555555";
const DECISION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const permissionDetail = {
  id: DECISION_ID,
  hubItemId: null,
  companyId: COMPANY_A,
  agentId: "22222222-2222-2222-2222-222222222222",
  runId: "33333333-3333-3333-3333-333333333333",
  adapterType: "openai_codex",
  adapterSessionId: "session-1",
  kind: "permission",
  status: "created",
  sourceRevision: 2,
  nonce: "nonce-1",
  title: "Allow command?",
  summary: "The agent wants to run a command",
  promptText: "May I run pnpm test?",
  toolName: "shell",
  command: "pnpm test",
  cwd: "C:/repo",
  path: null,
  networkTarget: null,
  riskClass: "medium",
  options: null,
  timeoutPolicy: "deny",
  expiresAt: null,
  answeredAt: null,
  relayedAt: null,
  relayError: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

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
    userId: overrides.userId ?? "user-1",
    source: overrides.source ?? "session",
    companyIds: overrides.companyIds ?? [COMPANY_A],
    isInstanceAdmin: overrides.isInstanceAdmin ?? false,
  };
}

function createApp(actor: unknown = boardActor()) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api", agentRuntimeDecisionRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("agent runtime decision routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPerms.isFounder.mockResolvedValue(true);
    mockRuntimeDecisions.getDetail.mockResolvedValue(permissionDetail);
    mockRuntimeDecisions.answerPrompt.mockResolvedValue({ ...permissionDetail, status: "answered", sourceRevision: 3 });
  });

  it("GET detail requires board authentication and company access", async () => {
    const noAuth = await request(createApp({ type: "none", source: "none" }))
      .get(`/api/companies/${COMPANY_A}/agent-runtime-decisions/${DECISION_ID}`);
    expect(noAuth.status).toBe(401);

    const wrongCompany = await request(createApp(boardActor({ companyIds: [COMPANY_B] })))
      .get(`/api/companies/${COMPANY_A}/agent-runtime-decisions/${DECISION_ID}`);
    expect(wrongCompany.status).toBe(403);
    expect(mockRuntimeDecisions.getDetail).not.toHaveBeenCalled();
  });

  it("GET detail returns a company-scoped runtime decision for board users", async () => {
    const res = await request(createApp())
      .get(`/api/companies/${COMPANY_A}/agent-runtime-decisions/${DECISION_ID}`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: DECISION_ID, kind: "permission", sourceRevision: 2 });
    expect(mockRuntimeDecisions.getDetail).toHaveBeenCalledWith(COMPANY_A, DECISION_ID);
  });

  it("POST answer rejects non-founder board users before mutating", async () => {
    mockPerms.isFounder.mockResolvedValue(false);

    const res = await request(createApp())
      .post(`/api/companies/${COMPANY_A}/agent-runtime-decisions/${DECISION_ID}/answer`)
      .send({
        kind: "permission",
        decision: "allow_once",
        expectedSourceRevision: 2,
        nonce: "nonce-1",
      });

    expect(res.status).toBe(403);
    expect(mockRuntimeDecisions.answerPrompt).not.toHaveBeenCalled();
  });

  it("POST answer accepts permission decisions and threads optimistic concurrency fields", async () => {
    const res = await request(createApp())
      .post(`/api/companies/${COMPANY_A}/agent-runtime-decisions/${DECISION_ID}/answer`)
      .send({
        kind: "permission",
        decision: "allow_once",
        expectedSourceRevision: 2,
        nonce: "nonce-1",
        idempotencyKey: "idem-1",
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockRuntimeDecisions.answerPrompt).toHaveBeenCalledWith({
      companyId: COMPANY_A,
      decisionId: DECISION_ID,
      actorUserId: "user-1",
      kind: "permission",
      decision: "allow_once",
      expectedSourceRevision: 2,
      nonce: "nonce-1",
      idempotencyKey: "idem-1",
    });
  });

  it("POST answer rejects invalid work-question payloads", async () => {
    const res = await request(createApp())
      .post(`/api/companies/${COMPANY_A}/agent-runtime-decisions/${DECISION_ID}/answer`)
      .send({
        kind: "work_question",
        decision: "deny",
        expectedSourceRevision: 2,
        nonce: "nonce-1",
      });

    expect(res.status).toBe(400);
    expect(mockRuntimeDecisions.answerPrompt).not.toHaveBeenCalled();
  });

  it("POST answer returns stale-prompt conflicts from the service", async () => {
    mockRuntimeDecisions.answerPrompt.mockRejectedValue(
      new HttpError(409, "Runtime decision source revision mismatch"),
    );

    const res = await request(createApp())
      .post(`/api/companies/${COMPANY_A}/agent-runtime-decisions/${DECISION_ID}/answer`)
      .send({
        kind: "permission",
        decision: "deny",
        expectedSourceRevision: 1,
        nonce: "nonce-1",
      });

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe("Runtime decision source revision mismatch");
  });
});
