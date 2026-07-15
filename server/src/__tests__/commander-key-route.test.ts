import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";

vi.mock("drizzle-orm", () => drizzleOperatorStubs());
vi.mock("@armyofagents/db", () => ({
  agents: makeTableProxy("agents"),
  internalAgentConfig: makeTableProxy("internal_agent_config"),
}));
const mockAssertRole = vi.hoisted(() => vi.fn(async () => {}));
const mockPersist = vi.hoisted(() => vi.fn(async () => ({ secretId: "sec-1" })));
vi.mock("../middleware/rbac.js", () => ({ assertRole: mockAssertRole }));
vi.mock("../routes/authz.js", () => ({ assertCompanyAccess: vi.fn() }));
vi.mock("../services/secrets.js", () => ({ secretService: () => ({ create: vi.fn(), syncEnvBindingsForTarget: vi.fn() }) }));
vi.mock("../services/commander-key.js", () => ({ persistCommanderApiKey: mockPersist }));
import { errorHandler } from "../middleware/error-handler.js";
import { commanderKeyRoutes } from "../routes/commander-key.js";

function db(results: unknown[][]) {
  let i = 0;
  return { select: () => ({ from: () => ({ where: () => ({ limit: async () => results[i++] ?? [] }) }) }) } as never;
}
function makeApp(dbInst: unknown, actor: Record<string, unknown> = { type: "board", userId: "u1" }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as { actor: unknown }).actor = actor as never; next(); });
  app.use("/api", commanderKeyRoutes(dbInst as never));
  app.use(errorHandler);
  return app;
}
const url = "/api/companies/c1/internal-agent/commander-key";
const okDb = () => db([[{ agentId: "cmd" }], [{ adapterConfig: {} }]]);

describe("POST commander-key (Plan 3 T2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertRole.mockResolvedValue(undefined);
  });

  it("401 for a non-board actor", async () => {
    const res = await request(makeApp(okDb(), { type: "agent" })).post(url).send({ provider: "anthropic", value: "sk" });
    expect(res.status).toBe(401);
  });

  it("403 for a non-founder (assertRole throws)", async () => {
    mockAssertRole.mockRejectedValueOnce(Object.assign(new Error("forbidden"), { status: 403, statusCode: 403 }));
    const res = await request(makeApp(okDb())).post(url).send({ provider: "anthropic", value: "sk" });
    expect(res.status).toBe(403);
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("400 for an invalid provider", async () => {
    const res = await request(makeApp(okDb())).post(url).send({ provider: "gemini", value: "sk" });
    expect(res.status).toBe(400);
  });

  it("400 for an empty value", async () => {
    const res = await request(makeApp(okDb())).post(url).send({ provider: "anthropic", value: "   " });
    expect(res.status).toBe(400);
  });

  it("404 when no Commander agent is configured", async () => {
    const res = await request(makeApp(db([[]]))).post(url).send({ provider: "anthropic", value: "sk" });
    expect(res.status).toBe(404);
    expect(mockPersist).not.toHaveBeenCalled();
  });

  it("200 persists the key and returns the secretId (not the raw key)", async () => {
    const res = await request(makeApp(okDb())).post(url).send({ provider: "anthropic", value: "sk-ant-SECRET" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, secretId: "sec-1" });
    expect(JSON.stringify(res.body)).not.toContain("sk-ant-SECRET");
    expect(mockPersist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyId: "c1", agentId: "cmd", provider: "anthropic", apiKey: "sk-ant-SECRET" }),
    );
  });
});
