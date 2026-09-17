import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { universeDraftsRoutes } from "../routes/universe-drafts.js";
import { conflict } from "../errors.js";

const mockService = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("../services/universe-drafts.js", () => ({
  universeDraftsService: () => mockService,
}));

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "55555555-5555-5555-5555-555555555555";
const CONV = "conv-1";
const draftPath = (kind = "task", id = "t1", company = COMPANY_A) =>
  `/api/companies/${company}/universe/conversations/${CONV}/drafts/${kind}/${id}`;
const validPatch = {
  schemaVersion: 1,
  expectedRevision: 0,
  text: "hello",
  attachmentAssetIds: [],
};
const scope = { companyId: COMPANY_A, conversationId: CONV, userId: "user-1" };
const taskDest = { kind: "task", id: "t1" };

function createApp(actor: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { actor?: unknown }).actor = actor;
    next();
  });
  app.use("/api", universeDraftsRoutes({} as never));
  app.use(errorHandler);
  return app;
}

function boardActor(
  overrides: Partial<{ userId: string | undefined; companyIds: string[] }> = {},
) {
  return {
    type: "board" as const,
    userId: "userId" in overrides ? overrides.userId : "user-1",
    source: "session",
    companyIds: overrides.companyIds ?? [COMPANY_A],
    isInstanceAdmin: false,
  };
}
const agentActor = (companyId: string) => ({
  type: "agent" as const,
  source: "agent-key",
  companyId,
  agentId: "agent-1",
});

describe("universe draft routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET returns the draft for the scope + destination", async () => {
    const draft = { revision: 2, text: "hi", attachmentAssetIds: ["a1"] };
    mockService.get.mockResolvedValue(draft);
    const res = await request(createApp(boardActor())).get(draftPath());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual(draft);
    expect(mockService.get).toHaveBeenCalledWith(scope, taskDest);
  });

  it("GET rejects none (401), userless board (401), cross-company and agents (403)", async () => {
    for (const [actor, status] of [
      [{ type: "none", source: "none" }, 401],
      [boardActor({ userId: undefined }), 401],
      [boardActor({ companyIds: [COMPANY_B] }), 403],
      [agentActor(COMPANY_A), 403],
    ] as const) {
      const res = await request(createApp(actor)).get(draftPath());
      expect(res.status, JSON.stringify(res.body)).toBe(status);
    }
    expect(mockService.get).not.toHaveBeenCalled();
  });

  it("PATCH persists a valid draft and returns it", async () => {
    mockService.patch.mockResolvedValue({ revision: 1, text: "hello", attachmentAssetIds: [] });
    const res = await request(createApp(boardActor()))
      .patch(draftPath())
      .send(validPatch);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockService.patch).toHaveBeenCalledWith(scope, taskDest, validPatch);
  });

  it("PATCH rejects an unknown destination kind with 400", async () => {
    const res = await request(createApp(boardActor()))
      .patch(draftPath("evil", "x"))
      .send(validPatch);
    expect(res.status).toBe(400);
    expect(mockService.patch).not.toHaveBeenCalled();
  });

  it("PATCH rejects a malformed body with 400", async () => {
    const res = await request(createApp(boardActor()))
      .patch(draftPath())
      .send({ schemaVersion: 1, expectedRevision: 0 });
    expect(res.status).toBe(400);
    expect(mockService.patch).not.toHaveBeenCalled();
  });

  it("PATCH surfaces a stale-revision conflict as 409", async () => {
    mockService.patch.mockRejectedValue(conflict("Stale draft revision"));
    const res = await request(createApp(boardActor()))
      .patch(draftPath())
      .send(validPatch);
    expect(res.status).toBe(409);
  });
});
