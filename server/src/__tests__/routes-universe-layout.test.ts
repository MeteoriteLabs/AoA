import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { universeLayoutRoutes } from "../routes/universe-layout.js";
import { conflict } from "../errors.js";

const mockService = vi.hoisted(() => ({
  get: vi.fn(),
  apply: vi.fn(),
  getReceipt: vi.fn(),
}));

vi.mock("../services/universe-layout.js", () => ({
  universeLayoutService: () => mockService,
}));

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "55555555-5555-5555-5555-555555555555";
const CONV = "conv-1";
const layoutPath = (company = COMPANY_A) =>
  `/api/companies/${company}/universe/conversations/${CONV}/layout`;
const validPatch = {
  schemaVersion: 1,
  operationId: "op-1",
  expectedRevision: 0,
  operations: [{ type: "viewport", x: 0, y: 0, zoom: 1 }],
};
const scope = { companyId: COMPANY_A, conversationId: CONV, userId: "user-1" };

function createApp(actor: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { actor?: unknown }).actor = actor;
    next();
  });
  app.use("/api", universeLayoutRoutes({} as never));
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

describe("universe layout routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET returns the snapshot for the scope", async () => {
    const snapshot = {
      schemaVersion: 1,
      revision: 3,
      document: {
        panels: [],
        order: [],
        selected: null,
        maximized: null,
        viewport: { x: 0, y: 0, zoom: 1 },
        nextOpenedOrdinal: 1,
      },
    };
    mockService.get.mockResolvedValue(snapshot);
    const res = await request(createApp(boardActor())).get(layoutPath());
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual(snapshot);
    expect(mockService.get).toHaveBeenCalledWith(scope);
  });

  it("GET rejects none (401), a userless board (401), cross-company and agents (403)", async () => {
    for (const [actor, status] of [
      [{ type: "none", source: "none" }, 401],
      [boardActor({ userId: undefined }), 401],
      [boardActor({ companyIds: [COMPANY_B] }), 403],
      [agentActor(COMPANY_A), 403],
    ] as const) {
      const res = await request(createApp(actor)).get(layoutPath());
      expect(res.status, JSON.stringify(res.body)).toBe(status);
    }
    expect(mockService.get).not.toHaveBeenCalled();
  });

  it("PATCH applies a valid patch and returns the ack", async () => {
    mockService.apply.mockResolvedValue({
      operationId: "op-1",
      revision: 1,
      schemaVersion: 1,
    });
    const res = await request(createApp(boardActor()))
      .patch(layoutPath())
      .send(validPatch);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ operationId: "op-1", revision: 1, schemaVersion: 1 });
    expect(mockService.apply).toHaveBeenCalledWith(scope, validPatch);
  });

  it("PATCH rejects a malformed patch with 400 before touching the service", async () => {
    const res = await request(createApp(boardActor()))
      .patch(layoutPath())
      .send({
        schemaVersion: 1,
        operationId: "op",
        expectedRevision: 0,
        operations: [{ type: "nope" }],
      });
    expect(res.status).toBe(400);
    expect(mockService.apply).not.toHaveBeenCalled();
  });

  it("PATCH surfaces a service conflict as 409", async () => {
    mockService.apply.mockRejectedValue(conflict("Stale revision"));
    const res = await request(createApp(boardActor()))
      .patch(layoutPath())
      .send(validPatch);
    expect(res.status).toBe(409);
  });

  it("GET receipt returns 404 when unknown and the ack when present", async () => {
    mockService.getReceipt.mockResolvedValue(null);
    const miss = await request(createApp(boardActor())).get(
      `${layoutPath()}/operations/op-x`,
    );
    expect(miss.status).toBe(404);
    mockService.getReceipt.mockResolvedValue({
      operationId: "op-1",
      revision: 2,
      schemaVersion: 1,
    });
    const hit = await request(createApp(boardActor())).get(
      `${layoutPath()}/operations/op-1`,
    );
    expect(hit.status, JSON.stringify(hit.body)).toBe(200);
    expect(hit.body).toEqual({ operationId: "op-1", revision: 2, schemaVersion: 1 });
  });
});
